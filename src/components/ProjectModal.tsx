import { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, DatePicker, InputNumber, Transfer, message } from 'antd';
import type { TransferProps } from 'antd';
import dayjs from 'dayjs';
import type { Project, TeamMember } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';

interface ProjectModalProps {
  open: boolean;
  project?: Project | null;
  teamMembers: TeamMember[];
  onCancel: () => void;
  onSubmit: (values: Project) => void;
}

function ProjectModal({ open, project, teamMembers, onCancel, onSubmit }: ProjectModalProps) {
  const [form] = Form.useForm();
  const [targetKeys, setTargetKeys] = useState<string[]>([]);
  const isEdit = !!project;
  const isMobile = useIsMobile();

  useEffect(() => {
    if (open) {
      if (project) {
        form.setFieldsValue({
          ...project,
          // 空字符串日期转 dayjs 会得到 Invalid 对象（绕过 required 校验且 format 产出 "Invalid Date" 落库），统一转 undefined
          startDate: project.startDate ? dayjs(project.startDate) : undefined,
          endDate: project.endDate ? dayjs(project.endDate) : undefined,
          plannedDeliveryDate: project.plannedDeliveryDate ? dayjs(project.plannedDeliveryDate) : undefined,
          actualDeliveryDate: project.actualDeliveryDate ? dayjs(project.actualDeliveryDate) : undefined,
        });
        setTargetKeys(project.assignedMemberIds || []);
      } else {
        form.resetFields();
        setTargetKeys([]);
      }
    }
  }, [open, project, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      // 双保险：Invalid Date 对象能通过 required 校验（非空对象），format 前先拦截
      if (values.startDate && !values.startDate.isValid?.()) {
        form.setFields([{ name: 'startDate', errors: ['开始日期无效，请重新选择'] }]);
        return;
      }
      const data: Project = {
        ...values,
        startDate: values.startDate ? values.startDate.format('YYYY-MM-DD') : '',
        endDate: values.endDate && values.endDate.isValid?.() ? values.endDate.format('YYYY-MM-DD') : '',
        plannedDeliveryDate: values.plannedDeliveryDate && values.plannedDeliveryDate.isValid?.() ? values.plannedDeliveryDate.format('YYYY-MM-DD') : '',
        actualDeliveryDate: values.actualDeliveryDate && values.actualDeliveryDate.isValid?.() ? values.actualDeliveryDate.format('YYYY-MM-DD') : '',
        assignedMemberIds: targetKeys,
      };
      onSubmit(data);
      form.resetFields();
      setTargetKeys([]);
    } catch {
      // validation failed
    }
  };

  const transferData = teamMembers.map((m) => ({
    key: m.id,
    name: m.name,
    employeeId: m.employeeId,
    status: m.status,
    skills: m.skills || [],
    currentProjects: m.currentProjects || [],
  }));

  const STATUS_COLORS: Record<string, string> = {
    '空闲': '#16a34a',
    '测试中': '#ec4899',
    '休假': '#6366f1',
  };

  const transferRender: TransferProps<{ key: string; name: string; employeeId: string; status: string; skills: string[]; currentProjects: string[] }>['render'] = (item) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: STATUS_COLORS[item.status] || '#9d9ab8',
          boxShadow: `0 0 4px ${STATUS_COLORS[item.status] || '#9d9ab8'}`,
        }} />
        <span style={{ color: '#1e1b2e', fontSize: 13 }}>{item.name}</span>
        <span style={{ color: '#9d9ab8', fontSize: 11 }}>{item.employeeId}</span>
      </div>
      {item.skills.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', paddingLeft: 12 }}>
          {item.skills.slice(0, 3).map((s) => (
            <span key={s} style={{
              fontSize: 10, color: '#6b6892',
              background: '#f6f5fc', borderRadius: 3, padding: '0 4px',
            }}>{s}</span>
          ))}
        </div>
      )}
      {item.currentProjects.length > 0 && (
        <div style={{ fontSize: 10, color: 'rgba(220,38,38,0.75)', paddingLeft: 12 }}>
          {item.currentProjects.length > 1 ? `${item.currentProjects[0]} 等${item.currentProjects.length}个项目` : item.currentProjects[0]}
        </div>
      )}
    </div>
  );

  return (
    <Modal
      title={isEdit ? '编辑项目' : '创建项目'}
      open={open}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        setTargetKeys([]);
        onCancel();
      }}
      width={720}
      destroyOnClose
      styles={{
        header: { background: 'transparent', borderBottom: '1px solid #e9e7f4' },
        body: { paddingTop: 20 },
        footer: { borderTop: '1px solid #e9e7f4' },
      }}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
          <Input placeholder="请输入项目名称" />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 16 }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select placeholder="请选择状态">
              <Select.Option value="未开始">未开始</Select.Option>
              <Select.Option value="测试中">测试中</Select.Option>
              <Select.Option value="已完成">已完成</Select.Option>
              <Select.Option value="阻塞">阻塞</Select.Option>
            </Select>
          </Form.Item>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
          <Form.Item name="startDate" label="开始日期" rules={[{ required: true, message: '请选择开始日期' }]}>
            <DatePicker style={{ width: '100%' }} placeholder="请选择开始日期" />
          </Form.Item>
          <Form.Item name="endDate" label="结束日期">
            <DatePicker style={{ width: '100%' }} placeholder="请选择结束日期" />
          </Form.Item>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
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
        <Form.Item name="plannedManpower" label="计划投入人力（人）">
          <InputNumber style={{ width: '100%' }} min={0} step={1} placeholder="请输入计划投入人力" />
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

        {/* 人员指派 */}
        <div style={{ marginTop: 16, marginBottom: 16 }}>
          <div style={{ color: '#46436a', fontSize: 14, marginBottom: 8, fontFamily: 'var(--font-primary)' }}>
            人员指派
          </div>
          <Transfer
            dataSource={transferData}
            titles={['可选人员', '已指派']}
            targetKeys={targetKeys}
            onChange={(nextTargetKeys) => setTargetKeys(nextTargetKeys as string[])}
            render={transferRender}
            showSearch
            filterOption={(inputValue, item) =>
              (item.name || '').toLowerCase().includes(inputValue.toLowerCase()) ||
              (item.employeeId || '').toLowerCase().includes(inputValue.toLowerCase()) ||
              (item.skills || []).some((s: string) => s.toLowerCase().includes(inputValue.toLowerCase()))
            }
            listStyle={{
              width: isMobile ? 'calc(50% - 26px)' : 280,
              height: isMobile ? 220 : 280,
              background: '#f6f5fc',
              border: '1px solid #e9e7f4',
              borderRadius: 8,
            }}
            selectAllLabels={['全选', '全选']}
          />
          <div style={{ marginTop: 8, color: '#9d9ab8', fontSize: 12 }}>
            已指派 {targetKeys.length} 人，项目开始后自动转为「测试中」状态
          </div>
        </div>

        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={3} placeholder="请输入项目描述" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default ProjectModal;
