/**
 * API 客户端 — 连接后端 Express 服务
 *
 * 开发环境：Vite proxy /api → http://localhost:3001
 * 生产环境：nginx proxy /api → backend:3001
 *
 * 提供：
 *  - 通用 fetch wrapper（request/ApiError/timeout/abort）
 *  - 业务模块：resourceCalc / projects / teamMembers / historyProjects
 *  - 字段名转换：snake_case ↔ camelCase
 *  - 业务转换函数：dbRowToProject / projectToDbBody / 等
 */

import type { ApiResponse, Project, HistoricalProject, TeamMember } from '../types';
import type { PaginatedResponse } from '../types';

// Re-export 让前端页面可以直接从 api 导入
export type { PaginatedResponse };

// -------------------- 配置 --------------------
const BASE = '/api';
const TIMEOUT_MS = 30000;

// -------------------- 统一错误处理 --------------------
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends RequestInit {
  timeout?: number;
}

// -------------------- 核心请求函数 --------------------
async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options || {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(
        (err as { message?: string }).message || `请求失败: ${res.status}`,
        res.status
      );
    }

    return res.json() as Promise<T>;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') {
      throw new ApiError('请求超时，请稍后重试');
    }
    throw new ApiError(error.message || '网络错误');
  }
}

// -------------------- 资源计算 API --------------------

export interface CalcInput {
  total_mw: number;
  total_duration: number;
  cabinet_power?: number;
  cabinet_power_segments?: { power: number; count: number }[];
  it_transformers: [number, number][];
  power_transformers: [number, number][];
  hybrid_transformers?: [number, number][];
  total_cabinets?: number;
  ac_type: string;
  project_type?: string;
  tight_schedule?: boolean;
}

export interface CalcResponse {
  success: boolean;
  data: Record<string, unknown>;
  pue: number;
}

export const resourceCalcApi = {
  /** 单条资源计算 */
  calculate: (input: CalcInput): Promise<ApiResponse<CalcResponse>> => {
    return request('/resource-calc', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /** 批量资源计算 */
  batchCalculate: (inputs: CalcInput[]): Promise<ApiResponse<CalcResponse[]>> => {
    return request('/resource-calc/batch', {
      method: 'POST',
      body: JSON.stringify({ calculations: inputs }),
    });
  },

  /** 获取计算历史 */
  getHistory: (
    page = 1,
    size = 20,
    type?: string,
    date?: string
  ): Promise<ApiResponse<PaginatedResponse<HistoryGroupItem>>> => {
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
    });
    if (type && type !== 'all') params.set('type', type);
    if (date) params.set('date', date);
    return request('/resource-calc/history?' + params.toString());
  },

  /** 获取批次详情 */
  getBatchDetail: (batchId: string): Promise<ApiResponse<HistoryItem[]>> => {
    return request('/resource-calc/history/batch/' + batchId);
  },

  /** 删除历史记录 */
  deleteHistory: (id: number): Promise<ApiResponse<void>> => {
    return request('/resource-calc/history/' + id, { method: 'DELETE' });
  },
};

// -------------------- 向后兼容的独立导出 --------------------
export const apiCalcResource = (input: CalcInput) => resourceCalcApi.calculate(input);
export const apiGetHistory = (page?: number, size?: number, type?: string, date?: string) =>
  resourceCalcApi.getHistory(page, size, type, date);
export const apiGetBatchDetail = (batchId: string) => resourceCalcApi.getBatchDetail(batchId);
export const apiDeleteHistory = (id: number) => resourceCalcApi.deleteHistory(id);

export interface HistoryGroupItem {
  type: 'batch' | 'single';
  time: string;
  // batch fields
  batch_id?: string;
  count?: number;
  min_mw?: number;
  max_mw?: number;
  total_peak?: number;
  total_md?: number;
  // single fields
  id?: number;
  total_mw?: number;
  total_duration?: number;
  cabinet_power?: number;
  it_transformers?: string;
  power_transformers?: string;
  total_cabinets?: number;
  ac_type?: string;
  peak_staff?: number;
  total_man_days?: number;
  result_json?: string;
  created_at?: string;
}

export interface HistoryItem {
  id: number;
  batch_id?: string | null;
  total_mw: number;
  total_duration: number;
  cabinet_power: number;
  it_transformers: string;
  power_transformers: string;
  total_cabinets: number;
  ac_type: string;
  peak_staff: number;
  total_man_days: number;
  result_json?: string;
  created_at: string;
}

// -------------------- 项目管理 API --------------------

export interface ProjectDTO {
  id?: number;
  name: string;
  customer: string;
  status: string;
  manager: string;
  start_date: string;
  end_date?: string;
  it_output: number;
  business_type?: string;
  description?: string;
}

export const projectApi = {
  /** 获取项目列表 */
  getList: (params?: Record<string, string>): Promise<ApiResponse<PaginatedResponse<Record<string, unknown>>>> => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request('/projects' + qs);
  },

  /** 获取单个项目 */
  getById: (id: number): Promise<ApiResponse<Record<string, unknown>>> => {
    return request('/projects/' + id);
  },

  /** 创建项目 */
  create: (data: Record<string, unknown>): Promise<ApiResponse<{ id: number }>> => {
    return request('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /** 更新项目 */
  update: (id: number, data: Record<string, unknown>): Promise<ApiResponse<void>> => {
    return request('/projects/' + id, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /** 删除项目 */
  delete: (id: number): Promise<ApiResponse<void>> => {
    return request('/projects/' + id, { method: 'DELETE' });
  },

  /** 获取历史项目列表 */
  getHistoryList: (): Promise<ApiResponse<Record<string, unknown>[]>> => {
    return request('/projects/history/list');
  },

  /** 创建历史项目（写入 historical_projects 表） */
  createHistory: (data: Record<string, unknown>): Promise<ApiResponse<{ id: number }>> => {
    return request('/projects/history', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /** 更新历史项目 */
  updateHistory: (id: number | string, data: Record<string, unknown>): Promise<ApiResponse<void>> => {
    return request('/projects/history/' + id, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /** 删除历史项目 */
  deleteHistory: (id: number | string): Promise<ApiResponse<void>> => {
    return request('/projects/history/' + id, { method: 'DELETE' });
  },

  /** 获取团队成员列表 */
  getTeamMembers: (params?: Record<string, string>): Promise<ApiResponse<Record<string, unknown>[]>> => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request('/projects/members/list' + qs);
  },

  /** 创建团队成员 */
  createTeamMember: (data: Record<string, unknown>): Promise<ApiResponse<{ id: number }>> => {
    return request('/projects/members', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /** 更新团队成员 */
  updateTeamMember: (id: number | string, data: Record<string, unknown>): Promise<ApiResponse<void>> => {
    return request('/projects/members/' + id, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /** 删除团队成员 */
  deleteTeamMember: (id: number | string): Promise<ApiResponse<void>> => {
    return request('/projects/members/' + id, { method: 'DELETE' });
  },
};

// ============================================================
// 字段名转换工具（snake_case ↔ camelCase）
// ============================================================
// 背景：后端 PostgreSQL 列名是 snake_case（start_date / end_date / it_output）
//      前端 TypeScript 类型是 camelCase（startDate / endDate / itOutput）

const SNAKE_TO_CAMEL: Record<string, string> = {
  start_date: 'startDate',
  end_date: 'endDate',
  it_output: 'itOutput',
  business_type: 'businessType',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  planned_manpower: 'plannedManpower',
  assigned_member_ids: 'assignedMemberIds',
  employee_id: 'employeeId',
  current_projects: 'currentProjects',
  doc_link: 'docLink',
};

const CAMEL_TO_SNAKE: Record<string, string> = Object.fromEntries(
  Object.entries(SNAKE_TO_CAMEL).map(([snake, camel]) => [camel, snake]),
);

export function snakeToCamel<T = unknown>(obj: unknown): T {
  if (obj === null || obj === undefined) return obj as T;
  if (Array.isArray(obj)) return obj.map((v) => snakeToCamel(v)) as unknown as T;
  if (typeof obj !== 'object') return obj as T;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const newKey = SNAKE_TO_CAMEL[k] || k;
    result[newKey] = v === null || v === undefined ? v : snakeToCamel(v);
  }
  return result as T;
}

export function camelToSnake<T = unknown>(obj: unknown): T {
  if (obj === null || obj === undefined) return obj as T;
  if (Array.isArray(obj)) return obj.map((v) => camelToSnake(v)) as unknown as T;
  if (typeof obj !== 'object') return obj as T;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const newKey = CAMEL_TO_SNAKE[k] || k;
    result[newKey] = v === null || v === undefined ? v : camelToSnake(v);
  }
  return result as T;
}

// ============================================================
// 业务数据转换层（db row ↔ 前端业务对象）
// ============================================================

/**
 * 后端 test_projects 行 → 前端 Project
 */
export function dbRowToProject(row: Record<string, unknown>): Project {
  const c = snakeToCamel<Record<string, unknown>>(row);
  let assignedMemberIds: string[] | undefined;
  if (typeof c.assignedMemberIds === 'string' && c.assignedMemberIds) {
    try { assignedMemberIds = JSON.parse(c.assignedMemberIds); } catch { /* ignore */ }
  }
  return {
    id: String(c.id),
    name: String(c.name || ''),
    customer: String(c.customer || ''),
    status: (c.status || '未开始') as Project['status'],
    manager: String(c.manager || ''),
    startDate: String(c.startDate || ''),
    endDate: c.endDate ? String(c.endDate) : undefined,
    itOutput: Number(c.itOutput || 0),
    plannedManpower: c.plannedManpower ? Number(c.plannedManpower) : undefined,
    businessType: c.businessType ? String(c.businessType) : undefined,
    city: c.city ? String(c.city) : undefined,
    description: c.description ? String(c.description) : undefined,
    assignedMemberIds,
    docLink: undefined,
    updatedAt: c.updatedAt ? String(c.updatedAt) : undefined,
  } as Project;
}

/**
 * 前端 Project → 后端接收 body
 */
export function projectToDbBody(p: Partial<Project>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: p.name,
    customer: p.customer,
    status: p.status || '未开始',
    manager: p.manager || '',
    start_date: p.startDate || '',
    end_date: p.endDate || null,
    it_output: p.itOutput ?? 0,
    business_type: p.businessType || null,
    description: p.description || null,
    planned_manpower: p.plannedManpower ?? null,
    city: p.city || null,
    assigned_member_ids: p.assignedMemberIds && p.assignedMemberIds.length > 0
      ? JSON.stringify(p.assignedMemberIds) : null,
  };
  for (const k of Object.keys(body)) {
    if (body[k] === undefined) delete body[k];
  }
  return body;
}

/**
 * 后端 team_members 行 → 前端 TeamMember
 */
export function dbRowToTeamMember(row: Record<string, unknown>): TeamMember {
  const c = snakeToCamel<Record<string, unknown>>(row);
  let skills: string[] = [];
  let currentProjects: string[] = [];
  try {
    if (typeof c.skills === 'string') skills = JSON.parse(c.skills);
  } catch { /* ignore */ }
  try {
    if (typeof c.currentProjects === 'string') currentProjects = JSON.parse(c.currentProjects);
  } catch { /* ignore */ }

  // 归一化 status：后端默认值是'在线'，但前端枚举只有'空闲'/'测试中'/'休假'
  // 把'在线'和任何未知值都映射为'空闲'，避免 TeamPool statusConfig[member.status] 是 undefined
  const rawStatus = String(c.status || '');
  const normalizedStatus: TeamMember['status'] =
    rawStatus === '测试中' || rawStatus === '休假' ? rawStatus : '空闲';

  return {
    id: String(c.id),
    name: String(c.name || ''),
    employeeId: String(c.employeeId || ''),
    status: normalizedStatus,
    skills,
    currentProjects,
    email: c.email ? String(c.email) : undefined,
    phone: c.phone ? String(c.phone) : undefined,
  } as TeamMember;
}

/**
 * 前端 TeamMember → 后端 body
 */
export function teamMemberToDbBody(m: Partial<TeamMember>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: m.name,
    employee_id: m.employeeId,
    status: m.status || '在线',
    skills: JSON.stringify(m.skills || []),
    current_projects: JSON.stringify(m.currentProjects || []),
    email: m.email || null,
    phone: m.phone || null,
  };
  for (const k of Object.keys(body)) {
    if (body[k] === undefined) delete body[k];
  }
  return body;
}

/**
 * 后端 historical_projects 行 → 前端 HistoricalProject
 */
export function dbRowToHistoryProject(row: Record<string, unknown>): HistoricalProject {
  const c = snakeToCamel<Record<string, unknown>>(row);
  return {
    id: String(c.id),
    name: String(c.name || ''),
    itOutput: Number(c.itOutput || 0),
    startDate: String(c.startDate || ''),
    endDate: String(c.endDate || ''),
    customer: String(c.customer || ''),
    docLink: c.docLink ? String(c.docLink) : undefined,
  } as HistoricalProject;
}

/**
 * 前端 HistoricalProject → 后端 body
 */
export function historyProjectToDbBody(p: Partial<HistoricalProject>): Record<string, unknown> {
  return {
    name: p.name,
    it_output: p.itOutput ?? 0,
    start_date: p.startDate || '',
    end_date: p.endDate || '',
    customer: p.customer || '',
    doc_link: p.docLink || null,
  };
}

// ============================================================
// 业务 API（基于 projectApi 的别名 + 完整 CRUD）
// ============================================================

/**
 * Projects 业务 API（含完整 CRUD + 字段转换）
 * 返回结构与 client.ts 一致：{ success, data?, id? }
 */
export const projectsApi = {
  list: (params?: { page?: number; size?: number }) =>
    projectApi.getList(params as Record<string, string> | undefined).then((r) => ({
      success: r.success,
      data: (r.data?.items || []).map(dbRowToProject),
      total: r.data?.total,
    })),
  get: (id: string) => projectApi.getById(Number(id)).then((r) => ({
    success: r.success,
    data: r.data ? dbRowToProject(r.data as unknown as Record<string, unknown>) : undefined,
  })),
  create: (body: Partial<Project>) =>
    projectApi.create(projectToDbBody(body)).then((r) => ({
      success: r.success,
      id: (r.data as { id?: number } | undefined)?.id,
    })),
  update: (id: string, body: Partial<Project>) =>
    projectApi.update(Number(id), projectToDbBody(body)).then((r) => ({
      success: r.success,
    })),
  remove: (id: string) =>
    projectApi.delete(Number(id)).then((r) => ({ success: r.success })),
};

/**
 * Team Members 业务 API（完整 CRUD）
 */
export const teamMembersApi = {
  list: (params?: { status?: string; search?: string }) => {
    const query: Record<string, string> = {};
    if (params?.status) query.status = params.status;
    if (params?.search) query.search = params.search;
    return projectApi.getTeamMembers(query).then((r) => ({
      success: r.success,
      data: (r.data || []).map(dbRowToTeamMember),
    }));
  },
  create: (body: Partial<TeamMember>) =>
    projectApi.createTeamMember(teamMemberToDbBody(body)).then((r) => ({
      success: r.success,
      id: (r.data as { id?: number } | undefined)?.id,
    })),
  update: (id: string, body: Partial<TeamMember>) =>
    projectApi.updateTeamMember(id, teamMemberToDbBody(body)).then((r) => ({
      success: r.success,
    })),
  remove: (id: string) =>
    projectApi.deleteTeamMember(id).then((r) => ({ success: r.success })),
};

/**
 * Historical Projects 业务 API（完整 CRUD）
 * 注意：create 必须 POST /projects/history（写入 historical_projects 表），不是 POST /projects
 */
export const historyProjectsApi = {
  list: () => projectApi.getHistoryList().then((r) => ({
    success: r.success,
    data: (r.data || []).map(dbRowToHistoryProject),
  })),
  create: (body: Partial<HistoricalProject>) =>
    projectApi.createHistory(historyProjectToDbBody(body)).then((r) => ({
      success: r.success,
      id: (r.data as { id?: number } | undefined)?.id,
    })),
  update: (id: string, body: Partial<HistoricalProject>) =>
    projectApi.updateHistory(id, historyProjectToDbBody(body)).then((r) => ({
      success: r.success,
    })),
  remove: (id: string) =>
    projectApi.deleteHistory(id).then((r) => ({ success: r.success })),
};
