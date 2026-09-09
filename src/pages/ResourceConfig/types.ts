/**
 * 资源配置 · 数据模型（与新工具 8 键存储严格一致，勿改字段名——云端数据兼容生命线）
 */

export interface RcPersonnel {
  id: string | number; post: string; count: number;
  duty?: string; division?: string; names?: string;
}
export interface RcStaff {
  id: string | number; name: string; company: string;
  level: string; post: string;
  total: number; survey: number; retest: number; test: number;
}
export interface RcSubsidy { id: string | number; post: string; count: number; days: number; rate: number; remark?: string; }
export interface RcExternal { id: string | number; name: string; total: number; survey: number; retest: number; unit?: string; count?: number; remark?: string; }
export interface RcLoad {
  id: string | number; type: string; count: number; ratio: number; spec?: string;
  arrive?: string; start?: string; end?: string; leave?: string;
  days?: number; remark?: string; note?: string;
  own?: number; rent?: number;
}
export interface RcInstrument { id: string | number; name: string; demand: number; own?: number; rent?: number; days?: number; remark?: string; }
export interface RcConsumable { id: string | number; name: string; count: number; unit?: string; note?: string; }
export interface RcLabor { id: string | number; work: string; type?: string; qty: number; daily: number; days: number; note?: string; }
export interface RcSafety { id: string | number; name: string; count: number; unit?: string; note?: string; }
export interface RcCert { electrical?: string; hvac?: string; fire?: string; weak?: string; [k: string]: unknown; }

export interface RcProject {
  id: string;
  name: string; mw: string | number; site: string; manager: string;
  testDays: number; startDate: string; endDate: string; remark: string;
  personnel: RcPersonnel[]; staff: RcStaff[]; subsidy: RcSubsidy[]; external: RcExternal[];
  loads: RcLoad[]; instruments: RcInstrument[]; consumables: RcConsumable[];
  labor: RcLabor[]; safety: RcSafety[];
  cert?: RcCert;
}

export interface RcAsset { cat: 'load' | 'ins' | 'pdu' | 'cabinet' | 'equip' | string; name: string; spec?: string; count: number; note?: string; }
export interface RcDeptMember { id: string | number; name: string; level: string; post: string; company: string; phone?: string; skill?: string; note?: string; }
export interface RcDelivered {
  id: string | number; savedAt?: string;
  name: string; mw?: string | number; site?: string; manager?: string;
  testDays?: number; startDate?: string; endDate?: string; remark?: string;
  personnel?: RcPersonnel[]; staff?: RcStaff[]; subsidy?: RcSubsidy[]; external?: RcExternal[];
  loads?: RcLoad[]; instruments?: RcInstrument[]; consumables?: RcConsumable[];
  labor?: RcLabor[]; safety?: RcSafety[]; cert?: RcCert;
}

export interface ProjectConfig { projects: Record<string, RcProject>; currentId: string; }
export interface LockState { locked: boolean; password: string; }

export const LS_KEYS = {
  config: 'testProjectConfig_v1',
  assets: 'testAssetsLib_v1',
  assetsLock: 'testAssetsLibLock_v1',
  dept: 'deptMembersLib_v1',
  deptLock: 'deptLibLock_v1',
  delivered: 'testDeliveredProjects_v1',
  deliveredLock: 'testDeliveredLock_v1',
  deliveredPw: 'testDeliveredEditPw_v1',
} as const;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
