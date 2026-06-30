import { memo } from 'react';
import { Tag } from 'antd';
import { PROJECT_STATUS_COLORS } from '../utils/common';
import type { ProjectStatus } from '../types';

interface StatusTagProps {
  status: string;
}

function StatusTag({ status }: StatusTagProps) {
  const color = PROJECT_STATUS_COLORS[status as ProjectStatus] || '#8c8c8c';
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
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {status}
    </Tag>
  );
}

export default memo(StatusTag);
