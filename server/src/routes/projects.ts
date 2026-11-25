import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { sendPreview } from '../utils/preview.js';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

const router = Router();

// 异步错误处理包装器
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// 设计：所有路由（含只读 GET）都必须登录。此前 GET 允许匿名（“演示模式”），结果公网上不登录就能
// 拿到全部项目、客户、项目经理、文档链接和历史项目（2026-11-24 实测），写操作则一直是必须登录的

// ============= 参数校验工具 =============

/** 解析正整数 id（如 'abc' 或负数返回 null，调用方决定如何处理） */
function parseIdOrNull(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

/**
 * 构造部分更新 SET 子句：只更新请求体中实际携带的字段（键存在于 body）。
 * 缺省字段保持数据库原值——避免部分更新场景（如自动状态流转只传 status）
 * 把 NOT NULL 列写成 NULL 导致 500，或把其他字段意外清空。
 */
function partialSetSql(body: Record<string, unknown>, fields: string[]): { setSql: string; values: unknown[] } | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const f of fields) {
    if (f in body) {
      values.push(body[f] ?? null);
      sets.push(`${f}=$${values.length}`);
    }
  }
  if (sets.length === 0) return null;
  return { setSql: sets.join(', '), values };
}

/** 操作审计：记录高危写操作（fire-and-forget，不阻塞响应、失败仅告警） */
function auditLog(req: Request, action: string, targetType: string, targetId: unknown, targetName: string, detail?: Record<string, unknown>) {
  const u = (req as any).user;
  void db.runAsync(
    `INSERT INTO audit_log (username, user_id, action, target_type, target_id, target_name, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    u?.username ?? 'unknown', String(u?.userId ?? ''), action, targetType, String(targetId ?? ''), targetName,
    detail ? JSON.stringify(detail).slice(0, 2000) : null,
  ).catch((e: Error) => console.warn('[audit] 写入失败:', e.message));
}

/**
 * 项目改名 / 改期后，把别处照抄的“项目名 + 起止日期”对齐到项目表（项目表是唯一来源）。两处：
 *  1 考勤校准记录（按“项目名 + 成员 + 周期”关联，且每次校准会把项目起止日期抄一份）：
 *    - 改名：考勤记录里的项目名跟着改（同一人同一周期在新名字下已有记录的保留新那条）
 *    - 改期：起止日期与项目“旧日期”相同的记录，就是照抄的副本，改成新日期；与旧日期不同的是人工填的，不动
 *  2 成员表里的项目副本（人员池卡片、考勤的应出勤读的是它）：项目名等于旧名字的条目，改成项目现在的名字和日期。
 *    页面里（DataContext.updateProject）也有同样的对齐；放在后端是为了不依赖各人浏览器里跑的是哪个版本的页面。
 * 只改名称和日期：不增删条目、不改成员状态。尽力而为：失败只告警，不影响项目本身的保存。
 * 注意：这里的 SQL 里不能写 jsonb 的 ? 运算符——数据库封装会把文本里的 ? 当成占位符替换掉。
 */
async function followProjectChange(
  prev: { name: string; startDate: string | null; endDate: string | null },
  next: { name?: unknown; startDate?: unknown; endDate?: unknown },
): Promise<void> {
  const norm = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
  try {
    const prevStart = norm(prev.startDate), prevEnd = norm(prev.endDate);
    const newName = norm(next.name) ?? prev.name;
    if (newName !== prev.name) {
      // 同一人同一周期在新旧两个名字下都有记录的，旧名字那条留在原地（没法自动判断该留哪条），记一条日志便于排查
      const dup = await db.getAsync(
        `SELECT count(*)::int AS n FROM attendance_adjustments a
          WHERE a.project_name = $1 AND EXISTS (SELECT 1 FROM attendance_adjustments b
             WHERE b.member_id = a.member_id AND b.cycle_start = a.cycle_start AND b.project_name = $2)`,
        prev.name, newName,
      ) as { n?: number } | undefined;
      if ((dup?.n ?? 0) > 0) {
        console.warn(`[projects] 项目「${prev.name}」改名为「${newName}」：有 ${dup!.n} 条考勤校准记录因新旧名字下同一人同一周期各有一条而留在旧名字下`);
      }
      await db.runAsync(
        `UPDATE attendance_adjustments a SET project_name = $2
          WHERE a.project_name = $1
            AND NOT EXISTS (SELECT 1 FROM attendance_adjustments b
                             WHERE b.member_id = a.member_id AND b.cycle_start = a.cycle_start AND b.project_name = $2)`,
        prev.name, newName,
      );
    }
    // 请求里没带日期的（只改名称、指派、状态的局部更新），沿用项目现有的日期——不能当成“清空”
    const newStart = next.startDate !== undefined ? norm(next.startDate) : prevStart;
    const newEnd = next.endDate !== undefined ? norm(next.endDate) : prevEnd;
    if (next.startDate !== undefined && newStart !== prevStart) {
      await db.runAsync(
        `UPDATE attendance_adjustments SET project_start = $2
          WHERE project_name = $1 AND project_start IS NOT DISTINCT FROM $3::text`,
        newName, newStart, prevStart,
      );
    }
    if (next.endDate !== undefined && newEnd !== prevEnd) {
      await db.runAsync(
        `UPDATE attendance_adjustments SET project_end = $2
          WHERE project_name = $1 AND project_end IS NOT DISTINCT FROM $3::text`,
        newName, newEnd, prevEnd,
      );
    }
    // 成员表里的项目副本：只动项目名等于旧名字的条目。名称和日期都没变的请求（比如只调指派）不动它
    if (newName !== prev.name || newStart !== prevStart || newEnd !== prevEnd) {
      if (newName !== prev.name) {
        await db.runAsync(
          `UPDATE team_members SET current_projects = (
             SELECT COALESCE(jsonb_agg(CASE WHEN n = $1 THEN to_jsonb($2::text) ELSE to_jsonb(n) END), '[]'::jsonb)::text
             FROM jsonb_array_elements_text(current_projects::jsonb) n)
           WHERE jsonb_typeof(current_projects::jsonb) = 'array'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(current_projects::jsonb) n WHERE n = $1)`,
          prev.name, newName,
        );
      }
      for (const col of ['projects', 'upcoming_projects']) {
        await db.runAsync(
          `UPDATE team_members m SET ${col} = (
             SELECT COALESCE(jsonb_agg(
                      e || jsonb_build_object('projectName', $2::text, 'startDate', COALESCE($3::text, ''), 'endDate', COALESCE($4::text, ''))
                      ORDER BY ord), '[]'::jsonb)::text
             FROM jsonb_array_elements(m.${col}::jsonb) WITH ORDINALITY AS t(e, ord))
           WHERE jsonb_typeof(m.${col}::jsonb) = 'array'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.${col}::jsonb) e WHERE e->>'projectName' = $1)`,
          prev.name, newName, newStart, newEnd,
        );
      }
    }
  } catch (e: any) {
    console.warn('[projects] 项目改名/改期后对齐考勤与成员副本失败（不影响项目保存）:', e?.message || e);
  }
}

/** 限制分页参数边界 */
function clampPageSize(rawPage: unknown, rawSize: unknown): { page: number; size: number; offset: number } {
  const page = Math.max(1, parseInt(String(rawPage ?? '1'), 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(String(rawSize ?? '10'), 10) || 10));
  return { page, size, offset: (page - 1) * size };
}

/** GET /api/projects — 查询项目列表 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;
  const { page, size, offset } = clampPageSize(req.query.page, req.query.size);

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let paramIdx = 0;
  if (status && status !== '全部') { where += ` AND status=$${++paramIdx}`; params.push(status); }
  if (search) { where += ` AND (name ILIKE $${paramIdx + 1} OR customer ILIKE $${paramIdx + 2})`; params.push(`%${search}%`, `%${search}%`); paramIdx += 2; }

  const rows = await db.allAsync(`SELECT * FROM test_projects ${where} ORDER BY updated_at DESC LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}`, ...params, size, offset);
  const countRow = await db.getAsync(`SELECT COUNT(*) as cnt FROM test_projects ${where}`, ...params);
  const total = Number(countRow?.cnt || 0);

  res.json({ success: true, data: rows, page, size, total });
}));

/** POST /api/projects — 创建项目 */
router.post('/', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const {
    name, customer, status, manager,
    start_date, end_date, it_output,
    business_type, description,
    planned_manpower, city, assigned_member_ids,
    planned_delivery_date, actual_delivery_date, doc_link,
  } = req.body;
  if (!name || !customer) { res.status(400).json({ error: '项目名称和客户必填' }); return; }
  // 日期格式校验：拒绝 'Invalid Date' 等脏值落库
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  for (const [label, v] of [['开始日期', start_date], ['结束日期', end_date], ['计划交付日期', planned_delivery_date], ['实际交付日期', actual_delivery_date]]) {
    if (v != null && v !== '' && !DATE_RE.test(String(v))) {
      res.status(400).json({ error: `${label}格式非法（应为 YYYY-MM-DD）：${String(v).slice(0, 20)}` });
      return;
    }
  }

  const result = await db.runAsync(
    `INSERT INTO test_projects (
       name, customer, status, manager,
       start_date, end_date, it_output,
       business_type, description,
       planned_manpower, city, assigned_member_ids,
       planned_delivery_date, actual_delivery_date, doc_link
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    name, customer, status || '未开始', manager || '',
    start_date || '', end_date || null, it_output || 0,
    business_type || null, description || null,
    planned_manpower || null, city || null,
    assigned_member_ids || null,
    planned_delivery_date || null, actual_delivery_date || null, doc_link || null,
  );

  auditLog(req, 'create', 'project', result.lastInsertRowid, name, { customer, manager, it_output });
  res.json({ success: true, id: result.lastInsertRowid });
}));

/** PUT /api/projects/:id — 更新项目（部分更新：只改携带的字段，缺省保持原值） */
// ===== 项目阶段附件（文件本体）：上传与预览 =====
const PROJECT_FILES_DIR = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'uploads', 'project-files');
if (!existsSync(PROJECT_FILES_DIR)) { try { mkdirSync(PROJECT_FILES_DIR, { recursive: true }); } catch { /* 忽略 */ } }
const projFileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PROJECT_FILES_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(Buffer.from(file.originalname, 'latin1').toString('utf8'));
    cb(null, `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}${ext}`);
  },
});
const projFileUpload = multer({
  storage: projFileStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

/** POST /api/projects/files/upload — 上传项目阶段附件文件本体（返回 fileUrl 供预览/下载） */
router.post('/files/upload', requireAuth, requireRole(['管理者', '编辑者']), (req, res, next) => {
  projFileUpload.single('file')(req, res, (err: any) => {
    if (err) { res.status(400).json({ success: false, error: `上传失败：${err.message}` }); return; }
    next();
  });
}, asyncHandler(async (req, res) => {
  const f = (req as any).file as Express.Multer.File | undefined;
  if (!f) { res.status(400).json({ success: false, error: '未收到文件' }); return; }
  auditLog(req, 'create', 'project_file', f.filename, Buffer.from(f.originalname, 'latin1').toString('utf8'), { size: f.size });

  // Office 文件上传后立即后台预转 PDF（首次点击预览即可秒开）
  const ext = extname(f.originalname).slice(1).toLowerCase();
  if (['doc','docx','xls','xlsx','ppt','pptx'].includes(ext)) {
    const { startBackgroundConvert } = await import('../utils/preview.js');
    startBackgroundConvert(join(PROJECT_FILES_DIR, f.filename));
  }

  res.json({
    success: true,
    fileUrl: `/api/projects/files/${f.filename}`,
    fileName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
    size: f.size,
  });
}));

/** GET /api/projects/files/:name — 项目阶段附件预览（不支持类型降级下载） */
router.get('/files/:name', requireAuth, asyncHandler(async (req, res) => {
  const name = String(req.params.name || '');
  if (!/^[A-Za-z0-9._-]+$/.test(name)) { res.status(400).json({ error: '非法文件名' }); return; }
  const absPath = join(PROJECT_FILES_DIR, name);
  if (!existsSync(absPath)) { res.status(404).json({ error: '文件不存在' }); return; }
  await sendPreview(res, absPath, name, `/api/projects/files/${name}`);
}));

// 项目阶段时间线（含文件/链接附件）：全量 JSON 存储，多账号共享
db.exec(`CREATE TABLE IF NOT EXISTS project_phases (
  project_id TEXT PRIMARY KEY,
  phases     TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`).catch(() => { /* 启动竞态忽略 */ });

/** GET /api/projects/phases — 全部项目的阶段数据（键: projectId） */
router.get('/phases', requireAuth, asyncHandler(async (_req, res) => {
  const rows = await db.allAsync('SELECT project_id, phases FROM project_phases') as any[];
  const data: Record<string, unknown> = {};
  for (const r of rows) {
    try { data[r.project_id] = JSON.parse(r.phases); } catch { /* 脏行跳过 */ }
  }
  res.json({ success: true, data });
}));

/** PUT /api/projects/phases/:id — 保存某项目的阶段数据（UPSERT 全量覆盖） */
router.put('/phases/:id', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  if (!/^[\w-]{1,64}$/.test(req.params.id)) { res.status(400).json({ success: false, error: '非法的阶段键' }); return; }
  const { phases } = req.body || {};
  if (!Array.isArray(phases)) { res.status(400).json({ success: false, error: 'phases 必须为数组' }); return; }
  const payload = JSON.stringify(phases);
  if (payload.length > 2_000_000) { res.status(400).json({ success: false, error: '数据过大' }); return; }
  await db.runAsync(
    `INSERT INTO project_phases (project_id, phases, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (project_id) DO UPDATE SET phases = $2, updated_at = now()`,
    req.params.id, payload,
  );
  auditLog(req, 'update', 'project_phases', req.params.id, `阶段数据(${phases.length}段)`, {});
  res.json({ success: true });
}));

router.put('/:id', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  // 日期格式校验：拒绝 'Invalid Date' 等脏值落库
  const b = req.body || {};
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  for (const key of ['start_date', 'end_date', 'planned_delivery_date', 'actual_delivery_date']) {
    const v = b[key];
    if (v != null && v !== '' && !DATE_RE.test(String(v))) {
      res.status(400).json({ error: `${key} 格式非法（应为 YYYY-MM-DD）：${String(v).slice(0, 20)}` });
      return;
    }
  }
  const partial = partialSetSql(b, [
    'name', 'customer', 'status', 'manager',
    'start_date', 'end_date', 'it_output',
    'business_type', 'description',
    'planned_manpower', 'city', 'assigned_member_ids',
    'planned_delivery_date', 'actual_delivery_date', 'doc_link',
  ]);
  if (!partial) { res.status(400).json({ error: '没有可更新的字段' }); return; }
  partial.values.push(id);

  // 项目完成自动归档：状态在本次请求中从非"已完成"转为"已完成"的瞬间，
  // 自动插入 historical_projects（同名防重，幂等；原 test_projects 行保留）。
  // 覆盖所有触发路径：autoProcessProjects 状态机 / 手动编辑 / 批量操作。
  const completing = String(b.status ?? '') === '已完成';
  // 更新前状态与名称：归档检测 + 审计 target_name（主键查询，微秒级）
  const prev = await db.getAsync('SELECT status, name, start_date, end_date FROM test_projects WHERE id=$1', id) as
    { status?: string; name?: string; start_date?: string | null; end_date?: string | null } | undefined;
  const prevStatus = prev?.status ?? null;
  const prevName = prev?.name;

  const result = await db.runAsync(
    `UPDATE test_projects SET ${partial.setSql}, updated_at=NOW()
     WHERE id=$${partial.values.length} RETURNING id`,
    ...partial.values,
  );
  if (result.changes === 0) { res.status(404).json({ error: '项目不存在' }); return; }

  // 考勤校准、成员项目副本里照抄的项目名 / 日期跟着改
  await followProjectChange(
    { name: prevName ?? '', startDate: prev?.start_date ?? null, endDate: prev?.end_date ?? null },
    { name: b.name, startDate: b.start_date, endDate: b.end_date },
  );

  let archived = false;
  if (completing && prevStatus !== null && prevStatus !== '已完成') {
    const ins = await db.runAsync(
      `INSERT INTO historical_projects
         (name, it_output, start_date, end_date, customer, doc_link, city, manager,
          planned_delivery_date, actual_delivery_date, planned_manpower, business_type, description, status)
       SELECT name, it_output, start_date, end_date, customer, doc_link, city, manager,
              planned_delivery_date, actual_delivery_date, planned_manpower, business_type, description, '已完成'
       FROM test_projects t
       WHERE t.id = $1
       ON CONFLICT (name) DO NOTHING`,
      id,
    );
    archived = (ins.changes ?? 0) > 0;
    if (archived) console.log(`[projects] 项目完成自动归档到历史项目: id=${id}`);
  }

  auditLog(req, 'update', 'project', id, req.body?.name ?? prevName ?? '', { fields: Object.keys(req.body || {}), ...(archived ? { archived: true } : {}) });
  res.json({ success: true, id: result.lastInsertRowid, ...(archived ? { archived: true } : {}) });
}));

/** DELETE /api/projects/:id — 删除项目 */
router.delete('/:id', requireAuth, requireProjectDeleteUser, asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const prev = await db.getAsync('SELECT name FROM test_projects WHERE id=$1', id) as { name?: string } | undefined;
  const projName = prev?.name;
  const result = await db.runAsync('DELETE FROM test_projects WHERE id=$1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '项目不存在' }); return; }
  auditLog(req, 'delete', 'project', id, projName ?? '');
  res.json({ success: true });
}));

/** GET /api/history-projects — 历史项目（必须在 /:id 之前，否则会被 :id='list' 拦截）*/
router.get('/history/list', requireAuth, asyncHandler(async (_req, res) => {
  const rows = await db.allAsync('SELECT * FROM historical_projects ORDER BY end_date DESC');
  // 2026-07-19 直接转 camelCase 返回，前端无需再 snakeToCamel
  const camelRows = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      out[camel] = v;
    }
    return out;
  });
  res.json({ success: true, data: camelRows });
}));

/** GET /api/projects/:id — 项目详情 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const row = await db.getAsync('SELECT * FROM test_projects WHERE id=$1', id);
  if (!row) { res.status(404).json({ error: '项目不存在' }); return; }
  res.json({ success: true, data: row });
}));

/** POST /api/projects/history — 创建历史项目（写入 historical_projects 表） */
router.post('/history', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const {
    name, customer, it_output, start_date, end_date, doc_link,
    city, manager, status, planned_delivery_date, actual_delivery_date,
    planned_manpower, business_type, description,
  } = req.body;
  if (!name || !customer) {
    res.status(400).json({ error: '项目名称和客户必填' });
    return;
  }
  // 同名防重：历史项目名唯一（与自动归档同一口径），重复创建返回冲突而非插入第二行
  const dup = await db.getAsync('SELECT id FROM historical_projects WHERE name=$1', name);
  if (dup) {
    res.status(409).json({ success: false, error: `历史项目「${name}」已存在（项目完成时会自动归档，无需手动重复添加）` });
    return;
  }
  const result = await db.runAsync(
    `INSERT INTO historical_projects
       (name, customer, it_output, start_date, end_date, doc_link,
        city, manager, status, planned_delivery_date, actual_delivery_date,
        planned_manpower, business_type, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    name,
    customer,
    it_output ?? 0,
    start_date || '',
    end_date || '',
    doc_link || null,
    city || null,
    manager || null,
    status || '已完成',
    planned_delivery_date || null,
    actual_delivery_date || null,
    planned_manpower ?? null,
    business_type || null,
    description || null,
  );
  auditLog(req, 'create', 'history_project', result.lastInsertRowid, name, { customer, it_output });
  res.json({ success: true, id: result.lastInsertRowid });
}));

/** GET /api/team-members — 团队成员 */
router.get('/members/list', requireAuth, asyncHandler(async (req, res) => {
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let paramIdx = 0;
  if (status && status !== '全部') { where += ` AND status=$${++paramIdx}`; params.push(status); }
  if (search) { where += ` AND (name ILIKE $${paramIdx + 1} OR employee_id ILIKE $${paramIdx + 2})`; params.push(`%${search}%`, `%${search}%`); paramIdx += 2; }
  const rows = await db.allAsync(`SELECT * FROM team_members ${where} ORDER BY name`, ...params);
  res.json({ success: true, data: rows });
}));


/** JSON 数组列写入规范化：容忍 前端已 stringify / 原生数组 / 双层 stringify，统一存单层 JSON 文本 */
function normJsonCol(v: unknown, fallback: unknown[] = []): string {
  let x = v;
  let guard = 0;
  while (typeof x === 'string' && guard++ < 4) {
    try { x = JSON.parse(x); } catch { break; }
  }
  return JSON.stringify(Array.isArray(x) ? x : fallback);
}

/** POST /api/projects/members — 创建团队成员 */
router.post('/members', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const { name, employee_id, status, skills, current_projects, email, phone } = req.body;
  if (!name || !employee_id) {
    res.status(400).json({ error: '姓名和工号必填' });
    return;
  }
  try {
    const result = await db.runAsync(
      `INSERT INTO team_members (name, employee_id, status, skills, current_projects, email, phone, position, projects, upcoming_projects, leave_start_date, leave_end_date, title, profile)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      name,
      employee_id,
      status || '空闲',
      normJsonCol(skills),
      normJsonCol(current_projects),
      email || null,
      phone || null,
      req.body.position ?? null,
      normJsonCol(req.body.projects),
      normJsonCol(req.body.upcoming_projects),
      req.body.leave_start_date ?? null,
      req.body.leave_end_date ?? null,
      req.body.title ?? null,
      req.body.profile ?? null,
    );
  auditLog(req, 'create', 'member', result.lastInsertRowid, name, { employee_id, status });
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    if (err?.code === '23505') {
      // unique_violation — employee_id 已存在
      res.status(409).json({ success: false, error: '工号已存在' });
      return;
    }
    throw err;
  }
}));

/** PUT /api/projects/members/:id — 更新团队成员 */
router.put('/members/:id', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const prevMem = await db.getAsync('SELECT name FROM team_members WHERE id=$1', id) as { name?: string } | undefined;
  // 部分更新：只改携带的字段（如考勤模块只改 position），避免把姓名/状态等意外清空
  // JSON 数组列先归一化为单层文本（前端若传已 stringify 的值，原样入库会变双层）
  const putBody = { ...(req.body || {}) };
  for (const k of ['skills', 'current_projects', 'projects', 'upcoming_projects']) {
    if (putBody[k] !== undefined) putBody[k] = normJsonCol(putBody[k], k === 'skills' ? [] : k === 'current_projects' ? [] : []);
  }
  const partial = partialSetSql(putBody, [
    'name', 'employee_id', 'status', 'skills', 'current_projects',
    'email', 'phone', 'position', 'projects', 'upcoming_projects',
    'leave_start_date', 'leave_end_date', 'title', 'profile',
  ]);
  if (!partial) { res.status(400).json({ error: '没有可更新的字段' }); return; }
  partial.values.push(id);
  const result = await db.runAsync(
    `UPDATE team_members SET ${partial.setSql}
     WHERE id=$${partial.values.length} RETURNING id`,
    ...partial.values,
  );
  if (result.changes === 0) { res.status(404).json({ error: '成员不存在' }); return; }
  auditLog(req, 'update', 'member', id, req.body?.name ?? prevMem?.name ?? '', { fields: Object.keys(req.body || {}) });
  res.json({ success: true, id: result.lastInsertRowid, changes: result.changes });
}));

/** DELETE /api/projects/members/:id — 删除团队成员 */
router.delete('/members/:id', requireRole(['管理者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const prev = await db.getAsync('SELECT name FROM team_members WHERE id=$1', id) as { name?: string } | undefined;
  const memName = prev?.name;
  const result = await db.runAsync('DELETE FROM team_members WHERE id=$1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '成员不存在' }); return; }
  await cleanDanglingMemberRefs([String(id)]);
  auditLog(req, 'delete', 'member', id, memName ?? '');
  res.json({ success: true });
}));

/** 清理 test_projects.assigned_member_ids 中已删成员的悬空引用（单删/批删共用）。
 *  SQL 只做 LIKE '[%' 预过滤（不 cast），行内 JSON.parse 判定数组——存量脏数据不再炸整个事务 */
async function cleanDanglingMemberRefs(ids: string[]): Promise<void> {
  const idSet = new Set(ids.map(String));
  const projRows = await db.allAsync(`SELECT id, assigned_member_ids FROM test_projects WHERE assigned_member_ids LIKE '[%'`) as Array<{ id: number; assigned_member_ids: string }>;
  for (const row of projRows) {
    try {
      const arr = JSON.parse(row.assigned_member_ids || '[]');
      if (!Array.isArray(arr) || !arr.some((x) => idSet.has(String(x)))) continue;
      const cleaned = arr.filter((x) => !idSet.has(String(x)));
      await db.runAsync('UPDATE test_projects SET assigned_member_ids=$1 WHERE id=$2', JSON.stringify(cleaned), row.id);
    } catch { /* 行内 JSON 异常跳过 */ }
  }
}

// 项目删除白名单：仅 admin 与指定飞书账号（王家晟）可删除项目/历史项目，
// 其他账号（含管理者角色）一律 403，防止项目数据被误删或恶意删除
const PROJECT_DELETE_ALLOW = new Set(['admin', 'feishu:ou_7348974a528b91d389705f2b0e849623']);
function requireProjectDeleteUser(req: Request, res: Response, next: NextFunction) {
  const u = (req as any).user?.username as string | undefined;
  if (!u || !PROJECT_DELETE_ALLOW.has(u)) {
    res.status(403).json({ success: false, error: '仅授权账号可删除项目数据' });
    return;
  }
  next();
}

// 人员批量管理白名单：仅 admin 与指定飞书账号（王家晟）可一键管理人员信息
const MEMBER_MGMT_ALLOW = new Set(['admin', 'feishu:ou_7348974a528b91d389705f2b0e849623']);

/** POST /api/projects/members/batch-delete — 批量删除团队成员（仅白名单用户，角色再高也不放行） */
router.post('/members/batch-delete', requireAuth, (req, res, next) => {
  const u = (req as any).user?.username as string | undefined;
  if (!u || !MEMBER_MGMT_ALLOW.has(u)) {
    res.status(403).json({ success: false, error: '仅授权账号可使用人员批量管理功能' });
    return;
  }
  next();
}, asyncHandler(async (req, res) => {
  const raw: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(raw.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) { res.status(400).json({ success: false, error: 'ids 不能为空' }); return; }
  if (ids.length > 200) { res.status(400).json({ success: false, error: '单次最多删除 200 条' }); return; }
  // 事务：任一行失败整体回滚，避免"删一半"造成前后端数据分叉
  const client = await db.connect();
  let deleted = 0;
  try {
    await client.query('BEGIN');
    for (const id of ids) {
      const r = await client.query('DELETE FROM team_members WHERE id=$1 RETURNING id', [id]);
      deleted += r.rowCount ?? 0;
    }
    // 顺带清理项目指派里的悬空引用（LIKE '[%' 预过滤，行内 JSON.parse 判定，不依赖 SQL cast）
    const projRows = await client.query(
      `SELECT id, assigned_member_ids FROM test_projects WHERE assigned_member_ids LIKE '[%'`
    );
    const idSet = new Set(ids.map(String));
    for (const row of projRows.rows as Array<{ id: number; assigned_member_ids: string }>) {
      try {
        const arr = JSON.parse(row.assigned_member_ids || '[]');
        if (!Array.isArray(arr) || !arr.some((x) => idSet.has(String(x)))) continue;
        const cleaned = arr.filter((x) => !idSet.has(String(x)));
        await client.query('UPDATE test_projects SET assigned_member_ids=$1 WHERE id=$2', [JSON.stringify(cleaned), row.id]);
      } catch { /* 行内 JSON 异常跳过，不阻塞删除 */ }
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* 连接已断时 ROLLBACK 自身失败不应掩盖原错误 */ }
    throw e;
  } finally {
    client.release(); // aborted 事务连接由 pg 池自动重建，异常路径无需销毁（pg 会 reset）
  }
  auditLog(req, 'batch_delete', 'member', ids.join(','), `${deleted} 人`, { deleted, requested: ids.length });
  res.json({ success: true, deleted, requested: ids.length });
}));

/** PUT /api/projects/history/:id — 更新历史项目（部分更新：只改携带的字段） */
router.put('/history/:id', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const prevHist = await db.getAsync('SELECT name FROM historical_projects WHERE id=$1', id) as { name?: string } | undefined;
  const partial = partialSetSql(req.body || {}, [
    'name', 'it_output', 'start_date', 'end_date', 'customer', 'doc_link',
    'city', 'manager', 'status', 'planned_delivery_date', 'actual_delivery_date',
    'planned_manpower', 'business_type', 'description',
  ]);
  if (!partial) { res.status(400).json({ error: '没有可更新的字段' }); return; }
  partial.values.push(id);
  const result = await db.runAsync(
    `UPDATE historical_projects SET ${partial.setSql}
     WHERE id=$${partial.values.length} RETURNING id`,
    ...partial.values,
  );
  if (result.changes === 0) { res.status(404).json({ error: '历史项目不存在' }); return; }
  auditLog(req, 'update', 'history_project', id, req.body?.name ?? prevHist?.name ?? '', { fields: Object.keys(req.body || {}) });
  res.json({ success: true, id: result.lastInsertRowid, changes: result.changes });
}));

/** DELETE /api/projects/history/:id — 删除历史项目 */
router.delete('/history/:id', requireAuth, requireProjectDeleteUser, asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const prev = await db.getAsync('SELECT name FROM historical_projects WHERE id=$1', id) as { name?: string } | undefined;
  const histName = prev?.name;
  const result = await db.runAsync('DELETE FROM historical_projects WHERE id=$1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '历史项目不存在' }); return; }
  auditLog(req, 'delete', 'history_project', id, histName ?? '');
  res.json({ success: true });
}));

export default router;
