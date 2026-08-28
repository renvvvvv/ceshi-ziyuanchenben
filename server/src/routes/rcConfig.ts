/**
 * 测试资源配置模块路由（收编自单文件资源配置工具）
 *
 * 数据契约见前端 src/types/resourceConfig.ts（与原工具 JSON 导出格式对齐）。
 * data JSONB 存 10 个子模块数组；导入时做 schema 归一化（补缺数组/清洗 id），
 * 沿用原工具 ensureProjectFields/ensureProjectIds 的加固语义。
 */
import { Router, Request, Response, NextFunction } from 'express';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

const router = Router();
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

function parseIdOrNull(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

// ============== 子模块归一化（导入/写入边界统一调用） ==============

const MODULE_ARRAYS = [
  'personnel', 'staff', 'subsidy', 'external',
  'loads', 'instruments', 'consumables', 'labor', 'safety',
] as const;

function sanitizeId(v: unknown): string | null {
  return typeof v === 'string' && /^[a-z0-9]+$/i.test(v) ? v : null;
}

/** 行级清洗：补合法 id（原 uid 或重新生成），剔除非对象项 */
function sanitizeRows(arr: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const r of arr) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const row = r as Record<string, unknown>;
    if (!sanitizeId(row.id)) row.id = genId();
    out.push(row);
  }
  return out;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 归一化 data JSONB：10 个子模块必须是数组；cert 三段补全。
 * 含旧格式迁移（对齐原工具 ensureProjectFields/ensurePersonnelLM 语义）：
 *  - personnel 旧版只有 count+division 文本 → 解析出 lead/member（2026-08-22 改版前的备份）
 *  - staff 旧版缺 total/role → total=survey+retest+test，role 按 post 派生
 *  - labor 缺 workersCustom → false
 */
function sanitizeData(raw: unknown): Record<string, unknown> | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of MODULE_ARRAYS) {
    const v = data[key];
    data[key] = Array.isArray(v) ? sanitizeRows(v) : [];
  }
  // personnel：旧格式迁移（从 division 文本解析主测/组员人数）
  for (const r of data.personnel as Record<string, unknown>[]) {
    const leadBlank = r.lead == null || r.lead === '';
    const memberBlank = r.member == null || r.member === '';
    if (leadBlank || memberBlank) {
      const div = String(r.division || '');
      const lm = /主测\s*(\d+)\s*人/.exec(div);
      const mm = /组员\s*(\d+)\s*人/.exec(div);
      if (leadBlank && lm) r.lead = parseInt(lm[1], 10);
      if (memberBlank && mm) r.member = parseInt(mm[1], 10);
    }
    const lead = Number(r.lead) || 0;
    const member = Number(r.member) || 0;
    if (lead || member) r.count = lead + member; // 派生值以双列为准
  }
  // staff：total/role 迁移
  for (const r of data.staff as Record<string, unknown>[]) {
    if (r.total == null || r.total === '') {
      r.total = (Number(r.survey) || 0) + (Number(r.retest) || 0) + (Number(r.test) || 0);
    }
    if (!r.role) {
      const post = String(r.post || '');
      if (post.includes('经理')) r.role = '经理';
      else if (post.includes('主测') || post.includes('组长')) r.role = '主测';
      else if (post.includes('工程师')) r.role = '测试工程师';
      else r.role = '组员';
    }
  }
  // loads：数量/备用台数整数化（负载为整台单位，历史数据存过 0.1 等小数）
  for (const r of data.loads as Record<string, unknown>[]) {
    for (const k of ['count', 'ratio']) {
      const v = Number(r[k]);
      if (Number.isFinite(v) && v > 0 && !Number.isInteger(v)) r[k] = Math.ceil(v);
      else if (!Number.isFinite(v)) r[k] = 0;
    }
  }
  // labor：workersCustom 补默认
  for (const r of data.labor as Record<string, unknown>[]) {
    if (r.workersCustom == null) r.workersCustom = false;
    if (r.mode == null) r.mode = 'auto';
  }
  // cert：三段结构补全
  const cert = (data.cert && typeof data.cert === 'object' && !Array.isArray(data.cert))
    ? (data.cert as Record<string, unknown>) : {};
  data.cert = {
    cqc: (cert.cqc && typeof cert.cqc === 'object') ? cert.cqc : { req: '', region: '', time: '' },
    air: (cert.air && typeof cert.air === 'object') ? cert.air : { req: '', region: '', time: '' },
    emc: (cert.emc && typeof cert.emc === 'object') ? cert.emc : { req: '', region: '', time: '' },
  };
  return data;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDateOrNull(v: unknown): string | null {
  if (typeof v === 'string' && DATE_RE.test(v)) return v;
  return null;
}

// ============== 项目 CRUD ==============

/** GET /api/rc/projects — 列表（不含 data 大字段，详情单独取） */
router.get('/projects', requireAuth, asyncHandler(async (_req, res) => {
  const rows = await db.allAsync(
    `SELECT id, name, mw, site, manager, test_days, start_date, end_date, remark, status,
            created_by, created_at, updated_at,
            jsonb_array_length(COALESCE(data->'personnel','[]'::jsonb)) AS personnel_count,
            jsonb_array_length(COALESCE(data->'staff','[]'::jsonb)) AS staff_count,
            jsonb_array_length(COALESCE(data->'loads','[]'::jsonb)) AS loads_count,
            jsonb_array_length(COALESCE(data->'instruments','[]'::jsonb)) AS instruments_count
     FROM rc_projects ORDER BY updated_at DESC`,
  );
  res.json({ success: true, data: rows });
}));

/** GET /api/rc/projects/:id — 详情（含完整 data） */
router.get('/projects/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const row = await db.getAsync('SELECT * FROM rc_projects WHERE id=$1', id);
  if (!row) { res.status(404).json({ error: '配置项目不存在' }); return; }
  res.json({ success: true, data: row });
}));

/** POST /api/rc/projects — 创建（body 可只给基本信息；data 可选） */
router.post('/projects', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || typeof b.name !== 'string') { res.status(400).json({ error: '项目名称必填' }); return; }
  const data = sanitizeData(b.data) ?? {};
  const result = await db.runAsync(
    `INSERT INTO rc_projects (name, mw, site, manager, test_days, start_date, end_date, remark, status, data, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    b.name,
    String(b.mw ?? ''),
    String(b.site ?? ''),
    String(b.manager ?? ''),
    Number.isFinite(Number(b.test_days)) ? Number(b.test_days) : 40,
    validDateOrNull(b.start_date),
    validDateOrNull(b.end_date),
    String(b.remark ?? ''),
    b.status === '已交付' ? '已交付' : '配置中',
    JSON.stringify(data),
    (req as any).user?.username || '',
  );
  res.json({ success: true, id: result.lastInsertRowid });
}));

/** PUT /api/rc/projects/:id — 部分更新（标量字段 + data 整体替换） */
router.put('/projects/:id', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const b = req.body || {};
  if (b.start_date !== undefined && b.start_date !== null && b.start_date !== '' && !DATE_RE.test(String(b.start_date))) {
    res.status(400).json({ error: `start_date 格式非法：${String(b.start_date).slice(0, 20)}` }); return;
  }
  if (b.end_date !== undefined && b.end_date !== null && b.end_date !== '' && !DATE_RE.test(String(b.end_date))) {
    res.status(400).json({ error: `end_date 格式非法：${String(b.end_date).slice(0, 20)}` }); return;
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (col: string, val: unknown) => { values.push(val); sets.push(`${col}=$${values.length}`); };
  if (b.name !== undefined) add('name', b.name);
  if (b.mw !== undefined) add('mw', String(b.mw));
  if (b.site !== undefined) add('site', String(b.site));
  if (b.manager !== undefined) add('manager', String(b.manager));
  if (b.test_days !== undefined && Number.isFinite(Number(b.test_days))) add('test_days', Number(b.test_days));
  if (b.start_date !== undefined) add('start_date', validDateOrNull(b.start_date));
  if (b.end_date !== undefined) add('end_date', validDateOrNull(b.end_date));
  if (b.remark !== undefined) add('remark', String(b.remark));
  if (b.status !== undefined) add('status', b.status === '已交付' ? '已交付' : '配置中');
  if (b.data !== undefined) {
    const data = sanitizeData(b.data);
    if (data === null) { res.status(400).json({ error: 'data 必须是对象' }); return; }
    add('data', JSON.stringify(data));
  }
  if (sets.length === 0) { res.status(400).json({ error: '没有可更新的字段' }); return; }
  values.push(id);
  const result = await db.runAsync(
    `UPDATE rc_projects SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${values.length} RETURNING id`,
    ...values,
  );
  if (result.changes === 0) { res.status(404).json({ error: '配置项目不存在' }); return; }
  res.json({ success: true, id: result.lastInsertRowid });
}));

/** DELETE /api/rc/projects/:id */
router.delete('/projects/:id', requireAuth, requireRole(['管理者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const result = await db.runAsync('DELETE FROM rc_projects WHERE id=$1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '配置项目不存在' }); return; }
  res.json({ success: true });
}));

/**
 * POST /api/rc/projects/import — 导入原工具 JSON 备份
 * body: 原工具导出格式 { app, version, exportTime, project } 或直接给 project 对象
 */
router.post('/projects/import', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const p = b.project && typeof b.project === 'object' ? b.project : b;
  if (!p || typeof p !== 'object' || !Array.isArray(p.personnel)) {
    res.status(400).json({ error: '不是有效的资源配置导出文件（缺少 personnel 数组）' });
    return;
  }
  const data = sanitizeData(p);
  if (!data) { res.status(400).json({ error: '数据结构非法' }); return; }
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `导入配置_${new Date().toISOString().slice(0, 10)}`;
  const result = await db.runAsync(
    `INSERT INTO rc_projects (name, mw, site, manager, test_days, start_date, end_date, remark, status, data, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'配置中',$9,$10) RETURNING id`,
    name,
    String(p.mw ?? ''),
    String(p.site ?? ''),
    String(p.manager ?? ''),
    Number.isFinite(Number(p.test_days)) ? Number(p.test_days) : 40,
    validDateOrNull(p.startDate),
    validDateOrNull(p.endDate),
    String(p.remark ?? ''),
    JSON.stringify(data),
    (req as any).user?.username || '',
  );
  res.json({ success: true, id: result.lastInsertRowid, name });
}));

// ============== 交付存档 ==============

/** POST /api/rc/projects/:id/deliver — 归档快照 */
router.post('/projects/:id/deliver', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const row = await db.getAsync('SELECT * FROM rc_projects WHERE id=$1', id);
  if (!row) { res.status(404).json({ error: '配置项目不存在' }); return; }
  const { id: _pid, ...snapshot } = row as Record<string, unknown>;
  await db.runAsync(
    'INSERT INTO rc_delivered (project_id, name, snapshot) VALUES ($1,$2,$3)',
    id, String(row.name), JSON.stringify(snapshot),
  );
  await db.runAsync(`UPDATE rc_projects SET status='已交付', updated_at=NOW() WHERE id=$1`, id);
  res.json({ success: true });
}));

/** GET /api/rc/delivered — 交付存档列表 */
router.get('/delivered', requireAuth, asyncHandler(async (_req, res) => {
  const rows = await db.allAsync(
    `SELECT id, project_id, name, saved_at,
            snapshot->>'mw' AS mw, snapshot->>'site' AS site, snapshot->>'manager' AS manager,
            snapshot->>'test_days' AS test_days
     FROM rc_delivered ORDER BY saved_at DESC`,
  );
  res.json({ success: true, data: rows });
}));

// ============== 自有资源库 ==============

/** GET /api/rc/assets */
router.get('/assets', requireAuth, asyncHandler(async (_req, res) => {
  const rows = await db.allAsync('SELECT * FROM rc_assets ORDER BY cat, id');
  res.json({ success: true, data: rows });
}));

/** POST /api/rc/assets */
router.post('/assets', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const CATS = ['load', 'ins', 'pdu', 'cabinet'];
  if (!CATS.includes(b.cat)) { res.status(400).json({ error: 'cat 必须是 load/ins/pdu/cabinet' }); return; }
  if (!b.name || typeof b.name !== 'string') { res.status(400).json({ error: '名称必填' }); return; }
  const count = Number(b.count);
  const result = await db.runAsync(
    `INSERT INTO rc_assets (cat, name, spec, count, note) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    b.cat, b.name, String(b.spec ?? ''), Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0, String(b.note ?? ''),
  );
  res.json({ success: true, id: result.lastInsertRowid });
}));

/** PUT /api/rc/assets/:id — 部分更新 */
router.put('/assets/:id', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const b = req.body || {};
  const sets: string[] = [];
  const values: unknown[] = [];
  if (b.cat !== undefined) { if (!['load', 'ins', 'pdu', 'cabinet'].includes(b.cat)) { res.status(400).json({ error: 'cat 非法' }); return; } values.push(b.cat); sets.push(`cat=$${values.length}`); }
  if (b.name !== undefined) { values.push(String(b.name)); sets.push(`name=$${values.length}`); }
  if (b.spec !== undefined) { values.push(String(b.spec)); sets.push(`spec=$${values.length}`); }
  if (b.count !== undefined) { const c = Number(b.count); if (!Number.isFinite(c) || c < 0) { res.status(400).json({ error: 'count 非法' }); return; } values.push(Math.floor(c)); sets.push(`count=$${values.length}`); }
  if (b.note !== undefined) { values.push(String(b.note)); sets.push(`note=$${values.length}`); }
  if (sets.length === 0) { res.status(400).json({ error: '没有可更新的字段' }); return; }
  values.push(id);
  const result = await db.runAsync(
    `UPDATE rc_assets SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${values.length} RETURNING id`,
    ...values,
  );
  if (result.changes === 0) { res.status(404).json({ error: '资源不存在' }); return; }
  res.json({ success: true });
}));

/** DELETE /api/rc/assets/:id */
router.delete('/assets/:id', requireAuth, requireRole(['管理者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const result = await db.runAsync('DELETE FROM rc_assets WHERE id=$1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '资源不存在' }); return; }
  res.json({ success: true });
}));

// ============== 部门人员库 ==============

/** 职级归一：P4~P7 → T4~T7（原工具双轨制：库存 T、显示 P） */
function normLevel(v: unknown): string {
  const s = String(v || '').trim().toUpperCase();
  const m = /^([PT])([3-7])$/.exec(s);
  if (!m) return 'T4';
  return 'T' + m[2];
}

/** GET /api/rc/dept-members — 列表（level 转显示值 P） */
router.get('/dept-members', requireAuth, asyncHandler(async (_req, res) => {
  const rows = await db.allAsync(
    'SELECT id, name, level, post, company, phone, skill, note, updated_at FROM rc_dept_members ORDER BY level DESC, id',
  );
  res.json({ success: true, data: rows.map((r) => ({ ...r, level: String(r.level).replace(/^T/, 'P') })) });
}));

/** POST /api/rc/dept-members */
router.post('/dept-members', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || typeof b.name !== 'string') { res.status(400).json({ error: '姓名必填' }); return; }
  const result = await db.runAsync(
    `INSERT INTO rc_dept_members (name, level, post, company, phone, skill, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    b.name, normLevel(b.level), String(b.post ?? ''), String(b.company ?? ''),
    String(b.phone ?? ''), String(b.skill ?? ''), String(b.note ?? ''),
  );
  res.json({ success: true, id: result.lastInsertRowid });
}));

/** PUT /api/rc/dept-members/:id — 部分更新 */
router.put('/dept-members/:id', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const b = req.body || {};
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (col: string, val: unknown) => { values.push(val); sets.push(`${col}=$${values.length}`); };
  if (b.name !== undefined) add('name', String(b.name));
  if (b.level !== undefined) add('level', normLevel(b.level));
  if (b.post !== undefined) add('post', String(b.post));
  if (b.company !== undefined) add('company', String(b.company));
  if (b.phone !== undefined) add('phone', String(b.phone));
  if (b.skill !== undefined) add('skill', String(b.skill));
  if (b.note !== undefined) add('note', String(b.note));
  if (sets.length === 0) { res.status(400).json({ error: '没有可更新的字段' }); return; }
  values.push(id);
  const result = await db.runAsync(
    `UPDATE rc_dept_members SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${values.length} RETURNING id`,
    ...values,
  );
  if (result.changes === 0) { res.status(404).json({ error: '人员不存在' }); return; }
  res.json({ success: true });
}));

/** DELETE /api/rc/dept-members/:id */
router.delete('/dept-members/:id', requireAuth, requireRole(['管理者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const result = await db.runAsync('DELETE FROM rc_dept_members WHERE id=$1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '人员不存在' }); return; }
  res.json({ success: true });
}));

/**
 * POST /api/rc/dept-members/import — 批量导入（原工具格式）
 * body: { _type:'deptMembersLib', members:[{name,level(P/T),post,company,phone,skill,note}] }
 * 按 姓名+手机号 去重（存在则更新）
 */
router.post('/dept-members/import', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const members = Array.isArray(b.members) ? b.members : (Array.isArray(b) ? b : null);
  if (!members) { res.status(400).json({ error: '缺少 members 数组' }); return; }
  let added = 0, updated = 0;
  for (const m of members) {
    if (!m || typeof m !== 'object' || !m.name) continue;
    const exist = await db.getAsync('SELECT id FROM rc_dept_members WHERE name=$1 AND phone=$2', String(m.name), String(m.phone ?? ''));
    if (exist) {
      await db.runAsync(
        `UPDATE rc_dept_members SET level=$1, post=$2, company=$3, skill=$4, note=$5, updated_at=NOW() WHERE id=$6`,
        normLevel(m.level), String(m.post ?? ''), String(m.company ?? ''), String(m.skill ?? ''), String(m.note ?? ''), exist.id,
      );
      updated++;
    } else {
      await db.runAsync(
        `INSERT INTO rc_dept_members (name, level, post, company, phone, skill, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        String(m.name), normLevel(m.level), String(m.post ?? ''), String(m.company ?? ''),
        String(m.phone ?? ''), String(m.skill ?? ''), String(m.note ?? ''),
      );
      added++;
    }
  }
  res.json({ success: true, added, updated });
}));

export default router;
