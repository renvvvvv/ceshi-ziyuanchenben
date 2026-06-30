import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Empty, Button, Modal, Form, Input, Select, DatePicker, InputNumber, message, Popconfirm, Space, Tag, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, LinkOutlined, SearchOutlined, EditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import StatusTag from '../../components/StatusTag';
import { mockHistoryProjects as INITIAL_HISTORY_DATA } from '../../data/mock';
import type { HistoricalProject } from '../../types';

function History() {
  const navigate = useNavigate();
  const [data, setData] = useState<HistoricalProject[]>(INITIAL_HISTORY_DATA);
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [searchText, setSearchText] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<HistoricalProject | null>(null);
  const [form] = Form.useForm();

  const filteredData = useMemo(() => {
    return data.filter((p) => {
      if (statusFilter !== '全部' && p.status !== statusFilter) return false;
      if (searchText) {
        const kw = searchText.toLowerCase();
        if (
          !p.name.toLowerCase().includes(kw)
          && !p.customer.toLowerCase().includes(kw)
          && !(p.city || '').toLowerCase().includes(kw)
          && !p.manager.toLowerCase().includes(kw)
        ) return false;
      }
      return true;
    });
  }, [data, statusFilter, searchText]);

  const handleAdd = () => {
    setEditingProject(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (record: HistoricalProject) => {
    setEditingProject(record);
    setModalOpen(true);
    setTimeout(() => {
      form.setFieldsValue({
        ...record,
        startDate: record.startDate ? dayjs(record.startDate) : undefined,
        endDate: record.endDate ? dayjs(record.endDate) : undefined,
        plannedDeliveryDate: record.plannedDeliveryDate ? dayjs(record.plannedDeliveryDate) : undefined,
        actualDeliveryDate: record.actualDeliveryDate ? dayjs(record.actualDeliveryDate) : undefined,
      });
    }, 50);
  };

  const handleDelete = (id: string) => {
    setData((prev) => prev.filter((p) => p.id !== id));
    message.success('历史项目已删除');
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingProject) {
        const updated: HistoricalProject = {
          ...editingProject,
          name: values.name,
          city: values.city || '',
          customer: values.customer,
          status: values.status,
          manager: values.manager,
          startDate: values.startDate ? values.startDate.format('YYYY-MM-DD') : '',
          endDate: values.endDate ? values.endDate.format('YYYY-MM-DD') : '',
          plannedDeliveryDate: values.plannedDeliveryDate ? values.plannedDeliveryDate.format('YYYY-MM-DD') : '',
          actualDeliveryDate: values.actualDeliveryDate ? values.actualDeliveryDate.format('YYYY-MM-DD') : undefined,
          itOutput: values.itOutput,
          businessType: values.businessType || '',
          description: values.description || '',
          docLink: values.docLink || '',
          updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        };
        setData((prev) => prev.map((p) => (p.id === editingProject.id ? updated : p)));
        message.success('历史项目已更新');
      } else {
        const newProject: HistoricalProject = {
          id: `h${Date.now()}`,
          name: values.name,
          city: values.city || '',
          customer: values.customer,
          status: values.status,
          manager: values.manager,
          startDate: values.startDate ? values.startDate.format('YYYY-MM-DD') : '',
          endDate: values.endDate ? values.endDate.format('YYYY-MM-DD') : '',
          plannedDeliveryDate: values.plannedDeliveryDate ? values.plannedDeliveryDate.format('YYYY-MM-DD') : '',
          actualDeliveryDate: values.actualDeliveryDate ? values.actualDeliveryDate.format('YYYY-MM-DD') : undefined,
          itOutput: values.itOutput,
          businessType: values.businessType || '',
          description: values.description || '',
          docLink: values.docLink || '',
          updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        };
        setData((prev) => [newProject, ...prev]);
        message.success('历史项目记录添加成功');
      }
      setModalOpen(false);
      setEditingProject(null);
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
        width: 220,
        render: (text: string, record: HistoricalProject) => (
          <a onClick={() => navigate(`/history/${record.id}`)} style={{ color: '#7cb8ff', fontWeight: 500 }}>{text}</a>
        ),
      },
      {
        title: '城市',
        dataIndex: 'city',
        key: 'city',
        width: 80,
        render: (text?: string) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{text || '-'}</span>,
      },
      {
        title: '客户',
        dataIndex: 'customer',
        key: 'customer',
        width: 140,
        ellipsis: true,
        render: (text: string) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{text}</span>,
      },
      {
        title: '项目经理',
        dataIndex: 'manager',
        key: 'manager',
        width: 100,
        render: (text: string) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{text}</span>,
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 90,
        render: (status: string) => <StatusTag status={status} />,
    },
    {
      title: '开始日期',
        dataIndex: 'startDate',
        key: 'startDate',
        width: 110,
        sorter: (a, b) => a.startDate.localeCompare(b.startDate),
        render: (text: string) => <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text}</span>,
      },
      {
        title: '结束日期',
        dataIndex: 'endDate',
        key: 'endDate',
        width: 110,
        sorter: (a, b) => a.endDate.localeCompare(b.endDate),
        render: (text: string) => <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text || '-'}</span>,
      },
      {
        title: '计划交付',
        dataIndex: 'plannedDeliveryDate',
        key: 'plannedDeliveryDate',
        width: 110,
        sorter: (a, b) => (a.plannedDeliveryDate || '').localeCompare(b.plannedDeliveryDate || ''),
        render: (text?: string) => <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text || '-'}</span>,
      },
      {
        title: '实际交付',
        dataIndex: 'actualDeliveryDate',
        key: 'actualDeliveryDate',
        width: 130,
        sorter: (a, b) => (a.actualDeliveryDate || '').localeCompare(b.actualDeliveryDate || ''),
        render: (text?: string, record?: HistoricalProject) => {
          if (!text) return <span style={{ color: 'rgba(255,255,255,0.3)' }}>-</span>;
          // 对比计划交付日期，显示提前/延期
          if (record?.plannedDeliveryDate) {
            const isEarly = text < record.plannedDeliveryDate;
            const isOnTime = text === record.plannedDeliveryDate;
            if (isOnTime) {
              return (
                <span>
                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text}</span>
                  <Tag style={{ marginLeft: 6, fontSize: 10, background: 'rgba(82,196,26,0.15)', color: '#52c41a', border: '1px solid rgba(82,196,26,0.3)', borderRadius: 4, padding: '0 4px' }}>准时</Tag>
                </span>
              );
            }
            if (isEarly) {
              return (
                <span>
                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text}</span>
                  <Tag style={{ marginLeft: 6, fontSize: 10, background: 'rgba(82,196,26,0.15)', color: '#52c41a', border: '1px solid rgba(82,196,26,0.3)', borderRadius: 4, padding: '0 4px' }}>提前</Tag>
                </span>
              );
            }
            return (
              <span>
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text}</span>
                <Tag style={{ marginLeft: 6, fontSize: 10, background: 'rgba(255,77,79,0.15)', color: '#ff4d4f', border: '1px solid rgba(255,77,79,0.3)', borderRadius: 4, padding: '0 4px' }}>延期</Tag>
              </span>
            );
          }
          return <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text}</span>;
        },
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
        title: '业务类型',
        dataIndex: 'businessType',
        key: 'businessType',
        width: 110,
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
      {
        title: '操作',
        key: 'action',
        width: 150,
        fixed: 'right' as const,
        render: (_: unknown, record: HistoricalProject) => (
          <Space size={0} split={null}>
            <Tooltip title="查看详情">
              <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/history/${record.id}`)} style={{ color: '#7cb8ff', width: 32, height: 28 }} />
            </Tooltip>
            <Tooltip title="编辑项目">
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} style={{ color: '#faad14', width: 32, height: 28 }} />
            </Tooltip>
            <Popconfirm
              title="确认删除"
              description={`确定要删除历史项目"${record.name}"吗？`}
              onConfirm={() => handleDelete(record.id)}
              okText="确认"
              cancelText="取消"
            >
              <Tooltip title="删除记录">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 32, height: 28 }} />
              </Tooltip>
            </Popconfirm>
          </Space>
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

      {/* 筛选与搜索 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' as const }}>
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ width: 130, fontFamily: 'var(--font-primary)' }}
          popupMatchSelectWidth={false}
        >
          <Select.Option value="全部">全部状态</Select.Option>
          <Select.Option value="未开始">未开始</Select.Option>
          <Select.Option value="测试中">测试中</Select.Option>
          <Select.Option value="已完成">已完成</Select.Option>
          <Select.Option value="阻塞">阻塞</Select.Option>
        </Select>
        <Input
          placeholder="搜索项目名称、客户或城市"
          prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.3)' }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 250, fontFamily: 'var(--font-primary)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
          allowClear
          variant="borderless"
        />
      </div>

      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, overflow: 'hidden' }}>
        <Table
          columns={columns}
          dataSource={filteredData}
          rowKey="id"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个历史项目`,
            size: 'small' as const,
          }}
          scroll={{ x: 1900, y: 'calc(100vh - 340px)' }}
          size="middle"
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
      </div>

      {/* 添加/编辑弹窗 */}
      <Modal
        title={editingProject ? '编辑历史项目' : '添加历史项目记录'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setModalOpen(false);
          setEditingProject(null);
          form.resetFields();
        }}
        width={640}
        okText={editingProject ? '保存更新' : '确认添加'}
        cancelText="取消"
        okButtonProps={{ style: { background: 'linear-gradient(135deg, #4d9fff, #69b1ff)', border: 'none' } }}
        bodyStyle={{ background: 'rgba(13,31,60,0.95)' }}
        style={{ top: 60 }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="请输入项目名称" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <Form.Item name="customer" label="客户" rules={[{ required: true, message: '请输入客户名称' }]}>
              <Input placeholder="请输入客户名称" />
            </Form.Item>
            <Form.Item name="city" label="城市">
              <Input placeholder="请输入所在城市" />
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
          <Form.Item name="itOutput" label="IT产出（MW）" rules={[{ required: true, message: '请输入IT产出' }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.1} placeholder="请输入IT产出" />
          </Form.Item>
          <Form.Item name="businessType" label="业务类型">
            <Select placeholder="请选择业务类型" allowClear>
              <Select.Option value="新建测试">新建测试</Select.Option>
              <Select.Option value="扩容测试">扩容测试</Select.Option>
              <Select.Option value="年度复测">年度复测</Select.Option>
              <Select.Option value="改造测试">改造测试</Select.Option>
              <Select.Option value="验收测试">验收测试</Select.Option>
            </Select>
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
