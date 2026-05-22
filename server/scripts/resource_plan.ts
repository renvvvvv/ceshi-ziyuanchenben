/**
 * 数据中心测试资源规划 — 后端计算引擎
 * 移植自 resource_plan.py V10 + generate_excel.py
 */

// ============ 类型 ============

export interface ResourceInput {
  total_mw: number; total_duration: number; cabinet_power: number;
  it_transformers: [number, number][]; power_transformers: [number, number][];
  total_cabinets: number; ac_type: string;
}

export interface StaffResult {
  架构?: string; 单台人数: number; 总台数: number; 单台天数: number;
  所需并行数: number; 实际测试工期: number; 同时在场人数: number; 总人天: number;
}

export interface HvacrResult {
  空调间数: number; 机房数: number;
  功能测试: { 组数: number; 每组人数: number; 同时在场: number; 人天: number };
  场景压测: { 组数: number; 每组人数: number; 同时在场: number; 人天: number };
  前端冷源: { 人数: number; 人天: number };
  安装检查: { 人数: number; 人天: number };
  暖通总组数: number; 峰值同时在场: number; 总人天: number;
}

export interface ResourceReport {
  项目信息: Record<string, string>;
  IT链路: StaffResult; 动力链路: StaffResult; 暖通: HvacrResult;
  柴发: { 主测: number; 记录员: number; 小计: number };
  弱电: { 主测: number; 电气记录员: number; 暖通记录员: number; 记录员小计: number; 小计: number };
  消防: { 主测: number; 测试员: number; 小计: number };
  固定人员: { 项目经理: number; 资料员: number; 电气主测: number; 暖通主测: number; 弱电主测: number; 消防主测: number; 小计: number };
  负载: Record<string, unknown>;
  汇总: { 峰值同时在场: number; 总人天: number };
  工具清单: { name: string; count: number; days: number; totalUnits: number; model: string; note: string }[];
  假负载清单: { name: string; count: number; days: number; totalUnits: number; spare: number; spec: string }[];
  劳务清单: { 总人天: number };
  机柜PDU清单: { 机柜: { count: number; days: number; totalUnits: number }; PDU: { count: number; days: number; totalUnits: number } };
}

// ============ 配置 ============

const config = {
  load_config: { unit_mw: 1.1, redundancy: 1.1 },
  it_load_per_mw: {
    '12': { '6kw': 83, '8kw': 83 }, '16': { '6kw': 95, '8kw': 95 },
    '18': { '6kw': 56, '8kw': 112 }, '20': { '6kw': 56, '8kw': 112 },
    '22': { '6kw': 0, '8kw': 183 }, '24': { '6kw': 0, '8kw': 183 },
    '26': { '6kw': 39, '8kw': 117 },
  } as Record<string, Record<string, number>>,
  power_load_config: {
    '1.3': { '500kw': 2, '300kw': 0 }, '2.3': { '500kw': 4, '300kw': 1 },
    '3.1': { '500kw': 5, '300kw': 0 },
  } as Record<string, Record<string, number>>,
  owned_loads: { '6kw': 1000, '8kw': 1000 },
  staff_per_transformer: { it: 6, power: 4 },
  days_per_transformer: { total: 6 },
};

const AC_TYPE_MAP: Record<string, string> = {
  liquid: '液冷', water: '水冷', dual: '双冷源', air: '风冷', 'air-cooled': '风冷',
  '液冷': '液冷', '水冷': '水冷', '双冷源': '双冷源', '风冷': '风冷', '冷冻水': '水冷',
};

function normAc(acType: string): string { return AC_TYPE_MAP[acType.toLowerCase().trim()] || acType; }
function isLiquidCooled(acType: string): boolean { return ['液冷', '双冷源', '水冷'].includes(normAc(acType)); }

function calcParallel(totalUnits: number, daysPerUnit: number, totalDuration: number) {
  const minP = Math.ceil(totalUnits * daysPerUnit / totalDuration);
  return { actual_parallel: minP };
}

function calcItStaff(input: ResourceInput): StaffResult {
  const perUnit = config.staff_per_transformer.it;
  const daysPerUnit = config.days_per_transformer.total;
  const itCount = input.it_transformers.reduce((s, [, n]) => s + n, 0);
  const p = calcParallel(itCount, daysPerUnit, input.total_duration).actual_parallel;
  const actualDur = Math.ceil(itCount / p) * daysPerUnit;
  return { 单台人数: perUnit, 总台数: itCount, 单台天数: daysPerUnit, 所需并行数: p, 实际测试工期: actualDur, 同时在场人数: perUnit * p, 总人天: perUnit * p * actualDur };
}

function calcPowerStaff(input: ResourceInput): StaffResult {
  const perUnit = config.staff_per_transformer.power;
  const daysPerUnit = config.days_per_transformer.total;
  const pwCount = input.power_transformers.reduce((s, [, n]) => s + n, 0);
  const p = calcParallel(pwCount, daysPerUnit, input.total_duration).actual_parallel;
  const actualDur = Math.ceil(pwCount / p) * daysPerUnit;
  return { 单台人数: perUnit, 总台数: pwCount, 单台天数: daysPerUnit, 所需并行数: p, 实际测试工期: actualDur, 同时在场人数: perUnit * p, 总人天: perUnit * p * actualDur };
}

function calcHvacr(input: ResourceInput): HvacrResult {
  const itCount = input.it_transformers.reduce((s, [, n]) => s + n, 0);
  const acRooms = itCount * 2, idcRooms = itCount;
  const dur = input.total_duration;
  const funcGrp = Math.max(1, Math.ceil((acRooms * 2) / dur));
  const scenGrp = Math.max(1, Math.ceil((idcRooms * 1) / dur));
  const funcPeak = funcGrp * 3, scenPeak = scenGrp * 5;
  const funcMd = acRooms * 3 * 2, scenMd = idcRooms * 5 * 1;
  const coldPeak = isLiquidCooled(input.ac_type) ? 3 : 0, coldMd = coldPeak * dur;
  const instPeak = Math.ceil(input.total_mw / 10) * 4, instMd = instPeak * 1;
  const groups = funcGrp + scenGrp + (coldPeak > 0 ? 1 : 0) + 1;
  return {
    空调间数: acRooms, 机房数: idcRooms,
    功能测试: { 组数: funcGrp, 每组人数: 3, 同时在场: funcPeak, 人天: funcMd },
    场景压测: { 组数: scenGrp, 每组人数: 5, 同时在场: scenPeak, 人天: scenMd },
    前端冷源: { 人数: coldPeak, 人天: coldMd }, 安装检查: { 人数: instPeak, 人天: instMd },
    暖通总组数: groups, 峰值同时在场: Math.max(funcPeak, scenPeak, coldPeak, instPeak),
    总人天: funcMd + scenMd + coldMd + instMd,
  };
}

function calcWeakCurrent(elecCount: number, hvacrGroups: number) {
  const elecRec = Math.ceil(elecCount / 4), rec = elecRec + hvacrGroups;
  return { 主测: 1, 电气记录员: elecRec, 暖通记录员: hvacrGroups, 记录员小计: rec, 小计: 1 + rec };
}

function calcFire(cabinetCount: number) {
  const extra = cabinetCount <= 850 ? 0 : Math.min(Math.floor((cabinetCount - 850) / 850), 3);
  return { 主测: 1, 测试员: 1 + extra, 小计: 2 + extra };
}

function calcLoads(input: ResourceInput) {
  const r = config.load_config.redundancy;
  const itCfg = config.it_load_per_mw[String(input.cabinet_power)] || { '6kw': 0, '8kw': 0 };
  const totalIt = input.it_transformers.reduce((s, [, n]) => s + n, 0);
  const t6 = Math.ceil(totalIt * itCfg['6kw'] * r), t8 = Math.ceil(totalIt * itCfg['8kw'] * r);
  const totalPw = input.power_transformers.reduce((s, [, n]) => s + n, 0);
  let t500 = 0, t300 = 0;
  if (totalPw > 0) {
    const maxCap = Math.max(...input.power_transformers.map(([c]) => c));
    const pc = config.power_load_config[maxCap <= 1.3 ? '1.3' : maxCap <= 2.3 ? '2.3' : '3.1'];
    t500 = pc['500kw']; t300 = pc['300kw'];
  }
  const owned = config.owned_loads;
  return {
    '6kW': { 总需求: t6, 自有: Math.min(t6, owned['6kw']), 需租赁: Math.max(0, t6 - owned['6kw']) },
    '8kW': { 总需求: t8, 自有: Math.min(t8, owned['8kw']), 需租赁: Math.max(0, t8 - owned['8kw']) },
    '500kW': { 总需求: t500, 需租赁: t500 }, '300kW': { 总需求: t300, 需租赁: t300 },
  };
}

export function calculateResource(input: ResourceInput): ResourceReport {
  const it = calcItStaff(input), pw = calcPowerStaff(input);
  const hvac = calcHvacr(input);
  const gen = { 主测: 1, 记录员: 1, 小计: 2 };
  const fire = calcFire(input.total_cabinets);
  const weak = calcWeakCurrent(it.同时在场人数 + pw.同时在场人数, hvac.暖通总组数);
  const fixed = { 项目经理: 1, 资料员: 1, 电气主测: 1, 暖通主测: 1, 弱电主测: 1, 消防主测: 1, 小计: 6 };
  const loads = calcLoads(input);
  const dur = input.total_duration;

  const peakStaff = it.同时在场人数 + pw.同时在场人数 + hvac.峰值同时在场 + gen.小计 + weak.小计 + fire.小计 + fixed.小计;
  const totalManDays = it.总人天 + pw.总人天 + hvac.总人天 + (gen.小计 + weak.小计 + fire.小计 + fixed.小计) * dur;
  const elecDur = Math.max(it.实际测试工期, pw.实际测试工期);

  const tools = [
    { name: '电能质量分析仪', count: 6, days: elecDur, totalUnits: 6 * elecDur, model: 'FLUKE 435', note: '配套6000A电流环至少6套；剩余至少2000A以上' },
    { name: '电能质量分析仪', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: 'FLUKE 1775', note: '至少2000A以上电流环' },
    { name: '热成像', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: 'FLUKE Ti32', note: '' },
    { name: '点温枪', count: 4, days: elecDur, totalUnits: 4 * elecDur, model: '阈值750℃', note: '' },
    { name: '开口钳形电流表', count: 6, days: elecDur, totalUnits: 6 * elecDur, model: '/', note: '' },
    { name: 'PDU相序仪', count: 6, days: elecDur, totalUnits: 6 * elecDur, model: '/', note: '' },
    { name: '欧标转国标转接头', count: 10, days: elecDur, totalUnits: 10 * elecDur, model: '16A', note: 'PDU欧标' },
    { name: '欧标转国标转接头', count: 10, days: elecDur, totalUnits: 10 * elecDur, model: '10A', note: 'PDU欧标' },
    { name: '钳形电流表', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: 'FLUKE 381', note: '量程1500~2000A至少2台' },
    { name: '温湿度仪', count: 4, days: elecDur, totalUnits: 4 * elecDur, model: 'FLUKE 971', note: '' },
    { name: '万用表', count: 6, days: elecDur, totalUnits: 6 * elecDur, model: 'FLUKE 18B+', note: '' },
    { name: '振动仪', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: '/', note: '' },
    { name: '风速仪', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: '/', note: '' },
    { name: '噪声仪', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: '/', note: '' },
    { name: '电池内阻仪', count: 2, days: elecDur, totalUnits: 2 * elecDur, model: '福禄克/日置', note: '' },
    { name: 'HOBO', count: 3, days: elecDur, totalUnits: 3 * elecDur, model: '/', note: '机房最小需量，单通道3需布置3台' },
  ];

  const spare = 0.1;
  const fakeLoads = [
    { name: '风冷机架式假负载', count: Math.ceil(loads['6kW'].总需求 * (1 + spare)), days: elecDur, totalUnits: Math.ceil(loads['6kW'].总需求 * (1 + spare)) * elecDur, spare, spec: '6KW/台' },
    { name: '风冷机架式假负载', count: Math.ceil(loads['8kW'].总需求 * (1 + spare)), days: elecDur, totalUnits: Math.ceil(loads['8kW'].总需求 * (1 + spare)) * elecDur, spare, spec: '8KW/台' },
    { name: '风冷机架式假负载', count: Math.ceil(loads['500kW'].总需求 * (1 + spare)), days: dur, totalUnits: Math.ceil(loads['500kW'].总需求 * (1 + spare)) * dur, spare: 0, spec: '500KW/台（0~500kW可调）' },
    { name: '风冷机架式假负载', count: Math.ceil(loads['300kW'].总需求 * (1 + spare)), days: dur, totalUnits: Math.ceil(loads['300kW'].总需求 * (1 + spare)) * dur, spare: 0, spec: '300KW/台（0~300kW可调）' },
    { name: '风冷机架式假负载', count: 2, days: dur, totalUnits: 2 * dur, spare: 0, spec: '2000KW/台' },
  ];

  const cabs = input.total_cabinets;

  return {
    项目信息: { 总容量: `${input.total_mw}MW`, 工期: `${dur}天`, 单机柜功率: `${input.cabinet_power}kW`, 总机柜: `${cabs}个`, 空调: normAc(input.ac_type) },
    IT链路: it, 动力链路: pw, 暖通: hvac, 柴发: gen, 弱电: weak, 消防: fire, 固定人员: fixed,
    负载: loads, 汇总: { 峰值同时在场: peakStaff, 总人天: totalManDays },
    工具清单: tools, 假负载清单: fakeLoads, 劳务清单: { 总人天: totalManDays },
    机柜PDU清单: { 机柜: { count: cabs, days: dur, totalUnits: cabs * dur }, PDU: { count: cabs * 2, days: dur, totalUnits: cabs * 2 * dur } },
  };
}
