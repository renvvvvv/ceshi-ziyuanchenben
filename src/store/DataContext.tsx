import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import dayjs from 'dayjs';
import {
  projectsApi,
  teamMembersApi,
  historyProjectsApi,
  attendanceAdjustmentsApi,
} from '../api';
import {
  mockProjects,
  mockHistoryProjects,
  mockTeamMembers,
  mockTestDocs,
  mockProjectPhases,
  mockHistoryPhases,
  mockHistoryPhasesPartial,
  mockRegionMwOutput,
  docCategories,
} from '../data/mock';
import type {
  Project,
  HistoricalProject,
  TeamMember,
  MemberProject,
  TestDoc,
  ProjectPhase,
} from '../types';

/** 考勤校准记录：key = `${memberId}-${projectName}-${cycleStart}` */
export interface AttendanceAdjustment {
  projectStart?: string;
  projectEnd?: string;
  leaveDays?: number;
  position?: string;   // 项目级岗位
  attendDays?: number; // 直接录入的实际出勤（有值时优先于 onDuty-leave 推算）
}

// ============================================================
// localStorage 持久化 Hook
// ============================================================

// v2 前缀：强制让旧版缓存（zhwh_platform_）失效，避免旧 mock 数据覆盖后端正确数据
const STORAGE_PREFIX = 'zhwh_platform_v2_';

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // JSON 解析失败，使用 fallback
  }
  return fallback;
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // 存储失败（可能满了或隐私模式），静默忽略
  }
}

/** 持久化 useState：首次加载从 localStorage 读取，变更时防抖写入（避免大对象同步阻塞主线程） */
function usePersistentState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => loadFromStorage(key, initial));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    // 防抖写盘：500ms 内无新变更才写入，避免连续 setState 导致的同步 JSON.stringify 阻塞
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveToStorage(key, stateRef.current);
    }, 500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [key, state]);

  // 刷新/关标签时强制落盘：防抖窗口内的最后变更不再丢失
  useEffect(() => {
    const flush = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        saveToStorage(key, stateRef.current);
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [key]);

  return [state, setState];
}

// ============================================================
// Context 类型定义
// ============================================================

// 环境变量控制：生产环境默认禁用 mock fallback，避免 API 失败时静默回退到 mock 数据
// 设置 VITE_USE_MOCK_DATA=true 可显式启用（仅调试用）
const USE_MOCK_FALLBACK = import.meta.env.VITE_USE_MOCK_DATA === 'true';

interface DataContextValue {
  // 数据源（用于 UI 显示）：'mock' | 'api' | 'cache' | 'loading' | 'error'
  // - loading: 启动加载中
  // - api: 后端 API 成功返回
  // - cache: API 失败但 localStorage 有缓存（降级）
  // - mock: USE_MOCK_FALLBACK=true 且无缓存时用 mock（仅调试）
  // - error: API 失败且无缓存且禁用 mock fallback
  dataSource: 'mock' | 'api' | 'cache' | 'loading' | 'error';

  // 项目管理
  projects: Project[];
  setProjects: (value: Project[] | ((prev: Project[]) => Project[])) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  getProjectById: (id: string) => Project | undefined;
  // 显式归档（手动把"已完成"项目移到历史项目）
  archiveProject: (id: string, onDone?: (ok: boolean, reason?: string) => void) => boolean;

  // 历史项目
  historyProjects: HistoricalProject[];
  setHistoryProjects: (value: HistoricalProject[] | ((prev: HistoricalProject[]) => HistoricalProject[])) => void;
  addHistoryProject: (project: HistoricalProject, onDone?: (ok: boolean, reason?: string) => void, opts?: { adoptExisting?: boolean }) => void;
  updateHistoryProject: (id: string, updates: Partial<HistoricalProject>) => void;
  deleteHistoryProject: (id: string) => void;
  getHistoryProjectById: (id: string) => HistoricalProject | undefined;

  // 团队成员
  teamMembers: TeamMember[];
  setTeamMembers: (value: TeamMember[] | ((prev: TeamMember[]) => TeamMember[])) => void;
  addTeamMember: (member: TeamMember, onDone?: (ok: boolean, reason?: string) => void) => void;
  updateTeamMember: (id: string, updates: Partial<TeamMember>) => void;
  deleteTeamMember: (id: string) => void;

  // 测试文档
  testDocs: TestDoc[];
  setTestDocs: (value: TestDoc[] | ((prev: TestDoc[]) => TestDoc[])) => void;
  addTestDoc: (doc: TestDoc) => void;
  updateTestDoc: (id: string, updates: Partial<TestDoc>) => void;
  deleteTestDoc: (id: string) => void;

  // 项目阶段（时间线）—— 本地数据，无后端 API
  // 设计说明：projectPhases 存储每个项目的阶段时间线，当前仅 localStorage 持久化。
  // 如需多端共享，未来可扩展 /api/project-phases 路由。
  projectPhases: Record<string, ProjectPhase[]>;
  setProjectPhases: (value: Record<string, ProjectPhase[]> | ((prev: Record<string, ProjectPhase[]>) => Record<string, ProjectPhase[]>)) => void;

  // 历史项目阶段 —— 本地数据，无后端 API（同上）
  historyPhases: Record<string, ProjectPhase[]>;
  setHistoryPhases: (value: Record<string, ProjectPhase[]> | ((prev: Record<string, ProjectPhase[]>) => Record<string, ProjectPhase[]>)) => void;

  // 静态数据（不持久化，直接从 mock 读取）
  regionMwOutput: typeof mockRegionMwOutput;
  docCategoriesList: string[];

  // 数据管理
  resetToDefaults: () => void;

  // 自动化流程：根据日期自动转换项目状态
  autoProcessProjects: () => void;

  // 自动化流程：人员状态管理
  autoProcessMembers: () => void;
  syncMembersFromProjects: () => void;
  /** 重新从后端拉取全部数据（仪表盘"刷新"按钮用） */
  reload: () => void;
  attendanceAdjustments: Record<string, AttendanceAdjustment>;
  setAttendanceAdjustments: (updater: Record<string, AttendanceAdjustment> | ((prev: Record<string, AttendanceAdjustment>) => Record<string, AttendanceAdjustment>)) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

// ============================================================
// Provider 组件
// ============================================================

// 合并历史阶段数据（mockHistoryPhases + mockHistoryPhasesPartial）
const mergedHistoryPhases: Record<string, ProjectPhase[]> = {
  ...mockHistoryPhases,
  ...mockHistoryPhasesPartial,
};

/**
 * 项目改期 / 改名后，把成员侧照抄的那份项目信息对齐到项目表。
 * 只改条目里的项目名和起止日期：不增删条目、不改成员状态（指派和状态流转仍由原来的逻辑负责）。
 * 项目名对不上的条目（已归档、历史遗留）原样保留。没有变化的成员返回原对象（不触发多余渲染）。
 */
function alignMemberToProject(
  m: TeamMember, oldName: string, p: { name: string; startDate?: string; endDate?: string },
): TeamMember {
  const startDate = p.startDate || '';
  const endDate = p.endDate || '';
  let touched = false;
  const fix = (list: MemberProject[] | undefined): MemberProject[] | undefined => {
    if (!list) return list;
    return list.map((e) => {
      if (e.projectName !== oldName) return e;
      if (e.projectName === p.name && (e.startDate || '') === startDate && (e.endDate || '') === endDate) return e;
      touched = true;
      return { ...e, projectName: p.name, startDate, endDate };
    });
  };
  const proj = fix(m.projects);
  const upcoming = fix(m.upcomingProjects);
  const current = (m.currentProjects || []).map((n) => {
    if (n !== oldName || n === p.name) return n;
    touched = true;
    return p.name;
  });
  if (!touched) return m;
  return { ...m, projects: proj, upcomingProjects: upcoming, currentProjects: current };
}

export function DataProvider({ children }: { children: ReactNode }) {
  // ====== 持久化状态（localStorage 兜底，后端是主源） ======
  const [projects, setProjects] = usePersistentState<Project[]>('projects', mockProjects);
  const [historyProjects, setHistoryProjects] = usePersistentState<HistoricalProject[]>('historyProjects', mockHistoryProjects);
  const [teamMembers, setTeamMembers] = usePersistentState<TeamMember[]>('teamMembers', mockTeamMembers);
  // ref 快照：把 API 副作用从 setState updater 里挪出来（StrictMode/并发渲染会重放 updater 导致双发请求）
  const teamMembersRef = useRef(teamMembers);
  teamMembersRef.current = teamMembers;
  const [testDocs, setTestDocs] = usePersistentState<TestDoc[]>('testDocs', mockTestDocs);
  const [projectPhases, setProjectPhases] = usePersistentState<Record<string, ProjectPhase[]>>('projectPhases', mockProjectPhases);
  // phases 后端同步：记录已同步快照，变更防抖 PUT（localStorage 之外实现多账号共享）
  const phasesSyncedRef = useRef<Record<string, ProjectPhase[]> | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const cur = projectPhases;
      const synced = phasesSyncedRef.current || {};
      for (const pid of Object.keys(cur)) {
        // 只同步真实编号（后端主键是整数）。本地占位键——刚新建还没拿到编号、mock 示例数据——不能写进后端
        if (!/^\d+$/.test(pid)) continue;
        if (JSON.stringify(cur[pid]) === JSON.stringify(synced[pid])) continue;
        void fetch(`/api/projects/phases/${pid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phases: cur[pid] }),
        }).then((r) => {
          // 仅成功才标记已同步；失败保持脏标记，下次变更/重载时自动重试（防编辑永久丢失）
          if (r.ok) phasesSyncedRef.current = { ...(phasesSyncedRef.current || {}), [pid]: cur[pid] };
        }).catch(() => { /* 离线不置位，localStorage 兜底，下次重试 */ });
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [projectPhases]);
  const [historyPhases, setHistoryPhases] = usePersistentState<Record<string, ProjectPhase[]>>('historyPhases', mergedHistoryPhases);
  const histPhasesSyncedRef = useRef<Record<string, ProjectPhase[]> | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const cur = historyPhases;
      const synced = histPhasesSyncedRef.current || {};
      for (const pid of Object.keys(cur)) {
        // 同上：只同步真实编号。归档后的项目在拿到历史表真实编号之前用的是 arch_ 开头的占位键——
        // 项目表与历史表是两套独立编号，按项目表编号去写 h_<编号>，会覆盖历史表里同编号的另一条记录
        if (!/^\d+$/.test(pid)) continue;
        if (JSON.stringify(cur[pid]) === JSON.stringify(synced[pid])) continue;
        void fetch(`/api/projects/phases/h_${pid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ phases: cur[pid] }),
        }).then((r) => {
          if (r.ok) histPhasesSyncedRef.current = { ...(histPhasesSyncedRef.current || {}), [pid]: cur[pid] };
        }).catch(() => {});
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [historyPhases]);
  const [attendanceAdjustments, setAttendanceAdjustmentsRaw] = usePersistentState<Record<string, AttendanceAdjustment>>('attendanceAdjustments', {});

  /**
   * 包一层 setAttendanceAdjustments：
   * 1. 立即更新本地 state + localStorage（响应快）
   * 2. 异步同步到后端 attendance_adjustments 表（持久化）
   */
  const attendanceRef = useRef(attendanceAdjustments);
  attendanceRef.current = attendanceAdjustments;
  const setAttendanceAdjustments = useCallback((
    updater: Record<string, AttendanceAdjustment>
      | ((prev: Record<string, AttendanceAdjustment>) => Record<string, AttendanceAdjustment>)
  ) => {
    {
      const prev = attendanceRef.current;
      const next = typeof updater === 'function' ? updater(prev) : updater;
      attendanceRef.current = next; // 连续调用立即可见
      // 同步每个 key 到后端（best-effort，失败不阻塞 UI；副作用在 setState 之外，StrictMode 不再双发）
      // key 格式：${memberId}-${projectName}-${cycleStart}
      // cycleStart 是 YYYY-MM-DD 格式（含 -），不能用 split('-') 否则日期被截断
      for (const [key, value] of Object.entries(next)) {
        if (prev[key] && JSON.stringify(prev[key]) === JSON.stringify(value)) continue; // 未变
        // cycleStart 固定为 YYYY-MM-DD（10字符），从末尾截取
        const cycleStart = key.slice(-10);
        const rest = key.slice(0, key.length - 11); // 去掉 -YYYY-MM-DD
        const firstDash = rest.indexOf('-');
        if (firstDash < 0 || !cycleStart.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
        const memberId = rest.slice(0, firstDash);
        const projectName = rest.slice(firstDash + 1);
        if (!memberId || !projectName) continue;
        void attendanceAdjustmentsApi.upsert({
          memberId,
          projectName,
          cycleStart,
          projectStart: value.projectStart,
          projectEnd: value.projectEnd,
          leaveDays: value.leaveDays,
          position: value.position,
          attendDays: value.attendDays,
        }).catch((err) => console.warn('[DataContext] 考勤校准同步失败', key, err));
      }
      setAttendanceAdjustmentsRaw(next);
    }
  }, []);
  // 数据源标记：'mock' | 'api' | 'cache' | 'loading' | 'error'，用于 UI 显示数据来源
  const [dataSource, setDataSource] = useState<'mock' | 'api' | 'cache' | 'loading' | 'error'>('loading');

  // ====== 启动时从后端拉数据 ======
  // 策略：
  //   1. 异步 fetch /api/projects + /api/projects/members/list + /api/projects/history/list
  //   2. 成功时**完全覆盖**本地 → 实现多用户共享 + 让所有 id 同步成 DB 主键
  //   3. 失败时：
  //      - 若 localStorage 有缓存 → 降级到 cache（UI 可用但提示"离线模式"）
  //      - 若无缓存且 USE_MOCK_FALLBACK=true → 用 mock（仅调试）
  //      - 若无缓存且禁用 mock → 标记 error，UI 显示"加载失败"
  /** 拉全项目列表：后端单页上限 100 条，按 total 翻页取完。
   *  只取第一页的话，第 101 个项目起在仪表盘、项目列表、人员池下拉里消失，成员与这些项目的关联还会被“孤儿清理”删掉 */
  const fetchAllProjects = async (): Promise<Awaited<ReturnType<typeof projectsApi.list>>> => {
    const first = await projectsApi.list({ page: 1, size: 100 });
    const all = [...(first.data || [])];
    const total = first.total ?? all.length;
    for (let page = 2; all.length < total && page <= 100; page++) {
      const next = await projectsApi.list({ page, size: 100 });
      if (!next.data?.length) break;
      all.push(...next.data);
    }
    return { ...first, data: all, total };
  };

  const loadFromBackend = useCallback(async () => {
    try {
      {
        // allSettled：任一接口失败（如未登录时考勤接口 401）不再拖垮其余匿名可读数据的加载
        const [projR, memR, histR, attR, docsR, phR] = await Promise.allSettled([
          fetchAllProjects(),
          teamMembersApi.list(),
          historyProjectsApi.list(),
          attendanceAdjustmentsApi.list(),
          fetch('/api/test-docs', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
          fetch('/api/projects/phases', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
        ]);
        const projRes = projR.status === 'fulfilled' ? projR.value : undefined;
        const memRes = memR.status === 'fulfilled' ? memR.value : undefined;
        const histRes = histR.status === 'fulfilled' ? histR.value : undefined;
        const attRes = attR.status === 'fulfilled' ? attR.value : undefined;
        const docsRes = docsR.status === 'fulfilled' ? docsR.value : null;
        const phRes = phR.status === 'fulfilled' ? phR.value : null;

        // 诊断日志
        console.log('[DataContext] 后端加载结果:', {
          projSuccess: projRes?.success, projLen: projRes?.data?.length,
          histSuccess: histRes?.success, histLen: histRes?.data?.length,
          memSuccess: memRes?.success, memLen: memRes?.data?.length,
        });

        // 接口成功就以服务端为准，空列表也一样：否则表是空的时候，界面显示的是 mock 示例数据
        // 或上一个账号留在本机的缓存，角标却写着“api”
        // Projects：用后端覆盖本地（让 id 同步成 DB 主键）
        if (projRes?.success && Array.isArray(projRes.data)) {
          console.log('[DataContext] 用后端数据覆盖 projects:', projRes.data.length, '条');
          setProjects(projRes.data);
        }
        // Members：用后端覆盖本地
        if (memRes?.success && Array.isArray(memRes.data)) {
          setTeamMembers(memRes.data);
        }
        // History：用后端覆盖本地
        if (histRes?.success && Array.isArray(histRes.data)) {
          console.log('[DataContext] 用后端数据覆盖 historyProjects:', histRes.data.length, '条');
          setHistoryProjects(histRes.data);
        }

        // Attendance Adjustments：从后端加载并合并到本地（key 形式：memberId-projectName-cycleStart）
        if (attRes?.success && Array.isArray(attRes.data)) {
          const map: Record<string, AttendanceAdjustment> = {};
          for (const row of attRes.data as Array<Record<string, unknown>>) {
            const key = `${row.memberId}-${row.projectName}-${row.cycleStart}`;
            map[key] = {
              projectStart: row.projectStart as string | undefined,
              projectEnd: row.projectEnd as string | undefined,
              leaveDays: row.leaveDays as number | undefined,
              position: row.position as string | undefined,
              attendDays: row.attendDays as number | undefined,
            };
          }
          // 仅在后端有数据时覆盖本地，避免清掉 localStorage
          // 用 raw：这是服务端数据的本地落地，不应再触发"逐 key upsert 回服务端"
          if (Object.keys(map).length > 0) {
            setAttendanceAdjustmentsRaw(map);
          }
        }

        // TestDocs：后端 API 成功就覆盖本地（即使为空也覆盖，清除 mock 兜底数据）
        if (docsRes?.success && Array.isArray(docsRes.data)) {
          setTestDocs(docsRes.data);
        }

        // ProjectPhases（阶段/附件）：一次请求双用——普通键进 projectPhases，h_ 前缀键还原为历史项目 id
        // （此前请求两次同一接口，且 h_ 键被并入 projectPhases 触发孤儿清理反复删除）
        if (phRes?.success && phRes.data) {
          const projData: Record<string, ProjectPhase[]> = {};
          const histData: Record<string, ProjectPhase[]> = {};
          for (const [k, v] of Object.entries(phRes.data as Record<string, ProjectPhase[]>)) {
            if (k.startsWith('h_')) histData[k.slice(2)] = v;
            else projData[k] = v;
          }
          if (Object.keys(projData).length > 0) {
            setProjectPhases((prev) => ({ ...prev, ...projData }));
            phasesSyncedRef.current = { ...(phasesSyncedRef.current || {}), ...projData };
          }
          if (Object.keys(histData).length > 0) {
            setHistoryPhases((prev) => ({ ...prev, ...histData }));
            histPhasesSyncedRef.current = { ...(histPhasesSyncedRef.current || {}), ...histData };
          }
        }

        // 核心数据成功 → api；核心失败 → cache（localStorage 兜底）。考勤/文档为辅助数据，失败不影响判定
        const coreOk = Boolean(projRes?.success && memRes?.success);
        setDataSource(coreOk ? 'api' : 'cache');
        return coreOk;
      }
    } catch (err) {
      console.warn('[DataContext] 后端拉取失败:', err);
      return false;
      // 检查 localStorage 是否有缓存数据
      const hasCache = localStorage.getItem(STORAGE_PREFIX + 'projects');
      if (hasCache) {
        setDataSource('cache');
      } else if (USE_MOCK_FALLBACK) {
        setDataSource('mock');
      } else {
        setDataSource('error');
      }
    }
  }, []);

  useEffect(() => {
    void loadFromBackend();
  }, [loadFromBackend]);

  // 登录成功后重拉后端数据（密码登录是 SPA 页内跳转，不重拉会停留在旧缓存）
  useEffect(() => {
    const onLogin = () => { void loadFromBackend(); };
    window.addEventListener('auth:login', onLogin);
    return () => window.removeEventListener('auth:login', onLogin);
  }, [loadFromBackend]);

  // ====== 初始化：自动去重 historyProjects（修复历史数据污染） ======
  useEffect(() => {
    const seen = new Set<string>();
    const uniqueHistory = historyProjects.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    if (uniqueHistory.length < historyProjects.length) {
      setHistoryProjects(uniqueHistory);
    }
  }, []); // 只在挂载时执行一次

  // ====== 数据健康检查：清理孤儿数据（启动时跑一次） ======
  // 孤儿类型：
  //   1. projectPhases[id] 中 id 不存在于 projects + historyProjects（已删项目残留的 phases）
  //   2. teamMembers.currentProjects / projects / upcomingProjects 中包含已不存在的项目名
  useEffect(() => {
    if (dataSource === 'loading') return; // 等真实数据就绪再清理（挂载瞬间是 mock/缓存快照，误删会持久化）
    const validIds = new Set([
      ...projects.map((p) => p.id),
      ...historyProjects.map((p) => p.id),
    ]);
    const validNames = new Set([
      ...projects.map((p) => p.name),
      ...historyProjects.map((p) => p.name),
    ]);

    // 1. 清理孤儿 phases
    const orphanPhaseIds: string[] = [];
    for (const id of Object.keys(projectPhases)) {
      if (!validIds.has(id)) orphanPhaseIds.push(id);
    }
    if (orphanPhaseIds.length > 0) {
      setProjectPhases((prev) => {
        const next = { ...prev };
        for (const id of orphanPhaseIds) delete next[id];
        return next;
      });
      console.info(`[DataContext] data_health: 清理 ${orphanPhaseIds.length} 个孤儿 phases`);
    }

    // 2. 清理 teamMembers 中不存在的项目关联
    // ⚠️ effect 依赖含 teamMembers：updater 无变化时必须返回原引用，
    //    否则 map 的新数组引用会触发 effect 重跑 → 无限 setState 循环（启动卡死根因）
    setTeamMembers((prevMembers) => {
      let anyChanged = false;
      const next = prevMembers.map((m) => {
        const newProjects = (m.projects || []).filter((p) => validNames.has(p.projectName));
        const newCurrent = (m.currentProjects || []).filter((n) => validNames.has(n));
        const newUpcoming = (m.upcomingProjects || []).filter((up) => validNames.has(up.projectName));
        const changed =
          newProjects.length !== (m.projects || []).length ||
          newCurrent.length !== (m.currentProjects || []).length ||
          newUpcoming.length !== (m.upcomingProjects || []).length;
        if (changed) { anyChanged = true; }
        return changed
          ? { ...m, projects: newProjects, currentProjects: newCurrent, upcomingProjects: newUpcoming }
          : m;
      });
      return anyChanged ? next : prevMembers; // 原引用短路：无孤儿时不触发重渲染
    });
  }, [dataSource, projects, historyProjects, projectPhases, teamMembers, setProjectPhases, setTeamMembers, setHistoryProjects]); // 只在挂载时执行一次（projects + historyProjects + projectPhases 通过 setTeamMembers 链式更新）

  // ====== 项目 CRUD（同时调 API + 本地 state） ======
  const addProject = useCallback((project: Project) => {
    setProjects((prev) => [project, ...prev]);
    // 异步调后端 API
    void projectsApi.create(project).then((res) => {
      if (res?.success && res.id) {
        // 用后端返回的真实 id 替换本地 id（避免和 DB 自增 id 冲突）
        const realId = String(res.id);
        setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, id: realId } : p)));
      } else {
        // 创建失败回滚乐观插入（此前失败项目滞留本地临时 id，后续编辑只改本地、换设备即丢）
        setProjects((prev) => prev.filter((p) => p.id !== project.id));
      }
    }).catch(() => {
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    });
  }, [setProjects]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    const before = projects.find((p) => p.id === id) || null;
    const after = before ? { ...before, ...updates } : null;
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    // 项目改期 / 改名后，成员侧照抄的那份要跟着改：人员池卡片、考勤的应出勤读的都是成员里的这份日期。
    // 此前只有“尚未开始”的项目在项目列表页编辑时会被更新；进行中项目的日期、从详情页做的修改都不同步，
    // 换台电脑或刷新后又变回旧日期（服务器上的那份从没改过）
    if (before && after && (before.name !== after.name
      || (before.startDate || '') !== (after.startDate || '') || (before.endDate || '') !== (after.endDate || ''))) {
      const target = { name: after.name, startDate: after.startDate, endDate: after.endDate };
      setTeamMembers((prev) => prev.map((m) => alignMemberToProject(m, before.name, target)));
      // 同步到服务器，别的电脑、别的账号也能看到；只发内容有变化的成员
      for (const m of teamMembersRef.current) {
        const next = alignMemberToProject(m, before.name, target);
        if (next === m) continue;
        void teamMembersApi.update(m.id, { projects: next.projects, upcomingProjects: next.upcomingProjects, currentProjects: next.currentProjects })
          .catch((err) => console.warn('[DataContext] 项目改期后同步成员的项目日期失败', m.id, err));
      }
    }
    // 调后端 API（id 是 DB 自增 int）
    const dbId = parseInt(id, 10);
    if (!Number.isNaN(dbId)) {
      void projectsApi.update(String(dbId), updates);
    }
  }, [projects, setProjects, setTeamMembers]);

  const deleteProject = useCallback((id: string) => {
    // 删除前先找到项目信息（用于清理 teamMembers 关联）
    const project = projects.find((p) => p.id === id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    // 清理阶段数据（孤儿数据）
    setProjectPhases((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // 清理相关人员的项目关联
    if (project) {
      const projectName = project.name;
      const assignedIds = project.assignedMemberIds || [];
      setTeamMembers((prevMembers) =>
        prevMembers.map((m) => {
          if (!assignedIds.includes(m.id)) return m;
          const newProjects = (m.projects || []).filter((p) => p.projectName !== projectName);
          const newCurrent = (m.currentProjects || []).filter((p) => p !== projectName);
          const newUpcoming = (m.upcomingProjects || []).filter((up) => up.projectName !== projectName);
          return {
            ...m,
            projects: newProjects,
            currentProjects: newCurrent,
            upcomingProjects: newUpcoming,
          };
        })
      );
    }
    const dbId = parseInt(id, 10);
    if (!Number.isNaN(dbId)) {
      void projectsApi.remove(String(dbId));
    }
  }, [projects, setProjects, setProjectPhases, setTeamMembers]);

  const getProjectById = useCallback((id: string) => projects.find((p) => p.id === id), [projects]);

  // ====== 历史项目 CRUD ======
  /**
   * 新增历史项目：先乐观插入占位行，接口返回后再换成后端真实编号；失败则撤回占位行并通过 onDone 告知原因。
   * opts.adoptExisting：归档场景用——项目转“已完成”时后端已自动写过一条同名记录，再创建必然 409；
   * 这时确认是同一个项目（客户、起止日期一致）就沿用那条记录并用项目的最新字段刷新它，阶段数据换到它的编号下。
   */
  const addHistoryProject = useCallback((
    project: HistoricalProject,
    onDone?: (ok: boolean, reason?: string) => void,
    opts?: { adoptExisting?: boolean },
  ) => {
    const tempId = project.id;
    setHistoryProjects((prev) => (prev.some((p) => p.id === tempId) ? prev : [project, ...prev]));
    (async () => {
      let realId: string | null = null;
      let failure: string | undefined;
      let existing: HistoricalProject | undefined;
      try {
        const res = await historyProjectsApi.create(project);
        if (res?.success && res.id) realId = String(res.id);
        else failure = '后端没有返回记录编号';
      } catch (e: any) {
        // request() 对非 2xx 是抛错：同名 409 的回查必须放在这里（此前写在 .then 里，对真正的 409 永远执行不到，
        // 归档后的项目就一直带着项目表的编号，阶段数据被写到历史表里同编号的另一条记录上）
        if (e?.statusCode === 409) {
          try {
            const list = await historyProjectsApi.list();
            existing = (list.data || []).find((p) => p.name === project.name);
            if (existing && existing.id !== undefined && existing.id !== null) realId = String(existing.id);
          } catch { /* 回查失败：按没拿到编号处理 */ }
          if (!realId) failure = '历史项目中已有同名记录，但没能取到它的编号';
        } else {
          failure = e?.message || '创建历史项目失败';
        }
      }
      if (realId && existing && !opts?.adoptExisting) {
        failure = `历史项目中已有同名项目「${project.name}」`;
        realId = null;
      }
      if (realId && existing && opts?.adoptExisting) {
        // 同名 ≠ 同一个项目：客户或起止日期对不上，说明历史里那条是以前另一个同名项目，不能把它的记录改成这个项目
        const same = (existing.customer || '') === (project.customer || '')
          && (existing.startDate || '') === (project.startDate || '')
          && (existing.endDate || '') === (project.endDate || '');
        if (!same) {
          failure = `历史项目中已有同名的另一条记录「${project.name}」（客户或起止日期不同），无法归档。请先修改名称，或处理那条历史记录`;
          realId = null;
        }
      }
      if (!realId) {
        // 没拿到真实编号：撤回占位行。否则它会带着一个假编号留在列表里，之后的编辑、删除都会打到错误的记录上
        setHistoryProjects((prev) => prev.filter((p) => p.id !== tempId));
        onDone?.(false, failure);
        return;
      }
      const rid = realId;
      // 归档沿用既有记录时，用项目当前的字段刷新它（自动归档写的是转“已完成”那一刻的快照，之后补录的信息进不来）
      if (existing) {
        try { await historyProjectsApi.update(rid, project); } catch { /* 刷新失败不影响归档结果 */ }
      }
      setHistoryProjects((prev) => prev
        .filter((p) => p.id === tempId || String(p.id) !== rid)
        .map((p) => (p.id === tempId ? { ...p, id: rid } : p)));
      // 阶段数据换键：占位键 → 真实编号。目标记录已经有阶段数据时不覆盖
      setHistoryPhases((prev) => {
        if (!prev[tempId]) return prev;
        const next = { ...prev };
        const moving = next[tempId];
        delete next[tempId];
        if (!next[rid]) next[rid] = moving;
        return next;
      });
      onDone?.(true);
    })();
  }, [setHistoryProjects, setHistoryPhases]);
  const updateHistoryProject = useCallback((id: string, updates: Partial<HistoricalProject>) => {
    setHistoryProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    // 调后端 API（id 是 DB 主键 int）
    const dbId = parseInt(id, 10);
    if (!Number.isNaN(dbId)) {
      void historyProjectsApi.update(String(dbId), updates);
    }
  }, [setHistoryProjects]);

  const deleteHistoryProject = useCallback((id: string) => {
    setHistoryProjects((prev) => prev.filter((p) => p.id !== id));
    const dbId = parseInt(id, 10);
    if (!Number.isNaN(dbId)) {
      void historyProjectsApi.remove(String(dbId));
    }
  }, [setHistoryProjects]);

  const getHistoryProjectById = useCallback((id: string) => historyProjects.find((p) => p.id === id), [historyProjects]);

  // ====== 团队成员 CRUD ======
  const addTeamMember = useCallback((member: TeamMember, onDone?: (ok: boolean, reason?: string) => void) => {
    // 乐观更新本地（用传入的 id 作为临时 id）
    setTeamMembers((prev) => [...prev, member]);
    const tempId = member.id;
    // 调后端 API
    void teamMembersApi.create(member).then((res) => {
      if (res?.success && res.id) {
        const realId = String(res.id);
        setTeamMembers((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: realId } : m)));
        onDone?.(true);
        return;
      }
      // 后端没给编号：撤回乐观插入的那一行
      setTeamMembers((prev) => prev.filter((m) => m.id !== tempId));
      onDone?.(false, '后端没有返回成员编号');
    }, (e: any) => {
      // 工号重复（409）等失败：撤回那一行并告知原因。此前既不回滚也不提示，
      // 成员一直带着临时编号留在列表里，之后的编辑都写不进后端
      setTeamMembers((prev) => prev.filter((m) => m.id !== tempId));
      onDone?.(false, e?.message || '添加成员失败');
    });
  }, [setTeamMembers]);

  const updateTeamMember = useCallback((id: string, updates: Partial<TeamMember>) => {
    setTeamMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
    // id 是 DB 主键 int 时才更新后端
    const dbId = parseInt(id, 10);
    if (!Number.isNaN(dbId)) {
      void teamMembersApi.update(String(dbId), updates);
    }
  }, [setTeamMembers]);

  const deleteTeamMember = useCallback((id: string) => {
    setTeamMembers((prev) => prev.filter((m) => m.id !== id));
    const dbId = parseInt(id, 10);
    if (!Number.isNaN(dbId)) {
      void teamMembersApi.remove(String(dbId));
    }
  }, [setTeamMembers]);

  // ====== 测试文档 CRUD（本地数据，无后端 API —— TestGuide 页面的文档目录元数据） ======
  // 设计说明：testDocs 是 TestGuide 页面用来展示已上传文档列表的本地元数据
  // （文件名/分类/上传时间等），实际文件内容存储在浏览器 localStorage。
  // 如需多端共享，未来可扩展 /api/test-docs 路由，当前设计为单端使用。
  const addTestDoc = useCallback((doc: TestDoc) => {
    setTestDocs((prev) => [doc, ...prev]);
  }, [setTestDocs]);

  const updateTestDoc = useCallback((id: string, updates: Partial<TestDoc>) => {
    setTestDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...updates } : d)));
  }, [setTestDocs]);

  const deleteTestDoc = useCallback((id: string) => {
    setTestDocs((prev) => prev.filter((d) => d.id !== id));
  }, [setTestDocs]);

  // ====== 自动化流程：根据日期自动转换项目状态（不归档，只改状态） ======
  // 设计变更（2026-07-19）：
  //   - 之前会把"已完成"项目自动从 projects 移到 historyProjects，导致误点"已完成"无法恢复
  //   - 现在改为：autoProcessProjects 只根据日期自动更新状态（未开始→测试中、测试中→已完成）
  //   - "已完成"项目保留在 projects 列表（被 Projects 页面过滤掉，但可通过"已完成"Tab 查看）
  //   - 显式归档用 archiveProject(id)，由 Projects 页面"归档到历史"按钮触发
  // 防止 autoProcess 在自身 setState 触发 useEffect 重跑时再次执行（循环依赖保护）
  // 注意：两个函数必须各用独立锁——共享锁 + setTimeout 异步释放会导致紧随其后
  // 同步调用的 autoProcessMembers 永远看到锁被占用而直接返回（死代码）
  const isAutoProcessingProjectsRef = useRef(false);
  const isAutoProcessingMembersRef = useRef(false);

  // 设计变更（2026-07-19 晚）：
  //   - 之前只改前端 state 不调 API → 刷新后从 DB 拉回旧值，用户看到状态变回去
  //   - 现在改完后遍历 changed 调 projectsApi.update / teamMembersApi.update 同步到 DB
  const autoProcessProjects = useCallback(() => {
    if (isAutoProcessingProjectsRef.current) return;
    isAutoProcessingProjectsRef.current = true;
    try {
      const todayStr = dayjs().format('YYYY-MM-DD');

      let changed = false;
      const updatedProjects: Project[] = [];
      const changedIds: string[] = [];

      for (const p of projects) {
        // 无开始日期的项目不参与自动流转（空字符串 <= 今天 恒为 true，会误转状态）
        if (!p.startDate) { updatedProjects.push(p); continue; }
        if (p.status === '未开始' && p.startDate <= todayStr) {
          if (p.endDate && p.endDate < todayStr) {
            updatedProjects.push({ ...p, status: '已完成' as const, actualDeliveryDate: p.endDate, updatedAt: dayjs().format('YYYY-MM-DD') });
            changed = true;
            changedIds.push(p.id);
          } else {
            updatedProjects.push({ ...p, status: '测试中' as const, updatedAt: dayjs().format('YYYY-MM-DD') });
            changed = true;
            changedIds.push(p.id);
          }
          continue;
        }

        if (p.status === '测试中' && p.endDate && p.endDate < todayStr) {
          updatedProjects.push({ ...p, status: '已完成' as const, actualDeliveryDate: p.endDate, updatedAt: dayjs().format('YYYY-MM-DD') });
          changed = true;
          changedIds.push(p.id);
          continue;
        }

        updatedProjects.push(p);
      }

      if (!changed) return;

      setProjects(updatedProjects);

      // 同步 DB：对每个 changed 项目调 API 持久化
      for (const updated of updatedProjects) {
        if (!changedIds.includes(updated.id)) continue;
        const dbId = parseInt(updated.id, 10);
        if (Number.isNaN(dbId)) continue;
        void projectsApi.update(String(dbId), {
          status: updated.status,
          actualDeliveryDate: updated.actualDeliveryDate,
          updatedAt: updated.updatedAt,
        }).catch((err) => console.warn('[autoProcessProjects] 同步失败', updated.id, err));
      }

      const projectsToStart = updatedProjects.filter(
        (p) => p.status === '测试中' && projects.some((orig) => orig.id === p.id && orig.status === '未开始')
      );
      if (projectsToStart.length > 0) {
        const prevMembers = teamMembersRef.current;
        {
          const newMembers = prevMembers.map((m) => {
            const assignedToStarted = projectsToStart.filter((p) => (p.assignedMemberIds || []).includes(m.id));
            if (assignedToStarted.length === 0) return m;
            const newProjects = [...(m.projects || [])];
            const newCurrentProjects = [...m.currentProjects];
            const newUpcoming = [...(m.upcomingProjects || [])];
            assignedToStarted.forEach((p) => {
              const projectName = p.name;
              const idx = newUpcoming.findIndex((up) => up.projectName === projectName);
              if (idx >= 0) newUpcoming.splice(idx, 1);
              if (!newProjects.find((np) => np.projectName === projectName)) {
                newProjects.push({ projectName, startDate: p.startDate, endDate: p.endDate });
              }
              if (!newCurrentProjects.includes(projectName)) {
                newCurrentProjects.push(projectName);
              }
            });
            return { ...m, status: m.status === '休假' ? m.status : '测试中' as const, projects: newProjects, currentProjects: newCurrentProjects, upcomingProjects: newUpcoming };
          });

          // 同步到 DB（副作用已在 setState 之外）
          let memberChanged = false;
          for (const m of newMembers) {
            const orig = prevMembers.find((o) => o.id === m.id);
            if (!orig) continue;
            if (JSON.stringify(orig.currentProjects) !== JSON.stringify(m.currentProjects) || orig.status !== m.status) {
              memberChanged = true;
              const dbId = parseInt(m.id, 10);
              if (Number.isNaN(dbId)) continue;
              void teamMembersApi.update(String(dbId), { status: m.status, currentProjects: m.currentProjects || [] })
                .catch((err) => console.warn('[autoProcessProjects] 成员同步失败', m.id, err));
            }
          }
          if (memberChanged) setTeamMembers(newMembers);
        }
      }
    } finally {
      isAutoProcessingProjectsRef.current = false;
    }
  }, [projects, setProjects, setTeamMembers]);

  // ====== 显式归档：把"已完成"项目从 projects 移到 historyProjects（用户主动操作） ======
  // 返回 false 表示前置条件不满足（项目不存在或不是“已完成”）；真正成败在拿到后端结果后通过 onDone 告知
  const archiveProject = useCallback((
    id: string,
    onDone?: (ok: boolean, reason?: string) => void,
  ): boolean => {
    const project = projects.find((p) => p.id === id);
    if (!project) return false;
    if (project.status !== '已完成') return false;

    // 占位 id 用非数字前缀：阶段数据的后端同步只认数字键（真实编号）。拿到历史表真实编号之前，
    // 阶段数据只留在本地，不会按项目表编号写到历史表里同编号的另一条记录上（两张表是两套独立编号）
    const tempId = `arch_${id}`;
    const phases = projectPhases[id];

    addHistoryProject(
      { ...project, id: tempId, updatedAt: dayjs().format('YYYY-MM-DD') },
      (ok, reason) => {
        if (!ok) {
          // 没归档成：项目放回列表、阶段数据放回原处（界面恢复原状，并给出原因）
          setProjects((prev) => (prev.some((p) => p.id === id) ? prev : [project, ...prev]));
          if (phases) setProjectPhases((prev) => (prev[id] ? prev : { ...prev, [id]: phases }));
          onDone?.(false, reason);
          return;
        }
        // 归档成功后才清理成员关联：从成员的 projects/currentProjects 移除本项目；
        // 无其他进行中项目则转空闲（否则成员会永远卡在"测试中"）。DB 侧同步由 autoProcessMembers / 下次加载兜底
        const memberIds = project.assignedMemberIds || [];
        if (memberIds.length > 0) {
          setTeamMembers((prev) => prev.map((m) => {
            if (!memberIds.includes(m.id)) return m;
            const restProjects = (m.projects || []).filter((mp) => mp.projectName !== project.name);
            const restCurrent = (m.currentProjects || []).filter((cp) => cp !== project.name);
            const restUpcoming = (m.upcomingProjects || []).filter((up) => up.projectName !== project.name);
            const newStatus = m.status === '休假' ? m.status
              : restProjects.length > 0 ? '测试中' as const : '空闲' as const;
            return { ...m, projects: restProjects, currentProjects: restCurrent, upcomingProjects: restUpcoming, status: newStatus };
          }));
        }
        onDone?.(true);
      },
      { adoptExisting: true },
    );

    // 乐观更新：先从项目列表移走，阶段数据挪到历史侧的占位键下（拿到真实编号后 addHistoryProject 会换键）
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (phases) {
      setHistoryPhases((prev) => ({ ...prev, [tempId]: phases }));
      setProjectPhases((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    return true;
  }, [projects, projectPhases, addHistoryProject, setProjects, setProjectPhases, setHistoryPhases, setTeamMembers]);

  // ====== 自动化流程：人员状态管理（2026-07-19 晚：同步 DB）======
  const autoProcessMembers = useCallback(() => {
    if (isAutoProcessingMembersRef.current) return;
    isAutoProcessingMembersRef.current = true;
    try {
    const todayStr = dayjs().format('YYYY-MM-DD');

    const prevMembers = teamMembersRef.current;
    {
      const updates: { memberId: string; updates: Record<string, unknown> }[] = [];

      const updatedMembers = prevMembers.map((m) => {
        // 1. 测试中 → 空闲（项目结束日期已过；缺结束日期的项目条目不算已结束，避免误判）
        if (m.status === '测试中') {
          const projects = m.projects || [];
          const allProjectsFinished = projects.length > 0 && projects.every(
            (p) => p.endDate != null && p.endDate !== '' && p.endDate < todayStr
          );
          if (allProjectsFinished) {
            updates.push({ memberId: m.id, updates: { status: '空闲', currentProjects: [] } });
            return {
              ...m,
              status: '空闲' as const,
              currentProjects: [],
              updatedAt: new Date().toISOString(),
            };
          }
        }

        // 2. 休假 → 空闲（休假结束日期已过）
        if (m.status === '休假') {
          if (m.leaveEndDate && m.leaveEndDate < todayStr) {
            updates.push({ memberId: m.id, updates: { status: '空闲', leaveStartDate: null, leaveEndDate: null } });
            return {
              ...m,
              status: '空闲' as const,
              leaveStartDate: undefined,
              leaveEndDate: undefined,
              updatedAt: new Date().toISOString(),
            };
          }
        }

        return m;
      });

      if (updates.length > 0) {
        // 副作用在 setState 之外（updater 必须是纯函数）
        for (const { memberId, updates: fields } of updates) {
          const dbId = parseInt(memberId, 10);
          if (Number.isNaN(dbId)) continue;
          void teamMembersApi.update(String(dbId), fields)
            .catch((err) => console.warn('[autoProcessMembers] 同步失败', memberId, err));
        }
        setTeamMembers(updatedMembers);
      }
    }
    } finally {
      isAutoProcessingMembersRef.current = false;
    }
  }, [setTeamMembers]);

  // ====== 同步人员项目数据：根据 projects 的 assignedMemberIds + 项目时间自动生成人员的 projects/upcomingProjects/状态 ======
  const syncMembersFromProjects = useCallback(() => {
    const today = dayjs().format('YYYY-MM-DD');
    // 日期有效的项目才参与同步（无日期项目的日期比较结果不可靠，会把测试中成员误清空）
    const dated = projects.filter((p) => p.status !== '已完成' && p.startDate);
    // 进行中：startDate <= today 且（endDate 缺失视为进行中 或 endDate >= today）；状态为"测试中"的无日期项目也视为进行中
    const activeProjs = dated.filter((p) =>
      p.startDate <= today && (!p.endDate || p.endDate >= today));
    const undatedActive = projects.filter((p) => p.status === '测试中' && !p.startDate);
    const activeAll = [...activeProjs, ...undatedActive];
    // 未开始：startDate > today
    const upcomingProjs = dated.filter((p) => p.startDate > today);

    setTeamMembers((prev) =>
      prev.map((m) => {
        const memberActive = activeAll.filter((p) => (p.assignedMemberIds || []).includes(m.id));
        const memberUpcoming = upcomingProjs.filter((p) => (p.assignedMemberIds || []).includes(m.id));

        const newProjects = memberActive.map((p) => ({ projectName: p.name, startDate: p.startDate, endDate: p.endDate }));
        const newUpcoming = memberUpcoming.map((p) => ({ projectName: p.name, startDate: p.startDate, endDate: p.endDate }));
        const newCurrent = memberActive.map((p) => p.name);

        // 状态：休假保持；有进行中项目→测试中；否则→空闲
        let newStatus = m.status;
        if (m.status !== '休假') {
          newStatus = memberActive.length > 0 ? ('测试中' as const) : ('空闲' as const);
        }

        return { ...m, projects: newProjects, currentProjects: newCurrent, upcomingProjects: newUpcoming, status: newStatus };
      }),
    );
  }, [projects, setTeamMembers]);

  // 初始化时同步一次
  useEffect(() => {
    syncMembersFromProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetToDefaults = useCallback(() => {
    setProjects(mockProjects);
    setHistoryProjects(mockHistoryProjects);
    setTeamMembers(mockTeamMembers);
    setTestDocs(mockTestDocs);
    setProjectPhases(mockProjectPhases);
    setHistoryPhases(mergedHistoryPhases);
  }, [setProjects, setHistoryProjects, setTeamMembers, setTestDocs, setProjectPhases, setHistoryPhases]);

  const value: DataContextValue = useMemo(() => ({
    dataSource,
    projects,
    setProjects,
    addProject,
    updateProject,
    deleteProject,
    getProjectById,
    archiveProject,
    historyProjects,
    setHistoryProjects,
    addHistoryProject,
    updateHistoryProject,
    deleteHistoryProject,
    getHistoryProjectById,
    teamMembers,
    setTeamMembers,
    addTeamMember,
    updateTeamMember,
    deleteTeamMember,
    testDocs,
    setTestDocs,
    addTestDoc,
    updateTestDoc,
    deleteTestDoc,
    projectPhases,
    setProjectPhases,
    historyPhases,
    setHistoryPhases,
    regionMwOutput: mockRegionMwOutput,
    docCategoriesList: docCategories,
    resetToDefaults,
    autoProcessProjects,
    autoProcessMembers,
    syncMembersFromProjects,
    reload: loadFromBackend,
    attendanceAdjustments,
    setAttendanceAdjustments,
  }), [
    dataSource, projects, setProjects, addProject, updateProject, deleteProject,
    getProjectById, archiveProject, historyProjects, setHistoryProjects,
    addHistoryProject, updateHistoryProject, deleteHistoryProject, getHistoryProjectById, loadFromBackend,
    teamMembers, setTeamMembers, addTeamMember, updateTeamMember, deleteTeamMember,
    testDocs, setTestDocs, addTestDoc, updateTestDoc, deleteTestDoc,
    projectPhases, setProjectPhases, historyPhases, setHistoryPhases,
    mockRegionMwOutput, docCategories, resetToDefaults,
    autoProcessProjects, autoProcessMembers, syncMembersFromProjects,
    attendanceAdjustments, setAttendanceAdjustments,
  ]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

// ============================================================
// 消费 Hook
// ============================================================

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useData must be used within a DataProvider');
  }
  return ctx;
}
