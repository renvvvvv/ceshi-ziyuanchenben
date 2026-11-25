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

/** 功率段归一成 [功率, 台数][]，丢弃非法项 */
function normalizeSegments(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) return [];
  const out: [number, number][] = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const pw = Number((g as { power?: unknown }).power), n = Number((g as { count?: unknown }).count);
    if (Number.isFinite(pw) && pw > 0 && Number.isFinite(n) && n > 0) out.push([pw, n]);
  }
  return out;
}

/**
 * 机柜功率怎么交给计算脚本：脚本（resource_plan.py 的 make_input）只读 cabinet_power，
 * 取值是单个数字，或 [[功率, 台数], ...]；它根本不认识 cabinet_power_segments。
 * 此前两个及以上功率段时传给脚本的 cabinet_power 是 0，假负载需求整块被算成 0（2026-11-24 实测复现）。
 * 返回：cpPy 给脚本；cp 入库用的单值（cabinet_power 列是整数：单段取整，多段取按台数加权的平均功率再取整；
 * 精确的分段另存 cabinet_power_segments 列，重新加载历史记录时以它为准）。
 */
function cabinetPowerOf(input: Record<string, unknown>): { segs: [number, number][]; cpPy: number | [number, number][]; cp: number } {
  const segs = normalizeSegments(input.cabinet_power_segments);
  const single = Number(input.cabinet_power) || 0;
  if (segs.length === 1) return { segs, cpPy: segs[0][0], cp: Math.round(segs[0][0]) };
  if (segs.length > 1) {
    const n = segs.reduce((acc, [, c]) => acc + c, 0);
    return { segs, cpPy: segs, cp: Math.round(segs.reduce((acc, [pw, c]) => acc + pw * c, 0) / n) };
  }
  return { segs, cpPy: single, cp: Math.round(single) };
}

/** POST /api/resource-calc — 单算 */
const validateTransformers = (val: unknown): val is [number, number][] =>
  Array.isArray(val) && val.every((t) => Array.isArray(t) && t.length >= 2 && typeof t[0] === 'number' && typeof t[1] === 'number');

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

  const { segs, cpPy, cp } = cabinetPowerOf(input);
  const tc = Number(input.total_cabinets) || segs.reduce((s, seg) => s + seg[1], 0);

  // 校验 it_transformers / power_transformers 格式（必须在调 Python 和写 DB 之前，避免无效请求消耗子进程并污染历史表）
  // validateTransformers 已提为模块级（batch 与单算共用）
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
    cabinet_power: cpPy,
    it_transformers: input.it_transformers,
    power_transformers: input.power_transformers,
    total_cabinets: tc,
    ac_type: input.ac_type,
  };
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
       total_cabinets, ac_type, peak_staff, total_man_days, result_json, cabinet_power_segments)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    batchId, input.total_mw, input.total_duration, cp,
    JSON.stringify(input.it_transformers), JSON.stringify(input.power_transformers),
    tc, input.ac_type,
    stdReport.汇总.峰值同时在场, stdReport.汇总.总人天,
    JSON.stringify(report),
    // 完整分段另存一列：只存加权平均功率的话，重新加载时没法还原多功率段
    segs.length > 0 ? JSON.stringify(segs) : null,
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
  // 与单算一致的变压器参数校验（此前 batch 原样透传 Python 子进程）
  for (const item of inputs) {
    if ((item.it_transformers !== undefined && !validateTransformers(item.it_transformers))
      || (item.power_transformers !== undefined && !validateTransformers(item.power_transformers))) {
      res.status(400).json({ error: `变压器参数格式非法（it/power_transformers 须为 [number, number][]）` });
      return;
    }
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

      const { segs, cpPy, cp } = cabinetPowerOf(input);
      const tc = Number(input.total_cabinets) || segs.reduce((s, seg) => s + seg[1], 0);

      const pyInput: Record<string, unknown> = {
        total_mw: input.total_mw,
        total_duration: input.total_duration,
        cabinet_power: cpPy,
        it_transformers: input.it_transformers,
        power_transformers: input.power_transformers,
        total_cabinets: tc,
        ac_type: input.ac_type,
      };
      // 可选参数与单算保持同一口径（此前群算不传项目类型、混合变压器等，同样的参数两种模式结果不同）
      for (const k of ['project_type', 'hybrid_transformers', 'tight_schedule', 'cert_name', 'cert_scope', 'pdu_type', 'has_gen_load'] as const) {
        if (input[k] !== undefined && input[k] !== '') pyInput[k] = input[k];
      }

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
           total_cabinets, ac_type, peak_staff, total_man_days, result_json, cabinet_power_segments)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        batchId, input.total_mw, input.total_duration, cp,
        JSON.stringify(input.it_transformers), JSON.stringify(input.power_transformers),
        tc, input.ac_type,
        stdReport.汇总.峰值同时在场, stdReport.汇总.总人天,
        JSON.stringify(report),
        // 完整分段另存一列：只存加权平均功率的话，重新加载时没法还原多功率段
        segs.length > 0 ? JSON.stringify(segs) : null,
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
  const size = Math.min(100, Math.max(1, parseInt(req.query.size as string) || 20));
  const filterDate = req.query.date as string || '';
  // all（默认）/ single（单算）/ batch（群算批次）：前端一直在传，此前后端从不读
  const filterType = req.query.type as string || 'all';
  if (filterDate && !/^\d{4}-\d{2}-\d{2}$/.test(filterDate)) {
    res.status(400).json({ error: 'date 格式应为 YYYY-MM-DD' }); return;
  }
  const offset = (page - 1) * size;

  let batchQuery = `SELECT batch_id, COUNT(*) as count, MIN(total_mw) as min_mw, MAX(total_mw) as max_mw,
    SUM(peak_staff) as total_peak, SUM(total_man_days) as total_md, MAX(created_at) as created_at
    FROM resource_calc_history WHERE batch_id IS NOT NULL`;
  let singleQuery = `SELECT id, batch_id, total_mw, total_duration, cabinet_power, cabinet_power_segments, it_transformers, power_transformers,
    total_cabinets, ac_type, peak_staff, total_man_days, result_json, created_at
    FROM resource_calc_history WHERE batch_id IS NULL`;
  const dateParams: string[] = [];
  if (filterDate) {
    // 走索引的日期范围（::TEXT LIKE 无法命中 idx_rc_created）
    batchQuery += ` AND created_at >= $1::date AND created_at < ($1::date + 1)`;
    singleQuery += ` AND created_at >= $1::date AND created_at < ($1::date + 1)`;
    // 参数直接是 YYYY-MM-DD，再由 $1::date 转成日期；不要带 %（那是不走索引的 LIKE 写法留下的）
    dateParams.push(filterDate);
  }
  // SQL 层 LIMIT（分页总量上限），不再全表载入内存后 JS 切片
  batchQuery += ` GROUP BY batch_id ORDER BY MIN(created_at) DESC LIMIT 500`;
  singleQuery += ` ORDER BY created_at DESC LIMIT 500`;

  const batchRows = filterType === 'single' ? [] : await db.allAsync(batchQuery, ...dateParams);
  const singleRows = filterType === 'batch' ? [] : await db.allAsync(singleQuery, ...dateParams);

  type Row = { type: string; time: string; [key: string]: unknown };
  // time 用 ISO 字符串：此前是 Date 的默认字符串（“Tue Nov 24 2026 …”），按它排序会先比星期、再比月份，顺序是错的
  const toRow = (type: string) => (r: Record<string, unknown>) =>
    ({ type, time: new Date(r.created_at as Date).toISOString(), ...r });
  const merged: Row[] = [...batchRows.map(toRow('batch')), ...singleRows.map(toRow('single'))];
  merged.sort((a, b) => b.time.localeCompare(a.time));

  const total = merged.length;
  const paged = merged.slice(offset, offset + size);

  res.json({ success: true, data: paged, page, size, total });
}));

/** GET /api/resource-calc/history/batch/:batchId */
router.get('/history/batch/:batchId', requireAuth, asyncHandler(async (req, res) => {
  const rows = await db.allAsync(
    `SELECT id, total_mw, total_duration, cabinet_power, cabinet_power_segments, it_transformers, power_transformers,
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
