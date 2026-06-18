import { Tag } from 'antd';
import { PROJECT_STATUS_COLORS, PRIORITY_COLORS } from '../utils/common';
import type { ProjectStatus, Priority } from '../types';

interface StatusTagProps {
  status: string;
  type?: 'status' | 'priority';
}

function StatusTag({ status, type = 'status' }: StatusTagProps) {
  const colors = type === 'status'
    ? PROJECT_STATUS_COLORS[status as ProjectStatus]
    : PRIORITY_COLORS[status as Priority];

  const color = colors || '#8c8c8c';
  const bg = `${color}20`;
  const border = `${color}40`;

  return (
    <Tag
      style={{
        background: bg,
        color: color,
        border: `1px solid ${border}`,
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
