/**
 * API 客户端 — 连接后端 Express 服务
 *
 * 开发环境：Vite proxy /api → http://localhost:3001
 * 生产环境：nginx proxy /api → backend:3001
 */

import type { ApiResponse, PaginatedResponse } from '../types';

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
  getList: (params?: Record<string, string>): Promise<ApiResponse<PaginatedResponse<ProjectDTO>>> => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request('/projects' + qs);
  },

  /** 获取单个项目 */
  getById: (id: number): Promise<ApiResponse<ProjectDTO>> => {
    return request('/projects/' + id);
  },

  /** 创建项目 */
  create: (data: ProjectDTO): Promise<ApiResponse<{ id: number }>> => {
    return request('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /** 更新项目 */
  update: (id: number, data: ProjectDTO): Promise<ApiResponse<void>> => {
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
  getHistoryList: (): Promise<ApiResponse<ProjectDTO[]>> => {
    return request('/projects/history/list');
  },

  /** 获取团队成员列表 */
  getTeamMembers: (params?: Record<string, string>): Promise<ApiResponse<Record<string, unknown>[]>> => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request('/projects/members/list' + qs);
  },
};
