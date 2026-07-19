import { Router, Request, Response, NextFunction } from 'express';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

const router = Router();

// 异步错误处理包装器
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/** 解析正整数 id */
function parseIdOrNull(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

// 知识库 GET 可匿名（看），POST/PUT/DELETE 必须登录
// 不强制 requireRole('管理者')，因为编辑者也可能写文档

/** GET /api/kb — 获取所有 KB 文档（按 sort_order） */
router.get('/', asyncHandler(async (_req, res) => {
  const rows = await db.allAsync('SELECT * FROM kb_documents ORDER BY parent_id NULLS FIRST, sort_order, id');
  res.json({ success: true, data: rows });
}));

/** GET /api/kb/:id — 获取单个 KB 文档 */
router.get('/:id', asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const row = await db.getAsync('SELECT * FROM kb_documents WHERE id=$1', id);
  if (!row) { res.status(404).json({ error: '文档不存在' }); return; }
  res.json({ success: true, data: row });
}));

/** POST /api/kb — 创建 KB 文档 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { parent_id, title, content_md, external_url, sort_order } = req.body || {};
  if (!title) {
    res.status(400).json({ error: '标题必填' });
    return;
  }
  // 如果指定了 parent_id，验证存在
  if (parent_id !== null && parent_id !== undefined) {
    const parentId = parseIdOrNull(String(parent_id));
    if (parentId === null) {
      res.status(400).json({ error: 'parent_id 必须为正整数或 null' });
      return;
    }
    const parent = await db.getAsync('SELECT id FROM kb_documents WHERE id=$1', parentId);
    if (!parent) { res.status(404).json({ error: '父节点不存在' }); return; }
  }
  const result = await db.runAsync(
    `INSERT INTO kb_documents (parent_id, title, content_md, external_url, sort_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    parent_id ?? null,
    title,
    content_md ?? '',
    external_url || null,
    sort_order ?? 0,
  );
  res.json({ success: true, id: result.lastInsertRowid });
}));

/** PUT /api/kb/:id — 更新 KB 文档 */
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const { title, content_md, external_url, sort_order, parent_id } = req.body || {};
  // 验证 title 必填
  if (title !== undefined && !title) {
    res.status(400).json({ error: '标题不能为空' });
    return;
  }
  // 验证 parent_id 不能设置成自己（避免循环引用）
  if (parent_id !== undefined && parent_id !== null) {
    const pid = parseIdOrNull(String(parent_id));
    if (pid === null) {
      res.status(400).json({ error: 'parent_id 必须为正整数或 null' });
      return;
    }
    if (pid === id) {
      res.status(400).json({ error: 'parent_id 不能等于自身 id' });
      return;
    }
  }
  const result = await db.runAsync(
    `UPDATE kb_documents SET
       title = COALESCE($1, title),
       content_md = COALESCE($2, content_md),
       external_url = $3,
       sort_order = COALESCE($4, sort_order),
       parent_id = $5,
       updated_at = NOW()
     WHERE id = $6 RETURNING id`,
    title ?? null,
    content_md ?? null,
    external_url !== undefined ? external_url : null,
    sort_order ?? null,
    parent_id !== undefined ? parent_id : null,
    id,
  );
  if (result.changes === 0) { res.status(404).json({ error: '文档不存在' }); return; }
  res.json({ success: true, id: result.lastInsertRowid });
}));

/** DELETE /api/kb/:id — 删除 KB 文档（cascade 会删子节点） */
router.delete('/:id', requireRole(['管理者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const result = await db.runAsync('DELETE FROM kb_documents WHERE id=$1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '文档不存在' }); return; }
  res.json({ success: true });
}));

export default router;