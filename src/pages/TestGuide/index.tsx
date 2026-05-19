import { useState, useMemo } from 'react';
import { Input, Tag, Typography, Empty } from 'antd';
import { SearchOutlined, FileTextOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { mockTestDocs, docCategories } from '../../data/mock';

const { Paragraph } = Typography;

function TestGuide() {
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [searchText, setSearchText] = useState('');

  const filteredDocs = useMemo(() => {
    return mockTestDocs.filter((doc) => {
      if (selectedCategory !== '全部' && doc.category !== selectedCategory) return false;
      if (searchText) {
        const kw = searchText.toLowerCase();
        if (!doc.title.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [selectedCategory, searchText]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h3>测试管理制度</h3>
          <p style={{ color: '#666', marginTop: 4 }}>
            实现测试流程标准化、测试规范数字化、质量管理体系化
          </p>
        </div>
      </div>

      <div style={{ marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {docCategories.map((cat) => (
            <Tag.CheckableTag
              key={cat}
              checked={selectedCategory === cat}
              onChange={() => setSelectedCategory(cat)}
              style={{
                padding: '4px 16px',
                border: '1px solid #d9d9d9',
                borderRadius: 20,
                fontSize: 14,
              }}
            >
              {cat}
            </Tag.CheckableTag>
          ))}
        </div>
        <Input
          placeholder="搜索制度文档"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 220 }}
          allowClear
        />
      </div>

      {filteredDocs.length === 0 ? (
        <Empty description="暂无匹配的制度文档" />
      ) : (
        <div>
          {filteredDocs.map((doc) => (
            <div key={doc.id} className="doc-list-item">
              <div className="doc-info">
                <FileTextOutlined style={{ fontSize: 20, color: '#1677ff' }} />
                <div>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>{doc.title}</div>
                  <div style={{ fontSize: 12, color: '#999', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Tag color="blue">{doc.category}</Tag>
                    <span>
                      <ClockCircleOutlined style={{ marginRight: 4 }} />
                      最后更新：{doc.lastUpdated}
                    </span>
                  </div>
                </div>
              </div>
              <Paragraph
                style={{ margin: 0, color: '#666', fontSize: 13, maxWidth: 400 }}
                ellipsis={{ rows: 1 }}
              >
                {doc.content}
              </Paragraph>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TestGuide;
