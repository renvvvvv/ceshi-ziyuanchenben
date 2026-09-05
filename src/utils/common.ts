// ============================================================
// 智航万恒测试验证管理平台 - 公共工具函数
// ============================================================

import type { ProjectStatus, MemberStatus } from '../types';

// -------------------- 状态颜色映射 --------------------
export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  '未开始': '#6366f1',  // 蓝色
  '测试中': '#ec4899',  // 粉色
  '已完成': '#16a34a',  // 绿色
  '阻塞': '#dc2626',    // 红色
};

export const MEMBER_STATUS_COLORS: Record<MemberStatus, string> = {
  '空闲': '#16a34a',    // 绿色
  '测试中': '#ec4899',  // 粉色
  '休假': '#6366f1',    // 蓝色
};

// -------------------- 状态显示文本 --------------------
export const PROJECT_STATUS_TEXT: Record<ProjectStatus, string> = {
  '未开始': '未开始',
  '测试中': '测试中',
  '已完成': '已完成',
  '阻塞': '阻塞',
};

// -------------------- 工具函数 --------------------

/**
 * 获取状态对应的颜色
 */
export function getStatusColor(status: ProjectStatus | MemberStatus): string {
  if (status in PROJECT_STATUS_COLORS) {
    return PROJECT_STATUS_COLORS[status as ProjectStatus];
  }
  if (status in MEMBER_STATUS_COLORS) {
    return MEMBER_STATUS_COLORS[status as MemberStatus];
  }
  return '#8c8c8c';
}

/**
 * 格式化日期显示
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * 计算项目进度（基于日期）
 */
export function calculateProjectProgress(startDate: string, endDate: string): number {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const now = Date.now();

  if (now <= start) return 0;
  if (now >= end) return 100;

  return Math.round(((now - start) / (end - start)) * 100);
}

/**
 * 判断项目是否即将交付（7天内）
 */
export function isDeliverySoon(plannedDeliveryDate?: string): boolean {
  if (!plannedDeliveryDate) return false;
  const delivery = new Date(plannedDeliveryDate).getTime();
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return delivery - now <= sevenDays && delivery >= now;
}

/**
 * 判断项目是否延期
 */
export function isOverdue(endDate: string): boolean {
  return new Date(endDate).getTime() < Date.now();
}

/**
 * 获取人员头像初始值
 */
export function getAvatarText(name: string): string {
  if (!name) return '?';
  // 取名字后2位
  return name.slice(-2);
}

/**
 * 格式化金额（万元）
 */
export function formatCurrency(amount?: number): string {
  if (amount === undefined || amount === null) return '-';
  return `${amount.toLocaleString('zh-CN')} 万`;
}

/**
 * 格式化IT产出（MW）
 */
export function formatItOutput(mw: number): string {
  return `${mw} MW`;
}

/**
 * 筛选空闲人员
 */
export function filterIdleMembers<T extends { status: MemberStatus }>(members: T[]): T[] {
  return members.filter(m => m.status === '空闲');
}

/**
 * 筛选测试中人员
 */
export function filterActiveMembers<T extends { status: MemberStatus }>(members: T[]): T[] {
  return members.filter(m => m.status === '测试中');
}

/**
 * 按技能分类人员
 */
export function groupBySkill<T extends { skills: string[] }>(members: T[]): Record<string, T[]> {
  return members.reduce((acc, member) => {
    member.skills.forEach(skill => {
      if (!acc[skill]) acc[skill] = [];
      acc[skill].push(member);
    });
    return acc;
  }, {} as Record<string, T[]>);
}

/**
 * 深拷贝（JSON方式，简单场景使用）
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 生成唯一ID
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
