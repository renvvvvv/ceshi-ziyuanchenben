import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
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

// ============================================================
// localStorage 持久化 Hook
// ============================================================

const STORAGE_PREFIX = 'zhwh_platform_';

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

interface DataContextValue {
  // 项目管理
  projects: Project[];
  setProjects: (value: Project[] | ((prev: Project[]) => Project[])) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  getProjectById: (id: string) => Project | undefined;

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

  // 项目阶段（时间线）
  projectPhases: Record<string, ProjectPhase[]>;
  setProjectPhases: (value: Record<string, ProjectPhase[]> | ((prev: Record<string, ProjectPhase[]>) => Record<string, ProjectPhase[]>)) => void;

  // 历史项目阶段
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
  attendanceAdjustments: Record<string, { projectStart?: string; projectEnd?: string; leaveDays?: number }>;
  setAttendanceAdjustments: (updater: Record<string, { projectStart?: string; projectEnd?: string; leaveDays?: number }> | ((prev: Record<string, { projectStart?: string; projectEnd?: string; leaveDays?: number }>) => Record<string, { projectStart?: string; projectEnd?: string; leaveDays?: number }>)) => void;
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
  // ====== 持久化状态 ======
  const [projects, setProjects] = usePersistentState<Project[]>('projects', mockProjects);
  const [historyProjects, setHistoryProjects] = usePersistentState<HistoricalProject[]>('historyProjects', mockHistoryProjects);
  const [teamMembers, setTeamMembers] = usePersistentState<TeamMember[]>('teamMembers', mockTeamMembers);
  const [testDocs, setTestDocs] = usePersistentState<TestDoc[]>('testDocs', mockTestDocs);
  const [projectPhases, setProjectPhases] = usePersistentState<Record<string, ProjectPhase[]>>('projectPhases', mockProjectPhases);
  const [historyPhases, setHistoryPhases] = usePersistentState<Record<string, ProjectPhase[]>>('historyPhases', mergedHistoryPhases);
  const [attendanceAdjustments, setAttendanceAdjustments] = usePersistentState<Record<string, { projectStart?: string; projectEnd?: string; leaveDays?: number }>>('attendanceAdjustments', {});

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
      console.log('[DataContext] 历史项目去重：移除', historyProjects.length - uniqueHistory.length, '个重复项');
    }
  }, []); // 只在挂载时执行一次

  // ====== 项目 CRUD ======
  const addProject = useCallback((project: Project) => {
    setProjects((prev) => [project, ...prev]);
  }, [setProjects]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, [setProjects]);

  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, [setProjects]);

  const getProjectById = useCallback((id: string) => projects.find((p) => p.id === id), [projects]);

  // ====== 历史项目 CRUD ======
  const addHistoryProject = useCallback((project: HistoricalProject) => {
    setHistoryProjects((prev) => {
      if (prev.some((p) => p.id === project.id)) return prev;
      return [project, ...prev];
    });
  }, [setHistoryProjects]);

  const updateHistoryProject = useCallback((id: string, updates: Partial<HistoricalProject>) => {
    setHistoryProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, [setHistoryProjects]);

  const deleteHistoryProject = useCallback((id: string) => {
    setHistoryProjects((prev) => prev.filter((p) => p.id !== id));
  }, [setHistoryProjects]);

  const getHistoryProjectById = useCallback((id: string) => historyProjects.find((p) => p.id === id), [historyProjects]);

  // ====== 团队成员 CRUD ======
  const addTeamMember = useCallback((member: TeamMember) => {
    setTeamMembers((prev) => [...prev, member]);
  }, [setTeamMembers]);

  const updateTeamMember = useCallback((id: string, updates: Partial<TeamMember>) => {
    setTeamMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  }, [setTeamMembers]);

  const deleteTeamMember = useCallback((id: string) => {
    setTeamMembers((prev) => prev.filter((m) => m.id !== id));
  }, [setTeamMembers]);

  // ====== 测试文档 CRUD ======
  const addTestDoc = useCallback((doc: TestDoc) => {
    setTestDocs((prev) => [doc, ...prev]);
  }, [setTestDocs]);

  const updateTestDoc = useCallback((id: string, updates: Partial<TestDoc>) => {
    setTestDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...updates } : d)));
  }, [setTestDocs]);

  const deleteTestDoc = useCallback((id: string) => {
    setTestDocs((prev) => prev.filter((d) => d.id !== id));
  }, [setTestDocs]);

  // ====== 自动化流程：根据日期自动转换项目状态 ======
  const autoProcessProjects = useCallback(() => {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const todayStr = today;

    let changed = false;

    // 0. 清理：将 projects 中已有的"已完成"项目移到 historyProjects（防止数据污染）
    const orphanedCompleted: Project[] = [];
    const cleanedProjects: Project[] = [];

    for (const p of projects) {
      if (p.status === '已完成') {
        orphanedCompleted.push(p);
        changed = true;
      } else {
        cleanedProjects.push(p);
      }
    }

    // 1. 未开始 → 测试中（今天 >= startDate 且 未过期）
    //    特殊处理：如果整个项目周期已过（endDate < today），直接归档而不转测试中
    const projectsToStart: Project[] = [];
    const projectsToArchiveDirectly: Project[] = [];
    const remainingProjects: Project[] = [];

    for (const p of cleanedProjects) {
      if (p.status === '未开始' && p.startDate <= todayStr) {
        // 检查是否整个周期已过
        if (p.endDate && p.endDate < todayStr) {
          // 整个周期已过，直接归档
          projectsToArchiveDirectly.push({
            ...p,
            status: '已完成' as const,
            actualDeliveryDate: p.endDate,
            updatedAt: new Date().toISOString(),
          });
          changed = true;
        } else {
          // 正常转测试中
          projectsToStart.push({ ...p, status: '测试中' as const, updatedAt: new Date().toISOString() });
          changed = true;
        }
      } else {
        remainingProjects.push(p);
      }
    }

    // 2. 测试中 → 已完成并归档（今天 > endDate）
    const projectsToArchive: Project[] = [];
    const finalProjects: Project[] = [];

    for (const p of remainingProjects) {
      if (p.status === '测试中' && p.endDate && p.endDate < todayStr) {
        projectsToArchive.push({
          ...p,
          status: '已完成' as const,
          actualDeliveryDate: p.endDate,
          updatedAt: new Date().toISOString(),
        });
        changed = true;
      } else {
        finalProjects.push(p);
      }
    }

    if (!changed) return;

    // 应用状态变更
    setProjects([...projectsToStart, ...finalProjects]);

    // 同步更新指派人员：未开始→测试中 时，更新人员 projects/currentProjects
    if (projectsToStart.length > 0) {
      setTeamMembers((prevMembers) =>
        prevMembers.map((m) => {
          // 检查该人员是否被指派到任何转为测试中的项目
          const assignedToStarted = projectsToStart.filter((p) =>
            (p.assignedMemberIds || []).includes(m.id)
          );
          if (assignedToStarted.length === 0) return m;

          // 合并项目信息
          const newProjects = [...(m.projects || [])];
          const newCurrentProjects = [...m.currentProjects];
          const newUpcoming = [...(m.upcomingProjects || [])];

          assignedToStarted.forEach((p) => {
            const projectName = p.name;
            // 从 upcomingProjects 中移除（如果存在）
            const idx = newUpcoming.findIndex((up) => up.projectName === projectName);
            if (idx >= 0) newUpcoming.splice(idx, 1);

            // 添加到 projects 和 currentProjects
            if (!newProjects.find((np) => np.projectName === projectName)) {
              newProjects.push({ projectName, startDate: p.startDate, endDate: p.endDate });
            }
            if (!newCurrentProjects.includes(projectName)) {
              newCurrentProjects.push(projectName);
            }
          });

          return {
            ...m,
            // 休假中的成员不自动转为测试中，保留休假状态
            status: m.status === '休假' ? m.status : '测试中' as const,
            projects: newProjects,
            currentProjects: newCurrentProjects,
            upcomingProjects: newUpcoming,
          };
        })
      );
    }

    // 归档项目：从 projects 移到 historyProjects（包括清理出的 orphanedCompleted + 直接归档的 + 正常归档的）
    const allArchived = [...orphanedCompleted, ...projectsToArchiveDirectly, ...projectsToArchive];
    // 对 allArchived 自身去重（防止重复 ID）
    const seenIds = new Set<string>();
    const dedupedArchived = allArchived.filter((p) => {
      if (seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      return true;
    });
    if (dedupedArchived.length > 0) {
      setHistoryProjects((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const uniqueArchived = dedupedArchived.filter((p) => !existingIds.has(p.id));
        return [...uniqueArchived, ...prev];
      });

      // 同时转移阶段数据（函数式更新，避免覆盖并发更新）
      const transferredPhases: Record<string, ProjectPhase[]> = {};
      for (const p of dedupedArchived) {
        if (projectPhases[p.id]) {
          transferredPhases[p.id] = projectPhases[p.id];
        }
      }

      setProjectPhases((prevPhases) => {
        const newPhases = { ...prevPhases };
        for (const p of dedupedArchived) {
          delete newPhases[p.id];
        }
        return newPhases;
      });

      setHistoryPhases((prevHistory) => ({
        ...prevHistory,
        ...transferredPhases,
      }));
    }
  }, [projects, projectPhases, historyPhases, setProjects, setHistoryProjects, setProjectPhases, setHistoryPhases]);

  // ====== 自动化流程：人员状态管理（函数式更新，避免覆盖 autoProcessProjects 的并发更新） ======
  const autoProcessMembers = useCallback(() => {
    const todayStr = new Date().toISOString().split('T')[0];

    setTeamMembers((prevMembers) => {
      let changed = false;

      const updatedMembers = prevMembers.map((m) => {
        // 1. 测试中 → 空闲（项目结束日期已过）
        if (m.status === '测试中') {
          const projects = m.projects || [];
          // 检查是否所有项目都已结束
          const allProjectsFinished = projects.length > 0 && projects.every(
            (p) => p.endDate < todayStr
          );
          if (allProjectsFinished) {
            changed = true;
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
            changed = true;
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

      return changed ? updatedMembers : prevMembers;
    });
  }, [setTeamMembers]);

  // ====== 同步人员项目数据：根据 projects 的 assignedMemberIds + 项目时间自动生成人员的 projects/upcomingProjects/状态 ======
  const syncMembersFromProjects = useCallback(() => {
    const today = new Date().toISOString().split('T')[0];
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
    projects,
    setProjects,
    addProject,
    updateProject,
    deleteProject,
    getProjectById,
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
