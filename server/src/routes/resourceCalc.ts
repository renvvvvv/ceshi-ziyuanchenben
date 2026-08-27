import { Router, Request, Response, NextFunction } from 'express';
import { execFile } from 'child_process';
import { join, dirname } from 'path';
import { requireAuth, requireRole } from './auth.js';
import { fileURLToPath } from 'url';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import db from '../database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 编译后 __dirname = /app/dist/src/routes
// scripts 在 /app/scripts/（Dockerfile COPY server/scripts ./scripts）
// 所以从 dist/src/routes 向上 3 层才到 /app/
const SCRIPTS_DIR = join(__dirname, '..', '..', '..', 'scripts');
const PY = process.platform === 'win32' ? 'python' : 'python3';
const PY_TIMEOUT_MS = 30_000; // 30 秒（资源计算正常情况几秒内完成）

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

function runPy(jsonInput: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    // 随机后缀防同毫秒并发共用临时文件互相覆盖
    const tmpFile = join(tmpdir(), `rc_${Date.now()}_${randomUUID().slice(0, 8)}.json`);
    writeFileSync(tmpFile, JSON.stringify(jsonInput), 'utf-8');
    const script = join(SCRIPTS_DIR, 'resource_plan.py');
    execFile(
      PY,
      [script, '--input', tmpFile],
      {
        cwd: SCRIPTS_DIR,
        maxBuffer: 10 * 1024 * 1024,
        timeout: PY_TIMEOUT_MS, // 关键：30s 超时（修复 P1 #2）
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: process.env.PATH || '' },
      },
      (err, stdout, stderr) => {
        try { unlinkSync(tmpFile); } catch {} // 兜底清理
        if (err) {
          if (err.killed && err.signal === 'SIGTERM') {
            reject(new Error(`Python 计算超时（${PY_TIMEOUT_MS / 1000}s）`));
          } else {
            reject(new Error(stderr || err.message));
          }
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

/** POST /api/resource-calc — 单算 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const input = req.body;
  if (!input.total_mw || !input.total_duration) {
    res.status(400).json({ error: '缺少必填参数 total_mw / total_duration' });
    return;
  }
  if (input.total_mw < 1 || input.total_mw > 66) {
    res.status(400).json({ error: '总兆瓦数应在 1~66 MW 之间' });
    return;
  }

  const segs = input.cabinet_power_segments || [];
  const tc = input.total_cabinets || segs.reduce((s: number, seg: { count: number }) => s + seg.count, 0);
  const cp = input.cabinet_power || (segs.length === 1 ? segs[0].power : 0);

  // 校验 it_transformers / power_transformers 格式（必须在调 Python 和写 DB 之前，避免无效请求消耗子进程并污染历史表）
  const validateTransformers = (val: unknown): val is [number, number][] =>
    Array.isArray(val) && val.every((t) => Array.isArray(t) && t.length >= 2 && typeof t[0] === 'number' && typeof t[1] === 'number');
  if (!validateTransformers(input.it_transformers)) {
    res.status(400).json({ error: 'it_transformers 必须为 [count, capacity][] 数组' });
    return;
  }
  if (!validateTransformers(input.power_transformers)) {
    res.status(400).json({ error: 'power_transformers 必须为 [count, capacity][] 数组' });
    return;
  }

  const pyInput: Record<string, unknown> = {
    total_mw: input.total_mw,
    total_duration: input.total_duration,
    cabinet_power: cp,
    it_transformers: input.it_transformers,
    power_transformers: input.power_transformers,
    total_cabinets: tc,
    ac_type: input.ac_type,
  };
  if (segs.length > 0) pyInput.cabinet_power_segments = segs;
  if (input.project_type) pyInput.project_type = input.project_type;
  if (input.hybrid_transformers?.length) pyInput.hybrid_transformers = input.hybrid_transformers;
  if (input.tight_schedule) pyInput.tight_schedule = input.tight_schedule;
  if (input.cert_name) pyInput.cert_name = input.cert_name;
  if (input.cert_scope) pyInput.cert_scope = input.cert_scope;
  if (input.pdu_type) pyInput.pdu_type = input.pdu_type;
  if (input.has_gen_load) pyInput.has_gen_load = input.has_gen_load;

  const stdout = await runPy(pyInput);
  const report = JSON.parse(stdout);

  let stdReport = report;
  if (report.多版本对比 && report.详细结果) {
    const keys = Object.keys(report.详细结果);
    const stdKey = keys.find((k: string) => k.includes('标准')) || keys[0];
    stdReport = report.详细结果[stdKey];
  }

  const batchId = (req.body as { batch_id?: string }).batch_id || null;
  await db.runAsync(
    `INSERT INTO resource_calc_history
      (batch_id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
       total_cabinets, ac_type, peak_staff, total_man_days, result_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    batchId, input.total_mw, input.total_duration, cp,
    JSON.stringify(input.it_transformers), JSON.stringify(input.power_transformers),
    tc, input.ac_type,
    stdReport.汇总.峰值同时在场, stdReport.汇总.总人天,
    JSON.stringify(report),
  );

  const itCap = input.it_transformers.reduce((s: number, [c, n]: [number, number]) => s + c * n, 0);
  const pue = itCap > 0 ? input.total_mw / itCap : 1.3;

  res.json({ success: true, data: report, pue: Math.round(pue * 1000) / 1000 });
}));

/** POST /api/resource-calc/batch — 群算 */
router.post('/batch', requireAuth, asyncHandler(async (req, res) => {
  // 兼容两种 schema：{ inputs: [...] } (REST 风格) 和 { calculations: [...] } (前端当前使用)
  const body = req.body as { inputs?: Record<string, unknown>[]; calculations?: Record<string, unknown>[]; batch_id?: string };
  const inputs = body.inputs || body.calculations;
  const batchId = body.batch_id || Date.now().toString();

  if (!Array.isArray(inputs) || inputs.length === 0) {
    res.status(400).json({ error: '缺少输入数组（需 inputs 或 calculations 字段）' });
    return;
  }
  // 批量上限：防止一次请求起上千个 Python 子进程拖垮服务
  if (inputs.length > 200) {
    res.status(400).json({ error: `单次群算最多 200 条（当前 ${inputs.length} 条），请分批提交` });
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
      // 范围校验（与单算保持一致，修复 P1 #4）
      const mw = Number(input.total_mw);
      if (mw < 1 || mw > 66) {
        results.push({ index: i + 1, error: `total_mw 必须在 1-66 之间（当前 ${mw}）` });
        continue;
      }

      const segs = (input.cabinet_power_segments as { power: number; count: number }[]) || [];
      const tc = (input.total_cabinets as number) || segs.reduce((s, seg) => s + seg.count, 0);
      const cp = (input.cabinet_power as number) || (segs.length === 1 ? segs[0].power : 0);

      const pyInput: Record<string, unknown> = {
        total_mw: input.total_mw,
        total_duration: input.total_duration,
        cabinet_power: cp,
        it_transformers: input.it_transformers,
        power_transformers: input.power_transformers,
        total_cabinets: tc,
        ac_type: input.ac_type,
      };
      if (segs.length > 0) pyInput.cabinet_power_segments = segs;

      const stdout = await runPy(pyInput);
      const report = JSON.parse(stdout);

      // 与单算保持一致：取"标准"版本的"汇总"字段
      let stdReport = report;
      if (report.多版本对比 && report.详细结果) {
        const keys = Object.keys(report.详细结果);
        const stdKey = keys.find((k: string) => k.includes('标准')) || keys[0];
        stdReport = report.详细结果[stdKey];
      }

      await db.runAsync(
        `INSERT INTO resource_calc_history
          (batch_id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
           total_cabinets, ac_type, peak_staff, total_man_days, result_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        batchId, input.total_mw, input.total_duration, cp,
        JSON.stringify(input.it_transformers), JSON.stringify(input.power_transformers),
        tc, input.ac_type,
        stdReport.汇总.峰值同时在场, stdReport.汇总.总人天,
        JSON.stringify(report),
      );

      results.push({ index: i + 1, ...report });
    } catch (e) {
      results.push({ index: i + 1, error: String(e) });
    }
  }

  res.json({ success: true, data: results });
}));

/** GET /api/resource-calc/history — 查询历史（已分组） */
router.get('/history', requireAuth, asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const size = parseInt(req.query.size as string) || 20;
  const filterDate = req.query.date as string || '';
  const offset = (page - 1) * size;

  let batchQuery = `SELECT batch_id, COUNT(*) as count, MIN(total_mw) as min_mw, MAX(total_mw) as max_mw,
    SUM(peak_staff) as total_peak, SUM(total_man_days) as total_md, MAX(created_at) as created_at
    FROM resource_calc_history WHERE batch_id IS NOT NULL`;
  let singleQuery = `SELECT id, batch_id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
    total_cabinets, ac_type, peak_staff, total_man_days, result_json, created_at
    FROM resource_calc_history WHERE batch_id IS NULL`;
  const dateParams: string[] = [];
  if (filterDate) {
    batchQuery += ` AND created_at::TEXT LIKE $1`;
    singleQuery += ` AND created_at::TEXT LIKE $1`;
    dateParams.push(`${filterDate}%`);
  }
  batchQuery += ` GROUP BY batch_id ORDER BY created_at DESC`;
  singleQuery += ` ORDER BY created_at DESC`;

  const batchRows = await db.allAsync(batchQuery, ...dateParams);
  const singleRows = await db.allAsync(singleQuery, ...dateParams);

  type Row = { type: string; time: string; [key: string]: unknown };
  const merged: Row[] = [
    ...batchRows.map((r: Record<string, unknown>) => ({ type: 'batch', time: String(r.created_at), ...r })),
    ...singleRows.map((r: Record<string, unknown>) => ({ type: 'single', time: String(r.created_at), ...r })),
  ];
  merged.sort((a, b) => b.time.localeCompare(a.time));

  const total = merged.length;
  const paged = merged.slice(offset, offset + size);

  res.json({ success: true, data: paged, page, size, total });
}));

/** GET /api/resource-calc/history/batch/:batchId */
router.get('/history/batch/:batchId', requireAuth, asyncHandler(async (req, res) => {
  const rows = await db.allAsync(
    `SELECT id, total_mw, total_duration, cabinet_power, it_transformers, power_transformers,
    total_cabinets, ac_type, peak_staff, total_man_days, result_json, created_at
    FROM resource_calc_history WHERE batch_id=$1 ORDER BY id`,
    req.params.batchId,
  );
  res.json({ success: true, data: rows });
}));

/** GET /api/resource-calc/history/:id */
router.get('/history/:id', requireAuth, asyncHandler(async (req, res) => {
  const row = await db.getAsync('SELECT * FROM resource_calc_history WHERE id=$1', req.params.id);
  if (!row) { res.status(404).json({ error: '记录不存在' }); return; }
  res.json({ success: true, data: row });
}));

/** DELETE /api/resource-calc/history/:id */
router.delete('/history/:id', requireRole(['管理者']), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: 'id 必须为正整数' }); return; }
  const result = await db.runAsync('DELETE FROM resource_calc_history WHERE id=$1 RETURNING id', id);
  if (result.changes === 0) { res.status(404).json({ error: '记录不存在' }); return; }
  res.json({ success: true });
}));

export default router;
