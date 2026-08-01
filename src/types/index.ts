// ============================================================
// 智航万恒测试验证管理平台 - 类型定义
// ============================================================

// -------------------- 枚举类型 --------------------
export type ProjectStatus = '未开始' | '测试中' | '已完成' | '阻塞';
export type MemberStatus = '空闲' | '测试中' | '休假';

export type BusinessType = '新建测试' | '扩容测试' | '年度复测' | '改造测试' | '验收测试';

export type DocCategory = '电气系统' | '暖通系统' | '弱电系统' | '消防系统';

// -------------------- 项目相关 --------------------
export interface Project {
  id: string;
  name: string;
  city?: string;              // 所在城市
  customer: string;           // 客户名称
  status: ProjectStatus;
  manager: string;
  startDate: string;
  endDate: string;
  plannedDeliveryDate?: string;
  actualDeliveryDate?: string;
  itOutput: number; // MW
  plannedManpower?: number;    // 计划投入人力（人）
  businessType?: BusinessType;
  description?: string;
  docLink?: string;            // 测试管理文档链接
  updatedAt: string;
  assignedMemberIds?: string[]; // 指派人员ID列表
}

// 历史项目 - 继承 Project（保留 docLink 等字段）
export interface HistoricalProject extends Project {}

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

// -------------------- 项目阶段（时间线） --------------------
export interface ProjectPhaseFile {
  id: string;
  fileName: string;
  fileSize?: string;
  fileType?: string;
  uploadedAt: string;
}

export interface ProjectPhase {
  key: string;                    // 阶段标识
  name: string;                   // 阶段名称
  description: string;            // 阶段说明
  status: 'pending' | 'in_progress' | 'completed'; // 阶段状态
  date?: string;                  // 完成日期
  files: ProjectPhaseFile[];      // 已上传文件
  allowUpload: boolean;           // 是否允许上传
}

// -------------------- 时间线事件（兼容旧数据） --------------------
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
  position?: string;          // 岗位：助理测试工程师/测试工程师/项目主测/项目经理
  avatar?: string;
  skills: string[];
  currentProjects: string[];
  email?: string;
  phone?: string;
  projects?: MemberProject[]; // 进行中的项目详情
  upcomingProjects?: MemberProject[]; // 未来指派的项目
  leaveStartDate?: string;    // 休假开始日期
  leaveEndDate?: string;      // 休假结束日期
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

// -------------------- 权限系统 --------------------
export type UserRole = '管理者' | '编辑者' | '阅读者';

export type AppModule =
  | 'dashboard'
  | 'projects'
  | 'history'
  | 'teamPool'
  | 'testGuide'
  | 'resourceCalc'
  | 'attendance'
  | 'reportReview'
  | 'permissionConfig'
  | 'aiTestExpert';

export interface ModulePermission {
  module: AppModule;
  view: boolean;
  edit: boolean;
  delete: boolean;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  avatar?: string;
  loginType?: 'password' | 'feishu';   // 登录方式（飞书登录 vs 账密）
  deptNames?: string[];                // 飞书用户部门列表
  manualRole?: UserRole;                // 管理员手动覆盖的角色（优先于 role）
  manualPerms?: ModulePermission[];      // 管理员按账号单独覆盖的模块权限（优先于角色默认权限）
}

export interface PermissionConfig {
  role: UserRole;
  permissions: ModulePermission[];
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  permissionMap: Record<AppModule, ModulePermission>;
}
