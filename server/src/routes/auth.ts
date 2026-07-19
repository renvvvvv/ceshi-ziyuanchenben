import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import db from '../database.js';

const router = Router();

// ============================================================
// 会话 token 存储（内存 Map；生产环境可换 Redis / PG session 表）
// ============================================================
interface SessionData {
  userId: string;
  username: string;
  role: '管理者' | '编辑者' | '阅读者';
  expiresAt: number;
}
const sessions = new Map<string, SessionData>();

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
    res.status(401).json({ success: false, error: '未登录或会话已过期' });
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
      res.status(401).json({ success: false, error: '未登录' });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ success: false, error: `权限不足，需要角色：${roles.join('/')}` });
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
  if (token) sessions.delete(token);
  res.clearCookie('session_token');
  res.json({ success: true });
}));

// ============================================================
// GET /api/auth/me — 查询当前登录用户
// ============================================================
router.get('/me', requireAuth, (req, res) => {
  const user = (req as any).user;
  res.json({ success: true, user });
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