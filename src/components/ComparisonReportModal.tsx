import { useState, useMemo } from 'react';
import { Modal, Table, Button, Select, Space, Tag, Card, Row, Col, Statistic, Empty, Divider, Descriptions, Progress, message } from 'antd';
import {
  SwapOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  MinusOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  TeamOutlined,
  AreaChartOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Project, HistoricalProject } from '../types';

interface ComparisonReportModalProps {
  open: boolean;
  currentProjects: Project[];
  historyProjects: HistoricalProject[];
  onClose: () => void;
}

/** 计算项目周期天数 */
function calcDays(start: string, end: string): number {
  if (!start || !end) return 0;
  return Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24));
}

/** 计算交付准时率 */
function calcOnTimeRate(planned?: string, actual?: string): string | null {
  if (!actual) return null;
  if (!planned) return '未知';
  if (actual <= planned) return '提前或准时';
  return '延期';
}

/** 计算交付周期天数（计划交付日期 vs 实际交付日期） */
function calcDeliveryDays(planned?: string, actual?: string): number | null {
  if (!planned || !actual) return null;
  return Math.ceil((new Date(actual).getTime() - new Date(planned).getTime()) / (1000 * 60 * 60 * 24));
}

/** 差异百分比 */
function diffPercent(a: number, b: number): string {
  if (!a || !b) return '-';
  const diff = ((a - b) / b) * 100;
  if (diff > 0) return `+${diff.toFixed(1)}%`;
  return `${diff.toFixed(1)}%`;
}

/** 差异方向 */
function DiffArrow({ value }: { value: number }) {
  if (value === 0) return <MinusOutlined style={{ color: '#9d9ab8', fontSize: 11 }} />;
  if (value > 0) return <ArrowUpOutlined style={{ color: '#dc2626', fontSize: 11 }} />;
  return <ArrowDownOutlined style={{ color: '#16a34a', fontSize: 11 }} />;
}

const statusMap: Record<string, { color: string; label: string }> = {
  '未开始': { color: '#d97706', label: '未开始' },
  '测试中': { color: '#6366f1', label: '测试中' },
  '已完成': { color: '#16a34a', label: '已完成' },
  '阻塞': { color: '#dc2626', label: '阻塞' },
};

function ComparisonReportModal({ open, currentProjects, historyProjects, onClose }: ComparisonReportModalProps) {
  const [selectedCurrentId, setSelectedCurrentId] = useState<string>('');
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [reportGenerated, setReportGenerated] = useState(false);

  // 已交付的历史项目（排除非已完成的）
  const deliveredHistory = useMemo(
    () => historyProjects.filter((h) => h.status === '已完成'),
    [historyProjects]
  );

  // 选中的当前项目
  const selectedCurrent = useMemo(() =>
    currentProjects.find((p) => p.id === selectedCurrentId),
    [currentProjects, selectedCurrentId]
  );

  // 选中的历史项目
  const selectedHistoryItems = useMemo(() =>
    deliveredHistory.filter((h) => selectedHistoryIds.includes(h.id)),
    [deliveredHistory, selectedHistoryIds]
  );

  // 生成对比报告
  const handleGenerateReport = () => {
    if (!selectedCurrentId) {
      message.warning('请选择一个进行中的项目');
      return;
    }
    if (selectedHistoryIds.length === 0) {
      message.warning('请至少选择一个历史已交付项目');
      return;
    }
    setReportGenerated(true);
    message.success('比对报告生成成功');
  };

  // 重置
  const handleReset = () => {
    setSelectedCurrentId('');
    setSelectedHistoryIds([]);
    setReportGenerated(false);
  };

  type HistoryRow = HistoricalProject & { _key: string; _simCity: boolean; _simCustomer: boolean; _simType: boolean };

// 历史项目统计汇总
  const historyStats = useMemo(() => {
    if (selectedHistoryItems.length === 0) return null;
    const items = selectedHistoryItems;
    const avgManpower = items.reduce((s, h) => s + (h.plannedManpower || 0), 0) / items.length;
    return {
      avgItOutput: items.reduce((s, h) => s + h.itOutput, 0) / items.length,
      avgDays: items.reduce((s, h) => s + calcDays(h.startDate, h.endDate), 0) / items.length,
      avgManpower: avgManpower || 0,
      onTimeCount: items.filter((h) => calcOnTimeRate(h.plannedDeliveryDate, h.actualDeliveryDate) === '提前或准时').length,
      avgDeliveryDelay: (() => {
        const delays = items
          .map((h) => calcDeliveryDays(h.plannedDeliveryDate, h.actualDeliveryDate))
          .filter((d): d is number => d !== null && d > 0);
        return delays.length > 0 ? delays.reduce((s, d) => s + d, 0) / delays.length : 0;
      })(),
      delayCount: items.filter((h) => {
        const delay = calcDeliveryDays(h.plannedDeliveryDate, h.actualDeliveryDate);
        return delay !== null && delay > 0;
      }).length,
      earlyCount: items.filter((h) => {
        const delay = calcDeliveryDays(h.plannedDeliveryDate, h.actualDeliveryDate);
        return delay !== null && delay < 0;
      }).length,
    };
  }, [selectedHistoryItems]);

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SwapOutlined style={{ color: '#818cf8' }} />
          <span>历史交付数据对比</span>
        </div>
      }
      open={open}
      onCancel={() => {
        onClose();
        setTimeout(handleReset, 300);
      }}
      footer={null}
      width={1100}
      bodyStyle={{ background: '#ffffff', padding: '20px 28px', maxHeight: '80vh', overflowY: 'auto' }}
      styles={{
        header: { background: 'transparent', borderBottom: '1px solid #e9e7f4' },
      }}
      destroyOnClose
    >
      {/* 选择区域 */}
      {!reportGenerated ? (
        <div>
          <Row gutter={24}>
            <Col span={12}>
              <Card
                size="small"
                title={<span style={{ color: '#1e1b2e', fontSize: 14 }}>① 选择待对比项目</span>}
                style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 10 }}
              >
                <Select
                  value={selectedCurrentId || undefined}
                  onChange={(v) => { setSelectedCurrentId(v); setReportGenerated(false); }}
                  placeholder="请选择一个当前项目"
                  style={{ width: '100%', fontFamily: 'var(--font-primary)' }}
                  showSearch
                  optionFilterProp="children"
                  popupMatchSelectWidth={false}
                  size="large"
                >
                  {currentProjects
                    .filter((p) => p.status !== '已完成')
                    .map((p) => (
                      <Select.Option key={p.id} value={p.id}>
                        <span>{p.name}</span>
                        <span style={{ marginLeft: 8, color: '#9d9ab8', fontSize: 12 }}>
                          ({p.city} · {p.customer} · {statusMap[p.status]?.label})
                        </span>
                      </Select.Option>
                    ))}
                </Select>

                {selectedCurrent && (
                  <div style={{ marginTop: 16, padding: 14, background: '#f6f5fc', borderRadius: 8, border: '1px solid rgba(99,102,241,0.15)' }}>
                    <Descriptions column={2} size="small" labelStyle={{ color: '#6b6892', fontSize: 12 }} contentStyle={{ color: '#1e1b2e', fontSize: 12 }}>
                      <Descriptions.Item label="项目名称"><strong>{selectedCurrent.name}</strong></Descriptions.Item>
                      <Descriptions.Item label="客户">{selectedCurrent.customer}</Descriptions.Item>
                      <Descriptions.Item label="城市">{selectedCurrent.city || '-'}</Descriptions.Item>
                      <Descriptions.Item label="项目经理">{selectedCurrent.manager}</Descriptions.Item>
                      <Descriptions.Item label="业务类型">{selectedCurrent.businessType || '-'}</Descriptions.Item>
                      <Descriptions.Item label="状态">
                        <Tag color={statusMap[selectedCurrent.status]?.color}>{selectedCurrent.status}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="计划交付">{selectedCurrent.plannedDeliveryDate || '-'}</Descriptions.Item>
                      <Descriptions.Item label="IT产出">{selectedCurrent.itOutput} MW</Descriptions.Item>
                    </Descriptions>
                  </div>
                )}
              </Card>
            </Col>

            <Col span={12}>
              <Card
                size="small"
                title={<span style={{ color: '#1e1b2e', fontSize: 14 }}>② 选择历史交付项目（可多选）</span>}
                style={{ background: 'rgba(22,163,74,0.05)', border: '1px solid rgba(22,163,74,0.15)', borderRadius: 10 }}
              >
                <Select
                  mode="multiple"
                  value={selectedHistoryIds}
                  onChange={(v) => { setSelectedHistoryIds(v as string[]); setReportGenerated(false); }}
                  placeholder="请选择历史已交付项目进行对比"
                  style={{ width: '100%', fontFamily: 'var(--font-primary)' }}
                  showSearch
                  optionFilterProp="children"
                  maxTagCount={3}
                  size="large"
                  popupMatchSelectWidth={false}
                >
                  {deliveredHistory.map((h) => (
                    <Select.Option key={h.id} value={h.id}>
                      {h.name}
                      <span style={{ marginLeft: 8, color: '#9d9ab8', fontSize: 12 }}>
                        ({h.city} · {h.itOutput}MW)
                      </span>
                    </Select.Option>
                  ))}
                </Select>

                {selectedHistoryItems.length > 0 && (
                  <div style={{ marginTop: 12, color: '#6b6892', fontSize: 12 }}>
                    已选 <span style={{ color: '#16a34a', fontWeight: 600 }}>{selectedHistoryItems.length}</span> 个历史交付项目，
                    平均IT产出 <span style={{ color: '#818cf8' }}>{(selectedHistoryItems.reduce((s, h) => s + h.itOutput, 0) / selectedHistoryItems.length).toFixed(1)}</span> MW
                  </div>
                )}
              </Card>
            </Col>
          </Row>

          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Button
              type="primary"
              size="large"
              icon={<FileTextOutlined />}
              onClick={handleGenerateReport}
              disabled={!selectedCurrentId || selectedHistoryIds.length === 0}
              style={{
                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                border: 'none',
                fontFamily: 'var(--font-primary)',
                fontWeight: 600,
                borderRadius: 10,
                padding: '0 36px',
                height: 44,
                boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
              }}
            >
              生成对比报告
            </Button>
          </div>
        </div>
      ) : (
        /* ===== 对比报告 ===== */
        <div>
          {/* 报告头部：返回按钮 + 项目信息 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button onClick={handleReset} style={{ borderColor: '#9d9ab8', color: '#46436a', fontFamily: 'var(--font-primary)' }}>
                ← 重新选择
              </Button>
              <div style={{ padding: '6px 16px', background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(168,85,247,0.08))', borderRadius: 8, border: '1px solid rgba(99,102,241,0.2)' }}>
                <span style={{ color: '#818cf8', fontSize: 13, fontWeight: 500 }}>待对比项目：</span>
                <span style={{ color: '#1e1b2e', fontWeight: 600, marginLeft: 4 }}>{selectedCurrent?.name}</span>
              </div>
            </div>
          </div>

          {/* 核心指标对比卡片：兆瓦数 | 工期 | 交付周期 | 人员数量 */}
          {historyStats && (
            <>
              <Row gutter={[16, 16]} style={{ marginBottom: 22 }}>
                {/* 1. 兆瓦数 */}
                <Col span={6}>
                  <Card size="small" style={{ background: '#f6f5fc', border: '1px solid #e9e7f4', borderRadius: 10 }} bodyStyle={{ padding: '16px 12px' }}>
                    <Statistic
                      title={<span style={{ color: '#6b6892', fontSize: 12 }}><ThunderboltOutlined style={{ marginRight: 4 }} />兆瓦数(MW)</span>}
                      value={selectedCurrent?.itOutput || 0}
                      suffix="MW"
                      valueStyle={{ color: '#818cf8', fontSize: 22, fontWeight: 700 }}
                      prefix={<DiffArrow value={(selectedCurrent?.itOutput || 0) - historyStats.avgItOutput} />}
                    />
                    <div style={{ marginTop: 4, fontSize: 11, color: '#9d9ab8' }}>
                      历史均值: {historyStats.avgItOutput.toFixed(1)} MW
                      <span style={{ marginLeft: 6, color: (selectedCurrent?.itOutput || 0) >= historyStats.avgItOutput ? '#16a34a' : '#dc2626' }}>
                        ({diffPercent(selectedCurrent?.itOutput || 0, historyStats.avgItOutput)})
                      </span>
                    </div>
                  </Card>
                </Col>
                {/* 2. 工期 */}
                <Col span={6}>
                  <Card size="small" style={{ background: '#f6f5fc', border: '1px solid #e9e7f4', borderRadius: 10 }} bodyStyle={{ padding: '16px 12px' }}>
                    <Statistic
                      title={<span style={{ color: '#6b6892', fontSize: 12 }}><ClockCircleOutlined style={{ marginRight: 4 }} />工期(天)</span>}
                      value={selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0}
                      suffix="天"
                      valueStyle={{ color: '#d97706', fontSize: 22, fontWeight: 700 }}
                      prefix={<DiffArrow value={(selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0) - historyStats.avgDays} />}
                    />
                    <div style={{ marginTop: 4, fontSize: 11, color: '#9d9ab8' }}>
                      历史均值: {historyStats.avgDays.toFixed(0)}天
                      <span style={{ marginLeft: 6, color: (selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0) >= historyStats.avgDays ? '#dc2626' : '#16a34a' }}>
                        ({diffPercent((selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0), historyStats.avgDays)})
                      </span>
                    </div>
                  </Card>
                </Col>
                {/* 3. 交付周期 */}
                <Col span={6}>
                  <Card size="small" style={{ background: '#f6f5fc', border: '1px solid #e9e7f4', borderRadius: 10 }} bodyStyle={{ padding: '16px 12px' }}>
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: '#6b6892', fontSize: 12 }}><CalendarOutlined style={{ marginRight: 4 }} />交付周期</span>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#a855f7' }}>
                      {(() => {
                        const currentDays = selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.plannedDeliveryDate || selectedCurrent.endDate || '') : 0;
                        const avgDel = historyStats.avgDays;
                        return (
                          <span>
                            {currentDays} <span style={{ fontSize: 12, color: '#6b6892' }}>天</span>
                          </span>
                        );
                      })()}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: '#9d9ab8' }}>
                      历史平均: {historyStats.avgDays.toFixed(0)}天
                      <span style={{ marginLeft: 6, color: (selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.plannedDeliveryDate || selectedCurrent.endDate || '') : 0) >= historyStats.avgDays ? '#dc2626' : '#16a34a' }}>
                        ({diffPercent((selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.plannedDeliveryDate || selectedCurrent.endDate || '') : 0), historyStats.avgDays)})
                      </span>
                    </div>
                  </Card>
                </Col>
                {/* 4. 人员数量 */}
                <Col span={6}>
                  <Card size="small" style={{ background: '#f6f5fc', border: '1px solid #e9e7f4', borderRadius: 10 }} bodyStyle={{ padding: '16px 12px' }}>
                    <Statistic
                      title={<span style={{ color: '#6b6892', fontSize: 12 }}><TeamOutlined style={{ marginRight: 4 }} />人员数量(人)</span>}
                      value={selectedCurrent?.plannedManpower || 0}
                      suffix="人"
                      valueStyle={{ color: '#0d9488', fontSize: 22, fontWeight: 700 }}
                      prefix={<DiffArrow value={(selectedCurrent?.plannedManpower || 0) - historyStats.avgManpower} />}
                    />
                    <div style={{ marginTop: 4, fontSize: 11, color: '#9d9ab8' }}>
                      历史均值: {historyStats.avgManpower.toFixed(0)}人
                      <span style={{ marginLeft: 6, color: (selectedCurrent?.plannedManpower || 0) >= historyStats.avgManpower ? '#16a34a' : '#dc2626' }}>
                        ({diffPercent(selectedCurrent?.plannedManpower || 0, historyStats.avgManpower)})
                      </span>
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* 详细对比表格 */}
              <Divider style={{ borderColor: '#e9e7f4', margin: '18px 0 12px' }}>
                <span style={{ color: '#6b6892', fontSize: 13 }}>逐项对比明细</span>
              </Divider>

              <Table
                dataSource={selectedHistoryItems.map((h): HistoryRow => ({
                  ...h,
                  _key: h.id,
                  _simCity: selectedCurrent?.city === h.city,
                  _simCustomer: selectedCurrent?.customer === h.customer,
                  _simType: selectedCurrent?.businessType === h.businessType,
                }))}
                rowKey="_key"
                pagination={false}
                size="small"
                scroll={{ x: 1000 }}
                columns={[
                  {
                    title: '历史项目',
                    dataIndex: 'name',
                    key: 'name',
                    fixed: 'left',
                    width: 200,
                    render: (t: string) => <span style={{ color: '#1e1b2e', fontWeight: 500 }}>{t}</span>,
                  },
                  {
                    title: '兆瓦数(MW)',
                    dataIndex: 'itOutput',
                    key: 'mw',
                    width: 120,
                    align: 'center' as const,
                    sorter: (a, b) => a.itOutput - b.itOutput,
                    render: (val: number, r: HistoricalProject) => (
                      <Space direction="vertical" size={0} style={{ textAlign: 'center' }}>
                        <span style={{ color: '#818cf8', fontWeight: 500 }}>{val} MW</span>
                        {selectedCurrent?.itOutput && (
                          <span style={{
                            fontSize: 11,
                            color: val > selectedCurrent.itOutput ? '#16a34a' : val < selectedCurrent.itOutput ? '#dc2626' : '#9d9ab8',
                          }}>
                            {diffPercent(selectedCurrent.itOutput, val)}
                          </span>
                        )}
                      </Space>
                    ),
                  },
                  {
                    title: '工期(天)',
                    key: 'duration',
                    width: 110,
                    align: 'center' as const,
                    sorter: (a, b) => calcDays(a.startDate, a.endDate) - calcDays(b.startDate, b.endDate),
                    render: (_: unknown, r: HistoricalProject) => {
                      const days = calcDays(r.startDate, r.endDate);
                      const currentDays = selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0;
                      return (
                        <Space direction="vertical" size={0} style={{ textAlign: 'center' }}>
                          <span style={{ color: '#46436a', fontSize: 12 }}>{days}天</span>
                          {currentDays > 0 && (
                            <span style={{ fontSize: 11, color: currentDays > days ? '#dc2626' : currentDays < days ? '#16a34a' : '#9d9ab8' }}>
                              {diffPercent(currentDays, days)}
                            </span>
                          )}
                        </Space>
                      );
                    },
                  },
                  {
                    title: '交付周期(天)',
                    key: 'deliveryCycle',
                    width: 120,
                    align: 'center' as const,
                    render: (_: unknown, r: HistoricalProject) => {
                      const cycle = calcDays(r.startDate, r.plannedDeliveryDate || r.endDate);
                      const currentCycle = selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.plannedDeliveryDate || selectedCurrent.endDate || '') : 0;
                      return (
                        <Space direction="vertical" size={0} style={{ textAlign: 'center' }}>
                          <span style={{ color: '#a855f7', fontSize: 12 }}>{cycle}天</span>
                          {currentCycle > 0 && (
                            <span style={{ fontSize: 11, color: currentCycle > cycle ? '#dc2626' : currentCycle < cycle ? '#16a34a' : '#9d9ab8' }}>
                              {diffPercent(currentCycle, cycle)}
                            </span>
                          )}
                        </Space>
                      );
                    },
                  },
                  {
                    title: '人员数量(人)',
                    key: 'manpower',
                    width: 120,
                    align: 'center' as const,
                    sorter: (a, b) => (a.plannedManpower || 0) - (b.plannedManpower || 0),
                    render: (_: unknown, r: HistoricalProject) => {
                      const mp = r.plannedManpower || 0;
                      const currentMp = selectedCurrent?.plannedManpower || 0;
                      return (
                        <Space direction="vertical" size={0} style={{ textAlign: 'center' }}>
                          <span style={{ color: '#0d9488', fontSize: 12 }}>{mp}人</span>
                          {currentMp > 0 && mp > 0 && (
                            <span style={{ fontSize: 11, color: currentMp > mp ? '#16a34a' : currentMp < mp ? '#dc2626' : '#9d9ab8' }}>
                              {diffPercent(currentMp, mp)}
                            </span>
                          )}
                        </Space>
                      );
                    },
                  },
                  {
                    title: '交付情况',
                    key: 'delivery',
                    width: 100,
                    align: 'center' as const,
                    render: (_: unknown, r: HistoricalProject) => {
                      const rate = calcOnTimeRate(r.plannedDeliveryDate, r.actualDeliveryDate);
                      if (rate === '提前或准时') {
                        return <Tag icon={<CheckCircleOutlined />} color="#16a34a" style={{ border: 'none' }}>准时</Tag>;
                      }
                      if (rate === '延期') {
                        const delay = calcDeliveryDays(r.plannedDeliveryDate, r.actualDeliveryDate);
                        return <Tag icon={<WarningOutlined />} color="#dc2626" style={{ border: 'none' }}>延期{delay ? ` ${delay}天` : ''}</Tag>;
                      }
                      return '-';
                    },
                  },
                ]}
              />

              {/* 报告结论 */}
              <Divider style={{ borderColor: '#e9e7f4', margin: '18px 0 12px' }}>
                <span style={{ color: '#6b6892', fontSize: 13 }}><AreaChartOutlined style={{ marginRight: 6 }} />多维对比分析报告</span>
              </Divider>

              <Card
                size="small"
                style={{
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(168,85,247,0.04))',
                  border: '1px solid rgba(99,102,241,0.15)',
                  borderRadius: 10,
                }}
                bodyStyle={{ padding: '18px 20px' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <FileTextOutlined style={{ color: '#818cf8', fontSize: 18, marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#1e1b2e', fontWeight: 600, marginBottom: 12, fontSize: 15 }}>
                      「{selectedCurrent?.name}」与{selectedHistoryItems.length}个历史项目的深度对比分析
                    </div>
                    <div style={{ color: '#6b6892', fontSize: 12, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #e9e7f4' }}>
                      基于兆瓦数、工期、交付周期、人员数量四大核心维度进行量化对比
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: '#46436a', fontSize: 13, lineHeight: 2.2 }}>
                      {/* 1. 兆瓦数分析 */}
                      <li>
                        <strong style={{ color: '#818cf8' }}>【兆瓦数对比】</strong>
                        当前项目 IT产出为 <strong style={{ color: '#818cf8' }}>{selectedCurrent?.itOutput} MW</strong>，
                        {historyStats && ((selectedCurrent?.itOutput || 0) >= historyStats.avgItOutput ? (
                          <span>相比历史均值 <strong style={{ color: '#16a34a' }}>高出 {diffPercent(selectedCurrent?.itOutput || 0, historyStats.avgItOutput)}</strong></span>
                        ) : (
                          <span>相比历史均值 <strong style={{ color: '#dc2626' }}>低 {diffPercent(selectedCurrent?.itOutput || 0, historyStats.avgItOutput).replace('+', '')}</strong></span>
                        ))}。
                        历史项目平均 IT产出为 {historyStats?.avgItOutput.toFixed(1)} MW，
                        {selectedHistoryItems.length > 1 && (() => {
                          const maxOutput = Math.max(...selectedHistoryItems.map(h => h.itOutput));
                          const minOutput = Math.min(...selectedHistoryItems.map(h => h.itOutput));
                          return `参比项目兆瓦数分布范围 ${minOutput} ~ ${maxOutput} MW，`;
                        })()}
                        {(selectedCurrent?.itOutput || 0) >= (historyStats?.avgItOutput || 0) ? '当前项目规模处于中上水平' : '当前项目规模低于平均水平，需关注资源投入是否匹配'}。
                      </li>

                      {/* 2. 工期分析 */}
                      <li>
                        <strong style={{ color: '#d97706' }}>【工期对比】</strong>
                        当前项目工期为 <strong style={{ color: '#d97706' }}>{selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : '-'} 天</strong>（{selectedCurrent?.startDate} 至 {selectedCurrent?.endDate || '未定'}），
                        {historyStats && ((selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0) >= historyStats.avgDays ? (
                          <span>相比历史均值 <strong style={{ color: '#dc2626' }}>偏长 {diffPercent((selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0), historyStats.avgDays)}</strong></span>
                        ) : (
                          <span>相比历史均值 <strong style={{ color: '#16a34a' }}>更短 {diffPercent((selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0), historyStats.avgDays).replace('+', '')}</strong></span>
                        ))}。
                        历史项目平均工期 {historyStats?.avgDays.toFixed(0)} 天。
                        {(selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0) > (historyStats?.avgDays || 0) * 1.2
                          ? '⚠️ 当前工期显著超过历史均值，建议评估是否存在进度风险或阶段划分过细。'
                          : (selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0) < (historyStats?.avgDays || 0) * 0.8
                          ? '✓ 当前工期紧凑，建议确保各阶段验收节点按期完成。'
                          : '✓ 当前工期与历史均值基本持平，符合正常交付节奏。'}
                      </li>

                      {/* 3. 交付周期分析 */}
                      <li>
                        <strong style={{ color: '#a855f7' }}>【交付周期对比】</strong>
                        当前项目计划交付周期 <strong style={{ color: '#a855f7' }}>{selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.plannedDeliveryDate || selectedCurrent.endDate || '') : '-'} 天</strong>。
                        参比历史项目中 <strong style={{ color: '#16a34a' }}>{historyStats?.onTimeCount}/{selectedHistoryItems.length}</strong> 个按时交付，准时率 <strong>{Math.round(((historyStats?.onTimeCount || 0) / selectedHistoryItems.length) * 100)}%</strong>。
                        {historyStats && historyStats.delayCount > 0 && (
                          <span>其中 <strong style={{ color: '#dc2626' }}>{historyStats.delayCount} 个</strong> 项目出现延期，平均延期 {historyStats.avgDeliveryDelay.toFixed(0)} 天。</span>
                        )}
                        {historyStats && historyStats.earlyCount > 0 && (
                          <span> <strong style={{ color: '#16a34a' }}>{historyStats.earlyCount} 个</strong> 项目提前交付。</span>
                        )}
                        {' '}根据历史准时率数据，
                        {Math.round(((historyStats?.onTimeCount || 0) / selectedHistoryItems.length) * 100) >= 80
                          ? '✓ 历史准时率良好，当前项目具备按时交付基础。'
                          : Math.round(((historyStats?.onTimeCount || 0) / selectedHistoryItems.length) * 100) >= 50
                          ? '⚠️ 历史准时率一般，建议预留缓冲时间应对潜在风险。'
                          : '⚠️ 历史准时率偏低，建议加强进度管控并提前识别风险点。'}
                      </li>

                      {/* 4. 人员数量分析 */}
                      <li>
                        <strong style={{ color: '#0d9488' }}>【人员数量对比】</strong>
                        当前项目计划投入 <strong style={{ color: '#0d9488' }}>{selectedCurrent?.plannedManpower || 0} 人</strong>，
                        {historyStats && ((selectedCurrent?.plannedManpower || 0) >= historyStats.avgManpower ? (
                          <span>相比历史均值 <strong style={{ color: '#16a34a' }}>多出 {diffPercent(selectedCurrent?.plannedManpower || 0, historyStats.avgManpower)}</strong></span>
                        ) : (
                          <span>相比历史均值 <strong style={{ color: '#dc2626' }}>少 {diffPercent(selectedCurrent?.plannedManpower || 0, historyStats.avgManpower).replace('+', '')}</strong></span>
                        ))}。
                        历史项目平均投入人力 {historyStats?.avgManpower.toFixed(0)} 人。
                        {(() => {
                          const currentMp = selectedCurrent?.plannedManpower || 0;
                          const avgMp = historyStats?.avgManpower || 1;
                          const currentIt = selectedCurrent?.itOutput || 1;
                          const avgIt = historyStats?.avgItOutput || 1;
                          const currentMwPerPerson = currentIt / (currentMp || 1);
                          const avgMwPerPerson = avgIt / (avgMp || 1);
                          return (
                            <span>人均产出比：当前 <strong style={{ color: '#0d9488' }}>{currentMwPerPerson.toFixed(1)} MW/人</strong> vs 历史均值 <strong>{avgMwPerPerson.toFixed(1)} MW/人</strong>，
                            {currentMwPerPerson >= avgMwPerPerson
                              ? '✓ 人均产出效率高于历史均值，资源配置合理。'
                              : '⚠️ 人均产出效率低于历史均值，建议评估人员配置是否充足或任务分配是否均衡。'}</span>
                          );
                        })()}
                      </li>

                      {/* 5. 综合建议 */}
                      {(() => {
                        const currentIt = selectedCurrent?.itOutput || 0;
                        const avgIt = historyStats?.avgItOutput || 0;
                        const currentDays = selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0;
                        const avgDays = historyStats?.avgDays || 0;
                        const currentMp = selectedCurrent?.plannedManpower || 0;
                        const avgMp = historyStats?.avgManpower || 0;
                        const onTimeRate = Math.round(((historyStats?.onTimeCount || 0) / selectedHistoryItems.length) * 100);
                        const risks: string[] = [];
                        const strengths: string[] = [];
                        if (currentDays > avgDays * 1.2) risks.push('工期偏长');
                        if (currentDays < avgDays * 0.8) strengths.push('工期紧凑');
                        if (currentMp < avgMp * 0.8) risks.push('人员投入不足');
                        if (currentMp > avgMp * 1.2) strengths.push('人员配置充足');
                        if (onTimeRate < 60) risks.push('历史准时率偏低');
                        if (onTimeRate >= 80) strengths.push('历史准时率良好');
                        return (
                          <li style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e9e7f4' }}>
                            <strong style={{ color: '#1e1b2e' }}>【综合评估】</strong>
                            {strengths.length > 0 && <span><strong style={{ color: '#16a34a' }}>优势：</strong>{strengths.join('、')}。</span>}
                            {risks.length > 0 && <span><strong style={{ color: '#dc2626' }}>风险：</strong>{risks.join('、')}。</span>}
                            {risks.length === 0 && strengths.length === 0 && '各项指标与历史均值基本持平，建议按常规流程推进。'}
                          </li>
                        );
                      })()}
                    </ul>
                  </div>
                </div>
              </Card>
            </>
          )}

          <Empty description="" style={{ padding: '32px 0' }} />
        </div>
      )}
    </Modal>
  );
}

export default ComparisonReportModal;
