/**
 * API 客户端 + 字段命名转换
 *
 * 背景：
 *  - 后端 PostgreSQL 列名是 snake_case（start_date / end_date / it_output）
 *  - 前端 TypeScript 类型是 camelCase（startDate / endDate / itOutput）
 *  - 此模块负责：HTTP 调用 + 双向字段转换
 *
 * 设计：
 *  - snakeToCamel: 后端响应 → 前端使用（data 字段名）
 *  - camelToSnake: 前端提交 → 后端接收（body 字段名）
 *  - 失败时返回 null（用于降级到 localStorage）
 */

// ============================================================
// 通用 fetch wrapper
// ============================================================

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  timeout?: number;
  signal?: AbortSignal;
}

/**
 * 通用 API 调用
 * - 自动加 base path（/api）
 * - 自动 JSON 序列化
 * - 错误时返回 null（不抛异常，方便上层降级到 localStorage）
 */
export async function apiCall<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T | null> {
  const { method = 'GET', body, query, timeout = 10000, signal } = options;
  try {
    let url = path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
    if (query) {
      const qs = Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal || ctrl.signal,
    });
    window.clearTimeout(timer);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new ApiError(`HTTP ${res.status}`, res.status, errData);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) {
      // 4xx/5xx：抛出（业务错误需要被看见）
      // 但我们仍然 return null 让调用方处理
      // eslint-disable-next-line no-console
      console.warn(`[API] ${method} ${path} failed:`, err.message);
      return null;
    }
    // 网络错误：返回 null（让上层降级）
    // eslint-disable-next-line no-console
    console.warn(`[API] ${method} ${path} network error:`, err);
    return null;
  }
}

// ============================================================
// 字段名转换工具
// ============================================================

const SNAKE_TO_CAMEL: Record<string, string> = {
  // projects
  start_date: 'startDate',
  end_date: 'endDate',
  it_output: 'itOutput',
  business_type: 'businessType',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  planned_manpower: 'plannedManpower',
  city: 'city',
  assigned_member_ids: 'assignedMemberIds',
  // team_members
  employee_id: 'employeeId',
  current_projects: 'currentProjects',
  // historical_projects
  doc_link: 'docLink',
};

const CAMEL_TO_SNAKE: Record<string, string> = Object.fromEntries(
  Object.entries(SNAKE_TO_CAMEL).map(([snake, camel]) => [camel, snake]),
);

/**
 * 把对象的所有 snake_case key 递归转换为 camelCase
 */
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

/**
 * 把对象的所有 camelCase key 递归转换为 snake_case
 */
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
// 业务数据转换层
// ============================================================

import type { Project, HistoricalProject, TeamMember, TestDoc } from '../types';

/**
 * 后端返回的 test_projects 行 → 前端 Project 类型
 * - 字段名 snake → camel
 * - id: int → string（前端用 string id）
 * - assigned_member_ids: JSON 字符串 → string[]（如果非空）
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
 * - 字段名 camel → snake
 * - id 不传（后端生成）
 * - assignedMemberIds: string[] → JSON 字符串
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
  // 去掉 undefined 字段（pg 不接受 undefined）
  for (const k of Object.keys(body)) {
    if (body[k] === undefined) delete body[k];
  }
  return body;
}

/**
 * 后端返回的 team_members 行 → 前端 TeamMember 类型
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
  return {
    id: String(c.id),
    name: String(c.name || ''),
    employeeId: String(c.employeeId || ''),
    status: (c.status || '在线') as TeamMember['status'],
    skills,
    currentProjects,
    email: c.email ? String(c.email) : undefined,
    phone: c.phone ? String(c.phone) : undefined,
  } as TeamMember;
}

/**
 * 前端 TeamMember → 后端接收 body
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
// 各业务 API（薄包装）
// ============================================================

export const projectsApi = {
  list: (params?: { page?: number; size?: number }) =>
    apiCall<{ success: boolean; data: Record<string, unknown>[]; total: number }>(
      '/projects',
      { query: params },
    ),
  get: (id: string) => apiCall<{ success: boolean; data: Record<string, unknown> }>(`/projects/${id}`),
  create: (body: Partial<Project>) =>
    apiCall<{ success: boolean; id: number }>('/projects', { method: 'POST', body: projectToDbBody(body) }),
  update: (id: string, body: Partial<Project>) =>
    apiCall<{ success: boolean }>(`/projects/${id}`, { method: 'PUT', body: projectToDbBody(body) }),
  remove: (id: string) =>
    apiCall<{ success: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
};

export const teamMembersApi = {
  list: (params?: { status?: string; search?: string }) =>
    apiCall<{ success: boolean; data: Record<string, unknown>[] }>('/projects/members/list', { query: params }),
};

export const historyProjectsApi = {
  list: () => apiCall<{ success: boolean; data: Record<string, unknown>[] }>('/projects/history/list'),
  create: (body: Partial<HistoricalProject>) =>
    apiCall<{ success: boolean; id: number }>('/projects', { method: 'POST', body: historyProjectToDbBody(body) }).then(r => r),
};
