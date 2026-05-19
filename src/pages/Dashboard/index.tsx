import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Spin } from 'antd';
import { ReloadOutlined, ProjectOutlined, CheckCircleOutlined, ThunderboltOutlined, ClockCircleOutlined } from '@ant-design/icons';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { PieChart, BarChart } from 'echarts/charts';
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import KpiCard from '../../components/KpiCard';
import StatusTag from '../../components/StatusTag';
import {
  mockKpiData,
  mockStatusDistribution,
  mockCustomerContracts,
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

  const statusPieOption = {
    tooltip: {
      trigger: 'item' as const,
      formatter: '{b}: {c} 个 ({d}%)',
    },
    legend: {
      bottom: 0,
    },
    series: [
      {
        name: '项目状态分布',
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: {
          show: true,
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
                ? '#1677ff'
                : item.name === '已完成'
                ? '#52c41a'
                : '#ff4d4f',
          },
        })),
      },
    ],
  };

  const contractBarOption = {
    tooltip: {
      trigger: 'axis' as const,
      formatter: '{b}: {c} 万元',
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'category' as const,
      data: mockCustomerContracts.map((item) => item.name),
      axisLabel: { rotate: 0 },
    },
    yAxis: {
      type: 'value' as const,
      name: '合同金额（万元）',
    },
    series: [
      {
        name: '合同金额',
        type: 'bar',
        data: mockCustomerContracts.map((item) => item.amount),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#1677ff' },
            { offset: 1, color: '#69b1ff' },
          ]),
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: '50%',
      },
    ],
  };

  const watchProjects = mockProjects
    .filter((p) => p.status === '测试中' || p.status === '未开始')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: (typeof watchProjects)[0]) => (
        <a onClick={() => navigate(`/projects/${record.id}`)}>{text}</a>
      ),
    },
    { title: '客户', dataIndex: 'customer', key: 'customer' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => <StatusTag status={status} />,
    },
    { title: '开始日期', dataIndex: 'startDate', key: 'startDate' },
    { title: '结束日期', dataIndex: 'endDate', key: 'endDate' },
    { title: 'IT产出（MW）', dataIndex: 'itOutput', key: 'itOutput' },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: (typeof watchProjects)[0]) => (
        <Button type="link" size="small" onClick={() => navigate(`/projects/${record.id}`)}>
          查看
        </Button>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 120 }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h3>工作概览</h3>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
          刷新
        </Button>
      </div>

      <div className="kpi-cards-row">
        <KpiCard
          title="进行中项目数"
          value={kpiData.activeProjects}
          trend={kpiData.activeProjectsTrend}
          icon={<ProjectOutlined style={{ color: '#1677ff' }} />}
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
          icon={<ClockCircleOutlined style={{ color: '#722ed1' }} />}
          tooltip="所有已完成项目的平均执行周期"
        />
      </div>

      <div className="charts-row">
        <div className="chart-container">
          <h4>项目状态分布</h4>
          <ReactEChartsCore echarts={echarts} option={statusPieOption} style={{ height: 320 }} />
        </div>
        <div className="chart-container">
          <h4>客户合同金额分布</h4>
          <ReactEChartsCore echarts={echarts} option={contractBarOption} style={{ height: 320 }} />
        </div>
      </div>

      <div className="chart-container">
        <h4 style={{ marginBottom: 16 }}>项目关注列表</h4>
        <Table
          columns={columns}
          dataSource={watchProjects}
          rowKey="id"
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 个项目` }}
          scroll={{ x: 900 }}
        />
      </div>
    </div>
  );
}

export default Dashboard;
