import { useState, useMemo } from 'react';
import { Input, Tag, Avatar, Skeleton, Empty, Popconfirm, message } from 'antd';
import {
  SearchOutlined,
  UserOutlined,
  EditOutlined,
  DeleteOutlined,
  MailOutlined,
  PhoneOutlined,
} from '@ant-design/icons';
import { mockTeamMembers } from '../../data/mock';
import type { TeamMember, MemberStatus } from '../../types';

const statusConfig: Record<MemberStatus, { color: string; label: string }> = {
  '在线': { color: '#52c41a', label: '在线' },
  '忙碌': { color: '#faad14', label: '忙碌' },
  '离线': { color: '#d9d9d9', label: '离线' },
};

function TeamPool() {
  const [members, setMembers] = useState<TeamMember[]>(mockTeamMembers);
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [searchText, setSearchText] = useState('');
  const [loading] = useState(false);

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (statusFilter !== '全部' && m.status !== statusFilter) return false;
      if (searchText) {
        const kw = searchText.toLowerCase();
        if (!m.name.toLowerCase().includes(kw) && !m.employeeId.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [members, statusFilter, searchText]);

  const handleDelete = (id: string) => {
    setMembers(members.filter((m) => m.id !== id));
    message.success('成员删除成功');
  };

  const statusFilters = ['全部', '在线', '忙碌', '离线'];

  return (
    <div>
      <div className="page-header">
        <h3>测试人员池</h3>
      </div>

      <div style={{ marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {statusFilters.map((s) => (
            <Tag.CheckableTag
              key={s}
              checked={statusFilter === s}
              onChange={() => setStatusFilter(s)}
              style={{
                padding: '4px 16px',
                border: '1px solid #d9d9d9',
                borderRadius: 20,
                fontSize: 14,
              }}
            >
              {s}
            </Tag.CheckableTag>
          ))}
        </div>
        <Input
          placeholder="搜索姓名或工号"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 220 }}
          allowClear
        />
      </div>

      {loading ? (
        <div className="team-grid">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="member-card">
              <Skeleton avatar active paragraph={{ rows: 2 }} />
            </div>
          ))}
        </div>
      ) : filteredMembers.length === 0 ? (
        <Empty description="暂无匹配的团队成员" />
      ) : (
        <div className="team-grid">
          {filteredMembers.map((member) => {
            const statusCfg = statusConfig[member.status];
            return (
              <div key={member.id} className="member-card">
                <div className="card-actions">
                  <EditOutlined
                    style={{ fontSize: 16, color: '#1677ff', cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); message.info('编辑功能'); }}
                  />
                  <Popconfirm
                    title="确认删除"
                    description={`确定要删除成员"${member.name}"吗？`}
                    onConfirm={() => handleDelete(member.id)}
                    okText="确认"
                    cancelText="取消"
                  >
                    <DeleteOutlined
                      style={{ fontSize: 16, color: '#ff4d4f', cursor: 'pointer' }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </div>
                <Avatar size={64} icon={<UserOutlined />} style={{ backgroundColor: '#1677ff', marginBottom: 12 }} />
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: statusCfg.color, fontSize: 10, marginRight: 4 }}>●</span>
                  <span className="member-name">{member.name}</span>
                  <span style={{ color: '#999', fontSize: 12, marginLeft: 4 }}>{member.employeeId}</span>
                </div>
                <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                  {member.email && <><MailOutlined /> {member.email}</>}
                </div>
                <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
                  {member.phone && <><PhoneOutlined /> {member.phone}</>}
                </div>
                <div className="member-projects">
                  当前项目：{member.currentProjects.length > 0 ? member.currentProjects.join('、') : '暂无项目'}
                </div>
                <div className="skill-tags">
                  {member.skills.map((skill) => (
                    <Tag key={skill} color="blue" style={{ margin: 0 }}>
                      {skill}
                    </Tag>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TeamPool;
