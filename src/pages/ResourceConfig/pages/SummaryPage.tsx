/**
 * 资源配置 · 汇总报告（全项目，不依赖当前项目）
 * 复刻原工具 renderSummary / deliveredSummary（app.js L3514-3654）之平台版裁剪：
 *  - 对 store.config.projects 每个项目渲染一块汇总：五项关键指标 Statistic 小卡
 *    （投入人天/假负载/仪器仪表/耗材类数/劳务人天）+ 仪器仪表需租赁台数（红色标注，
 *    = computeInsAllocation(p.instruments, store.assets) 的 rent 求和）；
 *  - 顶部工具条：导出全部项目 JSON（Blob + a 下载）/ 导入 JSON（file input + Modal.confirm 覆盖）。
 */
import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { Button, Card, Col, Empty, Modal, Row, Space, Statistic, Tag, Tooltip, Typography, message } from 'antd';
import { BarChartOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useAuth } from '../../../store/AuthContext';
import { computeInsAllocation, deliveredSummary } from '../calc';
import type { RcStore } from '../store';
import { num } from '../types';
import type { ProjectConfig, RcAsset, RcProject } from '../types';

/** 数值展示：最多 1 位小数去尾零 */
const fmt1 = (v: number): number | string => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? r : r.toFixed(1);
};

/** 单项目汇总块：项目名 + 六张 Statistic 小卡（五项指标 + 需租赁台数红色） */
function ProjectSummaryCard({ p, assets }: { p: RcProject; assets: RcAsset[] }) {
  const s = deliveredSummary(p);
  const insRent = computeInsAllocation(p.instruments || [], assets).reduce((t, a) => t + a.rent, 0);
  const items: { label: string; value: number | string; suffix: string; red?: boolean }[] = [
    { label: '投入人天', value: fmt1(s.manDays), suffix: '人天' },
    { label: '假负载', value: fmt1(s.loadQty), suffix: '台' },
    { label: '仪器仪表', value: fmt1(s.insQty), suffix: '台' },
    { label: '耗材类数', value: fmt1(s.consCat), suffix: '类' },
    { label: '劳务人天', value: fmt1(s.laborDays), suffix: '人天' },
    { label: '仪器仪表需租赁', value: fmt1(insRent), suffix: '台', red: true },
  ];
  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={(
        <Space size={8} wrap>
          <span style={{ fontWeight: 600 }}>{p.name || '（未命名项目）'}</span>
          {(p.mw !== '' && p.mw != null) && <Tag style={{ margin: 0 }} color="geekblue">{p.mw} MW</Tag>}
        </Space>
      )}
      extra={(
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {p.manager ? `测试经理 ${p.manager} · ` : ''}计划 {num(p.testDays)} 天 · {p.startDate || '—'} ~ {p.endDate || '—'}
        </Typography.Text>
      )}
    >
      <Row gutter={[10, 10]}>
        {items.map(it => (
          <Col key={it.label} xs={12} sm={8} lg={4}>
            <div
              style={{
                borderRadius: 8, padding: '10px 14px',
                background: it.red ? 'rgba(220,38,38,0.06)' : 'rgba(99,102,241,0.06)',
                border: `1px solid ${it.red ? 'rgba(220,38,38,0.35)' : 'rgba(99,102,241,0.28)'}`,
              }}
            >
              <Statistic
                title={<span style={{ fontSize: 12 }}>{it.label}</span>}
                value={it.value}
                suffix={it.suffix}
                valueStyle={{ fontSize: 20, fontWeight: 700, color: it.red ? '#dc2626' : '#6366f1' }}
              />
            </div>
          </Col>
        ))}
      </Row>
    </Card>
  );
}

export default function SummaryPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const fileRef = useRef<HTMLInputElement>(null);
  const projects = Object.values(store.config.projects);

  /** 导出全部项目完整配置（store.config 原样 JSON） */
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(store.config, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '资源配置-全部项目.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    message.success(`已导出 ${projects.length} 个项目的完整配置`);
  };

  /** 导入 JSON：解析校验后 Modal.confirm 确认覆盖 store.updateConfig */
  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';                       // 允许重复选择同一文件
    if (!f) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await f.text());
    } catch {
      message.error('JSON 解析失败，请检查文件内容');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      message.error('文件格式不正确');
      return;
    }
    const rec = parsed as { projects?: unknown; currentId?: unknown };
    if (typeof rec.projects !== 'object' || rec.projects === null || Array.isArray(rec.projects)) {
      message.error('文件格式不正确：缺少 projects 字段');
      return;
    }
    const keys = Object.keys(rec.projects);
    if (!keys.length) {
      message.warning('文件中没有任何项目');
      return;
    }
    const currentId = typeof rec.currentId === 'string' && rec.currentId in rec.projects ? rec.currentId : keys[0];
    const count = Object.keys(store.config.projects).length;
    Modal.confirm({
      title: '确认导入并覆盖当前配置？',
      content: `文件包含 ${keys.length} 个项目，导入后将覆盖当前全部 ${count} 个项目，此操作不可撤销。`,
      okText: '覆盖导入',
      okButtonProps: { danger: true },
      onOk: () => {
        store.updateConfig({ projects: rec.projects as ProjectConfig['projects'], currentId });
        message.success(`导入成功：共 ${keys.length} 个项目`);
      },
    });
  };

  return (
    <Card
      size="small"
      title={(
        <Space size={8}>
          <BarChartOutlined style={{ color: '#6366f1' }} />
          <span>汇总报告</span>
          <Tag style={{ margin: 0 }}>全部 {projects.length} 个项目</Tag>
        </Space>
      )}
      extra={(
        <Space size={8}>
          <Button size="small" icon={<DownloadOutlined />} onClick={exportJson}>导出 JSON</Button>
          <Tooltip title={!editable ? '当前角色无编辑权限' : undefined}>
            <span>
              <Button size="small" icon={<UploadOutlined />} disabled={!editable} onClick={() => fileRef.current?.click()}>
                导入 JSON
              </Button>
            </span>
          </Tooltip>
        </Space>
      )}
    >
      <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />

      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 14 }}>
        按项目汇总投入人天、假负载、仪器仪表、耗材与劳务五大指标；「仪器仪表需租赁」按自有资源库自动核算（红色标注）。
      </Typography.Paragraph>

      {projects.length === 0
        ? <Empty description="暂无项目 —— 请先新建项目或导入配置" style={{ padding: 40 }} />
        : projects.map(p => <ProjectSummaryCard key={p.id} p={p} assets={store.assets} />)}
    </Card>
  );
}
