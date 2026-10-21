/**
 * 只读状态接口（token 鉴权，供外部监控/巡检/机器人探活）
 * GET /api/status?token=xxx 或 Authorization: Bearer xxx
 * 仅聚合只读指标（表计数/库大小/进程健康/当日审计活性），不含敏感数据。
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import db from '../database.js';

const router = Router();
const STATUS_TOKEN = process.env.STATUS_TOKEN || '';

/** 常量时间比较，防时序侧信道 */
function tokenOk(req: Request): boolean {
  const auth = req.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const cand = bearer || String(req.query.token || '');
  if (!STATUS_TOKEN || !cand || cand.length !== STATUS_TOKEN.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(cand), Buffer.from(STATUS_TOKEN));
  } catch {
    return false;
  }
}

router.get('/', async (req, res) => {
  if (!tokenOk(req)) {
    res.status(401).json({ success: false, error: 'invalid token' });
    return;
  }
  const started = Date.now();
  try {
    const tables = ['test_projects', 'team_members', 'historical_projects', 'kb_documents', 'test_docs', 'knowledge_embeddings', 'audit_log'];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const r = await db.getAsync(`SELECT COUNT(*)::int AS c FROM ${t}`);
        counts[t] = (r?.c as number) ?? -1;
      } catch { counts[t] = -1; }
    }
    const dbSize = await db.getAsync(`SELECT pg_database_size(current_database())::bigint AS s`);
    const auditToday = await db.getAsync(
      `SELECT COUNT(*)::int AS c FROM audit_log WHERE created_at >= date_trunc('day', now())`
    );
    const mem = process.memoryUsage();
    res.json({
      success: true,
      status: 'ok',
      server_time: new Date().toISOString(),
      db: {
        connected: true,
        size_mb: Math.round(Number(dbSize?.s ?? 0) / 1048576),
        tables: counts,
      },
      process: {
        uptime_hours: +(process.uptime() / 3600).toFixed(1),
        rss_mb: Math.round(mem.rss / 1048576),
        node: process.version,
      },
      activity: { audit_entries_today: auditToday?.c ?? -1 },
      latency_ms: Date.now() - started,
    });
  } catch (err: any) {
    res.status(503).json({ success: false, status: 'error', error: err?.message || 'status check failed' });
  }
});

export default router;
