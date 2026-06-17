import { useEffect } from 'react';
import { Modal, Form, Input, Select, DatePicker, InputNumber, message } from 'antd';
import dayjs from 'dayjs';
import type { Project } from '../types';

interface ProjectModalProps {
  open: boolean;
  project?: Project | null;
  onCancel: () => void;
  onSubmit: (values: Project) => void;
}

function ProjectModal({ open, project, onCancel, onSubmit }: ProjectModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!project;

  useEffect(() => {
    if (open) {
      if (project) {
        form.setFieldsValue({
          ...project,
          startDate: dayjs(project.startDate),
          endDate: project.endDate ? dayjs(project.endDate) : undefined,
          plannedDeliveryDate: project.plannedDeliveryDate ? dayjs(project.plannedDeliveryDate) : undefined,
          actualDeliveryDate: project.actualDeliveryDate ? dayjs(project.actualDeliveryDate) : undefined,
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, project, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const data: Project = {
        ...values,
        startDate: values.startDate.format('YYYY-MM-DD'),
        endDate: values.endDate ? values.endDate.format('YYYY-MM-DD') : '',
        plannedDeliveryDate: values.plannedDeliveryDate ? values.plannedDeliveryDate.format('YYYY-MM-DD') : '',
        actualDeliveryDate: values.actualDeliveryDate ? values.actualDeliveryDate.format('YYYY-MM-DD') : '',
      };
      onSubmit(data);
      message.success(isEdit ? '项目更新成功' : '项目创建成功');
      form.resetFields();
    } catch {
      // validation failed
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑项目' : '创建项目'}
      open={open}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      width={640}
      destroyOnClose
      styles={{
        header: { background: 'transparent', borderBottom: '1px solid rgba(255,255,255,0.1)' },
        body: { paddingTop: 20 },
        footer: { borderTop: '1px solid rgba(255,255,255,0.1)' },
      }}
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
        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={3} placeholder="请输入项目描述" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default ProjectModal;
