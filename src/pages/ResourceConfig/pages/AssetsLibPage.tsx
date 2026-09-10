/**
 * 资源配置 · 自有资源库（全局共享）
 * 复刻原工具 renderAssetsLib / lockAssetsLib / unlockAssetsLib（app.js L814-855 / L2272-2355）：
 *  - 台账：类别（假负载/仪器仪表/PDU/机柜/其他设备）/名称/规格（含 KW，用于假负载功率匹配）/数量/备注；
 *  - 库存供「假负载计划 / 仪器仪表」自动核算自有与租赁；
 *  - 锁定后整表只读；解锁需输入密码（密码为空则直接解锁）。
 */
import { useState } from 'react';
import { Alert, Button, Card, Input, Modal, Space, Tag, Typography, message } from 'antd';
import { DatabaseOutlined, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { useAuth } from '../../../store/AuthContext';
import EditableTable from '../components/EditableTable';
import type { EditColumn } from '../components/EditableTable';
import type { RcStore } from '../store';
import { LS_KEYS, num } from '../types';
import type { LockState, RcAsset } from '../types';

const CAT_LABEL: Record<string, string> = {
  load: '假负载', ins: '仪器仪表', pdu: 'PDU', cabinet: '机柜', equip: '其他设备',
};
const CAT_OPTS = [
  { value: 'load', label: '假负载' },
  { value: 'ins', label: '仪器仪表' },
  { value: 'pdu', label: 'PDU' },
  { value: 'cabinet', label: '机柜' },
  { value: 'equip', label: '其他设备' },
];

const COLUMNS: EditColumn<RcAsset>[] = [
  {
    key: 'cat', title: '类别', width: 120, type: 'select', options: CAT_OPTS,
    render: v => CAT_LABEL[String(v)] || String(v),   // 锁定时展示类别中文名
  },
  { key: 'name', title: '名称', width: 190, type: 'text', placeholder: '如 风冷负载 / 电能质量分析仪435' },
  { key: 'spec', title: '规格', width: 190, type: 'text', placeholder: '如 6KW / 435（假负载需含 KW）' },
  { key: 'count', title: '数量', width: 90, type: 'number', align: 'right' },
  { key: 'note', title: '备注', type: 'textarea', placeholder: '备注（可选）' },
];

export default function AssetsLibPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const [lock, setLockState] = useState<LockState>(() => store.getLock(LS_KEYS.assetsLock));
  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');

  const assets = store.assets;
  const readonly = !editable || lock.locked;


  /** 解锁：服务端比对密码（密码已不下发前端） */
  const doUnlock = () => {
    if (!lock.locked) return;
    let pw = '';
    Modal.confirm({
      title: '解锁资源库',
      content: (
        <div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>输入解锁密码：</Typography.Paragraph>
          <Input.Password autoFocus placeholder="解锁密码" onChange={e => { pw = e.target.value; }} />
        </div>
      ),
      onOk: async () => {
        const ok = await store.unlockLib(LS_KEYS.assetsLock, pw.trim());
        if (!ok) { message.error('密码错误'); return Promise.reject(new Error('密码错误')); }
        setLockState({ locked: false, password: '' });
        message.success('已解锁，可修改资源库');
      },
    });
  };

  /** 上锁：密码经服务端接口存储（本地与接口均不再暴露明文） */
  const confirmLock = async () => {
    const p = pw1.trim();
    if (p.length < 4) { message.warning('密码至少 4 位'); return; }
    if (pw1 !== pw2) { message.warning('两次输入的密码不一致'); return; }
    const ok = await store.lockLib(LS_KEYS.assetsLock, p);
    if (!ok) { message.error('锁定失败（云端不可达或无权限）'); return; }
    setLockState({ locked: true, password: '' });
    setPwOpen(false);
    message.success('资源库已锁定，仅可查看');
  };

  // footer：总条数 + 假负载/仪器仪表分类小计
  const loadSum = assets.filter(a => a.cat === 'load').reduce((s, a) => s + num(a.count), 0);
  const insSum = assets.filter(a => a.cat === 'ins').reduce((s, a) => s + num(a.count), 0);
  const footer = (
    <span style={{ fontSize: 12.5 }}>
      总条数：<b style={{ color: '#6366f1' }}>{assets.length}</b> 条
      <Typography.Text type="secondary">（假负载小计 {loadSum} 台 · 仪器仪表小计 {insSum} 台）</Typography.Text>
    </span>
  );

  return (
    <Card
      size="small"
      title={(
        <Space size={8}>
          <DatabaseOutlined style={{ color: '#6366f1' }} />
          <span>自有资源库</span>
          <Tag style={{ margin: 0 }}>全局共享</Tag>
        </Space>
      )}
      extra={(
        <Space size={8}>
          {lock.locked
            ? <Tag icon={<LockOutlined />} color="error" style={{ margin: 0 }}>已锁定</Tag>
            : <Tag icon={<UnlockOutlined />} style={{ margin: 0 }}>未锁定</Tag>}
          {editable && (lock.locked
            ? <Button size="small" icon={<UnlockOutlined />} onClick={doUnlock}>解锁修改</Button>
            : <Button size="small" icon={<LockOutlined />} onClick={() => { setPw1(''); setPw2(''); setPwOpen(true); }}>锁定资源库</Button>)}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>共 {assets.length} 条</Typography.Text>
        </Space>
      )}
    >
      {lock.locked ? (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message="自有资源库已锁定"
          description="当前只能查看，不能新增/修改/删除。如需维护请先「解锁修改」。"
        />
      ) : !editable ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="当前角色无编辑权限，资源库仅可查看。" />
      ) : (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 12 }}>
          库存用于「假负载计划 / 仪器仪表」自动核算自有与需租赁台数；假负载规格请注明 KW（如 6KW）以便功率匹配。
        </Typography.Paragraph>
      )}

      <EditableTable
        columns={COLUMNS}
        rows={assets}
        onChange={rows => store.updateAssets(rows)}
        newRow={() => ({ cat: 'load', name: '', spec: '', count: 0, note: '' })}
        locked={readonly}
        footer={footer}
        addLabel="添加资产"
        minWidth={900}
      />

      <Modal
        open={pwOpen}
        title="锁定自有资源库"
        okText="锁定"
        cancelText="取消"
        onCancel={() => setPwOpen(false)}
        onOk={confirmLock}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 12 }}>
          锁定后其他人只能查看资源库，不能新增/修改/删除；需要修改时必须输入密码解锁。
        </Typography.Paragraph>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Input.Password autoFocus placeholder="设置解锁密码（至少 4 位）" value={pw1} onChange={e => setPw1(e.target.value)} />
          <Input.Password placeholder="请再次输入密码确认" value={pw2} onChange={e => setPw2(e.target.value)} />
        </Space>
      </Modal>
    </Card>
  );
}
