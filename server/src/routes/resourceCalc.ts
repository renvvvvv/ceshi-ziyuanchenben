import { Router, Request, Response } from 'express';
import db from '../database.js';
import { calculateResource, type ResourceInput } from '../services/resourceCalculator.js';

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

/** GET /api/resource-calc/history — 查询历史 */
router.get('/history', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 20;
    const offset = (page - 1) * size;

    const rows = db.prepare(`SELECT id, batch_id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
      total_cabinets, ac_type, peak_staff, total_man_days, result_json, created_at
      FROM resource_calc_history ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(size, offset);

    const total = (db.prepare('SELECT COUNT(*) as cnt FROM resource_calc_history').get() as { cnt: number }).cnt;

    res.json({ success: true, data: rows, page, size, total });
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
