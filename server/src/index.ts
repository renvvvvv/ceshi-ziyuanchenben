import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import resourceCalcRouter from './routes/resourceCalc.js';
import projectsRouter from './routes/projects.js';
import reportReviewRouter from './routes/reportReview.js';
import authRouter, { authMiddleware } from './routes/auth.js';
import kbRouter from './routes/kb.js';
import kbQARouter from './routes/kbQA.js';
import testDocsRouter from './routes/testDocs.js';
import attendanceRouter from './routes/attendance.js';
import { initDatabase } from './database.js';
import db from './database.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// CORS 白名单：只允许配置的源（默认同源），避免任意网站带 cookie 调接口
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOptions: cors.CorsOptions = {
  credentials: true,
  origin(origin, cb) {
    // 同源请求（无 Origin 头）或 Postman 等工具（无 Origin）放行
    if (!origin) return cb(null, true);
    // 未配置白名单 → 同源放行
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
};
app.use(cors(corsOptions)); // credentials:true 让 cookie 跨域带上
app.use(express.json({ limit: '10mb' })); // 报告审核支持超长文档（~200万字），nginx 已允许 20mb

// 解析 session token（所有请求都会跑；只是把 user 挂到 req 上，不强制要求登录）
app.use(authMiddleware);

app.use('/api/auth', authRouter);
app.use('/api/resource-calc', resourceCalcRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/report-review', reportReviewRouter);
app.use('/api/kb', kbRouter);
app.use('/api/kb/qa', kbQARouter);
app.use('/api/test-docs', testDocsRouter);
app.use('/api/attendance-adjustments', attendanceRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 深度健康检查：所有表行数 + 最近修改时间（用于防回归监控）
app.get('/api/health/deep', async (_req, res) => {
  try {
    const tables = [
      'test_projects',
      'team_members',
      'historical_projects',
      'resource_calc_history',
      'kb_documents',
      'attendance_adjustments',
      'learned_corrections',
      'users',
      'sessions',
    ];
    const results: Array<{ table: string; rowCount: number; lastModified: string | null }> = [];
    for (const table of tables) {
      try {
        const row = await db.getAsync(
          `SELECT COUNT(*)::int AS count FROM ${table}`
        );
        const count = (row?.count as number) ?? 0;
        let lastMod: string | null = null;
        // 尝试查 updated_at 或 created_at 列
        try {
          const mod = await db.getAsync(
            `SELECT MAX(updated_at)::text AS last FROM ${table}`
          );
          lastMod = (mod?.last as string) || null;
        } catch {
          try {
            const mod = await db.getAsync(
              `SELECT MAX(created_at)::text AS last FROM ${table}`
            );
            lastMod = (mod?.last as string) || null;
          } catch {
            // 表无时间列
          }
        }
        results.push({ table, rowCount: count, lastModified: lastMod });
      } catch {
        results.push({ table, rowCount: -1, lastModified: null });
      }
    }
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: results,
    });
  } catch (err: any) {
    res.status(500).json({
      status: 'error',
      error: err?.message || 'Deep health check failed',
    });
  }
});

// ============================================================
// 全局错误处理 middleware（必须 4 参数，否则 Express 不识别）
// 捕获所有路由漏出来的异常，统一返回 JSON（避免前端 fetch 拿到 HTML）
// ============================================================
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] Unhandled error:', err);
  // PG 错误码 → 友好状态码
  if (err?.code === '23505') {
    res.status(409).json({ success: false, error: '数据已存在（唯一约束冲突）' });
    return;
  }
  if (err?.code === '23503') {
    res.status(409).json({ success: false, error: '存在外键引用，无法操作' });
    return;
  }
  if (err?.code === '22P02' || err?.code === '23502') {
    res.status(400).json({ success: false, error: '参数类型错误或必填字段缺失' });
    return;
  }
  if (err?.code?.startsWith?.('23')) {
    res.status(409).json({ success: false, error: '数据完整性约束违反' });
    return;
  }
  res.status(500).json({
    success: false,
    error: err?.message || 'Internal Server Error',
  });
});

// 404 fallback：所有未匹配的 /api/* 返回 JSON 而非 HTML
app.use('/api/*', (_req, res) => {
  res.status(404).json({ success: false, error: 'API 端点不存在' });
});

// 等待数据库初始化后启动
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`[Server] Data Center Test Platform API running on http://localhost:${PORT}`);
    console.log(`[Server] MiniMax API Key: ${process.env.MINIMAX_API_KEY ? '✓ configured' : '✗ not set'}`);
  });
}).catch(err => {
  console.error('[Server] Failed to init database:', err);
  process.exit(1);
});
