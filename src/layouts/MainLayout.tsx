import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Avatar, Dropdown } from 'antd';
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
} from '@ant-design/icons';

const { Sider, Content } = Layout;

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/projects', icon: <ProjectOutlined />, label: '项目管理' },
  { key: '/history', icon: <HistoryOutlined />, label: '历史项目' },
  { key: '/team-pool', icon: <TeamOutlined />, label: '测试人员池' },
  { key: '/test-guide', icon: <FileTextOutlined />, label: '测试管理制度' },
  { key: '/resource-calculator', icon: <CalculatorOutlined />, label: '资源计算器' },
];

function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const selectedKey = '/' + location.pathname.split('/')[1];

  const onMenuClick = ({ key }: { key: string }) => {
    navigate(key);
  };

  const userMenuItems = [
    { key: 'profile', icon: <UserOutlined />, label: '个人信息' },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
  ];

  const pageTitles: Record<string, string> = {
    '/dashboard': '仪表盘',
    '/projects': '项目管理',
    '/history': '历史项目',
    '/team-pool': '测试人员池',
    '/test-guide': '测试管理制度',
    '/resource-calculator': '资源计算器',
  };

  const currentTitle = pageTitles[selectedKey] || '';

  return (
    <Layout className="app-layout">
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
          onClick={() => navigate('/dashboard')}
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
              opacity: collapsed ? 0 : 1,
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
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 72 : 220, transition: 'margin-left 0.28s cubic-bezier(0.4, 0, 0.2, 1)' }}>
        <div className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: 16, width: 40, height: 40, color: 'rgba(255,255,255,0.6)', transition: 'all 0.3s ease', borderRadius: 8 }}
            />
            <h3 style={{ transition: 'color 0.3s ease' }}>{currentTitle}</h3>
          </div>
          <div className="header-right">
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'opacity 0.2s ease' }}>
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
                <span style={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-primary)', fontSize: 13 }}>管理员</span>
              </div>
            </Dropdown>
          </div>
        </div>
        <Content>
          {/* key 触发路由切换时的淡入动画 */}
          <div className="app-content" key={location.pathname}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

export default MainLayout;
