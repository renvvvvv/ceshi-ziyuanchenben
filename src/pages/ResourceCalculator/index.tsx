import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Form, InputNumber, Select, Button, Card, Table, Row, Col, Statistic, Space, message,
  Typography, Modal, Alert, Tooltip, Tabs, Collapse, Descriptions, Popconfirm, Tag,
} from 'antd';
import {
  CalculatorOutlined, TeamOutlined, ToolOutlined,
  ExportOutlined, ImportOutlined, DownloadOutlined, UploadOutlined,
  FileExcelOutlined, CloseCircleOutlined, CheckCircleOutlined,
  HistoryOutlined, InfoCircleOutlined, PlusOutlined,
} from '@ant-design/icons';
import { calculateResource, type ResourceInput, type ResourceReport } from '../../utils/resourceCalculator';
import {
  exportReportToExcel, parseImportExcel, runBatchCalculation,
  exportBatchResultsToExcel, downloadBatchTemplate,
  type ParsedInput, type BatchReportRow,
} from '../../utils/excelUtils';
import { apiCalcResource, apiGetHistory, apiDeleteHistory, type HistoryItem } from '../../api';
import BatchResultsView from '../../components/BatchResultsView';

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

type PageMode = 'home' | 'single' | 'batch';

function ResourceCalculator() {
  const [form] = Form.useForm();
  const [mode, setMode] = useState<PageMode>('home');

  // 单算
  const [report, setReport] = useState<ResourceReport | null>(null);
  const [currentInput, setCurrentInput] = useState<ResourceInput | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [singleModalOpen, setSingleModalOpen] = useState(false);

  // 群算
  const [batchResults, setBatchResults] = useState<BatchReportRow[]>([]);

  // 导入
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<'single' | 'batch' | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importedData, setImportedData] = useState<ParsedInput[]>([]);
  const [importError, setImportError] = useState('');
  const [selectedRow, setSelectedRow] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 历史
  const [historyRaw, setHistoryRaw] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'single' | 'batch'>('all');
  const [filterDate, setFilterDate] = useState(''); // YYYY-MM-DD 前缀匹配

  // 初始加载历史
  useEffect(() => { loadHistory(); }, []);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await apiGetHistory(1, 500);
      setHistoryRaw(res.data);
    } catch { message.warning('后端不可用，无法加载历史'); }
    finally { setHistoryLoading(false); }
  };

  // 分组：batch_id 非空 → 群算批次；null → 单算
  const historyGroups = useMemo(() => {
    const singles: HistoryItem[] = [];
    const batches = new Map<string, HistoryItem[]>();
    for (const h of historyRaw) {
      if (h.batch_id) {
        if (!batches.has(h.batch_id)) batches.set(h.batch_id, []);
        batches.get(h.batch_id)!.push(h);
      } else {
        singles.push(h);
      }
    }
    return { singles, batches: Array.from(batches.entries()) };
  }, [historyRaw]);

  const historyTableData = useMemo(() => {
    const rows: { key: string; type: 'single' | 'batch'; batchId?: string; item?: HistoryItem; items?: HistoryItem[]; count?: number; time?: string }[] = [];
    // 群算批次
    if (filterType === 'all' || filterType === 'batch') {
      for (const [batchId, items] of historyGroups.batches) {
        const time = items[0]?.created_at || '';
        if (filterDate && !time.startsWith(filterDate)) continue;
        rows.push({ key: `b-${batchId}`, type: 'batch', batchId, items, count: items.length, time });
      }
    }
    // 单算
    if (filterType === 'all' || filterType === 'single') {
      for (const h of historyGroups.singles) {
        if (filterDate && !h.created_at.startsWith(filterDate)) continue;
        rows.push({ key: `s-${h.id}`, type: 'single', item: h, time: h.created_at });
      }
    }
    rows.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    return rows;
  }, [historyGroups, filterType, filterDate]);

  const parseItTrans = (s: string): [number, number][] => {
    try { const v = JSON.parse(s); if (Array.isArray(v)) return v; } catch {}
    return [[2, 6]];
  };

  const handleHistoryLoad = (item: HistoryItem) => {
    if (!item.result_json) { message.warning('该记录缺少完整数据'); return; }
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
      setMode('single'); setSingleModalOpen(false);
      message.success('已加载历史记录');
    } catch { message.error('记录解析失败'); }
  };

  const handleHistoryDownload = (item: HistoryItem) => {
    if (!item.result_json) { message.warning('该记录缺少完整数据'); return; }
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

  const handleBatchHistoryLoad = (items: HistoryItem[]) => {
    const rows: BatchReportRow[] = items.map((h, i) => {
      if (!h.result_json) return { index: i + 1, input: {} as ResourceInput, report: {} as ResourceReport, error: '缺数据' };
      try {
        const report = JSON.parse(h.result_json) as ResourceReport;
        const input: ResourceInput = {
          total_mw: h.total_mw, total_duration: h.total_duration,
          cabinet_power: h.cabinet_power || 12,
          it_transformers: parseItTrans(h.it_transformers),
          power_transformers: parseItTrans(h.power_transformers || '[[1.25,6]]'),
          total_cabinets: h.total_cabinets || 1150, ac_type: h.ac_type,
        };
        return { index: i + 1, input, report };
      } catch { return { index: i + 1, input: {} as ResourceInput, report: {} as ResourceReport, error: '解析失败' }; }
    });
    setBatchResults(rows);
    setMode('batch');
  };

  // ============ 单算 ============
  const buildInput = (): ResourceInput | null => {
    const values = form.getFieldsValue();
    const itTrans: [number, number][] = (values.it_transSpecs || []).map((s: number) => [s, values.it_transCount || 1]);
    const pwTrans: [number, number][] = (values.pw_transSpecs || []).map((s: number) => [s, values.pw_transCount || 1]);
    if (itTrans.length === 0 || pwTrans.length === 0) { message.warning('请选择变压器规格'); return null; }
    if (!values.total_mw || !values.total_duration || !values.total_cabinets) { message.warning('请填写必填字段'); return null; }
    return {
      total_mw: values.total_mw, total_duration: values.total_duration,
      cabinet_power: values.cabinet_power, it_transformers: itTrans,
      power_transformers: pwTrans, total_cabinets: values.total_cabinets,
      ac_type: values.ac_type,
    };
  };

  const handleSingleCalc = async () => {
    setCalcLoading(true);
    try {
      const input = buildInput();
      if (!input) { setCalcLoading(false); return; }
      try {
        const res = await apiCalcResource(input);
        setReport(res.data as unknown as ResourceReport);
      } catch {
        setReport(calculateResource(input));
      }
      setCurrentInput(input);
      setSingleModalOpen(false);
      message.success('计算完成');
    } catch { message.error('计算失败'); }
    finally { setCalcLoading(false); }
  };

  // ============ 导入 ============
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

  const handleConfirmImport = async () => {
    if (importedData.length === 0) { message.warning('没有可导入的数据'); return; }
    setImportModalOpen(false);

    if (importMode === 'single') {
      const item = importedData[selectedRow] || importedData[0];
      if (!item) { message.warning('未选中数据行'); return; }
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
      setSingleModalOpen(true);
      message.success('参数已导入表单，请确认后计算');
    } else {
      const results = await runBatchCalculation(importedData);
      setBatchResults(results);
      setMode('batch');
      const errors = results.filter(r => r.error);
      message[errors.length > 0 ? 'warning' : 'success'](`${results.length} 条，${errors.length > 0 ? errors.length + ' 条失败' : '全部成功'}`);
    }
  };

  // ============ 回到首页 ============
  const goHome = () => {
    setMode('home'); setReport(null); setCurrentInput(null);
    setBatchResults([]); setSingleModalOpen(false);
    loadHistory();
  };

  // ============ 群算结果页 ============
  if (mode === 'batch' && batchResults.length > 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <Title level={3} style={{ margin: 0 }}><CalculatorOutlined style={{ marginRight: 8 }} />群算结果</Title>
          </div>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={downloadBatchTemplate}>下载模板</Button>
            <Button type="primary" icon={<ExportOutlined />} onClick={() => exportBatchResultsToExcel(batchResults)}>导出全部</Button>
            <Button onClick={goHome}>← 返回首页</Button>
          </Space>
        </div>
        <BatchResultsView batchResults={batchResults} onClose={goHome} />
      </div>
    );
  }

  // ============ 单算结果页 ============
  if (mode === 'single' && report && currentInput) {
    return <SingleResultView
      report={report} input={currentInput}
      onExport={() => exportReportToExcel(currentInput!, report)}
      onBack={goHome}
    />;
  }

  // ============ 首页 ============
  return (
    <div>
      <div className="page-header">
        <div>
          <Title level={3} style={{ margin: 0 }}><CalculatorOutlined style={{ marginRight: 8 }} />资源计算器</Title>
          <Text type="secondary">数据中心测试交付前期投入资源规划</Text>
        </div>
      </div>

      {/* 操作按钮栏 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <Button size="large" type="primary" icon={<CalculatorOutlined />}
          onClick={() => { form.resetFields(); setSingleModalOpen(true); }}>
          单算
        </Button>
        <Button size="large" icon={<FileExcelOutlined />}
          onClick={() => { setImportMode('batch'); setImportFile(null); setImportedData([]); setImportError(''); setImportModalOpen(true); }}>
          群算
        </Button>
        <span style={{ color: '#999', fontSize: 13, lineHeight: '40px', marginLeft: 8 }}>
          单算：手动填写参数 | 群算：导入 Excel 批量计算
        </span>
      </div>

      {/* 历史记录 */}
      <Card title={<><HistoryOutlined /> 历史记录</>}
        extra={
          <Space>
            <Select value={filterType} onChange={setFilterType} size="small" style={{ width: 90 }}
              options={[{ value: 'all', label: '全部' }, { value: 'single', label: '单算' }, { value: 'batch', label: '群算' }]} />
            <input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              style={{ padding: '2px 8px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 13, width: 130 }}
            />
            {filterDate && <Button size="small" onClick={() => setFilterDate('')}>清除日期</Button>}
            <Button size="small" icon={<DownloadOutlined />} onClick={loadHistory} loading={historyLoading}>刷新</Button>
            <Text type="secondary">{historyTableData.length > 0 ? `共 ${historyTableData.length} 条` : ''}</Text>
          </Space>
        }
      >
        {historyTableData.length === 0 && !historyLoading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            <HistoryOutlined style={{ fontSize: 36, marginBottom: 12 }} />
            <Paragraph>暂无历史记录。点击上方"单算"或"群算"开始。</Paragraph>
          </div>
        ) : (
          <Table dataSource={historyTableData}
            loading={historyLoading} size="small" bordered
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }}
            expandable={{
              expandedRowRender: (r: typeof historyTableData[0]) => {
                if (r.type !== 'batch' || !r.items) return null;
                return (
                  <div style={{ padding: '8px 0' }}>
                    <Table size="small" bordered pagination={false}
                      dataSource={r.items.map((h: HistoryItem) => ({ ...h, key: h.id }))}
                      columns={[
                        { title: '#', width: 40, render: (_: unknown, _2: unknown, i: number) => i + 1 },
                        { title: '总MW', dataIndex: 'total_mw', width: 70 },
                        { title: '工期', dataIndex: 'total_duration', width: 55 },
                        { title: '峰值', dataIndex: 'peak_staff', width: 55, render: (v: number) => `${v}人` },
                        { title: '人天', dataIndex: 'total_man_days', width: 65 },
                        { title: '空调', dataIndex: 'ac_type', width: 80, render: (v: string) => <Tag>{v}</Tag> },
                        { title: '操作', width: 120,
                          render: (_: unknown, h: HistoryItem) => (
                            <Space>
                              <Button size="small" type="link"
                                onClick={() => handleHistoryLoad(h)}>查看</Button>
                              <Button size="small" type="link"
                                onClick={() => handleHistoryDownload(h)}>下载</Button>
                            </Space>
                          ),
                        },
                      ]}
                    />
                    <div style={{ marginTop: 8 }}>
                      <Button size="small" type="primary" onClick={() => handleBatchHistoryLoad(r.items!)}
                        icon={<FileExcelOutlined />}>查看整批结果</Button>
                    </div>
                  </div>
                );
              },
              rowExpandable: (r: typeof historyTableData[0]) => r.type === 'batch',
            }}
            columns={[
              { title: '类型', dataIndex: 'type', width: 60, render: (t: string) => <Tag color={t === 'batch' ? 'blue' : 'default'}>{t === 'batch' ? '群算' : '单算'}</Tag> },
              {
                title: '概要', key: 'summary', render: (_: unknown, r: typeof historyTableData[0]) => {
                  if (r.type === 'batch' && r.items) {
                    const mws = r.items.map((i: HistoryItem) => i.total_mw);
                    return <Text>{r.count}项, {Math.min(...mws)}~{Math.max(...mws)}MW, 累计{r.items.reduce((s: number, i: HistoryItem) => s + i.peak_staff, 0)}人</Text>;
                  }
                  return <Text>{r.item!.total_mw}MW, {r.item!.total_duration}天, <Tag>{r.item!.ac_type}</Tag></Text>;
                },
              },
              { title: '峰值', key: 'peak', width: 70, render: (_: unknown, r: typeof historyTableData[0]) => r.type === 'batch' ? `${r.items!.reduce((s: number, i: HistoryItem) => s + i.peak_staff, 0)}人` : `${r.item!.peak_staff}人` },
              { title: '人天', key: 'md', width: 75, render: (_: unknown, r: typeof historyTableData[0]) => r.type === 'batch' ? r.items!.reduce((s: number, i: HistoryItem) => s + i.total_man_days, 0) : r.item!.total_man_days },
              { title: '时间', dataIndex: 'time', width: 155 },
              {
                title: '操作', key: 'action', width: 180,
                render: (_: unknown, r: typeof historyTableData[0]) => {
                  if (r.type === 'batch') {
                    return (
                      <Space>
                        <Button size="small" type="link" onClick={() => handleBatchHistoryLoad(r.items!)}>查看</Button>
                        <Popconfirm title="删除整批？" onConfirm={async () => {
                          for (const h of r.items!) await apiDeleteHistory(h.id);
                          loadHistory(); message.success('已删除');
                        }}><Button size="small" type="link" danger>删除</Button></Popconfirm>
                      </Space>
                    );
                  }
                  return (
                    <Space>
                      <Button size="small" type="link" onClick={() => handleHistoryLoad(r.item!)}>加载</Button>
                      <Button size="small" type="link" icon={<ExportOutlined />} onClick={() => handleHistoryDownload(r.item!)}>下载</Button>
                      <Popconfirm title="确认删除？" onConfirm={async () => {
                        await apiDeleteHistory(r.item!.id);
                        loadHistory(); message.success('已删除');
                      }}><Button size="small" type="link" danger>删除</Button></Popconfirm>
                    </Space>
                  );
                },
              },
            ]}
          />
        )}
      </Card>

      {/* 单算弹窗 */}
      <Modal title="单算" open={singleModalOpen} onCancel={() => setSingleModalOpen(false)}
        footer={[
          <Button key="back" onClick={() => setSingleModalOpen(false)}>取消</Button>,
          <Button key="import" icon={<ImportOutlined />} onClick={() => { setSingleModalOpen(false); setImportMode('single'); setImportFile(null); setImportedData([]); setImportError(''); setImportModalOpen(true); }}>从Excel导入</Button>,
          <Button key="calc" type="primary" icon={<CalculatorOutlined />} loading={calcLoading} onClick={handleSingleCalc}>开始计算</Button>,
        ]}
        width={560}
      >
        <Form form={form} layout="vertical" initialValues={{
          total_mw: 21.6, total_duration: 21, cabinet_power: 12,
          it_transSpecs: [2.0], it_transCount: 6,
          pw_transSpecs: [1.25], pw_transCount: 6,
          total_cabinets: 1150, ac_type: '液冷',
        }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="total_mw" label="总兆瓦数 (MW)" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={10} max={66} step={0.1} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="total_duration" label="总工期 (天)" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={1} max={365} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="cabinet_power" label="单机柜功率" rules={[{ required: true }]}>
                <Select options={CABINET_POWER_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="total_cabinets" label="总机柜数" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={1} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="IT变压器规格" required>
                <Form.Item name="it_transSpecs" noStyle rules={[{ required: true }]}>
                  <Select mode="multiple" placeholder="规格" options={TRANSFORMER_SPECS.map(s => ({ label: `${s} MW`, value: s }))} />
                </Form.Item>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="IT变压器台数">
                <Form.Item name="it_transCount" noStyle>
                  <InputNumber style={{ width: '100%' }} min={1} placeholder="台数" />
                </Form.Item>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="动力变压器规格" required>
                <Form.Item name="pw_transSpecs" noStyle rules={[{ required: true }]}>
                  <Select mode="multiple" placeholder="规格" options={TRANSFORMER_SPECS.filter(s => s !== 3.15).map(s => ({ label: `${s} MW`, value: s }))} />
                </Form.Item>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="动力变压器台数">
                <Form.Item name="pw_transCount" noStyle>
                  <InputNumber style={{ width: '100%' }} min={1} placeholder="台数" />
                </Form.Item>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="ac_type" label="空调类型" rules={[{ required: true }]}>
            <Select options={AC_TYPE_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 导入弹窗 */}
      <Modal title="导入 Excel" open={importModalOpen} onCancel={() => setImportModalOpen(false)} onOk={handleConfirmImport}
        okText={importMode === 'single' ? '导入选中行' : '开始群算'} cancelText="取消" width={750}>
        <div style={{ marginBottom: 12 }}><Text strong>模式：{importMode === 'single' ? '单算导入（选择一行填入表单）' : '群算（批量计算存库）'}</Text></div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <Button icon={<DownloadOutlined />} onClick={downloadBatchTemplate}>下载模板</Button>
          <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>选择文件</Button>
          {importFile && <Text style={{ fontSize: 13 }}>{importFile.name}</Text>}
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }} onChange={handleFileSelected} />
        {importFile && !importError && (
          <Alert type="success" message={`已加载：${importFile.name}，解析到 ${importedData.length} 条`} style={{ marginBottom: 12 }} />
        )}
        {importError && <Alert type="error" message={importError} style={{ marginBottom: 12 }} />}
        {importMode === 'single' && importedData.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Text>选择要导入的行：</Text>
            <Select value={selectedRow} onChange={setSelectedRow} style={{ width: 200, marginLeft: 8 }}
              options={importedData.slice(0, 50).map((d, i) => ({
                value: i,
                label: `第${d._row}行 - ${d.total_mw || '?'}MW / ${d.ac_type || '?'}`,
              }))} />
          </div>
        )}
        {importMode === 'batch' && importedData.length > 0 && (
          <Table size="small"
            dataSource={importedData.slice(0, 5).map((d, i) => ({ ...d, key: i }))}
            columns={[
              { title: '#', dataIndex: '_row', width: 50 },
              { title: '总MW', dataIndex: 'total_mw', width: 70 },
              { title: '工期', dataIndex: 'total_duration', width: 55 },
              { title: '单柜kW', dataIndex: 'cabinet_power', width: 65 },
              { title: '机柜', dataIndex: 'total_cabinets', width: 60 },
              { title: 'IT组成', width: 170, render: (_: unknown, r: ParsedInput) => r.it_transformers?.map(([c, n]) => `${c}MW×${n}`).join('+') || '-' },
              { title: '动力组成', width: 170, render: (_: unknown, r: ParsedInput) => r.power_transformers?.map(([c, n]) => `${c}MW×${n}`).join('+') || '-' },
              { title: '空调', dataIndex: 'ac_type', width: 65 },
              { title: '校验', dataIndex: '_errors', width: 55,
                render: (e: string[]) => e.length > 0
                  ? <Tooltip title={e.join('; ')}><CloseCircleOutlined style={{ color: '#ff4d4f' }} /></Tooltip>
                  : <CheckCircleOutlined style={{ color: '#52c41a' }} /> },
            ]}
            pagination={false} scroll={{ x: 750 }}
            caption={importedData.length > 5 ? `仅显示前5条，共${importedData.length}条` : undefined}
          />
        )}
      </Modal>
    </div>
  );
}

// ============ 单算结果页 ============

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

function expandTf(transformers: [number, number][]): string {
  const parts: string[] = [];
  for (const [cap, count] of transformers) for (let i = 0; i < count; i++) parts.push(`${cap}MW`);
  return parts.join('+');
}

function buildSummaryRow(input: ResourceInput, report: ResourceReport): (string | number)[] {
  const itCap = input.it_transformers.reduce((s, [c, n]) => s + c * n, 0);
  const pwCap = input.power_transformers.reduce((s, [c, n]) => s + c * n, 0);
  const itCount = input.it_transformers.reduce((s, [, n]) => s + n, 0);
  const pwCount = input.power_transformers.reduce((s, [, n]) => s + n, 0);
  const pue = itCap > 0 ? Math.round((input.total_mw / itCap) * 1000) / 1000 : 0;
  return [
    input.cabinet_power, input.total_cabinets, itCap, expandTf(input.it_transformers), itCount,
    pue, pwCap, expandTf(input.power_transformers), pwCount,
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

function SingleResultView({ report, input, onExport, onBack }: {
  report: ResourceReport; input: ResourceInput; onExport: () => void; onBack: () => void;
}) {
  const dur = input.total_duration;
  const summaryRow = buildSummaryRow(input, report);
  const summaryColumns = SUMMARY_HEADERS.map((h, i) => ({
    title: h, dataIndex: `c${i}`, key: `c${i}`, width: h.length > 6 ? 130 : 100,
    render: (v: string | number) => v,
  }));
  const summaryData = [{ ...summaryRow.reduce((acc, v, i) => ({ ...acc, [`c${i}`]: v, key: '1' }), {} as Record<string, unknown>) }];

  const tabItems = [
    {
      key: 'summary', label: '汇总表',
      children: (
        <div>
          <Row gutter={24} style={{ marginBottom: 16 }}>
            <Col span={6}><Statistic title="总容量" value={input.total_mw} suffix="MW" /></Col>
            <Col span={6}><Statistic title="总工期" value={input.total_duration} suffix="天" /></Col>
            <Col span={6}><Statistic title="峰值同时在场" value={report.汇总.峰值同时在场} suffix="人" valueStyle={{ color: '#1677ff' }} /></Col>
            <Col span={6}><Statistic title="总人天" value={report.汇总.总人天} suffix="人·天" valueStyle={{ color: '#52c41a' }} /></Col>
          </Row>
          <Table columns={summaryColumns} dataSource={summaryData} pagination={false} size="small" bordered scroll={{ x: 1800 }} />
        </div>
      ),
    },
    {
      key: 'staff', label: '人员清单',
      children: (
        <Table size="small" bordered pagination={false}
          dataSource={[
            { key: 1, role: '测试经理', count: 1, manDays: dur },
            { key: 2, role: '电气主测', count: 1, manDays: dur },
            { key: 3, role: '电气测试员', count: report.IT链路.同时在场人数, manDays: report.IT链路.总人天 },
            { key: 4, role: '动力测试员', count: report.动力链路.同时在场人数, manDays: report.动力链路.总人天 },
            { key: 5, role: '暖通主测', count: 1, manDays: dur },
            { key: 6, role: '暖通测试员', count: report.暖通.峰值同时在场, manDays: report.暖通.总人天 },
            { key: 7, role: '弱电主测+记录', count: report.弱电.小计, manDays: report.弱电.小计 * dur },
            { key: 8, role: '消防', count: report.消防.小计, manDays: report.消防.小计 * dur },
            { key: 9, role: '柴发', count: report.柴发.小计, manDays: report.柴发.小计 * dur },
            { key: 10, role: '固定人员', count: report.固定人员.小计, manDays: report.固定人员.小计 * dur },
            { key: 'sum', role: <Text strong>合计</Text>, count: <Text strong>{report.汇总.峰值同时在场}</Text>, manDays: <Text strong>{report.汇总.总人天}</Text> },
          ]}
          columns={[{ title: '岗位', dataIndex: 'role', width: 140 }, { title: '人数', dataIndex: 'count', width: 80 }, { title: '人天', dataIndex: 'manDays', width: 100 }]}
        />
      ),
    },
    {
      key: 'load', label: '假负载',
      children: (
        <Table size="small" bordered pagination={false}
          dataSource={(report.假负载清单 || []).map((f, i) => ({ ...f, key: i }))}
          columns={[{ title: '名称', dataIndex: 'name' }, { title: '数量', dataIndex: 'count', width: 70 }, { title: '天数', dataIndex: 'days', width: 70 }, { title: '总台天', dataIndex: 'totalUnits', width: 80 }, { title: '规格', dataIndex: 'spec' }]}
        />
      ),
    },
    {
      key: 'tools', label: '工器具',
      children: (
        <Table size="small" bordered pagination={false}
          dataSource={(report.工具清单 || []).map((t, i) => ({ ...t, key: i }))}
          columns={[{ title: '名称', dataIndex: 'name', width: 160 }, { title: '数量', dataIndex: 'count', width: 60 }, { title: '型号', dataIndex: 'model', width: 130 }, { title: '备注', dataIndex: 'note' }]}
          scroll={{ x: 600 }}
        />
      ),
    },
    {
      key: 'detail', label: '详细',
      children: (
        <Collapse size="small" items={[
          { key: 'it', label: 'IT链路', children: <Descs data={[['并行数', report.IT链路.所需并行数], ['测试工期', `${report.IT链路.实际测试工期}天`], ['在场', `${report.IT链路.同时在场人数}人`], ['人天', report.IT链路.总人天]]} /> },
          { key: 'pw', label: '动力链路', children: <Descs data={[['并行数', report.动力链路.所需并行数], ['测试工期', `${report.动力链路.实际测试工期}天`], ['在场', `${report.动力链路.同时在场人数}人`], ['人天', report.动力链路.总人天]]} /> },
          { key: 'hvac', label: '暖通', children: <Descs data={[['总组数', report.暖通.暖通总组数], ['峰值在场', `${report.暖通.峰值同时在场}人`], ['人天', report.暖通.总人天]]} /> },
          { key: 'weak', label: '弱电/消防/柴发', children: <Descs data={[['弱电', `${report.弱电.小计}人`], ['消防', `${report.消防.小计}人`], ['柴发', `${report.柴发.小计}人`], ['固定', `${report.固定人员.小计}人`]]} /> },
        ]} />
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <Title level={3} style={{ margin: 0 }}><CalculatorOutlined style={{ marginRight: 8 }} />计算结果</Title>
          <Text type="secondary">{input.total_mw}MW / {input.total_duration}天 / {input.ac_type}</Text>
        </div>
        <Space>
          <Button icon={<ExportOutlined />} type="primary" onClick={onExport}>导出Excel</Button>
          <Button onClick={onBack}>← 返回首页</Button>
        </Space>
      </div>
      <Tabs items={tabItems} defaultActiveKey="summary" size="large" />
    </div>
  );
}

function Descs({ data }: { data: [string, string | number][] }) {
  return (
    <Descriptions column={2} size="small" bordered>
      {data.map(([label, val], i) => <Descriptions.Item key={i} label={label}>{val}</Descriptions.Item>)}
    </Descriptions>
  );
}

export default ResourceCalculator;
