import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Tabs, Button, Input, InputNumber, DatePicker, message, Spin, Tag,
} from 'antd';
import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ResourceConfigProject, AssetLibItem } from '../../types/resourceConfig';
import { useAuth } from '../../store/AuthContext';
import PersonnelTab from './detail/PersonnelTab';
import SubsidyTab from './detail/SubsidyTab';
import LoadsTab from './detail/LoadsTab';
import InstrumentsTab from './detail/InstrumentsTab';
import LaborTab from './detail/LaborTab';
import SummaryTab from './detail/SummaryTab';

/** 各模块 Tab 的统一 props（与 detail/CONVENTIONS.md 一致） */
export interface TabProps {
  data: ResourceConfigProject;
  assets: AssetLibItem[];
  canEdit: boolean;
  patch: (updates: Partial<ResourceConfigProject>) => void;
}

const { TextArea } = Input;

// ============== 项目信息 Tab（复刻原工具项目信息页） ==============
function ProjectInfoTab({ id, meta, canEdit, onSaved }: {
  id: string;
  meta: { name: string; mw: string; site: string; manager: string; test_days: number; start_date: string | null; end_date: string | null; remark: string; status: string };
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: meta.name, mw: meta.mw, site: meta.site, manager: meta.manager,
    testDays: meta.test_days ?? 40,
    range: (meta.start_date && meta.end_date) ? [dayjs(meta.start_date), dayjs(meta.end_date)] as [any, any] : undefined,
    remark: meta.remark,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name.trim()) { message.warning('项目名称必填'); return; }
    setSaving(true);
    try {
      const body = {
        name: form.name, mw: form.mw, site: form.site, manager: form.manager,
        test_days: form.testDays,
        start_date: form.range?.[0]?.format('YYYY-MM-DD') ?? '',
        end_date: form.range?.[1]?.format('YYYY-MM-DD') ?? '',
        remark: form.remark,
      };
      const res = await fetch(`/api/rc/projects/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (d.success) { message.success('项目信息已保存'); await onSaved(); }
      else message.error(d.error || '保存失败');
    } catch {
      message.error('保存失败，请检查网络');
    } finally { setSaving(false); }
  };

  const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, marginBottom: 16 };
  const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 };

  return (
    <div style={{ maxWidth: 780 }}>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.9)', marginBottom: 16 }}>📋 基本信息</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <div><span style={label}>项目名称</span><Input value={form.name} disabled={!canEdit} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：乌兰大三期B1" /></div>
          <div><span style={label}>项目规模(MW)</span><Input value={form.mw} disabled={!canEdit} onChange={(e) => setForm({ ...form, mw: e.target.value })} placeholder="100" /></div>
          <div><span style={label}>项目地点</span><Input value={form.site} disabled={!canEdit} onChange={(e) => setForm({ ...form, site: e.target.value })} placeholder="项目所在地" /></div>
          <div><span style={label}>测试经理</span><Input value={form.manager} disabled={!canEdit} onChange={(e) => setForm({ ...form, manager: e.target.value })} placeholder="姓名" /></div>
          <div><span style={label}>计划测试天数 🔗</span><InputNumber min={1} max={365} value={form.testDays} disabled={!canEdit} style={{ width: '100%' }} onChange={(v) => setForm({ ...form, testDays: v ?? 40 })} /></div>
          <div><span style={label}>测试周期（开始 ~ 结束）</span>
            <DatePicker.RangePicker value={form.range} disabled={!canEdit} style={{ width: '100%' }}
              onChange={(v) => setForm({ ...form, range: (v as any) || undefined })} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <span style={label}>备注</span>
          <TextArea rows={3} value={form.remark} disabled={!canEdit} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="项目背景、特殊要求等" />
        </div>
        {canEdit && (
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} style={{ marginTop: 16, borderRadius: 8 }}>
            保存项目信息
          </Button>
        )}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
        维护项目基本信息，作为本配置的主标识。
      </div>
    </div>
  );
}

// ============== 主页面 ==============

interface Meta { name: string; mw: string; site: string; manager: string; test_days: number; start_date: string | null; end_date: string | null; remark: string; status: string }

/**
 * data JSONB 内嵌的标量（name/mw/site/...）是导入时点的旧快照，项目信息保存只更新
 * 标量列、不回写 data。汇总等只读模块读 data 时必须以 meta（标量列）为准合并，
 * 否则改完项目信息后汇总仍显示旧值；保存明细时回写合并值可保持两者同步。
 */
function mergeMetaIntoData(data: ResourceConfigProject, meta: Meta): ResourceConfigProject {
  return {
    ...data,
    name: meta.name,
    mw: meta.mw,
    site: meta.site,
    manager: meta.manager,
    testDays: meta.test_days ?? 40,
    startDate: meta.start_date || '',
    endDate: meta.end_date || '',
  };
}

function ResourceConfigDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const editAllowed = canEdit('resourceConfig');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [data, setData] = useState<ResourceConfigProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [assets, setAssets] = useState<AssetLibItem[]>([]);

  /**
   * keepDetail=true：仅刷新 meta，不用服务端 data 覆盖本地明细状态。
   * 项目信息保存（标量 PUT）后回调时必须带上，否则会把其他明细 Tab 里
   * 尚未「保存全部」的修改静默冲掉。
   */
  const reload = useCallback(async (opts?: { keepDetail?: boolean }) => {
    try {
      const [projRes, assetRes] = await Promise.all([
        fetch(`/api/rc/projects/${id}`, { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/rc/assets', { credentials: 'include' }).then((r) => r.json()),
      ]);
      if (projRes.success) {
        const p = projRes.data;
        setMeta({ name: p.name, mw: p.mw, site: p.site, manager: p.manager, test_days: p.test_days, start_date: p.start_date, end_date: p.end_date, remark: p.remark, status: p.status });
        if (!opts?.keepDetail) setData((p.data || {}) as ResourceConfigProject);
      } else {
        message.error(projRes.error || '加载失败');
      }
      if (assetRes.success && Array.isArray(assetRes.data)) {
        setAssets(assetRes.data.map((a: any) => ({ id: String(a.id), cat: a.cat, name: a.name, spec: a.spec, count: a.count, note: a.note })));
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { setLoading(true); void reload(); }, [reload]);

  const patch = useCallback((updates: Partial<ResourceConfigProject>) => {
    setData((prev) => (prev ? { ...prev, ...updates } : prev));
    setDirty(true);
  }, []);

  const handleSave = async () => {
    if (!data || !meta) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/rc/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // 标量以 meta 为准一并回写，保持 data JSONB 内嵌标量与项目信息列同步
        body: JSON.stringify({ data: mergeMetaIntoData(data, meta) }),
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

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }
  if (!data || !meta) {
    return <div style={{ textAlign: 'center', padding: 80, color: 'rgba(255,255,255,0.4)' }}>配置项目不存在</div>;
  }

  const tabProps: TabProps = { data: mergeMetaIntoData(data, meta), assets, canEdit: editAllowed, patch };

  const items = [
    { key: 'info', label: '📋 项目信息', children: <ProjectInfoTab id={id!} meta={meta} canEdit={editAllowed} onSaved={() => reload({ keepDetail: true })} /> },
    { key: 'personnel', label: '👥 测试人员', children: <PersonnelTab {...tabProps} /> },
    { key: 'subsidy', label: '💰 岗位与补贴', children: <SubsidyTab {...tabProps} /> },
    { key: 'loads', label: '🗄️ 假负载计划', children: <LoadsTab {...tabProps} /> },
    { key: 'instruments', label: '📟 仪器仪表', children: <InstrumentsTab {...tabProps} /> },
    { key: 'labor', label: '👷 劳务人员', children: <LaborTab {...tabProps} /> },
    { key: 'summary', label: '📊 汇总报告', children: <SummaryTab {...tabProps} /> },
  ];

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
        .rc-edit-table .ant-table-tbody > tr > td { padding: 3px 6px !important; font-size: 12.5px; }
        .rc-edit-table .ant-table-tbody > tr:nth-child(even) > td { background: rgba(255, 255, 255, 0.025); }
        .rc-edit-table .ant-table-tbody > tr:hover > td { background: rgba(77, 159, 255, 0.07) !important; }
        .rc-edit-table .rc-cell-input, .rc-edit-table .rc-cell-input.ant-input-number, .rc-edit-table .rc-cell-input textarea {
          background: transparent !important; border-color: transparent !important; box-shadow: none !important;
          color: rgba(255, 255, 255, 0.88) !important; font-size: 12.5px !important;
        }
        .rc-edit-table .rc-cell-input:hover, .rc-edit-table .ant-table-cell:hover .rc-cell-input {
          border-color: rgba(77, 159, 255, 0.35) !important; background: rgba(77, 159, 255, 0.04) !important;
        }
        .rc-edit-table .rc-cell-input:focus, .rc-edit-table .rc-cell-input:focus-within {
          border-color: #4d9fff !important; background: rgba(77, 159, 255, 0.08) !important;
        }
        .rc-edit-table .rc-cell-input::placeholder { color: rgba(255, 255, 255, 0.22) !important; font-size: 11.5px !important; }
        .rc-edit-table .ant-select .ant-select-selector {
          background: transparent !important; border-color: transparent !important; box-shadow: none !important; font-size: 12.5px !important;
        }
        .rc-edit-table .ant-table-cell:hover .ant-select .ant-select-selector { border-color: rgba(77, 159, 255, 0.35) !important; }
        .rc-edit-table .ant-select-focused .ant-select-selector { border-color: #4d9fff !important; }
        .rc-edit-table .ant-table-row .ant-btn-dangerous { opacity: 0.25; transition: opacity 0.15s; }
        .rc-edit-table .ant-table-row:hover .ant-btn-dangerous { opacity: 1; }
      `}</style>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/resource-config')} style={{ borderRadius: 8 }}>返回</Button>
        <span style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{meta.name}</span>
        {meta.mw && <Tag>{meta.mw} MW</Tag>}
        {meta.site && <Tag>{meta.site}</Tag>}
        <Tag color={meta.status === '已交付' ? 'success' : 'processing'}>{meta.status}</Tag>
        {dirty && <Tag color="warning">有未保存修改</Tag>}
        <div style={{ flex: 1 }} />
        <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={handleSave} style={{ borderRadius: 8 }}>
          保存全部{dirty ? '' : '（无修改）'}
        </Button>
      </div>

      <Tabs items={items} size="small" />
    </div>
  );
}

export default ResourceConfigDetail;
