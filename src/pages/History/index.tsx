import { useState, useMemo } from 'react';
import {
  Table, Empty, Button, Modal, Form, Input, Select, DatePicker, InputNumber, Tag, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, LinkOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { HistoricalProject } from '../../types';

const statusColors: Record<string, string> = {
  '未开始': '#8c8c8c',
  '测试中': '#4d9fff',
  '已完成': '#52c41a',
  '阻塞': '#ff7875',
};

const priorityColors: Record<string, string> = {
  '高': '#ff7875',
  '中': '#faad14',
  '低': '#52c41a',
};

function History() {
  const [data, setData] = useState<HistoricalProject[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const handleAdd = () => {
    form.resetFields();
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const newProject: HistoricalProject = {
        id: `h${Date.now()}`,
        name: values.name,
        customer: values.customer,
        status: values.status,
        priority: values.priority,
        manager: values.manager,
        startDate: values.startDate ? values.startDate.format('YYYY-MM-DD') : '',
        endDate: values.endDate ? values.endDate.format('YYYY-MM-DD') : '',
        plannedDeliveryDate: values.plannedDeliveryDate ? values.plannedDeliveryDate.format('YYYY-MM-DD') : '',
        actualDeliveryDate: values.actualDeliveryDate ? values.actualDeliveryDate.format('YYYY-MM-DD') : '',
        itOutput: values.itOutput,
        contractAmount: values.contractAmount,
        businessType: values.businessType || '',
        description: values.description || '',
        docLink: values.docLink || '',
        updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      };
      setData((prev) => [newProject, ...prev]);
      message.success('历史项目记录添加成功');
      setModalOpen(false);
      form.resetFields();
    } catch {
      // validation failed
    }
  };

  const columns: ColumnsType<HistoricalProject> = useMemo(
    () => [
      {
        title: '项目名称',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
        width: 160,
        render: (text: string) => <strong style={{ color: '#fff' }}>{text}</strong>,
      },
      {
        title: '客户',
        dataIndex: 'customer',
        key: 'customer',
        width: 120,
        render: (text: string) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{text}</span>,
      },
      {
        title: '项目经理',
        dataIndex: 'manager',
        key: 'manager',
        width: 120,
        render: (text: string) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{text}</span>,
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 100,
        render: (val: string) => (
          <Tag style={{ background: `${statusColors[val]}22`, color: statusColors[val], border: `1px solid ${statusColors[val]}44`, borderRadius: 4, fontSize: 12 }}>
            {val}
          </Tag>
        ),
      },
      {
        title: '优先级',
        dataIndex: 'priority',
        key: 'priority',
        width: 90,
        render: (val: string) => (
          <Tag style={{ background: `${priorityColors[val]}22`, color: priorityColors[val], border: `1px solid ${priorityColors[val]}44`, borderRadius: 4, fontSize: 12 }}>
            {val}
          </Tag>
        ),
      },
      {
        title: '开始日期',
        dataIndex: 'startDate',
        key: 'startDate',
        width: 110,
        render: (text: string) => <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text}</span>,
      },
      {
        title: '结束日期',
        dataIndex: 'endDate',
        key: 'endDate',
        width: 110,
        render: (text: string) => <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text}</span>,
      },
      {
        title: '计划交付',
        dataIndex: 'plannedDeliveryDate',
        key: 'plannedDeliveryDate',
        width: 110,
        render: (text?: string) => <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text || '-'}</span>,
      },
      {
        title: '实际交付',
        dataIndex: 'actualDeliveryDate',
        key: 'actualDeliveryDate',
        width: 110,
        render: (text?: string) => <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text || '-'}</span>,
      },
      {
        title: 'IT产出(MW)',
        dataIndex: 'itOutput',
        key: 'itOutput',
        width: 110,
        sorter: (a, b) => a.itOutput - b.itOutput,
        render: (val: number) => <span style={{ color: '#7cb8ff' }}>{val} MW</span>,
      },
      {
        title: '合同金额(万)',
        dataIndex: 'contractAmount',
        key: 'contractAmount',
        width: 120,
        render: (val?: number) => <span style={{ color: 'rgba(255,255,255,0.6)' }}>{val ? `${val}万` : '-'}</span>,
      },
      {
        title: '业务类型',
        dataIndex: 'businessType',
        key: 'businessType',
        width: 120,
        render: (text?: string) => <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text || '-'}</span>,
      },
      {
        title: '项目描述',
        dataIndex: 'description',
        key: 'description',
        width: 200,
        ellipsis: true,
        render: (text?: string) => <span style={{ color: 'rgba(255,255,255,0.5)' }}>{text || '-'}</span>,
      },
      {
        title: '测试管理链接',
        dataIndex: 'docLink',
        key: 'docLink',
        width: 120,
        render: (link: string) =>
          link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#4d9fff' }}>
              <LinkOutlined /> 查看
            </a>
          ) : (
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>-</span>
          ),
      },
    ],
    []
  );

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3>历史测试项目看板</h3>
          <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 4, fontSize: 13 }}>历史项目复盘分析</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAdd}
          style={{
            background: 'linear-gradient(135deg, #4d9fff, #69b1ff)',
            border: 'none',
            fontFamily: 'var(--font-primary)',
            fontWeight: 500,
            borderRadius: 8,
            boxShadow: '0 4px 14px rgba(77,159,255,0.35)',
          }}
        >
          添加记录
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        pagination={{
          pageSize: 10,
          showTotal: (total) => `共 ${total} 个历史项目`,
        }}
        scroll={{ x: 1600 }}
        locale={{
          emptyText: (
            <Empty
              description={
                <span style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-primary)' }}>
                  暂无历史项目记录
                </span>
              }
            />
          ),
        }}
      />

      {/* 添加记录弹窗 */}
      <Modal
        title="添加历史项目记录"
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        width={640}
        okText="确认添加"
        cancelText="取消"
        okButtonProps={{ style: { background: 'linear-gradient(135deg, #4d9fff, #69b1ff)', border: 'none' } }}
        bodyStyle={{ background: 'rgba(13,31,60,0.95)' }}
        style={{ top: 60 }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="请输入项目名称" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="customer" label="客户" rules={[{ required: true, message: '请输入客户名称' }]}>
              <Input placeholder="请输入客户名称" />
            </Form.Item>
            <Form.Item name="manager" label="项目经理" rules={[{ required: true, message: '请输入项目经理' }]}>
              <Input placeholder="请输入项目经理姓名" />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
              <Select placeholder="请选择状态">
                <Select.Option value="未开始">未开始</Select.Option>
                <Select.Option value="测试中">测试中</Select.Option>
                <Select.Option value="已完成">已完成</Select.Option>
                <Select.Option value="阻塞">阻塞</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="priority" label="优先级" rules={[{ required: true, message: '请选择优先级' }]}>
              <Select placeholder="请选择优先级">
                <Select.Option value="高">高</Select.Option>
                <Select.Option value="中">中</Select.Option>
                <Select.Option value="低">低</Select.Option>
              </Select>
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="startDate" label="开始日期" rules={[{ required: true, message: '请选择开始日期' }]}>
              <DatePicker style={{ width: '100%' }} placeholder="请选择开始日期" />
            </Form.Item>
            <Form.Item name="endDate" label="结束日期">
              <DatePicker style={{ width: '100%' }} placeholder="请选择结束日期" />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="plannedDeliveryDate" label="计划交付日期">
              <DatePicker style={{ width: '100%' }} placeholder="请选择计划交付日期" />
            </Form.Item>
            <Form.Item name="actualDeliveryDate" label="实际交付日期">
              <DatePicker style={{ width: '100%' }} placeholder="请选择实际交付日期" />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="itOutput" label="IT产出（MW）" rules={[{ required: true, message: '请输入IT产出' }]}>
              <InputNumber style={{ width: '100%' }} min={0} step={0.1} placeholder="请输入IT产出" />
            </Form.Item>
            <Form.Item name="contractAmount" label="合同金额（万元）">
              <InputNumber style={{ width: '100%' }} min={0} step={0.01} placeholder="请输入合同金额" />
            </Form.Item>
          </div>
          <Form.Item name="businessType" label="业务类型">
            <Input placeholder="请输入业务类型（如：新建测试、扩容测试）" />
          </Form.Item>
          <Form.Item name="docLink" label="测试管理链接">
            <Input placeholder="请输入测试管理文档链接" />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={3} placeholder="请输入项目描述" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default History;
