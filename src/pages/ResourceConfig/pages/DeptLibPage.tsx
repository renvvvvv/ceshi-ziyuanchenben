/**
 * 资源配置 · 部门人员库（全局共享）
 * 复刻原工具 renderDeptMembers / lockDeptLib / unlockDeptLib（app.js L2053-2176）：
 *  - 维护部门人员台账（姓名/职级/岗位/公司/电话/技能/备注），跨项目共享复用；
 *  - 锁定后整表只读；解锁需输入密码（密码为空则直接解锁）。
 */
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Space, Tag, Typography, message } from 'antd';
import { LockOutlined, TeamOutlined, UnlockOutlined } from '@ant-design/icons';
import { useAuth } from '../../../store/AuthContext';
import EditableTable from '../components/EditableTable';
import type { EditColumn } from '../components/EditableTable';
import type { RcStore } from '../store';
import { LS_KEYS, uid } from '../types';
import type { LockState, RcDeptMember } from '../types';

const LEVEL_OPTS = ['T3', 'T4', 'T5', 'T6', 'T7'].map(v => ({ value: v, label: v }));
const POST_OPTS = [
  '测试经理', '暖通主测', '电气主测', '弱电主测', '消防主测',
  '电气工程师', '暖通工程师', '弱电工程师', '消防工程师', '实习生',
].map(v => ({ value: v, label: v }));

const COLUMNS: EditColumn<RcDeptMember>[] = [
  { key: 'name', title: '姓名', width: 110, type: 'text', placeholder: '姓名' },
  { key: 'level', title: '职级', width: 90, type: 'select', options: LEVEL_OPTS },
  { key: 'post', title: '岗位', width: 140, type: 'select', options: POST_OPTS },
  { key: 'company', title: '所属公司', width: 160, type: 'text', placeholder: '公司/部门' },
  { key: 'phone', title: '电话', width: 130, type: 'text' },
  { key: 'skill', title: '技能', width: 200, type: 'text', placeholder: '如 高低压/暖通/弱电调试' },
  { key: 'note', title: '备注', type: 'textarea', placeholder: '备注（可选）' },
];

export default function DeptLibPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const [lock, setLockState] = useState<LockState>(() => store.getLock(LS_KEYS.deptLock));
  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');

  const members = store.dept.members;
  const readonly = !editable || lock.locked;


  /** 解锁：服务端比对密码（密码已不下发前端） */
  const doUnlock = () => {
    if (!lock.locked) return;
    let pw = '';
    Modal.confirm({
      title: '解锁部门人员库',
      content: (
        <div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>输入解锁密码：</Typography.Paragraph>
          <Input.Password autoFocus placeholder="解锁密码" onChange={e => { pw = e.target.value; }} />
        </div>
      ),
      onOk: async () => {
        const ok = await store.unlockLib(LS_KEYS.deptLock, pw.trim());
        if (!ok) { message.error('密码错误'); return Promise.reject(new Error('密码错误')); }
        setLockState({ locked: false, password: '' });
        message.success('已解锁，可修改部门人员库');
      },
    });
  };

  /** 上锁：密码经服务端接口存储（本地与接口均不再暴露明文） */
  const confirmLock = async () => {
    const p = pw1.trim();
    if (p.length < 4) { message.warning('密码至少 4 位'); return; }
    if (pw1 !== pw2) { message.warning('两次输入的密码不一致'); return; }
    const ok = await store.lockLib(LS_KEYS.deptLock, p);
    if (!ok) { message.error('锁定失败（云端不可达或无权限）'); return; }
    setLockState({ locked: true, password: '' });
    setPwOpen(false);
    message.success('部门人员库已锁定，仅可查看');
  };

  // 岗位构成（统计口径同原工具 renderDeptMembers）
  const stats = useMemo(() => {
    const postOf = (m: RcDeptMember) => String(m.post || '');
    return {
      mgr: members.filter(m => { const p = postOf(m); return p.includes('测试经理') || p.includes('项目经理'); }).length,
      lead: members.filter(m => postOf(m).includes('主测')).length,
      eng: members.filter(m => { const p = postOf(m); return p.includes('工程师') && !p.includes('主测') && !p.includes('实习'); }).length,
      intern: members.filter(m => postOf(m).includes('实习')).length,
    };
  }, [members]);

  const footer = (
    <span style={{ fontSize: 12.5 }}>
      在库人数合计：<b style={{ color: '#6366f1' }}>{members.length}</b> 人
      <Typography.Text type="secondary">（测试经理 {stats.mgr} · 主测 {stats.lead} · 工程师 {stats.eng} · 实习生 {stats.intern}）</Typography.Text>
    </span>
  );

  return (
    <Card
      size="small"
      title={(
        <Space size={8}>
          <TeamOutlined style={{ color: '#6366f1' }} />
          <span>部门人员库</span>
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
            : <Button size="small" icon={<LockOutlined />} onClick={() => { setPw1(''); setPw2(''); setPwOpen(true); }}>锁定人员库</Button>)}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>共 {members.length} 人</Typography.Text>
        </Space>
      )}
    >
      {lock.locked ? (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message="部门人员库已锁定"
          description="当前只能查看，不能新增/修改/删除。如需维护请先「解锁修改」。"
        />
      ) : !editable ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="当前角色无编辑权限，人员库仅可查看。" />
      ) : (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 12 }}>
          数据录入完成后建议「锁定人员库」防止误改（锁定后仅可查看，解锁需密码）。
        </Typography.Paragraph>
      )}

      <EditableTable
        columns={COLUMNS}
        rows={members}
        onChange={rows => store.updateDept({ members: rows })}
        newRow={() => ({ id: uid(), name: '', level: 'T5', post: '', company: '', phone: '', skill: '', note: '' })}
        locked={readonly}
        footer={footer}
        addLabel="添加人员"
        minWidth={1000}
      />

      <Modal
        open={pwOpen}
        title="锁定部门人员库"
        okText="锁定"
        cancelText="取消"
        onCancel={() => setPwOpen(false)}
        onOk={confirmLock}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 12 }}>
          锁定后其他人只能查看人员库，不能新增/修改/删除；需要修改时必须输入密码解锁。
        </Typography.Paragraph>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Input.Password autoFocus placeholder="设置解锁密码（至少 4 位）" value={pw1} onChange={e => setPw1(e.target.value)} />
          <Input.Password placeholder="请再次输入密码确认" value={pw2} onChange={e => setPw2(e.target.value)} />
        </Space>
      </Modal>
    </Card>
  );
}
