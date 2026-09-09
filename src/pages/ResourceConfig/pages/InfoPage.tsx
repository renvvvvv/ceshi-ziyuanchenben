/**
 * 资源配置 · 项目信息页
 * 受控编辑当前项目基本信息（名称/规模/地点/经理/周期/备注），输入即时 patchProject。
 * 「计划开始日期 / 计划结束日期 / 计划测试天数」三向自动关联（口径与原工具 syncDates 一致）：
 *   · 两端日期齐 → 天数 = 结束 − 开始 + 1（首尾日均计入）
 *   · 只改一端  → 按天数推算另一端日期
 *   · 改天数    → 按开始推结束；无开始则按结束倒推开始
 */
import { Card, Space, Typography, Input, InputNumber, DatePicker, message } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import type { CSSProperties } from 'react';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useAuth } from '../../../store/AuthContext';
import type { RcStore } from '../store';
import { num } from '../types';

const DAY = 86400000;
/** Date → 'YYYY-MM-DD'（本地时区，与原工具 iso() 一致） */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** 'YYYY-MM-DD' → 当日 0 点时间戳 */
const t0 = (s: string) => new Date(`${s}T00:00:00`).getTime();

/** 字段小标题样式（平台次要文字色） */
const labelStyle: CSSProperties = { display: 'block', fontSize: 12, color: '#6b6892', marginBottom: 4 };

export default function InfoPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const locked = !editable;

  const p = store.currentProject;
  if (!p) {
    return <Card><Typography.Text type="secondary">请先选择项目</Typography.Text></Card>;
  }

  /**
   * 三向自动关联入口：
   * src='start'/'end' 时传入变更后的日期串（清空传 ''）；
   * src='days' 时传入变更后的天数；未变的量取当前项目值。
   */
  const syncDates = (src: 'start' | 'end' | 'days', nextStart?: string, nextEnd?: string, nextDays?: number) => {
    const s = nextStart ?? p.startDate;
    const e = nextEnd ?? p.endDate;
    const d = nextDays ?? num(p.testDays);

    if (src === 'days') {
      if (d > 0 && s) {
        // 按开始日期 + 天数推算结束日期
        store.patchProject({ testDays: d, startDate: s, endDate: iso(new Date(t0(s) + (d - 1) * DAY)) });
      } else if (d > 0 && e) {
        // 无开始日期：按结束日期 − 天数倒推开始日期
        store.patchProject({ testDays: d, endDate: e, startDate: iso(new Date(t0(e) - (d - 1) * DAY)) });
      } else {
        store.patchProject({ testDays: d });
      }
      return;
    }

    if (s && e) {
      if (t0(e) < t0(s)) {
        message.warning('结束日期早于开始日期，请检查');
        store.patchProject(src === 'start' ? { startDate: s } : { endDate: e });
      } else {
        const days = Math.round((t0(e) - t0(s)) / DAY) + 1; // 首尾日均计入
        store.patchProject(src === 'start' ? { startDate: s, testDays: days } : { endDate: e, testDays: days });
        message.success(`已自动核算测试天数：${days} 天（首尾日均计入）`);
      }
    } else if (src === 'start' && s && d > 0) {
      store.patchProject({ startDate: s, endDate: iso(new Date(t0(s) + (d - 1) * DAY)) });
    } else if (src === 'end' && e && d > 0) {
      store.patchProject({ endDate: e, startDate: iso(new Date(t0(e) - (d - 1) * DAY)) });
    } else {
      // 仅一端有值且无法推算 / 清空：如实保存
      store.patchProject(src === 'start' ? { startDate: s } : { endDate: e });
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <InfoCircleOutlined style={{ color: '#6366f1' }} />
          <b>项目信息</b>
          <span style={{ color: '#9d9ab8', fontSize: 12, fontWeight: 400 }}>
            基本信息；开始/结束日期与测试天数自动关联
          </span>
        </Space>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '12px 16px' }}>
        <div>
          <span style={labelStyle}>项目名称</span>
          <Input
            value={p.name}
            disabled={locked}
            placeholder="项目名称"
            onChange={(e) => store.patchProject({ name: e.target.value })}
          />
        </div>
        <div>
          <span style={labelStyle}>规模（MW）</span>
          <Input
            value={String(p.mw ?? '')}
            disabled={locked}
            placeholder="如 1200"
            onChange={(e) => store.patchProject({ mw: e.target.value })}
          />
        </div>
        <div>
          <span style={labelStyle}>地点</span>
          <Input
            value={p.site}
            disabled={locked}
            placeholder="如 乌兰察布"
            onChange={(e) => store.patchProject({ site: e.target.value })}
          />
        </div>
        <div>
          <span style={labelStyle}>测试经理</span>
          <Input
            value={p.manager}
            disabled={locked}
            placeholder="测试经理"
            onChange={(e) => store.patchProject({ manager: e.target.value })}
          />
        </div>
        <div>
          <span style={labelStyle}>计划测试天数</span>
          <InputNumber
            style={{ width: '100%' }}
            value={num(p.testDays)}
            min={0}
            disabled={locked}
            addonAfter="天"
            onChange={(x) => syncDates('days', undefined, undefined, x ?? 0)}
          />
        </div>
        <div>
          <span style={labelStyle}>计划开始日期</span>
          <DatePicker
            style={{ width: '100%' }}
            value={p.startDate ? dayjs(p.startDate) : null}
            disabled={locked}
            placeholder="开始日期"
            onChange={(d: Dayjs | null) => syncDates('start', d ? d.format('YYYY-MM-DD') : '')}
          />
        </div>
        <div>
          <span style={labelStyle}>计划结束日期</span>
          <DatePicker
            style={{ width: '100%' }}
            value={p.endDate ? dayjs(p.endDate) : null}
            disabled={locked}
            placeholder="结束日期"
            onChange={(d: Dayjs | null) => syncDates('end', undefined, d ? d.format('YYYY-MM-DD') : '')}
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <span style={labelStyle}>备注</span>
          <Input.TextArea
            value={p.remark}
            disabled={locked}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="项目备注（可选）"
            onChange={(e) => store.patchProject({ remark: e.target.value })}
          />
        </div>
      </div>
      {locked && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          当前角色只读：如需修改请联系管理员开通资源配置编辑权限。
        </Typography.Text>
      )}
    </Card>
  );
}
