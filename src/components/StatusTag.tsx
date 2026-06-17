import { Tag } from 'antd';

const statusConfig: Record<string, { bg: string; color: string; border: string }> = {
  '未开始': { bg: 'rgba(250, 173, 20, 0.15)', color: '#faad14', border: 'rgba(250, 173, 20, 0.3)' },
  '测试中': { bg: 'rgba(77, 159, 255, 0.15)', color: '#7cb8ff', border: 'rgba(77, 159, 255, 0.3)' },
  '已完成': { bg: 'rgba(82, 196, 26, 0.15)', color: '#52c41a', border: 'rgba(82, 196, 26, 0.3)' },
  '阻塞': { bg: 'rgba(255, 77, 79, 0.15)', color: '#ff7875', border: 'rgba(255, 77, 79, 0.3)' },
  '高': { bg: 'rgba(255, 77, 79, 0.12)', color: '#ff7875', border: 'rgba(255, 77, 79, 0.25)' },
  '中': { bg: 'rgba(250, 173, 20, 0.12)', color: '#faad14', border: 'rgba(250, 173, 20, 0.25)' },
  '低': { bg: 'rgba(255, 255, 255, 0.06)', color: 'rgba(255, 255, 255, 0.5)', border: 'rgba(255, 255, 255, 0.15)' },
};

interface StatusTagProps {
  status: string;
}

function StatusTag({ status }: StatusTagProps) {
  const config = statusConfig[status] || { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: 'rgba(255,255,255,0.15)' };
  return (
    <Tag
      style={{
        background: config.bg,
        color: config.color,
        border: `1px solid ${config.border}`,
        borderRadius: 6,
        fontFamily: 'var(--font-primary)',
        fontSize: 11,
        fontWeight: 500,
        padding: '1px 8px',
      }}
    >
      {status}
    </Tag>
  );
}

export default StatusTag;
