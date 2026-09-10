/**
 * 资源配置 · 原生工作台（React 版，替代 iframe 嵌入）
 * 单路由内层导航十四个页面；数据经 useRcStore 与云端 /api/rc/store 双向同步。
 */
import { useMemo, useState } from 'react';
import { Card, Select, Button, Space, Modal, Input, message, Popconfirm, Menu, Typography, Spin, Tag } from 'antd';
import {
  PlusOutlined, CopyOutlined, DeleteOutlined, EditOutlined,
  CloudUploadOutlined, CloudServerOutlined, DisconnectOutlined, StopOutlined,
} from '@ant-design/icons';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useAuth } from '../../store/AuthContext';
import { useRcStore } from './store';
import { uid } from './types';
import type { RcProject } from './types';

import InfoPage from './pages/InfoPage';
import PersonnelPage from './pages/PersonnelPage';
import StaffPage from './pages/StaffPage';
import SubsidyPage from './pages/SubsidyPage';
import ExternalPage from './pages/ExternalPage';
import LoadsPage from './pages/LoadsPage';
import InstrumentsPage from './pages/InstrumentsPage';
import ConsumablesPage from './pages/ConsumablesPage';
import LaborPage from './pages/LaborPage';
import SafetyPage from './pages/SafetyPage';
import DeptLibPage from './pages/DeptLibPage';
import AssetsLibPage from './pages/AssetsLibPage';
import DeliveredPage from './pages/DeliveredPage';
import SummaryPage from './pages/SummaryPage';

const NAV = [
  { key: 'info', label: '项目信息' },
  { type: 'group' as const, label: '资源配置' },
  { key: 'personnel', label: '人员组织' },
  { key: 'staff', label: '测试人员' },
  { key: 'subsidy', label: '岗位与补贴' },
  { key: 'external', label: '外部人员' },
  { key: 'loads', label: '假负载计划' },
  { key: 'instruments', label: '仪器仪表' },
  { key: 'consumables', label: '现场耗材' },
  { key: 'labor', label: '劳务人员' },
  { key: 'safety', label: '劳保用品' },
  { type: 'group' as const, label: '资源库' },
  { key: 'deptlib', label: '部门人员库' },
  { key: 'assetslib', label: '自有资源库' },
  { key: 'delivered', label: '已交付存档' },
  { key: 'summary', label: '汇总报告' },
];

export default function ResourceConfig() {
  const isMobile = useIsMobile();
  const { canEdit } = useAuth();
  const store = useRcStore();
  const [page, setPage] = useState('info');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const editable = canEdit('resourceConfig');

  const projects = store.config.projects;
  const projectList = useMemo(() => Object.values(projects), [projects]);
  const cur = store.currentProject;

  const newProject = () => {
    let name = '新建测试项目';
    Modal.confirm({
      title: '新建项目',
      content: <Input defaultValue={name} onChange={e => { name = e.target.value; }} placeholder="项目名称" />,
      onOk: () => {
        const finalName = name.trim() || '新建测试项目';
        const id = uid();
        const p: RcProject = {
          id, name: finalName, mw: '', site: '乌兰察布', manager: '', testDays: 40,
          startDate: '', endDate: '', remark: '',
          personnel: [], staff: [], subsidy: [], external: [],
          loads: [], instruments: [], consumables: [], labor: [], safety: [],
        };
        store.updateConfig({ projects: { ...store.config.projects, [id]: p }, currentId: id });
        message.success('已创建项目：' + finalName);
      },
    });
  };
  const copyProject = () => {
    if (!cur) return;
    let name = cur.name + '（副本）';
    Modal.confirm({
      title: '复制当前项目',
      content: <Input defaultValue={name} onChange={e => { name = e.target.value; }} />,
      onOk: () => {
        const id = uid();
        const p = { ...JSON.parse(JSON.stringify(cur)), id, name: name.trim() || cur.name + '（副本）' } as RcProject;
        store.updateConfig({ projects: { ...store.config.projects, [id]: p }, currentId: id });
        message.success('已复制');
      },
    });
  };
  const delProject = () => {
    if (!cur) return;
    const rest = { ...projects };
    delete rest[cur.id];
    store.updateConfig({ projects: rest, currentId: Object.keys(rest)[0] || '' });
    message.success('已删除项目：' + cur.name);
  };

  const cloudTag = {
    ok: <Tag icon={<CloudServerOutlined />} color="success">已同步云端</Tag>,
    pushing: <Tag icon={<CloudUploadOutlined />} color="processing">同步中…</Tag>,
    off: <Tag icon={<DisconnectOutlined />} color="warning">云端不可达·本地缓存</Tag>,
    forbid: <Tag icon={<StopOutlined />} color="error">当前角色无云端写入权</Tag>,
    idle: <Tag color="default">…</Tag>,
  }[store.cloud];

  if (!store.ready) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin tip="正在从云端加载资源配置数据…" /></div>;
  }

  const pages: Record<string, React.ReactNode> = {
    info: <InfoPage store={store} />,
    personnel: <PersonnelPage store={store} />,
    staff: <StaffPage store={store} />,
    subsidy: <SubsidyPage store={store} />,
    external: <ExternalPage store={store} />,
    loads: <LoadsPage store={store} />,
    instruments: <InstrumentsPage store={store} />,
    consumables: <ConsumablesPage store={store} />,
    labor: <LaborPage store={store} />,
    safety: <SafetyPage store={store} />,
    deptlib: <DeptLibPage store={store} />,
    assetslib: <AssetsLibPage store={store} />,
    delivered: <DeliveredPage store={store} />,
    summary: <SummaryPage store={store} />,
  };

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
      {/* 内层导航（桌面）；移动端用顶部下拉 */}
      {!isMobile && (
        <Card size="small" style={{ width: 168, flexShrink: 0, alignSelf: 'flex-start' }} styles={{ body: { padding: 4 } }}>
          <Menu
            mode="inline" selectedKeys={[page]} onClick={({ key }) => setPage(String(key))}
            style={{ border: 'none', background: 'transparent' }}
            items={NAV.map((n, i) => n.type === 'group'
              ? { key: 'g' + i, type: 'group' as const, label: <span style={{ fontSize: 11, color: '#9d9ab8' }}>{n.label}</span> }
              : { key: n.key!, label: n.label })}
          />
        </Card>
      )}
      {isMobile && (
        <Select value={page} onChange={setPage} style={{ marginBottom: 10 }} popupMatchSelectWidth={false}
          options={NAV.filter(n => !n.type).map(n => ({ value: n.key!, label: n.label }))} />
      )}

      {/* 主区 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Card size="small" style={{ marginBottom: 10 }}>
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space wrap>
              <Select
                value={store.config.currentId || undefined}
                onChange={id => store.updateConfig({ ...store.config, currentId: id })}
                style={{ minWidth: 200 }}
                placeholder={projectList.length ? '选择项目' : '暂无项目'}
                options={projectList.map(p => ({ value: p.id, label: p.name }))}
              />
              {editable && (
                <>
                  <Button size="small" icon={<PlusOutlined />} onClick={newProject}>新建</Button>
                  <Button size="small" icon={<CopyOutlined />} disabled={!cur} onClick={copyProject}>复制</Button>
                  <Button size="small" icon={<EditOutlined />} disabled={!cur}
                    onClick={() => { setRenameVal(cur!.name); setRenameOpen(true); }}>重命名</Button>
                  <Popconfirm title="删除当前项目？" onConfirm={delProject} disabled={!cur}>
                    <Button size="small" danger icon={<DeleteOutlined />} disabled={!cur}>删除</Button>
                  </Popconfirm>
                </>
              )}
            </Space>
            {cloudTag}
          </Space>
        </Card>

        {cur || ['deptlib', 'assetslib', 'delivered', 'summary'].includes(page) ? pages[page]
          : <Card><Typography.Text type="secondary">请先选择或新建项目</Typography.Text></Card>}
      </div>

      <Modal open={renameOpen} title="重命名项目" onOk={() => {
        if (cur && renameVal.trim()) store.patchProject({ name: renameVal.trim() });
        setRenameOpen(false);
      }} onCancel={() => setRenameOpen(false)}>
        <Input value={renameVal} onChange={e => setRenameVal(e.target.value)} />
      </Modal>
    </div>
  );
}
