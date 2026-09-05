import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Input, Select, Tag, message, Space, Popconfirm, Upload,
  Statistic, Row, Col, Modal, Empty, Spin, InputNumber, Form,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, UploadOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, EyeOutlined, TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../../store/AuthContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ASSET_CATEGORIES, calcLabor, calcLoadAllocation, calcInstrumentAllocation, type ResourceConfigProject } from '../../types/resourceConfig';

// ============== 部门人员库 Tab ==============

interface DeptRow {
  id: number;
  name: string;
  level: string;   // 显示值 P4~P7
  post: string;
  company: string;
  phone: string;
  skill: string;
  note: string;
}

const LEVEL_COLOR: Record<string, string> = { P7: 'red', P6: 'orange', P5: 'blue', P4: 'green' };

/** 所持证书字段（存 skill 列）：逗号/顿号分隔 → 数组 */
function splitCerts(v: unknown): string[] {
  return String(v || '').split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean);
}

export function DeptMembersTab() {
  const { canEdit, canDelete } = useAuth();
  const isMobile = useIsMobile();
  const editAllowed = canEdit('resourceConfig');
  const deleteAllowed = canDelete('resourceConfig');
  const [rows, setRows] = useState<DeptRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', level: 'P4', post: '', company: '', phone: '', skill: '', note: '' });
  // 证书编辑（唯一的可修改入口）
  const [certEditing, setCertEditing] = useState<DeptRow | null>(null);
  const [certValues, setCertValues] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rc/dept-members', { credentials: 'include' });
      const d = await res.json().catch(() => ({}));
      if (d.success) setRows(d.data);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const handleImport = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      const res = await fetch('/api/rc/dept-members/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(json),
      });
      const d = await res.json();
      if (d.success) {
        message.success(`导入完成：新增 ${d.added} 人，更新 ${d.updated} 人`);
        void load();
      } else message.error(d.error || '导入失败');
    } catch { message.error('文件解析失败（需原工具导出的部门人员库 JSON）'); }
    return false;
  };

  const handleAdd = async () => {
    if (!addForm.name.trim()) { message.warning('请填写姓名'); return; }
    const res = await fetch('/api/rc/dept-members', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(addForm),
    });
    const d = await res.json();
    if (d.success) { message.success('已添加'); setAddOpen(false); void load(); }
    else message.error(d.error || '添加失败');
  };

  const byLevel = (lv: string) => rows.filter((r) => r.level === lv).length;

  const columns: ColumnsType<DeptRow> = [
    { title: '姓名', dataIndex: 'name', width: 100,
      render: (t: string) => <span style={{ fontWeight: 500 }}>{t}</span> },
    { title: '职级', dataIndex: 'level', width: 80, align: 'center',
      render: (t: string) => <Tag color={LEVEL_COLOR[t] || 'default'} style={{ margin: 0 }}>{t}</Tag> },
    { title: '岗位', dataIndex: 'post', width: 180, ellipsis: true,
      render: (t: string) => t || '-' },
    { title: '公司/部门', dataIndex: 'company', width: 150, ellipsis: true,
      render: (t: string) => t || '-' },
    { title: '手机号', dataIndex: 'phone', width: 125,
      render: (t: string) => t || '-' },
    { title: '所持证书', dataIndex: 'skill', width: 260,
      render: (t: string, r: DeptRow) => {
        const certs = splitCerts(t);
        return (
          <Space size={4} wrap>
            {certs.map((c) => <Tag key={c} color="cyan" style={{ margin: 0 }}>{c}</Tag>)}
            {editAllowed && (
              <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => { setCertEditing(r); setCertValues(splitCerts(r.skill)); }}
                style={{ padding: '0 4px', height: 22, fontSize: 12, color: certs.length ? 'rgba(99,102,241,0.75)' : '#6366f1' }}>
                {certs.length ? '加证书' : '添加证书'}
              </Button>
            )}
          </Space>
        );
      } },
    { title: '备注', dataIndex: 'note', width: 200, ellipsis: true,
      render: (t: string) => t || '-' },
    ...(deleteAllowed ? [{
      title: '', key: 'op', width: 44, align: 'center' as const,
      render: (_: unknown, r: DeptRow) => (
        <Popconfirm title={`删除「${r.name}」？`} onConfirm={async () => {
          const res = await fetch(`/api/rc/dept-members/${r.id}`, { method: 'DELETE', credentials: 'include' });
          const d = await res.json().catch(() => ({}));
          if (d.success) { message.success('已删除'); void load(); }
          else message.error(d.error || '删除失败');
        }} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 30 }} />
        </Popconfirm>
      ),
    }] : []),
  ];

  return (
    <div>
      {/* 统计卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { label: '总人数', value: rows.length, color: '#6366f1' },
          { label: 'P7', value: byLevel('P7'), color: '#dc2626' },
          { label: 'P6', value: byLevel('P6'), color: '#d97706' },
          { label: 'P5', value: byLevel('P5'), color: '#6366f1' },
          { label: 'P4', value: byLevel('P4'), color: '#16a34a' },
        ].map((c, i) => (
          <div key={i} style={{ background: 'linear-gradient(135deg,#f6f5fc,#f1f0fe)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 12, color: '#6b6892', marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>
      {/* 操作条 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
        {editAllowed && (
          <>
            <Upload accept=".json" showUploadList={false} beforeUpload={(f) => handleImport(f)}>
              <Button size="small" icon={<UploadOutlined />}>导入原工具部门库</Button>
            </Upload>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>添加人员</Button>
          </>
        )}
        <span style={{ color: '#9d9ab8', fontSize: 12, alignSelf: 'center' }}>
          <TeamOutlined /> 职级双轨：显示 P，库内 T；导入时自动归一（原工具同规则）
        </span>
      </div>
      <Table<DeptRow> rowKey="id" size="small" columns={columns} dataSource={rows} loading={loading} className="rc-edit-table"
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 人` }}
        locale={{ emptyText: <Empty description="暂无部门人员，导入原工具备份或手动添加" /> }} />

      <Modal title="添加部门人员" open={addOpen} onOk={handleAdd} onCancel={() => setAddOpen(false)} okText="添加" cancelText="取消">
        <Space direction="vertical" style={{ width: '100%', marginTop: 12 }} size={8}>
          <Space wrap={isMobile ? true : false}>
            <Input placeholder="姓名 *" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} style={{ width: 140 }} />
            <Select value={addForm.level} onChange={(v) => setAddForm({ ...addForm, level: v })} options={['P7', 'P6', 'P5', 'P4', 'P3'].map((v) => ({ value: v }))} style={{ width: 80 }} />
          </Space>
          <Input placeholder="岗位" value={addForm.post} onChange={(e) => setAddForm({ ...addForm, post: e.target.value })} />
          <Input placeholder="公司/部门" value={addForm.company} onChange={(e) => setAddForm({ ...addForm, company: e.target.value })} />
          <Input placeholder="手机号" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} />
          <Input placeholder="备注（工号/入职日期等）" value={addForm.note} onChange={(e) => setAddForm({ ...addForm, note: e.target.value })} />
        </Space>
      </Modal>

      {/* 证书编辑弹窗（部门库唯一的行级可修改项） */}
      <Modal
        title={certEditing ? `所持证书 · ${certEditing.name}` : ''}
        open={!!certEditing}
        onCancel={() => setCertEditing(null)}
        onOk={async () => {
          if (!certEditing) return;
          const res = await fetch(`/api/rc/dept-members/${certEditing.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ skill: certValues.join('、') }),
          });
          const d = await res.json().catch(() => ({}));
          if (d.success) {
            message.success('证书已更新');
            setCertEditing(null);
            void load();
          } else {
            message.error(d.error || '保存失败');
          }
        }}
        okText="保存" cancelText="取消"
      >
        <div style={{ marginTop: 12 }}>
          <Select
            mode="tags" style={{ width: '100%' }} placeholder="输入证书名称后回车添加，如：注册电气工程师、PMP、一级建造师"
            value={certValues} onChange={setCertValues}
            options={[
              '注册电气工程师', '注册公用设备工程师', '一级建造师', '二级建造师',
              'PMP', '电工证（高压）', '电工证（低压）', '安全员证', '消防设施操作员',
            ].map((v) => ({ value: v, label: v }))}
            open={false} // 纯自由输入（回车确认），预设项通过下拉箭头查看
          />
          <div style={{ color: '#9d9ab8', fontSize: 12, marginTop: 8 }}>
            点击输入框可查看常用证书预设；输入自定义名称后按回车添加。
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============== 自有资源库 Tab ==============

interface AssetRow {
  id: number; cat: string; name: string; spec: string; count: number; note: string;
}
const CAT_LABEL: Record<string, string> = { load: '假负载', ins: '仪器仪表', pdu: 'PDU', cabinet: '机柜' };
const CAT_COLOR: Record<string, string> = { load: 'orange', ins: 'blue', pdu: 'green', cabinet: 'purple' };

export function AssetsTab() {
  const { canEdit, canDelete } = useAuth();
  const isMobile = useIsMobile();
  const editAllowed = canEdit('resourceConfig');
  const deleteAllowed = canDelete('resourceConfig');
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rc/assets', { credentials: 'include' });
      const d = await res.json().catch(() => ({}));
      if (d.success) setRows(d.data);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const update = async (id: number, key: string, val: unknown) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: val } : r)));
    await fetch(`/api/rc/assets/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ [key]: val }),
    }).catch(() => message.error('保存失败'));
  };

  const handleAdd = async (vals: Record<string, unknown>) => {
    const res = await fetch('/api/rc/assets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(vals),
    });
    const d = await res.json();
    if (d.success) { message.success('已添加'); void load(); }
    else message.error(d.error || '添加失败');
  };

  const byCat = (c: string) => rows.filter((r) => r.cat === c);
  const totalCount = rows.reduce((s, r) => s + (r.count || 0), 0);

  const columns: ColumnsType<AssetRow> = [
    { title: '类别', dataIndex: 'cat', width: 100,
      render: (t: string, r: AssetRow) => <Select size="small" value={t} disabled={!editAllowed} style={{ width: 92 }}
        onChange={(v) => update(r.id, 'cat', v)}
        options={ASSET_CATEGORIES.map((c) => ({ value: c.value, label: <Tag color={CAT_COLOR[c.value]} style={{ margin: 0 }}>{c.label}</Tag> }))} /> },
    { title: '设备名称', dataIndex: 'name', width: 180,
      render: (t: string, r: AssetRow) => editAllowed
        ? <Input size="small" className="rc-cell-input" value={t} onChange={(e) => update(r.id, 'name', e.target.value)} /> : t },
    { title: '规格', dataIndex: 'spec', width: 180,
      render: (t: string, r: AssetRow) => editAllowed
        ? <Input size="small" className="rc-cell-input" value={t} onChange={(e) => update(r.id, 'spec', e.target.value)} /> : (t || '-') },
    { title: '数量', dataIndex: 'count', width: 110, align: 'center',
      render: (t: number, r: AssetRow) => editAllowed
        ? <InputNumber size="small" min={0} value={t} onChange={(v) => update(r.id, 'count', v ?? 0)} style={{ width: 90 }} />
        : t },
    { title: '备注', dataIndex: 'note', width: 200,
      render: (t: string, r: AssetRow) => editAllowed
        ? <Input size="small" className="rc-cell-input" value={t} onChange={(e) => update(r.id, 'note', e.target.value)} /> : (t || '-') },
    ...(deleteAllowed ? [{
      title: '', key: 'op', width: 44, align: 'center' as const,
      render: (_: unknown, r: AssetRow) => (
        <Popconfirm title={`删除「${r.name}」？`} onConfirm={async () => {
          const res = await fetch(`/api/rc/assets/${r.id}`, { method: 'DELETE', credentials: 'include' });
          const d = await res.json().catch(() => ({}));
          if (d.success) { message.success('已删除'); void load(); }
          else message.error(d.error || '删除失败');
        }} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 30 }} />
        </Popconfirm>
      ),
    }] : []),
  ];

  return (
    <div>
      {/* 统计卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { label: '设备种类', value: rows.length, color: '#6366f1' },
          { label: '设备总量', value: totalCount, color: '#6366f1' },
          ...ASSET_CATEGORIES.map((c) => ({ label: `${c.label}类`, value: byCat(c.value).length, color: '#16a34a' })),
        ].map((c, i) => (
          <div key={i} style={{ background: 'linear-gradient(135deg,#f6f5fc,#f1f0fe)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 12, color: '#6b6892', marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
        {editAllowed && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>添加设备</Button>}
        <span style={{ color: '#9d9ab8', fontSize: 12, alignSelf: 'center' }}>
          部门级自有资产，跨项目共用；规格中的功率数字（如 6KW）用于假负载/仪表的自动分配
        </span>
      </div>
      <Table<AssetRow> rowKey="id" size="small" columns={columns} dataSource={rows} loading={loading} className="rc-edit-table"
        pagination={false} locale={{ emptyText: <Empty description="暂无自有设备，点击添加" /> }} />
      <AddAssetModal open={addOpen} onClose={() => setAddOpen(false)} onOk={handleAdd} />
    </div>
  );
}

function AddAssetModal({ open, onClose, onOk }: { open: boolean; onClose: () => void; onOk: (vals: Record<string, unknown>) => Promise<void> }) {
  const [form] = Form.useForm();
  return (
    <Modal title="添加自有设备" open={open} onCancel={onClose}
      onOk={async () => {
        const v = await form.validateFields();
        await onOk(v); form.resetFields(); onClose();
      }} okText="添加" cancelText="取消">
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Space wrap>
          <Form.Item name="cat" label="类别" rules={[{ required: true }]} initialValue="load">
            <Select style={{ width: 110 }} options={ASSET_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
          </Form.Item>
          <Form.Item name="name" label="设备名称" rules={[{ required: true }]}><Input placeholder="机架式假负载6KW" style={{ width: 200 }} /></Form.Item>
        </Space>
        <Space wrap>
          <Form.Item name="spec" label="规格（含功率）"><Input placeholder="6KW/台 带电源线" style={{ width: 200 }} /></Form.Item>
          <Form.Item name="count" label="数量" initialValue={1}><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
        </Space>
        <Form.Item name="note" label="备注"><Input /></Form.Item>
      </Form>
    </Modal>
  );
}

// ============== 已完成项目（交付存档）Tab ==============

interface DeliveredRow {
  id: number; project_id: number; name: string; saved_at: string;
  mw: string; site: string; manager: string; test_days: number;
}

/** JSONB 兼容解析：驱动可能返回对象（pg）或字符串 */
function safeParse(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

export function DeliveredTab() {
  const [rows, setRows] = useState<DeliveredRow[]>([]);
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const [snapshot, setSnapshot] = useState<{ name: string; data: ResourceConfigProject } | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rc/delivered', { credentials: 'include' });
      const d = await res.json().catch(() => ({}));
      if (d.success) setRows(d.data);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const viewSnapshot = async (r: DeliveredRow) => {
    setSnapLoading(true);
    setSnapshot({ name: r.name, data: {} as ResourceConfigProject });
    try {
      // 列表接口不含 snapshot 大字段，走单条接口取完整快照（snapshot.data = 交付时点的完整配置）
      const res = await fetch(`/api/rc/delivered/${r.id}`, { credentials: 'include' });
      const d = await res.json().catch(() => ({}));
      let proj: unknown = null;
      if (d.success) {
        const snap = safeParse(d.data?.snapshot);
        proj = snap && typeof snap === 'object' ? (snap as Record<string, unknown>).data : null;
      }
      setSnapshot({ name: r.name, data: (proj || {}) as ResourceConfigProject });
    } finally { setSnapLoading(false); }
  };

  const columns: ColumnsType<DeliveredRow> = [
    { title: '项目名称', dataIndex: 'name', width: 240, render: (t: string) => <span style={{ color: '#16a34a', fontWeight: 500 }}>{t}</span> },
    { title: '规模', dataIndex: 'mw', width: 80, render: (t: string) => t || '-' },
    { title: '地点', dataIndex: 'site', width: 110, render: (t: string) => t || '-' },
    { title: '测试经理', dataIndex: 'manager', width: 100, render: (t: string) => t || '-' },
    { title: '测试天数', dataIndex: 'test_days', width: 90, align: 'center' },
    { title: '交付时间', dataIndex: 'saved_at', width: 150,
      render: (t: string) => t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '操作', key: 'op', width: 90, align: 'center',
      render: (_: unknown, r: DeliveredRow) => (
        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => viewSnapshot(r)} style={{ color: '#818cf8', width: 32 }} />
      ) },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
        <span style={{ color: '#9d9ab8', fontSize: 12, alignSelf: 'center' }}>
          交付时点的完整配置快照（只读），对应原工具「已完成项目」
        </span>
      </div>
      <Table<DeliveredRow> rowKey="id" size="small" columns={columns} dataSource={rows} loading={loading}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: <Empty description="暂无交付记录，在配置项目列表点「交付归档」生成快照" /> }} />

      <Modal title={snapshot ? `交付快照 · ${snapshot.name}` : ''} open={!!snapshot}
        onCancel={() => setSnapshot(null)} footer={<Button onClick={() => setSnapshot(null)}>关闭</Button>} width={isMobile ? 'calc(100vw - 24px)' : 640}>
        {snapLoading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div> : snapshot ? (
          <div>
            <Row gutter={[12, 12]}>
              <Col span={6} xs={12}><Statistic title="人员岗位" value={(snapshot.data.personnel || []).length} suffix="个" /></Col>
              <Col span={6} xs={12}><Statistic title="投入人员" value={(snapshot.data.staff || []).length} suffix="人" /></Col>
              <Col span={6} xs={12}><Statistic title="假负载类型" value={(snapshot.data.loads || []).length} suffix="种" /></Col>
              <Col span={6} xs={12}><Statistic title="仪表种类" value={(snapshot.data.instruments || []).length} suffix="种" /></Col>
              <Col span={8} xs={12}><Statistic title="劳务人天" value={Math.round((snapshot.data.labor || []).reduce((s, r) => s + calcLabor(r).manDays, 0) * 10) / 10} valueStyle={{ color: '#6366f1' }} /></Col>
              <Col span={8} xs={12}><Statistic title="总人天" value={(snapshot.data.staff || []).reduce((s, r) => s + (Number((r as any).survey) || 0) + (Number((r as any).retest) || 0) + (Number((r as any).test) || 0), 0)} valueStyle={{ color: '#6366f1' }} /></Col>
              <Col span={8} xs={12}><Statistic title="耗材类目" value={(snapshot.data.consumables || []).length} /></Col>
            </Row>
            <div style={{ marginTop: 16, color: '#6b6892', fontSize: 12 }}>
              快照为交付时点的只读数据；如需修改请回到对应配置项目（重新交付会生成新快照）。
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
