/**
 * generate_excel.py 的 TypeScript 移植
 * 根据资源规划结果生成 Excel 报表数据
 *
 * 对应原始: datacenter-test-resource-plan2/scripts/generate_excel.py
 */

import type { ResourceReport, ResourceInput } from './resource_plan.js';

/** Sheet 1: 人员投入清单 */
export function buildStaffSheet(report: ResourceReport, input: ResourceInput) {
  const dur = input.total_duration;
  const it = report.IT链路;
  const pw = report.动力链路;
  const hvac = report.暖通;
  const elecOnSite = it.同时在场人数 + pw.同时在场人数;
  const elecDur = Math.max(it.实际测试工期, pw.实际测试工期);

  return [
    ['序号', '岗位', '人数', '人天', '说明'],
    [1, '测试经理', 1, dur, '固定配置，全程在场'],
    [2, '电气主测', 1, dur, `IT变压器${it.总台数}台，并行${it.所需并行数}组`],
    [3, '柴发主测', report.柴发.主测, dur, ''],
    [4, '暖通主测', 1, dur, `功能${hvac.功能测试.组数}组+场景${hvac.场景压测.组数}组`],
    [5, '消防主测', report.消防.主测, dur, ''],
    [6, '弱电主测', report.弱电.主测, dur, ''],
    [7, '电气测试员', elecOnSite, elecDur, `IT${it.同时在场人数}+动力${pw.同时在场人数}`],
    [8, '暖通测试员', hvac.峰值同时在场, dur, `功能${hvac.功能测试.同时在场}/场景${hvac.场景压测.同时在场}/冷源${hvac.前端冷源.人数}/安装${hvac.安装检查.人数}`],
    [9, '弱电记录员', report.弱电.记录员小计, dur, `电气${report.弱电.电气记录员}+暖通${report.弱电.暖通记录员}`],
    [10, '消防测试员', report.消防.测试员, dur, `${input.total_cabinets}柜，每850柜增1人`],
    [11, '记录员', report.柴发.记录员 + report.弱电.暖通记录员, dur, '柴发+暖通'],
    ['合计', '-', report.汇总.峰值同时在场, report.汇总.总人天, '-'],
  ];
}

/** Sheet 2: 工器具清单 */
export function buildToolSheet(report: ResourceReport, input: ResourceInput) {
  const tools = report.工具清单 || [];
  return [
    ['名称', '数量', '天数', '总台天', '型号', '备注/要求'],
    ...tools.map(t => [t.name, t.count, t.days, t.totalUnits, t.model, t.note]),
  ];
}

/** Sheet 3: 假负载清单（+10%余量） */
export function buildFakeLoadSheet(report: ResourceReport) {
  const loads = report.假负载清单 || [];
  return [
    ['名称', '数量', '天数', '总台天', '余量', '规格'],
    ...loads.map(f => [f.name, f.count, f.days, f.totalUnits, `${(f.spare * 100).toFixed(0)}%`, f.spec]),
  ];
}

/** Sheet 4: 机柜PDU + 劳务 */
export function buildCabinetSheet(report: ResourceReport, input: ResourceInput) {
  return [
    ['项目', '数量', '天数', '总台天'],
    ['机柜', report.机柜PDU清单.机柜.count, report.机柜PDU清单.机柜.days, report.机柜PDU清单.机柜.totalUnits],
    ['PDU', report.机柜PDU清单.PDU.count, report.机柜PDU清单.PDU.days, report.机柜PDU清单.PDU.totalUnits],
    ['', '', '', ''],
    ['劳务总人天', report.劳务清单.总人天, ''],
    ['参考项目', `${report.项目信息.总容量} ${report.项目信息.空调} 项目，工期${report.项目信息.工期}`],
  ];
}

/** 完整报表数据 */
export function buildReportData(report: ResourceReport, input: ResourceInput) {
  return {
    staff: buildStaffSheet(report, input),
    tools: buildToolSheet(report, input),
    fakeLoads: buildFakeLoadSheet(report),
    cabinet: buildCabinetSheet(report, input),
  };
}
