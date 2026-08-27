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

// 是否拉取员工部门信息（需要 contact:user.employee + contact:department.base 权限）
// 权限未开通时设为 false：跳过部门查询，所有飞书用户用 FEISHU_DEFAULT_ROLE
// 权限开通后设为 true：恢复按部门映射角色
const FEISHU_FETCH_DEPT = String(process.env.FEISHU_FETCH_DEPT || 'false').toLowerCase() === 'true';

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
// 持久化失败降级标记：写失败一次后不再重复尝试（避免日志刷屏），降级为内存模式
let persistSessionsFailed = false;

function persistSessions() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (persistSessionsFailed) return; // 已降级，不再尝试
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
      persistSessionsFailed = true;
      console.warn('[Auth] 保存 sessions.json 失败，降级为内存模式（重启会丢登录态，需修复 data 目录权限）：', (err as Error).message);
    }
  }, 100);
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

// ============================================================
// 账密用户：可持久化到 data/local-users.json（支持管理员手动新增/编辑）
// 首次启动若文件不存在，用 3 个 seed 账号初始化（保留与原 PRESET_USERS 兼容）
// ============================================================
interface LocalUserRecord {
  username: string;
  password: string;
  userId: string;
  name: string;
  role: SessionData['role'];            // 默认角色
  manualRole?: SessionData['role'];      // 管理员手动覆盖的角色
  manualPerms?: ModulePermission[];      // 管理员按账号单独覆盖的模块权限
  active: boolean;                       // 是否启用（false=禁用登录）
  createdAt: string;
}

const LOCAL_USERS_FILE = path.resolve(process.cwd(), 'data', 'local-users.json');
const localUsers: Record<string, LocalUserRecord> = {};

// seed 数据（仅首次创建时用）
const SEED_LOCAL_USERS: LocalUserRecord[] = [
  { username: 'admin',  password: 'admin123',  userId: 'u1', name: '管理员', role: '管理者', active: true, createdAt: new Date().toISOString() },
  { username: 'editor', password: 'editor123', userId: 'u2', name: '编辑者', role: '编辑者', active: true, createdAt: new Date().toISOString() },
  { username: 'reader', password: 'reader123', userId: 'u3', name: '阅读者', role: '阅读者', active: true, createdAt: new Date().toISOString() },
];

function persistLocalUsers() {
  try {
    const arr = Object.values(localUsers);
    const tmpFile = LOCAL_USERS_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(arr, null, 2), 'utf-8');
    fs.renameSync(tmpFile, LOCAL_USERS_FILE);
  } catch (err) {
    console.warn('[Auth] 保存 local-users.json 失败（可能 data 目录无写权限）：', (err as Error).message);
  }
}

// 启动时加载（文件不存在则用 seed 初始化）
try {
  if (fs.existsSync(LOCAL_USERS_FILE)) {
    const data = JSON.parse(fs.readFileSync(LOCAL_USERS_FILE, 'utf-8'));
    if (Array.isArray(data)) {
      for (const rec of data) {
        if (rec && rec.username) localUsers[rec.username] = rec;
      }
      console.log(`[Auth] 加载 ${Object.keys(localUsers).length} 个账密用户`);
    }
  } else {
    // 首次启动：写入 seed
    for (const rec of SEED_LOCAL_USERS) {
      localUsers[rec.username] = { ...rec };
    }
    persistLocalUsers();
    console.log(`[Auth] 初始化 ${SEED_LOCAL_USERS.length} 个账密用户（seed）`);
  }
} catch (err) {
  console.warn('[Auth] 加载 local-users.json 失败，回退 seed：', err);
  for (const rec of SEED_LOCAL_USERS) {
    localUsers[rec.username] = { ...rec };
  }
}

// 保留 PRESET_USERS 常量名兼容旧代码引用（指向 localUsers 的只读视图）
// 注意：新代码应直接使用 localUsers
const PRESET_USERS: Record<string, { password: string; userId: string; name: string; role: SessionData['role'] }> =
  new Proxy({} as Record<string, { password: string; userId: string; name: string; role: SessionData['role'] }>, {
    get: (_t, prop: string) => {
      const u = localUsers[prop];
      if (!u) return undefined;
      return { password: u.password, userId: u.userId, name: u.name, role: u.manualRole || u.role };
    },
    ownKeys: () => Object.keys(localUsers),
    getOwnPropertyDescriptor: (_t, prop: string) => {
      if (localUsers[prop]) return { configurable: true, enumerable: true, value: undefined, writable: false };
      return undefined;
    },
  });

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
// 密码安全：scrypt 哈希存储（对存量明文密码向后兼容，登录成功后自动升级）
// ============================================================
const PW_PREFIX = 'scrypt$';
function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `${PW_PREFIX}${salt}$${hash}`;
}
function verifyPassword(inputPw: string, stored: string): boolean {
  if (stored.startsWith(PW_PREFIX)) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const [, salt, hash] = parts;
    const calc = crypto.scryptSync(inputPw, salt, 32).toString('hex');
    return calc.length === hash.length && crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash));
  }
  // 存量明文（旧数据）：直接比对，登录成功后由调用方升级为哈希
  return inputPw === stored;
}

// ============================================================
// 登录限流：每 IP 5 分钟内最多 10 次失败尝试（防暴力破解）
// ============================================================
const loginFailures = new Map<string, { count: number; resetAt: number }>();
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
function isLoginRateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = loginFailures.get(ip);
  if (!rec || now > rec.resetAt) return false;
  return rec.count >= LOGIN_MAX_ATTEMPTS;
}
function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const rec = loginFailures.get(ip);
  if (!rec || now > rec.resetAt) {
    loginFailures.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    rec.count++;
  }
}
function clearLoginFailures(ip: string): void {
  loginFailures.delete(ip);
}

/** 吊销指定用户的全部 session（改角色/禁用账号后立即生效，不必等 24h 过期） */
function revokeUserSessions(match: (s: SessionData) => boolean): void {
  let changed = false;
  for (const [tok, s] of sessions) {
    if (match(s)) { sessions.delete(tok); changed = true; }
  }
  if (changed) persistSessions();
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
  // 登录限流：防暴力破解
  const clientIp = (req as any).ip || req.socket?.remoteAddress || 'unknown';
  if (isLoginRateLimited(clientIp)) {
    res.status(429).json({ success: false, error: '尝试次数过多，请 5 分钟后再试' });
    return;
  }
  const local = localUsers[username];
  if (!local || !verifyPassword(password, local.password)) {
    recordLoginFailure(clientIp);
    res.status(401).json({ success: false, error: '账号或密码错误' });
    return;
  }
  if (!local.active) {
    recordLoginFailure(clientIp);
    res.status(403).json({ success: false, error: '账号已被禁用，请联系管理员' });
    return;
  }
  // 存量明文密码自动升级为 scrypt 哈希（透明迁移）
  if (!local.password.startsWith(PW_PREFIX)) {
    local.password = hashPassword(password);
    persistLocalUsers();
  }
  clearLoginFailures(clientIp);
  // 有效角色：优先 manualRole（管理员覆盖），否则用默认 role
  const effectiveRole = local.manualRole || local.role;
  // 生成 session token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, {
    userId: local.userId,
    username,
    role: effectiveRole,
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
    user: {
      id: local.userId,
      username,
      name: local.name,
      role: effectiveRole,
      autoRole: local.role,
      manualRole: local.manualRole,
      manualPerms: local.manualPerms,
      loginType: 'password',
    },
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
    // 有效角色：优先 manualRole（管理员覆盖），否则用自动推断 role
    const effectiveRole = record?.manualRole || record?.role || user.role;
    res.json({
      success: true,
      user: {
        id: user.userId,
        userId: user.userId,
        username: user.username,
        name: record?.name || '飞书用户',
        role: effectiveRole,
        autoRole: record?.role,              // 自动推断的角色（前端可显示"覆盖自 X"）
        manualRole: record?.manualRole,        // 管理员手动覆盖的角色
        manualPerms: record?.manualPerms,      // 管理员按账号单独覆盖的模块权限
        deptNames: record?.deptNames || [],
        loginType: 'feishu',
      },
    });
    return;
  }
  // 账密用户：从 localUsers 查（支持手动覆盖字段）
  const local = localUsers[user.username];
  const effectiveRole = local?.manualRole || local?.role || user.role;
  res.json({
    success: true,
    user: {
      id: user.userId,
      userId: user.userId,
      username: user.username,
      name: local?.name || user.username,
      role: effectiveRole,
      autoRole: local?.role,
      manualRole: local?.manualRole,
      manualPerms: local?.manualPerms,
      loginType: 'password',
    },
  });
});

// ============================================================
// GET /api/auth/users — 列出可用账号（方便前端初始化）
// 注意：此端点只返回 active 账密用户，不返回密码
// ============================================================
router.get('/users', requireAuth, (_req, res) => {
  const users = Object.values(localUsers)
    .filter(u => u.active)
    .map(u => ({
      username: u.username,
      name: u.name,
      role: u.manualRole || u.role,
    }));
  res.json({ success: true, users });
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
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
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

// 模块权限条目（与前端 ModulePermission 类型对齐）
interface ModulePermission {
  module: string;   // 'dashboard' | 'projects' | ... | 'permissionConfig'
  view: boolean;
  edit: boolean;
  delete: boolean;
}

// 飞书用户缓存：open_id → {userId, name, role, deptNames, manualRole, manualPerms}
// 后续可改成数据库表，这里先用内存 Map + 持久化到 data/feishu-users.json
interface FeishuUserRecord {
  openId: string;
  unionId?: string;
  userId?: string;   // 员工工号（如有）
  name: string;
  email?: string;
  role: SessionData['role'];              // 自动推断的角色（按部门规则）
  manualRole?: SessionData['role'];       // 管理员手动覆盖的角色（优先于 role）
  manualPerms?: ModulePermission[];       // 管理员按账号单独覆盖的模块权限（优先于角色默认权限）
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
    console.warn('[Auth] 保存 feishu-users.json 失败（可能 data 目录无写权限）：', (err as Error).message);
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

    // 3. 拉员工部门信息（仅在 FEISHU_FETCH_DEPT=true 时执行，失败不阻断登录）
    //    权限未开通时跳过，所有飞书用户用 FEISHU_DEFAULT_ROLE
    let empDept: { deptIds: string[]; deptNames: string[]; userId?: string } = { deptIds: [], deptNames: [] };
    if (FEISHU_FETCH_DEPT) {
      const appAccessToken = await getAppAccessToken();
      empDept = await getEmployeeDept(appAccessToken, openId);
    } else {
      console.log('[Feishu] FEISHU_FETCH_DEPT=false，跳过部门查询，使用默认角色:', FEISHU_DEFAULT_ROLE);
    }

    // 4. 部门 → 角色映射
    const role = mapDeptToRole(empDept.deptNames);

    // 5. 缓存飞书用户记录（用于后续展示/管理）
    //    注意：保留管理员已配置的 manualRole / manualPerms，不被自动字段覆盖
    const existing = feishuUsers.get(openId);
    const record: FeishuUserRecord = {
      openId,
      unionId,
      userId: empDept.userId,
      name,
      email: info.email,
      role,                                   // 自动推断角色（每次刷新）
      manualRole: existing?.manualRole,        // 保留管理员手动覆盖
      manualPerms: existing?.manualPerms,      // 保留管理员模块权限覆盖
      deptNames: empDept.deptNames,
      lastLoginAt: new Date().toISOString(),
    };
    feishuUsers.set(openId, record);
    persistFeishuUsers();

    // 6. 建 session（复用现有 sessions Map）
    //    session.role 优先用 manualRole（管理员覆盖），否则用自动推断 role
    const sessionRole = record.manualRole || role;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(token, {
      userId: empDept.userId || openId,   // 优先用工号，否则用 open_id
      username: `feishu:${openId}`,       // 加前缀区分账密用户
      role: sessionRole,
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
    fetchDept: FEISHU_FETCH_DEPT,        // 是否按部门映射角色（false=降级模式，所有用户用 defaultRole）
    defaultRole: FEISHU_DEFAULT_ROLE,
    deptRules: FEISHU_DEPT_ROLE_MAP,
  });
});

// ============================================================
// 统一账号权限管理 API（管理者权限）
// - GET /api/auth/accounts              列出所有账号（飞书+账密合并）
// - PUT /api/auth/accounts/:type/:id    更新 manualRole + manualPerms
// - POST /api/auth/accounts/local       新增账密用户
// - DELETE /api/auth/accounts/local/:username  删除账密用户（admin 不可删）
// ============================================================

// 合并账号视图（脱敏，不含 password）
interface AccountView {
  id: string;                  // 飞书=openId / 账密=username
  type: 'feishu' | 'local';
  username: string;            // 飞书=`feishu:<openId>` / 账密=username
  name: string;
  email?: string;
  role: SessionData['role'];            // 自动推断/默认角色
  manualRole?: SessionData['role'];      // 管理员覆盖
  effectiveRole: SessionData['role'];   // 实际生效角色 = manualRole || role
  manualPerms?: ModulePermission[];      // 管理员按账号覆盖的模块权限
  deptNames?: string[];
  active: boolean;                       // 账密用户的启用状态（飞书恒为 true）
  lastLoginAt?: string;
  createdAt?: string;
}

router.get('/accounts', requireAuth, requireRole(['管理者']), (_req, res) => {
  const accounts: AccountView[] = [];

  // 飞书用户
  for (const u of feishuUsers.values()) {
    accounts.push({
      id: u.openId,
      type: 'feishu',
      username: `feishu:${u.openId}`,
      name: u.name,
      email: u.email,
      role: u.role,
      manualRole: u.manualRole,
      effectiveRole: u.manualRole || u.role,
      manualPerms: u.manualPerms,
      deptNames: u.deptNames,
      active: true,
      lastLoginAt: u.lastLoginAt,
    });
  }

  // 账密用户
  for (const u of Object.values(localUsers)) {
    accounts.push({
      id: u.username,
      type: 'local',
      username: u.username,
      name: u.name,
      role: u.role,
      manualRole: u.manualRole,
      effectiveRole: u.manualRole || u.role,
      manualPerms: u.manualPerms,
      active: u.active,
      createdAt: u.createdAt,
    });
  }

  res.json({ success: true, accounts });
});

// PUT /api/auth/accounts/:type/:id
// body: { manualRole?, manualPerms?, active?, name? }
router.put('/accounts/:type/:id', requireAuth, requireRole(['管理者']), (req, res) => {
  const { type, id } = req.params;
  const { manualRole, manualPerms, active, name } = req.body || {};

  // 校验 manualRole
  const ALLOWED_ROLES: SessionData['role'][] = ['管理者', '编辑者', '阅读者'];
  if (manualRole !== undefined && manualRole !== null && !ALLOWED_ROLES.includes(manualRole)) {
    res.status(400).json({ success: false, error: 'manualRole 非法' });
    return;
  }
  // 校验 manualPerms
  if (manualPerms !== undefined && manualPerms !== null) {
    if (!Array.isArray(manualPerms)) {
      res.status(400).json({ success: false, error: 'manualPerms 必须是数组' });
      return;
    }
    for (const p of manualPerms) {
      if (!p || typeof p.module !== 'string' ||
          typeof p.view !== 'boolean' ||
          typeof p.edit !== 'boolean' ||
          typeof p.delete !== 'boolean') {
        res.status(400).json({ success: false, error: 'manualPerms 条目格式非法' });
        return;
      }
    }
  }

  if (type === 'feishu') {
    const rec = feishuUsers.get(id);
    if (!rec) {
      res.status(404).json({ success: false, error: '飞书用户不存在' });
      return;
    }
    if (manualRole !== undefined) rec.manualRole = manualRole || undefined;
    if (manualPerms !== undefined) rec.manualPerms = manualPerms || undefined;
    persistFeishuUsers();
    // 立即吊销该用户已有 session，新角色/权限下次登录生效
    revokeUserSessions((s) => s.username === `feishu:${id}` || s.userId === id);
  } else if (type === 'local') {
    const rec = localUsers[id];
    if (!rec) {
      res.status(404).json({ success: false, error: '账密用户不存在' });
      return;
    }
    if (manualRole !== undefined) rec.manualRole = manualRole || undefined;
    if (manualPerms !== undefined) rec.manualPerms = manualPerms || undefined;
    if (typeof active === 'boolean') rec.active = active;
    if (typeof name === 'string' && name.trim()) rec.name = name.trim();
    persistLocalUsers();
    // 立即吊销该用户已有 session（禁用/降权立即生效，不必等 24h 过期）
    revokeUserSessions((s) => s.username === id);
  } else {
    res.status(400).json({ success: false, error: 'type 必须是 feishu 或 local' });
    return;
  }

  res.json({ success: true });
});

// POST /api/auth/accounts/local — 新增账密用户
// body: { username, password, name, role }
router.post('/accounts/local', requireAuth, requireRole(['管理者']), (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name || !role) {
    res.status(400).json({ success: false, error: '账号、密码、姓名、角色均为必填' });
    return;
  }
  const ALLOWED_ROLES: SessionData['role'][] = ['管理者', '编辑者', '阅读者'];
  if (!ALLOWED_ROLES.includes(role)) {
    res.status(400).json({ success: false, error: 'role 非法' });
    return;
  }
  if (localUsers[username]) {
    res.status(409).json({ success: false, error: '账号已存在' });
    return;
  }
  if (username.startsWith('feishu:')) {
    res.status(400).json({ success: false, error: '账号不能以 feishu: 开头（保留前缀）' });
    return;
  }
  const rec: LocalUserRecord = {
    username,
    password: hashPassword(password),
    userId: `u${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    name,
    role,
    active: true,
    createdAt: new Date().toISOString(),
  };
  localUsers[username] = rec;
  persistLocalUsers();
  res.json({
    success: true,
    account: {
      id: rec.username,
      type: 'local',
      username: rec.username,
      name: rec.name,
      role: rec.role,
      effectiveRole: rec.role,
      active: rec.active,
      createdAt: rec.createdAt,
    },
  });
});

// DELETE /api/auth/accounts/local/:username — 删除账密用户（admin 不可删）
router.delete('/accounts/local/:username', requireAuth, requireRole(['管理者']), (req, res) => {
  const { username } = req.params;
  if (username === 'admin') {
    res.status(400).json({ success: false, error: 'admin 账号不可删除（保留管理员入口）' });
    return;
  }
  const rec = localUsers[username];
  if (!rec) {
    res.status(404).json({ success: false, error: '账号不存在' });
    return;
  }
  delete localUsers[username];
  persistLocalUsers();
  // 同时清除该用户的所有 session
  for (const [token, sess] of sessions.entries()) {
    if (sess.username === username) sessions.delete(token);
  }
  persistSessions();
  res.json({ success: true });
});

// ============================================================
// 飞书通讯录搜索 + 预授权（解决"给没登录过的人预先配权限"）
// 需要飞书后台开通权限：contact:user.base:readonly（+ contact:department.base:readonly 可选）
// ============================================================

// POST /api/auth/feishu/search — 搜索飞书用户（返回候选列表）
// body: { query: string }  // 姓名/工号/邮箱/手机号
router.post('/feishu/search', requireAuth, requireRole(['管理者']), asyncHandler(async (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ success: false, error: 'query 必填' });
    return;
  }
  if (!FEISHU_ENABLED) {
    res.status(400).json({ success: false, error: '飞书登录未配置' });
    return;
  }
  const appToken = await getAppAccessToken();
  // 调用通讯录搜索 API（user_id_type=open_id，方便后续预授权）
  const apiUrl = `https://open.feishu.cn/open-apis/contact/v3/users/search?query=${encodeURIComponent(query.trim())}&user_id_type=open_id&page_size=20`;
  const r = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${appToken}` },
  });
  const data: any = await r.json();
  if (data.code !== 0) {
    res.status(502).json({ success: false, error: `飞书搜索失败: ${data.code} ${data.msg}` });
    return;
  }
  const users = (data.data?.items || []).map((u: any) => ({
    openId: u.open_id,
    userId: u.user_id,
    name: u.name,
    email: u.email,
    mobile: u.mobile,
    deptIds: u.department_ids || [],
  }));
  res.json({ success: true, users });
}));

// POST /api/auth/feishu/preauthorize — 预创建飞书用户记录（未登录也可配权限）
// body: { openId, name?, email?, deptNames? }
router.post('/feishu/preauthorize', requireAuth, requireRole(['管理者']), asyncHandler(async (req, res) => {
  const { openId, name, email, deptNames } = req.body || {};
  if (!openId || typeof openId !== 'string') {
    res.status(400).json({ success: false, error: 'openId 必填' });
    return;
  }
  if (!FEISHU_ENABLED) {
    res.status(400).json({ success: false, error: '飞书登录未配置' });
    return;
  }
  // 已存在则直接返回（幂等）
  const existing = feishuUsers.get(openId);
  if (existing) {
    res.json({
      success: true,
      account: {
        id: existing.openId,
        type: 'feishu' as const,
        username: `feishu:${existing.openId}`,
        name: existing.name,
        email: existing.email,
        role: existing.role,
        manualRole: existing.manualRole,
        effectiveRole: existing.manualRole || existing.role,
        deptNames: existing.deptNames,
        lastLoginAt: existing.lastLoginAt,
      },
    });
    return;
  }
  // 默认 role（用 FEISHU_DEFAULT_ROLE，部署时改为"编辑者"）
  const role = mapDeptToRole(deptNames || []);
  const record: FeishuUserRecord = {
    openId,
    name: name || '飞书用户',
    email,
    role,
    deptNames: deptNames || [],
    lastLoginAt: '',  // 空字符串表示"尚未登录"
  };
  feishuUsers.set(openId, record);
  persistFeishuUsers();
  res.json({
    success: true,
    account: {
      id: record.openId,
      type: 'feishu' as const,
      username: `feishu:${record.openId}`,
      name: record.name,
      email: record.email,
      role: record.role,
      effectiveRole: record.role,
      deptNames: record.deptNames,
      lastLoginAt: record.lastLoginAt,
    },
  });
}));

// ============================================================
// 批量权限操作（解决"给多个领导一次性提权"）
// ============================================================

// POST /api/auth/accounts/batch — 批量更新账号权限
// body: { ids: [{type:'feishu'|'local', id:string}], action: 'setRole'|'clearOverride', value?: '管理者'|'编辑者'|'阅读者' }
router.post('/accounts/batch', requireAuth, requireRole(['管理者']), (req, res) => {
  const { ids, action, value } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ success: false, error: 'ids 必填且非空' });
    return;
  }
  if (!['setRole', 'clearOverride'].includes(action)) {
    res.status(400).json({ success: false, error: 'action 必须是 setRole 或 clearOverride' });
    return;
  }
  if (action === 'setRole') {
    const ALLOWED: SessionData['role'][] = ['管理者', '编辑者', '阅读者'];
    if (!ALLOWED.includes(value)) {
      res.status(400).json({ success: false, error: 'value 必须是 管理者/编辑者/阅读者' });
      return;
    }
  }

  const results: { id: string; type: string; ok: boolean; error?: string }[] = [];
  let touchedFeishu = false;
  let touchedLocal = false;

  for (const item of ids) {
    const { type, id } = item || {};
    if (type === 'feishu') {
      const rec = feishuUsers.get(id);
      if (!rec) {
        results.push({ id, type, ok: false, error: '飞书用户不存在' });
        continue;
      }
      if (action === 'setRole') rec.manualRole = value;
      else if (action === 'clearOverride') { rec.manualRole = undefined; rec.manualPerms = undefined; }
      touchedFeishu = true;
      results.push({ id, type, ok: true });
    } else if (type === 'local') {
      const rec = localUsers[id];
      if (!rec) {
        results.push({ id, type, ok: false, error: '账密用户不存在' });
        continue;
      }
      if (action === 'setRole') rec.manualRole = value;
      else if (action === 'clearOverride') { rec.manualRole = undefined; rec.manualPerms = undefined; }
      touchedLocal = true;
      results.push({ id, type, ok: true });
    } else {
      results.push({ id, type, ok: false, error: 'type 非法' });
    }
  }

  if (touchedFeishu) persistFeishuUsers();
  if (touchedLocal) persistLocalUsers();

  const successCount = results.filter(r => r.ok).length;
  res.json({ success: true, updated: successCount, total: results.length, results });
});

export default router;