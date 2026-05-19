import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Select, Input, Space, Popconfirm, message } from 'antd';
import { PlusOutlined, SearchOutlined, DeleteOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import StatusTag from '../../components/StatusTag';
import ProjectModal from '../../components/ProjectModal';
import { mockProjects } from '../../data/mock';
import type { Project } from '../../types';

function Projects() {
  const [projects, setProjects] = useState<Project[]>(mockProjects);
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [priorityFilter, setPriorityFilter] = useState<string>('全部');
  const [searchText, setSearchText] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const navigate = useNavigate();

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (statusFilter !== '全部' && p.status !== statusFilter) return false;
      if (priorityFilter !== '全部' && p.priority !== priorityFilter) return false;
      if (searchText) {
        const kw = searchText.toLowerCase();
        if (!p.name.toLowerCase().includes(kw) && !p.customer.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [projects, statusFilter, priorityFilter, searchText]);

  const handleCreate = () => {
    setEditingProject(null);
    setModalOpen(true);
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setProjects(projects.filter((p) => p.id !== id));
    message.success('项目删除成功');
  };

  const handleSubmit = (values: Project) => {
    if (editingProject) {
      setProjects(projects.map((p) => (p.id === editingProject.id ? { ...values, id: editingProject.id, updatedAt: new Date().toISOString().slice(0, 10) } : p)));
    } else {
      const newProject: Project = {
        ...values,
        id: Date.now().toString(),
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      setProjects([newProject, ...projects]);
    }
    setModalOpen(false);
    setEditingProject(null);
  };

  const columns: ColumnsType<Project> = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Project) => (
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
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      render: (p: string) => {
        const colors: Record<string, string> = { '高': 'red', '中': 'orange', '低': 'default' };
        return <StatusTag status={p} />;
      },
    },
    { title: '开始日期', dataIndex: 'startDate', key: 'startDate', sorter: (a, b) => a.startDate.localeCompare(b.startDate) },
    { title: '结束日期', dataIndex: 'endDate', key: 'endDate', sorter: (a, b) => a.endDate.localeCompare(b.endDate) },
    { title: 'IT产出（MW）', dataIndex: 'itOutput', key: 'itOutput', sorter: (a, b) => a.itOutput - b.itOutput },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: unknown, record: Project) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/projects/${record.id}`)}>
            查看
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除"
            description={`确定要删除项目"${record.name}"吗？`}
            onConfirm={() => handleDelete(record.id)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h3>项目管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          创建项目
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 120 }}>
          <Select.Option value="全部">全部状态</Select.Option>
          <Select.Option value="未开始">未开始</Select.Option>
          <Select.Option value="测试中">测试中</Select.Option>
          <Select.Option value="已完成">已完成</Select.Option>
          <Select.Option value="阻塞">阻塞</Select.Option>
        </Select>
        <Select value={priorityFilter} onChange={setPriorityFilter} style={{ width: 120 }}>
          <Select.Option value="全部">全部优先级</Select.Option>
          <Select.Option value="高">高</Select.Option>
          <Select.Option value="中">中</Select.Option>
          <Select.Option value="低">低</Select.Option>
        </Select>
        <Input
          placeholder="搜索项目名称或客户"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 250 }}
          allowClear
        />
      </div>

      <Table
        columns={columns}
        dataSource={filteredProjects}
        rowKey="id"
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 个项目`,
        }}
        scroll={{ x: 1100 }}
      />

      <ProjectModal
        open={modalOpen}
        project={editingProject}
        onCancel={() => {
          setModalOpen(false);
          setEditingProject(null);
        }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

export default Projects;
