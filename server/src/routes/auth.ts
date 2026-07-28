import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../database.js';

const router = Router();

// ============================================================
// 飞书 OAuth 配置（从环境变量读取）
// ============================================================
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const FEISHU_REDIRECT_URI = process.env.FEISHU_REDIRECT_URI || '';  // e.g. http://49.232.147.149/api/auth/feishu/callback
// 未匹配部门规则时的默认角色
const FEISHU_DEFAULT_ROLE: SessionData['role'] = (process.env.FEISHU_DEFAULT_ROLE as SessionData['role']) || '阅读者';
// 前端首页地址（OAuth 完成后 302 回前端带 query）
const FRONTEND_HOME = process.env.FRONTEND_HOME || '/';
// 部门-角色映射规则：JSON 字符串 [{"department":"管理层","role":"管理者"},{"department":"测试部","role":"编辑者"}]
// 部门名用 includes 匹配（部分匹配）
const FEISHU_DEPT_ROLE_MAP: Array<{ department: string; role: SessionData['role'] }> = (() => {
  try {
    const raw = process.env.FEISHU_DEPT_ROLE_MAP || '[]';
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
})();

// 飞书 OAuth 是否已配置完整
const FEISHU_ENABLED = !!(FEISHU_APP_ID && FEISHU_APP_SECRET && FEISHU_REDIRECT_URI);

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
// 支持两类用户：
//   - 账密用户（username 不带 feishu: 前缀）→ 从 PRESET_USERS 查
//   - 飞书用户（username 带 feishu: 前缀）→ 从 feishuUsers Map 查
// ============================================================
router.get('/me', requireAuth, (req, res) => {
  const user = (req as any).user;
  const isFeishu = user.username.startsWith('feishu:');
  if (isFeishu) {
    const openId = user.username.slice('feishu:'.length);
    const record = feishuUsers.get(openId);
    res.json({
      success: true,
      user: {
        id: user.userId,
        userId: user.userId,
        username: user.username,
        name: record?.name || '飞书用户',
        role: user.role,
        deptNames: record?.deptNames || [],
        loginType: 'feishu',
      },
    });
    return;
  }
  const preset = PRESET_USERS[user.username];
  res.json({
    success: true,
    user: {
      id: user.userId,
      userId: user.userId,
      username: user.username,
      name: preset?.name || user.username,
      role: user.role,
      loginType: 'password',
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

// ============================================================
// 部门名称 → 系统角色 映射（按 FEISHU_DEPT_ROLE_MAP 规则）
// 匹配方式：部门名 includes 规则字段（部分匹配，大小写不敏感）
// 未命中任何规则 → 返回 FEISHU_DEFAULT_ROLE
// ============================================================
function mapDeptToRole(deptNames: string[]): SessionData['role'] {
  const ALLOWED: SessionData['role'][] = ['管理者', '编辑者', '阅读者'];
  for (const dept of deptNames) {
    const lower = (dept || '').toLowerCase();
    for (const rule of FEISHU_DEPT_ROLE_MAP) {
      if (rule.department && lower.includes(rule.department.toLowerCase())) {
        return ALLOWED.includes(rule.role) ? rule.role : FEISHU_DEFAULT_ROLE;
      }
    }
  }
  return FEISHU_DEFAULT_ROLE;
}

// ============================================================
// 飞书 OAuth - 工具函数
// ============================================================
interface FeishuUserInfo {
  openId: string;       // 用户在应用下的唯一标识
  unionId?: string;     // 用户在开发者下的唯一标识
  userId?: string;      // 员工工号（需要 contact:user.employee 权限）
  name: string;
  email?: string;
  avatarUrl?: string;
  deptIds?: string[];
  deptNames?: string[];
}

// 获取 app_access_token（企业自建应用）
async function getAppAccessToken(): Promise<string> {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    }),
  });
  const data: any = await res.json();
  if (data.code !== 0) {
    throw new Error(`飞书 app_access_token 获取失败: ${data.code} ${data.msg}`);
  }
  return data.app_access_token;
}

// 用授权码换 user_access_token
async function getUserAccessToken(code: string): Promise<{ userAccessToken: string; refreshToken: string }> {
  const res = await fetch('https://open.feishu.cn/open-apis/authen/v1/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
    }),
  });
  const data: any = await res.json();
  // 飞书这接口的响应里 code=0 表示成功
  if (data.code !== 0) {
    throw new Error(`飞书 user_access_token 获取失败: ${data.code} ${data.msg}`);
  }
  return {
    userAccessToken: data.data.access_token,
    refreshToken: data.data.refresh_token,
  };
}

// 拉取用户基本信息（姓名、头像、open_id、union_id）
async function getUserInfo(userAccessToken: string): Promise<any> {
  const res = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    headers: { Authorization: `Bearer ${userAccessToken}` },
  });
  const data: any = await res.json();
  if (data.code !== 0) {
    throw new Error(`飞书获取用户信息失败: ${data.code} ${data.msg}`);
  }
  return data.data;
}

// 用 app_access_token + open_id 拉取员工部门信息（需要 contact:user.employee 权限）
async function getEmployeeDept(appAccessToken: string, openId: string): Promise<{ deptIds: string[]; deptNames: string[]; userId?: string }> {
  try {
    const url = `https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id&department_id_type=open_department_id`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${appAccessToken}` },
    });
    const data: any = await res.json();
    if (data.code !== 0) {
      // 部门信息拉取失败不致命，继续走（用默认角色）
      console.warn('[Feishu] 拉取员工部门信息失败（不影响登录）:', data.code, data.msg);
      return { deptIds: [], deptNames: [] };
    }
    const user = data.data?.user || {};
    const deptIds: string[] = user.department_ids || [];
    const userId = user.user_id;  // 员工工号
    // 部门 id → 部门名（批量查询）
    const deptNames: string[] = [];
    for (const deptId of deptIds) {
      try {
        const deptRes = await fetch(
          `https://open.feishu.cn/open-apis/contact/v3/departments/${deptId}?department_id_type=open_department_id`,
          { headers: { Authorization: `Bearer ${appAccessToken}` } }
        );
        const deptData: any = await deptRes.json();
        if (deptData.code === 0 && deptData.data?.department?.name) {
          deptNames.push(deptData.data.department.name);
        }
      } catch {
        // 单个部门查询失败忽略
      }
    }
    return { deptIds, deptNames, userId };
  } catch (err) {
    console.warn('[Feishu] 拉取部门信息异常（不影响登录）:', err);
    return { deptIds: [], deptNames: [] };
  }
}

// 飞书用户缓存：open_id → {userId, name, role, deptNames}
// 后续可改成数据库表，这里先用内存 Map + 持久化到 data/feishu-users.json
interface FeishuUserRecord {
  openId: string;
  unionId?: string;
  userId?: string;   // 员工工号（如有）
  name: string;
  email?: string;
  role: SessionData['role'];
  deptNames: string[];
  lastLoginAt: string;
}

const FEISHU_USERS_FILE = path.resolve(process.cwd(), 'data', 'feishu-users.json');
const feishuUsers = new Map<string, FeishuUserRecord>();

// 启动时加载
try {
  if (fs.existsSync(FEISHU_USERS_FILE)) {
    const data = JSON.parse(fs.readFileSync(FEISHU_USERS_FILE, 'utf-8'));
    if (Array.isArray(data)) {
      for (const rec of data) {
        if (rec.openId) feishuUsers.set(rec.openId, rec);
      }
      console.log(`[Auth] 加载 ${feishuUsers.size} 个飞书用户`);
    }
  }
} catch (err) {
  console.warn('[Auth] 加载 feishu-users.json 失败：', err);
}

function persistFeishuUsers() {
  try {
    const arr = Array.from(feishuUsers.values());
    const tmpFile = FEISHU_USERS_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(arr, null, 2), 'utf-8');
    fs.renameSync(tmpFile, FEISHU_USERS_FILE);
  } catch (err) {
    console.warn('[Auth] 保存 feishu-users.json 失败：', err);
  }
}

// ============================================================
// GET /api/auth/feishu/login — 生成飞书授权 URL 并 302 跳转
// 前端直接访问此 URL，浏览器整体跳转到飞书授权页
// ============================================================
router.get('/feishu/login', (_req, res) => {
  if (!FEISHU_ENABLED) {
    return res.status(503).json({
      success: false,
      error: '飞书登录未配置（缺少 FEISHU_APP_ID / APP_SECRET / REDIRECT_URI）',
    });
  }
  const state = crypto.randomBytes(16).toString('hex');
  const url = `https://open.feishu.cn/open-apis/authen/v1/index?app_id=${FEISHU_APP_ID}` +
              `&redirect_uri=${encodeURIComponent(FEISHU_REDIRECT_URI)}` +
              `&state=${state}`;
  // 简单实现：state 不存（自建应用 redirect_uri 已固定，state 校验优先级低）
  res.redirect(url);
});

// ============================================================
// GET /api/auth/feishu/callback — 飞书回调
// 1. 用 code 换 user_access_token
// 2. 拉用户信息（姓名/open_id/union_id）
// 3. 用 app_access_token 拉员工部门信息
// 4. 按部门规则映射系统角色
// 5. 建本地 session（与账密登录共用 sessions Map）
// 6. 302 回前端，带 ?feishu=success
// 失败：302 回前端 ?feishu=error&msg=...
// ============================================================
router.get('/feishu/callback', asyncHandler(async (req, res) => {
  if (!FEISHU_ENABLED) {
    return res.redirect(`${FRONTEND_HOME}?feishu=error&msg=${encodeURIComponent('飞书登录未配置')}`);
  }
  const code = req.query.code as string | undefined;
  if (!code) {
    return res.redirect(`${FRONTEND_HOME}?feishu=error&msg=${encodeURIComponent('缺少 code 参数')}`);
  }
  try {
    // 1. 换 user_access_token
    const { userAccessToken } = await getUserAccessToken(code);

    // 2. 拉用户基本信息
    const info = await getUserInfo(userAccessToken);
    const openId = info.open_id;
    const unionId = info.union_id;
    const name = info.name || info.en_name || '飞书用户';

    if (!openId) {
      return res.redirect(`${FRONTEND_HOME}?feishu=error&msg=${encodeURIComponent('飞书未返回 open_id')}`);
    }

    // 3. 拉员工部门信息（失败不阻断登录）
    const appAccessToken = await getAppAccessToken();
    const empDept = await getEmployeeDept(appAccessToken, openId);

    // 4. 部门 → 角色映射
    const role = mapDeptToRole(empDept.deptNames);

    // 5. 缓存飞书用户记录（用于后续展示/管理）
    const record: FeishuUserRecord = {
      openId,
      unionId,
      userId: empDept.userId,
      name,
      email: info.email,
      role,
      deptNames: empDept.deptNames,
      lastLoginAt: new Date().toISOString(),
    };
    feishuUsers.set(openId, record);
    persistFeishuUsers();

    // 6. 建 session（复用现有 sessions Map）
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(token, {
      userId: empDept.userId || openId,   // 优先用工号，否则用 open_id
      username: `feishu:${openId}`,       // 加前缀区分账密用户
      role,
      expiresAt,
    });
    persistSessions();

    res.cookie('session_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });

    // 302 回前端首页，前端 AuthContext 会自动调 /api/auth/me 拉用户信息
    res.redirect(`${FRONTEND_HOME}?feishu=success`);
  } catch (err: any) {
    console.error('[Feishu OAuth] 回调失败:', err);
    const msg = encodeURIComponent(err?.message || '飞书登录失败');
    res.redirect(`${FRONTEND_HOME}?feishu=error&msg=${msg}`);
  }
}));

// ============================================================
// GET /api/auth/feishu/status — 前端查询飞书登录是否可用
// ============================================================
router.get('/feishu/status', (_req, res) => {
  res.json({
    success: true,
    enabled: FEISHU_ENABLED,
    defaultRole: FEISHU_DEFAULT_ROLE,
    deptRules: FEISHU_DEPT_ROLE_MAP,
  });
});

// ============================================================
// GET /api/auth/feishu/users — 列出已登录过的飞书用户（管理者可见）
// ============================================================
router.get('/feishu/users', requireAuth, requireRole(['管理者']), (_req, res) => {
  const users = Array.from(feishuUsers.values()).map(u => ({
    openId: u.openId,
    name: u.name,
    email: u.email,
    role: u.role,
    deptNames: u.deptNames,
    lastLoginAt: u.lastLoginAt,
  }));
  res.json({ success: true, users });
});

export default router;