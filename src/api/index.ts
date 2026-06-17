/**
 * API 客户端 — 连接后端 Express 服务
 *
 * 开发环境：Vite proxy /api → http://localhost:3001
 * 生产环境：nginx proxy /api → backend:3001
 */

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ============ 资源计算 ============

export interface CalcInput {
  total_mw: number; total_duration: number;
  cabinet_power?: number;
  cabinet_power_segments?: { power: number; count: number }[];
  it_transformers: [number, number][]; power_transformers: [number, number][];
  hybrid_transformers?: [number, number][];
  total_cabinets?: number; ac_type: string;
  project_type?: string; target_duration?: number; tight_schedule?: boolean;
}

export interface CalcResponse {
  success: boolean;
  data: Record<string, unknown>;
  pue: number;
}

export function apiCalcResource(input: CalcInput): Promise<CalcResponse> {
  return request<CalcResponse>('/resource-calc', { method: 'POST', body: JSON.stringify(input) });
}

export interface HistoryGroupItem {
  type: 'batch' | 'single';
  time: string;
  // batch fields
  batch_id?: string; count?: number; min_mw?: number; max_mw?: number;
  total_peak?: number; total_md?: number;
  // single fields
  id?: number; total_mw?: number; total_duration?: number; cabinet_power?: number;
  it_transformers?: string; power_transformers?: string;
  total_cabinets?: number; ac_type?: string;
  peak_staff?: number; total_man_days?: number;
  result_json?: string; created_at?: string;
}

export interface HistoryGroupResponse {
  success: boolean;
  data: HistoryGroupItem[];
  page: number; size: number; total: number;
}

export function apiGetHistory(page = 1, size = 20, type?: string, date?: string): Promise<HistoryGroupResponse> {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (type && type !== 'all') params.set('type', type);
  if (date) params.set('date', date);
  return request<HistoryGroupResponse>('/resource-calc/history?' + params.toString());
}

export function apiGetBatchDetail(batchId: string): Promise<{ success: boolean; data: HistoryItem[] }> {
  return request('/resource-calc/history/batch/' + batchId);
}

export interface HistoryItem {
  id: number; batch_id?: string | null;
  total_mw: number; total_duration: number; cabinet_power: number;
  it_transformers: string; power_transformers: string;
  total_cabinets: number; ac_type: string;
  peak_staff: number; total_man_days: number;
  result_json?: string; created_at: string;
}

export function apiDeleteHistory(id: number): Promise<{ success: boolean }> {
  return request('/resource-calc/history/' + id, { method: 'DELETE' });
}

// ============ 项目管理 ============

export interface Project {
  id?: number; name: string; customer: string; status: string; priority: string;
  manager: string; start_date: string; end_date?: string;
  it_output: number; contract_amount?: number;
  business_type?: string; description?: string;
}

export interface ProjectListResponse {
  success: boolean; data: Project[]; page: number; size: number; total: number;
}

export function apiGetProjects(params?: Record<string, string>): Promise<ProjectListResponse> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<ProjectListResponse>('/projects' + qs);
}

export function apiCreateProject(data: Project): Promise<{ success: boolean; id: number }> {
  return request('/projects', { method: 'POST', body: JSON.stringify(data) });
}

export function apiUpdateProject(id: number, data: Project): Promise<{ success: boolean }> {
  return request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function apiDeleteProject(id: number): Promise<{ success: boolean }> {
  return request(`/projects/${id}`, { method: 'DELETE' });
}

export function apiGetProject(id: number): Promise<{ success: boolean; data: Project }> {
  return request(`/projects/${id}`);
}

// ============ 历史项目 & 团队成员 ============

export function apiGetHistoryProjects(): Promise<{ success: boolean; data: Record<string, unknown>[] }> {
  return request('/projects/history/list');
}

export function apiGetTeamMembers(params?: Record<string, string>): Promise<{ success: boolean; data: Record<string, unknown>[] }> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request('/projects/members/list' + qs);
}
