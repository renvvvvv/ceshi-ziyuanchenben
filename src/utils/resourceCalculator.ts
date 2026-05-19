/**
 * 数据中心测试资源规划计算逻辑 — TypeScript 移植版
 * 来源: resource_plan.py V10
 */

// ============ 类型 ============

export interface ResourceInput {
  total_mw: number;
  total_duration: number;
  cabinet_power: number;
  it_transformers: [number, number][]; // [容量(MW), 台数]
  power_transformers: [number, number][];
  total_cabinets: number;
  ac_type: string;
}

export interface StaffResult {
  架构?: string;
  单台人数: number;
  总台数: number;
  单台天数: number;
  所需并行数: number;
  实际测试工期: number;
  同时在场人数: number;
  总人天: number;
}

export interface HvacrResult {
  空调间数: number;
  机房数: number;
  功能测试: { 组数: number; 每组人数: number; 同时在场: number; 人天: number };
  场景压测: { 组数: number; 每组人数: number; 同时在场: number; 人天: number };
  前端冷源: { 人数: number; 人天: number };
  安装检查: { 人数: number; 人天: number };
  暖通总组数: number;
  峰值同时在场: number;
  总人天: number;
}

export interface LoadResult {
  IT负载配置: Record<string, unknown>;
  '6kW': { 总需求: number; 自有: number; 需租赁: number };
  '8kW': { 总需求: number; 自有: number; 需租赁: number };
  '500kW': { 总需求: number; 需租赁: number };
  '300kW': { 总需求: number; 需租赁: number };
}

export interface ToolItem {
  name: string;
  count: number;
  days: number;
  totalUnits: number;
  model: string;
  note: string;
}

export interface ResourceReport {
  项目信息: Record<string, string>;
  IT链路: StaffResult;
  动力链路: StaffResult;
  暖通: HvacrResult;
  柴发: { 主测: number; 记录员: number; 小计: number };
  弱电: { 主测: number; 电气记录员: number; 暖通记录员: number; 记录员小计: number; 小计: number };
  消防: { 主测: number; 测试员: number; 小计: number };
  固定人员: { 项目经理: number; 资料员: number; 电气主测: number; 暖通主测: number; 弱电主测: number; 消防主测: number; 小计: number };
  负载: LoadResult;
  汇总: { 峰值同时在场: number; 总人天: number };
  工具清单: ToolItem[];
  假负载清单: { name: string; count: number; days: number; totalUnits: number; spare: number; spec: string }[];
  劳务清单: { 总人天: number };
  机柜PDU清单: { 机柜: { count: number; days: number; totalUnits: number }; PDU: { count: number; days: number; totalUnits: number } };
}

// ============ 配置 ============

const config = {
  load_config: { unit_mw: 1.1, redundancy: 1.1 },
  it_load_per_mw: {
    '12': { '6kw': 83, '8kw': 83, per_cabinet: 2, cabinets_per_unit: 92 },
    '16': { '6kw': 95, '8kw': 95, per_cabinet: 2, cabinets_per_unit: 69 },
    '18': { '6kw': 56, '8kw': 112, per_cabinet: 3, cabinets_per_unit: 61 },
    '20': { '6kw': 56, '8kw': 112, per_cabinet: 3, cabinets_per_unit: 55 },
    '22': { '6kw': 0, '8kw': 183, per_cabinet: 3, cabinets_per_unit: 50 },
    '24': { '6kw': 0, '8kw': 183, per_cabinet: 3, cabinets_per_unit: 45 },
    '26': { '6kw': 39, '8kw': 117, per_cabinet: 4, cabinets_per_unit: 42 },
  } as Record<string, Record<string, number>>,
  power_load_config: {
    '1.3': { '500kw': 2, '300kw': 0 },
    '2.3': { '500kw': 4, '300kw': 1 },
    '3.1': { '500kw': 5, '300kw': 0 },
  } as Record<string, Record<string, number>>,
  owned_loads: { '6kw': 1000, '8kw': 1000 },
  staff_per_transformer: { it: 6, power: 4 },
  days_per_transformer: { functional_test: 4, install_check: 2, total: 6 },
};

// ============ 空调类型归一化 ============

const AC_TYPE_MAP: Record<string, string> = {
  liquid: '液冷', water: '水冷', dual: '双冷源',
  air: '风冷', 'air-cooled': '风冷',
  '液冷': '液冷', '水冷': '水冷', '双冷源': '双冷源', '风冷': '风冷', '冷冻水': '水冷',
};

function normalizeAcType(acType: string): string {
  return AC_TYPE_MAP[acType.toLowerCase().trim()] || acType;
}

function isLiquidCooled(acType: string): boolean {
  const t = normalizeAcType(acType);
  return ['液冷', '双冷源', '水冷'].includes(t);
}

// ============ 并行数计算 ============

function calcParallel(totalUnits: number, daysPerUnit: number, totalDuration: number) {
  const totalWorkload = totalUnits * daysPerUnit;
  const minParallel = Math.ceil(totalWorkload / totalDuration);
  return {
    total_units: totalUnits, days_per_unit: daysPerUnit,
    total_workload: totalWorkload, total_duration: totalDuration,
    min_parallel: minParallel, actual_parallel: minParallel,
  };
}

// ============ 电气人员 ============

function calcItStaff(input: ResourceInput): StaffResult {
  const perUnit = config.staff_per_transformer.it;
  const daysPerUnit = config.days_per_transformer.total;
  const itCount = input.it_transformers.reduce((s, [, n]) => s + n, 0);
  const para = calcParallel(itCount, daysPerUnit, input.total_duration);
  const parallel = para.actual_parallel;
  const actualDur = Math.ceil(itCount / parallel) * daysPerUnit;
  return {
    架构: '标准架构', 单台人数: perUnit, 总台数: itCount,
    单台天数: daysPerUnit, 所需并行数: parallel,
    实际测试工期: actualDur, 同时在场人数: perUnit * parallel,
    总人天: perUnit * parallel * actualDur,
  };
}

function calcPowerStaff(input: ResourceInput): StaffResult {
  const perUnit = config.staff_per_transformer.power;
  const daysPerUnit = config.days_per_transformer.total;
  const pwCount = input.power_transformers.reduce((s, [, n]) => s + n, 0);
  const para = calcParallel(pwCount, daysPerUnit, input.total_duration);
  const parallel = para.actual_parallel;
  const actualDur = Math.ceil(pwCount / parallel) * daysPerUnit;
  return {
    单台人数: perUnit, 总台数: pwCount, 单台天数: daysPerUnit,
    所需并行数: parallel, 实际测试工期: actualDur,
    同时在场人数: perUnit * parallel, 总人天: perUnit * parallel * actualDur,
  };
}

// ============ 负载 ============

function calcLoads(input: ResourceInput): LoadResult {
  const redundancy = config.load_config.redundancy;
  const itLoadCfg = config.it_load_per_mw;
  const powerLoadCfg = config.power_load_config;
  const owned = config.owned_loads;

  const cpKey = String(input.cabinet_power);
  const itCfg = itLoadCfg[cpKey];
  if (!itCfg) {
    return { IT负载配置: {}, '6kW': { 总需求: 0, 自有: 0, 需租赁: 0 }, '8kW': { 总需求: 0, 自有: 0, 需租赁: 0 }, '500kW': { 总需求: 0, 需租赁: 0 }, '300kW': { 总需求: 0, 需租赁: 0 } };
  }

  const totalIt = input.it_transformers.reduce((s, [, n]) => s + n, 0);
  const total6kw = Math.ceil(totalIt * itCfg['6kw'] * redundancy);
  const total8kw = Math.ceil(totalIt * itCfg['8kw'] * redundancy);

  const totalPw = input.power_transformers.reduce((s, [, n]) => s + n, 0);
  let total500kw = 0, total300kw = 0;
  if (totalPw > 0) {
    const maxCap = Math.max(...input.power_transformers.map(([c]) => c));
    const pcKey = maxCap <= 1.3 ? '1.3' : maxCap <= 2.3 ? '2.3' : '3.1';
    const pc = powerLoadCfg[pcKey];
    total500kw = pc['500kw'];
    total300kw = pc['300kw'];
  }

  return {
    IT负载配置: {
      单机柜功率: `${input.cabinet_power}kW`,
      IT变压器总台数: totalIt,
      每台1_1MW配置: `6kW:${itCfg['6kw']}台, 8kW:${itCfg['8kw']}台`,
    },
    '6kW': { 总需求: total6kw, 自有: Math.min(total6kw, owned['6kw']), 需租赁: Math.max(0, total6kw - owned['6kw']) },
    '8kW': { 总需求: total8kw, 自有: Math.min(total8kw, owned['8kw']), 需租赁: Math.max(0, total8kw - owned['8kw']) },
    '500kW': { 总需求: total500kw, 需租赁: Math.max(0, total500kw) },
    '300kW': { 总需求: total300kw, 需租赁: Math.max(0, total300kw) },
  };
}

// ============ 固定人员 / 柴发 ============

function calcFixedStaff() {
  return { 项目经理: 1, 资料员: 1, 电气主测: 1, 暖通主测: 1, 弱电主测: 1, 消防主测: 1, 小计: 6 };
}

function calcGenerator() {
  return { 主测: 1, 记录员: 1, 小计: 2 };
}

// ============ 暖通 ============

function calcHvacr(input: ResourceInput): HvacrResult {
  const itCount = input.it_transformers.reduce((s, [, n]) => s + n, 0);
  const acRooms = itCount * 2;
  const idcRooms = itCount;
  const dur = input.total_duration;

  const funcGrp = Math.max(1, Math.ceil((acRooms * 2) / dur));
  const scenGrp = Math.max(1, Math.ceil((idcRooms * 1) / dur));

  const funcPeak = funcGrp * 3;
  const scenPeak = scenGrp * 5;
  const funcMd = acRooms * 3 * 2;
  const scenMd = idcRooms * 5 * 1;

  const coldPeak = isLiquidCooled(input.ac_type) ? 3 : 0;
  const coldMd = coldPeak * dur;

  const instPeak = Math.ceil(input.total_mw / 10) * 4;
  const instMd = instPeak * 1;

  return {
    空调间数: acRooms, 机房数: idcRooms,
    功能测试: { 组数: funcGrp, 每组人数: 3, 同时在场: funcPeak, 人天: funcMd },
    场景压测: { 组数: scenGrp, 每组人数: 5, 同时在场: scenPeak, 人天: scenMd },
    前端冷源: { 人数: coldPeak, 人天: coldMd },
    安装检查: { 人数: instPeak, 人天: instMd },
    暖通总组数: funcGrp + scenGrp + (coldPeak > 0 ? 1 : 0) + 1,
    峰值同时在场: Math.max(funcPeak, scenPeak, coldPeak, instPeak),
    总人天: funcMd + scenMd + coldMd + instMd,
  };
}

// ============ 弱电 / 消防 ============

function calcWeakCurrent(elecCount: number, hvacrGroups: number) {
  const elecRec = Math.ceil(elecCount / 4);
  const rec = elecRec + hvacrGroups;
  return { 主测: 1, 电气记录员: elecRec, 暖通记录员: hvacrGroups, 记录员小计: rec, 小计: 1 + rec };
}

function calcFire(cabinetCount: number) {
  const extra = cabinetCount <= 850 ? 0 : Math.min(Math.floor((cabinetCount - 850) / 850), 3);
  return { 主测: 1, 测试员: 1 + extra, 小计: 2 + extra };
}

// ============ 主计算 ============

export function calculateResource(input: ResourceInput): ResourceReport {
  const normalizedInput = { ...input, ac_type: normalizeAcType(input.ac_type) };

  const it = calcItStaff(normalizedInput);
  const pw = calcPowerStaff(normalizedInput);
  const hvac = calcHvacr(normalizedInput);
  const gen = calcGenerator();
  const fire = calcFire(normalizedInput.total_cabinets);
  const weak = calcWeakCurrent(it.同时在场人数 + pw.同时在场人数, hvac.暖通总组数);
  const fixed = calcFixedStaff();
  const loads = calcLoads(normalizedInput);

  const dur = normalizedInput.total_duration;
  const itMd = it.同时在场人数 * it.实际测试工期;
  const pwMd = pw.同时在场人数 * pw.实际测试工期;

  const peakStaff = it.同时在场人数 + pw.同时在场人数 + hvac.峰值同时在场
    + gen.小计 + weak.小计 + fire.小计 + fixed.小计;
  const totalManDays = itMd + pwMd + hvac.总人天
    + gen.小计 * dur + weak.小计 * dur + fire.小计 * dur + fixed.小计 * dur;

  // 电气实际工期（取 IT/动力 中较大者）
  const elecDur = Math.max(it.实际测试工期, pw.实际测试工期);
  const elecOnSite = it.同时在场人数 + pw.同时在场人数;

  // 工具清单（匹配 generate_excel.py 模板）
  const tools: ToolItem[] = [
    { name: '电能质量分析仪', count: 6, days: elecDur, totalUnits: 6 * elecDur, model: 'FLUKE 435', note: '配套6000A电流环至少6套；剩余至少2000A以上；配套数据传输线；要求435-2；配套内存卡2张' },
    { name: '电能质量分析仪', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: 'FLUKE 1775', note: '至少2000A以上电流环；配套数据传输线' },
    { name: '热成像', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: 'FLUKE Ti32', note: '' },
    { name: '点温枪', count: 4, days: elecDur, totalUnits: 4 * elecDur, model: '阈值750℃', note: '' },
    { name: '开口钳形电流表', count: 6, days: elecDur, totalUnits: 6 * elecDur, model: '/', note: '' },
    { name: 'PDU相序仪', count: 6, days: elecDur, totalUnits: 6 * elecDur, model: '/', note: '' },
    { name: '欧标转国标转接头', count: 10, days: elecDur, totalUnits: 10 * elecDur, model: '16A', note: 'PDU欧标' },
    { name: '欧标转国标转接头', count: 10, days: elecDur, totalUnits: 10 * elecDur, model: '10A', note: 'PDU欧标' },
    { name: '钳形电流表', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: 'FLUKE 381', note: '配有大线圈，量程1500~2000A至少2台' },
    { name: '温湿度仪', count: 4, days: elecDur, totalUnits: 4 * elecDur, model: 'FLUKE 971', note: '' },
    { name: '万用表', count: 6, days: elecDur, totalUnits: 6 * elecDur, model: 'FLUKE 18B+', note: '' },
    { name: '振动仪', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: '/', note: '' },
    { name: '风速仪', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: '/', note: '' },
    { name: '噪声仪', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: '/', note: '' },
    { name: '电池内阻仪', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: '福禄克/日置', note: '' },
    { name: 'HOBO', count: 3, days: elecDur, totalUnits: 3 * elecDur, model: '/', note: '机房最小需量，字节脚本单通道3需布置3台' },
  ];

  // 假负载清单（+10%余量，匹配 generate_excel.py）
  const spare = 0.1;
  const fakeLoads = [
    { name: '风冷机架式假负载', count: Math.ceil(loads['6kW'].总需求 * (1 + spare)), days: elecDur, totalUnits: Math.ceil(loads['6kW'].总需求 * (1 + spare)) * elecDur, spare, spec: '6KW/台' },
    { name: '风冷机架式假负载', count: Math.ceil(loads['8kW'].总需求 * (1 + spare)), days: elecDur, totalUnits: Math.ceil(loads['8kW'].总需求 * (1 + spare)) * elecDur, spare, spec: '8KW/台' },
    { name: '风冷机架式假负载', count: Math.ceil(loads['500kW'].总需求 * (1 + spare)), days: dur, totalUnits: Math.ceil(loads['500kW'].总需求 * (1 + spare)) * dur, spare: 0, spec: '500KW/台（0~500kW可调，每档≤10kW）\n电缆长度预估：130m' },
    { name: '风冷机架式假负载', count: Math.ceil(loads['300kW'].总需求 * (1 + spare)), days: dur, totalUnits: Math.ceil(loads['300kW'].总需求 * (1 + spare)) * dur, spare: 0, spec: '300KW/台（0~300kW可调，每档≤10kW）\n电缆长度预估：80m' },
    { name: '风冷机架式假负载', count: 2, days: dur, totalUnits: 2 * dur, spare: 0, spec: '2000KW/台（0~2000kW可调，每档≤10kW）\n电缆长度预估：100m' },
  ];

  const cabCount = normalizedInput.total_cabinets;

  return {
    项目信息: {
      总容量: `${normalizedInput.total_mw}MW`,
      工期: `${dur}天`,
      单机柜功率: `${normalizedInput.cabinet_power}kW`,
      总机柜: `${normalizedInput.total_cabinets}个`,
      空调: normalizedInput.ac_type,
    },
    IT链路: it,
    动力链路: pw,
    暖通: hvac,
    柴发: gen,
    弱电: weak,
    消防: fire,
    固定人员: fixed,
    负载: loads,
    汇总: { 峰值同时在场: peakStaff, 总人天: totalManDays },
    工具清单: tools,
    假负载清单: fakeLoads,
    劳务清单: { 总人天: totalManDays },
    机柜PDU清单: {
      机柜: { count: cabCount, days: dur, totalUnits: cabCount * dur },
      PDU: { count: cabCount * 2, days: dur, totalUnits: cabCount * 2 * dur },
    },
  };
}
