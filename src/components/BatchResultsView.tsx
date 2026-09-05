import { Table, Button, Space, Descriptions, Collapse, Statistic, Row, Col, Tag, message, Typography, Card } from 'antd';
import { ExportOutlined, TeamOutlined, ThunderboltOutlined, ToolOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { exportReportToExcel, exportBatchResultsToExcel } from '../utils/excelUtils';
import type { BatchReportRow } from '../utils/excelUtils';
import type { ResourceReport, ResourceInput } from '../utils/resourceCalculator';

const { Text } = Typography;

function MiniReport({ report, input }: { report: ResourceReport; input: ResourceInput }) {
  if (!report?.汇总) return <Text type="secondary">无数据</Text>;
  const dur = input.total_duration;

  return (
    <div style={{ padding: 16, background: '#f6f5fc', borderRadius: 8 }}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Statistic title="总容量" value={input.total_mw} suffix="MW" /></Col>
        <Col span={6}><Statistic title="总工期" value={input.total_duration} suffix="天" /></Col>
        <Col span={6}><Statistic title="峰值同时在场" value={report.汇总.峰值同时在场} suffix="人" valueStyle={{ color: '#6366f1' }} /></Col>
        <Col span={6}><Statistic title="总人天" value={report.汇总.总人天} suffix="人·天" valueStyle={{ color: '#16a34a' }} /></Col>
      </Row>

      <Collapse size="small" items={[
        {
          key: 'staff', label: <><TeamOutlined /> 人员清单</>,
          children: (
            <Table size="small" bordered pagination={false}
              dataSource={[
                { key: 1, role: '测试经理', count: 1, days: dur, manDays: dur },
                { key: 2, role: '电气主测', count: 1, days: dur, manDays: dur },
                { key: 3, role: '柴发主测', count: report.柴发.主测 || 0, days: dur, manDays: (report.柴发.主测 || 0) * dur },
                { key: 4, role: '暖通主测', count: report.固定人员.暖通主测 || 1, days: dur, manDays: (report.固定人员.暖通主测 || 1) * dur },
                { key: 5, role: '消防主测', count: report.消防.主测 || 1, days: dur, manDays: (report.消防.主测 || 1) * dur },
                { key: 6, role: '弱电主测', count: report.弱电.主测 || 1, days: dur, manDays: (report.弱电.主测 || 1) * dur },
                { key: 7, role: '电气测试员', count: report.IT链路.在场 + report.动力链路.在场 + (report.混合链路?.在场 || 0), days: Math.max(report.IT链路.实际工期, report.动力链路.实际工期), manDays: report.IT链路.人天 + report.动力链路.人天 + (report.混合链路?.人天 || 0) },
                { key: 8, role: '暖通测试员', count: report.暖通.峰值在场, days: dur, manDays: report.暖通.总人天 },
                { key: 9, role: '弱电测试员', count: (report.弱电 as any).电气记录员 || (report.弱电 as any).记录员 || 0, days: dur, manDays: ((report.弱电 as any).电气记录员 || (report.弱电 as any).记录员 || 0) * dur },
                { key: 10, role: '消防测试员', count: report.消防.测试员 || 0, days: dur, manDays: (report.消防.测试员 || 0) * dur },
                { key: 11, role: '记录员', count: (report.弱电.暖通记录员 || 0) + report.柴发.记录员, days: dur, manDays: ((report.弱电.暖通记录员 || 0) + report.柴发.记录员) * dur },
                { key: 'sum', role: <Text strong>峰值</Text>, count: <Text strong>{report.汇总.峰值同时在场}</Text>, days: <Text strong>{dur}</Text>, manDays: <Text strong>{report.汇总.总人天}</Text> },
              ]}
              columns={[
                { title: '岗位', dataIndex: 'role', width: 140 },
                { title: '人数', dataIndex: 'count', width: 70 },
                { title: '天数', dataIndex: 'days', width: 70 },
                { title: '人天', dataIndex: 'manDays', width: 80 },
              ]}
            />
          ),
        },
        {
          key: 'load', label: <><ToolOutlined /> 假负载清单</>,
          children: (
            <Table size="small" bordered pagination={false}
              dataSource={(report.假负载清单 || []).map((f, i) => ({ ...f, key: i }))}
              columns={[
                { title: '名称', dataIndex: 'name' },
                { title: '数量', dataIndex: 'count', width: 70 },
                { title: '天数', dataIndex: 'days', width: 70 },
                { title: '总台天', dataIndex: 'totalUnits', width: 80 },
                { title: '规格', dataIndex: 'spec' },
              ]}
            />
          ),
        },
        {
          key: 'tools', label: <><ToolOutlined /> 工器具清单</>,
          children: (
            <Table size="small" bordered pagination={false}
              dataSource={(report.工具清单 || []).map((t, i) => ({ ...t, key: i }))}
              columns={[
                { title: '名称', dataIndex: 'name', width: 160 },
                { title: '数量', dataIndex: 'count', width: 60 },
                { title: '型号', dataIndex: 'model', width: 120 },
                { title: '备注', dataIndex: 'note' },
              ]}
              scroll={{ x: 500 }}
            />
          ),
        },
        {
          key: 'detail', label: <><InfoCircleOutlined /> 详细计算</>,
          children: (
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="IT并行数">{report.IT链路.并行数}</Descriptions.Item>
              <Descriptions.Item label="IT测试工期">{report.IT链路.实际工期}天</Descriptions.Item>
              <Descriptions.Item label="IT同时在场">{report.IT链路.在场}人</Descriptions.Item>
              <Descriptions.Item label="IT总人天">{report.IT链路.人天}</Descriptions.Item>
              <Descriptions.Item label="动力并行数">{report.动力链路.并行数}</Descriptions.Item>
              <Descriptions.Item label="动力测试工期">{report.动力链路.实际工期}天</Descriptions.Item>
              <Descriptions.Item label="动力同时在场">{report.动力链路.在场}人</Descriptions.Item>
              <Descriptions.Item label="动力总人天">{report.动力链路.人天}</Descriptions.Item>
              <Descriptions.Item label="暖通总组数">{report.暖通.暖通总组数}</Descriptions.Item>
              <Descriptions.Item label="暖通峰值在场">{report.暖通.峰值在场}人</Descriptions.Item>
              <Descriptions.Item label="暖通总人天">{report.暖通.总人天}</Descriptions.Item>
              <Descriptions.Item label="6kW总需求">{report.负载?.['6kW']?.总需求 || 0}台</Descriptions.Item>
              <Descriptions.Item label="8kW总需求">{report.负载?.['8kW']?.总需求 || 0}台</Descriptions.Item>
              <Descriptions.Item label="500kW">{report.负载?.['500kW']?.总需求 || 0}台</Descriptions.Item>
              <Descriptions.Item label="300kW">{report.负载?.['300kW']?.总需求 || 0}台</Descriptions.Item>
            </Descriptions>
          ),
        },
      ]} />
    </div>
  );
}

interface BatchResultsViewProps {
  batchResults: BatchReportRow[];
  onClose: () => void;
}

function BatchResultsView({ batchResults, onClose }: BatchResultsViewProps) {
  const validResults = batchResults.filter(r => !r.error);
  const totalPeak = validResults.reduce((s, r) => s + (r.report?.汇总?.峰值同时在场 || 0), 0);
  const totalMD = validResults.reduce((s, r) => s + (r.report?.汇总?.总人天 || 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>群算结果（{validResults.length}/{batchResults.length} 条有效）</Text>
          <Text type="secondary" style={{ marginLeft: 16 }}>
            累计峰值 {totalPeak} 人 | 累计人天 {totalMD}
          </Text>
        </div>
        <Space>
          <Button onClick={onClose}>返回</Button>
          <Button type="primary" icon={<ExportOutlined />}
            onClick={() => exportBatchResultsToExcel(batchResults)}>
            导出全部
          </Button>
        </Space>
      </div>

      <Table
        dataSource={batchResults.map((r, i) => ({ ...r, key: i }))}
        size="small"
        bordered
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }}
        expandable={{
          expandedRowRender: (r: BatchReportRow) => {
            if (r.error) return <Text type="danger">{r.error}</Text>;
            return <MiniReport report={r.report!} input={r.input!} />;
          },
          rowExpandable: (r: BatchReportRow) => !r.error,
        }}
        columns={[
          { title: '序号', dataIndex: 'index', width: 60 },
          { title: '总MW', width: 70, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input!.total_mw },
          { title: '工期', width: 60, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input!.total_duration },
          { title: '单柜kW', width: 65, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input!.cabinet_power || (r.input!.cabinet_power_segments || []).map((s: {power: number}) => s.power).join('/') || '-' },
          { title: '机柜数', width: 65, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input!.total_cabinets || 0 },
          { title: 'IT配置', width: 160, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input!.it_transformers.map(([c, n]) => `${c}MW×${n}`).join('+') },
          { title: '动力配置', width: 160, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.input!.power_transformers.map(([c, n]) => `${c}MW×${n}`).join('+') },
          { title: '峰值在场', width: 80, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : `${r.report?.汇总?.峰值同时在场 || 0}人` },
          { title: '总人天', width: 80, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : r.report?.汇总?.总人天 || 0 },
          { title: '空调', dataIndex: '', width: 80, render: (_: unknown, r: BatchReportRow) => r.error ? '-' : <Tag>{r.input!.ac_type}</Tag> },
          {
            title: '操作', width: 100,
            render: (_: unknown, r: BatchReportRow) => r.error ? null : (
              <Button size="small" type="link" icon={<ExportOutlined />}
                onClick={() => { exportReportToExcel(r.input!, r.report!); message.success('已下载'); }}>
                下载
              </Button>
            ),
          },
        ]}
        scroll={{ x: 1100 }}
        footer={() => (
          <div style={{ display: 'flex', gap: 24 }}>
            <Text>有效 {validResults.length}/{batchResults.length} 条</Text>
            <Text>累计峰值 <Text strong>{totalPeak} 人</Text></Text>
            <Text>累计人天 <Text strong>{totalMD} 人·天</Text></Text>
          </div>
        )}
      />
    </div>
  );
}

export default BatchResultsView;
