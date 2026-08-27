/**
 * 测试项目资源配置 — 数据类型定义
 *
 * 来源：外来「测试资源配置软件」（单文件 HTML 工具，localStorage 键 testProjectConfig_v1）
 * 提取自 index.html 主脚本（DEFAULT_PROJECT 模板 + ensureProjectFields 归一化逻辑）。
 * 本文件是后续整合进主平台（React 页面 + PostgreSQL 存储）的数据契约，
 * 字段名与原工具的 JSON 导出格式保持一致，保证存量备份数据可直接导入。
 *
 * ⚠ 字段语义备注（与原工具行为对齐，勿随意更改）：
 *  - 派生字段（personnel.count / staff.total / loads.days / instruments.own|rent /
 *    假负载 own|rent / labor auto 模式下的 workers）在原工具中由计算得出并回写存储。
 *    入库时只应保存输入列，派生值由服务端计算或视图承载。
 *  - loads.ratio 字段名历史遗留，实际语义是「备用台数」。
 *  - subsidy.days / subsidy.rate 是已废弃的遗留字段，UI 不再编辑，仅为兼容旧数据保留。
 *  - 职级双轨制：内部统一存储 T7~T4，展示层映射为 P7~P4（lvlP）。
 */

// ============== 基础 ==============

export type ResourceConfigID = string;

/** 职级（内部存储值，界面显示为 P7~P4） */
export type StaffLevel = 'T3' | 'T4' | 'T5' | 'T6' | 'T7';

/** 投入明细岗位（可扩展自定义） */
export type StaffPost = '经理' | '暖通' | '电气' | '消防' | '弱电' | (string & {});

/** 角色（由岗位派生或手选） */
export type StaffRole = '主测' | '测试工程师' | '经理' | '组员';

/** 岗位补贴的测试岗位（仅三类） */
export type SubsidyPost = '测试经理' | '主测岗位' | '测试工程师';

/** 自有资源库类别 */
export type AssetCategory = 'load' | 'ins' | 'pdu' | 'cabinet';

/** 劳务负载类型 */
export type LaborLoadType = '风冷' | '液冷' | '集中式假负载' | '其他';

/** 劳务核算模式 */
export type LaborMode = 'auto' | 'byman' | 'experience';

/** 「第几天」字段：数字或旧版字符串（"第4天"） */
export type DayRef = number | string;

// ============== 项目与各模块行 ==============

/** 人员岗位配置 */
export interface PersonnelRow {
  id: ResourceConfigID;
  post: string;
  /** 派生：= lead + member */
  count: number;
  lead: number;
  member: number;
  duty: string;
  division: string;
  names: string;
}

/** 测试人员投入明细 */
export interface StaffRow {
  id: ResourceConfigID;
  name: string;
  company: string;
  level: StaffLevel;
  post: StaffPost;
  role: StaffRole;
  /** 派生：= survey + retest + test */
  total: number;
  survey: number;
  retest: number;
  test: number;
}

/** 岗位补贴 */
export interface SubsidyRow {
  id: ResourceConfigID;
  post: SubsidyPost;
  count: number;
  /** @deprecated 遗留字段，UI 已不编辑 */
  days?: number;
  /** @deprecated 遗留字段，UI 已不编辑 */
  rate?: number;
  remark: string;
}

/** 外部租赁人员 */
export interface ExternalRow {
  id: ResourceConfigID;
  name: string;
  total: number;
  survey: number;
  retest: number;
  unit: string;
  count: number;
  remark: string;
}

/** 假负载计划 */
export interface LoadRow {
  id: ResourceConfigID;
  /** "__RENT__"/"🛒 租赁" = 纯租赁；含"去离子" = 水负载不参与分配 */
  type: string;
  count: number;
  /** 历史遗留字段名，实际语义 = 备用台数 */
  ratio: number;
  spec: string;
  arrive: DayRef;
  start: DayRef;
  end: DayRef;
  leave: DayRef;
  /** 派生：= max(0, leave - start) */
  days: number;
  remark: string;
  note: string;
  cycleMode?: 'date';
  relStart?: number;
  relEnd?: number;
}

/** 仪器仪表 */
export interface InstrumentRow {
  id: ResourceConfigID;
  name: string;
  demand: number;
  /** 派生：自有（按资源库同名匹配分配） */
  own: number;
  /** 派生：需租赁 = demand - own */
  rent: number;
  days: number;
  remark: string;
  hidden: boolean;
}

/** 现场耗材 / 劳保用品（同构） */
export interface ConsumableRow {
  id: ResourceConfigID;
  name: string;
  count: number;
  unit: string;
  note: string;
}

/** 劳务人员 */
export interface LaborRow {
  id: ResourceConfigID;
  work: string;
  type: LaborLoadType;
  mode: LaborMode;
  qty: number;
  /** auto 模式输入：每人每天工作量（台/人·天） */
  daily: number;
  days: number;
  /** byman/experience 输入；auto 派生（= ⌈人天÷天数⌉），可手填覆盖 */
  workers: number;
  /** auto 模式下手填过人数则为 true */
  workersCustom: boolean;
  note: string;
}

/** 测试证书三段 */
export interface CertSection {
  req: string;
  region: string;
  time: string;
}
export interface CertConfig {
  cqc: CertSection;
  air: CertSection;
  emc: CertSection;
}

/** 资源配置项目（原工具的单个项目） */
export interface ResourceConfigProject {
  id: ResourceConfigID;
  name: string;
  mw: string | number;
  site: string;
  manager: string;
  testDays: number;
  startDate: string;
  endDate: string;
  remark: string;
  personnel: PersonnelRow[];
  staff: StaffRow[];
  subsidy: SubsidyRow[];
  external: ExternalRow[];
  /** @deprecated 旧版项目内自有负载清单，已被全局资源库取代，仅迁移兼容 */
  assets?: Array<{ id: ResourceConfigID; type: string; spec: string; count: number }>;
  loads: LoadRow[];
  instruments: InstrumentRow[];
  consumables: ConsumableRow[];
  labor: LaborRow[];
  safety: ConsumableRow[];
  cert: CertConfig;
}

// ============== 全局库 ==============

/** 自有资源库条目（部门级，跨项目共用）。spec 中的功率数字有语义（用于假负载匹配） */
export interface AssetLibItem {
  id: ResourceConfigID;
  cat: AssetCategory;
  name: string;
  spec: string;
  count: number;
  note: string;
}

/** 部门人员库成员 */
export interface DeptMember {
  id: ResourceConfigID;
  name: string;
  level: StaffLevel;
  post: string;
  company: string;
  phone: string;
  skill: string;
  note: string;
}

/** 已交付项目存档（完整项目快照，只读） */
export interface DeliveredResourceProject {
  id: ResourceConfigID;
  savedAt: number;
  name: string;
  mw: string;
  site: string;
  manager: string;
  testDays: number;
  startDate: string;
  endDate: string;
  remark: string;
  /** 完整项目快照 */
  data: ResourceConfigProject;
}

// ============== 存储形状（与原工具 localStorage 布局对齐） ==============

/** localStorage: testProjectConfig_v1 */
export interface ResourceConfigStore {
  projects: Record<ResourceConfigID, ResourceConfigProject>;
  currentId: ResourceConfigID | null;
}

/** 原工具 JSON 导出格式（单项目） */
export interface ResourceConfigExport {
  app: '测试项目资源配置工具';
  version: 1;
  exportTime: string;
  project: ResourceConfigProject;
}

// ============== 核心计算（与原工具公式一致，整合时作为唯一实现） ==============

export interface LaborCalcResult {
  mode: LaborMode;
  /** 人天 */
  manDays: number;
  /** 需要人数（auto 派生或手填） */
  workers: number;
  /** 每人每天强度（experience 模式为 0，仅参考） */
  daily: number;
  /** experience 模式标记（界面显示 "—"） */
  exp: boolean;
}

/**
 * 劳务核算（原 index.html laborCalc，L4101-4125）：
 *  - auto（强度驱动）：人天 = 数量 ÷ 强度；人数 = ⌈人天 ÷ 作业天数⌉（唯一向上取整点）
 *  - byman（按人数）：人天 = 人数 × 作业天数；强度为反推参考值
 *  - experience（凭经验）：人天 = 人数 × 作业天数；强度不计算
 */
export function calcLabor(r: LaborRow): LaborCalcResult {
  const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : parseFloat(String(v)) || 0);
  const qty = Math.max(0, num(r.qty));
  const days = Math.max(1, num(r.days));
  const mode: LaborMode = r.mode === 'byman' ? 'byman' : r.mode === 'experience' ? 'experience' : 'auto';

  if (mode === 'auto') {
    const daily = Math.max(0, num(r.daily));
    const manDays = daily > 0 ? qty / daily : 0;
    const autoWorkers = daily > 0 ? Math.ceil(manDays / days) : 0;
    const workers = r.workersCustom ? Math.max(0, Math.round(num(r.workers))) : autoWorkers;
    return { mode, manDays, workers, daily, exp: false };
  }
  // byman / experience
  const workers = Math.max(0, Math.round(num(r.workers)));
  const manDays = workers * days;
  const daily = mode === 'byman' && manDays > 0 ? qty / manDays : 0;
  return { mode, manDays, workers, daily, exp: mode === 'experience' };
}

/**
 * 假负载/仪表 自有优先分配（原 computeLoadAllocation L2871-2894 / computeInsAllocation L2897-2913）
 * need = count + 备用(ratio)；库存按资源库匹配顺序消耗；own = min(库存剩余, 需求)，rent = need - own
 */
export interface AllocationResult { own: number; rent: number }

export function calcLoadAllocation(
  loads: LoadRow[],
  assets: AssetLibItem[],
): Record<ResourceConfigID, AllocationResult> {
  const result: Record<ResourceConfigID, AllocationResult> = {};
  const stock = assets
    .filter((a) => (a.cat === 'load' || a.cat === 'pdu') && a.count > 0)
    .map((a) => {
      const m = /(\d+(\.\d+)?)\s*kw/i.exec(a.spec || '');
      return { kw: m ? parseFloat(m[1]) : null, remain: a.count, a };
    });
  for (const r of loads) {
    const need = Math.max(0, r.count) + Math.max(0, r.ratio);
    if ((r.type || '').includes('去离子')) { result[r.id] = { own: 0, rent: 0 }; continue; }
    let own = 0;
    if (r.type === '__RENT__' || (r.type || '').startsWith('🛒')) {
      result[r.id] = { own: 0, rent: need };
      continue;
    }
    const hay = `${r.type}${r.spec || ''}`.toUpperCase();
    for (const s of stock) {
      if (own >= need) break;
      // pdu：资源库名称包含于负载类型+规格；load：规格含 "{kw}KW"（统一大写匹配）
      const hit = s.a.cat === 'pdu'
        ? hay.includes((s.a.name || '').toUpperCase())
        : s.kw != null && hay.includes(`${s.kw}KW`);
      if (hit) {
        const take = Math.min(s.remain, need - own);
        own += take; s.remain -= take;
      }
    }
    result[r.id] = { own, rent: need - own };
  }
  return result;
}

export function calcInstrumentAllocation(instruments: InstrumentRow[], assets: AssetLibItem[]): Record<ResourceConfigID, AllocationResult> {
  const stockByName = new Map<string, number>();
  for (const a of assets) {
    if (a.cat !== 'ins') continue;
    stockByName.set(a.name, (stockByName.get(a.name) || 0) + a.count);
  }
  const result: Record<ResourceConfigID, AllocationResult> = {};
  for (const r of instruments) {
    if (r.hidden || !r.name) continue;
    const demand = Math.max(0, r.demand);
    const total = stockByName.get(r.name) || 0;
    const own = Math.min(demand, total);
    result[r.id] = { own, rent: demand - own };
  }
  return result;
}

// ============== 枚举字典（数据字典单一来源） ==============

export const STAFF_LEVELS: StaffLevel[] = ['T7', 'T6', 'T5', 'T4'];
/** 职级展示映射（内部 T → 界面 P） */
export const levelDisplay = (lv: StaffLevel): string => lv.replace(/^T/, 'P');

export const STAFF_POSTS: string[] = ['经理', '暖通', '电气', '消防', '弱电'];
export const SUBSIDY_POSTS: SubsidyPost[] = ['测试经理', '主测岗位', '测试工程师'];
export const LABOR_LOAD_TYPES: LaborLoadType[] = ['风冷', '液冷', '集中式假负载', '其他'];
export const ASSET_CATEGORIES: Array<{ value: AssetCategory; label: string }> = [
  { value: 'load', label: '假负载' },
  { value: 'ins', label: '仪器仪表' },
  { value: 'pdu', label: 'PDU' },
  { value: 'cabinet', label: '机柜' },
];

/** 补贴岗位 → 角色 映射（原 subsidyPostToRole） */
export function subsidyPostToRole(post: string): StaffRole {
  if (post.includes('经理')) return '经理';
  if (post.includes('主测')) return '主测';
  return '测试工程师';
}

/** 岗位 → 角色 派生（原 deriveRole） */
export function deriveRole(post: string): StaffRole {
  if ((post || '').includes('经理')) return '经理';
  if ((post || '').includes('主测') || (post || '').includes('组长')) return '主测';
  if ((post || '').includes('测试工程师') || (post || '').includes('工程师')) return '测试工程师';
  return '组员';
}

/** 假负载使用天数：days = max(0, leave - start)（兼容 "第4天" 字符串） */
export function parseDayRef(v: DayRef | undefined): number {
  if (typeof v === 'number') return v;
  const m = /(\d+)/.exec(String(v || ''));
  return m ? parseInt(m[1], 10) : 0;
}
export function calcLoadDays(r: LoadRow): number {
  return Math.max(0, parseDayRef(r.leave) - parseDayRef(r.start));
}
