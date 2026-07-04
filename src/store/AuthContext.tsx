import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
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
  'permissionConfig',
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
  user: User | null;

  // 权限检查
  canView: (module: AppModule) => boolean;
  canEdit: (module: AppModule) => boolean;
  canDelete: (module: AppModule) => boolean;

  // 操作
  login: (username: string, password: string) => { success: boolean; message: string };
  loginWithFeishu: (user: User) => { success: boolean; message: string };
  logout: () => void;

  // 权限配置（仅管理者）
  permissionConfigs: PermissionConfig[];
  updatePermissionConfig: (role: UserRole, permissions: ModulePermission[]) => void;
  resetPermissions: () => void;
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

  const [permissionConfigs, setPermissionConfigs] = useState<PermissionConfig[]>(() => {
    return loadFromStorage<PermissionConfig[]>(PERMISSION_KEY, DEFAULT_PERMISSIONS);
  });

  const isAuthenticated = !!authState.user;

  // 当前用户权限映射
  const permissionMap = useMemo(() => {
    if (!authState.user) {
      return {} as Record<AppModule, ModulePermission>;
    }
    const config = permissionConfigs.find((c) => c.role === authState.user!.role);
    const map = {} as Record<AppModule, ModulePermission>;
    if (config) {
      for (const p of config.permissions) {
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

  // 登录
  const login = useCallback(
    (username: string, password: string): { success: boolean; message: string } => {
      const preset = PRESET_USERS[username];
      if (!preset) {
        return { success: false, message: '账号不存在' };
      }
      if (preset.password !== password) {
        return { success: false, message: '密码错误' };
      }
      const newState = { user: preset.user };
      setAuthState(newState);
      saveToStorage(AUTH_KEY, newState);
      return { success: true, message: '登录成功' };
    },
    []
  );

  // 退出
  const logout = useCallback(() => {
    const newState = { user: null };
    setAuthState(newState);
    saveToStorage(AUTH_KEY, newState);
  }, []);

  // 飞书登录
  const loginWithFeishu = useCallback(
    (user: User): { success: boolean; message: string } => {
      const newState = { user };
      setAuthState(newState);
      saveToStorage(AUTH_KEY, newState);
      return { success: true, message: '飞书登录成功' };
    },
    []
  );

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
  const resetPermissions = useCallback(() => {
    setPermissionConfigs(DEFAULT_PERMISSIONS);
    saveToStorage(PERMISSION_KEY, DEFAULT_PERMISSIONS);
  }, []);

  const value: AuthContextValue = {
    isAuthenticated,
    user: authState.user,
    canView,
    canEdit,
    canDelete,
    login,
    loginWithFeishu,
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
