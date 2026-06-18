// ============================================================
// 智航万恒测试验证管理平台 - 自定义 Hooks
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import dayjs from 'dayjs';
import type { TeamMember, MemberStatus, MemberProject } from '../types';

// -------------------- 成员状态相关 Hook --------------------

/**
 * 根据项目时间自动计算成员状态
 */
export function computeStatusFromProjects(projects: MemberProject[]): MemberStatus {
  const now = dayjs();
  const hasActive = projects.some(
    (p) => !dayjs(p.startDate).isAfter(now, 'day') && !dayjs(p.endDate).isBefore(now, 'day')
  );
  return hasActive ? '测试中' : '空闲';
}

/**
 * 成员列表状态管理 Hook
 */
export function useMemberStatus(members: TeamMember[]) {
  const [localMembers, setLocalMembers] = useState<TeamMember[]>(members);

  // 同步外部members变化
  useEffect(() => {
    setLocalMembers(members);
  }, [members]);

  // 启动自动状态切换定时器
  useEffect(() => {
    const timer = setInterval(() => {
      setLocalMembers((prev) =>
        prev.map((m) => {
          const projects = m.projects || [];
          if (projects.length === 0) return m;
          const computed = computeStatusFromProjects(projects);
          if (computed !== m.status) {
            return { ...m, status: computed };
          }
          return m;
        })
      );
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // 更新单个成员
  const updateMember = useCallback((id: string, updates: Partial<TeamMember>) => {
    setLocalMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
    );
  }, []);

  // 批量更新成员
  const updateMembers = useCallback((ids: string[], updates: Partial<TeamMember>) => {
    setLocalMembers((prev) =>
      prev.map((m) => (ids.includes(m.id) ? { ...m, ...updates } : m))
    );
  }, []);

  return { localMembers, updateMember, updateMembers, setLocalMembers };
}

// -------------------- 筛选和搜索 Hook --------------------

/**
 * 通用的列表筛选 Hook
 */
export function useFilteredList<T>(
  list: T[],
  options: {
    searchFields: (keyof T | string)[];
    searchPlaceholder?: string;
  }
) {
  const { searchFields } = options;
  const [searchText, setSearchText] = useState('');
  const [filterValue, setFilterValue] = useState<string>('全部');

  const filteredList = useMemo(() => {
    return list.filter((item) => {
      // 筛选
      if (filterValue !== '全部') {
        const filterField = 'status' as keyof T;
        if (item[filterField] !== filterValue) return false;
      }
      // 搜索
      if (searchText) {
        const kw = searchText.toLowerCase();
        const match = searchFields.some((field) => {
          const value = item[field as keyof T];
          if (typeof value === 'string') {
            return value.toLowerCase().includes(kw);
          }
          return false;
        });
        if (!match) return false;
      }
      return true;
    });
  }, [list, filterValue, searchText, searchFields]);

  return { searchText, setSearchText, filterValue, setFilterValue, filteredList };
}

// -------------------- 分页 Hook --------------------

/**
 * 分页 Hook
 */
export function usePagination<T>(list: T[], defaultPageSize = 10) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const paginatedList = useMemo(() => {
    const start = (page - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [list, page, pageSize]);

  const totalPages = Math.ceil(list.length / pageSize);

  const goToPage = useCallback((p: number) => {
    setPage(Math.max(1, Math.min(p, totalPages)));
  }, [totalPages]);

  const nextPage = useCallback(() => {
    setPage((p) => Math.min(p + 1, totalPages));
  }, [totalPages]);

  const prevPage = useCallback(() => {
    setPage((p) => Math.max(p - 1, 1));
  }, []);

  return {
    page,
    pageSize,
    setPage,
    setPageSize,
    paginatedList,
    totalPages,
    total: list.length,
    goToPage,
    nextPage,
    prevPage,
  };
}

// -------------------- 定时刷新 Hook --------------------

/**
 * 定时刷新 Hook
 */
export function useTimerRefresh<T>(
  fetchFn: () => T,
  interval = 30000
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchFn();
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [fetchFn]);

  useEffect(() => {
    // 初始加载
    refresh();

    // 定时刷新
    const timer = setInterval(refresh, interval);
    return () => clearInterval(timer);
  }, [refresh, interval]);

  return { data, loading, refresh };
}
