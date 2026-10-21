/**
 * 只读状态接口（token 鉴权，供外部监控/巡检/机器人探活）
 * GET /api/status?token=xxx 或 Authorization: Bearer xxx
 * 仅聚合只读指标（表计数/库大小/进程健康/当日审计活性），不含敏感数据。
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import db from '../database.js';
import { getTrackingSnapshot } from './tracking.js';

const require_ = createRequire(import.meta.url);
const VERSION = require_('../../../package.json').version as string;

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
    // 在线会话（data/sessions.json 中未过期的 distinct 用户）
    let onlineSessions = 0;
    try {
      const raw = JSON.parse(readFileSync('data/sessions.json', 'utf8')) as Record<string, { expiresAt?: number; username?: string }>;
      const alive = new Set<string>();
      for (const s of Object.values(raw)) {
        if (s?.expiresAt && s.expiresAt > Date.now() && s.username) alive.add(s.username);
      }
      onlineSessions = alive.size;
    } catch { /* 文件缺失忽略 */ }

    // 最近审计详情（默认 10 条）
    const auditRows = await db.allAsync(
      `SELECT created_at, username, action, target_type, target_name, detail
       FROM audit_log ORDER BY id DESC LIMIT 10`) as any[];

    const mem = process.memoryUsage();
    const track = getTrackingSnapshot();
    res.json({
      success: true,
      status: 'ok',
      server_time: new Date().toISOString(),
      version: VERSION,
      started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      users: {
        online_sessions: onlineSessions,
        active_5min: track.users.active_5min,
        active_today: Math.max(track.users.active_today_tracked, new Set(auditRows.map(r => r.username)).size),
      },
      audit_recent: auditRows.map(r => ({
        time: r.created_at, user: r.username, action: r.action,
        target: `${r.target_type} ${r.target_name || ''}`.trim(),
        detail: r.detail ? JSON.parse(r.detail) : null,
      })),
      modules_today: track.modules_today,
      issues: track.issues,
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
      audit_entries_today: auditToday?.c ?? -1,
      latency_ms: Date.now() - started,
    });
  } catch (err: any) {
    res.status(503).json({ success: false, status: 'error', error: err?.message || 'status check failed' });
  }
});

export default router;
