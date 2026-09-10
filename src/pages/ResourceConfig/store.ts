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

async function cloudPull(): Promise<Record<string, unknown> | null> {
  if (!canEditCloud()) return null;
  try {
    const r = await fetch('/api/rc/store', { credentials: 'include' });
    if (!r.ok) return null;
    const map = await r.json();
    const keys = Object.keys(map || {}).filter(k => !k.startsWith('_'));
    if (!keys.length) return null;
    keys.forEach(k => lsSet(k, map[k]));
    return map;
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

  // 启动：云端优先恢复
  useEffect(() => {
    (async () => {
      const map = await cloudPull();
      if (map) {
        // 合并策略（防丢多端数据）：本地与云端都有内容时，保留项目数/库存数更多的一侧；
        // 本地胜出时仍标记已拉取，下次编辑全量推送即完成"多者为准"的合并
        const localCfg = lsGet<ProjectConfig>(LS_KEYS.config, { projects: {}, currentId: '' });
        const remoteCfg = map[LS_KEYS.config] as ProjectConfig | undefined;
        const localN = Object.keys(localCfg.projects || {}).length;
        const remoteN = remoteCfg ? Object.keys(remoteCfg.projects || {}).length : 0;
        if (remoteN >= localN) {
          if (remoteCfg) setConfig(remoteCfg);
          if (map[LS_KEYS.assets]) setAssets(map[LS_KEYS.assets] as RcAsset[]);
          if (map[LS_KEYS.dept]) setDept(map[LS_KEYS.dept] as { members: RcDeptMember[] });
          if (map[LS_KEYS.delivered]) setDelivered(map[LS_KEYS.delivered] as RcDelivered[]);
        } else {
          console.warn(`[rc-store] 本地 ${localN} 项目 > 云端 ${remoteN}，保留本地（下次编辑合并上云）`);
        }
        pulledRef.current = true;
        setCloud('ok');
      } else {
        setCloud('off');
      }
      setReady(true);
    })();
  }, []);

  // 防抖云端推送（本地已即时落 localStorage）。
  // P0 防护：pull 从未成功（off）期间挂起推送——新设备/清缓存场景下本地为空，
  // 贸然全量推送会把云端清空；此期间编辑仅存本地，待 pull 成功后恢复推送
  const pulledRef = useRef(false);
  const pushCloud = useCallback(() => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(async () => {
      if (!pulledRef.current) {
        console.warn('[rc-store] 云端基线未确认，推送挂起（本地已保存）');
        return;
      }
      setCloud('pushing');
      try {
        const body: Record<string, unknown> = {
          [LS_KEYS.config]: cfgRef.current,
          [LS_KEYS.assets]: assetsRef.current,
          [LS_KEYS.dept]: deptRef.current,
          [LS_KEYS.delivered]: delivRef.current,
        };
        // 锁定/密码键随主数据一并上云（多端锁定状态一致）
        for (const k of [LS_KEYS.assetsLock, LS_KEYS.deptLock, LS_KEYS.deliveredLock, LS_KEYS.deliveredPw]) {
          const raw = localStorage.getItem(k);
          if (raw != null) { try { body[k] = JSON.parse(raw); } catch { body[k] = raw; } }
        }
        const r = await fetch('/api/rc/store/bulk', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (r.status === 403) { setCloud('forbid'); return; }
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
  const setLock = useCallback((key: string, v: LockState) => { lsSet(key, v); pushCloud(); }, [pushCloud]);

  return {
    ready, cloud, config, assets, dept, delivered, currentProject,
    updateConfig, updateAssets, updateDept, updateDelivered, patchProject,
    getLock, setLock, pushCloud,
  };
}

export type RcStore = ReturnType<typeof useRcStore>;
