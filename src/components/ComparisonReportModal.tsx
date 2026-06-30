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

/** 差异百分比 */
function diffPercent(a: number, b: number): string {
  if (!a || !b) return '-';
  const diff = ((a - b) / b) * 100;
  if (diff > 0) return `+${diff.toFixed(1)}%`;
  return `${diff.toFixed(1)}%`;
}

/** 差异方向 */
function DiffArrow({ value }: { value: number }) {
  if (value === 0) return <MinusOutlined style={{ color: '#8c8c8c', fontSize: 11 }} />;
  if (value > 0) return <ArrowUpOutlined style={{ color: '#ff4d4f', fontSize: 11 }} />;
  return <ArrowDownOutlined style={{ color: '#52c41a', fontSize: 11 }} />;
}

const statusMap: Record<string, { color: string; label: string }> = {
  '未开始': { color: '#8c8c8c', label: '未开始' },
  '测试中': { color: '#4d9fff', label: '测试中' },
  '已完成': { color: '#52c41a', label: '已完成' },
  '阻塞': { color: '#ff7875', label: '阻塞' },
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
    return {
      avgItOutput: items.reduce((s, h) => s + h.itOutput, 0) / items.length,
      avgDays: items.reduce((s, h) => s + calcDays(h.startDate, h.endDate), 0) / items.length,
      onTimeCount: items.filter((h) => calcOnTimeRate(h.plannedDeliveryDate, h.actualDeliveryDate) === '提前或准时').length,
    };
  }, [selectedHistoryItems]);

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SwapOutlined style={{ color: '#7cb8ff' }} />
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
      bodyStyle={{ background: 'rgba(13,31,60,0.97)', padding: '20px 28px', maxHeight: '80vh', overflowY: 'auto' }}
      styles={{
        header: { background: 'transparent', borderBottom: '1px solid rgba(255,255,255,0.08)' },
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
                title={<span style={{ color: '#fff', fontSize: 14 }}>① 选择待对比项目</span>}
                style={{ background: 'rgba(77,159,255,0.06)', border: '1px solid rgba(77,159,255,0.15)', borderRadius: 10 }}
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
                        <span style={{ marginLeft: 8, color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
                          ({p.city} · {p.customer} · {statusMap[p.status]?.label})
                        </span>
                      </Select.Option>
                    ))}
                </Select>

                {selectedCurrent && (
                  <div style={{ marginTop: 16, padding: 14, background: 'rgba(13,31,60,0.6)', borderRadius: 8, border: '1px solid rgba(124,184,255,0.15)' }}>
                    <Descriptions column={2} size="small" labelStyle={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }} contentStyle={{ color: '#fff', fontSize: 12 }}>
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
                title={<span style={{ color: '#fff', fontSize: 14 }}>② 选择历史交付项目（可多选）</span>}
                style={{ background: 'rgba(82,196,26,0.05)', border: '1px solid rgba(82,196,26,0.15)', borderRadius: 10 }}
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
                      <span style={{ marginLeft: 8, color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                        ({h.city} · {h.itOutput}MW)
                      </span>
                    </Select.Option>
                  ))}
                </Select>

                {selectedHistoryItems.length > 0 && (
                  <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                    已选 <span style={{ color: '#52c41a', fontWeight: 600 }}>{selectedHistoryItems.length}</span> 个历史交付项目，
                    平均IT产出 <span style={{ color: '#7cb8ff' }}>{(selectedHistoryItems.reduce((s, h) => s + h.itOutput, 0) / selectedHistoryItems.length).toFixed(1)}</span> MW
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
                background: 'linear-gradient(135deg, #4d9fff, #69b1ff)',
                border: 'none',
                fontFamily: 'var(--font-primary)',
                fontWeight: 600,
                borderRadius: 10,
                padding: '0 36px',
                height: 44,
                boxShadow: '0 4px 20px rgba(77,159,255,0.4)',
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
              <Button onClick={handleReset} style={{ borderColor: 'rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.65)', fontFamily: 'var(--font-primary)' }}>
                ← 重新选择
              </Button>
              <div style={{ padding: '6px 16px', background: 'linear-gradient(135deg, rgba(77,159,255,0.12), rgba(105,177,255,0.08))', borderRadius: 8, border: '1px solid rgba(77,159,255,0.2)' }}>
                <span style={{ color: '#7cb8ff', fontSize: 13, fontWeight: 500 }}>待对比项目：</span>
                <span style={{ color: '#fff', fontWeight: 600, marginLeft: 4 }}>{selectedCurrent?.name}</span>
              </div>
            </div>
          </div>

          {/* 核心指标对比卡片 */}
          {historyStats && (
            <>
              <Row gutter={[16, 16]} style={{ marginBottom: 22 }}>
                <Col span={6}>
                  <Card size="small" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }} bodyStyle={{ padding: '16px 12px' }}>
                    <Statistic
                      title={<span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>IT产出(MW)</span>}
                      value={selectedCurrent?.itOutput || 0}
                      suffix="MW"
                      valueStyle={{ color: '#7cb8ff', fontSize: 22, fontWeight: 700 }}
                      prefix={<DiffArrow value={(selectedCurrent?.itOutput || 0) - historyStats.avgItOutput} />}
                    />
                    <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                      历史均值: {historyStats.avgItOutput.toFixed(1)}
                      <span style={{ marginLeft: 6, color: (selectedCurrent?.itOutput || 0) >= historyStats.avgItOutput ? '#52c41a' : '#ff4d4f' }}>
                        ({diffPercent(selectedCurrent?.itOutput || 0, historyStats.avgItOutput)})
                      </span>
                    </div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }} bodyStyle={{ padding: '16px 12px' }}>
                    <Statistic
                      title={<span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>工期(天)</span>}
                      value={selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0}
                      suffix="天"
                      valueStyle={{ color: '#faad14', fontSize: 22, fontWeight: 700 }}
                      prefix={<DiffArrow value={(selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0) - historyStats.avgDays} />}
                    />
                    <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                      历史均值: {historyStats.avgDays.toFixed(0)}天
                      <span style={{ marginLeft: 6, color: (selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0) >= historyStats.avgDays ? '#ff4d4f' : '#52c41a' }}>
                        ({diffPercent((selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0), historyStats.avgDays)})
                      </span>
                    </div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }} bodyStyle={{ padding: '16px 12px' }}>
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>业务类型</span>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#b37feb' }}>{selectedCurrent?.businessType || '-'}</div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                      {(() => {
                        const matchCount = selectedHistoryItems.filter((h) => h.businessType === (selectedCurrent?.businessType || '')).length;
                        return (
                          <>
                            <Tag style={{ background: matchCount > 0 ? 'rgba(82,196,26,0.15)' : 'rgba(255,255,255,0.06)', color: matchCount > 0 ? '#52c41a' : 'rgba(255,255,255,0.35)', border: `1px solid ${matchCount > 0 ? 'rgba(82,196,26,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 4, fontSize: 11 }}>
                              同类型 {matchCount}/{selectedHistoryItems.length}
                            </Tag>
                          </>
                        );
                      })()}
                    </div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }} bodyStyle={{ padding: '16px 12px' }}>
                    <Statistic
                      title={<span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>历史准时率</span>}
                      value={historyStats.onTimeCount}
                      suffix={`/ ${selectedHistoryItems.length}`}
                      valueStyle={{ color: '#52c41a', fontSize: 22, fontWeight: 700 }}
                    />
                    <Progress
                      percent={Math.round((historyStats.onTimeCount / selectedHistoryItems.length) * 100)}
                      size="small"
                      strokeColor="#52c41a"
                      trailColor="rgba(255,255,255,0.08)"
                      style={{ marginTop: 6 }}
                    />
                  </Card>
                </Col>
              </Row>

              {/* 详细对比表格 */}
              <Divider style={{ borderColor: 'rgba(255,255,255,0.08)', margin: '18px 0 12px' }}>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>逐项对比明细</span>
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
                    render: (t: string) => <span style={{ color: '#fff', fontWeight: 500 }}>{t}</span>,
                  },
                  {
                    title: '客户匹配',
                    key: 'customerMatch',
                    width: 90,
                    align: 'center' as const,
                    render: (_: unknown, r: HistoricalProject & { _simCustomer?: boolean }) =>
                      r._simCustomer ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} /> : <CloseCircleOutlined style={{ color: 'rgba(255,255,255,0.15)', fontSize: 16 }} />,
                  },
                  {
                    title: '城市匹配',
                    key: 'cityMatch',
                    width: 80,
                    align: 'center' as const,
                    render: (_: unknown, r: HistoricalProject & { _simCity?: boolean }) =>
                      r._simCity ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} /> : <CloseCircleOutlined style={{ color: 'rgba(255,255,255,0.15)', fontSize: 16 }} />,
                  },
                  {
                    title: '业务类型',
                    dataIndex: 'businessType',
                    key: 'type',
                    width: 95,
                    render: (text?: string) => (
                      <Space>
                        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{text || '-'}</span>
                        {(text && text === selectedCurrent?.businessType) && <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />}
                      </Space>
                    ),
                  },
                  {
                    title: 'IT产出(MW)',
                    dataIndex: 'itOutput',
                    key: 'mw',
                    width: 100,
                    sorter: (a, b) => a.itOutput - b.itOutput,
                    render: (val: number) => (
                      <Space>
                        <span style={{ color: '#7cb8ff', fontWeight: 500 }}>{val}</span>
                        {selectedCurrent?.itOutput && (
                          <span style={{
                            fontSize: 11,
                            color: val > selectedCurrent.itOutput ? '#52c41a' : val < selectedCurrent.itOutput ? '#ff4d4f' : 'rgba(255,255,255,0.3)',
                          }}>
                            ({diffPercent(selectedCurrent.itOutput, val)})
                          </span>
                        )}
                      </Space>
                    ),
                  },
                  {
                    title: '项目周期',
                    key: 'duration',
                    width: 85,
                    sorter: (a, b) => calcDays(a.startDate, a.endDate) - calcDays(b.startDate, b.endDate),
                    render: (_: unknown, r) => {
                      const days = calcDays(r.startDate, r.endDate);
                      const currentDays = selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0;
                      return (
                        <Space>
                          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{days}天</span>
                          {currentDays > 0 && (
                            <span style={{ fontSize: 11, color: currentDays > days ? '#ff4d4f' : currentDays < days ? '#52c41a' : 'rgba(255,255,255,0.3)' }}>
                              ({diffPercent(currentDays, days)})
                            </span>
                          )}
                        </Space>
                      );
                    },
                  },
                  {
                    title: '交付情况',
                    key: 'delivery',
                    width: 85,
                    render: (_: unknown, r) => {
                      const rate = calcOnTimeRate(r.plannedDeliveryDate, r.actualDeliveryDate);
                      if (rate === '提前或准时') {
                        return <Tag icon={<CheckCircleOutlined />} color="#52c41a" style={{ border: 'none' }}>准时</Tag>;
                      }
                      if (rate === '延期') {
                        return <Tag icon={<WarningOutlined />} color="#ff4d4f" style={{ border: 'none' }}>延期</Tag>;
                      }
                      return '-';
                    },
                  },
                ]}
              />

              {/* 报告结论 */}
              <Divider style={{ borderColor: 'rgba(255,255,255,0.08)', margin: '18px 0 12px' }}>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>分析结论</span>
              </Divider>

              <Card
                size="small"
                style={{
                  background: 'linear-gradient(135deg, rgba(77,159,255,0.06), rgba(179,126,235,0.04))',
                  border: '1px solid rgba(77,159,255,0.15)',
                  borderRadius: 10,
                }}
                bodyStyle={{ padding: '18px 20px' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <FileTextOutlined style={{ color: '#7cb8ff', fontSize: 18, marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#fff', fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
                      「{selectedCurrent?.name}」与{selectedHistoryItems.length}个历史项目的对比分析
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(255,255,255,0.65)', fontSize: 13, lineHeight: 2 }}>
                      <li>
                        IT产出为 <strong style={{ color: '#7cb8ff' }}>{selectedCurrent?.itOutput} MW</strong>，相比历史均值{' '}
                        {historyStats && ((selectedCurrent?.itOutput || 0) >= historyStats.avgItOutput ? (
                          <span style={{ color: '#52c41a' }}>高出 {diffPercent(selectedCurrent?.itOutput || 0, historyStats.avgItOutput)}</span>
                        ) : (
                          <span style={{ color: '#ff4d4f' }}>低 {diffPercent(selectedCurrent?.itOutput || 0, historyStats.avgItOutput).replace('+', '')}</span>
                        ))}{' '}
                        （历史均值 {historyStats?.avgItOutput.toFixed(1)} MW）
                      </li>
                      <li>
                        项目工期为 <strong style={{ color: '#faad14' }}>{selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : '-'} 天</strong>，相比历史均值{' '}
                        {historyStats && ((selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0) >= historyStats.avgDays ? (
                          <span style={{ color: '#ff4d4f' }}>偏长 {diffPercent((selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0), historyStats.avgDays)}</span>
                        ) : (
                          <span style={{ color: '#52c41a' }}>更短 {diffPercent((selectedCurrent ? calcDays(selectedCurrent.startDate, selectedCurrent.endDate || '') : 0), historyStats.avgDays).replace('+', '')}</span>
                        ))}{' '}
                        （历史均值 {historyStats?.avgDays.toFixed(0)} 天）
                      </li>
                      <li>
                        参比的历史项目中 <strong style={{ color: '#52c41a' }}>{historyStats?.onTimeCount}/{selectedHistoryItems.length}</strong> 个按时交付，准时率{' '}
                        <strong>{Math.round(((historyStats?.onTimeCount || 0) / selectedHistoryItems.length) * 100)}%</strong>
                      </li>
                      {selectedCurrent?.city && (() => {
                        const sameCity = selectedHistoryItems.filter((h) => h.city === selectedCurrent!.city);
                        if (sameCity.length > 0) {
                          return (
                            <li>
                              同城（<strong>{selectedCurrent.city}</strong>）有 <strong style={{ color: '#7cb8ff' }}>{sameCity.length}</strong> 个参考项目，
                              平均工期 {sameCity.length > 0 ? `${(sameCity.reduce((s, h) => s + calcDays(h.startDate, h.endDate), 0) / sameCity.length).toFixed(0)} 天` : '-'}
                            </li>
                          );
                        }
                        return null;
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
