import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Spin } from 'antd';
import { ReloadOutlined, ProjectOutlined, CheckCircleOutlined, ThunderboltOutlined, ClockCircleOutlined } from '@ant-design/icons';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { PieChart, BarChart } from 'echarts/charts';
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import KpiCard from '../../components/KpiCard';
import GanttChart from '../../components/GanttChart';
import {
  mockKpiData,
  mockStatusDistribution,
  mockRegionMwOutput,
  mockProjects,
} from '../../data/mock';

echarts.use([PieChart, BarChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);

function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [kpiData] = useState(mockKpiData);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  const handleRefresh = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 500);
  };

  const statusPieOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item' as const,
      formatter: '{b}: {c} 个 ({d}%)',
      backgroundColor: 'rgba(13, 31, 60, 0.92)',
      borderColor: 'rgba(77, 159, 255, 0.3)',
      borderWidth: 1,
      textStyle: { color: 'rgba(255,255,255,0.85)', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 12 },
    },
    legend: {
      bottom: 0,
      textStyle: { color: 'rgba(255,255,255,0.5)', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 12 },
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
          borderColor: 'rgba(8, 14, 28, 0.8)',
          borderWidth: 3,
        },
        label: {
          show: true,
          color: 'rgba(255,255,255,0.7)',
          fontFamily: 'Outfit, Noto Sans SC, sans-serif',
          fontSize: 12,
          formatter: '{b}\n{d}%',
        },
        data: mockStatusDistribution.map((item) => ({
          name: item.name,
          value: item.value,
          itemStyle: {
            color:
              item.name === '未开始'
                ? '#faad14'
                : item.name === '测试中'
                ? '#4d9fff'
                : item.name === '已完成'
                ? '#52c41a'
                : '#ff4d4f',
          },
        })),
      },
    ],
  }), [mockStatusDistribution]);

  const regionMwBarOption = useMemo(() => {
    // 按兆瓦数降序排列：左高右低
    const sorted = [...mockRegionMwOutput].sort((a, b) => b.mwOutput - a.mwOutput);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis' as const,
        formatter: '{b}: {c} MW',
        backgroundColor: 'rgba(13, 31, 60, 0.92)',
        borderColor: 'rgba(77, 159, 255, 0.3)',
        borderWidth: 1,
        textStyle: { color: 'rgba(255,255,255,0.85)', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 12 },
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
        axisLabel: { color: 'rgba(255,255,255,0.5)', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 11 },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        name: 'MW',
        nameTextStyle: { color: 'rgba(255,255,255,0.4)', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 11 },
        axisLabel: { color: 'rgba(255,255,255,0.5)', fontFamily: 'Outfit, Noto Sans SC, sans-serif', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      },
      series: [
        {
          name: '兆瓦产出',
          type: 'bar',
          data: sorted.map((item) => item.mwOutput),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#faad14' },
              { offset: 1, color: '#d48806' },
            ]),
            borderRadius: [6, 6, 0, 0],
          },
          barWidth: '50%',
          label: {
            show: true,
            position: 'top' as const,
            color: 'rgba(250,173,20,0.85)',
            fontSize: 11,
            fontFamily: 'Outfit, Noto Sans SC, sans-serif',
            formatter: '{c} MW',
          },
        },
      ],
    };
  }, [mockRegionMwOutput]);

  const ganttProjects = useMemo(() => mockProjects
    .filter((p) => p.status === '测试中' || p.status === '未开始')
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  , [mockProjects]);

  const completedProjects = useMemo(() => mockProjects
    .filter((p) => p.status === '已完成')
  , [mockProjects]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 120, color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-primary)' }}>
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
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-primary)', borderRadius: 8 }}
        >
          刷新
        </Button>
      </div>

      <div className="kpi-cards-row">
        <KpiCard
          title="进行中项目数"
          value={kpiData.activeProjects}
          trend={kpiData.activeProjectsTrend}
          icon={<ProjectOutlined style={{ color: '#4d9fff' }} />}
          tooltip="当前正在进行中的测试项目总数"
        />
        <KpiCard
          title="已完成项目数"
          value={kpiData.completedProjects}
          trend={kpiData.completedProjectsTrend}
          icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
          tooltip="已完成测试的项目总数"
        />
        <KpiCard
          title="总IT产出"
          value={kpiData.totalItOutput}
          trend={kpiData.totalItOutputTrend}
          suffix="MW"
          icon={<ThunderboltOutlined style={{ color: '#faad14' }} />}
          tooltip="累计IT产出量（MW）"
        />
        <KpiCard
          title="平均项目周期"
          value={kpiData.avgProjectCycle}
          trend={kpiData.avgProjectCycleTrend}
          suffix="天"
          icon={<ClockCircleOutlined style={{ color: '#00d4aa' }} />}
          tooltip="所有已完成项目的平均执行周期"
        />
      </div>

      <div className="charts-row">
        <div className="chart-container">
          <h4>项目状态分布</h4>
          <ReactEChartsCore echarts={echarts} option={statusPieOption} style={{ height: 300 }} />
        </div>
        <div className="chart-container">
          <h4>地区兆瓦数分布</h4>
          <ReactEChartsCore echarts={echarts} option={regionMwBarOption} style={{ height: 300 }} />
        </div>
      </div>

      <div className="chart-container" style={{ marginBottom: 20 }}>
        <h4 style={{ marginBottom: 16 }}>项目进度甘特图</h4>
        <GanttChart projects={ganttProjects} />
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
          <span>进行中/未开始：{ganttProjects.length} 个项目</span>
          <Button
            type="link"
            size="small"
            onClick={() => navigate('/history')}
            style={{ color: '#4d9fff', fontFamily: 'var(--font-primary)' }}
          >
            已完成项目（{completedProjects.length}个）→ 历史项目
          </Button>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
