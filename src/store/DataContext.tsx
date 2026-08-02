import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
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

/** 持久化 useState：首次加载从 localStorage 读取，变更时自动写入 */
function usePersistentState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => loadFromStorage(key, initial));

  useEffect(() => {
    saveToStorage(key, state);
  }, [key, state]);

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
  archiveProject: (id: string) => boolean;

  // 历史项目
  historyProjects: HistoricalProject[];
  setHistoryProjects: (value: HistoricalProject[] | ((prev: HistoricalProject[]) => HistoricalProject[])) => void;
  addHistoryProject: (project: HistoricalProject) => void;
  updateHistoryProject: (id: string, updates: Partial<HistoricalProject>) => void;
  deleteHistoryProject: (id: string) => void;
  getHistoryProjectById: (id: string) => HistoricalProject | undefined;

  // 团队成员
  teamMembers: TeamMember[];
  setTeamMembers: (value: TeamMember[] | ((prev: TeamMember[]) => TeamMember[])) => void;
  addTeamMember: (member: TeamMember) => void;
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

export function DataProvider({ children }: { children: ReactNode }) {
  // ====== 持久化状态（localStorage 兜底，后端是主源） ======
  const [projects, setProjects] = usePersistentState<Project[]>('projects', mockProjects);
  const [historyProjects, setHistoryProjects] = usePersistentState<HistoricalProject[]>('historyProjects', mockHistoryProjects);
  const [teamMembers, setTeamMembers] = usePersistentState<TeamMember[]>('teamMembers', mockTeamMembers);
  const [testDocs, setTestDocs] = usePersistentState<TestDoc[]>('testDocs', mockTestDocs);
  const [projectPhases, setProjectPhases] = usePersistentState<Record<string, ProjectPhase[]>>('projectPhases', mockProjectPhases);
  const [historyPhases, setHistoryPhases] = usePersistentState<Record<string, ProjectPhase[]>>('historyPhases', mergedHistoryPhases);
  const [attendanceAdjustments, setAttendanceAdjustmentsRaw] = usePersistentState<Record<string, AttendanceAdjustment>>('attendanceAdjustments', {});

  /**
   * 包一层 setAttendanceAdjustments：
   * 1. 立即更新本地 state + localStorage（响应快）
   * 2. 异步同步到后端 attendance_adjustments 表（持久化）
   */
  const setAttendanceAdjustments = useCallback((
    updater: Record<string, AttendanceAdjustment>
      | ((prev: Record<string, AttendanceAdjustment>) => Record<string, AttendanceAdjustment>)
  ) => {
    setAttendanceAdjustmentsRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // 同步每个 key 到后端（best-effort，失败不阻塞 UI）
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
      return next;
    });
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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projRes, memRes, histRes, attRes, docsRes] = await Promise.all([
          projectsApi.list({ page: 1, size: 500 }),
          teamMembersApi.list(),
          historyProjectsApi.list(),
          attendanceAdjustmentsApi.list(),
          fetch('/api/test-docs', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
        ]);
        if (cancelled) return;

        // 诊断日志
        console.log('[DataContext] 后端加载结果:', {
          projSuccess: projRes?.success, projLen: projRes?.data?.length,
          histSuccess: histRes?.success, histLen: histRes?.data?.length,
          memSuccess: memRes?.success, memLen: memRes?.data?.length,
        });

        // Projects：后端有数据 → 用后端覆盖本地（让 id 同步成 DB 主键）
        if (projRes?.success && projRes.data && projRes.data.length > 0) {
          console.log('[DataContext] 用后端数据覆盖 projects:', projRes.data.length, '条');
          setProjects(projRes.data);
        }
        // Members：后端有数据 → 用后端覆盖本地
        if (memRes?.success && memRes.data && memRes.data.length > 0) {
          setTeamMembers(memRes.data);
        }
        // History：后端有数据 → 用后端覆盖本地
        if (histRes?.success && histRes.data && histRes.data.length > 0) {
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
          if (Object.keys(map).length > 0) {
            setAttendanceAdjustments(map);
          }
        }

        // TestDocs：后端有数据 → 用后端覆盖本地（实现多用户共享）
        if (docsRes?.success && Array.isArray(docsRes.data) && docsRes.data.length > 0) {
          setTestDocs(docsRes.data);
        }

        // 全部成功 → 数据源 = api；任意失败 → cache（用 localStorage 兜底）
        const allOk = projRes && memRes && histRes && attRes;
        setDataSource(allOk ? 'api' : 'cache');
      } catch (err) {
        console.warn('[DataContext] 后端拉取失败:', err);
        if (cancelled) return;
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
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    let memberCleanCount = 0;
    setTeamMembers((prevMembers) =>
      prevMembers.map((m) => {
        const newProjects = (m.projects || []).filter((p) => validNames.has(p.projectName));
        const newCurrent = (m.currentProjects || []).filter((n) => validNames.has(n));
        const newUpcoming = (m.upcomingProjects || []).filter((up) => validNames.has(up.projectName));
        const changed =
          newProjects.length !== (m.projects || []).length ||
          newCurrent.length !== (m.currentProjects || []).length ||
          newUpcoming.length !== (m.upcomingProjects || []).length;
        if (changed) memberCleanCount += 1;
        return changed
          ? { ...m, projects: newProjects, currentProjects: newCurrent, upcomingProjects: newUpcoming }
          : m;
      })
    );
    if (memberCleanCount > 0) {
      console.info(`[DataContext] data_health: 清理 ${memberCleanCount} 个成员的孤儿项目关联`);
    }
  }, []); // 只在挂载时执行一次（projects + historyProjects + projectPhases 通过 setTeamMembers 链式更新）

  // ====== 项目 CRUD（同时调 API + 本地 state） ======
  const addProject = useCallback((project: Project) => {
    setProjects((prev) => [project, ...prev]);
    // 异步调后端 API
    void projectsApi.create(project).then((res) => {
      if (res?.success && res.id) {
        // 用后端返回的真实 id 替换本地 id（避免和 DB 自增 id 冲突）
        const realId = String(res.id);
        setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, id: realId } : p)));
      }
    });
  }, [setProjects]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    // 调后端 API（id 是 DB 自增 int）
    const dbId = parseInt(id, 10);
    if (!Number.isNaN(dbId)) {
      void projectsApi.update(String(dbId), updates);
    }
  }, [setProjects]);

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
  const addHistoryProject = useCallback((project: HistoricalProject) => {
    setHistoryProjects((prev) => {
      if (prev.some((p) => p.id === project.id)) return prev;
      return [project, ...prev];
    });
    // 历史项目目前调 projectsApi.create（同张表），实际应调 historyProjectsApi
    void historyProjectsApi.create(project).then((res) => {
      if (res?.success && res.id) {
        const realId = String(res.id);
        setHistoryProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, id: realId } : p)));
      }
    });
  }, [setHistoryProjects]);

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
  const addTeamMember = useCallback((member: TeamMember) => {
    // 乐观更新本地（用传入的 id 作为临时 id）
    setTeamMembers((prev) => [...prev, member]);
    // 调后端 API
    void teamMembersApi.create(member).then((res) => {
      if (res?.success && res.id) {
        const realId = String(res.id);
        setTeamMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, id: realId } : m)));
      }
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
  const isAutoProcessingRef = useRef(false);

  // 设计变更（2026-07-19 晚）：
  //   - 之前只改前端 state 不调 API → 刷新后从 DB 拉回旧值，用户看到状态变回去
  //   - 现在改完后遍历 changed 调 projectsApi.update / teamMembersApi.update 同步到 DB
  const autoProcessProjects = useCallback(() => {
    if (isAutoProcessingRef.current) return;
    isAutoProcessingRef.current = true;
    try {
      const todayStr = dayjs().format('YYYY-MM-DD');

      let changed = false;
      const updatedProjects: Project[] = [];
      const changedIds: string[] = [];

      for (const p of projects) {
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
        setTeamMembers((prevMembers) => {
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

          // 同步到 DB
          for (const m of newMembers) {
            const orig = prevMembers.find((o) => o.id === m.id);
            if (!orig) continue;
            if (JSON.stringify(orig.currentProjects) !== JSON.stringify(m.currentProjects) || orig.status !== m.status) {
              const dbId = parseInt(m.id, 10);
              if (Number.isNaN(dbId)) continue;
              void teamMembersApi.update(String(dbId), { status: m.status, currentProjects: m.currentProjects || [] })
                .catch((err) => console.warn('[autoProcessProjects] 成员同步失败', m.id, err));
            }
          }
          return newMembers;
        });
      }
    } finally {
      setTimeout(() => { isAutoProcessingRef.current = false; }, 0);
    }
  }, [projects, setProjects, setTeamMembers]);

  // ====== 显式归档：把"已完成"项目从 projects 移到 historyProjects（用户主动操作） ======
  const archiveProject = useCallback((id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return false;
    if (project.status !== '已完成') return false;

    // 1. 添加到 historyProjects
    const archived: HistoricalProject = {
      ...project,
      id: project.id,
      updatedAt: dayjs().format('YYYY-MM-DD'),
    };
    addHistoryProject(archived);

    // 2. 从 projects 移除
    setProjects((prev) => prev.filter((p) => p.id !== id));

    // 3. 转移阶段数据
    if (projectPhases[id]) {
      setHistoryPhases((prev) => ({ ...prev, [id]: projectPhases[id] }));
      setProjectPhases((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }

    return true;
  }, [projects, projectPhases, addHistoryProject, setProjects, setProjectPhases, setHistoryPhases]);

  // ====== 自动化流程：人员状态管理（2026-07-19 晚：同步 DB）======
  const autoProcessMembers = useCallback(() => {
    if (isAutoProcessingRef.current) return;
    const todayStr = dayjs().format('YYYY-MM-DD');

    setTeamMembers((prevMembers) => {
      const updates: { memberId: string; updates: Record<string, unknown> }[] = [];

      const updatedMembers = prevMembers.map((m) => {
        // 1. 测试中 → 空闲（项目结束日期已过）
        if (m.status === '测试中') {
          const projects = m.projects || [];
          const allProjectsFinished = projects.length > 0 && projects.every(
            (p) => p.endDate < todayStr
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

      // 同步 DB
      for (const { memberId, updates: fields } of updates) {
        const dbId = parseInt(memberId, 10);
        if (Number.isNaN(dbId)) continue;
        void teamMembersApi.update(String(dbId), fields)
          .catch((err) => console.warn('[autoProcessMembers] 同步失败', memberId, err));
      }

      return updatedMembers;
    });
  }, [setTeamMembers]);

  // ====== 同步人员项目数据：根据 projects 的 assignedMemberIds + 项目时间自动生成人员的 projects/upcomingProjects/状态 ======
  const syncMembersFromProjects = useCallback(() => {
    const today = dayjs().format('YYYY-MM-DD');
    // 进行中：非已完成 且 startDate <= today 且 endDate >= today
    const activeProjs = projects.filter((p) => p.status !== '已完成' && p.startDate <= today && p.endDate >= today);
    // 未开始：非已完成 且 startDate > today
    const upcomingProjs = projects.filter((p) => p.status !== '已完成' && p.startDate > today);

    setTeamMembers((prev) =>
      prev.map((m) => {
        const memberActive = activeProjs.filter((p) => (p.assignedMemberIds || []).includes(m.id));
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

  const value: DataContextValue = {
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
    attendanceAdjustments,
    setAttendanceAdjustments,
  };

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
