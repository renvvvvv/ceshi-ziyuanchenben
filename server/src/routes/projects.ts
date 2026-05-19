import { Router, Request, Response } from 'express';
import db from '../database.js';

const router = Router();

/** GET /api/projects — 查询项目列表 */
router.get('/', (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 10;
    const offset = (page - 1) * size;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (status && status !== '全部') { where += ' AND status=?'; params.push(status); }
    if (search) { where += ' AND (name LIKE ? OR customer LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const rows = db.prepare(`SELECT * FROM test_projects ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM test_projects ${where}`).get(...params) as { cnt: number }).cnt;

    res.json({ success: true, data: rows, page, size, total });
  } catch (e) {
    res.status(500).json({ error: '查询失败' });
  }
});

/** POST /api/projects — 创建项目 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, customer, status, priority, manager, start_date, end_date, it_output, contract_amount, business_type, description } = req.body;
    if (!name || !customer) { res.status(400).json({ error: '项目名称和客户必填' }); return; }

    const result = db.prepare(`INSERT INTO test_projects (name, customer, status, priority, manager, start_date, end_date, it_output, contract_amount, business_type, description)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      name, customer, status || '未开始', priority || '中', manager || '', start_date || '', end_date || null,
      it_output || 0, contract_amount || null, business_type || null, description || null,
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: '创建失败' });
  }
});

/** PUT /api/projects/:id — 更新项目 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, customer, status, priority, manager, start_date, end_date, it_output, contract_amount, business_type, description } = req.body;
    db.prepare(`UPDATE test_projects SET name=?,customer=?,status=?,priority=?,manager=?,start_date=?,end_date=?,it_output=?,contract_amount=?,business_type=?,description=?,updated_at=datetime('now','localtime') WHERE id=?`)
      .run(name, customer, status, priority, manager, start_date, end_date, it_output, contract_amount, business_type, description, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '更新失败' });
  }
});

/** DELETE /api/projects/:id — 删除项目 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM test_projects WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});

/** GET /api/projects/:id — 项目详情 */
router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM test_projects WHERE id=?').get(req.params.id);
  if (!row) { res.status(404).json({ error: '项目不存在' }); return; }
  res.json({ success: true, data: row });
});

/** GET /api/history-projects — 历史项目 */
router.get('/history/list', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM historical_projects ORDER BY end_date DESC').all();
  res.json({ success: true, data: rows });
});

/** GET /api/team-members — 团队成员 */
router.get('/members/list', (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;
  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (status && status !== '全部') { where += ' AND status=?'; params.push(status); }
  if (search) { where += ' AND (name LIKE ? OR employee_id LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  const rows = db.prepare(`SELECT * FROM team_members ${where} ORDER BY name`).all(...params);
  res.json({ success: true, data: rows });
});

export default router;
