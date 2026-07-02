import { memo, useEffect, useState, useRef } from 'react';
import { Tooltip } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

interface KpiCardProps {
  title: string;
  value: number | string;
  trend?: number;
  icon: ReactNode;
  suffix?: string;
  tooltip?: string;
}

/** 数值滚动动画 Hook */
function useCountUp(target: number, duration = 800) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof target !== 'number') {
      setDisplay(target as number);
      return;
    }
    startRef.current = null;
    const animate = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const progress = Math.min((ts - startRef.current) / duration, 1);
      // ease-out-cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(target * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplay(target);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}

function KpiCard({ title, value, trend, icon, suffix, tooltip }: KpiCardProps) {
  const isUp = (trend ?? 0) >= 0;
  const isNumberValue = typeof value === 'number';
  const animatedValue = useCountUp(isNumberValue ? (value as number) : 0);

  const displayValue = isNumberValue
    ? Number.isInteger(value)
      ? Math.round(animatedValue)
      : animatedValue.toFixed(1)
    : value;

  return (
    <Tooltip title={tooltip || title}>
      <div className="kpi-card">
        <div className="kpi-header">
          <span className="kpi-title">{title}</span>
          <span className="kpi-icon">{icon}</span>
        </div>
        <div className="kpi-value">
          {displayValue}
          {suffix && <span className="suffix">{suffix}</span>}
        </div>
        {trend !== undefined && (
          <div className={`kpi-trend ${isUp ? 'up' : 'down'}`}>
            {isUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            <span>环比 {isUp ? '+' : ''}{trend}%</span>
          </div>
        )}
      </div>
    </Tooltip>
  );
}

export default memo(KpiCard);
