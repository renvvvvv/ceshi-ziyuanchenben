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

// 历史项目初始数据
const INITIAL_HISTORY_DATA: HistoricalProject[] = [
  {
    id: 'h001',
    name: '腾讯深圳科兴数据中心二期测试',
    customer: '腾讯科技（深圳）有限公司',
    status: '已完成',
    priority: '高',
    manager: '张建国',
    startDate: '2025-03-10',
    endDate: '2025-05-20',
    plannedDeliveryDate: '2025-05-25',
    actualDeliveryDate: '2025-05-20',
    itOutput: 12.8,
    contractAmount: 185,
    businessType: '新建测试',
    description: '深圳科兴数据中心二期IT负载测试、暖通系统压力测试及消防系统验收测试，包含40项测试脚本全覆盖。',
    docLink: 'https://docs.qq.com/doc/DXRGc3RmUEdxdnZt',
    updatedAt: '2025-05-22 14:30:00',
  },
  {
    id: 'h002',
    name: '阿里巴巴杭州仁和数据中心扩容测试',
    customer: '阿里巴巴云计算有限公司',
    status: '已完成',
    priority: '高',
    manager: '李明辉',
    startDate: '2025-04-15',
    endDate: '2025-07-08',
    plannedDeliveryDate: '2025-07-15',
    actualDeliveryDate: '2025-07-08',
    itOutput: 18.5,
    contractAmount: 260,
    businessType: '扩容测试',
    description: '仁和数据中心A区扩容项目测试验证，涵盖电气系统绝缘耐压测试、暖通系统制冷量校验、弱电综合布线检测等28项测试。',
    docLink: '',
    updatedAt: '2025-07-10 09:15:00',
  },
  {
    id: 'h003',
    name: '字节跳动北京房山数据中心一期测试',
    customer: '北京字跳网络技术有限公司',
    status: '测试中',
    priority: '中',
    manager: '王海涛',
    startDate: '2025-06-01',
    endDate: '',
    plannedDeliveryDate: '2025-08-20',
    actualDeliveryDate: undefined,
    itOutput: 0,
    contractAmount: 150,
    businessType: '新建测试',
    description: '房山数据中心一期新建项目，目前进行电气系统和暖通系统的初步测试阶段，消防系统待进场。',
    docLink: '',
    updatedAt: '2025-06-23 16:45:00',
  },
  {
    id: 'h004',
    name: '华为东莞松山湖数据中心验收测试',
    customer: '华为技术有限公司',
    status: '已完成',
    priority: '高',
    manager: '陈晓东',
    startDate: '2024-11-05',
    endDate: '2025-02-18',
    plannedDeliveryDate: '2025-02-28',
    actualDeliveryDate: '2025-02-18',
    itOutput: 9.6,
    contractAmount: 130,
    businessType: '验收测试',
    description: '松山湖数据中心整体验收测试，包含UPS双路切换测试、精密空调能效测试、气体灭火系统联动测试等35项关键测试点。',
    docLink: 'https://docs.qq.com/doc/DTXRGc3RmUEdxdnZt2',
    updatedAt: '2025-02-20 11:00:00',
  },
  {
    id: 'h005',
    name: '百度顺义云计算中心改造测试',
    customer: '百度在线网络技术（北京）有限公司',
    status: '阻塞',
    priority: '低',
    manager: '赵志远',
    startDate: '2025-05-20',
    endDate: '',
    plannedDeliveryDate: '2025-07-30',
    actualDeliveryDate: undefined,
    itOutput: 0,
    contractAmount: 95,
    businessType: '改造测试',
    description: '顺义云计算中心老旧机房改造项目的电气和暖通改造后测试验证，因客户侧设备到货延迟导致测试进度受阻。',
    docLink: '',
    updatedAt: '2025-06-20 10:20:00',
  },
  {
    id: 'h006',
    name: '京东廊坊华北数据中心三期测试',
    customer: '京东云计算有限公司',
    status: '已完成',
    priority: '中',
    manager: '刘思琪',
    startDate: '2025-01-12',
    endDate: '2025-04-30',
    plannedDeliveryDate: '2025-04-30',
    actualDeliveryDate: '2025-04-30',
    itOutput: 15.2,
    contractAmount: 210,
    businessType: '新建测试',
    description: '廊坊华北数据中心三期新建项目全流程测试验证，从单机调试到联合调试全部按计划完成。',
    docLink: '',
    updatedAt: '2025-05-02 17:00:00',
  },
];

function History() {
  const [data, setData] = useState<HistoricalProject[]>(INITIAL_HISTORY_DATA);
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
