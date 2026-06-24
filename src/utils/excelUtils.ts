import * as XLSX from 'xlsx';
import { type ResourceInput, type ResourceReport, normalizeReport } from './resourceCalculator';

// ============ 模板列名（匹配 V20 CSV 格式） ============

const V20_TEMPLATE_HEADERS = [
  '序号',
  '单机柜压测功率(kW)',
  '机柜数量',
  'IT变压器总容量(MW)',
  'IT变压器组成',
  'IT变压器台数',
  'PUE',
  '动力变压器总容量(MW)',
  '动力变压器组成',
  '动力变压器台数',
  '总兆瓦数(MW)',
  '工期(天)',
  '空调类型',
];

const V20_TEMPLATE_ROWS = [
  ['示例1', 24, 307, '7.37', '3.15MW+3.15MW+1.25MW', 3, '1.421', '3.75', '2.5MW+1.25MW', 2, '10.47', 52, '液冷'],
  ['示例2', 12, 1530, '18.36', '3.15MW+3.15MW+3.15MW+3.15MW+3.15MW+3.15MW+2.5MW', 7, '1.283', '7.0', '2.5MW+2.5MW+2.0MW', 3, '23.56', 24, '传统风冷'],
  ['示例3', 18, 744, '13.39', '3.15MW+3.15MW+3.15MW+3.15MW+1.25MW', 5, '1.466', '6.25', '2.5MW+2.5MW+1.25MW', 3, '19.63', 57, '传统风冷'],
  ['示例4', 16, 1686, '26.98', '3.15MW+3.15MW+3.15MW+3.15MW+3.15MW+3.15MW+3.15MW+2.15MW+2.0MW+1.25MW', 10, '1.43', '11.8', '2.5MW+2.5MW+2.5MW+2.15MW+2.15MW', 5, '38.58', 28, '双冷源'],
];

// ============ 左对齐辅助 ============

function applyLeftAlign(ws: XLSX.WorkSheet, colCount: number, rowCount: number): void {
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && cell.t !== 's') {
        cell.s = {
          alignment: { horizontal: 'left', vertical: 'center' },
        };
      }
    }
  }
}

function aoaToSheet(data: (string | number)[][], colWidths?: number[]): { ws: XLSX.WorkSheet; rows: number; cols: number } {
  const ws = XLSX.utils.aoa_to_sheet(data);
  const rows = data.length;
  const cols = Math.max(...data.map(r => r.length), 0);
  if (colWidths) {
    ws['!cols'] = colWidths.map(w => ({ wch: w }));
  }
  applyLeftAlign(ws, cols, rows);
  return { ws, rows, cols };
}

/** 兼容旧版本报告：确保所有字段存在 */
function ensureReportFields(report: ResourceReport): ResourceReport {
  return {
    ...report,
    假负载清单: report.假负载清单 || [
      { name: '风冷机架式假负载', count: report.负载?.['6kW']?.总需求 || 0, days: 21, totalUnits: 0, spare: 0.29, spec: '6KW/台' },
      { name: '风冷机架式假负载', count: report.负载?.['8kW']?.总需求 || 0, days: 21, totalUnits: 0, spare: 0.29, spec: '8KW/台' },
      { name: '风冷机架式假负载', count: report.负载?.['500kW']?.总需求 || 0, days: 21, totalUnits: 0, spare: 0, spec: '500KW/台' },
      { name: '风冷机架式假负载', count: report.负载?.['300kW']?.总需求 || 0, days: 21, totalUnits: 0, spare: 0, spec: '300KW/台' },
      { name: '风冷机架式假负载', count: 2, days: 21, totalUnits: 42, spare: 0, spec: '2000KW/台' },
    ],
    工具清单: report.工具清单 || [],
    劳务清单: report.劳务清单 || { 总人天: report.汇总?.总人天 || 0 },
    机柜PDU清单: report.机柜PDU清单 || {
      机柜: { count: 0, days: 21, totalUnits: 0 },
      PDU: { count: 0, days: 21, totalUnits: 0 },
    },
  };
}

// ============ 导出汇总列头 ============

const SUMMARY_HEADERS = [
  '单机柜压测功率(kW)', '机柜数量', 'IT变压器总容量(MW)', 'IT变压器组成', 'IT变压器台数',
  'PUE', '动力变压器总容量(MW)', '动力变压器组成', '动力变压器台数',
  '总兆瓦数(MW)', '工期(天)', '空调类型',
  'IT并行数', 'IT实际测试工期', 'IT同时在场', 'IT总人天',
  '动力并行数', '动力实际测试工期', '动力同时在场', '动力总人天',
  '暖通总组数', '暖通峰值在场', '暖通总人天',
  '峰值同时在场', '总人天',
  '6kW总需求', '6kW自有', '6kW需租赁',
  '8kW总需求', '8kW自有', '8kW需租赁',
  '500kW总需求', '300kW总需求',
];

function expandTransformers(transformers: [number, number][]): string {
  const parts: string[] = [];
  for (const [cap, count] of transformers) {
    for (let i = 0; i < count; i++) parts.push(`${cap}MW`);
  }
  return parts.join('+');
}

function buildSummaryRow(input: ResourceInput, report: ResourceReport): (string | number)[] {
  const cabinetCount = input.total_cabinets || 0;
  // IT总容量 = 机柜数 × 单柜功率 / 1000（与 summary.csv 一致）
  const segs = input.cabinet_power_segments || [];
  const itLoadMW = segs.length > 0
    ? segs.reduce((s, seg) => s + seg.power * seg.count, 0) / 1000
    : (cabinetCount * (input.cabinet_power || 0)) / 1000;
  const pwCap = input.power_transformers.reduce((s, [c, n]) => s + c * n, 0);
  const itCount = input.it_transformers.reduce((s, [, n]) => s + n, 0);
  const pwCount = input.power_transformers.reduce((s, [, n]) => s + n, 0);
  const itComp = expandTransformers(input.it_transformers);
  const pwComp = expandTransformers(input.power_transformers);
  const pue = itLoadMW > 0 ? Math.round((input.total_mw / itLoadMW) * 1000) / 1000 : 0;

  return [
    input.cabinet_power || segs.map(s => s.power).join('/') || '-', cabinetCount, Math.round(itLoadMW * 100) / 100, itComp, itCount,
    pue, pwCap, pwComp, pwCount,
    input.total_mw, input.total_duration, input.ac_type,
    report.IT链路.并行数, report.IT链路.实际工期, report.IT链路.在场, report.IT链路.人天,
    report.动力链路.并行数, report.动力链路.实际工期, report.动力链路.在场, report.动力链路.人天,
    report.暖通.暖通总组数, report.暖通.峰值在场, report.暖通.总人天,
    report.汇总.峰值同时在场, report.汇总.总人天,
    report.负载['6kW'].总需求, report.负载['6kW'].自有, report.负载['6kW'].需租赁,
    report.负载['8kW'].总需求, report.负载['8kW'].自有, report.负载['8kW'].需租赁,
    report.负载['500kW'].总需求, report.负载['300kW'].总需求,
  ];
}

// ============ 单个报告导出 ============

export function exportReportToExcel(input: ResourceInput, report: ResourceReport): void {
  const r = ensureReportFields(report);
  const wb = XLSX.utils.book_new();
  const dur = input.total_duration;
  const itSpecStr = input.it_transformers.map(([c, n]) => `${c}MW×${n}台`).join(' + ');
  const pwSpecStr = input.power_transformers.map(([c, n]) => `${c}MW×${n}台`).join(' + ');

  // Sheet 1: 资源规划汇总
  {
    const summaryRow = buildSummaryRow(input, report);
    const { ws } = aoaToSheet([SUMMARY_HEADERS, summaryRow], SUMMARY_HEADERS.map(() => 16));
    XLSX.utils.book_append_sheet(wb, ws, '资源规划汇总');
  }

  // Sheet 2: 人员投入清单
  {
    const data = [
      ['序号', '岗位', '人数', '人天', '说明'],
      [1, '测试经理', 1, dur, '固定配置，全程在场'],
      [2, '电气主测', 1, dur, `IT变压器${r.IT链路.台数}台，并行${r.IT链路.并行数}组`],
      [3, '柴发主测', 1, dur, ''],
      [4, '暖通主测', 1, dur, `功能${r.暖通.功能测试.组数}组+场景${r.暖通.场景压测.组数}组`],
      [5, '消防主测', 1, dur, `消防测试员${r.消防.测试员}人`],
      [6, '弱电主测', 1, dur, `记录员${r.弱电.记录员小计 || (r.弱电 as any).记录员 || 0}人`],
      [7, '电气测试员', r.IT链路.在场 + r.动力链路.在场 + (r.混合链路?.在场 || 0), r.IT链路.人天 + r.动力链路.人天 + (r.混合链路?.人天 || 0), `IT${r.IT链路.在场}人+动力${r.动力链路.在场}人`],
      [8, '暖通测试员', r.暖通.峰值在场, r.暖通.总人天, `功能${r.暖通.功能测试.在场}/场景${r.暖通.场景压测.在场}/冷源${r.暖通.前端冷源.人数}/安装${r.暖通.安装检查.人数}`],
      [9, '弱电测试员', (r.弱电 as any).电气记录员 || (r.弱电 as any).记录员 || 0, ((r.弱电 as any).电气记录员 || (r.弱电 as any).记录员 || 0) * dur, `电气记录`],
      [10, '消防测试员', r.消防.测试员, r.消防.测试员 * dur, `${input.total_cabinets || 0}柜`],
      [11, '记录员', ((r.弱电 as any).暖通记录员 || 0) + r.柴发.记录员, (((r.弱电 as any).暖通记录员 || 0) + r.柴发.记录员) * dur, `暖通记录+柴发记录`],
      ['合计', '-', r.汇总.峰值同时在场, r.汇总.总人天, '-'],
    ];
    const { ws } = aoaToSheet(data, [6, 14, 8, 10, 50]);
    XLSX.utils.book_append_sheet(wb, ws, '人员投入清单');
  }

  // Sheet 3: 假负载清单（+29%余量，匹配 generate_excel.py）
  {
    const data = [
      ['名称', '数量', '天数', '总台天', '余量', '规格'],
      ...r.假负载清单.map(f => [f.name, f.count, f.days, f.totalUnits, `${(f.spare * 100).toFixed(0)}%`, f.spec]),
    ];
    const { ws } = aoaToSheet(data, [22, 8, 8, 10, 8, 44]);
    XLSX.utils.book_append_sheet(wb, ws, '假负载清单');
  }

  // Sheet 4: 工器具清单（匹配 generate_excel.py）
  {
    const data = [
      ['名称', '数量', '天数', '总台天', '型号', '备注/要求'],
      ...r.工具清单.map(t => [t.name, t.count, t.days, t.totalUnits, t.model, t.note]),
    ];
    const { ws } = aoaToSheet(data, [18, 6, 6, 8, 16, 50]);
    XLSX.utils.book_append_sheet(wb, ws, '工器具清单');
  }

  // Sheet 5: 职级配置
  if (r.职级配置) {
    const rk = r.职级配置;
    const data = [
      ['职级', '岗位', '人数'],
      ...Object.entries(rk['TO-3']).filter(([k]) => k !== '小计').map(([k, v]) => ['TO-3', k, v] as (string | number)[]),
      ...Object.entries(rk['TO-4']).filter(([k]) => k !== '小计').map(([k, v]) => ['TO-4', k, v] as (string | number)[]),
      ...Object.entries(rk['TO-6']).filter(([k]) => k !== '小计').map(([k, v]) => ['TO-6', k, v] as (string | number)[]),
      ['TO-3', '小计', rk['TO-3'].小计],
      ['TO-4', '小计', rk['TO-4'].小计],
      ['TO-6', '小计', rk['TO-6'].小计],
      ['', '公司属性', rk.公司属性 || ''],
    ];
    const { ws } = aoaToSheet(data, [10, 16, 8]);
    XLSX.utils.book_append_sheet(wb, ws, '职级配置');
  }

  // Sheet 6: PDU配置
  if (r.PDU配置) {
    const pd = r.PDU配置;
    const data = [
      ['项目', '内容'],
      ['机柜数量', `${pd.机柜数量}柜`],
      ['PDU数量', `${pd.PDU数量}条（每柜2条）`],
      ['PDU类型', pd.PDU类型],
      ['额定电流', pd.额定电流],
      ['线缆规格', pd.线缆规格],
      ['工业连接器', pd.工业连接器],
    ];
    const { ws } = aoaToSheet(data, [16, 30]);
    XLSX.utils.book_append_sheet(wb, ws, 'PDU配置');
  }

  // Sheet 7: 机柜PDU + 劳务
  {
    const data = [
      ['项目', '数量/值', '天数', '总台天', '备注'],
      ['机柜', r.机柜PDU清单.机柜.count, r.机柜PDU清单.机柜.days, r.机柜PDU清单.机柜.totalUnits, ''],
      ['PDU', r.机柜PDU清单.PDU.count, r.机柜PDU清单.PDU.days, r.机柜PDU清单.PDU.totalUnits, `${r.PDU配置?.PDU类型 || ''} ${r.PDU配置?.额定电流 || ''} ${r.PDU配置?.线缆规格 || ''} ${r.PDU配置?.工业连接器 || ''}`],
      ['', '', '', '', ''],
      ['劳务总人天', r.劳务清单.总人天, '', '', ''],
      ['参考项目', `${r.项目信息.总容量} ${r.项目信息.空调} 项目，工期${r.项目信息.工期}`, '', '', ''],
    ];
    const { ws } = aoaToSheet(data, [16, 14, 8, 10, 40]);
    XLSX.utils.book_append_sheet(wb, ws, '机柜PDU及劳务');
  }

  // Sheet 6: 详细计算数据
  {
    const detailData: (string | number)[][] = [
      ['=== 项目输入 ===', ''],
      ['总兆瓦数(MW)', input.total_mw],
      ['总工期(天)', input.total_duration],
      ['单机柜功率(kW)', input.cabinet_power || (input.cabinet_power_segments || []).map(s => `${s.power}kW×${s.count}`).join('+') || '-'],
      ['IT变压器配置', itSpecStr],
      ['动力变压器配置', pwSpecStr],
      ['总机柜数', input.total_cabinets || 0],
      ['空调类型', input.ac_type],
      ['项目类型', input.project_type || ''],
      ['认证证书名称', input.cert_name || ''],
      ['认证范围', input.cert_scope || ''],
      ['PDU类型', input.pdu_type || 'C19'],
      ['是否使用柴发负载', input.has_gen_load ? '是' : '否'],
      ['', ''],
      ['=== IT链路 ===', ''],
      ['台数', r.IT链路.台数],
      ['单台天数', r.IT链路.单台天数], ['并行数', r.IT链路.并行数],
      ['实际工期(天)', r.IT链路.实际工期], ['在场人数', r.IT链路.在场],
      ['人天', r.IT链路.人天],
      ['', ''],
      ['=== 动力链路 ===', ''],
      ['台数', r.动力链路.台数],
      ['单台天数', r.动力链路.单台天数], ['并行数', r.动力链路.并行数],
      ['实际工期(天)', r.动力链路.实际工期], ['在场人数', r.动力链路.在场],
      ['人天', r.动力链路.人天],
      ['', ''],
      ['=== 暖通 ===', ''],
      ['空调间数', r.暖通.空调间数], ['机房数', r.暖通.机房数],
      ['功能测试-组数', r.暖通.功能测试.组数], ['功能测试-每组人数', r.暖通.功能测试.每组人数],
      ['功能测试-在场', r.暖通.功能测试.在场], ['功能测试-人天', r.暖通.功能测试.人天],
      ['场景压测-组数', r.暖通.场景压测.组数], ['场景压测-每组人数', r.暖通.场景压测.每组人数],
      ['场景压测-在场', r.暖通.场景压测.在场], ['场景压测-人天', r.暖通.场景压测.人天],
      ['前端冷源-人数', r.暖通.前端冷源.人数], ['前端冷源-人天', r.暖通.前端冷源.人天],
      ['安装检查-人数', r.暖通.安装检查.人数], ['安装检查-人天', r.暖通.安装检查.人天],
      ['暖通总组数', r.暖通.暖通总组数], ['暖通峰值在场', r.暖通.峰值在场],
      ['暖通总人天', r.暖通.总人天],
      ['', ''],
      ['=== 弱电 ===', ''],
      ['主测', r.弱电.主测], ['电气记录员', r.弱电.电气记录员],
      ['暖通记录员', (r.弱电 as any).暖通记录员], ['记录员小计', r.弱电.记录员小计],
      ['弱电小计', r.弱电.小计],
      ['', ''],
      ['=== 消防 / 柴发 / 固定人员 ===', ''],
      ['消防-主测', r.消防.主测], ['消防-测试员', r.消防.测试员], ['消防小计', r.消防.小计],
      ['柴发-主测', r.柴发.主测], ['柴发-记录员', r.柴发.记录员], ['柴发小计', r.柴发.小计],
      ['固定人员小计', r.固定人员.小计],
      ['', ''],
      ['=== 汇总 ===', ''],
      ['峰值同时在场', r.汇总.峰值同时在场], ['总人天', r.汇总.总人天],
      ['', ''],
      ['=== 认证需求 ===', ''],
      ['证书名称', r.认证需求?.证书名称 || ''],
      ['认证范围', r.认证需求?.认证范围 || ''],
      ['', ''],
      ['=== 柴发负载 ===', ''],
      ['规格', r.柴发负载?.规格 || ''],
      ['数量', r.柴发负载?.数量 || 0],
      ['电缆', r.柴发负载?.电缆 || ''],
      ['', ''],
      ['=== 负载配置 ===', ''],
      ['IT负载配置-单机柜功率', String(r.负载.IT负载配置?.单机柜功率 || '')],
      ['IT负载配置-总台数', String(r.负载.IT负载配置?.IT变压器总台数 || '')],
      ['IT负载配置-每台1.1MW', String(r.负载.IT负载配置?.每台1_1MW配置 || '')],
    ];
    const { ws } = aoaToSheet(detailData, [28, 18]);
    XLSX.utils.book_append_sheet(wb, ws, '详细计算数据');
  }

  const filename = `资源规划报告_${input.total_mw}MW_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ============ 从 Excel 解析输入数据（V20 CSV 格式） ============

export interface ParsedInput {
  total_mw?: number;
  total_duration?: number;
  cabinet_power?: number;
  cabinet_power_segments?: { power: number; count: number }[];
  it_transformers?: [number, number][];
  power_transformers?: [number, number][];
  total_cabinets?: number;
  ac_type?: string;
  _row: number;
  _errors: string[];
}

/** 解析变压器组成字符串，如 "3.15MW+3.15MW+1.25MW" → [[3.15, 2], [1.25, 1]] */
function parseTransformerComposition(raw: string): [number, number][] {
  const parts = String(raw).split('+').map(s => s.trim()).filter(Boolean);
  const countMap = new Map<number, number>();
  for (const p of parts) {
    const mw = parseFloat(p.replace(/MW/i, '').trim());
    if (!isNaN(mw) && mw > 0) {
      countMap.set(mw, (countMap.get(mw) || 0) + 1);
    }
  }
  return Array.from(countMap.entries()).sort((a, b) => b[0] - a[0]);
}

/** 按列名查找值 */
function findColVal(row: Record<string, unknown>, names: string[]): string | undefined {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return undefined;
}

export function parseImportExcel(file: File): Promise<ParsedInput[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

        if (rows.length === 0) {
          reject(new Error('Excel文件中未找到数据'));
          return;
        }

        const results: ParsedInput[] = rows.map((row, idx) => {
          const parsed: ParsedInput = { _row: idx + 2, _errors: [] };

          // 单机柜压测功率(kW)
          const cp = findColVal(row, ['单机柜压测功率(kW)', '单机柜功率(kW)', 'cabinet_power']);
          if (cp) parsed.cabinet_power = parseInt(cp) || undefined;

          // 机柜数量
          const cc = findColVal(row, ['机柜数量', '总机柜数', 'total_cabinets']);
          if (cc) parsed.total_cabinets = parseInt(cc) || undefined;

          // IT变压器组成
          const itComp = findColVal(row, ['IT变压器组成']);
          if (itComp) {
            const parsed2 = parseTransformerComposition(itComp);
            if (parsed2.length > 0) parsed.it_transformers = parsed2;
          }

          // 动力变压器组成
          const pwComp = findColVal(row, ['动力变压器组成']);
          if (pwComp) {
            const parsed2 = parseTransformerComposition(pwComp);
            if (parsed2.length > 0) parsed.power_transformers = parsed2;
          }

          // 总兆瓦数(MW)
          const tmw = findColVal(row, ['总兆瓦数(MW)', '总MW', 'total_mw']);
          if (tmw) parsed.total_mw = parseFloat(tmw) || undefined;

          // 工期(天)
          const dur = findColVal(row, ['工期(天)', '总工期(天)', 'total_duration']);
          if (dur) parsed.total_duration = parseInt(dur) || undefined;

          // 空调类型
          const ac = findColVal(row, ['空调类型', 'ac_type']);
          if (ac) parsed.ac_type = ac;

          // 如果通过列名没匹配到，用位置回退（跳过序号列）
          const vals = Object.values(row).map(v => String(v).trim());
          // 跳过第一列（序号），列序：序号=0, 单机柜功率=1, 机柜数量=2, IT总容量=3, IT组成=4, IT台数=5, PUE=6, 动力总容量=7, 动力组成=8, 动力台数=9, 总MW=10, 工期=11, 空调=12
          if (parsed.cabinet_power === undefined && vals.length > 1 && !isNaN(Number(vals[1]))) parsed.cabinet_power = parseInt(vals[1]) || undefined;
          if (parsed.total_cabinets === undefined && vals.length > 2 && !isNaN(Number(vals[2]))) parsed.total_cabinets = parseInt(vals[2]) || undefined;
          if (parsed.it_transformers === undefined && vals.length > 4) {
            const itp = parseTransformerComposition(vals[4]);
            if (itp.length > 0) parsed.it_transformers = itp;
          }
          if (parsed.power_transformers === undefined && vals.length > 8) {
            const pwp = parseTransformerComposition(vals[8]);
            if (pwp.length > 0) parsed.power_transformers = pwp;
          }
          if (parsed.total_mw === undefined && vals.length > 10 && !isNaN(Number(vals[10]))) parsed.total_mw = parseFloat(vals[10]) || undefined;
          if (parsed.total_duration === undefined && vals.length > 11 && !isNaN(Number(vals[11]))) parsed.total_duration = parseInt(vals[11]) || undefined;
          if (parsed.ac_type === undefined && vals.length > 12) parsed.ac_type = vals[12] || undefined;

          // Validate
          if (parsed.total_mw === undefined || isNaN(parsed.total_mw)) parsed._errors.push('总兆瓦数(MW)缺失或无效');
          if (parsed.total_duration === undefined || isNaN(parsed.total_duration)) parsed._errors.push('工期(天)缺失或无效');
          if (parsed.cabinet_power === undefined || isNaN(parsed.cabinet_power)) parsed._errors.push('单机柜压测功率(kW)缺失或无效');
          if (parsed.total_cabinets === undefined || isNaN(parsed.total_cabinets)) parsed._errors.push('机柜数量缺失或无效');
          if (!parsed.it_transformers || parsed.it_transformers.length === 0) parsed._errors.push('IT变压器组成缺失或无法解析');
          if (!parsed.power_transformers || parsed.power_transformers.length === 0) parsed._errors.push('动力变压器组成缺失或无法解析');
          if (!parsed.ac_type) parsed._errors.push('空调类型缺失');

          return parsed;
        });

        resolve(results);
      } catch (err) {
        reject(new Error(`Excel文件解析失败: ${err}`));
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

export interface BatchReportRow {
  index: number;
  input?: ResourceInput;
  report?: ResourceReport;
  error?: string;
}

export async function runBatchCalculation(inputs: ParsedInput[]): Promise<BatchReportRow[]> {
  // 构建合法 input 列表
  const validInputs: ResourceInput[] = [];
  const errors: BatchReportRow[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const item = inputs[i];
    if (item._errors.length > 0) {
      errors.push({ index: i + 1, error: item._errors.join('; ') });
      continue;
    }
    validInputs.push({
      total_mw: item.total_mw!,
      total_duration: item.total_duration!,
      cabinet_power: item.cabinet_power!,
      it_transformers: item.it_transformers!,
      power_transformers: item.power_transformers!,
      total_cabinets: item.total_cabinets!,
      ac_type: item.ac_type || '传统风冷',
    });
  }

  if (validInputs.length === 0) return errors;

  const batchId = Date.now().toString();

  // 调用后端群算 API（失败则回退本地计算）
  try {
    const res = await fetch('/api/resource-calc/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: validInputs, batch_id: batchId }),
    });
    if (res.ok) {
      const json = await res.json() as { success: boolean; data: (Record<string, unknown>)[] };
      const normalized: BatchReportRow[] = json.data.map((item: Record<string, unknown>) => {
        if (item.error) return { index: Number(item.index), error: String(item.error) };
        const idx = Number(item.index);
        const input = validInputs[idx - 1] || validInputs[0];
        const report = normalizeReport(item, input);
        return { index: idx, input, report };
      });
      return [...normalized, ...errors];
    }
  } catch {}

  // 回退：本地计算（不存库）
  const { calculateResource } = await import('./resourceCalculator');
  const localResults = validInputs.map((input, idx) => {
    try {
      const report = calculateResource(input);
      return { index: idx + 1, input, report };
    } catch (e) {
      return { index: idx + 1, input, error: String(e) };
    }
  });
  return [...localResults, ...errors];
}

export function exportBatchResultsToExcel(batchResults: BatchReportRow[]): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: 群算汇总
  {
    const data = [
      SUMMARY_HEADERS,
      ...batchResults.map((r) => {
        if (r.error) {
          return [r.index, 'ERROR', '', '', '', '', '', '', r.error, ...Array(SUMMARY_HEADERS.length - 9).fill('')];
        }
        return buildSummaryRow(r.input!, r.report!);
      }),
    ];
    const { ws } = aoaToSheet(data, SUMMARY_HEADERS.map(() => 16));
    XLSX.utils.book_append_sheet(wb, ws, '群算汇总');
  }

  // Individual detail sheets
  for (const r of batchResults) {
    if (r.error) continue;
    const inp = r.input!;
    const rep = ensureReportFields(r.report!);
    const dur = inp.total_duration;
    const itSpecStr = inp.it_transformers.map(([c, n]) => `${c}MW×${n}台`).join('+');
    const pwSpecStr = inp.power_transformers.map(([c, n]) => `${c}MW×${n}台`).join('+');

    const data = [
      ['=== 项目输入 ===', ''],
      ['总兆瓦数', `${inp.total_mw} MW`], ['总工期', `${dur} 天`],
      ['单机柜功率', `${inp.cabinet_power} kW`], ['IT变压器', itSpecStr],
      ['动力变压器', pwSpecStr], ['总机柜数', `${inp.total_cabinets} 个`],
      ['空调类型', inp.ac_type],
      ['', ''],
      ['=== 人员投入清单 ===', '', '', ''],
      ['序号', '岗位', '人数', '人天'],
      [1, '测试经理', 1, dur], [2, '电气主测', 1, dur],
      [3, '柴发主测', 1, dur], [4, '暖通主测', 1, dur],
      [5, '消防主测', 1, dur], [6, '弱电主测', 1, dur],
      [7, '电气测试员', rep.IT链路.在场 + rep.动力链路.在场 + (rep.混合链路?.在场 || 0), rep.IT链路.人天 + rep.动力链路.人天 + (rep.混合链路?.人天 || 0)],
      [8, '暖通测试员', rep.暖通.峰值在场, rep.暖通.总人天],
      [9, '弱电测试员', (rep.弱电 as any).电气记录员 || (rep.弱电 as any).记录员 || 0, ((rep.弱电 as any).电气记录员 || (rep.弱电 as any).记录员 || 0) * dur],
      [10, '消防测试员', rep.消防.测试员, rep.消防.测试员 * dur],
      [11, '记录员', ((rep.弱电 as any).暖通记录员 || 0) + rep.柴发.记录员, (((rep.弱电 as any).暖通记录员 || 0) + rep.柴发.记录员) * dur],
      ['合计', '-', rep.汇总.峰值同时在场, rep.汇总.总人天],
      ['', ''],
      ['=== IT链路详情 ===', ''], ['台数', rep.IT链路.台数], ['每台人数', rep.IT链路.每台人数],
      ['单台天数', rep.IT链路.单台天数], ['并行数', rep.IT链路.并行数],
      ['实际工期', `${rep.IT链路.实际工期}天`], ['在场人数', rep.IT链路.在场],
      ['人天', rep.IT链路.人天],
      ['', ''],
      ['=== 动力链路详情 ===', ''], ['台数', rep.动力链路.台数], ['每台人数', rep.动力链路.每台人数],
      ['单台天数', rep.动力链路.单台天数], ['并行数', rep.动力链路.并行数],
      ['实际工期', `${rep.动力链路.实际工期}天`], ['在场人数', rep.动力链路.在场],
      ['人天', rep.动力链路.人天],
      ['', ''],
      ['=== 暖通详情 ===', ''], ['空调间数', rep.暖通.空调间数], ['机房数', rep.暖通.机房数],
      ['功能测试', `${rep.暖通.功能测试.组数}组×${rep.暖通.功能测试.每组人数}人,在场${rep.暖通.功能测试.在场}人,${rep.暖通.功能测试.人天}人天`],
      ['场景压测', `${rep.暖通.场景压测.组数}组×${rep.暖通.场景压测.每组人数}人,在场${rep.暖通.场景压测.在场}人,${rep.暖通.场景压测.人天}人天`],
      ['前端冷源', `${rep.暖通.前端冷源.人数}人,${rep.暖通.前端冷源.人天}人天`],
      ['安装检查', `${rep.暖通.安装检查.人数}人,${rep.暖通.安装检查.人天}人天`],
      ['暖通总组数', rep.暖通.暖通总组数], ['峰值在场', rep.暖通.峰值在场],
      ['总人天', rep.暖通.总人天],
      ['', ''],
      ['=== 假负载清单（+29%余量） ===', '', '', '', ''],
      ['名称', '数量', '天数', '总台天', '规格'],
      ...rep.假负载清单.map(f => [f.name, f.count, f.days, f.totalUnits, f.spec]),
      ['', '', '', '', ''],
      ['=== 工器具清单 ===', '', '', '', ''],
      ['名称', '数量', '天数', '总台天', '型号'],
      ...rep.工具清单.map(t => [t.name, t.count, t.days, t.totalUnits, t.model]),
      ['', '', '', '', ''],
      ['=== 机柜PDU及劳务 ===', '', '', '', ''],
      ['项目', '数量', '天数', '总台天'],
      ['机柜', rep.机柜PDU清单.机柜.count, rep.机柜PDU清单.机柜.days, rep.机柜PDU清单.机柜.totalUnits],
      ['PDU', rep.机柜PDU清单.PDU.count, rep.机柜PDU清单.PDU.days, rep.机柜PDU清单.PDU.totalUnits],
      ['劳务总人天', rep.劳务清单.总人天, '', ''],
      ['参考项目', `${rep.项目信息.总容量} ${rep.项目信息.空调}，工期${rep.项目信息.工期}`, '', ''],
    ];
    const { ws } = aoaToSheet(data, [18, 14, 10, 10]);
    const sheetName = `#${r.index}-${inp.total_mw}MW`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
  }

  const filename = `批量资源规划报告_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

/** 下载导入模板（匹配 V20 CSV 格式） */
export function downloadBatchTemplate(): void {
  const { ws } = aoaToSheet(
    [V20_TEMPLATE_HEADERS, ...V20_TEMPLATE_ROWS],
    [6, 18, 10, 20, 44, 14, 8, 20, 44, 14, 16, 10, 12],
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '批量导入模板');
  XLSX.writeFile(wb, '资源计算_批量导入模板.xlsx');
}
