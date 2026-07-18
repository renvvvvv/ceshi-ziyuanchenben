import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Form, Card, message } from 'antd';
import { UserOutlined, LockOutlined, SafetyOutlined } from '@ant-design/icons';
import { useAuth } from '../../store/AuthContext';

function Login() {
  const [loading, setLoading] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // 关键修复：用 useEffect 监听登录态，state 更新完成后再跳转
  // 解决"login() 同步触发 navigate 但 setState 异步"导致的反复跳登录 bug
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = (values: { username: string; password: string }) => {
    setLoading(true);
    const result = login(values.username, values.password);
    setLoading(false);
    if (result.success) {
      message.success(result.message);
      // 不再直接 navigate；让 useEffect 在 state 更新后自动跳转
    } else {
      message.error(result.message);
    }
  };

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0a1628 0%, #1a2d4a 50%, #0d1f3c 100%)',
      }}
    >
      <Card
        style={{
          width: 400,
          background: 'rgba(13, 31, 60, 0.85)',
          border: '1px solid rgba(77, 159, 255, 0.2)',
          borderRadius: 16,
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        }}
        bodyStyle={{ padding: '40px 32px' }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <SafetyOutlined style={{ fontSize: 48, color: '#4d9fff', marginBottom: 16 }} />
          <h2
            style={{
              color: '#fff',
              fontSize: 22,
              fontWeight: 600,
              margin: 0,
              marginBottom: 8,
              fontFamily: 'var(--font-primary)',
            }}
          >
            智航万恒测试验证管理平台
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 }}>
            请输入账号密码登录系统
          </p>
        </div>

        <Form
          name="login"
          onFinish={handleSubmit}
          autoComplete="off"
          layout="vertical"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: 'rgba(255,255,255,0.4)' }} />}
              placeholder="账号"
              size="large"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
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
              prefix={<LockOutlined style={{ color: 'rgba(255,255,255,0.4)' }} />}
              placeholder="密码"
              size="large"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
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
                background: 'linear-gradient(135deg, #4d9fff, #3578e5)',
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

        <div style={{ marginTop: 16, padding: 10, background: 'rgba(77,159,255,0.05)', border: '1px solid rgba(77,159,255,0.12)', borderRadius: 6, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          <div style={{ fontWeight: 600, color: 'rgba(77,159,255,0.85)', marginBottom: 4 }}>演示账号</div>
          <div>管理员：<code style={{ color: '#7cb8ff' }}>admin</code> / <code style={{ color: '#7cb8ff' }}>admin123</code></div>
          <div>编辑者：<code style={{ color: '#7cb8ff' }}>editor</code> / <code style={{ color: '#7cb8ff' }}>editor123</code></div>
          <div>阅读者：<code style={{ color: '#7cb8ff' }}>reader</code> / <code style={{ color: '#7cb8ff' }}>reader123</code></div>
        </div>
      </Card>
    </div>
  );
}

export default Login;