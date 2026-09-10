/**
 * 故障日志抓取（平台自身日志快照 + AI 解析归档）
 *
 * 设计：平台问题分散在四个角落——后端运行日志（内存 ring buffer 拦截 console）、
 * 图纸任务 pipeline.log（uploads 只读可得）、宿主层组件日志（宿主 syslog-collect.sh
 * 采集 docker/journal/磁盘内存，经 /app/syslogs 只读挂载）、数据库健康摘要。
 * 一键"抓取快照"把各源近期日志聚合成一份快照入库；AI 解析提取错误时间线、
 * 异常模式与根因建议；历史快照可追溯、可导出。
 *
 * 接口：
 *   POST /api/syslogs/snapshot        抓取快照（body: { hours }，默认 6h）
 *   GET  /api/syslogs                 快照列表
 *   GET  /api/syslogs/:id             快照详情（含各组件日志）
 *   POST /api/syslogs/:id/analyze     AI 解析（GLM-5.2，结果存回快照）
 *   GET  /api/syslogs/:id/export      导出快照 JSON
 */
import { Router, Request, Response, NextFunction } from 'express';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '..', '..', '..', 'uploads');
const SYSLOG_DIR = '/app/syslogs'; // 宿主采集挂载（可能不存在，容错）

const asyncH = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };

const ID_RE = /^[a-z0-9-]+$/;
function validId(id: string): boolean { return ID_RE.test(id) && id.length >= 6 && id.length <= 64; }

// ============== 后端运行日志 ring buffer（console 拦截） ==============

interface LogLine { t: string; level: string; msg: string }
const RING: LogLine[] = [];
const RING_MAX = 4000;

function ringPush(level: string, args: unknown[]) {
  const msg = args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ').slice(0, 2000);
  RING.push({ t: new Date().toISOString(), level, msg });
  if (RING.length > RING_MAX) RING.splice(0, RING.length - RING_MAX);
}

/** 挂载 console 拦截（幂等；保留原行为，仅旁路记录） */
export function installLogRing() {
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a: unknown[]) => { ringPush('info', a); orig.log(...a); };
  console.warn = (...a: unknown[]) => { ringPush('warn', a); orig.warn(...a); };
  console.error = (...a: unknown[]) => { ringPush('error', a); orig.error(...a); };
  // 进程异常也进 ring（崩溃前最后的话）。uncaughtException 记录后必须退出：
  // 进程可能处于未定义状态（句柄泄漏/半途请求），带伤运行无自愈路径；
  // Docker restart:unless-stopped 会拉起干净实例。rejection 仅记录（Node 官方允许）。
  process.on('uncaughtException', e => {
    ringPush('fatal', [`UncaughtException: ${e?.stack || e}`]);
    // eslint-disable-next-line no-console
    console.error('[fatal] uncaughtException, exiting:', e);
    // 给 stdout 一点时间冲刷出 ring 里这行 fatal（供宿主采集与 docker logs 留痕）
    setTimeout(() => process.exit(1), 150);
  });
  process.on('unhandledRejection', r => ringPush('fatal', [`UnhandledRejection: ${r}`]));
}

function tailLines(text: string, n: number): string {
  const lines = text.split('\n');
  let out = lines.slice(-n).join('\n');
  if (out.length > 200000) out = out.slice(-200000); // 单组件 200KB 上限（防超长堆栈行撑爆 JSONB）
  return out;
}

function readTail(path: string, n: number, hours: number): string | null {
  try {
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf8');
    if (!text.trim()) return null;
    return tailLines(text, n);
  } catch { return null; }
}

// ============== 快照聚合 ==============

interface ComponentLog { name: string; desc: string; lines: string }

async function collectComponents(hours: number): Promise<ComponentLog[]> {
  const out: ComponentLog[] = [];
  const since = Date.now() - hours * 3600 * 1000;

  // 1) 后端运行日志（ring buffer，按时间过滤）
  const be = RING.filter(l => new Date(l.t).getTime() >= since)
    .map(l => `[${l.t}] [${l.level}] ${l.msg}`).join('\n');
  if (be.trim()) out.push({ name: 'backend', desc: '后端运行日志（API/数据库/AI 调用）', lines: tailLines(be, 600) });

  // 2) 宿主采集的组件日志（挂载目录；时间过滤交给节截断）
  const hostMap: [string, string, string][] = [
    ['backend-docker', '后端容器 stdout（docker logs，宿主采集）', join(SYSLOG_DIR, 'backend.log')],
    ['frontend-docker', '前端/Nginx 容器 stdout（docker logs，宿主采集）', join(SYSLOG_DIR, 'frontend.log')],
    ['drawing-runner', '图纸执行器（systemd journal，宿主采集）', join(SYSLOG_DIR, 'runner.log')],
    ['host', '宿主资源（磁盘/内存/负载，宿主采集）', join(SYSLOG_DIR, 'host.log')],
  ];
  for (const [name, desc, p] of hostMap) {
    const t = readTail(p, 500, hours);
    if (t) out.push({ name, desc, lines: t });
  }

  // 3) 图纸任务 pipeline.log（最近修改的 3 个任务，尾部）
  try {
    const jobsRoot = join(BASE, 'drawing');
    const jobs = readdirSync(jobsRoot)
      .filter(d => validId(d))
      .map(d => {
        const p = join(jobsRoot, d, 'out', 'pipeline.log');
        try { return { d, p, m: statSync(p).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean as any)
      .sort((a: any, b: any) => b.m - a.m)
      .slice(0, 3);
    for (const j of jobs as any[]) {
      const t = readTail(j.p, 120, hours);
      if (t) out.push({ name: `pipeline:${j.d}`, desc: `图纸任务 ${j.d} 管线日志（尾部）`, lines: t });
    }
  } catch { /* drawing 目录不存在 */ }

  // 4) 数据库健康摘要
  try {
    const pg = await db.allAsync(`
      SELECT (SELECT count(*) FROM pg_stat_activity) AS conn,
             (SELECT count(*) FROM drawing_jobs) AS drawing_jobs,
             (SELECT pg_size_pretty(pg_database_size(current_database()))) AS db_size`) as any[];
    const slow = await db.allAsync(`
      SELECT count(*) AS n FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '5 seconds'`) as any[];
    out.push({
      name: 'db-health',
      desc: '数据库健康摘要',
      lines: `连接数: ${pg[0]?.conn} ｜ 活跃慢查询(>5s): ${slow[0]?.n ?? 0} ｜ 库大小: ${pg[0]?.db_size} ｜ 图纸任务数: ${pg[0]?.drawing_jobs}`,
    });
  } catch (e: any) {
    out.push({ name: 'db-health', desc: '数据库健康摘要（采集失败）', lines: String(e?.message || e) });
  }

  return out;
}

// ============== 建表（幂等） ==============

db.exec(`
  CREATE TABLE IF NOT EXISTS sys_snapshots (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    hours INT NOT NULL DEFAULT 6,
    created_by TEXT NOT NULL,
    username TEXT NOT NULL,
    components JSONB NOT NULL,
    ai_analysis JSONB,
    ai_model TEXT,
    ai_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`).catch(() => { /* 已存在或竞态 */ });

// ============== GLM 解析 ==============

function buildAnalysisPrompt(comps: ComponentLog[]): string {
  const parts = comps.map(c => `【${c.name}｜${c.desc}】\n${c.lines.slice(0, 12000)}`);
  return parts.join('\n\n');
}

const SYS_ANALYZE = `你是数据中心测试验证平台（Express+PostgreSQL+Docker 部署）的运维排障专家。
下面是平台自身的一次故障日志快照（多组件）。请分析：
1. 错误时间线：按时间顺序列出关键错误/异常（引用日志原文时间戳与关键行）；
2. 异常模式：重启、超时、OOM、5xx 激增、连接耗尽、磁盘/内存压力等；
3. 根因判断：最可能的原因（可多个，按可能性排序，说明依据）；
4. 处置建议：具体可执行的下一步（命令/检查点）；
5. 严重度：高/中/低 + 一句话总体结论。
铁律：只依据给定日志，不得编造不存在的日志行；日志无明显异常就明说"未见明显异常"，不要硬找问题。
输出严格 JSON（无 markdown）：{"severity":"高|中|低","summary":"一句话结论","timeline":[{"time":"","event":""}],"patterns":[""],"root_causes":[{"cause":"","evidence":"","likelihood":"高|中|低"}],"actions":[""]}`;

async function callGLM(apiKey: string, prompt: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 175000);
  try {
    const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'glm-5.2',
        messages: [
          { role: 'system', content: SYS_ANALYZE },
          { role: 'user', content: prompt },
        ],
        thinking: { type: 'enabled' },
        reasoning_effort: 'medium',
        temperature: 1.0,
        max_tokens: 8192,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`GLM HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data: any = await resp.json();
    const raw: string = data.choices?.[0]?.message?.content || '';
    const text = raw.replace(/```(?:json)?/g, '').trim();
    const lo = text.indexOf('{'), hi = text.lastIndexOf('}');
    if (lo < 0 || hi <= lo) throw new Error('AI 未返回 JSON');
    return JSON.parse(text.slice(lo, hi + 1));
  } finally { clearTimeout(timer); }
}

// ============== 路由 ==============

/** POST /api/syslogs/snapshot 一键抓取快照 */
router.post('/snapshot', requireAuth, requireRole(['管理者', '编辑者']), asyncH(async (req, res) => {
  const hours = Math.min(72, Math.max(1, Number(req.body?.hours) || 6));
  const components = await collectComponents(hours);
  if (!components.length) { res.status(500).json({ success: false, message: '未采集到任何组件日志' }); return; }
  const id = `snap-${Date.now().toString(36)}`;
  const title = String(req.body?.title || '').trim().slice(0, 80)
    || `快照 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
  await db.runAsync(
    `INSERT INTO sys_snapshots (id, title, hours, created_by, username, components)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    id, title, hours,
    (req as any).user?.userId ?? '', (req as any).user?.username ?? '',
    JSON.stringify(components)
  );
  // 保留策略：仅保留最近 50 份快照（防编辑者反复抓取撑爆 DB）
  await db.runAsync(
    `DELETE FROM sys_snapshots WHERE id NOT IN (SELECT id FROM sys_snapshots ORDER BY created_at DESC LIMIT 50)`
  ).catch(() => {});
  const rows = await db.allAsync(`SELECT id, title, hours, username, created_at FROM sys_snapshots WHERE id=$1`, id) as any[];
  res.json({ success: true, snapshot: { ...rows[0], componentCount: components.length } });
}));

/** GET /api/syslogs 快照列表 */
router.get('/', requireAuth, asyncH(async (_req, res) => {
  const rows = await db.allAsync(
    `SELECT s.id, s.title, s.hours, s.username, s.created_at, s.ai_at,
            jsonb_array_length(s.components) AS component_count
     FROM sys_snapshots s ORDER BY s.created_at DESC LIMIT 100`) as any[];
  res.json({ success: true, items: rows });
}));

/** GET /api/syslogs/:id 快照详情 */
router.get('/:id', requireAuth, requireRole(['管理者', '编辑者']), asyncH(async (req, res) => {
  const { id } = req.params;
  if (!id.startsWith('snap-') || !validId(id)) { res.status(400).json({ success: false }); return; }
  const rows = await db.allAsync(`SELECT * FROM sys_snapshots WHERE id=$1`, id) as any[];
  if (!rows.length) { res.status(404).json({ success: false, message: '快照不存在' }); return; }
  res.json({ success: true, snapshot: rows[0] });
}));

/** POST /api/syslogs/:id/analyze AI 解析 */
router.post('/:id/analyze', requireAuth, requireRole(['管理者', '编辑者']), asyncH(async (req, res) => {
  const { id } = req.params;
  if (!id.startsWith('snap-') || !validId(id)) { res.status(400).json({ success: false }); return; }
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) { res.status(500).json({ success: false, message: 'ZHIPU_API_KEY 未设置' }); return; }
  const rows = await db.allAsync(`SELECT components FROM sys_snapshots WHERE id=$1`, id) as any[];
  if (!rows.length) { res.status(404).json({ success: false, message: '快照不存在' }); return; }
  const comps = rows[0].components as ComponentLog[];
  const analysis = await callGLM(apiKey, buildAnalysisPrompt(comps));
  await db.runAsync(
    `UPDATE sys_snapshots SET ai_analysis=$2::jsonb, ai_model='glm-5.2', ai_at=now() WHERE id=$1`,
    id, JSON.stringify(analysis)
  );
  res.json({ success: true, analysis });
}));

/** GET /api/syslogs/:id/export 导出快照 JSON */
router.get('/:id/export', requireAuth, requireRole(['管理者', '编辑者']), asyncH(async (req, res) => {
  const { id } = req.params;
  if (!id.startsWith('snap-') || !validId(id)) { res.status(400).json({ success: false }); return; }
  const rows = await db.allAsync(`SELECT * FROM sys_snapshots WHERE id=$1`, id) as any[];
  if (!rows.length) { res.status(404).json({ success: false }); return; }
  res.setHeader('Content-Disposition', `attachment; filename="${id}.json"`);
  res.type('application/json').send(JSON.stringify(rows[0], null, 2));
}));

export default router;
