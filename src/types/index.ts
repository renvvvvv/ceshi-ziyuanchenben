// ============================================================
// 智航万恒测试验证管理平台 - 类型定义
// ============================================================

// -------------------- 枚举类型 --------------------
export type ProjectStatus = '未开始' | '测试中' | '已完成' | '阻塞';
export type Priority = '高' | '中' | '低';
export type MemberStatus = '空闲' | '测试中' | '休假' | '出差';

export type BusinessType = '新建测试' | '扩容测试' | '年度复测' | '改造测试';

export type DocCategory = '电气系统' | '暖通系统' | '弱电系统' | '消防系统';

// -------------------- 项目相关 --------------------
export interface Project {
  id: string;
  name: string;
  customer: string;
  status: ProjectStatus;
  priority: Priority;
  manager: string;
  startDate: string;
  endDate: string;
  plannedDeliveryDate?: string;
  actualDeliveryDate?: string;
  itOutput: number; // MW
  contractAmount?: number; // 万元
  businessType?: BusinessType;
  description?: string;
  updatedAt: string;
}

// 历史项目 - 继承 Project 并扩展
export interface HistoricalProject extends Omit<Project, 'docLink'> {
  docLink?: string; // 测试管理文档链接
}

// -------------------- KPI 与统计 --------------------
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
  color?: string;
}

export interface CustomerContract {
  name: string;
  amount: number;
}

// -------------------- 项目时间线 --------------------
export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: '进度更新' | '阶段开始' | '问题记录' | '里程碑' | '项目启动' | '合同签订';
  description: string;
}

// -------------------- 团队成员 --------------------
export interface MemberProject {
  projectName: string;
  startDate: string;
  endDate: string;
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
  projects?: MemberProject[]; // 进行中的项目详情
}

// -------------------- 测试文档 --------------------
export interface TestDoc {
  id: string;
  title: string;
  category: DocCategory;
  lastUpdated: string;
  content?: string;
  fileName?: string;
  fileSize?: string;
  fileType?: string;
  fileUrl?: string;
}

// -------------------- 资源计算 --------------------
export interface ResourceCalcInput {
  // IT 负载
  itLoadKw: number;           // IT负载(kW)
  redundancy: 'N' | 'N+1' | '2N';  // 冗余方式

  // 功率因数
  powerFactor: number;         // 功率因数 (0.8-1.0)

  // 设计冗余度
  designRedundancy: number;    // 设计冗余度 (0.8-1.2)

  // 变压器相关
  transformerCapacity: number; // 单台变压器容量(kVA)
  transformerQuantity: number;  // 变压器数量

  // 柴发相关
  generatorCapacity: number;   // 单台柴发容量(kW)
  generatorQuantity: number;   // 柴发数量

  // 暖通相关
  chillerCapacity: number;     // 单台冷机容量(kW)
  chillerQuantity: number;     // 冷机数量
  coolingTowerQuantity: number;// 冷却塔数量
  pumpQuantity: number;        // 水泵数量
}

export interface ResourceCalcResult {
  // 电力系统
  it变容量: number;            // IT变压器容量(kVA)
  动力变容量: number;          // 动力变压器容量(kVA)
  总变压器容量: number;        // 总变压器容量(kVA)
  ups容量: number;             // UPS容量(kW)
  柴发总容量: number;         // 柴发总容量(kW)

  // 暖通系统
  冷机总冷量: number;          // 冷机总冷量(kW)
  冷却塔总冷量: number;       // 冷却塔总冷量(kW)
  水泵总功率: number;          // 水泵总功率(kW)

  // PUE
  pue: number;
  it总耗电: number;            // IT总耗电(kW)
  暖通总耗电: number;          // 暖通总耗电(kW)
  照明总耗电: number;          // 照明总耗电(kW)
  其他总耗电: number;          // 其他总耗电(kW)
  总耗电: number;              // 总耗电(kW)
}

// -------------------- API 响应 --------------------
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
