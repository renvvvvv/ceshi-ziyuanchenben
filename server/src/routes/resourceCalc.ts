import { Router, Request, Response } from 'express';
import db from '../database.js';
import { calculateResource, type ResourceInput } from '../../scripts/resource_plan.js';

const router = Router();

/** POST /api/resource-calc — 计算资源规划 */
router.post('/', (req: Request, res: Response) => {
  try {
    const input = req.body as ResourceInput;
    if (!input.total_mw || !input.total_duration) {
      res.status(400).json({ error: '缺少必填参数 total_mw / total_duration' });
      return;
    }

    // 基本校验
    if (input.total_mw < 10 || input.total_mw > 66) {
      res.status(400).json({ error: '总兆瓦数应在 10~66 MW 之间' });
      return;
    }

    const report = calculateResource(input);
    const itCap = input.it_transformers.reduce((s, [c, n]) => s + c * n, 0);
    const pue = itCap > 0 ? input.total_mw / itCap : 1.3;

    // 存入历史
    const batchId = (req.body as { batch_id?: string }).batch_id || null;
    const stmt = db.prepare(`INSERT INTO resource_calc_history
      (batch_id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
       total_cabinets, ac_type, peak_staff, total_man_days, result_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

    stmt.run(
      batchId, input.total_mw, input.total_duration, input.cabinet_power,
      JSON.stringify(input.it_transformers), JSON.stringify(input.power_transformers),
      input.total_cabinets, input.ac_type,
      report.汇总.峰值同时在场, report.汇总.总人天,
      JSON.stringify(report),
    );

    res.json({ success: true, data: report, pue: Math.round(pue * 1000) / 1000 });
  } catch (e) {
    console.error('[ResourceCalc Error]', e);
    res.status(500).json({ error: '计算失败', detail: String(e) });
  }
});

/** POST /api/resource-calc/batch — 群算（多条一起算，存库） */
router.post('/batch', (req: Request, res: Response) => {
  try {
    const body = req.body as { inputs: ResourceInput[]; batch_id?: string };
    const inputs = body.inputs;
    const batchId = body.batch_id || Date.now().toString();
    if (!Array.isArray(inputs) || inputs.length === 0) {
      res.status(400).json({ error: '缺少输入数组' });
      return;
    }

    const results: { index: number; input: ResourceInput; report: ReturnType<typeof calculateResource>; error?: string }[] = [];

    for (let i = 0; i < inputs.length; i++) {
      try {
        const input = inputs[i];
        if (!input.total_mw || !input.total_duration) {
          results.push({ index: i + 1, input, report: {} as ReturnType<typeof calculateResource>, error: '缺少必填参数' });
          continue;
        }
        const report = calculateResource(input);

        const stmt = db.prepare(`INSERT INTO resource_calc_history
          (batch_id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
           total_cabinets, ac_type, peak_staff, total_man_days, result_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

        stmt.run(
          batchId, input.total_mw, input.total_duration, input.cabinet_power,
          JSON.stringify(input.it_transformers), JSON.stringify(input.power_transformers),
          input.total_cabinets, input.ac_type,
          report.汇总.峰值同时在场, report.汇总.总人天,
          JSON.stringify(report),
        );
        results.push({ index: i + 1, input, report });
      } catch (e) {
        results.push({ index: i + 1, input: inputs[i], report: {} as ReturnType<typeof calculateResource>, error: String(e) });
      }
    }

    res.json({ success: true, data: results });
  } catch (e) {
    res.status(500).json({ error: '群算失败', detail: String(e) });
  }
});

/** GET /api/resource-calc/history — 查询历史（已分组，群算合并为一行） */
router.get('/history', (req: Request, res: Response) => {
  try {
    console.log('[HISTORY] request received, query:', req.query);
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 20;
    const filterType = req.query.type as string || 'all';
    const filterDate = req.query.date as string || '';
    const offset = (page - 1) * size;

    let whereDate = '';
    if (filterDate) whereDate = `WHERE created_at LIKE '${filterDate}%'`;

    // 群算分组
    const batchWhere = filterType === 'single' ? 'AND 1=0' : (filterDate ? `AND batch_id IS NOT NULL AND created_at LIKE '${filterDate}%'` : 'AND batch_id IS NOT NULL');
    const batchRows = db.prepare(`SELECT batch_id, COUNT(*) as count, MIN(total_mw) as min_mw, MAX(total_mw) as max_mw,
      SUM(peak_staff) as total_peak, SUM(total_man_days) as total_md, MAX(created_at) as created_at
      FROM resource_calc_history WHERE batch_id IS NOT NULL ${filterDate ? `AND created_at LIKE '${filterDate}%'` : ''}
      GROUP BY batch_id ORDER BY created_at DESC`).all();

    // 单算
    const singleWhere = filterType === 'batch' ? 'AND 1=0' : 'AND batch_id IS NULL';
    const singleRows = db.prepare(`SELECT id, batch_id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
      total_cabinets, ac_type, peak_staff, total_man_days, result_json, created_at
      FROM resource_calc_history WHERE batch_id IS NULL ${filterDate ? `AND created_at LIKE '${filterDate}%'` : ''}
      ORDER BY created_at DESC`).all();

    // 合并排序：batch 和 single 按时间混合
    type Row = { type: string; time: string; [key: string]: unknown };
    const merged: Row[] = [
      ...batchRows.map((r: Record<string, unknown>) => ({ type: 'batch', time: r.created_at as string, ...r })),
      ...singleRows.map((r: Record<string, unknown>) => ({ type: 'single', time: r.created_at as string, ...r })),
    ];
    merged.sort((a, b) => b.time.localeCompare(a.time));

    console.log('[HISTORY] batchRows:', batchRows.length, 'singleRows:', singleRows.length, 'merged:', merged.length);
    const total = merged.length;
    const paged = merged.slice(offset, offset + size);

    res.json({ success: true, data: paged, page, size, total });
  } catch (e) {
    res.status(500).json({ error: '查询失败', detail: String(e) });
  }
});

/** GET /api/resource-calc/history/batch/:batchId — 获取群算批次详情 */
router.get('/history/batch/:batchId', (req: Request, res: Response) => {
  try {
    const rows = db.prepare(`SELECT id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
      total_cabinets, ac_type, peak_staff, total_man_days, result_json, created_at
      FROM resource_calc_history WHERE batch_id=? ORDER BY id`).all(req.params.batchId);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ error: '查询失败', detail: String(e) });
  }
});

/** GET /api/resource-calc/history/:id — 查询单条详情 */
router.get('/history/:id', (req: Request, res: Response) => {
  try {
    const row = db.prepare('SELECT * FROM resource_calc_history WHERE id=?').get(req.params.id);
    if (!row) { res.status(404).json({ error: '记录不存在' }); return; }
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ error: '查询失败', detail: String(e) });
  }
});

/** DELETE /api/resource-calc/history/:id — 删除历史 */
router.delete('/history/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM resource_calc_history WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败', detail: String(e) });
  }
});

export default router;
