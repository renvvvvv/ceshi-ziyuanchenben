/**
 * 资源配置 · 已交付存档（全局共享，只读）
 * 复刻原工具 renderDelivered / addDelivered / deliveredSummary（app.js L860-1021）：
 *  - 「存档当前项目」：当前项目深拷贝快照 + savedAt + 新 id，追加到存档库供团队查阅；
 *  - 列表只读；「查看详情」弹窗内用 Descriptions 展示五项关键汇总（人天/负载/仪表/耗材/劳务）；
 *  - 锁定逻辑与两个资源库一致（LS_KEYS.deliveredLock），锁定后禁止存档。
 * TODO: 原工具另有独立「存档修改密码」（LS_KEYS.deliveredPw，即 testDeliveredEditPw_v1，
 *       用于修改单条存档前校验，见 app.js L1022-1087）；平台版暂未提供存档编辑入口，
 *       密码体系简化为与资源库一致的锁定/解锁，后续实现存档编辑时再接入 deliveredPw。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Modal, Space, Statistic, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { InboxOutlined, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { useAuth } from '../../../store/AuthContext';
import { deliveredSummary } from '../calc';
import type { RcStore } from '../store';
import { LS_KEYS, num, uid } from '../types';
import type { LockState, RcDelivered, RcProject } from '../types';

/** 数值展示：最多 1 位小数去尾零 */
const fmt1 = (v: number): number | string => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? r : r.toFixed(1);
};

/** ISO 时间 → YYYY-MM-DD HH:mm */
const fmtDT = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 详情弹窗：基本信息 + deliveredSummary 五项关键指标 */
function DeliveredDetail({ item }: { item: RcDelivered }) {
  const s = deliveredSummary(item);
  const items: { label: string; value: number | string; suffix: string }[] = [
    { label: '投入人天', value: fmt1(s.manDays), suffix: '人天' },
    { label: '假负载台数', value: fmt1(s.loadQty), suffix: '台' },
    { label: '仪表台数', value: fmt1(s.insQty), suffix: '台' },
    { label: '耗材类数', value: fmt1(s.consCat), suffix: '类' },
    { label: '劳务人天', value: fmt1(s.laborDays), suffix: '人天' },
  ];
  return (
    <>
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="项目名称">{item.name || '—'}</Descriptions.Item>
        <Descriptions.Item label="规模(MW)">{(item.mw !== '' && item.mw != null) ? item.mw : '—'}</Descriptions.Item>
        <Descriptions.Item label="项目地点">{item.site || '—'}</Descriptions.Item>
        <Descriptions.Item label="测试经理">{item.manager || '—'}</Descriptions.Item>
        <Descriptions.Item label="测试天数">{num(item.testDays) || '—'}</Descriptions.Item>
        <Descriptions.Item label="计划周期">{item.startDate || '—'} ~ {item.endDate || '—'}</Descriptions.Item>
        <Descriptions.Item label="存档时间">{fmtDT(item.savedAt)}</Descriptions.Item>
        <Descriptions.Item label="备注">{item.remark || '—'}</Descriptions.Item>
      </Descriptions>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
        {items.map(it => (
          <div
            key={it.label}
            style={{
              flex: '1 1 130px', borderRadius: 8, padding: '10px 14px',
              background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.28)',
            }}
          >
            <Statistic
              title={<span style={{ fontSize: 12 }}>{it.label}</span>}
              value={it.value}
              suffix={it.suffix}
              valueStyle={{ fontSize: 20, fontWeight: 700, color: '#6366f1' }}
            />
          </div>
        ))}
      </div>
    </>
  );
}

export default function DeliveredPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const [lock, setLockState] = useState<LockState>(() => store.getLock(LS_KEYS.deliveredLock));
  // 跨标签页锁状态同步（其他标签页锁/解锁时本页即时刷新）
  useEffect(() => {
    const onLock = (e: Event) => {
      const k = (e as CustomEvent).detail;
      if (k === LS_KEYS.deliveredLock) setLockState(store.getLock(LS_KEYS.deliveredLock));
    };
    window.addEventListener('rc-lock-changed', onLock);
    return () => window.removeEventListener('rc-lock-changed', onLock);
  }, []);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [viewing, setViewing] = useState<RcDelivered | null>(null);

  const rows = store.delivered;
  const cur = store.currentProject;
  const canArchive = editable && !!cur && !lock.locked;


  /** 解锁：服务端比对密码（密码已不下发前端） */
  const doUnlock = () => {
    if (!lock.locked) return;
    let pw = '';
    Modal.confirm({
      title: '解锁存档库',
      content: (
        <div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>输入解锁密码：</Typography.Paragraph>
          <Input.Password autoFocus placeholder="解锁密码" onChange={e => { pw = e.target.value; }} />
        </div>
      ),
      onOk: async () => {
        const rv = await store.unlockLib(LS_KEYS.deliveredLock, pw.trim());
        if (rv === 'wrong') { message.error('密码错误'); return Promise.reject(new Error('密码错误')); }
        if (rv === 'error') { message.error('服务不可用，请稍后重试'); return Promise.reject(new Error('服务不可用')); }
        setLockState({ locked: false, password: '' });
        message.success('已解锁，可修改存档库');
      },
    });
  };

  /** 上锁：密码经服务端接口存储（本地与接口均不再暴露明文） */
  const confirmLock = async () => {
    const p = pw1.trim();
    if (p.length < 4) { message.warning('密码至少 4 位'); return; }
    if (pw1 !== pw2) { message.warning('两次输入的密码不一致'); return; }
    const ok = await store.lockLib(LS_KEYS.deliveredLock, p);
    if (!ok) { message.error('锁定失败（云端不可达或无权限）'); return; }
    setLockState({ locked: true, password: '' });
    setPwOpen(false);
    message.success('存档库已锁定，仅可查看');
  };

  /** 存档当前项目：完整快照 + savedAt + 新 id，追加（置顶）到存档库（原 addDelivered） */
  const archive = () => {
    if (!cur) return;
    if (lock.locked) { message.warning('存档库已锁定，只能查看。如需存入请先解锁'); return; }
    if (!String(cur.name || '').trim()) { message.warning('请先在「项目信息」中填写项目名称'); return; }
    const snap = JSON.parse(JSON.stringify(cur)) as RcProject;
    const rec: RcDelivered = { ...snap, id: uid(), savedAt: new Date().toISOString() };
    store.updateDelivered([rec, ...rows]);
    message.success('已存入「已交付存档」，供团队查阅');
  };

  const columns: ColumnsType<RcDelivered> = [
    { title: '#', width: 44, render: (_v, _r, i) => <span style={{ color: '#9d9ab8' }}>{i + 1}</span> },
    { title: '项目名称', dataIndex: 'name', ellipsis: true, render: (v: string) => <b>{v || '—'}</b> },
    { title: '规模(MW)', dataIndex: 'mw', width: 90, align: 'right', render: (v: string | number | undefined) => (v !== '' && v != null) ? v : '—' },
    { title: '地点', dataIndex: 'site', width: 110, render: (v?: string) => v || '—' },
    { title: '测试经理', dataIndex: 'manager', width: 100, render: (v?: string) => v || '—' },
    { title: '测试天数', dataIndex: 'testDays', width: 90, align: 'right', render: (v: number | undefined) => num(v) || '—' },
    { title: '开始', dataIndex: 'startDate', width: 100, render: (v?: string) => v || '—' },
    { title: '结束', dataIndex: 'endDate', width: 100, render: (v?: string) => v || '—' },
    { title: '存档时间', dataIndex: 'savedAt', width: 150, render: (v?: string) => fmtDT(v) },
    {
      title: '操作', key: 'op', width: 100, align: 'center',
      render: (_v, r) => <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setViewing(r)}>查看详情</Button>,
    },
  ];

  const archiveTip = !editable
    ? '当前角色无编辑权限'
    : !cur
      ? '请先选择或新建项目'
      : lock.locked
        ? '存档库已锁定，请先「解锁管理」'
        : undefined;

  return (
    <Card
      size="small"
      title={(
        <Space size={8}>
          <InboxOutlined style={{ color: '#6366f1' }} />
          <span>已交付存档</span>
          <Tag style={{ margin: 0 }}>全局共享</Tag>
        </Space>
      )}
      extra={(
        <Space size={8}>
          <Tooltip title={archiveTip}>
            <span>
              <Button size="small" type="primary" icon={<InboxOutlined />} disabled={!canArchive} onClick={archive}>
                存档当前项目
              </Button>
            </span>
          </Tooltip>
          {lock.locked
            ? <Tag icon={<LockOutlined />} color="error" style={{ margin: 0 }}>已锁定</Tag>
            : <Tag icon={<UnlockOutlined />} style={{ margin: 0 }}>未锁定</Tag>}
          {editable && (lock.locked
            ? <Button size="small" icon={<UnlockOutlined />} onClick={doUnlock}>解锁管理</Button>
            : <Button size="small" icon={<LockOutlined />} onClick={() => { setPw1(''); setPw2(''); setPwOpen(true); }}>锁定存档库</Button>)}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>共 {rows.length} 条</Typography.Text>
        </Space>
      )}
    >
      {lock.locked ? (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message="存档库已锁定"
          description="存档仅供查看；如需存入新项目请先「解锁管理」。"
        />
      ) : !editable ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="当前角色无编辑权限，存档库仅可查看。" />
      ) : (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 12 }}>
          完成项目后点击右上「存档当前项目」，将当前配置完整快照归档，供团队查阅。
        </Typography.Paragraph>
      )}

      <Table
        size="small"
        bordered
        columns={columns}
        dataSource={rows}
        rowKey={r => String(r.id)}
        pagination={rows.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
        scroll={{ x: 1050 }}
        locale={{ emptyText: '暂无存档 —— 完成项目后点击右上「存档当前项目」，即可归档供团队查阅' }}
      />

      <Modal
        open={!!viewing}
        title={viewing ? `存档详情 · ${viewing.name || '—'}` : ''}
        footer={null}
        width={760}
        onCancel={() => setViewing(null)}
      >
        {viewing && <DeliveredDetail item={viewing} />}
      </Modal>

      <Modal
        open={pwOpen}
        title="锁定存档库"
        okText="锁定"
        cancelText="取消"
        onCancel={() => setPwOpen(false)}
        onOk={confirmLock}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 12 }}>
          锁定后存档仅供查看，不能存入/删除；需要维护时必须输入密码解锁。
        </Typography.Paragraph>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Input.Password autoFocus placeholder="设置解锁密码（至少 4 位）" value={pw1} onChange={e => setPw1(e.target.value)} />
          <Input.Password placeholder="请再次输入密码确认" value={pw2} onChange={e => setPw2(e.target.value)} />
        </Space>
      </Modal>
    </Card>
  );
}
