import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '..', '..', '..', 'scripts');
const PY = 'python3';

const router = Router();

function runPy(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(PY, [script, ...args], { cwd: SCRIPTS_DIR, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

/** POST /api/resource-calc — 单算 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input = req.body;
    if (!input.total_mw || !input.total_duration) {
      res.status(400).json({ error: '缺少必填参数 total_mw / total_duration' });
      return;
    }
    if (input.total_mw < 10 || input.total_mw > 66) {
      res.status(400).json({ error: '总兆瓦数应在 10~66 MW 之间' });
      return;
    }

    // 归一化 cabinet_power / total_cabinets（多功率段兼容）
    const cp = input.cabinet_power || (input.cabinet_power_segments || []).map((s: { power: number }) => s.power).join(',') || '0';
    const tc = input.total_cabinets || (input.cabinet_power_segments || []).reduce((s: number, seg: { count: number }) => s + seg.count, 0);

    const pyInput = {
      total_mw: input.total_mw,
      total_duration: input.total_duration,
      cabinet_power: parseInt(cp) || 0,
      it_transformers: input.it_transformers,
      power_transformers: input.power_transformers,
      total_cabinets: tc,
      ac_type: input.ac_type,
    };

    const stdout = await runPy('resource_plan.py', [JSON.stringify(pyInput)]);
    const report = JSON.parse(stdout);

    // 存入历史
    const batchId = (req.body as { batch_id?: string }).batch_id || null;
    db.prepare(`INSERT INTO resource_calc_history
      (batch_id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
       total_cabinets, ac_type, peak_staff, total_man_days, result_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      batchId, input.total_mw, input.total_duration, cp,
      JSON.stringify(input.it_transformers), JSON.stringify(input.power_transformers),
      tc, input.ac_type,
      report.汇总.峰值同时在场, report.汇总.总人天,
      JSON.stringify(report),
    );

    const itCap = input.it_transformers.reduce((s: number, [c, n]: [number, number]) => s + c * n, 0);
    const pue = itCap > 0 ? input.total_mw / itCap : 1.3;

    res.json({ success: true, data: report, pue: Math.round(pue * 1000) / 1000 });
  } catch (e) {
    console.error('[ResourceCalc Error]', e);
    res.status(500).json({ error: '计算失败', detail: String(e) });
  }
});

/** POST /api/resource-calc/batch — 群算 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const body = req.body as { inputs: Record<string, unknown>[]; batch_id?: string };
    const inputs = body.inputs;
    const batchId = body.batch_id || Date.now().toString();

    if (!Array.isArray(inputs) || inputs.length === 0) {
      res.status(400).json({ error: '缺少输入数组' });
      return;
    }

    const results: { index: number; error?: string }[] = [];
    for (let i = 0; i < inputs.length; i++) {
      try {
        const input = inputs[i] as Record<string, unknown>;
        if (!input.total_mw || !input.total_duration) {
          results.push({ index: i + 1, error: '缺少必填参数' });
          continue;
        }

        const cp = (input.cabinet_power as string) || '0';
        const tc = (input.total_cabinets as number) || 0;

        const pyInput = {
          total_mw: input.total_mw,
          total_duration: input.total_duration,
          cabinet_power: parseInt(cp) || 0,
          it_transformers: input.it_transformers,
          power_transformers: input.power_transformers,
          total_cabinets: tc,
          ac_type: input.ac_type,
        };

        const stdout = await runPy('resource_plan.py', [JSON.stringify(pyInput)]);
        const report = JSON.parse(stdout);

        db.prepare(`INSERT INTO resource_calc_history
          (batch_id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
           total_cabinets, ac_type, peak_staff, total_man_days, result_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
          batchId, input.total_mw, input.total_duration, cp,
          JSON.stringify(input.it_transformers), JSON.stringify(input.power_transformers),
          tc, input.ac_type,
          report.汇总.峰值同时在场, report.汇总.总人天,
          JSON.stringify(report),
        );

        results.push({ index: i + 1, ...report });
      } catch (e) {
        results.push({ index: i + 1, error: String(e) });
      }
    }

    res.json({ success: true, data: results });
  } catch (e) {
    res.status(500).json({ error: '群算失败', detail: String(e) });
  }
});

/** GET /api/resource-calc/history — 查询历史（已分组） */
router.get('/history', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 20;
    const filterDate = req.query.date as string || '';
    const offset = (page - 1) * size;

    const batchRows = db.prepare(`SELECT batch_id, COUNT(*) as count, MIN(total_mw) as min_mw, MAX(total_mw) as max_mw,
      SUM(peak_staff) as total_peak, SUM(total_man_days) as total_md, MAX(created_at) as created_at
      FROM resource_calc_history WHERE batch_id IS NOT NULL ${filterDate ? `AND created_at LIKE '${filterDate}%'` : ''}
      GROUP BY batch_id ORDER BY created_at DESC`).all();

    const singleRows = db.prepare(`SELECT id, batch_id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
      total_cabinets, ac_type, peak_staff, total_man_days, result_json, created_at
      FROM resource_calc_history WHERE batch_id IS NULL ${filterDate ? `AND created_at LIKE '${filterDate}%'` : ''}
      ORDER BY created_at DESC`).all();

    type Row = { type: string; time: string; [key: string]: unknown };
    const merged: Row[] = [
      ...batchRows.map((r: Record<string, unknown>) => ({ type: 'batch', time: r.created_at as string, ...r })),
      ...singleRows.map((r: Record<string, unknown>) => ({ type: 'single', time: r.created_at as string, ...r })),
    ];
    merged.sort((a, b) => b.time.localeCompare(a.time));

    const total = merged.length;
    const paged = merged.slice(offset, offset + size);

    res.json({ success: true, data: paged, page, size, total });
  } catch (e) {
    res.status(500).json({ error: '查询失败', detail: String(e) });
  }
});

/** GET /api/resource-calc/history/batch/:batchId */
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

/** GET /api/resource-calc/history/:id */
router.get('/history/:id', (req: Request, res: Response) => {
  try {
    const row = db.prepare('SELECT * FROM resource_calc_history WHERE id=?').get(req.params.id);
    if (!row) { res.status(404).json({ error: '记录不存在' }); return; }
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ error: '查询失败', detail: String(e) });
  }
});

/** DELETE /api/resource-calc/history/:id */
router.delete('/history/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM resource_calc_history WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败', detail: String(e) });
  }
});

export default router;
