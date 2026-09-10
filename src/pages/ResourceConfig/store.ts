/**
 * 资源配置 · 同步层（移植自工具 cloudPull/cloudPush，改为平台 React Hooks）
 *
 * 数据流：内存 state ←→ localStorage（即时）+ 云端 /api/rc/store（防抖推送）。
 * 启动 cloudPull：云端有数据以云端为准；云端失败回退本地。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RcAsset, RcDeptMember, RcDelivered, RcProject, ProjectConfig, LockState } from './types';
import { LS_KEYS } from './types';

const canEditCloud = () => location.protocol === 'http:' || location.protocol === 'https:';

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}
function lsSet(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 满/禁用 */ }
}

/**
 * 拉取云端 store。
 * 返回 null = 真实失败（网络/未登录），调用方应挂起推送；
 * 返回 {} = 云端为空（新部署）——这是合法状态，推送允许（首次播种）。
 * persist=false：只取数据不落盘（冲突合并时防止远端覆盖本地独有数据的落盘副本）。
 */
async function cloudPullRaw(persist = true): Promise<Record<string, unknown> | null> {
  if (!canEditCloud()) return null;
  try {
    const r = await fetch('/api/rc/store', { credentials: 'include' });
    if (!r.ok) return null;
    const map = (await r.json()) || {};
    const keys = Object.keys(map).filter(k => !k.startsWith('_'));
    if (persist) keys.forEach(k => lsSet(k, map[k]));
    return keys.length ? map : {};
  } catch { return null; }
}

type CloudStatus = 'idle' | 'pushing' | 'ok' | 'off' | 'forbid';

/** 主 store：项目配置 + 三个全局库，统一入口 */
export function useRcStore() {
  const [config, setConfig] = useState<ProjectConfig>(() => lsGet(LS_KEYS.config, { projects: {}, currentId: '' }));
  const [assets, setAssets] = useState<RcAsset[]>(() => lsGet(LS_KEYS.assets, [] as RcAsset[]));
  const [dept, setDept] = useState<{ members: RcDeptMember[] }>(() => lsGet(LS_KEYS.dept, { members: [] }));
  const [delivered, setDelivered] = useState<RcDelivered[]>(() => lsGet(LS_KEYS.delivered, [] as RcDelivered[]));
  const [cloud, setCloud] = useState<CloudStatus>('idle');
  const [ready, setReady] = useState(false);
  const pushTimer = useRef<number | null>(null);
  const cfgRef = useRef(config); cfgRef.current = config;
  const assetsRef = useRef(assets); assetsRef.current = assets;
  const deptRef = useRef(dept); deptRef.current = dept;
  const delivRef = useRef(delivered); delivRef.current = delivered;

  // 启动：云端优先恢复（空云 {} 也是成功——允许首次播种）
  useEffect(() => {
    (async () => {
      const map = await cloudPullRaw();
      if (map !== null) {
        mergeRemote(map);
        pulledRef.current = true;
        setCloud('ok');
      } else {
        setCloud('off');
      }
      setReady(true);
    })();
  }, []);

  /**
   * 四键同口径合并（启动与冲突收敛共用）：每键独立比较条目数，多者为准；
   * 远端胜出 → 采纳远端（state + 落盘）；本地胜出 → 保留本地（state 即本地，回写落盘防分叉）。
   * 返回是否有本地胜出的键（调用方可据此立即重推收敛云端）。
   */
  const mergeRemote = (map: Record<string, unknown>): boolean => {
    versionsRef.current = (map._versions as Record<string, number>) || versionsRef.current;
    const count = (v: unknown, key: 'projects' | 'members' | 'length'): number => {
      try {
        if (key === 'projects') return Object.keys((v as any)?.projects || {}).length;
        if (key === 'members') return ((v as any)?.members || []).length;
        return Array.isArray(v) ? v.length : 0;
      } catch { return 0; }
    };
    let localWon = false;
    const pairs: [string, 'projects' | 'members' | 'length', any, (v: any) => void, any][] = [
      [LS_KEYS.config, 'projects', cfgRef.current, setConfig, map[LS_KEYS.config]],
      [LS_KEYS.assets, 'length', assetsRef.current, setAssets, map[LS_KEYS.assets]],
      [LS_KEYS.dept, 'members', deptRef.current, setDept, map[LS_KEYS.dept]],
      [LS_KEYS.delivered, 'length', delivRef.current, setDelivered, map[LS_KEYS.delivered]],
    ];
    for (const [key, dim, local, setter, remote] of pairs) {
      if (remote === undefined) continue;
      const ln = count(local, dim), rn = count(remote, dim);
      if (rn > ln) {
        setter(remote);
        lsSet(key, remote);
      } else if (ln > rn) {
        localWon = true;
        lsSet(key, local); // 落盘与 state 对齐（防 cloudPullRaw 已写远端副本导致关页丢本地）
      }
      // 相等：维持现状
    }
    return localWon;
  };

  // 防抖云端推送（本地已即时落 localStorage）。
  // P0 防护：pull 从未成功（off）期间挂起推送——新设备/清缓存场景下本地为空，
  // 贸然全量推送会把云端清空；此期间编辑仅存本地，待 pull 成功后恢复推送
  const pulledRef = useRef(false);
  /** 乐观锁基线：pull 拿到各键云端版本，push 携带；版本不匹配服务端拒写（conflicts）后自动重拉合并 */
  const versionsRef = useRef<Record<string, number>>({});
  const pushCloudRef = useRef<(() => void) | null>(null);
  const pushCloud = useCallback(() => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(async () => {
      if (!pulledRef.current) {
        // 基线未确认（启动 pull 失败）→ 先补一次 pull，成功则继续推送（自动恢复，不再永久挂起）
        const map = await cloudPullRaw();
        if (map === null) {
          console.warn('[rc-store] 云端仍不可达，推送挂起（本地已保存，恢复后自动重试）');
          return;
        }
        mergeRemote(map);
        pulledRef.current = true;
      }
      setCloud('pushing');
      try {
        const body: Record<string, unknown> = {
          [LS_KEYS.config]: cfgRef.current,
          [LS_KEYS.assets]: assetsRef.current,
          [LS_KEYS.dept]: deptRef.current,
          [LS_KEYS.delivered]: delivRef.current,
          _baseVersion: versionsRef.current, // 乐观锁基线（服务端版本前进则拒写返 conflicts）
        };
        // 锁键不再随 bulk 上云：锁状态由服务端专用 lock/unlock 接口权威管理（防他端回滚）
        const r = await fetch('/api/rc/store/bulk', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (r.status === 403) { setCloud('forbid'); return; }
        if (r.ok) {
          const data = await r.json().catch(() => ({}));
          if (data?._versions) versionsRef.current = { ...versionsRef.current, ...data._versions };
          // 空覆盖防护拦截（云端保留数据）：明确提示，不静默
          if (Array.isArray(data?.blocked) && data.blocked.length) {
            console.warn('[rc-store] 云端拒绝空覆盖（保留较新数据）:', data.blocked);
          }
          // 乐观锁冲突：他人先推送 → 重拉（不落盘）→ 四键同口径合并 → 本地有胜出键则立即重推收敛
          if (Array.isArray(data?.conflicts) && data.conflicts.length) {
            console.warn('[rc-store] 版本冲突，自动收敛:', data.conflicts);
            const map2 = await cloudPullRaw(false);
            if (map2) {
              const localWon = mergeRemote(map2);
              if (localWon) {
                // 本地有独有数据：以新基线立即重推一轮（原调用是一次性防抖，此处补推收敛云端）
                setTimeout(() => { pushCloudRef.current?.(); }, 300);
              }
            }
          }
          setCloud('ok');
          return;
        }
        if (r.status === 409) {
          // 服务端空覆盖防护拦截（本地为空集而云端有数据）：禁止覆盖，提示刷新
          console.warn('[rc-store] 云端拒绝覆盖（409）：云端数据较新，请刷新页面获取');
          setCloud('off');
          return;
        }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        setCloud('ok');
      } catch { setCloud('off'); }
    }, 500);
  }, []);
  pushCloudRef.current = pushCloud;

  // 多标签页同步：其他标签页写 localStorage 时同步本页 state（不触发推送，避免回环）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || !Object.values(LS_KEYS).includes(e.key as any) || e.newValue == null) return;
      try {
        const v = JSON.parse(e.newValue);
        if (e.key === LS_KEYS.config) setConfig(v as ProjectConfig);
        else if (e.key === LS_KEYS.assets) setAssets(v as RcAsset[]);
        else if (e.key === LS_KEYS.dept) setDept(v as { members: RcDeptMember[] });
        else if (e.key === LS_KEYS.delivered) setDelivered(v as RcDelivered[]);
        // 锁键变更：写入即触发页面刷新（页面 useState 只挂载读一次，这里补发一个自定义事件）
        else if (String(e.key).endsWith('Lock_v1') || String(e.key).endsWith('EditPw_v1')) {
          window.dispatchEvent(new CustomEvent('rc-lock-changed', { detail: e.key }));
        }
      } catch { /* 忽略畸形 */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ---- 变更入口（改完自动本地落盘 + 推云）----
  const updateConfig = useCallback((next: ProjectConfig) => {
    setConfig(next); lsSet(LS_KEYS.config, next); pushCloud();
  }, [pushCloud]);
  const updateAssets = useCallback((next: RcAsset[]) => {
    setAssets(next); lsSet(LS_KEYS.assets, next); pushCloud();
  }, [pushCloud]);
  const updateDept = useCallback((next: { members: RcDeptMember[] }) => {
    setDept(next); lsSet(LS_KEYS.dept, next); pushCloud();
  }, [pushCloud]);
  const updateDelivered = useCallback((next: RcDelivered[]) => {
    setDelivered(next); lsSet(LS_KEYS.delivered, next); pushCloud();
  }, [pushCloud]);

  // 当前项目便捷操作
  const currentProject: RcProject | null = config.projects[config.currentId] || null;
  const patchProject = useCallback((patch: Partial<RcProject>, projectId?: string) => {
    const id = projectId || cfgRef.current.currentId;
    if (!cfgRef.current.projects[id]) return;
    const next: ProjectConfig = {
      ...cfgRef.current,
      projects: { ...cfgRef.current.projects, [id]: { ...cfgRef.current.projects[id], ...patch } },
    };
    updateConfig(next);
  }, [updateConfig]);

  const getLock = useCallback((key: string): LockState => lsGet(key, { locked: false, password: '' }), []);
  /** 锁定：密码经专用接口存服务端（GET 脱敏不下发），本地只记 locked 状态 */
  const lockLib = useCallback(async (key: string, password: string): Promise<boolean> => {
    try {
      const r = await fetch('/api/rc/store/lock', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, password }),
      });
      if (!r.ok) { console.warn('[rc-store] 锁定失败 HTTP', r.status); return false; }
      const local: LockState = { locked: true, password: '' };
      lsSet(key, local);
      return true;
    } catch { return false; }
  }, []);
  /** 解锁：服务端比对密码。返回 'ok' | 'wrong'（密码错）| 'error'（服务不可用），页面区分提示 */
  const unlockLib = useCallback(async (key: string, password: string): Promise<'ok' | 'wrong' | 'error'> => {
    try {
      const r = await fetch('/api/rc/store/unlock', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, password }),
      });
      if (r.status === 401) return 'wrong';
      if (!r.ok) return 'error';
      const local: LockState = { locked: false, password: '' };
      lsSet(key, local);
      return 'ok';
    } catch { return 'error'; }
  }, []);

  return {
    ready, cloud, config, assets, dept, delivered, currentProject,
    updateConfig, updateAssets, updateDept, updateDelivered, patchProject,
    getLock, lockLib, unlockLib, pushCloud,
  };
}

export type RcStore = ReturnType<typeof useRcStore>;
