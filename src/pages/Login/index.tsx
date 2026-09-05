import { useState, useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Form, Card, message, Divider, Collapse } from 'antd';
import { UserOutlined, LockOutlined, SafetyOutlined } from '@ant-design/icons';
import { useAuth } from '../../store/AuthContext';

function Login() {
  const [loading, setLoading] = useState(false);
  const [feishuEnabled, setFeishuEnabled] = useState<boolean | null>(null);
  const [searchParams] = useSearchParams();
  const { login, isAuthenticated } = useAuth();

  // 飞书 OAuth 回调处理：?feishu=success|error&msg=xxx
  useEffect(() => {
    const feishuStatus = searchParams.get('feishu');
    const msg = searchParams.get('msg');
    if (feishuStatus === 'success') {
      message.success('飞书登录成功');
      // AuthContext 启动时会调 /api/auth/me 自动拉用户，session cookie 已种下
    } else if (feishuStatus === 'error') {
      message.error(`飞书登录失败：${msg || '未知错误'}`);
    }
    // 清掉 query（防止刷新重复弹提示）
    if (feishuStatus) {
      const url = new URL(window.location.href);
      url.searchParams.delete('feishu');
      url.searchParams.delete('msg');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams]);

  // 查询飞书登录是否可用
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/feishu/status')
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data.success) setFeishuEnabled(data.enabled === true);
      })
      .catch(() => { if (!cancelled) setFeishuEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  // 关键修复：用 <Navigate> 组件做条件渲染
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const result = await login(values.username, values.password);
      if (result.success) {
        message.success(result.message);
      } else {
        message.error(result.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // 飞书登录：直接跳后端 /api/auth/feishu/login，由后端 302 到飞书授权页
  const handleFeishuLogin = () => {
    window.location.href = '/api/auth/feishu/login';
  };

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #fafafd 0%, #f1f0fe 50%, #eceafb 100%)',
      }}
    >
      <Card
        style={{
          width: 400,
          background: 'rgba(255, 255, 255, 0.92)',
          border: '1px solid rgba(99,102,241, 0.2)',
          borderRadius: 16,
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 24px rgba(99, 102, 241, 0.10)',
        }}
        bodyStyle={{ padding: '40px 32px' }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <SafetyOutlined style={{ fontSize: 48, color: '#6366f1', marginBottom: 16 }} />
          <h2
            style={{
              color: '#1e1b2e',
              fontSize: 22,
              fontWeight: 600,
              margin: 0,
              marginBottom: 8,
              fontFamily: 'var(--font-primary)',
            }}
          >
            智航万恒测试验证管理平台
          </h2>
          <p style={{ color: '#6b6892', fontSize: 13, margin: 0 }}>
            {feishuEnabled ? '使用飞书账号一键登录' : '请输入账号密码登录系统'}
          </p>
        </div>

        {/* 飞书登录按钮（飞书已配置时显示，作主入口） */}
        {feishuEnabled && (
          <>
            <Button
              size="large"
              block
              onClick={handleFeishuLogin}
              style={{
                background: 'linear-gradient(135deg, #3370ff, #2b5fe0)',
                border: 'none',
                borderRadius: 8,
                height: 44,
                fontSize: 15,
                fontWeight: 500,
                color: '#fff',
                boxShadow: '0 4px 12px rgba(51, 112, 255, 0.3)',
              }}
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: 8, verticalAlign: 'middle' }}>
                  <path fill="#fff" d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.3L19.5 8 12 11.7 4.5 8 12 4.3zM4 9.6l7 3.5v7.2l-7-3.5V9.6zm9 10.7v-7.2l7-3.5v7.2l-7 3.5z"/>
                </svg>
              }
            >
              飞书一键登录
            </Button>
            <Divider plain style={{ borderColor: '#d9d5f0', color: '#9d9ab8' }}>
              或使用账号密码
            </Divider>
          </>
        )}

        {/* 账密登录：飞书启用时折叠备用，未启用时直接展开 */}
        {feishuEnabled ? (
          <Collapse ghost>
            <Collapse.Panel
              key="password"
              header={<span style={{ color: '#6b6892', fontSize: 12 }}>管理员账号登录</span>}
            >
              <PasswordForm loading={loading} onSubmit={handleSubmit} />
            </Collapse.Panel>
          </Collapse>
        ) : (
          <PasswordForm loading={loading} onSubmit={handleSubmit} showDemoAccounts />
        )}

        {!feishuEnabled && (
          <div style={{ marginTop: 16, padding: 10, background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.12)', borderRadius: 6, fontSize: 11, color: '#6b6892' }}>
            <div style={{ fontWeight: 600, color: 'rgba(99,102,241,0.85)', marginBottom: 4 }}>演示账号</div>
            <div>管理员：<code style={{ color: '#818cf8' }}>admin</code> / <code style={{ color: '#818cf8' }}>admin123</code></div>
            <div>编辑者：<code style={{ color: '#818cf8' }}>editor</code> / <code style={{ color: '#818cf8' }}>editor123</code></div>
            <div>阅读者：<code style={{ color: '#818cf8' }}>reader</code> / <code style={{ color: '#818cf8' }}>reader123</code></div>
          </div>
        )}
      </Card>
    </div>
  );
}

// 抽出账密表单组件（折叠/展开两种形态共用）
function PasswordForm({
  loading,
  onSubmit,
  showDemoAccounts = false,
}: {
  loading: boolean;
  onSubmit: (values: { username: string; password: string }) => void;
  showDemoAccounts?: boolean;
}) {
  return (
    <Form
      name="login"
      onFinish={onSubmit}
      autoComplete="off"
      layout="vertical"
    >
      <Form.Item
        name="username"
        rules={[{ required: true, message: '请输入账号' }]}
      >
        <Input
          prefix={<UserOutlined style={{ color: '#6b6892' }} />}
          placeholder="账号"
          size="large"
          style={{
            background: '#f6f5fc',
            border: '1px solid #d9d5f0',
            color: '#1e1b2e',
            borderRadius: 8,
          }}
          className="dark-input"
        />
      </Form.Item>

      <Form.Item
        name="password"
        rules={[{ required: true, message: '请输入密码' }]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: '#6b6892' }} />}
          placeholder="密码"
          size="large"
          style={{
            background: '#f6f5fc',
            border: '1px solid #d9d5f0',
            color: '#1e1b2e',
            borderRadius: 8,
          }}
          className="dark-input"
        />
      </Form.Item>

      <Form.Item style={{ marginBottom: 0 }}>
        <Button
          type="primary"
          htmlType="submit"
          size="large"
          loading={loading}
          block
          style={{
            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
            border: 'none',
            borderRadius: 8,
            height: 44,
            fontSize: 15,
            fontWeight: 500,
          }}
        >
          登录
        </Button>
      </Form.Item>
    </Form>
  );
}

export default Login;
