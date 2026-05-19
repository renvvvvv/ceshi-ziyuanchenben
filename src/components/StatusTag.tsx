import { Tag } from 'antd';

const statusConfig: Record<string, { color: string; label: string }> = {
  '未开始': { color: 'gold', label: '未开始' },
  '测试中': { color: 'blue', label: '测试中' },
  '已完成': { color: 'green', label: '已完成' },
  '阻塞': { color: 'red', label: '阻塞' },
};

interface StatusTagProps {
  status: string;
}

function StatusTag({ status }: StatusTagProps) {
  const config = statusConfig[status] || { color: 'default', label: status };
  return <Tag color={config.color}>{config.label}</Tag>;
}

export default StatusTag;
