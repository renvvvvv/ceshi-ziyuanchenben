import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Card, Table, Switch, Button, Tag, message, Modal, Form, Input, Select,
  Space, Tooltip, Popconfirm, Badge, Spin, Empty,
} from 'antd';
import {
  ReloadOutlined, SafetyOutlined, UserOutlined, PlusOutlined,
  DeleteOutlined, KeyOutlined, TeamOutlined, LockOutlined, UnlockOutlined,
  SearchOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../store/AuthContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { request } from '../../api';
import AiQuotaCard from '../../components/AiQuotaCard';
import type { UserRole, AppModule, ModulePermission, User } from '../../types';

// ============================================================
// 常量
// ============================================================
const MODULE_LABELS: Record<AppModule, string> = {
  dashboard: '仪表盘',
  projects: '项目管理',
  history: '历史项目',
  teamPool: '测试人员池',
  testGuide: '测试管理制度',
  resourceCalc: '资源计算器',
  resourceConfig: '资源配置',
  attendance: '人员考勤',
  reportReview: '测试报告审核',
  permissionConfig: '权限配置',
  aiTestExpert: 'AI 测试专家',
};

const ROLE_COLORS: Record<UserRole, string> = {
  '管理者': '#dc2626',
  '编辑者': '#d97706',
  '阅读者': '#6366f1',
};

const ALL_MODULES: AppModule[] = [
  'dashboard', 'projects', 'history', 'teamPool', 'testGuide',
  'resourceCalc', 'attendance', 'reportReview', 'permissionConfig',
  'aiTestExpert',
];

const ALL_ROLES: UserRole[] = ['管理者', '编辑者', '阅读者'];

// ============================================================
// 账号视图类型（与后端 AccountView 对齐）
// ============================================================
interface AccountView {
  id: string;
  type: 'feishu' | 'local';
  username: string;
  name: string;
  email?: string;
  role: UserRole;            // 自动推断/默认角色
  manualRole?: UserRole;      // 管理员覆盖
  effectiveRole: UserRole;   // 实际生效角色
  manualPerms?: ModulePermission[];
  deptNames?: string[];
  active: boolean;
  lastLoginAt?: string;
  createdAt?: string;
}

// ============================================================
// 主组件
// ============================================================
function PermissionConfig() {
  const { permissionConfigs, updatePermissionConfig, resetPermissions, user } = useAuth();
  const isMobile = useIsMobile();

  // 账号管理区 state
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  // 新增账号弹窗
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm] = Form.useForm();
  const [addingUser, setAddingUser] = useState(false);

  // 飞书搜索预授权弹窗
  const [feishuSearchOpen, setFeishuSearchOpen] = useState(false);
  const [feishuQuery, setFeishuQuery] = useState('');
  const [feishuSearching, setFeishuSearching] = useState(false);
  const [feishuCandidates, setFeishuCandidates] = useState<Array<{
    openId: string; userId?: string; name: string; email?: string; mobile?: string; deptIds?: string[];
  }>>([]);
  const [preauthorizingId, setPreauthorizingId] = useState<string | null>(null);

  // 批量操作
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

  // 模块权限覆盖弹窗
  const [permModal, setPermModal] = useState<{ account: AccountView } | null>(null);
  const [permDraft, setPermDraft] = useState<ModulePermission[]>([]);

  // 原角色矩阵的 localConfigs（保留原有逻辑）
  const [localConfigs, setLocalConfigs] = useState<Record<UserRole, ModulePermission[]>>(() => {
    const map: Record<string, ModulePermission[]> = {};
    for (const c of permissionConfigs) {
      map[c.role] = c.permissions;
    }
    return map as Record<UserRole, ModulePermission[]>;
  });

  const isAdmin = user?.role === '管理者';

  // ============== AI 用量统计（仅管理者可见） ==============
  const [aiUsage, setAiUsage] = useState<any[]>([]);
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  // 周限额从后端 limits 读取（后端可用环境变量调整，避免前端硬编码不一致）
  const [weekPointLimit, setWeekPointLimit] = useState(60000);
  const loadAiUsage = useCallback(async () => {
    if (user?.role !== '管理者') return;
    setAiUsageLoading(true);
    try {
      const r = await request<{ success: boolean; list: any[]; limits?: { weeklyPointLimit?: number } }>('/kb/qa/usage?days=30');
      setAiUsage(r.list || []);
      if (r.limits?.weeklyPointLimit && r.limits.weeklyPointLimit > 0) setWeekPointLimit(r.limits.weeklyPointLimit);
    } catch {
      /* 用量查询失败不影响页面其他功能 */
    } finally {
      setAiUsageLoading(false);
    }
  }, [user?.role]);

  useEffect(() => {
    if (user?.role === '管理者') loadAiUsage();
  }, [user?.role, loadAiUsage]);

  const fmtTokensCol = (v: number) => {
    const n = Number(v) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
    return String(Math.round(n));
  };

  const aiUsageColumns = [
    { title: '账号', dataIndex: 'username', key: 'username' },
    { title: '今日次数', dataIndex: 'todayCount', key: 'todayCount', width: 90 },
    { title: '今日 Token', dataIndex: 'todayTokens', key: 'todayTokens', width: 110, render: fmtTokensCol },
    { title: '本周 Token', dataIndex: 'weekTokens', key: 'weekTokens', width: 110, render: fmtTokensCol },
    {
      title: '本周积分 / 限额', dataIndex: 'weekPoints', key: 'weekPoints', width: 130,
      render: (v: number) => {
        const pct = Math.min(100, ((Number(v) || 0) / weekPointLimit) * 100);
        return <Tag color={pct >= 90 ? 'red' : pct >= 70 ? 'orange' : 'green'}>{v} / {weekPointLimit.toLocaleString()}</Tag>;
      },
    },
    { title: '近30天 Token', dataIndex: 'totalTokens', key: 'totalTokens', width: 120, render: fmtTokensCol },
    { title: '近30天次数', dataIndex: 'totalCount', key: 'totalCount', width: 100 },
    {
      title: '最近使用', dataIndex: 'lastUsedAt', key: 'lastUsedAt', width: 150,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-'),
    },
  ];

  // 角色矩阵用的模块列表（保留原有展示）
  const matrixModules = useMemo<AppModule[]>(
    () => ['dashboard', 'projects', 'history', 'teamPool', 'testGuide', 'resourceCalc', 'permissionConfig'],
    []
  );

  // ============================================================
  // 加载账号列表
  // ============================================================
  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const data = await request<{ success: boolean; accounts: AccountView[] }>('/auth/accounts');
      if (data.success && Array.isArray(data.accounts)) {
        setAccounts(data.accounts);
      }
    } catch (err: any) {
      message.error(err?.message || '加载账号列表失败');
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      void loadAccounts();
    }
  }, [isAdmin, loadAccounts]);

  // ============================================================
  // 飞书搜索预授权
  // ============================================================
  const handleFeishuSearch = useCallback(async () => {
    if (!feishuQuery.trim()) {
      message.warning('请输入搜索关键词');
      return;
    }
    setFeishuSearching(true);
    setFeishuCandidates([]);
    try {
      const data = await request<{ success: boolean; users?: any[]; error?: string }>(
        '/auth/feishu/search',
        { method: 'POST', body: JSON.stringify({ query: feishuQuery.trim() }) }
      );
      if (data.success && Array.isArray(data.users)) {
        setFeishuCandidates(data.users);
        if (data.users.length === 0) message.info('未找到匹配的飞书用户');
      } else {
        message.error(data.error || '搜索失败');
      }
    } catch (err: any) {
      message.error(err?.message || '搜索飞书用户失败');
    } finally {
      setFeishuSearching(false);
    }
  }, [feishuQuery]);

  const handlePreauthorize = useCallback(async (candidate: typeof feishuCandidates[number]) => {
    setPreauthorizingId(candidate.openId);
    try {
      const data = await request<{ success: boolean; account?: AccountView; error?: string }>(
        '/auth/feishu/preauthorize',
        { method: 'POST', body: JSON.stringify({ openId: candidate.openId, name: candidate.name, email: candidate.email }) }
      );
      if (data.success) {
        message.success(`已预授权「${candidate.name}」`);
        await loadAccounts();
        setFeishuSearchOpen(false);
        setFeishuQuery('');
        setFeishuCandidates([]);
      } else {
        message.error(data.error || '预授权失败');
      }
    } catch (err: any) {
      message.error(err?.message || '预授权失败');
    } finally {
      setPreauthorizingId(null);
    }
  }, [loadAccounts]);

  // ============================================================
  // 批量权限操作
  // ============================================================
  const handleBatch = useCallback(async (action: 'setRole' | 'clearOverride', value?: UserRole) => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先勾选要操作的账号');
      return;
    }
    setBatchLoading(true);
    try {
      const ids = selectedRowKeys.map(key => {
        const [type, id] = key.split(':');
        return { type, id };
      });
      const data = await request<{ success: boolean; updated?: number; results?: any[]; error?: string }>(
        '/auth/accounts/batch',
        { method: 'POST', body: JSON.stringify({ ids, action, value }) }
      );
      if (data.success) {
        const label = action === 'setRole' ? `已将 ${data.updated} 个账号设为「${value}」` : `已清除 ${data.updated} 个账号的权限覆盖`;
        message.success(label);
        setSelectedRowKeys([]);
        await loadAccounts();
      } else {
        message.error(data.error || '批量操作失败');
      }
    } catch (err: any) {
      message.error(err?.message || '批量操作失败');
    } finally {
      setBatchLoading(false);
    }
  }, [selectedRowKeys, loadAccounts]);

  // ============================================================
  // 角色矩阵：toggle / save / reset（保留原有逻辑）
  // ============================================================
  const handleToggle = (role: UserRole, module: AppModule, field: keyof ModulePermission) => {
    if (!isAdmin) {
      message.warning('只有管理者可以修改权限配置');
      return;
    }
    setLocalConfigs((prev) => {
      const next = { ...prev };
      const perms = next[role].map((p) =>
        p.module === module ? { ...p, [field]: !p[field] } : p
      );
      next[role] = perms;
      return next;
    });
  };

  const handleSave = () => {
    if (!isAdmin) {
      message.warning('只有管理者可以修改权限配置');
      return;
    }
    for (const role of ALL_ROLES) {
      updatePermissionConfig(role, localConfigs[role]);
    }
    message.success('角色默认权限已保存');
  };

  const handleReset = () => {
    if (!isAdmin) {
      message.warning('只有管理者可以重置权限');
      return;
    }
    const fresh = resetPermissions();
    setLocalConfigs(() => {
      const map: Record<string, ModulePermission[]> = {};
      for (const c of fresh) {
        map[c.role] = c.permissions;
      }
      return map as Record<UserRole, ModulePermission[]>;
    });
    message.success('已重置为默认权限');
  };

  // ============================================================
  // 账号管理：改角色 / 切启用 / 删除 / 保存覆盖
  // ============================================================
  const handleAccountRoleChange = async (acc: AccountView, newRole: UserRole | undefined) => {
    setSavingId(acc.id);
    try {
      await request(`/auth/accounts/${acc.type}/${encodeURIComponent(acc.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ manualRole: newRole || null }),
      });
      message.success(`已${newRole ? `将「${acc.name}」角色覆盖为${newRole}` : `清除「${acc.name}」角色覆盖`}`);
      await loadAccounts();
    } catch (err: any) {
      message.error(err?.message || '保存失败');
    } finally {
      setSavingId(null);
    }
  };

  const handleToggleActive = async (acc: AccountView, active: boolean) => {
    setSavingId(acc.id);
    try {
      await request(`/auth/accounts/${acc.type}/${encodeURIComponent(acc.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ active }),
      });
      message.success(`已${active ? '启用' : '禁用'}「${acc.name}」`);
      await loadAccounts();
    } catch (err: any) {
      message.error(err?.message || '保存失败');
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteAccount = async (acc: AccountView) => {
    setSavingId(acc.id);
    try {
      await request(`/auth/accounts/local/${encodeURIComponent(acc.username)}`, {
        method: 'DELETE',
      });
      message.success(`已删除账号「${acc.name}」`);
      await loadAccounts();
    } catch (err: any) {
      message.error(err?.message || '删除失败');
    } finally {
      setSavingId(null);
    }
  };

  // ============================================================
  // 新增账密账号
  // ============================================================
  const handleAddAccount = async () => {
    try {
      const values = await addForm.validateFields();
      setAddingUser(true);
      await request('/auth/accounts/local', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      message.success(`已新增账号「${values.name}」`);
      setAddModalOpen(false);
      addForm.resetFields();
      await loadAccounts();
    } catch (err: any) {
      if (err?.errorFields) return; // 表单校验错误，不提示
      message.error(err?.message || '新增失败');
    } finally {
      setAddingUser(false);
    }
  };

  // ============================================================
  // 模块权限覆盖弹窗
  // ============================================================
  const openPermModal = (acc: AccountView) => {
    // 用账号的 manualPerms 初始化；若没有，用 effectiveRole 的角色默认权限做起点
    const basePerms = acc.manualPerms && acc.manualPerms.length > 0
      ? acc.manualPerms
      : (permissionConfigs.find(c => c.role === acc.effectiveRole)?.permissions ?? []);
    // 兜底：补齐 9 模块
    const draft: ModulePermission[] = ALL_MODULES.map(m => {
      const existing = basePerms.find(p => p.module === m);
      return existing ?? { module: m, view: false, edit: false, delete: false };
    });
    setPermDraft(draft);
    setPermModal({ account: acc });
  };

  const togglePermInDraft = (module: AppModule, field: keyof ModulePermission) => {
    setPermDraft(prev => prev.map(p =>
      p.module === module ? { ...p, [field]: !p[field] } : p
    ));
  };

  const clearPermDraft = () => {
    setPermDraft(prev => prev.map(p => ({ ...p, view: false, edit: false, delete: false })));
  };

  const fillFromRole = (role: UserRole) => {
    const ref = permissionConfigs.find(c => c.role === role)?.permissions ?? [];
    setPermDraft(prev => prev.map(p => {
      const r = ref.find(x => x.module === p.module);
      return r ?? { ...p, view: false, edit: false, delete: false };
    }));
  };

  const savePermDraft = async () => {
    if (!permModal) return;
    const acc = permModal.account;
    setSavingId(acc.id);
    try {
      // 检查是否全 false → 清除覆盖，回到角色默认
      const allFalse = permDraft.every(p => !p.view && !p.edit && !p.delete);
      const body = { manualPerms: allFalse ? null : permDraft };
      await request(`/auth/accounts/${acc.type}/${encodeURIComponent(acc.id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      message.success(`已保存「${acc.name}」的模块权限覆盖`);
      setPermModal(null);
      await loadAccounts();
    } catch (err: any) {
      message.error(err?.message || '保存失败');
    } finally {
      setSavingId(null);
    }
  };

  const clearPermOverride = async () => {
    if (!permModal) return;
    const acc = permModal.account;
    setSavingId(acc.id);
    try {
      await request(`/auth/accounts/${acc.type}/${encodeURIComponent(acc.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ manualPerms: null }),
      });
      message.success(`已清除「${acc.name}」的模块权限覆盖`);
      setPermModal(null);
      await loadAccounts();
    } catch (err: any) {
      message.error(err?.message || '清除失败');
    } finally {
      setSavingId(null);
    }
  };

  // ============================================================
  // 角色矩阵表格列（保留原逻辑）
  // ============================================================
  const matrixColumns = [
    {
      title: '功能模块',
      dataIndex: 'module',
      key: 'module',
      render: (m: AppModule) => MODULE_LABELS[m],
    },
    ...ALL_ROLES.map((role) => ({
      title: () => <Tag color={ROLE_COLORS[role]}>{role}</Tag>,
      key: role,
      render: (_: unknown, record: { module: AppModule }) => {
        const perm = localConfigs[role]?.find((p) => p.module === record.module);
        if (!perm) return null;
        return (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#6b6892', fontSize: 11 }}>
              <Switch
                size="small"
                checked={perm.view}
                onChange={() => handleToggle(role, record.module, 'view')}
                disabled={!isAdmin}
              />{' '}
              查看
            </span>
            <span style={{ color: '#6b6892', fontSize: 11 }}>
              <Switch
                size="small"
                checked={perm.edit}
                onChange={() => handleToggle(role, record.module, 'edit')}
                disabled={!isAdmin}
              />{' '}
              编辑
            </span>
            <span style={{ color: '#6b6892', fontSize: 11 }}>
              <Switch
                size="small"
                checked={perm.delete}
                onChange={() => handleToggle(role, record.module, 'delete')}
                disabled={!isAdmin}
              />{' '}
              删除
            </span>
          </div>
        );
      },
    })),
  ];
  const matrixDataSource = matrixModules.map((module) => ({ module, key: module }));

  // ============================================================
  // 账号管理表格列
  // ============================================================
  const accountColumns = [
    {
      title: '账号',
      key: 'username',
      render: (_: unknown, acc: AccountView) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {acc.type === 'feishu'
            ? <TeamOutlined style={{ color: '#6366f1' }} />
            : <UserOutlined style={{ color: '#d97706' }} />}
          <div>
            <div style={{ color: '#1e1b2e' }}>{acc.name}</div>
            <div style={{ color: '#6b6892', fontSize: 11 }}>{acc.username}</div>
          </div>
        </div>
      ),
    },
    {
      title: '类型',
      key: 'type',
      width: 90,
      render: (_: unknown, acc: AccountView) => (
        <Tag color={acc.type === 'feishu' ? 'blue' : 'gold'}>
          {acc.type === 'feishu' ? '飞书' : '账密'}
        </Tag>
      ),
    },
    {
      title: '自动角色',
      key: 'autoRole',
      width: 100,
      render: (_: unknown, acc: AccountView) => (
        <Tag color={ROLE_COLORS[acc.role]}>{acc.role}</Tag>
      ),
    },
    {
      title: '有效角色',
      key: 'effectiveRole',
      width: 150,
      render: (_: unknown, acc: AccountView) => (
        <Select
          size="small"
          style={{ width: 110 }}
          value={acc.manualRole ?? undefined}
          placeholder="默认"
          allowClear
          disabled={!isAdmin || savingId === acc.id}
          onChange={(v: UserRole | undefined) => handleAccountRoleChange(acc, v)}
          options={ALL_ROLES.map(r => ({ label: r, value: r }))}
        />
      ),
    },
    {
      title: '模块权限覆盖',
      key: 'manualPerms',
      width: 140,
      render: (_: unknown, acc: AccountView) => {
        const hasOverride = acc.manualPerms && acc.manualPerms.length > 0;
        return (
          <Button
            size="small"
            type={hasOverride ? 'primary' : 'default'}
            ghost={hasOverride}
            disabled={!isAdmin}
            onClick={() => openPermModal(acc)}
            icon={<KeyOutlined />}
          >
            {hasOverride ? `已覆盖 ${acc.manualPerms!.length} 项` : '配置覆盖'}
          </Button>
        );
      },
    },
    {
      title: '状态',
      key: 'active',
      width: 90,
      render: (_: unknown, acc: AccountView) => {
        if (acc.type === 'feishu') {
          return <Tag color="green">活跃</Tag>;
        }
        return (
          <Switch
            size="small"
            checked={acc.active}
            disabled={!isAdmin || savingId === acc.id || acc.username === 'admin'}
            onChange={(v) => handleToggleActive(acc, v)}
          />
        );
      },
    },
    {
      title: '操作',
      key: 'op',
      width: 100,
      render: (_: unknown, acc: AccountView) => {
        if (acc.type === 'feishu') {
          return <span style={{ color: '#9d9ab8', fontSize: 11 }}>—</span>;
        }
        if (acc.username === 'admin') {
          return <Tooltip title="admin 不可删除"><LockOutlined style={{ color: '#9d9ab8' }} /></Tooltip>;
        }
        return (
          <Popconfirm
            title="确认删除该账号？"
            description="删除后该用户将无法登录"
            onConfirm={() => handleDeleteAccount(acc)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button
              size="small"
              danger
              type="text"
              icon={<DeleteOutlined />}
              disabled={!isAdmin || savingId === acc.id}
            />
          </Popconfirm>
        );
      },
    },
  ];

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <div>
      <div className="page-header">
        <h3>
          <SafetyOutlined style={{ marginRight: 8, color: '#dc2626' }} />
          权限配置
        </h3>
        <div style={{ display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: 8 }}>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            disabled={!isAdmin}
            className="glass-btn"
            style={{ background: '#f6f5fc', border: '1px solid #d9d5f0', color: '#46436a', borderRadius: 8 }}
          >
            重置默认
          </Button>
          <Button
            type="primary"
            onClick={handleSave}
            disabled={!isAdmin}
            style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', border: 'none', borderRadius: 8 }}
          >
            保存角色矩阵
          </Button>
        </div>
      </div>

      {!isAdmin && (
        <Card
          style={{
            background: 'rgba(220, 38, 38, 0.06)',
            border: '1px solid rgba(220, 38, 38, 0.28)',
            marginBottom: 16,
            borderRadius: 8,
          }}
          bodyStyle={{ padding: 12 }}
        >
          <p style={{ color: '#dc2626', margin: 0, fontSize: 13 }}>
            当前身份为「{user?.role}」，仅管理者可修改权限配置。您可查看但无法修改。
          </p>
        </Card>
      )}

      {/* AI 用量展示（原 AI 测试专家页的 Token 余量条迁移至此） */}
      <AiQuotaCard />

      {/* ============== 账号权限配置卡片 ============== */}
      <Card
        title={
          <Space>
            <TeamOutlined style={{ color: '#6366f1' }} />
            <span style={{ color: '#1e1b2e' }}>账号权限配置</span>
            <Badge count={accounts.length} style={{ backgroundColor: '#6366f1' }} />
          </Space>
        }
        extra={
          isAdmin && (
            <Space wrap={isMobile}>
              <Button
                icon={<ReloadOutlined />}
                onClick={loadAccounts}
                loading={loadingAccounts}
                size="small"
              >
                刷新
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setAddModalOpen(true)}
                size="small"
                style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', border: 'none' }}
              >
                新增账密账号
              </Button>
              <Button
                icon={<SearchOutlined />}
                onClick={() => setFeishuSearchOpen(true)}
                size="small"
                style={{ background: 'linear-gradient(135deg, #16a34a, #0d9488)', border: 'none', color: '#fff' }}
              >
                搜索飞书账号
              </Button>
              {selectedRowKeys.length > 0 && (
                <span style={{ borderLeft: '1px solid #d9d5f0', paddingLeft: 8, marginLeft: 4 }}>
                  <span style={{ color: '#46436a', fontSize: 12, marginRight: 8 }}>
                    已选 {selectedRowKeys.length} 个
                  </span>
                  <Button size="small" icon={<ThunderboltOutlined />} loading={batchLoading}
                    onClick={() => handleBatch('setRole', '管理者')}
                    style={{ marginRight: 4, borderColor: '#dc2626', color: '#dc2626' }}>
                    批量设为管理者
                  </Button>
                  <Button size="small" loading={batchLoading}
                    onClick={() => handleBatch('setRole', '编辑者')}
                    style={{ marginRight: 4, borderColor: '#d97706', color: '#d97706' }}>
                    批量设为编辑者
                  </Button>
                  <Button size="small" loading={batchLoading}
                    onClick={() => handleBatch('clearOverride')}
                    style={{ marginRight: 4 }}>
                    批量清除覆盖
                  </Button>
                  <Button size="small" type="link" onClick={() => setSelectedRowKeys([])}>
                    取消选择
                  </Button>
                </span>
              )}
            </Space>
          )
        }
        style={{
          background: '#ffffff',
          border: '1px solid #e9e7f4',
          borderRadius: 12,
          marginBottom: 16,
        }}
        headStyle={{ borderBottom: '1px solid #e9e7f4' }}
        bodyStyle={{ padding: 0 }}
      >
        <Spin spinning={loadingAccounts}>
          {accounts.length === 0 && !loadingAccounts ? (
            <div style={{ padding: 24 }}>
              <Empty
                description={<span style={{ color: '#6b6892' }}>暂无账号记录</span>}
              />
            </div>
          ) : (
            <Table
              dataSource={accounts}
              columns={accountColumns}
              pagination={false}
              rowKey={(r) => `${r.type}:${r.id}`}
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[]),
              }}
              size="small"
              style={{ background: 'transparent' }}
              className="dark-table"
              expandable={{
                expandedRowRender: (acc: AccountView) => (
                  <div style={{ color: '#6b6892', fontSize: 12, paddingLeft: 8 }}>
                    {acc.type === 'feishu' && acc.deptNames && acc.deptNames.length > 0 && (
                      <div>部门：{acc.deptNames.map((d, i) => <Tag key={i}>{d}</Tag>)}</div>
                    )}
                    {acc.email && <div>邮箱：{acc.email}</div>}
                    {acc.lastLoginAt && <div>最近登录：{new Date(acc.lastLoginAt).toLocaleString('zh-CN')}</div>}
                    {acc.createdAt && <div>创建时间：{new Date(acc.createdAt).toLocaleString('zh-CN')}</div>}
                    {acc.manualPerms && acc.manualPerms.length > 0 && (
                      <div>
                        模块权限覆盖详情：
                        {acc.manualPerms.map(p => (
                          <Tag key={p.module} style={{ marginLeft: 4 }}>
                            {MODULE_LABELS[p.module]}：
                            {p.view ? '✓查看' : '✗查看'}
                            {p.edit ? '✓编辑' : '✗编辑'}
                            {p.delete ? '✓删除' : '✗删除'}
                          </Tag>
                        ))}
                      </div>
                    )}
                  </div>
                ),
                rowExpandable: (acc: AccountView) =>
                  !!(acc.deptNames?.length || acc.email || acc.lastLoginAt || acc.createdAt || acc.manualPerms?.length),
              }}
            />
          )}
        </Spin>
      </Card>

      {/* ============== AI 用量统计（仅管理者） ============== */}
      {isAdmin && (
        <Card
          title={
            <Space wrap={isMobile}>
              <ThunderboltOutlined style={{ color: '#16a34a' }} />
              <span style={{ color: '#1e1b2e' }}>AI 用量统计（近30天）</span>
              <span style={{ color: '#9d9ab8', fontSize: 12 }}>
                口径：每日 1.1亿 token（≈1.2万积分）· 每周硬限额 6万积分 · 1积分≈9167 token
              </span>
            </Space>
          }
          extra={
            <Button icon={<ReloadOutlined />} onClick={loadAiUsage} loading={aiUsageLoading} size="small">
              刷新
            </Button>
          }
          style={{
            background: '#ffffff',
            border: '1px solid #e9e7f4',
            borderRadius: 12,
            marginBottom: 16,
          }}
          headStyle={{ borderBottom: '1px solid #e9e7f4' }}
          bodyStyle={{ padding: 0 }}
        >
          <Table
            dataSource={aiUsage}
            columns={aiUsageColumns}
            pagination={false}
            rowKey="username"
            size="small"
            locale={{ emptyText: <Empty description="近30天暂无 AI 问答记录" /> }}
            className="dark-table"
            style={{ background: 'transparent' }}
          />
        </Card>
      )}

      {/* ============== 原角色矩阵 ============== */}
      <Card
        title={
          <Space>
            <SafetyOutlined style={{ color: '#d97706' }} />
            <span style={{ color: '#1e1b2e' }}>角色默认权限矩阵</span>
          </Space>
        }
        style={{
          background: '#ffffff',
          border: '1px solid #e9e7f4',
          borderRadius: 12,
        }}
        headStyle={{ borderBottom: '1px solid #e9e7f4' }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          dataSource={matrixDataSource}
          columns={matrixColumns}
          pagination={false}
          rowKey="module"
          style={{ background: 'transparent' }}
          className="dark-table"
        />
      </Card>

      <div style={{ marginTop: 16, color: '#9d9ab8', fontSize: 12 }}>
        <p>说明：</p>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>「账号权限配置」：按账号维度覆盖角色或模块权限（飞书用户登录后才会出现在列表）</li>
          <li>「有效角色」：清空则用自动推断角色（飞书按部门规则；账密用默认）</li>
          <li>「模块权限覆盖」：为该账号单独配置 9 个模块的查看/编辑/删除权限，优先于角色矩阵</li>
          <li>「角色默认权限矩阵」：配置三个角色各自的默认权限（影响所有未单独覆盖的账号）</li>
          <li>查看：允许进入该模块页面查看数据；编辑：允许新增/修改/上传；删除：允许删除数据</li>
        </ul>
      </div>

      {/* ============== 新增账密账号弹窗 ============== */}
      <Modal
        title={<Space><PlusOutlined style={{ color: '#6366f1' }} />新增账密账号</Space>}
        open={addModalOpen}
        onOk={handleAddAccount}
        onCancel={() => { setAddModalOpen(false); addForm.resetFields(); }}
        confirmLoading={addingUser}
        okText="新增"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 24px)' : 520}
        destroyOnClose
      >
        <Form form={addForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="username"
            label="登录账号"
            rules={[
              { required: true, message: '请输入登录账号' },
              { pattern: /^[a-zA-Z0-9_]{3,32}$/, message: '3-32 位字母/数字/下划线' },
              {
                validator: (_, value: string) =>
                  value && value.startsWith('feishu:')
                    ? Promise.reject(new Error('不能以 feishu: 开头（保留前缀）'))
                    : Promise.resolve(),
              },
            ]}
          >
            <Input placeholder="如：tester1" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: '请输入初始密码' },
              { min: 6, message: '至少 6 位' },
            ]}
          >
            <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="name"
            label="姓名"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input placeholder="如：张三" />
          </Form.Item>
          <Form.Item
            name="role"
            label="默认角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              placeholder="选择默认角色"
              options={ALL_ROLES.map(r => ({
                label: <Tag color={ROLE_COLORS[r]}>{r}</Tag>,
                value: r,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ============== 飞书搜索预授权弹窗 ============== */}
      <Modal
        open={feishuSearchOpen}
        onCancel={() => { setFeishuSearchOpen(false); setFeishuQuery(''); setFeishuCandidates([]); }}
        footer={null}
        width={isMobile ? 'calc(100vw - 24px)' : 640}
        title={
          <Space>
            <SearchOutlined style={{ color: '#16a34a' }} />
            <span>搜索飞书账号并预授权</span>
          </Space>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="输入姓名 / 工号 / 邮箱 / 手机号"
              value={feishuQuery}
              onChange={(e) => setFeishuQuery(e.target.value)}
              onPressEnter={handleFeishuSearch}
              prefix={<SearchOutlined style={{ color: '#9d9ab8' }} />}
              style={{ flex: 1 }}
              allowClear
            />
            <Button type="primary" loading={feishuSearching} onClick={handleFeishuSearch}
              style={{ background: 'linear-gradient(135deg, #16a34a, #0d9488)', border: 'none' }}>
              搜索
            </Button>
          </Space.Compact>
        </div>
        <div style={{ color: '#6b6892', fontSize: 12, marginBottom: 12 }}>
          搜索到的用户可立即预授权（默认角色为编辑者），授权后可在账号列表中配置具体权限。
          用户首次登录后，预配置的权限会自动保留。
        </div>
        {feishuCandidates.length > 0 && (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {feishuCandidates.map((c) => {
              const alreadyExists = accounts.some(a => a.id === c.openId);
              return (
                <div key={c.openId}
                  style={{
                    padding: '12px 16px', marginBottom: 8, borderRadius: 8,
                    background: '#f6f5fc',
                    border: '1px solid #e9e7f4',
                    display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? 8 : undefined,
                  }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <UserOutlined style={{ color: '#16a34a' }} />
                      <strong style={{ color: '#1e1b2e' }}>{c.name}</strong>
                      {alreadyExists && <Tag color="orange" style={{ margin: 0 }}>已预授权</Tag>}
                    </div>
                    <div style={{ color: '#6b6892', fontSize: 12, display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: 16 }}>
                      {c.email && <span>邮箱: {c.email}</span>}
                      {c.mobile && <span>手机: {c.mobile}</span>}
                      {c.userId && <span>工号: {c.userId}</span>}
                    </div>
                  </div>
                  <Button
                    type="primary" size="small"
                    loading={preauthorizingId === c.openId}
                    disabled={alreadyExists}
                    onClick={() => handlePreauthorize(c)}
                    style={{ background: 'linear-gradient(135deg, #16a34a, #0d9488)', border: 'none' }}
                  >
                    {alreadyExists ? '已预授权' : '预授权'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* ============== 模块权限覆盖弹窗 ============== */}
      <Modal
        title={
          permModal && (
            <Space>
              <KeyOutlined style={{ color: '#6366f1' }} />
              <span>「{permModal.account.name}」模块权限覆盖</span>
            </Space>
          )
        }
        open={!!permModal}
        onOk={savePermDraft}
        onCancel={() => setPermModal(null)}
        confirmLoading={!!permModal && savingId === permModal.account.id}
        okText="保存覆盖"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 24px)' : 720}
        destroyOnClose
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            <Button
              danger
              type="text"
              icon={<UnlockOutlined />}
              onClick={clearPermOverride}
              loading={!!permModal && savingId === permModal.account.id}
            >
              清除覆盖
            </Button>
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        {permModal && (
          <div>
            <div style={{ marginBottom: 12, color: '#6b6892', fontSize: 12 }}>
              为该账号单独配置 9 个模块的查看/编辑/删除权限。优先级高于「角色默认权限矩阵」。
              全部清空（全 false）等价于清除覆盖。
            </div>
            <div style={{ marginBottom: 12 }}>
              <Space wrap={isMobile}>
                <span style={{ color: '#46436a', fontSize: 12 }}>快速填充：</span>
                {ALL_ROLES.map(r => (
                  <Button key={r} size="small" onClick={() => fillFromRole(r)}>
                    用 {r} 权限
                  </Button>
                ))}
                <Button size="small" danger onClick={clearPermDraft}>全部清空</Button>
              </Space>
            </div>
            <Table
              dataSource={permDraft.map(p => ({ ...p, key: p.module }))}
              columns={[
                {
                  title: '模块',
                  dataIndex: 'module',
                  key: 'module',
                  render: (m: AppModule) => MODULE_LABELS[m],
                },
                {
                  title: '查看',
                  dataIndex: 'view',
                  key: 'view',
                  width: 100,
                  render: (v: boolean, r: { module: AppModule }) => (
                    <Switch size="small" checked={v} onChange={() => togglePermInDraft(r.module, 'view')} />
                  ),
                },
                {
                  title: '编辑',
                  dataIndex: 'edit',
                  key: 'edit',
                  width: 100,
                  render: (v: boolean, r: { module: AppModule }) => (
                    <Switch size="small" checked={v} onChange={() => togglePermInDraft(r.module, 'edit')} />
                  ),
                },
                {
                  title: '删除',
                  dataIndex: 'delete',
                  key: 'delete',
                  width: 100,
                  render: (v: boolean, r: { module: AppModule }) => (
                    <Switch size="small" checked={v} onChange={() => togglePermInDraft(r.module, 'delete')} />
                  ),
                },
              ]}
              pagination={false}
              size="small"
              className="dark-table"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

export default PermissionConfig;
