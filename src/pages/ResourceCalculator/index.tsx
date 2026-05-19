import { useState, useRef } from 'react';
import {
  Form, InputNumber, Select, Button, Card, Descriptions, Table,
  Row, Col, Statistic, Space, message, Typography, Modal, Alert, Tooltip, Tabs, Collapse,
  Popconfirm,
} from 'antd';
import {
  CalculatorOutlined, TeamOutlined, ToolOutlined,
  ExportOutlined, ImportOutlined, DownloadOutlined, UploadOutlined,
  FileExcelOutlined, CloseCircleOutlined, CheckCircleOutlined,
  CaretRightOutlined, TableOutlined, InfoCircleOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { calculateResource, type ResourceInput, type ResourceReport } from '../../utils/resourceCalculator';
import {
  exportReportToExcel, parseImportExcel, runBatchCalculation,
  exportBatchResultsToExcel, downloadBatchTemplate,
  type ParsedInput, type BatchReportRow,
} from '../../utils/excelUtils';
import { apiCalcResource, apiGetHistory, apiDeleteHistory } from '../../api';

const { Title, Text, Paragraph } = Typography;

const CABINET_POWER_OPTIONS = [
  { label: '12 kW', value: 12 }, { label: '16 kW', value: 16 },
  { label: '18 kW', value: 18 }, { label: '20 kW', value: 20 },
  { label: '22 kW', value: 22 }, { label: '24 kW', value: 24 },
  { label: '26 kW', value: 26 },
];

const AC_TYPE_OPTIONS = [
  { label: '传统风冷', value: '传统风冷' }, { label: '液冷', value: '液冷' },
  { label: '双冷源', value: '双冷源' }, { label: '水冷', value: '水冷' },
];

const TRANSFORMER_SPECS = [1.25, 2.0, 2.15, 2.5, 3.15];

const defaultFormValues = {
  total_mw: 21.6, total_duration: 21, cabinet_power: 12,
  it_transSpecs: [2.0], it_transCount: 6,
  pw_transSpecs: [1.25], pw_transCount: 6,
  total_cabinets: 1150, ac_type: '液冷',
};

/** 汇总表所有列 — 与 summary.csv 格式一致 */
const SUMMARY_HEADERS = [
  '单机柜压测功率(kW)', '机柜数量', 'IT变压器总容量(MW)', 'IT变压器组成', 'IT变压器台数',
  'PUE', '动力变压器总容量(MW)', '动力变压器组成', '动力变压器台数',
  '总兆瓦数(MW)', '工期(天)', '空调类型',
  'IT并行数', 'IT测试工期', 'IT在场', 'IT人天',
  '动力并行数', '动力测试工期', '动力在场', '动力人天',
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
  const itCap = input.it_transformers.reduce((s, [c, n]) => s + c * n, 0);
  const pwCap = input.power_transformers.reduce((s, [c, n]) => s + c * n, 0);
  const itCount = input.it_transformers.reduce((s, [, n]) => s + n, 0);
  const pwCount = input.power_transformers.reduce((s, [, n]) => s + n, 0);
  const pue = itCap > 0 ? Math.round((input.total_mw / itCap) * 1000) / 1000 : 0;

  return [
    input.cabinet_power, input.total_cabinets, itCap, expandTransformers(input.it_transformers), itCount,
    pue, pwCap, expandTransformers(input.power_transformers), pwCount,
    input.total_mw, input.total_duration, input.ac_type,
    report.IT链路.所需并行数, report.IT链路.实际测试工期, report.IT链路.同时在场人数, report.IT链路.总人天,
    report.动力链路.所需并行数, report.动力链路.实际测试工期, report.动力链路.同时在场人数, report.动力链路.总人天,
    report.暖通.暖通总组数, report.暖通.峰值同时在场, report.暖通.总人天,
    report.汇总.峰值同时在场, report.汇总.总人天,
    report.负载['6kW'].总需求, report.负载['6kW'].自有, report.负载['6kW'].需租赁,
    report.负载['8kW'].总需求, report.负载['8kW'].自有, report.负载['8kW'].需租赁,
    report.负载['500kW'].总需求, report.负载['300kW'].总需求,
  ];
}

function ResourceCalculator() {
  const [form] = Form.useForm();
  const [report, setReport] = useState<ResourceReport | null>(null);
  const [currentInput, setCurrentInput] = useState<ResourceInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [formCollapsed, setFormCollapsed] = useState(false);

  // Import states
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<'single' | 'batch' | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importedData, setImportedData] = useState<ParsedInput[]>([]);
  const [importError, setImportError] = useState('');
  const [batchResults, setBatchResults] = useState<BatchReportRow[]>([]);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [historyData, setHistoryData] = useState<{ id: number; total_mw: number; total_duration: number; cabinet_power: number; it_transformers: string; power_transformers: string; total_cabinets: number; peak_staff: number; total_man_days: number; ac_type: string; created_at: string; result_json?: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await apiGetHistory(1, 50);
      setHistoryData(res.data);
    } catch { message.warning('后端不可用，无法加载历史'); }
    finally { setHistoryLoading(false); }
  };

  const parseItTrans = (s: string): [number, number][] => {
    try { const v = JSON.parse(s); if (Array.isArray(v)) return v; } catch {}
    return [[2, 6]];
  };

  const handleHistoryClick = (item: typeof historyData[0]) => {
    if (!item.result_json) { message.warning('该记录缺少完整结果数据，请重新计算'); return; }
    try {
      const r = JSON.parse(item.result_json);
      setReport(r as ResourceReport);
      setCurrentInput({
        total_mw: item.total_mw, total_duration: item.total_duration,
        cabinet_power: item.cabinet_power || 12,
        it_transformers: parseItTrans(item.it_transformers),
        power_transformers: parseItTrans(item.power_transformers || '[[1.25,6]]'),
        total_cabinets: item.total_cabinets || 1150, ac_type: item.ac_type,
      });
      setFormCollapsed(true);
      message.success('已加载历史记录');
    } catch { message.error('记录解析失败'); }
  };

  const handleHistoryDownload = (item: typeof historyData[0]) => {
    if (!item.result_json) { message.warning('该记录缺少完整结果数据，请重新计算'); return; }
    try {
      const report = JSON.parse(item.result_json) as ResourceReport;
      const input: ResourceInput = {
        total_mw: item.total_mw, total_duration: item.total_duration,
        cabinet_power: item.cabinet_power || 12,
        it_transformers: parseItTrans(item.it_transformers),
        power_transformers: parseItTrans(item.power_transformers || '[[1.25,6]]'),
        total_cabinets: item.total_cabinets || 1150, ac_type: item.ac_type,
      };
      exportReportToExcel(input, report);
      message.success('已下载');
    } catch { message.error('导出失败'); }
  };


  // ============ 计算 ============

  const buildInput = (): ResourceInput | null => {
    const values = form.getFieldsValue();
    const itTrans: [number, number][] = (values.it_transSpecs || []).map(
      (spec: number) => [spec, values.it_transCount || 1]
    );
    const pwTrans: [number, number][] = (values.pw_transSpecs || []).map(
      (spec: number) => [spec, values.pw_transCount || 1]
    );
    if (itTrans.length === 0 || pwTrans.length === 0) { message.warning('请选择变压器规格'); return null; }
    if (!values.total_mw || !values.total_duration || !values.total_cabinets) { message.warning('请填写必填字段'); return null; }
    return {
      total_mw: values.total_mw, total_duration: values.total_duration,
      cabinet_power: values.cabinet_power, it_transformers: itTrans,
      power_transformers: pwTrans, total_cabinets: values.total_cabinets,
      ac_type: values.ac_type,
    };
  };

  const handleCalculate = async () => {
    setLoading(true);
    try {
      const input = buildInput();
      if (!input) { setLoading(false); return; }

      // 调用后端 API（失败时回退本地计算）
      try {
        const res = await apiCalcResource(input);
        setReport(res.data as unknown as ResourceReport);
        setCurrentInput(input);
      } catch {
        // 后端不可用时回退本地计算
        setReport(calculateResource(input));
        setCurrentInput(input);
      }
      setFormCollapsed(true);
      message.success('计算完成（已保存至数据库）');
    } catch { message.error('计算失败'); }
    finally { setLoading(false); }
  };

  // ============ 导入 ============

  const openImportModal = () => {
    setImportMode('single'); setImportFile(null); setImportedData([]);
    setImportError(''); setImportModalOpen(true);
  };

  const handleFileSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file); setImportError('');
    try {
      const data = await parseImportExcel(file);
      setImportedData(data);
      if (data.length === 0) setImportError('未解析到有效数据');
    } catch (err) { setImportError(String(err)); setImportedData([]); }
  };

  const handleConfirmImport = () => {
    if (importedData.length === 0) { message.warning('没有可导入的数据'); return; }

    if (importMode === 'single') {
      const item = importedData[0];
      if (item._errors.length > 0) { message.error(`数据校验失败：${item._errors.join('; ')}`); return; }
      const itSpecs = item.it_transformers?.map(([c]) => c) || [];
      const itTotal = item.it_transformers?.reduce((s, [, n]) => s + n, 0) || 0;
      const pwSpecs = item.power_transformers?.map(([c]) => c) || [];
      const pwTotal = item.power_transformers?.reduce((s, [, n]) => s + n, 0) || 0;
      form.setFieldsValue({
        total_mw: item.total_mw, total_duration: item.total_duration,
        cabinet_power: item.cabinet_power,
        it_transSpecs: itSpecs.length > 0 ? itSpecs : undefined,
        it_transCount: itTotal || undefined,
        pw_transSpecs: pwSpecs.length > 0 ? pwSpecs : undefined,
        pw_transCount: pwTotal || undefined,
        total_cabinets: item.total_cabinets, ac_type: item.ac_type,
      });
      message.success('参数导入成功，请确认后点击计算');
    } else {
      const results = runBatchCalculation(importedData);
      setBatchResults(results); setBatchModalOpen(true);
      const errors = results.filter(r => r.error);
      message[errors.length > 0 ? 'warning' : 'success'](
        `${results.length} 条，${errors.length > 0 ? errors.length + ' 条失败' : '全部成功'}`
      );
    }
    setImportModalOpen(false);
  };

  // ============ 构建报告数据 ============

  if (!report || !currentInput) {
    // ====== 无报告时：输入表单 + 占位 ======
    return (
      <div>
        <div className="page-header">
          <div>
            <Title level={3} style={{ margin: 0 }}><CalculatorOutlined style={{ marginRight: 8 }} />资源计算器</Title>
            <Text type="secondary">数据中心测试交付前期投入资源规划</Text>
          </div>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={downloadBatchTemplate}>下载模板</Button>
            <Button icon={<ImportOutlined />} onClick={openImportModal}>导入Excel</Button>
          </Space>
        </div>
        <Row gutter={24}>
          <Col xs={24} lg={10}>
            <InputForm form={form} loading={loading} onCalculate={handleCalculate} />
          </Col>
          <Col xs={24} lg={14}>
            <Card style={{ marginBottom: 24 }}>
              <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>
                <CalculatorOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                <Paragraph>填写7项参数，点击"开始计算"生成资源规划报告</Paragraph>
                <Space>
                  <Button icon={<ImportOutlined />} onClick={openImportModal}>从Excel导入</Button>
                  <Button icon={<DownloadOutlined />} onClick={downloadBatchTemplate}>下载导入模板</Button>
                </Space>
              </div>
            </Card>
          </Col>
        </Row>
        <ImportModal
          open={importModalOpen} importMode={importMode} setImportMode={setImportMode}
          importedData={importedData} importFile={importFile} importError={importError}
          fileInputRef={fileInputRef} onFileSelected={handleFileSelected}
          onCancel={() => setImportModalOpen(false)} onConfirm={handleConfirmImport}
        />

      </div>
    );
  }

  // ====== 有报告时：可折叠表单 + 完整报告 ======
  const dur = currentInput.total_duration;
  const summaryRow = buildSummaryRow(currentInput, report);

  // 汇总表列定义
  const summaryColumns = SUMMARY_HEADERS.map((h, i) => ({
    title: h, dataIndex: `c${i}`, key: `c${i}`, width: h.length > 6 ? 120 : 90,
    render: (v: string | number) => typeof v === 'number' ? (Number.isInteger(v) ? v : v) : v,
  }));
  const summaryData = [{ ...summaryRow.reduce((acc, v, i) => ({ ...acc, [`c${i}`]: v, key: '1' }), {} as Record<string, unknown>) }];

  // 人员投入表格
  const staffColumns = [
    { title: '序号', dataIndex: 'key', width: 50 },
    { title: '岗位', dataIndex: 'role', width: 120 },
    { title: '人数', dataIndex: 'count', width: 80 },
    { title: '人天', dataIndex: 'manDays', width: 100 },
    { title: '说明', dataIndex: 'note' },
  ];
  const staffData = [
    { key: 1, role: '测试经理', count: 1, manDays: dur, note: '固定配置，全程在场' },
    { key: 2, role: '电气主测', count: 1, manDays: dur, note: `IT变压器${report.IT链路.总台数}台，并行${report.IT链路.所需并行数}组` },
    { key: 3, role: '电气测试员', count: report.IT链路.同时在场人数, manDays: report.IT链路.总人天, note: `每台${report.IT链路.单台人数}人×并行${report.IT链路.所需并行数}组，工期${report.IT链路.实际测试工期}天` },
    { key: 4, role: '动力测试员', count: report.动力链路.同时在场人数, manDays: report.动力链路.总人天, note: `动力变${report.动力链路.总台数}台，并行${report.动力链路.所需并行数}组，工期${report.动力链路.实际测试工期}天` },
    { key: 5, role: '暖通主测', count: 1, manDays: dur, note: `功能${report.暖通.功能测试.组数}组+场景${report.暖通.场景压测.组数}组` },
    { key: 6, role: '暖通测试员', count: report.暖通.峰值同时在场, manDays: report.暖通.总人天, note: `功能${report.暖通.功能测试.同时在场}/场景${report.暖通.场景压测.同时在场}/冷源${report.暖通.前端冷源.人数}/安装${report.暖通.安装检查.人数}` },
    { key: 7, role: '弱电主测', count: 1, manDays: dur, note: '' },
    { key: 8, role: '弱电记录员', count: report.弱电.记录员小计, manDays: report.弱电.记录员小计 * dur, note: `电气记录${report.弱电.电气记录员}+暖通记录${report.弱电.暖通记录员}` },
    { key: 9, role: '消防主测', count: 1, manDays: dur, note: '' },
    { key: 10, role: '消防测试员', count: report.消防.测试员, manDays: report.消防.测试员 * dur, note: `${currentInput.total_cabinets}柜，每850柜+1人，上限5人` },
    { key: 11, role: '柴发主测', count: 1, manDays: dur, note: '' },
    { key: 12, role: '柴发记录员', count: 1, manDays: dur, note: '' },
    { key: 13, role: '资料员', count: 1, manDays: dur, note: '文档管理/数据整理' },
    { key: 'sum', role: <Text strong>合计</Text>, count: <Text strong>{report.汇总.峰值同时在场}</Text>, manDays: <Text strong>{report.汇总.总人天}</Text>, note: '-' },
  ];

  // 假负载表格（含10%余量）
  const fakeLoadColumns = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '数量', dataIndex: 'count', width: 70 },
    { title: '天数', dataIndex: 'days', width: 70 },
    { title: '总台天', dataIndex: 'totalUnits', width: 90 },
    { title: '规格', dataIndex: 'spec', width: 300 },
  ];
  const fakeLoadTableData = report.假负载清单.map((f, i) => ({
    key: i, name: f.name, count: f.count, days: f.days, totalUnits: f.totalUnits, spec: f.spec,
  }));

  // 工器具表格
  const toolColumns = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '数量', dataIndex: 'count', width: 60 },
    { title: '天数', dataIndex: 'days', width: 60 },
    { title: '总台天', dataIndex: 'totalUnits', width: 80 },
    { title: '型号', dataIndex: 'model', width: 140 },
    { title: '备注/要求', dataIndex: 'note' },
  ];
  const toolTableData = report.工具清单.map((t, i) => ({ ...t, key: i }));

  // 机柜PDU表格
  const cpdColumns = [
    { title: '项目', dataIndex: 'item', width: 80 },
    { title: '数量', dataIndex: 'count', width: 80 },
    { title: '天数', dataIndex: 'days', width: 80 },
    { title: '总台天', dataIndex: 'totalUnits', width: 100 },
  ];
  const cpdData = [
    { key: 'cab', item: '机柜', count: report.机柜PDU清单.机柜.count, days: report.机柜PDU清单.机柜.days, totalUnits: report.机柜PDU清单.机柜.totalUnits },
    { key: 'pdu', item: 'PDU', count: report.机柜PDU清单.PDU.count, days: report.机柜PDU清单.PDU.days, totalUnits: report.机柜PDU清单.PDU.totalUnits },
  ];

  // 详细计算数据
  const detailSections = [
    { title: '项目输入', rows: [
      ['总兆瓦数(MW)', currentInput.total_mw],
      ['总工期(天)', currentInput.total_duration],
      ['单机柜压测功率(kW)', currentInput.cabinet_power],
      ['IT变压器配置', currentInput.it_transformers.map(([c, n]) => `${c}MW×${n}台`).join(' + ')],
      ['动力变压器配置', currentInput.power_transformers.map(([c, n]) => `${c}MW×${n}台`).join(' + ')],
      ['总机柜数', currentInput.total_cabinets],
      ['空调类型', currentInput.ac_type],
    ]},
    { title: 'IT链路', rows: [
      ['架构', report.IT链路.架构 || '标准架构'], ['单台人数', report.IT链路.单台人数],
      ['总台数', report.IT链路.总台数], ['单台天数', report.IT链路.单台天数],
      ['所需并行数', report.IT链路.所需并行数], ['实际测试工期(天)', report.IT链路.实际测试工期],
      ['同时在场人数', report.IT链路.同时在场人数], ['总人天', report.IT链路.总人天],
    ]},
    { title: '动力链路', rows: [
      ['单台人数', report.动力链路.单台人数], ['总台数', report.动力链路.总台数],
      ['单台天数', report.动力链路.单台天数], ['所需并行数', report.动力链路.所需并行数],
      ['实际测试工期(天)', report.动力链路.实际测试工期], ['同时在场人数', report.动力链路.同时在场人数],
      ['总人天', report.动力链路.总人天],
    ]},
    { title: '暖通', rows: [
      ['空调间数', report.暖通.空调间数], ['机房数', report.暖通.机房数],
      ['功能测试', `${report.暖通.功能测试.组数}组×${report.暖通.功能测试.每组人数}人，在场${report.暖通.功能测试.同时在场}人，${report.暖通.功能测试.人天}人天`],
      ['场景压测', `${report.暖通.场景压测.组数}组×${report.暖通.场景压测.每组人数}人，在场${report.暖通.场景压测.同时在场}人，${report.暖通.场景压测.人天}人天`],
      ['前端冷源', `${report.暖通.前端冷源.人数}人，${report.暖通.前端冷源.人天}人天`],
      ['安装检查', `${report.暖通.安装检查.人数}人，${report.暖通.安装检查.人天}人天`],
      ['暖通总组数', report.暖通.暖通总组数], ['峰值同时在场', report.暖通.峰值同时在场],
      ['总人天', report.暖通.总人天],
    ]},
    { title: '弱电 / 消防 / 柴发 / 固定', rows: [
      ['弱电主测', report.弱电.主测], ['弱电电气记录员', report.弱电.电气记录员],
      ['弱电暖通记录员', report.弱电.暖通记录员], ['弱电记录员小计', report.弱电.记录员小计],
      ['弱电小计', report.弱电.小计],
      ['消防主测', report.消防.主测], ['消防测试员', report.消防.测试员], ['消防小计', report.消防.小计],
      ['柴发主测', report.柴发.主测], ['柴发记录员', report.柴发.记录员], ['柴发小计', report.柴发.小计],
      ['固定人员小计', report.固定人员.小计],
    ]},
    { title: '汇总', rows: [
      ['峰值同时在场', `${report.汇总.峰值同时在场} 人`],
      ['总人天', `${report.汇总.总人天} 人·天`],
    ]},
  ];

  const tabItems = [
    {
      key: 'summary', label: <><TableOutlined /> 汇总表</>,
      children: (
        <div>
          <Row gutter={24} style={{ marginBottom: 16 }}>
            <Col span={6}><Statistic title="总容量" value={currentInput.total_mw} suffix="MW" /></Col>
            <Col span={6}><Statistic title="总工期" value={currentInput.total_duration} suffix="天" /></Col>
            <Col span={6}><Statistic title="峰值同时在场" value={report.汇总.峰值同时在场} suffix="人" valueStyle={{ color: '#1677ff' }} /></Col>
            <Col span={6}><Statistic title="总人天" value={report.汇总.总人天} suffix="人·天" valueStyle={{ color: '#52c41a' }} /></Col>
          </Row>
          <Table
            columns={summaryColumns} dataSource={summaryData}
            pagination={false} size="small" bordered scroll={{ x: 1800 }}
            style={{ marginBottom: 16 }}
          />
        </div>
      ),
    },
    {
      key: 'staff', label: <><TeamOutlined /> 人员清单</>,
      children: (
        <Table columns={staffColumns} dataSource={staffData}
          pagination={false} size="small" bordered />
      ),
    },
    {
      key: 'load', label: <><ToolOutlined /> 假负载清单</>,
      children: (
        <Table columns={fakeLoadColumns} dataSource={fakeLoadTableData}
          pagination={false} size="small" bordered />
      ),
    },
    {
      key: 'tools', label: <><ToolOutlined /> 工器具清单</>,
      children: (
        <Table columns={toolColumns} dataSource={toolTableData}
          pagination={false} size="small" bordered scroll={{ x: 700 }} />
      ),
    },
    {
      key: 'cabinet', label: <>机柜PDU</>,
      children: (
        <div>
          <Table columns={cpdColumns} dataSource={cpdData}
            pagination={false} size="small" bordered style={{ marginBottom: 16 }} />
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="劳务总人天">{report.劳务清单.总人天} 人·天</Descriptions.Item>
            <Descriptions.Item label="参考项目">{report.项目信息.总容量} {report.项目信息.空调} 项目，工期{report.项目信息.工期}</Descriptions.Item>
          </Descriptions>
        </div>
      ),
    },
    {
      key: 'history', label: <>历史记录</>,
      children: (
        <div>
          <Space style={{ marginBottom: 12 }}>
            <Button icon={<HistoryOutlined />} onClick={loadHistory} loading={historyLoading}>加载历史</Button>
            <Text type="secondary">{historyData.length > 0 ? `共 ${historyData.length} 条` : '点击加载从数据库获取'}</Text>
          </Space>
          {historyData.length > 0 && (
            <Table dataSource={historyData.map(h => ({ ...h, key: h.id }))}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 50 },
                { title: '总MW', dataIndex: 'total_mw', width: 70 },
                { title: '工期', dataIndex: 'total_duration', width: 60 },
                { title: '峰值', dataIndex: 'peak_staff', width: 60 },
                { title: '人天', dataIndex: 'total_man_days', width: 70 },
                { title: '空调', dataIndex: 'ac_type', width: 80 },
                { title: '时间', dataIndex: 'created_at', width: 150 },
                { title: '操作', key: 'action', width: 200,
                  render: (_: unknown, r: typeof historyData[0]) => (
                    <Space>
                      <Button size="small" type="link" onClick={() => handleHistoryClick(r)}>加载</Button>
                      <Button size="small" type="link" icon={<ExportOutlined />} onClick={() => handleHistoryDownload(r)}>下载</Button>
                      <Popconfirm title="确认删除？" onConfirm={async () => {
                        await apiDeleteHistory(r.id);
                        setHistoryData(prev => prev.filter(h => h.id !== r.id));
                        message.success('已删除');
                      }}><Button size="small" type="link" danger>删除</Button></Popconfirm>
                    </Space>
                  ),
                },
              ]}
              size="small" bordered pagination={{ pageSize: 15 }}
            />
          )}
        </div>
      ),
    },
    {
      key: 'detail', label: <><InfoCircleOutlined /> 详细数据</>,
      children: (
        <Collapse
          items={detailSections.map((sec, i) => ({
            key: String(i),
            label: sec.title,
            children: (
              <Descriptions column={2} size="small" bordered>
                {sec.rows.map(([label, val], j) => (
                  <Descriptions.Item key={j} label={String(label)}>{val}</Descriptions.Item>
                ))}
              </Descriptions>
            ),
          }))}
          defaultActiveKey={['0', '1', '2', '5']}
        />
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <Title level={3} style={{ margin: 0 }}><CalculatorOutlined style={{ marginRight: 8 }} />资源计算器</Title>
          <Text type="secondary">数据中心测试交付前期投入资源规划</Text>
        </div>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={downloadBatchTemplate}>下载模板</Button>
          <Button icon={<ImportOutlined />} onClick={openImportModal}>导入Excel</Button>
          <Button type="primary" icon={<ExportOutlined />} onClick={() => exportReportToExcel(currentInput, report)}>
            导出Excel
          </Button>
        </Space>
      </div>

      <Collapse
        activeKey={formCollapsed ? [] : ['form']}
        onChange={(keys) => setFormCollapsed(keys.length === 0)}
        items={[{
          key: 'form',
          label: <><CaretRightOutlined /> 输入参数（点击展开修改）</>,
          children: <InputForm form={form} loading={loading} onCalculate={handleCalculate} />,
        }]}
        style={{ marginBottom: 24 }}
        ghost={false}
      />

      <Tabs items={tabItems} defaultActiveKey="summary" size="large" />

      <ImportModal
        open={importModalOpen} importMode={importMode} setImportMode={setImportMode}
        importedData={importedData} importFile={importFile} importError={importError}
        fileInputRef={fileInputRef} onFileSelected={handleFileSelected}
        onCancel={() => setImportModalOpen(false)} onConfirm={handleConfirmImport}
      />

      <Modal
        title={`批量计算结果（共 ${batchResults.length} 条）`}
        open={batchModalOpen} onCancel={() => setBatchModalOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setBatchModalOpen(false)}>关闭</Button>
            <Button type="primary" icon={<ExportOutlined />}
              onClick={() => exportBatchResultsToExcel(batchResults)}>导出群算结果</Button>
          </Space>
        }
        width={1100}
      >
        <Table
          dataSource={batchResults.map(r => ({ ...r, key: r.index }))}
          columns={[
            { title: '序号', dataIndex: 'index', width: 60 },
            { title: '状态', dataIndex: 'error', width: 70,
              render: (e?: string) => e
                ? <Tooltip title={e}><CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 18 }} /></Tooltip>
                : <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} /> },
            { title: '总MW', dataIndex: '', width: 80, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input.total_mw },
            { title: '工期', dataIndex: '', width: 60, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input.total_duration },
            { title: '单柜kW', dataIndex: '', width: 70, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input.cabinet_power },
            { title: '机柜', dataIndex: '', width: 60, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input.total_cabinets },
            { title: 'IT配置', dataIndex: '', width: 160, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input.it_transformers.map(([c, n]) => `${c}MW×${n}`).join('+') },
            { title: '动力配置', dataIndex: '', width: 160, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input.power_transformers.map(([c, n]) => `${c}MW×${n}`).join('+') },
            { title: '峰值在场', dataIndex: '', width: 80, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : `${r.report.汇总.峰值同时在场}人` },
            { title: '总人天', dataIndex: '', width: 80, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.report.汇总.总人天 },
          ]}
          pagination={{ pageSize: 20, showSizeChanger: true }} size="small" bordered scroll={{ x: 900 }}
          summary={() => {
            const valid = batchResults.filter(r => !r.error);
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={6}>
                  <Text strong>有效 {valid.length}/{batchResults.length} 条</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6}>
                  <Text strong>{valid.reduce((s, r) => s + r.report.汇总.峰值同时在场, 0)} 人</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7}>
                  <Text strong>{valid.reduce((s, r) => s + r.report.汇总.总人天, 0)} 人·天</Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      </Modal>
    </div>
  );
}

/** 输入表单子组件 */
function InputForm({ form, loading, onCalculate }: {
  form: ReturnType<typeof Form.useForm>[0];
  loading: boolean;
  onCalculate: () => void;
}) {
  return (
    <Form form={form} layout="vertical" initialValues={defaultFormValues}>
      <Form.Item name="total_mw" label="① 总兆瓦数 (MW)" rules={[{ required: true, message: '请输入' }]}>
        <InputNumber style={{ width: '100%' }} min={10} max={66} step={0.1} placeholder="10 ~ 66 MW" />
      </Form.Item>
      <Form.Item name="total_duration" label="② 总工期 (天)" rules={[{ required: true, message: '请输入' }]}>
        <InputNumber style={{ width: '100%' }} min={1} max={365} placeholder="15 ~ 60 天" />
      </Form.Item>
      <Form.Item name="cabinet_power" label="③ 单机柜压测功率" rules={[{ required: true, message: '请选择' }]}>
        <Select options={CABINET_POWER_OPTIONS} />
      </Form.Item>
      <Form.Item label="④ IT变压器配置" required>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Form.Item name="it_transSpecs" noStyle rules={[{ required: true }]}>
            <Select mode="multiple" placeholder="选择规格" style={{ width: '100%' }}
              options={TRANSFORMER_SPECS.map(s => ({ label: `${s} MW`, value: s }))} />
          </Form.Item>
          <Form.Item name="it_transCount" noStyle>
            <InputNumber style={{ width: '100%' }} min={1} placeholder="台数" addonBefore="台数" />
          </Form.Item>
        </Space>
      </Form.Item>
      <Form.Item label="⑤ 动力变压器配置" required>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Form.Item name="pw_transSpecs" noStyle rules={[{ required: true }]}>
            <Select mode="multiple" placeholder="选择规格（不含3.15MW）" style={{ width: '100%' }}
              options={TRANSFORMER_SPECS.filter(s => s !== 3.15).map(s => ({ label: `${s} MW`, value: s }))} />
          </Form.Item>
          <Form.Item name="pw_transCount" noStyle>
            <InputNumber style={{ width: '100%' }} min={1} placeholder="台数" addonBefore="台数" />
          </Form.Item>
        </Space>
      </Form.Item>
      <Form.Item name="total_cabinets" label="⑥ 总机柜数" rules={[{ required: true, message: '请输入' }]}>
        <InputNumber style={{ width: '100%' }} min={1} placeholder="机柜总数" />
      </Form.Item>
      <Form.Item name="ac_type" label="⑦ 空调类型" rules={[{ required: true, message: '请选择' }]}>
        <Select options={AC_TYPE_OPTIONS} />
      </Form.Item>
      <Button type="primary" size="large" block icon={<CalculatorOutlined />}
        onClick={onCalculate} loading={loading}>
        开始计算
      </Button>
    </Form>
  );
}

/** 导入弹窗子组件 */
function ImportModal({ open, importMode, setImportMode, importedData, importFile, importError,
  fileInputRef, onFileSelected, onCancel, onConfirm }: {
  open: boolean; importMode: 'single' | 'batch' | null;
  setImportMode: (m: 'single' | 'batch') => void;
  importedData: ParsedInput[]; importFile: File | null; importError: string;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileSelected: React.ChangeEventHandler<HTMLInputElement>;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Modal title="从 Excel 导入数据" open={open} onCancel={onCancel} onOk={onConfirm}
      okText={importMode === 'single' ? '导入第一行' : '开始群算'} cancelText="取消" width={700}>
      <div style={{ marginBottom: 16 }}><Text strong>选择导入模式：</Text></div>
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card size="small" hoverable onClick={() => setImportMode('single')}
            style={{ border: importMode === 'single' ? '2px solid #1677ff' : '1px solid #d9d9d9', background: importMode === 'single' ? '#e6f4ff' : '#fff' }}>
            <Title level={5} style={{ marginTop: 0 }}><UploadOutlined style={{ marginRight: 6 }} />单个导入</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>取Excel第一行填入表单，确认后手动计算。</Text>
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" hoverable onClick={() => setImportMode('batch')}
            style={{ border: importMode === 'batch' ? '2px solid #1677ff' : '1px solid #d9d9d9', background: importMode === 'batch' ? '#e6f4ff' : '#fff' }}>
            <Title level={5} style={{ marginTop: 0 }}><FileExcelOutlined style={{ marginRight: 6 }} />群算（批量）</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>解析所有行批量计算，汇总展示并导出。</Text>
          </Card>
        </Col>
      </Row>
      <Space style={{ marginBottom: 12 }}><Text strong>选择文件：</Text>
        <Button icon={<DownloadOutlined />} size="small" onClick={downloadBatchTemplate}>下载模板</Button>
      </Space>
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv"
        style={{ display: 'block', marginBottom: 8 }} onChange={onFileSelected} />
      {importFile && !importError && (
        <Alert type="success" message={`已加载：${importFile.name}，解析到 ${importedData.length} 条`} style={{ marginBottom: 12 }} />
      )}
      {importError && <Alert type="error" message={importError} style={{ marginBottom: 12 }} />}
      {importedData.length > 0 && (
        <Table size="small"
          dataSource={importedData.slice(0, 5).map((d, i) => ({ ...d, key: i }))}
          columns={[
            { title: '#', dataIndex: '_row', width: 50 },
            { title: '总MW', dataIndex: 'total_mw', width: 70 },
            { title: '工期', dataIndex: 'total_duration', width: 55 },
            { title: '单柜kW', dataIndex: 'cabinet_power', width: 65 },
            { title: '机柜数', dataIndex: 'total_cabinets', width: 65 },
            { title: 'IT组成', dataIndex: '', width: 180, render: (_: unknown, r: ParsedInput) => r.it_transformers?.map(([c, n]) => `${c}MW×${n}`).join('+') || '-' },
            { title: '动力组成', dataIndex: '', width: 180, render: (_: unknown, r: ParsedInput) => r.power_transformers?.map(([c, n]) => `${c}MW×${n}`).join('+') || '-' },
            { title: '空调', dataIndex: 'ac_type', width: 65 },
            { title: '校验', dataIndex: '_errors', width: 60,
              render: (e: string[]) => e.length > 0
                ? <Tooltip title={e.join('; ')}><CloseCircleOutlined style={{ color: '#ff4d4f' }} /></Tooltip>
                : <CheckCircleOutlined style={{ color: '#52c41a' }} /> },
          ]}
          pagination={false} scroll={{ x: 800 }}
          caption={importedData.length > 5 ? `仅显示前5条，共${importedData.length}条` : undefined}
        />
      )}
    </Modal>
  );
}

export default ResourceCalculator;
