import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import resourceCalcRouter from './routes/resourceCalc.js';
import projectsRouter from './routes/projects.js';
import authRouter from './routes/auth.js';
import reportReviewRouter from './routes/reportReview.js';
import { initDatabase } from './database.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/resource-calc', resourceCalcRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/auth', authRouter);
app.use('/api/report-review', reportReviewRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
