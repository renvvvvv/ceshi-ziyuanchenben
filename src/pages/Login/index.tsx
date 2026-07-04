import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Form, Card, message, Divider } from 'antd';
import { UserOutlined, LockOutlined, SafetyOutlined, TeamOutlined } from '@ant-design/icons';
import { useAuth } from '../../store/AuthContext';

function Login() {
  const [loading, setLoading] = useState(false);
  const [feishuLoading, setFeishuLoading] = useState(false);
  const { login, loginWithFeishu } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // 处理飞书回调
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (code && state) {
      handleFeishuCallback(code);
    }
  }, [searchParams]);

  const handleSubmit = (values: { username: string; password: string }) => {
    setLoading(true);
    const result = login(values.username, values.password);
    setLoading(false);
    if (result.success) {
      message.success(result.message);
      navigate('/');
    } else {
      message.error(result.message);
    }
  };

  const handleFeishuLogin = async () => {
    setFeishuLoading(true);
    try {
      const redirectUri = `${window.location.origin}/login`;
      const res = await fetch(`/api/auth/feishu/login?redirect_uri=${encodeURIComponent(redirectUri)}`);
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        message.error('获取飞书授权链接失败');
      }
    } catch (err) {
      message.error('飞书登录失败，请检查后端服务是否运行');
    } finally {
      setFeishuLoading(false);
    }
  };

  const handleFeishuCallback = async (code: string) => {
    setFeishuLoading(true);
    try {
      const res = await fetch('/api/auth/feishu/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        const result = loginWithFeishu(data.user);
        if (result.success) {
          message.success('飞书登录成功');
          navigate('/');
        } else {
          message.error(result.message);
        }
      } else {
        message.error(data.message || '飞书登录失败');
      }
    } catch (err) {
      message.error('飞书回调处理失败');
    } finally {
      setFeishuLoading(false);
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

        {/* 分割线 */}
        <Divider style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '20px 0', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
          或
        </Divider>

        {/* 飞书登录按钮 */}
        <Button
          size="large"
          loading={feishuLoading}
          block
          onClick={handleFeishuLogin}
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(0, 200, 120, 0.3)',
            color: 'rgba(255,255,255,0.9)',
            borderRadius: 8,
            height: 44,
            fontSize: 15,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <TeamOutlined style={{ color: '#00c878' }} />
          飞书登录
        </Button>

        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.3)',
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          <div>演示账号</div>
          <div style={{ marginTop: 4 }}>
            管理者：admin / admin123
          </div>
          <div>
            编辑者：editor / editor123
          </div>
          <div>
            阅读者：reader / reader123
          </div>
        </div>
      </Card>
    </div>
  );
}

export default Login;
