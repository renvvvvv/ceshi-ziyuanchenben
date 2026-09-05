import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Spin, Select, Tag } from 'antd';
import { ReloadOutlined, ProjectOutlined, CheckCircleOutlined, ThunderboltOutlined, TeamOutlined, FilterOutlined, RightOutlined, ClockCircleOutlined, WarningOutlined, AlertOutlined } from '@ant-design/icons';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { PieChart, BarChart } from 'echarts/charts';
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import dayjs from 'dayjs';
import KpiCard from '../../components/KpiCard';
import GanttChart from '../../components/GanttChart';
import type { GanttUnit } from '../../components/GanttChart';
import { useData } from '../../store/DataContext';

echarts.use([PieChart, BarChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);

// ============================================================
// 状态筛选配置
// ============================================================
const STATUS_OPTIONS = [
  { label: '未开始', value: '未开始', color: '#ea580c' },
  { label: '测试中', value: '测试中', color: '#06b6d4' },
  { label: '已完成', value: '已完成', color: '#16a34a' },
  { label: '阻塞', value: '阻塞', color: '#ec4899' },
];

const STATUS_COLOR_MAP: Record<string, string> = {
  '未开始': '#ea580c',
  '测试中': '#06b6d4',
  '已完成': '#16a34a',
  '阻塞': '#ec4899',
};

function Dashboard() {
  const [loading, setLoading] = useState(false);
  // 默认只显示"未开始"和"测试中"，"已完成"项目默认不显示在甘特图中
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['未开始', '测试中']);
  // 甘特图时间单位：天/周/月/季/年
  const [ganttUnit, setGanttUnit] = useState<GanttUnit>('day');
  const { projects, historyProjects, regionMwOutput, autoProcessProjects, autoProcessMembers, dataSource, reload } = useData();
  const navigate = useNavigate();

  // ===== 自动化流程：根据日期自动转换项目状态 =====
  // 仅在后端数据加载完成后执行，避免 autoProcess 基于旧缓存覆盖后端返回的正确数据
  useEffect(() => {
    if (dataSource !== 'api' && dataSource !== 'cache') return;
    autoProcessProjects();
    autoProcessMembers();
  }, [autoProcessProjects, autoProcessMembers, dataSource]);

  // ===== 定时自动刷新（每 5 分钟跑一次 autoProcess，让逾期/今日到期数据保持最新） =====
  useEffect(() => {
    const timer = setInterval(() => {
      autoProcessProjects();
      autoProcessMembers();
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [autoProcessProjects, autoProcessMembers]);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      // 真正重新拉取后端数据（之前只跑本地状态机，别人改的数据看不到）
      await reload();
      autoProcessProjects();
      autoProcessMembers();
    } finally {
      setLoading(false);
    }
  };

  // ===== 显示屏模块：进行中 + 即将开始 + 逾期预警 =====
  const displayData = useMemo(() => {
    const today = dayjs();
    const tenDaysLater = today.add(10, 'day');

    // 进行中：status === '测试中'
    const activeProjects = projects.filter((p) => p.status === '测试中');

    // 即将开始：status === '未开始' 且 startDate 在 10 天内（无日期/无效日期不参与，避免 NaN 天数）
    const upcomingProjects = projects.filter((p) => {
      if (p.status !== '未开始') return false;
      if (!p.startDate || !dayjs(p.startDate).isValid()) return false;
      const start = dayjs(p.startDate);
      return !start.isBefore(today, 'day') && !start.isAfter(tenDaysLater, 'day');
    });

    // 今日到期：status === '测试中' 且 endDate === today
    const dueToday = projects.filter((p) =>
      p.status === '测试中' && p.endDate && dayjs(p.endDate).isSame(today, 'day')
    );

    // 逾期：status === '测试中' 且 endDate < today
    // 区分轻度（1~3 天）和重度（7+ 天）逾期
    const overdue = projects.filter((p) =>
      p.status === '测试中' && p.endDate && dayjs(p.endDate).isBefore(today, 'day')
    );
    const overdueMild = overdue.filter((p) => {
      const days = today.diff(dayjs(p.endDate), 'day');
      return days >= 1 && days <= 3;
    });
    const overdueSevere = overdue.filter((p) => {
      const days = today.diff(dayjs(p.endDate), 'day');
      return days >= 7;
    });
    // 逾期但未超过 7 天的归入 overdueMild 显示
    const overdueOthers = overdue.filter((p) => {
      const days = today.diff(dayjs(p.endDate), 'day');
      return days >= 4 && days <= 6;
    });

    return {
      activeProjects,
      upcomingProjects,
      dueToday,
      overdueMild: [...overdueMild, ...overdueOthers],
      overdueSevere,
    };
  }, [projects]);

  // ===== 筛选后的项目（用于甘特图和环形图） =====
  const filteredProjects = useMemo(() => {
    const all = [...projects, ...historyProjects];
    // 按来源前缀去重（两表独立自增 id 会撞号，纯 id 去重会静默丢历史项目）
    const seen = new Set<string>();
    const unique = all.filter((p) => {
      const key = (historyProjects.includes(p) ? 'h-' : 'p-') + p.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const result = unique.filter((p) => selectedStatuses.includes(p.status));
    // 安全检查：即使 selectedStatuses 不包含"已完成"，也强制排除
    const safeResult = selectedStatuses.includes('已完成') ? result : result.filter((p) => p.status !== '已完成');
    return safeResult;
  }, [projects, historyProjects, selectedStatuses]);

  // 动态计算 KPI 数据
  // 口径修正（2026-08-27）：2026-07-19 起"已完成"项目保留在 projects（手动归档才进历史），
  // 已完成数/总IT产出/平均人力必须合并 projects + historyProjects 统计，否则全为 0
  const kpiData = useMemo(() => {
    const notStartedProjects = projects.filter((p) => p.status === '未开始').length;
    const completed = [
      ...projects.filter((p) => p.status === '已完成'),
      ...historyProjects.filter((p) => p.status === '已完成'),
    ];
    const completedProjects = completed.length;
    const totalItOutput = completed.reduce((sum, p) => sum + (p.itOutput || 0), 0);

    // 平均投入人力：已完成项目的 plannedManpower 平均值
    const completedWithManpower = completed.filter((p) => (p.plannedManpower || 0) > 0);
    const avgManpower = completedWithManpower.length > 0
      ? Math.round(completedWithManpower.reduce((sum, p) => sum + (p.plannedManpower || 0), 0) / completedWithManpower.length)
      : 0;

    return { notStartedProjects, completedProjects, totalItOutput, avgManpower };
  }, [projects, historyProjects]);

  // 动态计算状态分布（与筛选状态关联）
  const statusDistribution = useMemo(() => {
    return [
      { name: '未开始', value: filteredProjects.filter((p) => p.status === '未开始').length },
      { name: '测试中', value: filteredProjects.filter((p) => p.status === '测试中').length },
      { name: '已完成', value: filteredProjects.filter((p) => p.status === '已完成').length },
      { name: '阻塞', value: filteredProjects.filter((p) => p.status === '阻塞').length },
    ].filter((item) => item.value > 0);
  }, [filteredProjects]);

  // 环形图配置
  const statusPieOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item' as const,
      formatter: '{b}: {c} 个 ({d}%)',
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      borderColor: 'rgba(99,102,241, 0.3)',
      borderWidth: 1,
      textStyle: { color: '#1e1b2e', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 12 },
    },
    legend: {
      bottom: 0,
      textStyle: { color: '#6b6892', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 12 },
    },
    series: [
      {
        name: '项目状态分布',
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 6,
          borderColor: '#ffffff',
          borderWidth: 3,
        },
        label: {
          show: true,
          color: '#46436a',
          fontFamily: 'Outfit, Noto Sans SC, sans-serif',
          fontSize: 12,
          formatter: '{b}\n{d}%',
        },
        data: statusDistribution.map((item) => ({
          name: item.name,
          value: item.value,
          itemStyle: {
            color: STATUS_COLOR_MAP[item.name] || '#6366f1',
          },
        })),
      },
    ],
  }), [statusDistribution]);

  const regionMwBarOption = useMemo(() => {
    const sorted = [...regionMwOutput].sort((a, b) => b.mwOutput - a.mwOutput);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis' as const,
        formatter: '{b}: {c} MW',
        backgroundColor: 'rgba(255, 255, 255, 0.96)',
        borderColor: 'rgba(99,102,241, 0.3)',
        borderWidth: 1,
        textStyle: { color: '#1e1b2e', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 12 },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category' as const,
        data: sorted.map((item) => item.name),
        axisLabel: { color: '#6b6892', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 11 },
        axisLine: { lineStyle: { color: '#e9e7f4' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        name: 'MW',
        nameTextStyle: { color: '#6b6892', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 11 },
        axisLabel: { color: '#6b6892', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#f6f5fc' } },
      },
      series: [
        {
          name: '兆瓦产出',
          type: 'bar',
          data: sorted.map((item) => item.mwOutput),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#818cf8' },
              { offset: 0.5, color: '#6366f1' },
              { offset: 1, color: '#a855f7' },
            ]),
            borderRadius: [6, 6, 0, 0],
            shadowColor: 'rgba(99, 102, 241, 0.25)',
            shadowBlur: 12,
            shadowOffsetY: 4,
          },
          barWidth: '50%',
          label: {
            show: true,
            position: 'top' as const,
            color: '#6366f1',
            fontSize: 11,
            fontFamily: 'Outfit, Noto Sans SC, sans-serif',
            formatter: '{c} MW',
          },
        },
      ],
    };
  }, [regionMwOutput]);

  // 甘特图项目：根据筛选状态过滤
  const ganttProjects = useMemo(() => {
    return filteredProjects
      .filter((p) => p.status !== '阻塞')
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [filteredProjects]);

  // 计数（基于筛选后的项目）
  const notStartedCount = filteredProjects.filter((p) => p.status === '未开始').length;
  const activeCount = filteredProjects.filter((p) => p.status === '测试中').length;
  const completedCount = filteredProjects.filter((p) => p.status === '已完成').length;

  // 环形图点击事件：切换筛选状态（点击已选中则移除，未选中则添加）
  const handlePieClick = (params: any) => {
    const statusName = params?.name as string;
    if (statusName && STATUS_OPTIONS.some((o) => o.value === statusName)) {
      setSelectedStatuses((prev) => {
        if (prev.includes(statusName)) {
          return prev.filter((s) => s !== statusName);
        } else {
          return [...prev, statusName];
        }
      });
    }
  };

  // 自定义标签渲染（多选下拉框中的标签）
  const tagRender = (props: { label: React.ReactNode; value: string; closable: boolean; onClose: () => void }) => {
    const { label, value, closable, onClose } = props;
    const color = STATUS_COLOR_MAP[value] || '#6366f1';
    return (
      <Tag
        color={color}
        closable={closable}
        onClose={onClose}
        style={{ marginRight: 3, fontSize: 12 }}
      >
        {label}
      </Tag>
    );
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 120, color: '#46436a', fontFamily: 'var(--font-primary)' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h3>工作概览</h3>
        <Button
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          className="glass-btn"
          style={{ background: '#f6f5fc', border: '1px solid #d9d5f0', color: '#46436a', fontFamily: 'var(--font-primary)', borderRadius: 8 }}
        >
          刷新
        </Button>
      </div>

      {/* ===== 显示屏模块：进行中 + 即将开始 ===== */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 20,
          marginBottom: 24,
        }}
      >
        {/* 进行中项目 */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e9e7f4',
            boxShadow: '0 8px 24px rgba(99,102,241,0.10)',
            borderRadius: 12,
            padding: '20px 24px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* LED 发光边框效果 */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: 'linear-gradient(90deg, transparent, #06b6d4, transparent)',
              boxShadow: '0 0 12px rgba(6, 182, 212,0.4)',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#06b6d4',
                boxShadow: '0 0 8px rgba(6, 182, 212,0.8)',
                animation: 'pulse 2s infinite',
              }}
            />
            <span
              style={{
                color: '#06b6d4',
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'var(--font-primary)',
                letterSpacing: 1,
              }}
            >
              进行中项目
            </span>
            <span style={{ color: '#9d9ab8', fontSize: 12, marginLeft: 'auto' }}>
              {displayData.activeProjects.length} 个
            </span>
          </div>
          {displayData.activeProjects.length === 0 ? (
            <div style={{ color: '#9d9ab8', fontSize: 13, padding: '8px 0', fontFamily: 'var(--font-primary)' }}>
              暂无进行中的项目
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {displayData.activeProjects.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'rgba(6, 182, 212,0.05)',
                    border: '1px solid rgba(6, 182, 212,0.1)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(6, 182, 212,0.1)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(6, 182, 212,0.25)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(6, 182, 212,0.05)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(6, 182, 212,0.1)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <ProjectOutlined style={{ color: '#06b6d4', fontSize: 14, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          color: '#1e1b2e',
                          fontSize: 13,
                          fontWeight: 500,
                          fontFamily: 'var(--font-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={p.name}
                      >
                        {p.name}
                      </div>
                      <div style={{ color: '#9d9ab8', fontSize: 11, marginTop: 2 }}>
                        {p.city} · {p.startDate} ~ {p.endDate}
                      </div>
                    </div>
                  </div>
                  <RightOutlined style={{ color: 'rgba(6, 182, 212,0.4)', fontSize: 12, flexShrink: 0 }} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 即将开始项目 */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e9e7f4',
            boxShadow: '0 8px 24px rgba(99,102,241,0.10)',
            borderRadius: 12,
            padding: '20px 24px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: 'linear-gradient(90deg, transparent, #ea580c, transparent)',
              boxShadow: '0 0 12px rgba(234, 88, 12,0.4)',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <ClockCircleOutlined style={{ color: '#ea580c', fontSize: 16 }} />
            <span
              style={{
                color: '#ea580c',
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'var(--font-primary)',
                letterSpacing: 1,
              }}
            >
              即将开始
            </span>
            <span style={{ color: '#9d9ab8', fontSize: 12, marginLeft: 'auto' }}>
              未来 10 天 · {displayData.upcomingProjects.length} 个
            </span>
          </div>
          {displayData.upcomingProjects.length === 0 ? (
            <div style={{ color: '#9d9ab8', fontSize: 13, padding: '8px 0', fontFamily: 'var(--font-primary)' }}>
              暂无即将开始的项目
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {displayData.upcomingProjects.map((p) => {
                const daysLeft = dayjs(p.startDate).startOf('day').diff(dayjs().startOf('day'), 'day');
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'rgba(234, 88, 12,0.05)',
                      border: '1px solid rgba(234, 88, 12,0.1)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onClick={() => navigate(`/projects/${p.id}`)}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(234, 88, 12,0.1)';
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(234, 88, 12,0.25)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(234, 88, 12,0.05)';
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(234, 88, 12,0.1)';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <ProjectOutlined style={{ color: '#ea580c', fontSize: 14, flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            color: '#1e1b2e',
                            fontSize: 13,
                            fontWeight: 500,
                            fontFamily: 'var(--font-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={p.name}
                        >
                          {p.name}
                        </div>
                        <div style={{ color: '#9d9ab8', fontSize: 11, marginTop: 2 }}>
                          {p.city} · 开始日期：{p.startDate}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        color: daysLeft <= 3 ? '#ec4899' : '#ea580c',
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: 'var(--font-primary)',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {daysLeft === 0 ? '今天开始' : `${daysLeft} 天后`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ===== 逾期预警条 ===== */}
      {(displayData.dueToday.length > 0 || displayData.overdueMild.length > 0 || displayData.overdueSevere.length > 0) && (
        <div
          style={{
            background: displayData.overdueSevere.length > 0
              ? 'linear-gradient(135deg, rgba(236,72,153,0.12) 0%, rgba(236,72,153,0.05) 100%)'
              : 'linear-gradient(135deg, rgba(234,88,12,0.10) 0%, rgba(217,119,6,0.05) 100%)',
            border: displayData.overdueSevere.length > 0
              ? '1px solid rgba(236,72,153,0.35)'
              : '1px solid rgba(234,88,12,0.3)',
            borderRadius: 12,
            padding: '14px 20px',
            marginBottom: 20,
            display: 'flex',
            gap: 24,
            alignItems: 'center',
            flexWrap: 'wrap' as const,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {displayData.overdueSevere.length > 0 ? (
              <AlertOutlined style={{ color: '#ec4899', fontSize: 18 }} />
            ) : (
              <WarningOutlined style={{ color: '#ea580c', fontSize: 18 }} />
            )}
            <span style={{
              color: displayData.overdueSevere.length > 0 ? '#ec4899' : '#ea580c',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'var(--font-primary)',
              letterSpacing: 1,
            }}>
              {displayData.overdueSevere.length > 0 ? '严重逾期警告' : '逾期提醒'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 18, flex: 1, flexWrap: 'wrap' as const, fontSize: 12 }}>
            {displayData.dueToday.length > 0 && (
              <span style={{ color: '#46436a' }}>
                <strong style={{ color: '#d97706', fontSize: 14 }}>{displayData.dueToday.length}</strong>
                <span style={{ marginLeft: 4 }}>个项目今日到期</span>
              </span>
            )}
            {displayData.overdueMild.length > 0 && (
              <span style={{ color: '#46436a' }}>
                <strong style={{ color: '#ea580c', fontSize: 14 }}>{displayData.overdueMild.length}</strong>
                <span style={{ marginLeft: 4 }}>个项目轻度逾期（1-6 天）</span>
              </span>
            )}
            {displayData.overdueSevere.length > 0 && (
              <span style={{ color: '#46436a' }}>
                <strong style={{ color: '#ec4899', fontSize: 14 }}>{displayData.overdueSevere.length}</strong>
                <span style={{ marginLeft: 4 }}>个项目严重逾期（7+ 天）</span>
              </span>
            )}
          </div>
          <Button
            type="default"
            size="small"
            onClick={async () => {
              // 自动跳到第一个逾期/今日到期项目
              const all = [...displayData.overdueSevere, ...displayData.overdueMild, ...displayData.dueToday];
              if (all.length > 0) navigate(`/projects/${all[0].id}`);
            }}
            style={{
              borderColor: 'rgba(234,88,12,0.45)',
              color: '#ea580c',
              flexShrink: 0,
            }}
          >
            立即查看
          </Button>
        </div>
      )}

      <div className="kpi-cards-row">
        <KpiCard
          title="未开始项目数"
          value={kpiData.notStartedProjects}
          icon={<ProjectOutlined style={{ color: '#ea580c' }} />}
          tooltip="所有未开始的项目总数"
        />
        <KpiCard
          title="已完成项目数"
          value={kpiData.completedProjects}
          icon={<CheckCircleOutlined style={{ color: '#16a34a' }} />}
          tooltip="已完成测试的项目总数"
        />
        <KpiCard
          title="总IT产出"
          value={kpiData.totalItOutput}
          suffix="MW"
          icon={<ThunderboltOutlined style={{ color: '#d97706' }} />}
          tooltip="累计IT产出量（MW）"
        />
        <KpiCard
          title="平均投入人力"
          value={kpiData.avgManpower}
          suffix="人"
          icon={<TeamOutlined style={{ color: '#0d9488' }} />}
          tooltip="已完成项目的平均计划投入人力"
        />
      </div>

      <div className="charts-row">
        <div className="chart-container">
          <h4>项目状态分布</h4>
          <ReactEChartsCore
            echarts={echarts}
            option={statusPieOption}
            style={{ height: 300 }}
            onEvents={{
              click: handlePieClick,
            }}
          />
        </div>
        <div className="chart-container">
          <h4>地区兆瓦数分布</h4>
          <ReactEChartsCore echarts={echarts} option={regionMwBarOption} style={{ height: 300 }} />
        </div>
      </div>

      <div className="chart-container" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h4 style={{ margin: 0 }}>项目进度甘特图</h4>
            {/* 时间单位选择器 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f8f7fd', borderRadius: 8, padding: 2 }}>
              {([
                { value: 'day', label: '日' },
                { value: 'week', label: '周' },
                { value: 'month', label: '月' },
                { value: 'quarter', label: '季' },
                { value: 'year', label: '年' },
              ] as { value: GanttUnit; label: string }[]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setGanttUnit(opt.value)}
                  style={{
                    padding: '3px 10px',
                    fontSize: 12,
                    fontFamily: 'var(--font-primary)',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: ganttUnit === opt.value
                      ? 'linear-gradient(135deg, #6366f1, #a855f7)'
                      : 'transparent',
                    color: ganttUnit === opt.value
                      ? '#fff'
                      : '#6b6892',
                    fontWeight: ganttUnit === opt.value ? 600 : 400,
                    boxShadow: ganttUnit === opt.value ? '0 2px 8px rgba(99,102,241,0.3)' : 'none',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {/* 状态筛选器 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FilterOutlined style={{ color: '#6b6892', fontSize: 14 }} />
            <Select
              mode="multiple"
              value={selectedStatuses}
              onChange={setSelectedStatuses}
              placeholder="筛选项目状态"
              style={{ minWidth: 200, maxWidth: 300 }}
              options={STATUS_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
              tagRender={tagRender}
              maxTagCount={3}
              maxTagPlaceholder={(omittedValues) => `+${omittedValues.length} 项`}
              dropdownStyle={{ background: '#f6f5fc', border: '1px solid #dcd9f2' }}
              popupClassName="dark-select-dropdown"
            />
            <Button
              type="link"
              size="small"
              onClick={() => setSelectedStatuses(['未开始', '测试中'])}
              style={{ color: '#6b6892', fontSize: 12, padding: '0 4px' }}
            >
              重置
            </Button>
          </div>
        </div>
        <GanttChart projects={ganttProjects} unit={ganttUnit} />
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#6b6892', fontSize: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d97706', display: 'inline-block' }} />
              未开始 <b style={{ color: '#1e1b2e' }}>{notStartedCount}</b>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1', display: 'inline-block' }} />
              测试中 <b style={{ color: '#1e1b2e' }}>{activeCount}</b>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
              已完成 <b style={{ color: '#1e1b2e' }}>{completedCount}</b>
            </span>
            <span style={{ color: '#9d9ab8' }}>个项目</span>
          </div>
          <Button
            type="link"
            size="small"
            onClick={() => navigate('/history')}
            style={{ color: '#6366f1', fontFamily: 'var(--font-primary)' }}
          >
            查看历史项目（{historyProjects.filter((p) => p.status === '已完成').length}个）→
          </Button>
        </div>
      </div>
    </div>
  );
}

// pulse 动画
const pulseStyle = `
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.2); }
}
`;

// 注入动画样式
if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.textContent = pulseStyle;
  document.head.appendChild(styleEl);
}

export default Dashboard;
