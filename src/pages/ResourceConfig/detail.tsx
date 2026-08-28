import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Tabs, Table, Button, Input, InputNumber, Select, Switch, message, Space, Spin,
  Statistic, Row, Col, Tag, Popconfirm, Typography, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined, SaveOutlined, PlusOutlined, DeleteOutlined, CalculatorOutlined,
} from '@ant-design/icons';
import {
  calcLabor, calcLoadAllocation, calcInstrumentAllocation, calcLoadDays,
  type ResourceConfigProject, type LaborRow, type LoadRow, type AssetLibItem,
  type StaffLevel, type StaffRole, type LaborMode, type LaborLoadType, type SubsidyPost,
} from '../../types/resourceConfig';

const { TextArea } = Input;

/** 通用可编辑行的字段类型 */
type FieldType = 'text' | 'num' | 'int' | 'textarea' | 'select';

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  width?: number;
  options?: string[];
  min?: number;
  placeholder?: string;
}

/** 行数据统一为 Record，保存时整体放入 data JSONB */
type Row = Record<string, any>;

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ============== 各模块字段定义（与原工具列结构对齐） ==============

const MODULE_DEFS: Array<{ key: keyof ResourceConfigProject | 'cert'; label: string; fields: FieldDef[] }> = [
  {
    key: 'personnel', label: '人员岗位配置', fields: [
      { key: 'post', label: '岗位', type: 'text', width: 130, placeholder: '如：电气组' },
      { key: 'lead', label: '主测', type: 'int', width: 70, min: 0 },
      { key: 'member', label: '组员', type: 'int', width: 70, min: 0 },
      { key: 'duty', label: '人员职责', type: 'textarea', width: 200 },
      { key: 'division', label: '人员分工', type: 'textarea', width: 200 },
      { key: 'names', label: '人员姓名', type: 'textarea', width: 160 },
    ],
  },
  {
    key: 'staff', label: '投入明细', fields: [
      { key: 'name', label: '姓名', type: 'text', width: 110 },
      { key: 'company', label: '公司/部门', type: 'text', width: 140 },
      { key: 'level', label: '职级', type: 'select', width: 80, options: ['T7', 'T6', 'T5', 'T4'] },
      { key: 'post', label: '岗位', type: 'select', width: 90, options: ['经理', '暖通', '电气', '消防', '弱电'] },
      { key: 'role', label: '角色', type: 'select', width: 100, options: ['主测', '测试工程师', '经理', '组员'] },
      { key: 'survey', label: '踏勘(天)', type: 'int', width: 80, min: 0 },
      { key: 'retest', label: '复测(天)', type: 'int', width: 80, min: 0 },
      { key: 'test', label: '测试(天)', type: 'int', width: 80, min: 0 },
    ],
  },
  {
    key: 'subsidy', label: '岗位补贴', fields: [
      { key: 'post', label: '测试岗位', type: 'select', width: 130, options: ['测试经理', '主测岗位', '测试工程师'] },
      { key: 'count', label: '人数', type: 'int', width: 80, min: 0 },
      { key: 'remark', label: '备注', type: 'text', width: 220 },
    ],
  },
  {
    key: 'external', label: '外部租赁人员', fields: [
      { key: 'name', label: '名称', type: 'text', width: 160 },
      { key: 'total', label: '需求总天数', type: 'int', width: 100, min: 0 },
      { key: 'survey', label: '工勘', type: 'int', width: 80, min: 0 },
      { key: 'retest', label: '复测', type: 'int', width: 80, min: 0 },
      { key: 'count', label: '数量', type: 'int', width: 80, min: 0 },
      { key: 'remark', label: '备注', type: 'text', width: 180 },
    ],
  },
  {
    key: 'loads', label: '假负载计划', fields: [
      { key: 'type', label: '类型', type: 'text', width: 150, placeholder: '含"租赁"=纯租赁；含"去离子"=水负载' },
      { key: 'count', label: '数量', type: 'int', width: 80, min: 0 },
      { key: 'ratio', label: '备用台数', type: 'num', width: 80, min: 0 },
      { key: 'spec', label: '规格', type: 'textarea', width: 170, placeholder: '6KW/台 带电源线' },
      { key: 'arrive', label: '到场(第X天)', type: 'int', width: 90, min: 1 },
      { key: 'start', label: '开始(第X天)', type: 'int', width: 90, min: 1 },
      { key: 'end', label: '结束(第X天)', type: 'int', width: 90, min: 1 },
      { key: 'leave', label: '离场(第X天)', type: 'int', width: 90, min: 1 },
      { key: 'remark', label: '备注', type: 'text', width: 130 },
    ],
  },
  {
    key: 'instruments', label: '仪器仪表', fields: [
      { key: 'name', label: '测试工具', type: 'text', width: 170 },
      { key: 'demand', label: '需求', type: 'int', width: 70, min: 0 },
      { key: 'days', label: '天数', type: 'int', width: 70, min: 1 },
      { key: 'remark', label: '备注', type: 'text', width: 150 },
    ],
  },
  {
    key: 'labor', label: '劳务人员', fields: [
      { key: 'work', label: '工作内容', type: 'text', width: 140 },
      { key: 'type', label: '负载类型', type: 'select', width: 110, options: ['风冷', '液冷', '集中式假负载', '其他'] },
      { key: 'mode', label: '核算模式', type: 'select', width: 110, options: ['auto', 'byman', 'experience'] },
      { key: 'qty', label: '作业数量', type: 'int', width: 80, min: 0 },
      { key: 'daily', label: '每人每天(台)', type: 'num', width: 90, min: 0 },
      { key: 'days', label: '作业天数', type: 'int', width: 80, min: 1 },
      { key: 'workers', label: '需要人数', type: 'int', width: 80, min: 0 },
      { key: 'note', label: '备注', type: 'text', width: 130 },
    ],
  },
  {
    key: 'consumables', label: '现场耗材', fields: [
      { key: 'name', label: '名称', type: 'text', width: 180 },
      { key: 'count', label: '数量', type: 'num', width: 90, min: 0 },
      { key: 'unit', label: '单位', type: 'text', width: 80 },
      { key: 'note', label: '说明', type: 'text', width: 220 },
    ],
  },
  {
    key: 'safety', label: '劳保用品', fields: [
      { key: 'name', label: '名称', type: 'text', width: 180 },
      { key: 'count', label: '数量', type: 'num', width: 90, min: 0 },
      { key: 'unit', label: '单位', type: 'text', width: 80 },
      { key: 'note', label: '备注', type: 'text', width: 220 },
    ],
  },
];

// select 字段的自由输入支持（岗位/负载类型等允许自定义值）
function FreeSelect({ value, options, onChange, style }: { value?: string; options?: string[]; onChange?: (v: string) => void; style?: React.CSSProperties }) {
  const inOptions = value != null && (options || []).includes(value);
  return (
    <Select
      size="small" style={style} value={inOptions ? value : undefined}
      onChange={onChange} allowClear showSearch
      placeholder="选择/留空手填"
      options={(options || []).map((o) => ({ value: o, label: o }))}
      dropdownRender={(menu) => (
        <div>
          {menu}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: 4 }}>
            <Input
              size="small" placeholder="手动输入自定义值…"
              onPressEnter={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) { onChange?.(v); (e.target as HTMLInputElement).value = ''; } }}
            />
          </div>
        </div>
      )}
    />
  );
}

/** 通用可编辑表格（支持底部小计行） */
function EditableTable({ rows, fields, onChange, extraColumns, addDefaults, sums }: {
  rows: Row[];
  fields: FieldDef[];
  onChange: (next: Row[]) => void;
  extraColumns?: ColumnsType<Row>;
  addDefaults?: Row;
  /** 底部小计：key 对应列显示合计（sum=数值求和），custom 用 value 函数 */
  sums?: Array<{ key: string; calc?: 'sum'; value?: (rows: Row[]) => string | number }>;
}) {
  const update = (id: string, key: string, val: unknown) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, [key]: val } : r)));
  };
  const columns: ColumnsType<Row> = [
    {
      title: '#', key: '__idx', width: 40, align: 'center', fixed: 'left' as const,
      render: (_: unknown, _r: Row, i: number) => <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{i + 1}</span>,
    },
    ...fields.map((f): ColumnsType<Row>[number] => ({
      title: f.label,
      dataIndex: f.key,
      width: f.width,
      render: (_: unknown, r: Row) => {
        if (f.type === 'num' || f.type === 'int') {
          return <InputNumber size="small" min={f.min ?? 0} precision={f.type === 'int' ? 0 : undefined} value={r[f.key]} onChange={(v) => update(r.id, f.key, v ?? 0)} style={{ width: '100%' }} className="rc-cell-input" />;
        }
        if (f.type === 'textarea') {
          return <TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={r[f.key] ?? ''} onChange={(e) => update(r.id, f.key, e.target.value)} placeholder={f.placeholder} className="rc-cell-input" />;
        }
        if (f.type === 'select') {
          return <FreeSelect value={r[f.key]} options={f.options} onChange={(v) => update(r.id, f.key, v ?? '')} style={{ width: '100%' }} />;
        }
        return <Input size="small" value={r[f.key] ?? ''} onChange={(e) => update(r.id, f.key, e.target.value)} placeholder={f.placeholder} className="rc-cell-input" />;
      },
    })),
    ...(extraColumns || []),
    {
      title: '', key: '__op', width: 44, align: 'center',
      render: (_: unknown, r: Row) => (
        <Popconfirm title="删除该行？" onConfirm={() => onChange(rows.filter((x) => x.id !== r.id))} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 30 }} />
        </Popconfirm>
      ),
    },
  ];
  // 底部小计行
  const summaryRow = () => {
    if (!sums || sums.length === 0) return null;
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: 'rgba(30,58,95,0.35)' }}>
          <Table.Summary.Cell index={0}>
            <span style={{ color: '#7cb8ff', fontWeight: 600, fontSize: 12 }}>合计</span>
          </Table.Summary.Cell>
          {fields.map((f, i) => {
            const s = sums.find((x) => x.key === f.key);
            if (!s) return <Table.Summary.Cell key={f.key} index={i + 1} />;
            const v = s.value
              ? s.value(rows)
              : Math.round(rows.reduce((acc, r) => acc + (Number(r[f.key]) || 0), 0) * 10) / 10;
            return (
              <Table.Summary.Cell key={f.key} index={i + 1}>
                <span style={{ color: '#7cb8ff', fontWeight: 600 }}>{v}</span>
              </Table.Summary.Cell>
            );
          })}
          {(extraColumns || []).map((_, i) => <Table.Summary.Cell key={'e' + i} index={fields.length + i + 1} />)}
          <Table.Summary.Cell index={fields.length + (extraColumns || []).length + 1} />
        </Table.Summary.Row>
      </Table.Summary>
    );
  };

  return (
    <div>
      <Table<Row> rowKey="id" size="small" columns={columns} dataSource={rows} pagination={false}
        className="rc-edit-table"
        summary={summaryRow}
        scroll={{ x: 'max-content' }} />
      <Button size="small" type="dashed" icon={<PlusOutlined />} style={{ marginTop: 8, width: '100%' }}
        onClick={() => onChange([...rows, { id: genId(), ...(addDefaults || {}) }])}>
        添加行
      </Button>
    </div>
  );
}

// ============== 主页面 ==============

function ResourceConfigDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<{ name: string; mw: string; site: string; status: string } | null>(null);
  const [data, setData] = useState<ResourceConfigProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [assets, setAssets] = useState<AssetLibItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [projRes, assetRes] = await Promise.all([
          fetch(`/api/rc/projects/${id}`, { credentials: 'include' }).then((r) => r.json()),
          fetch('/api/rc/assets', { credentials: 'include' }).then((r) => r.json()),
        ]);
        if (projRes.success) {
          setMeta({ name: projRes.data.name, mw: projRes.data.mw, site: projRes.data.site, status: projRes.data.status });
          setData((projRes.data.data || {}) as ResourceConfigProject);
        } else {
          message.error(projRes.error || '加载失败');
        }
        if (assetRes.success && Array.isArray(assetRes.data)) {
          setAssets(assetRes.data.map((a: any) => ({ id: String(a.id), cat: a.cat, name: a.name, spec: a.spec, count: a.count, note: a.note })));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const setModule = (key: string, rows: Row[]) => {
    setData((prev) => (prev ? { ...prev, [key]: rows } as ResourceConfigProject : prev));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/rc/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ data }),
      });
      const d = await res.json();
      if (d.success) { message.success('已保存全部明细'); setDirty(false); }
      else message.error(d.error || '保存失败');
    } catch {
      message.error('保存失败，请检查网络');
    } finally {
      setSaving(false);
    }
  };

  /** 派生计算（与原工具公式一致） */
  const derived = useMemo(() => {
    if (!data) return null;
    const laborRows = (data.labor || []) as LaborRow[];
    const laborCalc = laborRows.map((r) => calcLabor(r));
    const loadAlloc = calcLoadAllocation((data.loads || []) as LoadRow[], assets);
    const insAlloc = calcInstrumentAllocation((data.instruments || []) as any[], assets);
    const round1 = (v: number) => Math.round(v * 10) / 10;
    return {
      laborCalc, loadAlloc, insAlloc, round1,
      loadRentTotal: round1(Object.values(loadAlloc).reduce((s, r) => s + r.rent, 0)),
      insRentTotal: Math.round(Object.values(insAlloc).reduce((s, r) => s + r.rent, 0)),
      laborManDays: round1(laborCalc.reduce((s, r) => s + r.manDays, 0)),
      laborWorkers: Math.round(laborCalc.reduce((s, r) => s + r.workers, 0)),
    };
  }, [data, assets]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }
  if (!data || !derived) {
    return <div style={{ textAlign: 'center', padding: 80, color: 'rgba(255,255,255,0.4)' }}>配置项目不存在</div>;
  }

  const tabItems = MODULE_DEFS.map((m) => {
    const rows = (data as any)[m.key] as Row[] | undefined;
    let extraColumns: ColumnsType<Row> | undefined;
    // 各模块的派生列
    if (m.key === 'personnel') {
      extraColumns = [{
        title: '数量', key: '__count', width: 70, align: 'center',
        render: (_: unknown, r: Row) => <span style={{ color: '#7cb8ff', fontWeight: 600 }}>{(Number(r.lead) || 0) + (Number(r.member) || 0)}</span>,
      }];
    } else if (m.key === 'staff') {
      extraColumns = [{
        title: '投入总天数', key: '__total', width: 90, align: 'center',
        render: (_: unknown, r: Row) => <span style={{ color: '#7cb8ff', fontWeight: 600 }}>{(Number(r.survey) || 0) + (Number(r.retest) || 0) + (Number(r.test) || 0)}</span>,
      }];
    } else if (m.key === 'loads') {
      extraColumns = [
        {
          title: '天数', key: '__days', width: 70, align: 'center',
          render: (_: unknown, r: Row) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{calcLoadDays(r as unknown as LoadRow)}</span>,
        },
        {
          title: '自有/租赁', key: '__alloc', width: 110, align: 'center',
          render: (_: unknown, r: Row) => {
            const a = derived.loadAlloc[r.id];
            if (!a) return '-';
            return <Space size={4}><Tag color="success" style={{ margin: 0 }}>自有 {a.own}</Tag><Tag color="warning" style={{ margin: 0 }}>租 {a.rent}</Tag></Space>;
          },
        },
      ];
    } else if (m.key === 'instruments') {
      extraColumns = [
        {
          title: '自有/租赁', key: '__alloc', width: 110, align: 'center',
          render: (_: unknown, r: Row) => {
            const a = derived.insAlloc[r.id];
            if (!a) return '-';
            return <Space size={4}><Tag color="success" style={{ margin: 0 }}>自有 {a.own}</Tag><Tag color="warning" style={{ margin: 0 }}>租 {a.rent}</Tag></Space>;
          },
        },
        {
          title: '隐藏', key: 'hidden', width: 60, align: 'center',
          render: (_: unknown, r: Row) => <Switch size="small" checked={!!r.hidden} onChange={(v) => setModule('instruments', ((data.instruments || []) as Row[]).map((x) => (x.id === r.id ? { ...x, hidden: v } : x)))} />,
        },
      ];
    } else if (m.key === 'labor') {
      extraColumns = [
        {
          title: '人天', key: '__md', width: 80, align: 'center',
          render: (_: unknown, r: Row) => {
            const c = derived.laborCalc.find((x, i) => (data.labor || [])[i]?.id === r.id);
            return <span style={{ color: '#4d9fff', fontWeight: 600 }}>{c ? derived.round1(c.manDays) : '-'}</span>;
          },
        },
        {
          title: '人数(算)', key: '__wk', width: 80, align: 'center',
          render: (_: unknown, r: Row) => {
            const idx = (data.labor || []).findIndex((x) => x.id === r.id);
            const c = derived.laborCalc[idx];
            const auto = c && c.mode === 'auto' && !((data.labor || [])[idx] as LaborRow).workersCustom;
            return <span style={{ color: auto ? '#52c41a' : 'rgba(255,255,255,0.5)' }}>{c ? c.workers : '-'}{auto ? '' : ' ✎'}</span>;
          },
        },
      ];
    }
    // 各模块底部小计配置（对齐原工具的小计行为）
    let sums: Array<{ key: string; calc?: 'sum'; value?: (rows: Row[]) => string | number }> | undefined;
    if (m.key === 'personnel') {
      sums = [
        { key: 'lead' }, { key: 'member' },
        { key: 'post', value: (rs) => `共 ${rs.reduce((s, r) => s + (Number(r.lead) || 0) + (Number(r.member) || 0), 0)} 人` },
      ];
    } else if (m.key === 'staff') {
      sums = [
        { key: 'survey' }, { key: 'retest' }, { key: 'test' },
        { key: 'name', value: (rs) => `共 ${rs.length} 人` },
      ];
    } else if (m.key === 'subsidy') {
      sums = [{ key: 'count', calc: 'sum' }];
    } else if (m.key === 'external') {
      sums = [{ key: 'total' }, { key: 'count' }];
    } else if (m.key === 'loads') {
      sums = [{ key: 'count' }];
    } else if (m.key === 'instruments') {
      sums = [{ key: 'demand' }];
    } else if (m.key === 'labor') {
      sums = [
        { key: 'qty' },
        { key: 'work', value: (rs) => {
          const md = rs.reduce((s, r, i) => s + (derived.laborCalc[i]?.manDays || 0), 0);
          const wk = rs.reduce((s, r, i) => s + (derived.laborCalc[i]?.workers || 0), 0);
          return `${Math.round(md * 10) / 10} 人天 / ${wk} 人`;
        } },
      ];
    } else if (m.key === 'consumables' || m.key === 'safety') {
      sums = [{ key: 'count' }];
    }
    return {
      key: m.key as string,
      label: `${m.label}（${(rows || []).length}）`,
      children: (
        <EditableTable
          rows={rows || []}
          fields={m.fields}
          extraColumns={extraColumns}
          sums={sums}
          onChange={(next) => setModule(m.key as string, next)}
        />
      ),
    };
  });

  // 证书 Tab
  tabItems.push({
    key: 'cert', label: '测试证书',
    children: (
      <div style={{ maxWidth: 720 }}>
        {(['cqc', 'air', 'emc'] as const).map((k) => (
          <div key={k} style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ color: 'rgba(255,255,255,0.8)' }}>
              {k === 'cqc' ? 'CQC 认证' : k === 'air' ? '机房空气环境' : '电磁环境'}
            </Typography.Text>
            <Row gutter={8} style={{ marginTop: 6 }}>
              {(['req', 'region', 'time'] as const).map((f) => (
                <Col span={8} key={f}>
                  <Input
                    size="small"
                    addonBefore={f === 'req' ? '要求' : f === 'region' ? '区域' : '时间'}
                    value={(data.cert?.[k] as any)?.[f] ?? ''}
                    onChange={(e) => {
                      setData((prev) => prev ? ({
                        ...prev,
                        cert: { ...prev.cert, [k]: { ...(prev.cert[k] || { req: '', region: '', time: '' }), [f]: e.target.value } },
                      } as ResourceConfigProject) : prev);
                      setDirty(true);
                    }}
                  />
                </Col>
              ))}
            </Row>
          </div>
        ))}
      </div>
    ),
  });

  // 汇总 Tab
  tabItems.push({
    key: 'summary', label: '汇总',
    children: (
      <div>
        <Row gutter={[16, 16]}>
          <Col span={6}><Statistic title="人员岗位数" value={(data.personnel || []).length} suffix="个" /></Col>
          <Col span={6}><Statistic title="投入人数" value={(data.staff || []).length} suffix="人" /></Col>
          <Col span={6}><Statistic title="人员总数(主测+组员)" value={(data.personnel || []).reduce((s, r) => s + (Number((r as any).lead) || 0) + (Number((r as any).member) || 0), 0)} suffix="人" /></Col>
          <Col span={6}><Statistic title="投入总人天" value={(data.staff || []).reduce((s, r) => s + (Number((r as any).survey) || 0) + (Number((r as any).retest) || 0) + (Number((r as any).test) || 0), 0)} suffix="人天" /></Col>
          <Col span={6}><Statistic title="假负载需租赁" value={derived.loadRentTotal} suffix="台" valueStyle={{ color: '#faad14' }} /></Col>
          <Col span={6}><Statistic title="仪表需租赁" value={derived.insRentTotal} suffix="台" valueStyle={{ color: '#faad14' }} /></Col>
          <Col span={6}><Statistic title="劳务人天合计" value={derived.laborManDays} suffix="人天" valueStyle={{ color: '#4d9fff' }} /></Col>
          <Col span={6}><Statistic title="劳务人数合计" value={derived.laborWorkers} suffix="人" valueStyle={{ color: '#4d9fff' }} /></Col>
        </Row>
        <div style={{ marginTop: 16, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
          <CalculatorOutlined /> 自有/租赁按「自有资源库」自动分配（与原工具算法一致）；租赁台·天等更细统计随 Excel 导出功能提供。
        </div>
      </div>
    ),
  });

  return (
    <div style={{ padding: '0 4px' }}>
      {/* 专业表格样式（对齐原工具观感：深色列头/斑马纹/无边框沉浸式输入） */}
      <style>{`
        .rc-edit-table .ant-table-thead > tr > th {
          background: rgba(30, 58, 95, 0.85) !important;
          color: #e0e6ed !important;
          font-weight: 600 !important;
          font-size: 12px !important;
          padding: 8px 8px !important;
          border-bottom: 1px solid rgba(77, 159, 255, 0.3) !important;
        }
        .rc-edit-table .ant-table-tbody > tr > td {
          padding: 3px 6px !important;
          font-size: 12.5px;
        }
        .rc-edit-table .ant-table-tbody > tr:nth-child(even) > td {
          background: rgba(255, 255, 255, 0.025);
        }
        .rc-edit-table .ant-table-tbody > tr:hover > td {
          background: rgba(77, 159, 255, 0.07) !important;
        }
        /* 沉浸式输入：无边框透明，hover/focus 才浮现，像直接在单元格里编辑 */
        .rc-edit-table .rc-cell-input,
        .rc-edit-table .rc-cell-input.ant-input-number,
        .rc-edit-table .rc-cell-input textarea {
          background: transparent !important;
          border-color: transparent !important;
          box-shadow: none !important;
          color: rgba(255, 255, 255, 0.88) !important;
          font-size: 12.5px !important;
        }
        .rc-edit-table .rc-cell-input:hover,
        .rc-edit-table .ant-table-cell:hover .rc-cell-input {
          border-color: rgba(77, 159, 255, 0.35) !important;
          background: rgba(77, 159, 255, 0.04) !important;
        }
        .rc-edit-table .rc-cell-input:focus,
        .rc-edit-table .rc-cell-input:focus-within {
          border-color: #4d9fff !important;
          background: rgba(77, 159, 255, 0.08) !important;
        }
        .rc-edit-table .rc-cell-input::placeholder {
          color: rgba(255, 255, 255, 0.22) !important;
          font-size: 11.5px !important;
        }
        /* 下拉选择同样沉浸 */
        .rc-edit-table .ant-select .ant-select-selector {
          background: transparent !important;
          border-color: transparent !important;
          box-shadow: none !important;
          font-size: 12.5px !important;
        }
        .rc-edit-table .ant-table-cell:hover .ant-select .ant-select-selector {
          border-color: rgba(77, 159, 255, 0.35) !important;
        }
        .rc-edit-table .ant-select-focused .ant-select-selector {
          border-color: #4d9fff !important;
        }
        /* 删除按钮平时隐形，hover 行才出现 */
        .rc-edit-table .ant-table-row .ant-btn-dangerous {
          opacity: 0.25;
          transition: opacity 0.15s;
        }
        .rc-edit-table .ant-table-row:hover .ant-btn-dangerous {
          opacity: 1;
        }
      `}</style>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/resource-config')} style={{ borderRadius: 8 }}>返回</Button>
        <span style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{meta?.name}</span>
        {meta?.mw && <Tag>{meta.mw} MW</Tag>}
        {meta?.site && <Tag>{meta.site}</Tag>}
        <Tag color={meta?.status === '已交付' ? 'success' : 'processing'}>{meta?.status}</Tag>
        {dirty && <Tag color="warning">有未保存修改</Tag>}
        <div style={{ flex: 1 }} />
        <Tooltip title="保存全部模块的明细数据">
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={handleSave} style={{ borderRadius: 8 }}>
            保存全部{dirty ? '' : '（无修改）'}
          </Button>
        </Tooltip>
      </div>

      <Tabs items={tabItems} size="small" />
    </div>
  );
}

export default ResourceConfigDetail;
