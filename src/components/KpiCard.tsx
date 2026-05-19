import { Tooltip } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

interface KpiCardProps {
  title: string;
  value: number | string;
  trend: number;
  icon: ReactNode;
  suffix?: string;
  tooltip?: string;
}

function KpiCard({ title, value, trend, icon, suffix, tooltip }: KpiCardProps) {
  const isUp = trend >= 0;
  return (
    <Tooltip title={tooltip || title}>
      <div className="kpi-card">
        <div className="kpi-header">
          <span className="kpi-title">{title}</span>
          <span className="kpi-icon">{icon}</span>
        </div>
        <div className="kpi-value">
          {value}
          {suffix && <span style={{ fontSize: 14, fontWeight: 400, color: '#999', marginLeft: 4 }}>{suffix}</span>}
        </div>
        <div className={`kpi-trend ${isUp ? 'up' : 'down'}`}>
          {isUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
          <span>环比 {isUp ? '+' : ''}{trend}%</span>
        </div>
      </div>
    </Tooltip>
  );
}

export default KpiCard;
