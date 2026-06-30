import { Router, Request, Response, NextFunction } from 'express';
import db from '../database.js';

const router = Router();

// 异步错误处理包装器
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/** GET /api/projects — 查询项目列表 */
router.get('/', asyncHandler(async (req, res) => {
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;
  const page = parseInt(req.query.page as string) || 1;
  const size = parseInt(req.query.size as string) || 10;
  const offset = (page - 1) * size;

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
  const { name, customer, status, manager, start_date, end_date, it_output, business_type, description } = req.body;
  if (!name || !customer) { res.status(400).json({ error: '项目名称和客户必填' }); return; }

  const result = await db.runAsync(
    `INSERT INTO test_projects (name, customer, status, manager, start_date, end_date, it_output, business_type, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    name, customer, status || '未开始', manager || '', start_date || '', end_date || null,
    it_output || 0, business_type || null, description || null,
  );

  res.json({ success: true, id: result.lastInsertRowid });
}));

/** PUT /api/projects/:id — 更新项目 */
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, customer, status, manager, start_date, end_date, it_output, business_type, description } = req.body;
  await db.runAsync(
    `UPDATE test_projects SET name=$1,customer=$2,status=$3,manager=$4,start_date=$5,end_date=$6,it_output=$7,business_type=$8,description=$9,updated_at=NOW() WHERE id=$10`,
    name, customer, status, manager, start_date, end_date, it_output, business_type, description, req.params.id,
  );
  res.json({ success: true });
}));

/** DELETE /api/projects/:id — 删除项目 */
router.delete('/:id', asyncHandler(async (req, res) => {
  await db.runAsync('DELETE FROM test_projects WHERE id=$1', req.params.id);
  res.json({ success: true });
}));

/** GET /api/projects/:id — 项目详情 */
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await db.getAsync('SELECT * FROM test_projects WHERE id=$1', req.params.id);
  if (!row) { res.status(404).json({ error: '项目不存在' }); return; }
  res.json({ success: true, data: row });
}));

/** GET /api/history-projects — 历史项目 */
router.get('/history/list', asyncHandler(async (_req, res) => {
  const rows = await db.allAsync('SELECT * FROM historical_projects ORDER BY end_date DESC');
  res.json({ success: true, data: rows });
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

export default router;
