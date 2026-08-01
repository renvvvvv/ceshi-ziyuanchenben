import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import type { User, UserRole, AppModule, ModulePermission, PermissionConfig } from '../types';

// ============================================================
// localStorage 持久化工具
// ============================================================

const AUTH_KEY = 'zhwh_auth';
const PERMISSION_KEY = 'zhwh_permissions';

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return fallback;
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

// ============================================================
// 默认权限配置
// ============================================================

const MODULE_LIST: AppModule[] = [
  'dashboard',
  'projects',
  'history',
  'teamPool',
  'testGuide',
  'resourceCalc',
  'attendance',
  'reportReview',
  'permissionConfig',
  'aiTestExpert',
];

const DEFAULT_PERMISSIONS: PermissionConfig[] = [
  {
    role: '管理者',
    permissions: MODULE_LIST.map((m) => ({
      module: m,
      view: true,
      edit: true,
      delete: true,
    })),
  },
  {
    role: '编辑者',
    permissions: MODULE_LIST.map((m) => ({
      module: m,
      view: m !== 'permissionConfig',
      edit: m !== 'permissionConfig',
      delete: false,
    })),
  },
  {
    role: '阅读者',
    permissions: MODULE_LIST.map((m) => ({
      module: m,
      view: m !== 'permissionConfig',
      edit: false,
      delete: false,
    })),
  },
];

// ============================================================
// Context 类型
// ============================================================

interface AuthContextValue {
  // 登录状态
  isAuthenticated: boolean;
  authReady: boolean;
  user: User | null;

  // 权限检查
  canView: (module: AppModule) => boolean;
  canEdit: (module: AppModule) => boolean;
  canDelete: (module: AppModule) => boolean;

  // 操作
  login: (username: string, password: string) => Promise<{ success: boolean; message: string }>;
  logout: () => void;

  // 权限配置（仅管理者）
  permissionConfigs: PermissionConfig[];
  updatePermissionConfig: (role: UserRole, permissions: ModulePermission[]) => void;
  resetPermissions: () => PermissionConfig[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================================
// 预置用户（演示用，实际应走后端验证）
// ============================================================

const PRESET_USERS: Record<string, { password: string; user: User }> = {
  admin: {
    password: 'admin123',
    user: { id: 'u1', username: 'admin', name: '管理员', role: '管理者' },
  },
  editor: {
    password: 'editor123',
    user: { id: 'u2', username: 'editor', name: '编辑者', role: '编辑者' },
  },
  reader: {
    password: 'reader123',
    user: { id: 'u3', username: 'reader', name: '阅读者', role: '阅读者' },
  },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<{ user: User | null }>(() => {
    const saved = loadFromStorage<{ user: User | null }>(AUTH_KEY, { user: null });
    return saved;
  });
  const [authReady, setAuthReady] = useState(false);

  const [permissionConfigs, setPermissionConfigs] = useState<PermissionConfig[]>(() => {
    return loadFromStorage<PermissionConfig[]>(PERMISSION_KEY, DEFAULT_PERMISSIONS);
  });

  // 启动时以后端 session 为准，避免 localStorage 仍显示已登录、实际 cookie 已失效。
  useEffect(() => {
    let cancelled = false;

    const validateSession = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.ok && data.success && data.user) {
          const presetUser = PRESET_USERS[data.user.username]?.user;
          // 白名单校验 role，防止后端返回未知角色导致权限映射全空
          const ALLOWED_ROLES: UserRole[] = ['管理者', '编辑者', '阅读者'];
          const rawRole = data.user.role;
          const role: UserRole = ALLOWED_ROLES.includes(rawRole) ? rawRole : '阅读者';
          // 校验 manualRole（管理员手动覆盖的角色）
          const rawManualRole = data.user.manualRole;
          const manualRole: UserRole | undefined =
            rawManualRole && ALLOWED_ROLES.includes(rawManualRole) ? rawManualRole : undefined;
          // 校验 manualPerms（管理员按账号覆盖的模块权限）
          const rawManualPerms = data.user.manualPerms;
          const manualPerms: ModulePermission[] | undefined =
            Array.isArray(rawManualPerms) && rawManualPerms.length > 0
              ? rawManualPerms.filter(
                  (p: any) => p && typeof p.module === 'string' &&
                    typeof p.view === 'boolean' &&
                    typeof p.edit === 'boolean' &&
                    typeof p.delete === 'boolean'
                )
              : undefined;
          const validatedUser: User = {
            id: String(data.user.id || data.user.userId || presetUser?.id || authState.user?.id || ''),
            username: String(data.user.username || presetUser?.username || authState.user?.username || ''),
            name: String(data.user.name || presetUser?.name || authState.user?.name || data.user.username || ''),
            role,
            loginType: data.user.loginType === 'feishu' ? 'feishu' : 'password',
            deptNames: Array.isArray(data.user.deptNames) ? data.user.deptNames : undefined,
            manualRole,
            manualPerms,
          };
          const newState = { user: validatedUser };
          setAuthState(newState);
          saveToStorage(AUTH_KEY, newState);
        } else if (res.status === 401) {
          const newState = { user: null };
          setAuthState(newState);
          saveToStorage(AUTH_KEY, newState);
        }
      } catch {
        // 后端暂时不可达时保留本地状态；业务请求会展示具体网络错误。
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    };

    void validateSession();
    return () => { cancelled = true; };
    // 只在应用启动时校验一次；authState 此处是 localStorage 初始化快照。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAuthenticated = !!authState.user;

  // 当前用户权限映射
  // 计算优先级：
  //   1. user.manualPerms  —— 管理员按账号单独覆盖的模块权限（最高优先级）
  //   2. 角色默认权限（permissionConfigs/localStorage 里管理员调过的角色矩阵）
  //   3. DEFAULT_PERMISSIONS 兜底
  const permissionMap = useMemo(() => {
    if (!authState.user) {
      return {} as Record<AppModule, ModulePermission>;
    }
    const config = permissionConfigs.find((c) => c.role === authState.user!.role);
    const defaultConfig = DEFAULT_PERMISSIONS.find((c) => c.role === authState.user!.role);
    const map = {} as Record<AppModule, ModulePermission>;
    // 1. 先铺角色权限（管理员配置的角色矩阵 > 默认）
    if (config) {
      for (const p of config.permissions) {
        map[p.module] = p;
      }
    }
    // 2. 兼容新增模块：旧 localStorage 缺失时用默认权限补齐
    for (const m of MODULE_LIST) {
      if (!map[m]) {
        const defaultPerm = defaultConfig?.permissions.find((p) => p.module === m);
        if (defaultPerm) map[m] = defaultPerm;
      }
    }
    // 3. 最后用按账号覆盖的 manualPerms 覆盖（最高优先级）
    if (authState.user.manualPerms && authState.user.manualPerms.length > 0) {
      for (const p of authState.user.manualPerms) {
        map[p.module] = p;
      }
    }
    return map;
  }, [authState.user, permissionConfigs]);

  // 权限检查函数
  const canView = useCallback(
    (module: AppModule) => !!permissionMap[module]?.view,
    [permissionMap]
  );
  const canEdit = useCallback(
    (module: AppModule) => !!permissionMap[module]?.edit,
    [permissionMap]
  );
  const canDelete = useCallback(
    (module: AppModule) => !!permissionMap[module]?.delete,
    [permissionMap]
  );

  // 登录（先调后端 /api/auth/login 拿 token，再写本地状态）
  const login = useCallback(
    async (username: string, password: string): Promise<{ success: boolean; message: string }> => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include', // 带上 cookie（即使失败也带上）
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          return { success: false, message: data.error || '登录失败' };
        }
        const newState = { user: data.user };
        setAuthState(newState);
        saveToStorage(AUTH_KEY, newState);
        return { success: true, message: '登录成功' };
      } catch (err) {
        return { success: false, message: '网络错误，请检查后端服务' };
      }
    },
    []
  );

  // 退出：先清本地状态，再通知后端销毁 session/cookie。
  const logout = useCallback(() => {
    const newState = { user: null };
    setAuthState(newState);
    saveToStorage(AUTH_KEY, newState);
    void fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
  }, []);

  // 更新权限配置
  const updatePermissionConfig = useCallback(
    (role: UserRole, permissions: ModulePermission[]) => {
      setPermissionConfigs((prev) => {
        const next = prev.map((c) => (c.role === role ? { ...c, permissions } : c));
        saveToStorage(PERMISSION_KEY, next);
        return next;
      });
    },
    []
  );

  // 重置权限
  const resetPermissions = useCallback((): PermissionConfig[] => {
    setPermissionConfigs(DEFAULT_PERMISSIONS);
    saveToStorage(PERMISSION_KEY, DEFAULT_PERMISSIONS);
    return DEFAULT_PERMISSIONS;
  }, []);

  const value: AuthContextValue = {
    isAuthenticated,
    authReady,
    user: authState.user,
    canView,
    canEdit,
    canDelete,
    login,
    logout,
    permissionConfigs,
    updatePermissionConfig,
    resetPermissions,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
