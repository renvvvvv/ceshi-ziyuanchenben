import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../database.js';

const router = Router();

// ============================================================
// 会话 token 存储（持久化到文件，backend 重启不丢）
// ============================================================
interface SessionData {
  userId: string;
  username: string;
  role: '管理者' | '编辑者' | '阅读者';
  expiresAt: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 注意：__dirname 在 ESM 编译后是 /app/dist/src/routes
// 用 process.cwd()（= /app）作为基准，避免路径错位
const SESSIONS_FILE = path.resolve(process.cwd(), 'data', 'sessions.json');

// 启动时从文件加载 sessions
const sessions = new Map<string, SessionData>();
try {
  if (fs.existsSync(SESSIONS_FILE)) {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
    for (const [token, session] of Object.entries(data || {})) {
      if ((session as SessionData).expiresAt > Date.now()) {
        sessions.set(token, session as SessionData);
      }
    }
    console.log(`[Auth] 加载 ${sessions.size} 个有效 session`);
  }
} catch (err) {
  console.warn('[Auth] 加载 sessions.json 失败：', err);
}

// 持久化到文件（debounce 避免频繁写）
let persistTimer: NodeJS.Timeout | null = null;
function persistSessions() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const obj: Record<string, SessionData> = {};
      for (const [token, session] of sessions.entries()) {
        obj[token] = session;
      }
      // 原子写入：先写 .tmp 再 rename（防止写到一半崩溃导致文件损坏）
      const tmpFile = SESSIONS_FILE + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(obj, null, 2), 'utf-8');
      fs.renameSync(tmpFile, SESSIONS_FILE);
    } catch (err) {
      console.warn('[Auth] 保存 sessions.json 失败：', err);
    }
  }, 100);
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

// 预设账号（与前端 AuthContext.tsx 的 PRESET_USERS 一致）
const PRESET_USERS: Record<string, { password: string; userId: string; name: string; role: SessionData['role'] }> = {
  admin:  { password: 'admin123',  userId: 'u1', name: '管理员', role: '管理者' },
  editor: { password: 'editor123', userId: 'u2', name: '编辑者', role: '编辑者' },
  reader: { password: 'reader123', userId: 'u3', name: '阅读者', role: '阅读者' },
};

// 定期清理过期 session（每 1 小时）
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of sessions.entries()) {
    if (data.expiresAt < now) sessions.delete(token);
  }
}, 60 * 60 * 1000);

// ============================================================
// 异步错误处理包装器
// ============================================================
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ============================================================
// 工具：从 cookie 或 Authorization header 提取 token
// ============================================================
function extractToken(req: Request): string | null {
  // 1. cookie 优先
  const cookies = (req.headers.cookie || '').split(';');
  for (const c of cookies) {
    const [k, v] = c.trim().split('=');
    if (k === 'session_token' && v) return decodeURIComponent(v);
  }
  // 2. Authorization: Bearer xxx
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

// ============================================================
// authMiddleware：解析 token，写入 req.user
// 不强制要求登录（GET 请求可放行；POST/PUT/DELETE 单独用 requireAuth）
// ============================================================
export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    const session = sessions.get(token);
    if (session && session.expiresAt > Date.now()) {
      (req as any).user = {
        userId: session.userId,
        username: session.username,
        role: session.role,
      };
    }
  }
  next();
}

// ============================================================
// requireAuth：强制要求登录
// ============================================================
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).user) {
    const message = '未登录或会话已过期';
    res.status(401).json({ success: false, error: message, message });
    return;
  }
  next();
}

// ============================================================
// requireRole：要求特定角色（管理者才能做删除等敏感操作）
// ============================================================
export function requireRole(roles: SessionData['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      const message = '未登录';
      res.status(401).json({ success: false, error: message, message });
      return;
    }
    if (!roles.includes(user.role)) {
      const message = `权限不足，需要角色：${roles.join('/')}`;
      res.status(403).json({ success: false, error: message, message });
      return;
    }
    next();
  };
}

// ============================================================
// POST /api/auth/login — 账号密码登录，颁发 token
// ============================================================
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ success: false, error: '账号和密码必填' });
    return;
  }
  const preset = PRESET_USERS[username];
  if (!preset || preset.password !== password) {
    res.status(401).json({ success: false, error: '账号或密码错误' });
    return;
  }
  // 生成 session token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, {
    userId: preset.userId,
    username,
    role: preset.role,
    expiresAt,
  });
  persistSessions();  // 登录后立即持久化（避免重启丢登录态）
  // 同时设置 httpOnly cookie（防 XSS，path=/ 让所有 /api/* 路由都能用）
  res.cookie('session_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
  res.json({
    success: true,
    token,
    expiresAt,
    user: { id: preset.userId, username, name: preset.name, role: preset.role },
  });
}));

// ============================================================
// POST /api/auth/logout — 登出，清除 token
// ============================================================
router.post('/logout', asyncHandler(async (req, res) => {
  const token = extractToken(req);
  if (token) {
    sessions.delete(token);
    persistSessions();
  }
  res.clearCookie('session_token');
  res.json({ success: true });
}));

// ============================================================
// GET /api/auth/me — 查询当前登录用户
// ============================================================
router.get('/me', requireAuth, (req, res) => {
  const user = (req as any).user;
  const preset = PRESET_USERS[user.username];
  res.json({
    success: true,
    user: {
      id: user.userId,
      userId: user.userId,
      username: user.username,
      name: preset?.name || user.username,
      role: user.role,
    },
  });
});

// ============================================================
// GET /api/auth/users — 列出可用账号（方便前端初始化）
// ============================================================
router.get('/users', (_req, res) => {
  res.json({
    success: true,
    users: Object.entries(PRESET_USERS).map(([username, info]) => ({
      username,
      name: info.name,
      role: info.role,
    })),
  });
});

export default router;