/**
 * 图纸路由管线模块（上传 DWG → 宿主机自动转换捋路由 → 可视化/导出）
 *
 * 架构：容器后端只负责上传存储、任务登记与状态读取；工具链（ODA/python）
 * 由宿主机 drawing-runner（systemd）执行，双方经共享目录 uploads/drawing 交换：
 *   容器写 <job>/JOB + inbox/ 原始文件 → runner 写 <job>/STATUS + out/ 产物。
 * 后端不依赖任何外部二进制，状态实时透传给前端轮询。
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '..', '..', '..', 'uploads', 'drawing');

const asyncH = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };

// 建表（幂等）
db.exec(`
  CREATE TABLE IF NOT EXISTS drawing_jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    file_count INTEGER NOT NULL DEFAULT 0,
    dwg_count INTEGER,
    created_by TEXT NOT NULL,
    username TEXT NOT NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
  )
`).catch(() => { /* 表已存在或启动竞态，忽略 */ });

// multer：原始上传存 inbox（解压由宿主机 runner 负责，容器零依赖）
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const id = (req as any).__drawingJobId as string;
    cb(null, join(BASE, id, 'inbox'));
  },
  filename: (_req, file, cb) => {
    // 中文名保留（图纸目录结构有语义），仅去掉路径分隔
    cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[/\\]/g, '_'));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 600 * 1024 * 1024, files: 120 },
  fileFilter: (_req, file, cb) => {
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').toLowerCase();
    cb(null, /\.(dwg|zip|rar|xlsx)$/.test(name));
  },
});

/** 读 runner 状态文件（可能不存在） */
function readStatus(id: string): any | null {
  try { return JSON.parse(readFileSync(join(BASE, id, 'STATUS'), 'utf8')); } catch { return null; }
}

/** 把 STATUS 同步回 DB 行（列表页免逐文件读） */
function syncStatus(id: string): Promise<unknown> {
  const st = readStatus(id);
  if (!st) return Promise.resolve();
  const map: Record<string, string> = { done: 'done', error: 'error' };
  const dbStatus = st.stage in map ? map[st.stage] : 'running';
  return db.runAsync(
    `UPDATE drawing_jobs SET status=$1, error=$2, dwg_count = COALESCE($4::int, dwg_count),
       finished_at = CASE WHEN $1 IN ('done','error') THEN now() ELSE finished_at END
     WHERE id = $3 AND (status <> $1 OR ($4::int IS NOT NULL AND dwg_count IS NULL))`,
    dbStatus, st.stage === 'error' ? st.detail : null, id, st.n_dwgs ?? null
  ).catch((e) => { console.warn('[drawing] syncStatus 失败:', id, e.message); });
}

/** 任务 id 合法性（时间戳36进制-随机段；同时挡住路径穿越） */
const ID_RE = /^[a-z0-9-]+$/;
function validId(id: string): boolean { return ID_RE.test(id) && id.length >= 6 && id.length <= 64; }

/**
 * POST /api/drawing/upload  上传图纸（zip/rar 整包 或 多个 DWG；可选蓄电池配置 xlsx）
 * body: title（路由表标题）
 */
router.post('/upload', requireAuth, requireRole(['管理者', '编辑者']), (req, res, next) => {
  const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  (req as any).__drawingJobId = id;
  mkdirSync(join(BASE, id, 'inbox'), { recursive: true });
  upload.array('files')(req, res, (err: any) => {
    if (err) { res.status(400).json({ success: false, message: `上传失败：${err.message}` }); return; }
    next();
  });
}, asyncH(async (req, res) => {
  const id = (req as any).__drawingJobId as string;
  const files = (req as any).files as Express.Multer.File[];
  const title = (String(req.body.title || '').trim() || '测试界面路由表（平台生成）V1.0');
  if (!files?.length) {
    res.status(400).json({ success: false, message: '未收到任何文件（支持 .dwg / .zip / .rar，可选 .xlsx 电池配置）' });
    return;
  }
  const battery = files.find(f => f.originalname.toLowerCase().endsWith('.xlsx'))?.filename;
  const pairs = String(req.body.pairs || '').trim() || null;
  const floors = String(req.body.floors || '').trim() || null;
  writeFileSync(join(BASE, id, 'JOB'), JSON.stringify({ id, title, battery, pairs, floors }));
  await db.runAsync(
    `INSERT INTO drawing_jobs (id, title, status, file_count, created_by, username)
     VALUES ($1,$2,'queued',$3,$4,$5)`,
    id, title, files.length,
    (req as any).user?.id ?? '',
    (req as any).user?.username ?? (req as any).user?.name ?? ''
  );
  res.json({ success: true, jobId: id, fileCount: files.length });
}));

/** GET /api/drawing/jobs  任务记录列表（状态与 runner 实时同步） */
router.get('/jobs', requireAuth, asyncH(async (_req, res) => {
  const rows = await db.allAsync(
    `SELECT id, title, status, file_count, dwg_count, username, error, created_at, finished_at
     FROM drawing_jobs ORDER BY created_at DESC LIMIT 100`
  ) as any[];
  await Promise.all(rows.map((r: any) => syncStatus(r.id)));
  const fresh = await db.allAsync(
    `SELECT id, title, status, file_count, dwg_count, username, error, created_at, finished_at
     FROM drawing_jobs ORDER BY created_at DESC LIMIT 100`
  ) as any[];
  // 附加实时阶段/详情（列表页进度条用）
  const items = fresh.map((r: any) => {
    const st = readStatus(r.id);
    return { ...r, stage: st?.stage ?? null, detail: st?.detail ?? null };
  });
  res.json({ success: true, items });
}));

/** GET /api/drawing/jobs/:id  任务详情（状态+日志尾+报告+sheet 索引） */
router.get('/jobs/:id', requireAuth, asyncH(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).json({ success: false, message: '非法任务 id' }); return; }
  const rows = await db.allAsync(`SELECT * FROM drawing_jobs WHERE id=$1`, id) as any[];
  if (!rows.length) { res.status(404).json({ success: false, message: '任务不存在' }); return; }
  await syncStatus(id);
  const fresh = await db.allAsync(`SELECT * FROM drawing_jobs WHERE id=$1`, id) as any[];
  const st = readStatus(id);
  let sheetsIndex: any[] = [];
  let report: any = null;
  let validate = '';
  const outDir = join(BASE, id, 'out');
  try { sheetsIndex = JSON.parse(readFileSync(join(outDir, 'sheets', 'index.json'), 'utf8')); } catch {}
  try { report = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')); } catch {}
  try { validate = readFileSync(join(outDir, 'validate.txt'), 'utf8'); } catch {}
  res.json({ success: true, job: fresh[0], status: st, report, validate, sheetsIndex });
}));

/** GET /api/drawing/jobs/:id/sheet?file=xxx.json  单个 sheet 数据（可视化表格） */
router.get('/jobs/:id/sheet', requireAuth, asyncH(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).json({ success: false }); return; }
  const file = String(req.query.file || '').replace(/[/\\]/g, '');
  if (!/^[^/\\]+\.json$/.test(file)) { res.status(400).json({ success: false }); return; }
  try {
    const data = JSON.parse(readFileSync(join(BASE, id, 'out', 'sheets', file), 'utf8'));
    res.json({ success: true, sheet: data });
  } catch { res.status(404).json({ success: false, message: 'sheet 不存在' }); }
}));

/** GET /api/drawing/jobs/:id/export  一键导出成品 Excel */
router.get('/jobs/:id/export', requireAuth, asyncH(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).json({ success: false, message: '非法任务 id' }); return; }
  const xlsx = join(BASE, id, 'out', '路由表.xlsx');
  if (!existsSync(xlsx)) { res.status(404).json({ success: false, message: '成品尚未生成' }); return; }
  const rows = await db.allAsync(`SELECT title FROM drawing_jobs WHERE id=$1`, id) as any[];
  res.download(xlsx, `${(rows[0]?.title || '路由表').replace(/[\\/:*?"<>|]/g, '_')}.xlsx`);
}));

/** GET /api/drawing/jobs/:id/log  完整管线日志（排障用） */
router.get('/jobs/:id/log', requireAuth, asyncH(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).send('非法任务 id'); return; }
  try {
    res.type('text/plain').send(readFileSync(join(BASE, id, 'out', 'pipeline.log'), 'utf8'));
  } catch { res.status(404).send('暂无日志'); }
}));

/** DELETE /api/drawing/jobs/:id  删除任务及全部文件（仅管理者） */
router.delete('/jobs/:id', requireAuth, requireRole(['管理者']), asyncH(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).json({ success: false, message: '非法任务 id' }); return; }
  const cur = await db.allAsync(`SELECT status FROM drawing_jobs WHERE id=$1`, id) as any[];
  if (cur[0] && ['queued', 'running'].includes(cur[0].status)) {
    res.status(400).json({ success: false, message: '任务正在运行，请等待完成后再删除' });
    return;
  }
  await db.runAsync(`DELETE FROM drawing_jobs WHERE id=$1`, id);
  try { rmSync(join(BASE, id), { recursive: true, force: true }); } catch {}
  res.json({ success: true });
}));

export default router;
