export type ProjectStatus = '未开始' | '测试中' | '已完成' | '阻塞';
export type Priority = '高' | '中' | '低';
export type MemberStatus = '在线' | '忙碌' | '离线';

export interface Project {
  id: string;
  name: string;
  customer: string;
  status: ProjectStatus;
  priority: Priority;
  manager: string;
  startDate: string;
  endDate: string;
  itOutput: number; // MW
  contractAmount?: number;
  businessType?: string;
  description?: string;
  updatedAt: string;
}

export interface KpiData {
  activeProjects: number;
  activeProjectsTrend: number;
  completedProjects: number;
  completedProjectsTrend: number;
  totalItOutput: number;
  totalItOutputTrend: number;
  avgProjectCycle: number;
  avgProjectCycleTrend: number;
}

export interface StatusDistribution {
  name: string;
  value: number;
}

export interface CustomerContract {
  name: string;
  amount: number;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: string;
  description: string;
}

export interface TeamMember {
  id: string;
  name: string;
  employeeId: string;
  status: MemberStatus;
  avatar?: string;
  skills: string[];
  currentProjects: string[];
  email?: string;
  phone?: string;
}

export interface HistoricalProject {
  id: string;
  name: string;
  itOutput: number;
  startDate: string;
  endDate: string;
  customer: string;
  docLink: string;
}

export interface TestDoc {
  id: string;
  title: string;
  category: string;
  lastUpdated: string;
  content?: string;
}
