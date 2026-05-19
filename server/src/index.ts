import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import resourceCalcRouter from './routes/resourceCalc.js';
import projectsRouter from './routes/projects.js';
import { initDatabase } from './database.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/resource-calc', resourceCalcRouter);
app.use('/api/projects', projectsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
