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
    setHistoryProjects((prev) => [project, ...prev]);
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

  // ====== 重置数据 ======
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
