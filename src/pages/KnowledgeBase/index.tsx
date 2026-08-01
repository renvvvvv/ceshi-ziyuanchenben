import { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Spin, Empty, Input, message } from 'antd';
import {
  GlobalOutlined, RobotOutlined, UserOutlined, SendOutlined, ReloadOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;

// ============== 通用 Markdown 渲染（极简版，深色主题适配）==============
function renderMarkdown(md: string): string {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // 代码块
    .replace(/```([\s\S]*?)```/g, (_m, code) =>
      `<pre style="background:rgba(0,0,0,0.3);padding:12px;border-radius:6px;overflow-x:auto;margin:8px 0;font-size:12px"><code>${code.trim()}</code></pre>`)
    // 行内代码
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;font-size:12px;color:#52c41a">$1</code>')
    // 标题
    .replace(/^### (.+)$/gm, '<h4 style="color:#fff;margin:14px 0 6px;font-size:14px">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color:#fff;margin:16px 0 8px;font-size:15px">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="color:#fff;margin:18px 0 10px;font-size:17px">$1</h2>')
    // 加粗
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#7cb8ff">$1</strong>')
    // 无序列表
    .replace(/^- (.+)$/gm, '<div style="padding-left:16px;text-indent:-12px;margin:2px 0">• $1</div>')
    // 有序列表
    .replace(/^\d+\. (.+)$/gm, '<div style="padding-left:20px;margin:2px 0">$1</div>')
    // 表格分隔线
    .replace(/^\|[-| :]+$/gm, '')
    // 段落换行
    .replace(/\n/g, '<br/>');
  return html;
}

// ============== 主组件：知识库（飞书 iframe + AI 问答）==============
export default function KnowledgeBase() {
  const [kbData, setKbData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const defaultUrl = kbData?.tree?.[0]?.feishuLink || '';

  useEffect(() => {
    fetch('/kb/index.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { setKbData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const feishuTitle = kbData?.tree?.[0]?.title || '飞书知识库';

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      {/* 顶栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <GlobalOutlined style={{ color: '#4d9fff', fontSize: 18 }} />
        <div style={{ flex: 1 }}>
          <div style={{ color: 'rgba(255,255,255,0.95)', fontSize: 15, fontWeight: 600 }}>
            智航测试部知识库
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
            飞书知识库 · {kbData?.totalNodes || 0} 个文档
          </div>
        </div>
        {defaultUrl && (
          <Button
            size="small"
            type="primary"
            href={defaultUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            在飞书中打开 ↗
          </Button>
        )}
      </div>

      {/* 主体：飞书 iframe (左) + AI 问答 (右) */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左侧：飞书 iframe */}
        <div style={{ flex: 1, background: '#fff', minWidth: 0 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <Spin size="large" />
            </div>
          ) : defaultUrl ? (
            <iframe
              src={defaultUrl}
              title={feishuTitle}
              style={{ width: '100%', height: '100%', border: 'none' }}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation"
              allow="fullscreen"
            />
          ) : (
            <Empty description="飞书索引文件 /kb/index.json 不存在" style={{ padding: 80 }} />
          )}
        </div>

        {/* 右侧：AI 问答面板 */}
        <QAPanel />
      </div>
    </div>
  );
}

// ============== AI 问答面板 ==============
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: { title: string; file: string }[];
}

function QAPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 新消息后自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, asking]);

  const handleAsk = useCallback(async () => {
    const question = input.trim();
    if (!question || asking) return;
    setInput('');
    setAsking(true);

    // 立即显示用户消息
    const userMsg: ChatMessage = { role: 'user', content: question };
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s 超时

      const res = await fetch('/api/kb/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: history, question }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        message.error(data.message || '登录状态已失效，请重新登录');
        return;
      }

      if (res.ok && data.success) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.answer,
          sources: data.sources,
        }]);
      } else {
        message.error(data.message || `AI 问答失败（HTTP ${res.status}）`);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        message.warning('AI 回答超时，请稍后重试');
      } else {
        message.error('问答请求失败，请确认后端服务正常');
      }
    } finally {
      setAsking(false);
    }
  }, [input, asking, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter 发送，Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  return (
    <div style={{
      width: 420,
      borderLeft: '1px solid rgba(255,255,255,0.08)',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(0,0,0,0.15)',
    }}>
      {/* 问答区标题 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <RobotOutlined style={{ color: '#52c41a', fontSize: 16 }} />
        <span style={{ color: 'rgba(255,255,255,0.95)', fontSize: 14, fontWeight: 600 }}>
          AI 测试专家
        </span>
        {messages.length > 0 && (
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            onClick={() => setMessages([])}
            style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.45)' }}
          >
            新对话
          </Button>
        )}
      </div>

      {/* 对话列表 */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {messages.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', textAlign: 'center',
            color: 'rgba(255,255,255,0.4)', fontSize: 13, padding: 20,
          }}>
            <RobotOutlined style={{ fontSize: 40, marginBottom: 16, color: 'rgba(82,196,26,0.5)' }} />
            <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
              数据中心测试专家
            </div>
            <div style={{ lineHeight: 1.8 }}>
              我是 AI 测试专家，可以问答：<br/>
              设备参数、排障方法、国标验收、<br/>
              PUE 分析、测试项目管理等问题
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))
        )}
        {asking && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
            <div style={{
              background: 'rgba(255,255,255,0.06)',
              borderRadius: '12px 12px 12px 2px',
              padding: '10px 14px',
              maxWidth: '85%',
            }}>
              <Spin size="small" />
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginLeft: 8 }}>
                正在思考...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，Enter 发送，Shift+Enter 换行"
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              color: 'rgba(255,255,255,0.9)',
              resize: 'none',
              flex: 1,
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleAsk}
            loading={asking}
            disabled={!input.trim()}
            style={{ borderRadius: 8, height: 38 }}
          />
        </div>
      </div>
    </div>
  );
}

// ============== 消息气泡 ==============
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 16,
    }}>
      {/* 头像+角色标识 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 4, flexDirection: isUser ? 'row-reverse' : 'row',
      }}>
        {isUser ? (
          <UserOutlined style={{ color: '#4d9fff', fontSize: 13 }} />
        ) : (
          <RobotOutlined style={{ color: '#52c41a', fontSize: 13 }} />
        )}
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
          {isUser ? '我' : 'AI 专家'}
        </span>
      </div>
      {/* 气泡内容 */}
      <div
        style={{
          background: isUser ? '#4d9fff' : 'rgba(255,255,255,0.06)',
          color: isUser ? '#fff' : 'rgba(255,255,255,0.9)',
          borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          padding: '10px 14px',
          maxWidth: '90%',
          fontSize: 13,
          lineHeight: 1.7,
          wordBreak: 'break-word',
        }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
      />
      {/* AI 回答的知识来源标注 */}
      {!isUser && msg.sources && msg.sources.length > 0 && (
        <div style={{
          marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.35)',
          display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: '90%',
        }}>
          <span>📎 来源：</span>
          {msg.sources.map((s, i) => (
            <span key={i} style={{
              background: 'rgba(77,159,255,0.1)',
              border: '1px solid rgba(77,159,255,0.2)',
              borderRadius: 3, padding: '1px 6px', color: '#7cb8ff',
            }}>
              {s.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
