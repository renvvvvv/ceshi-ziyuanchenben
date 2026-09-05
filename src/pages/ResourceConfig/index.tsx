import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, DatePicker, Tag, message, Space,
  Upload, Drawer, Select, Statistic, Row, Col, Popconfirm, Tooltip, Empty, Spin, Tabs,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, UploadOutlined, DownloadOutlined, AppstoreOutlined, EyeOutlined,
  EditOutlined, DeleteOutlined, SendOutlined, ReloadOutlined, FileOutlined, FormOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { ResourceConfigProject, AssetLibItem } from '../../types/resourceConfig';
import { calcLabor, calcLoadAllocation, calcInstrumentAllocation, ASSET_CATEGORIES } from '../../types/resourceConfig';
import { DeptMembersTab, AssetsTab, DeliveredTab } from './tabs';

/** 列表行（后端列表接口不含 data 大字段） */
interface RcRow {
  id: number;
  name: string;
  mw: string;
  site: string;
  manager: string;
  test_days: number;
  start_date: string | null;
  end_date: string | null;
  remark: string;
  status: string;
  created_by: string;
  updated_at: string;
  personnel_count: number;
  staff_count: number;
  loads_count: number;
  instruments_count: number;
}

interface AssetRow {
  id: number;
  cat: string;
  name: string;
  spec: string;
  count: number;
  note: string;
}

const CAT_LABEL: Record<string, string> = { load: '假负载', ins: '仪器仪表', pdu: 'PDU', cabinet: '机柜' };
const CAT_COLOR: Record<string, string> = { load: 'orange', ins: 'blue', pdu: 'green', cabinet: 'purple' };

function ResourceConfig() {
  const navigate = useNavigate();
  const { canEdit, canDelete } = useAuth();
  const isMobile = useIsMobile();
  const editAllowed = canEdit('resourceConfig');
  const deleteAllowed = canDelete('resourceConfig');

  const [rows, setRows] = useState<RcRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RcRow | null>(null);
  const [detail, setDetail] = useState<{ row: RcRow; data: ResourceConfigProject } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [assetEditing, setAssetEditing] = useState<AssetRow | null>(null);
  const [form] = Form.useForm();
  const [assetForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rc/projects', { credentials: 'include' });
      const d = await res.json().catch(() => ({}));
      if (d.success && Array.isArray(d.data)) setRows(d.data);
      else if (res.status === 401) message.error('登录已失效');
    } catch {
      message.error('加载失败，请确认后端服务正常');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadAssets = useCallback(async () => {
    try {
      const res = await fetch('/api/rc/assets', { credentials: 'include' });
      const d = await res.json().catch(() => ({}));
      if (d.success && Array.isArray(d.data)) setAssets(d.data);
    } catch { /* ignore */ }
  }, []);

  // 资源库挂载即加载：概览的租赁缺口计算依赖它（修复：之前只在开抽屉时才加载，直接看概览会算成全租赁）
  useEffect(() => { void loadAssets(); }, [loadAssets]);

  // ===== 新建 / 编辑 =====
  const openCreate = () => { setEditing(null); form.resetFields(); setModalOpen(true); };
  const openEdit = (r: RcRow) => {
    setEditing(r);
    form.setFieldsValue({
      name: r.name, mw: r.mw, site: r.site, manager: r.manager, testDays: r.test_days,
      dateRange: (r.start_date && r.end_date) ? [dayjs(r.start_date), dayjs(r.end_date)] : undefined,
      remark: r.remark,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const v = await form.validateFields();
      const body = {
        name: v.name, mw: v.mw ?? '', site: v.site ?? '', manager: v.manager ?? '',
        test_days: v.testDays ?? 40,
        start_date: v.dateRange?.[0] ? v.dateRange[0].format('YYYY-MM-DD') : '',
        end_date: v.dateRange?.[1] ? v.dateRange[1].format('YYYY-MM-DD') : '',
        remark: v.remark ?? '',
      };
      const res = await fetch(editing ? `/api/rc/projects/${editing.id}` : '/api/rc/projects', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (d.success) {
        message.success(editing ? '已保存' : '已创建');
        setModalOpen(false);
        void load();
      } else {
        message.error(d.error || '保存失败');
      }
    } catch { /* validation */ }
  };

  // ===== 导入（原工具 JSON 备份） =====
  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch('/api/rc/projects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(json),
      });
      const d = await res.json().catch(() => ({}));
      if (d.success) {
        message.success(`已导入「${d.name}」，可在列表中查看`);
        void load();
      } else {
        message.error(d.error || '导入失败：文件格式不正确');
      }
    } catch {
      message.error('文件解析失败，请确认是原工具导出的 JSON 备份');
    }
    return false;
  };

  // ===== 导出（兼容原工具格式） =====
  const handleExport = async (r: RcRow) => {
    try {
      const res = await fetch(`/api/rc/projects/${r.id}`, { credentials: 'include' });
      const d = await res.json();
      if (!d.success) { message.error(d.error || '获取详情失败'); return; }
      const row = d.data;
      const data = row.data || {};
      const exportObj = {
        app: '测试项目资源配置工具',
        version: 1,
        exportTime: new Date().toISOString(),
        project: {
          id: `exp${row.id}`,
          name: row.name, mw: row.mw, site: row.site, manager: row.manager,
          testDays: row.test_days, startDate: row.start_date || '', endDate: row.end_date || '',
          remark: row.remark || '',
          personnel: data.personnel || [], staff: data.staff || [], subsidy: data.subsidy || [],
          external: data.external || [], assets: [], loads: data.loads || [],
          instruments: data.instruments || [], consumables: data.consumables || [],
          labor: data.labor || [], safety: data.safety || [], cert: data.cert || {},
        },
      };
      const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${row.name}_资源配置_${dayjs().format('YYYYMMDD')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      message.error('导出失败');
    }
  };

  // ===== 交付 =====
  const handleDeliver = async (r: RcRow) => {
    try {
      const res = await fetch(`/api/rc/projects/${r.id}/deliver`, { method: 'POST', credentials: 'include' });
      const d = await res.json();
      if (d.success) { message.success(`「${r.name}」已归档交付快照`); void load(); }
      else message.error(d.error || '交付失败');
    } catch { message.error('交付失败'); }
  };

  // ===== 删除 =====
  const handleDelete = async (r: RcRow) => {
    try {
      const res = await fetch(`/api/rc/projects/${r.id}`, { method: 'DELETE', credentials: 'include' });
      const d = await res.json();
      if (d.success) { message.success('已删除'); void load(); }
      else message.error(d.error || '删除失败');
    } catch { message.error('删除失败'); }
  };

  // ===== 详情概览 =====
  const openDetail = async (r: RcRow) => {
    setDetailLoading(true);
    setDetail({ row: r, data: {} as ResourceConfigProject });
    try {
      const res = await fetch(`/api/rc/projects/${r.id}`, { credentials: 'include' });
      const d = await res.json();
      if (d.success) setDetail({ row: r, data: (d.data.data || {}) as ResourceConfigProject });
    } finally {
      setDetailLoading(false);
    }
  };

  /** 概览计算（复用 resourceConfig.ts 的同步算法） */
  const overview = useMemo(() => {
    if (!detail) return null;
    const p = detail.data;
    const assetsForCalc: AssetLibItem[] = assets.map((a) => ({
      id: String(a.id), cat: a.cat as AssetLibItem['cat'], name: a.name, spec: a.spec, count: a.count, note: a.note,
    }));
    const laborRes = (p.labor || []).map((r) => calcLabor(r));
    const laborManDays = laborRes.reduce((s, r) => s + r.manDays, 0);
    const laborWorkers = laborRes.reduce((s, r) => s + r.workers, 0);
    const loadAlloc = calcLoadAllocation(p.loads || [], assetsForCalc);
    const loadRent = Object.values(loadAlloc).reduce((s, r) => s + r.rent, 0);
    const insAlloc = calcInstrumentAllocation(p.instruments || [], assetsForCalc);
    const insRent = Object.values(insAlloc).reduce((s, r) => s + r.rent, 0);
    const round1 = (v: number) => Math.round(v * 10) / 10;
    return {
      personnel: (p.personnel || []).length,
      staff: (p.staff || []).length,
      loads: (p.loads || []).length,
      instruments: (p.instruments || []).length,
      laborManDays: round1(laborManDays),
      laborWorkers: Math.round(laborWorkers),
      loadRent: round1(loadRent),
      insRent: Math.round(insRent),
    };
  }, [detail, assets]);

  const columns: ColumnsType<RcRow> = [
    { title: '项目名称', dataIndex: 'name', width: 220, ellipsis: true,
      render: (t: string, r: RcRow) => (
        <a onClick={() => navigate(`/resource-config/${r.id}`)} style={{ color: '#818cf8', fontWeight: 500 }}>{t}</a>
      ) },
    { title: '规模', dataIndex: 'mw', width: 80, render: (t: string) => t || '-' },
    { title: '地点', dataIndex: 'site', width: 100, render: (t: string) => t || '-' },
    { title: '测试经理', dataIndex: 'manager', width: 100, render: (t: string) => t || '-' },
    { title: '测试天数', dataIndex: 'test_days', width: 90, align: 'center' },
    { title: '周期', key: 'range', width: 200,
      render: (_: unknown, r: RcRow) => r.start_date ? `${r.start_date} ~ ${r.end_date || '未定'}` : '-' },
    { title: '模块概览', key: 'modules', width: 220,
      render: (_: unknown, r: RcRow) => (
        <Space size={4} wrap>
          <Tag style={{ margin: 0 }}>人员 {r.personnel_count}</Tag>
          <Tag style={{ margin: 0 }}>投入 {r.staff_count}</Tag>
          <Tag style={{ margin: 0 }}>负载 {r.loads_count}</Tag>
          <Tag style={{ margin: 0 }}>仪表 {r.instruments_count}</Tag>
        </Space>
      ) },
    { title: '状态', dataIndex: 'status', width: 90, align: 'center',
      render: (t: string) => <Tag color={t === '已交付' ? 'success' : 'processing'} style={{ margin: 0 }}>{t}</Tag> },
    { title: '更新时间', dataIndex: 'updated_at', width: 110,
      render: (t: string) => t ? dayjs(t).format('MM-DD HH:mm') : '-' },
    { title: '操作', key: 'action', width: 190, align: 'center',
      render: (_: unknown, r: RcRow) => (
        <Space size={0}>
          <Tooltip title="查看概览"><Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r)} style={{ color: '#818cf8', width: 32 }} /></Tooltip>
          <Tooltip title="编辑明细"><Button type="text" size="small" icon={<FormOutlined />} onClick={() => navigate(`/resource-config/${r.id}`)} style={{ color: '#a855f7', width: 32 }} /></Tooltip>
          {editAllowed && <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} style={{ color: '#d97706', width: 32 }} /></Tooltip>}
          {editAllowed && <Tooltip title="导出 JSON（兼容原工具）"><Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => handleExport(r)} style={{ color: '#16a34a', width: 32 }} /></Tooltip>}
          {editAllowed && r.status !== '已交付' && (
            <Popconfirm title="归档交付快照？" description="将当前配置快照存入交付存档，状态转为已交付" onConfirm={() => handleDeliver(r)} okText="确认" cancelText="取消">
              <Tooltip title="交付归档"><Button type="text" size="small" icon={<SendOutlined />} style={{ color: '#6366f1', width: 32 }} /></Tooltip>
            </Popconfirm>
          )}
          {deleteAllowed && (
            <Popconfirm title="确认删除" description={`删除「${r.name}」？此操作不可撤销。`} onConfirm={() => handleDelete(r)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
              <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 32 }} /></Tooltip>
            </Popconfirm>
          )}
        </Space>
      ) },
  ];

  // ===== 资源库 =====
  const openAssets = () => { setAssetsOpen(true); void loadAssets(); };
  const handleAssetSave = async () => {
    try {
      const v = await assetForm.validateFields();
      const res = await fetch(assetEditing ? `/api/rc/assets/${assetEditing.id}` : '/api/rc/assets', {
        method: assetEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(v),
      });
      const d = await res.json();
      if (d.success) {
        message.success('已保存');
        setAssetEditing(null);
        assetForm.resetFields();
        void loadAssets();
      } else message.error(d.error || '保存失败');
    } catch { /* validation */ }
  };
  const handleAssetDelete = async (a: AssetRow) => {
    try {
      const res = await fetch(`/api/rc/assets/${a.id}`, { method: 'DELETE', credentials: 'include' });
      const d = await res.json();
      if (d.success) { message.success('已删除'); void loadAssets(); }
      else message.error(d.error || '删除失败');
    } catch { message.error('删除失败'); }
  };

  const stats = useMemo(() => ({
    total: rows.length,
    configuring: rows.filter((r) => r.status === '配置中').length,
    delivered: rows.filter((r) => r.status === '已交付').length,
  }), [rows]);

  return (
    <div style={{ padding: '0 4px' }}>
      <Tabs
        defaultActiveKey="projects"
        items={[
          { key: 'projects', label: `配置项目（${rows.length}）`, children: (
    <div>
      {/* 顶部操作条 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <AppstoreOutlined style={{ color: '#6366f1', fontSize: 18 }} />
        <span style={{ fontSize: 16, fontWeight: 600, color: '#1e1b2e' }}>测试资源配置</span>
        <Tag style={{ margin: 0 }}>共 {stats.total}</Tag>
        <Tag color="processing" style={{ margin: 0 }}>配置中 {stats.configuring}</Tag>
        <Tag color="success" style={{ margin: 0 }}>已交付 {stats.delivered}</Tag>
        <div style={{ flex: 1 }} />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} style={{ borderRadius: 8 }}>刷新</Button>
        <Button icon={<AppstoreOutlined />} onClick={openAssets} style={{ borderRadius: 8 }}>自有资源库（{assets.length || '…'}）</Button>
        {editAllowed && (
          <Upload accept=".json" showUploadList={false} beforeUpload={(f) => handleImport(f)}>
            <Button icon={<UploadOutlined />} style={{ borderRadius: 8 }}>导入原工具备份</Button>
          </Upload>
        )}
        {editAllowed && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 8 }}>新建配置</Button>}
      </div>

      {/* 列表 */}
      <Table<RcRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={loading}
        size="middle"
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
        locale={{ emptyText: <Empty description={editAllowed ? '暂无配置项目，点击"新建配置"或导入原工具备份' : '暂无配置项目'} /> }}
      />

      {/* 新建/编辑弹窗 */}
      <Modal
        title={editing ? `编辑配置 · ${editing.name}` : '新建资源配置'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 24px)' : 560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col span={12} xs={24}><Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}><Input placeholder="如：乌兰大三期B1" /></Form.Item></Col>
            <Col span={6} xs={12}><Form.Item name="mw" label="规模(MW)"><Input placeholder="如 19" /></Form.Item></Col>
            <Col span={6} xs={12}><Form.Item name="site" label="地点"><Input placeholder="乌兰察布" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12} xs={24}><Form.Item name="manager" label="测试经理"><Input /></Form.Item></Col>
            <Col span={6} xs={12}><Form.Item name="testDays" label="测试天数" initialValue={40}><InputNumber min={1} max={365} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6} xs={24}><Form.Item name="dateRange" label="测试周期"><DatePicker.RangePicker style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} placeholder="可选" /></Form.Item>
          <div style={{ color: '#6b6892', fontSize: 12 }}>
            人员/负载/仪表等明细在创建后通过"导入原工具备份"带入，或等待明细编辑功能上线。
          </div>
        </Form>
      </Modal>

      {/* 详情概览弹窗 */}
      <Modal
        title={detail ? `配置概览 · ${detail.row.name}` : ''}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
        width={isMobile ? 'calc(100vw - 24px)' : 640}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : overview ? (
          <div>
            <Row gutter={[12, 12]}>
              <Col span={6} xs={12}><Statistic title="人员岗位" value={overview.personnel} suffix="个" /></Col>
              <Col span={6} xs={12}><Statistic title="投入明细" value={overview.staff} suffix="人" /></Col>
              <Col span={6} xs={12}><Statistic title="假负载类型" value={overview.loads} suffix="种" /></Col>
              <Col span={6} xs={12}><Statistic title="仪表种类" value={overview.instruments} suffix="种" /></Col>
              <Col span={6} xs={12}><Statistic title="劳务人天合计" value={overview.laborManDays} suffix="人天" valueStyle={{ color: '#6366f1' }} /></Col>
              <Col span={6} xs={12}><Statistic title="劳务人数合计" value={overview.laborWorkers} suffix="人" valueStyle={{ color: '#6366f1' }} /></Col>
              <Col span={6} xs={12}><Statistic title="假负载需租赁" value={overview.loadRent} suffix="台" valueStyle={{ color: '#d97706' }} /></Col>
              <Col span={6} xs={12}><Statistic title="仪表需租赁" value={overview.insRent} suffix="台" valueStyle={{ color: '#d97706' }} /></Col>
            </Row>
            <div style={{ marginTop: 16, color: '#6b6892', fontSize: 12 }}>
              租赁数为按自有资源库（部门级）自动分配后的缺口。明细编辑界面将在下一版本提供。
            </div>
          </div>
        ) : <Empty description="暂无数据" />}
      </Modal>

      {/* 自有资源库抽屉 */}
      <Drawer
        title="自有资源库（部门级）"
        open={assetsOpen}
        onClose={() => { setAssetsOpen(false); setAssetEditing(null); }}
        width={isMobile ? '100%' : 560}
      >
        {editAllowed && (assetEditing || !assetEditing) && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f6f5fc', borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#1e1b2e' }}>
              {assetEditing ? `编辑 · ${assetEditing.name}` : '新增资源'}
            </div>
            <Form form={assetForm} layout="inline" style={{ rowGap: 8 }}>
              <Form.Item name="cat" rules={[{ required: true, message: '类别' }]} style={{ width: 100 }}>
                <Select placeholder="类别" options={ASSET_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
              </Form.Item>
              <Form.Item name="name" rules={[{ required: true, message: '名称' }]} style={{ width: 130 }}>
                <Input placeholder="设备名称" />
              </Form.Item>
              <Form.Item name="spec" style={{ width: 120 }}><Input placeholder="规格（含KW）" /></Form.Item>
              <Form.Item name="count" rules={[{ required: true, message: '数量' }]} style={{ width: 80 }}>
                <InputNumber min={0} placeholder="数量" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="note" style={{ width: 80 }}><Input placeholder="备注" /></Form.Item>
            </Form>
            <Space style={{ marginTop: 8 }}>
              <Button type="primary" size="small" onClick={handleAssetSave}>{assetEditing ? '更新' : '添加'}</Button>
              {assetEditing && <Button size="small" onClick={() => { setAssetEditing(null); assetForm.resetFields(); }}>取消编辑</Button>}
            </Space>
          </div>
        )}
        <Table<AssetRow>
          rowKey="id"
          size="small"
          dataSource={assets}
          pagination={false}
          columns={[
            { title: '类别', dataIndex: 'cat', width: 90, render: (t: string) => <Tag color={CAT_COLOR[t]} style={{ margin: 0 }}>{CAT_LABEL[t] || t}</Tag> },
            { title: '名称', dataIndex: 'name', width: 140 },
            { title: '规格', dataIndex: 'spec', width: 120, render: (t: string) => t || '-' },
            { title: '数量', dataIndex: 'count', width: 70, align: 'center' },
            { title: '操作', key: 'op', width: 90, align: 'center',
              render: (_: unknown, a: AssetRow) => editAllowed ? (
                <Space size={0}>
                  <Button type="text" size="small" icon={<EditOutlined />} onClick={() => {
                    setAssetEditing(a);
                    assetForm.setFieldsValue({ cat: a.cat, name: a.name, spec: a.spec, count: a.count, note: a.note });
                  }} style={{ color: '#d97706', width: 30 }} />
                  {deleteAllowed && (
                    <Popconfirm title="删除该资源？" onConfirm={() => handleAssetDelete(a)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 30 }} />
                    </Popconfirm>
                  )}
                </Space>
              ) : '-' },
          ]}
        />
        <div style={{ marginTop: 12, color: '#6b6892', fontSize: 12 }}>
          <FileOutlined /> 规格中的功率数字（如 6KW）会被自动识别，用于假负载的自有/租赁分配。
        </div>
      </Drawer>
    </div>
          )},
          { key: 'dept', label: '部门人员库', children: <DeptMembersTab /> },
          { key: 'assets', label: '自有资源库', children: <AssetsTab /> },
          { key: 'delivered', label: '已完成项目', children: <DeliveredTab /> },
        ]}
      />
    </div>
  );
}

export default ResourceConfig;
