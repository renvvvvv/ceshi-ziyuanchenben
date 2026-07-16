import { useState, useMemo } from 'react';
import { Card, Table, Switch, Button, Tag, message } from 'antd';
import { ReloadOutlined, SafetyOutlined } from '@ant-design/icons';
import { useAuth } from '../../store/AuthContext';
import type { UserRole, AppModule, ModulePermission } from '../../types';

const MODULE_LABELS: Record<AppModule, string> = {
  dashboard: '仪表盘',
  projects: '项目管理',
  history: '历史项目',
  teamPool: '测试人员池',
  testGuide: '测试管理制度',
  resourceCalc: '资源计算器',
  attendance: '人员考勤',
  reportReview: '测试报告审核',
  permissionConfig: '权限配置',
};

const ROLE_COLORS: Record<UserRole, string> = {
  '管理者': '#ff4d4f',
  '编辑者': '#faad14',
  '阅读者': '#4d9fff',
};

function PermissionConfig() {
  const { permissionConfigs, updatePermissionConfig, resetPermissions, user } = useAuth();
  const [localConfigs, setLocalConfigs] = useState<Record<UserRole, ModulePermission[]>>(
    () => {
      const map: Record<string, ModulePermission[]> = {};
      for (const c of permissionConfigs) {
        map[c.role] = c.permissions;
      }
      return map as Record<UserRole, ModulePermission[]>;
    }
  );

  const isAdmin = user?.role === '管理者';

  const roles: UserRole[] = ['管理者', '编辑者', '阅读者'];
  const modules = useMemo<AppModule[]>(
    () => ['dashboard', 'projects', 'history', 'teamPool', 'testGuide', 'resourceCalc', 'permissionConfig'],
    []
  );

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
    for (const role of roles) {
      updatePermissionConfig(role, localConfigs[role]);
    }
    message.success('权限配置已保存');
  };

  const handleReset = () => {
    if (!isAdmin) {
      message.warning('只有管理者可以重置权限');
      return;
    }
    resetPermissions();
    setLocalConfigs(() => {
      const map: Record<string, ModulePermission[]> = {};
      for (const c of permissionConfigs) {
        map[c.role] = c.permissions;
      }
      return map as Record<UserRole, ModulePermission[]>;
    });
    message.success('已重置为默认权限');
  };

  const columns = [
    {
      title: '功能模块',
      dataIndex: 'module',
      key: 'module',
      render: (m: AppModule) => MODULE_LABELS[m],
    },
    ...roles.map((role) => ({
      title: () => <Tag color={ROLE_COLORS[role]}>{role}</Tag>,
      key: role,
      render: (_: unknown, record: { module: AppModule }) => {
        const perm = localConfigs[role]?.find((p) => p.module === record.module);
        if (!perm) return null;
        return (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
              <Switch
                size="small"
                checked={perm.view}
                onChange={() => handleToggle(role, record.module, 'view')}
                disabled={!isAdmin}
              />{' '}
              查看
            </span>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
              <Switch
                size="small"
                checked={perm.edit}
                onChange={() => handleToggle(role, record.module, 'edit')}
                disabled={!isAdmin}
              />{' '}
              编辑
            </span>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
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

  const dataSource = modules.map((module) => ({ module, key: module }));

  return (
    <div>
      <div className="page-header">
        <h3>
          <SafetyOutlined style={{ marginRight: 8, color: '#ff4d4f' }} />
          权限配置
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            disabled={!isAdmin}
            className="glass-btn"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', borderRadius: 8 }}
          >
            重置默认
          </Button>
          <Button
            type="primary"
            onClick={handleSave}
            disabled={!isAdmin}
            style={{ background: 'linear-gradient(135deg, #4d9fff, #3578e5)', border: 'none', borderRadius: 8 }}
          >
            保存配置
          </Button>
        </div>
      </div>

      {!isAdmin && (
        <Card
          style={{
            background: 'rgba(255, 77, 79, 0.08)',
            border: '1px solid rgba(255, 77, 79, 0.3)',
            marginBottom: 16,
            borderRadius: 8,
          }}
          bodyStyle={{ padding: 12 }}
        >
          <p style={{ color: '#ff4d4f', margin: 0, fontSize: 13 }}>
            当前身份为「{user?.role}」，仅管理者可修改权限配置。您可查看但无法修改。
          </p>
        </Card>
      )}

      <Card
        style={{
          background: 'rgba(13, 31, 60, 0.6)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
        }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          dataSource={dataSource}
          columns={columns}
          pagination={false}
          rowKey="module"
          style={{ background: 'transparent' }}
          className="dark-table"
        />
      </Card>

      <div style={{ marginTop: 16, color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
        <p>说明：</p>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>查看：允许进入该模块页面查看数据</li>
          <li>编辑：允许新增、修改、上传等操作</li>
          <li>删除：允许删除数据</li>
          <li>权限配置模块仅管理者可查看和编辑</li>
        </ul>
      </div>
    </div>
  );
}

export default PermissionConfig;
