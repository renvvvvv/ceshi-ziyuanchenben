import { useState } from 'react';
import { Table } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { mockHistoricalProjects } from '../../data/mock';
import type { HistoricalProject } from '../../types';

function History() {
  const [data] = useState<HistoricalProject[]>(mockHistoricalProjects);

  const columns: ColumnsType<HistoricalProject> = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left' as const,
      width: 160,
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: 'IT产出（MW）',
      dataIndex: 'itOutput',
      key: 'itOutput',
      sorter: (a, b) => a.itOutput - b.itOutput,
      render: (val: number) => `${val} MW`,
    },
    {
      title: '项目开始时间',
      dataIndex: 'startDate',
      key: 'startDate',
      sorter: (a, b) => a.startDate.localeCompare(b.startDate),
    },
    {
      title: '项目结束时间',
      dataIndex: 'endDate',
      key: 'endDate',
      sorter: (a, b) => a.endDate.localeCompare(b.endDate),
    },
    { title: '客户', dataIndex: 'customer', key: 'customer' },
    {
      title: '测试管理链接',
      dataIndex: 'docLink',
      key: 'docLink',
      render: (link: string) => (
        <a href={link} target="_blank" rel="noopener noreferrer">
          <LinkOutlined /> 查看文档
        </a>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h3>历史测试项目看板</h3>
          <p style={{ color: '#666', marginTop: 4 }}>历史项目复盘分析</p>
        </div>
      </div>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        pagination={{
          pageSize: 10,
          showTotal: (total) => `共 ${total} 个历史项目`,
        }}
        scroll={{ x: 900 }}
      />
    </div>
  );
}

export default History;
