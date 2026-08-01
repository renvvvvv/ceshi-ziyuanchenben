import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Avatar, Dropdown, Tag, Alert, Drawer, Grid } from 'antd';
import {
  DashboardOutlined,
  ProjectOutlined,
  HistoryOutlined,
  TeamOutlined,
  FileTextOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  CalculatorOutlined,
  SafetyOutlined,
  BookOutlined,
  CalendarOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import { useAuth } from '../store/AuthContext';
import { useData } from '../store/DataContext';
import type { AppModule } from '../types';

const { Sider, Content } = Layout;
const { useBreakpoint } = Grid;

interface MenuItemDef {
  key: string;
  icon: React.ReactNode;
  label: string;
  module: AppModule;
}

const ALL_MENU_ITEMS: MenuItemDef[] = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘', module: 'dashboard' },
  { key: '/projects', icon: <ProjectOutlined />, label: '项目管理', module: 'projects' },
  { key: '/history', icon: <HistoryOutlined />, label: '历史项目', module: 'history' },
  { key: '/team-pool', icon: <TeamOutlined />, label: '测试人员池', module: 'teamPool' },
  { key: '/attendance', icon: <CalendarOutlined />, label: '人员考勤', module: 'attendance' },
  { key: '/test-guide', icon: <FileTextOutlined />, label: '测试管理制度', module: 'testGuide' },
  { key: '/knowledge-base', icon: <BookOutlined />, label: '知识库', module: 'dashboard' },
  { key: '/report-review', icon: <FileSearchOutlined />, label: '测试报告审核', module: 'reportReview' },
  { key: '/resource-calculator', icon: <CalculatorOutlined />, label: '资源计算器', module: 'resourceCalc' },
  { key: '/permission-config', icon: <SafetyOutlined />, label: '权限配置', module: 'permissionConfig' },
];

const ROLE_COLORS: Record<string, string> = {
  '管理者': '#ff4d4f',
  '编辑者': '#faad14',
  '阅读者': '#4d9fff',
};

function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, canView } = useAuth();
  const { dataSource } = useData();
  // 响应式断点：lg(≥992px) 显示固定侧边栏，以下用 Drawer 抽屉
  const screens = useBreakpoint();
  const isDesktop = screens.lg;

  const selectedKey = '/' + location.pathname.split('/')[1];

  // 数据源状态提示（仅在非 api 状态显示）
  const dataSourceAlert = (() => {
    if (dataSource === 'loading') return null;
    if (dataSource === 'api') return null;
    if (dataSource === 'cache') {
      return (
        <Alert
          type="warning"
          showIcon
          banner
          message="离线模式：后端服务不可达，当前显示本地缓存数据。修改不会同步到服务器。"
          style={{ borderRadius: 0, fontSize: 12 }}
        />
      );
    }
    if (dataSource === 'mock') {
      return (
        <Alert
          type="info"
          showIcon
          banner
          message="调试模式：使用 Mock 数据（VITE_USE_MOCK_DATA=true）。所有修改仅本地生效。"
          style={{ borderRadius: 0, fontSize: 12 }}
        />
      );
    }
    // error
    return (
      <Alert
        type="error"
        showIcon
        banner
        message="数据加载失败：后端服务不可达且无本地缓存。请检查网络或联系管理员。"
        style={{ borderRadius: 0, fontSize: 12 }}
      />
    );
  })();

  // 根据权限过滤菜单项
  const visibleMenuItems = ALL_MENU_ITEMS.filter((item) => canView(item.module));
  const menuItems = visibleMenuItems.map((item) => ({
    key: item.key,
    icon: item.icon,
    label: item.label,
  }));

  const onMenuClick = ({ key }: { key: string }) => {
    navigate(key);
    setDrawerOpen(false);
  };

  const handleUserAction = ({ key }: { key: string }) => {
    if (key === 'logout') {
      logout();
      navigate('/login');
    } else if (key === 'profile') {
      navigate('/permission-config');
    }
  };

  const userMenuItems = [
    ...(canView('permissionConfig') ? [{ key: 'profile', icon: <UserOutlined />, label: '权限配置' }] : []),
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  const pageTitles: Record<string, string> = {
    '/dashboard': '仪表盘',
    '/projects': '项目管理',
    '/history': '历史项目',
    '/team-pool': '测试人员池',
    '/test-guide': '测试管理制度',
    '/resource-calculator': '资源计算器',
    '/knowledge-base': '知识库',
    '/report-review': '测试报告审核',
    '/attendance': '人员考勤',
    '/permission-config': '权限配置',
  };

  const currentTitle = pageTitles[selectedKey] || '';

  // 侧边栏内容（Sider 与 Drawer 共用）
  const siderContent = (
    <>
      <div
        className="logo-container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '18px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          cursor: 'pointer',
          transition: 'background 0.3s ease',
        }}
        onClick={() => { navigate('/dashboard'); setDrawerOpen(false); }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-primary)',
            lineHeight: 1.4,
            textAlign: 'center',
            letterSpacing: '0.5px',
            whiteSpace: 'nowrap',
            opacity: collapsed && isDesktop ? 0 : 1,
            transition: 'opacity 0.2s ease',
          }}
        >
          智航万恒测试验证管理平台
        </div>
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={onMenuClick}
      />
    </>
  );

  return (
    <Layout className="app-layout">
      {isDesktop ? (
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          width={220}
          style={{
            overflow: 'auto',
            height: '100vh',
            position: 'fixed',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 100,
            transition: 'width 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {siderContent}
        </Sider>
      ) : (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={240}
          className="mobile-sider-drawer"
          styles={{ body: { padding: 0, background: 'linear-gradient(180deg, #0d1f3c 0%, #061428 100%)' } }}
        >
          {siderContent}
        </Drawer>
      )}
      <Layout className={isDesktop ? '' : 'mobile-layout'} style={isDesktop ? { marginLeft: collapsed ? 72 : 220, transition: 'margin-left 0.28s cubic-bezier(0.4, 0, 0.2, 1)' } : undefined}>
        <div className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Button
              type="text"
              icon={isDesktop ? (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />) : <MenuUnfoldOutlined />}
              onClick={() => isDesktop ? setCollapsed(!collapsed) : setDrawerOpen(true)}
              style={{ fontSize: 16, width: 40, height: 40, color: 'rgba(255,255,255,0.6)', transition: 'all 0.3s ease', borderRadius: 8 }}
            />
            <h3 style={{ transition: 'color 0.3s ease' }}>{currentTitle}</h3>
          </div>
          <div className="header-right">
            <Dropdown menu={{ items: userMenuItems, onClick: handleUserAction }} placement="bottomRight">
              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'opacity 0.2s ease' }}>
                <Avatar
                  icon={<UserOutlined />}
                  style={{
                    background: 'linear-gradient(135deg, #4d9fff, #69b1ff)',
                    boxShadow: '0 2px 8px rgba(77,159,255,0.35)',
                    fontFamily: 'var(--font-primary)',
                    fontWeight: 500,
                    transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ color: 'rgba(255,255,255,0.85)', fontFamily: 'var(--font-primary)', fontSize: 13, lineHeight: 1.4 }}>
                    {user?.name || '管理员'}
                  </span>
                  <Tag
                    color={ROLE_COLORS[user?.role || '管理者']}
                    style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px', height: 18, margin: 0, border: 'none' }}
                  >
                    {user?.role || '管理者'}
                  </Tag>
                </div>
              </div>
            </Dropdown>
          </div>
        </div>
        <Content>
          {dataSourceAlert}
          <div className="app-content" key={location.pathname}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

export default MainLayout;
