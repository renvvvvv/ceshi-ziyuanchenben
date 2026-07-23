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

/**
 * 蛇形 → 前端驼峰映射
 */
function rowToAdjustment(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    memberId: row.member_id,
    projectName: row.project_name,
    cycleStart: row.cycle_start,
    projectStart: row.project_start,
    projectEnd: row.project_end,
    leaveDays: row.leave_days,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/attendance-adjustments
 * 返回所有校准记录（key 形如 "memberId-projectName-cycleStart"）
 * 前端可以直接 setAttendanceAdjustments(mapFromRows)
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const memberId = req.query.member_id as string | undefined;
  const cycleStart = req.query.cycle_start as string | undefined;

  let sql = 'SELECT * FROM attendance_adjustments';
  const conds: string[] = [];
  const params: unknown[] = [];
  if (memberId) {
    params.push(memberId);
    conds.push(`member_id = $${params.length}`);
  }
  if (cycleStart) {
    params.push(cycleStart);
    conds.push(`cycle_start = $${params.length}`);
  }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');

  const rows = await db.allAsync(sql, ...params);
  res.json({ success: true, data: rows.map(rowToAdjustment) });
}));

/**
 * PUT /api/attendance-adjustments
 * body: { memberId, projectName, cycleStart, projectStart?, projectEnd?, leaveDays? }
 * upsert by (member_id, project_name, cycle_start)
 */
router.put('/', requireAuth, requireRole(['管理者', '编辑者']), asyncHandler(async (req, res) => {
  const { memberId, projectName, cycleStart, projectStart, projectEnd, leaveDays } = req.body;
  if (!memberId || !projectName || !cycleStart) {
    res.status(400).json({ error: 'memberId / projectName / cycleStart 必填' });
    return;
  }
  const result = await db.runAsync(
    `INSERT INTO attendance_adjustments
       (member_id, project_name, cycle_start, project_start, project_end, leave_days, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (member_id, project_name, cycle_start)
     DO UPDATE SET
       project_start = EXCLUDED.project_start,
       project_end   = EXCLUDED.project_end,
       leave_days    = EXCLUDED.leave_days,
       updated_at    = NOW()
     RETURNING id`,
    memberId,
    projectName,
    cycleStart,
    projectStart || null,
    projectEnd || null,
    leaveDays ?? null,
  );
  res.json({ success: true, id: result.lastInsertRowid });
}));

/**
 * DELETE /api/attendance-adjustments/:id
 */
router.delete('/:id', requireRole(['管理者']), asyncHandler(async (req, res) => {
  const id = parseIdOrNull(req.params.id);
  if (id === null) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const result = await db.runAsync('DELETE FROM attendance_adjustments WHERE id = $1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '记录不存在' }); return; }
  res.json({ success: true });
}));

export default router;