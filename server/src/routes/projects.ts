import { Router, Request, Response, NextFunction } from 'express';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

const router = Router();

// 异步错误处理包装器
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// 所有 /api/projects/* 路由都必须登录
router.use(requireAuth);

// ============= 参数校验工具 =============

/** 解析正整数 id（如 'abc' 或负数返回 null，调用方决定如何处理） */
function parseIdOrNull(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

/** 限制分页参数边界 */
function clampPageSize(rawPage: unknown, rawSize: unknown): { page: number; size: number; offset: number } {
  const page = Math.max(1, parseInt(String(rawPage ?? '1'), 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(String(rawSize ?? '10'), 10) || 10));
  return { page, size, offset: (page - 1) * size };
}

/** GET /api/projects — 查询项目列表 */
router.get('/', asyncHandler(async (req, res) => {
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
router.post('/', asyncHandler(async (req, res) => {
  const {
    name, customer, status, manager,
    start_date, end_date, it_output,
    business_type, description,
    planned_manpower, city, assigned_member_ids,
  } = req.body;
  if (!name || !customer) { res.status(400).json({ error: '项目名称和客户必填' }); return; }

  const result = await db.runAsync(
    `INSERT INTO test_projects (
       name, customer, status, manager,
       start_date, end_date, it_output,
       business_type, description,
       planned_manpower, city, assigned_member_ids
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    name, customer, status || '未开始', manager || '',
    start_date || '', end_date || null, it_output || 0,
    business_type || null, description || null,
    planned_manpower || null, city || null,
    assigned_member_ids || null,
  );

  res.json({ success: true, id: result.lastInsertRowid });
}));

/** PUT /api/projects/:id — 更新项目 */
router.put('/:id', asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const {
    name, customer, status, manager,
    start_date, end_date, it_output,
    business_type, description,
    planned_manpower, city, assigned_member_ids,
  } = req.body;
  const result = await db.runAsync(
    `UPDATE test_projects SET
       name=$1, customer=$2, status=$3, manager=$4,
       start_date=$5, end_date=$6, it_output=$7,
       business_type=$8, description=$9,
       planned_manpower=$10, city=$11, assigned_member_ids=$12,
       updated_at=NOW()
     WHERE id=$13 RETURNING id`,
    name, customer, status, manager,
    start_date, end_date, it_output,
    business_type, description,
    planned_manpower, city, assigned_member_ids,
    id,
  );
  if (result.changes === 0) { res.status(404).json({ error: '项目不存在' }); return; }
  res.json({ success: true, id: result.lastInsertRowid });
}));

/** DELETE /api/projects/:id — 删除项目 */
router.delete('/:id', requireRole(['管理者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const result = await db.runAsync('DELETE FROM test_projects WHERE id=$1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '项目不存在' }); return; }
  res.json({ success: true });
}));

/** GET /api/projects/:id — 项目详情 */
router.get('/:id', asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const row = await db.getAsync('SELECT * FROM test_projects WHERE id=$1', id);
  if (!row) { res.status(404).json({ error: '项目不存在' }); return; }
  res.json({ success: true, data: row });
}));

/** GET /api/history-projects — 历史项目（注意：必须在 /history/:id 之前，否则会被 :id='list' 拦截）*/
router.get('/history/list', asyncHandler(async (_req, res) => {
  const rows = await db.allAsync('SELECT * FROM historical_projects ORDER BY end_date DESC');
  res.json({ success: true, data: rows });
}));

/** POST /api/projects/history — 创建历史项目（写入 historical_projects 表，而非 test_projects） */
router.post('/history', asyncHandler(async (req, res) => {
  const { name, customer, it_output, start_date, end_date, doc_link } = req.body;
  if (!name || !customer) {
    res.status(400).json({ error: '项目名称和客户必填' });
    return;
  }
  const result = await db.runAsync(
    `INSERT INTO historical_projects (name, customer, it_output, start_date, end_date, doc_link)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    name,
    customer,
    it_output ?? 0,
    start_date || '',
    end_date || '',
    doc_link || null,
  );
  res.json({ success: true, id: result.lastInsertRowid });
}));

/** GET /api/team-members — 团队成员 */
router.get('/members/list', asyncHandler(async (req, res) => {
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

/** POST /api/projects/members — 创建团队成员 */
router.post('/members', asyncHandler(async (req, res) => {
  const { name, employee_id, status, skills, current_projects, email, phone } = req.body;
  if (!name || !employee_id) {
    res.status(400).json({ error: '姓名和工号必填' });
    return;
  }
  try {
    const result = await db.runAsync(
      `INSERT INTO team_members (name, employee_id, status, skills, current_projects, email, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      name,
      employee_id,
      status || '空闲',
      JSON.stringify(skills || []),
      JSON.stringify(current_projects || []),
      email || null,
      phone || null,
    );
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
router.put('/members/:id', asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const { name, employee_id, status, skills, current_projects, email, phone } = req.body;
  const result = await db.runAsync(
    `UPDATE team_members SET
       name=$1, employee_id=$2, status=$3,
       skills=$4, current_projects=$5,
       email=$6, phone=$7
     WHERE id=$8 RETURNING id`,
    name,
    employee_id,
    status || '空闲',
    JSON.stringify(skills || []),
    JSON.stringify(current_projects || []),
    email || null,
    phone || null,
    id,
  );
  if (result.changes === 0) { res.status(404).json({ error: '成员不存在' }); return; }
  res.json({ success: true, id: result.lastInsertRowid, changes: result.changes });
}));

/** DELETE /api/projects/members/:id — 删除团队成员 */
router.delete('/members/:id', requireRole(['管理者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const result = await db.runAsync('DELETE FROM team_members WHERE id=$1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '成员不存在' }); return; }
  res.json({ success: true });
}));

/** PUT /api/projects/history/:id — 更新历史项目 */
router.put('/history/:id', asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const { name, it_output, start_date, end_date, customer, doc_link } = req.body;
  const result = await db.runAsync(
    `UPDATE historical_projects SET
       name=$1, it_output=$2, start_date=$3,
       end_date=$4, customer=$5, doc_link=$6
     WHERE id=$7 RETURNING id`,
    name,
    it_output ?? 0,
    start_date || '',
    end_date || '',
    customer || '',
    doc_link || null,
    id,
  );
  if (result.changes === 0) { res.status(404).json({ error: '历史项目不存在' }); return; }
  res.json({ success: true, id: result.lastInsertRowid, changes: result.changes });
}));

/** DELETE /api/projects/history/:id — 删除历史项目 */
router.delete('/history/:id', requireRole(['管理者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const result = await db.runAsync('DELETE FROM historical_projects WHERE id=$1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '历史项目不存在' }); return; }
  res.json({ success: true });
}));

export default router;
