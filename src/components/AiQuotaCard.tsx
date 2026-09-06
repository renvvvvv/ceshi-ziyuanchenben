import { useEffect, useState } from 'react';
import { Card, Progress, Space } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useIsMobile } from '../hooks/useIsMobile';
import { request } from '../api';

/**
 * AI 测试专家 用量卡片（今日 Token / 本周积分）
 * 自主拉取 GET /api/kb/qa/quota，供权限配置页展示。
 */

function quotaColor(pct: number): string {
  if (pct >= 90) return '#dc2626';
  if (pct >= 70) return '#d97706';
  return '#6366f1';
}

function fmtTokensShort(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return n.toLocaleString();
}

export default function AiQuotaCard() {
  const isMobile = useIsMobile();
  const [quota, setQuota] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    request<{ success: boolean; quota: any }>('/kb/qa/quota')
      .then(r => { if (alive && r?.quota) setQuota(r.quota); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!quota) return null;

  const todayUsed = quota.todayTokens || 0;
  const todayLimit = quota.todayLimitTokens || 1;
  const weekPoints = quota.weekPoints || 0;
  const weekLimit = quota.weekLimitPoints || 1;
  const todayPct = Math.min(100, (todayUsed / todayLimit) * 100);
  const weekPct = Math.min(100, (weekPoints / weekLimit) * 100);

  return (
    <Card
      style={{ marginBottom: 16, borderRadius: 8 }}
      title={
        <Space>
          <RobotOutlined style={{ color: '#6366f1' }} />
          <span style={{ color: '#1e1b2e' }}>AI 用量（admin 账号）</span>
        </Space>
      }
    >
      <div style={{
        display: 'flex', flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 12 : 24, alignItems: 'center',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b6892', marginBottom: 2 }}>
            <span>今日 Token（{quota.todayCount ?? 0} 次提问）</span>
            <span>剩余 <b style={{ color: quotaColor(todayPct) }}>{fmtTokensShort(Math.max(0, todayLimit - todayUsed))}</b> / {fmtTokensShort(todayLimit)}</span>
          </div>
          <Progress percent={todayPct} showInfo={false} size="small" strokeColor={quotaColor(todayPct)} trailColor="#f6f5fc" />
        </div>
        <div style={{ width: isMobile ? '100%' : 260, minWidth: isMobile ? 0 : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b6892', marginBottom: 2 }}>
            <span>本周积分</span>
            <span>剩余 <b style={{ color: quotaColor(weekPct) }}>{Math.max(0, Math.round(weekLimit - weekPoints)).toLocaleString()}</b> / {weekLimit.toLocaleString()}</span>
          </div>
          <Progress percent={weekPct} showInfo={false} size="small" strokeColor={quotaColor(weekPct)} trailColor="#f6f5fc" />
        </div>
      </div>
    </Card>
  );
}
