/**
 * 测试公式速查 + 计算器
 * 打开就能查、输入就出结果、自动判合格——现场工程师手机掏出来就能用
 */
import { useState, useMemo, useCallback } from 'react';
import {
  Input, InputNumber, Select, Button, Tag, Empty, message,
  Tabs, Tooltip, Collapse, Badge, Card, Space, Typography,
} from 'antd';
import {
  SearchOutlined, CalculatorOutlined, CopyOutlined, HistoryOutlined,
  CheckCircleFilled, CloseCircleFilled, ThunderboltOutlined, FireOutlined,
  DesktopOutlined, ExperimentOutlined, DashboardOutlined, BookOutlined,
} from '@ant-design/icons';
import { FORMULAS, CATEGORY_LABELS, CATEGORY_ICONS, type FormulaDef, type FormulaCategory } from '../../data/formulas';
import { useIsMobile } from '../../hooks/useIsMobile';

const { Text, Title } = Typography;

// ==================== 计算器卡片 ====================
function FormulaCard({ formula }: { formula: FormulaDef }) {
  const isMobile = useIsMobile();
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    formula.inputs.forEach(inp => {
      init[inp.key] = inp.defaultValue ?? (inp.select ? inp.select[0].value : NaN);
    });
    return init;
  });

  const result = useMemo(() => {
    const hasAll = formula.inputs.every(inp => {
      const v = values[inp.key];
      return v !== undefined && v !== null && !isNaN(v);
    });
    if (!hasAll) return null;
    try {
      const r = formula.compute(values);
      return isNaN(r) || !isFinite(r) ? null : r;
    } catch { return null; }
  }, [values, formula]);

  const pass = useMemo(() => {
    if (!result || !formula.judgment) return null;
    const j = formula.judgment;
    const v = result;
    switch (j.operator) {
      case '<=': return v <= (j.threshold ?? 0);
      case '>=': return v >= (j.threshold ?? 0);
      case '|': return Math.abs(v) <= (j.threshold ?? 0);
      case 'range': return j.range ? v >= j.range[0] && v <= j.range[1] : false;
      case 'abs<=': return Math.abs(v) <= (j.threshold ?? 0);
      default: return null;
    }
  }, [result, formula.judgment]);

  const scale = formula.resultScale ?? 2;
  const displayResult = result !== null ? result.toFixed(scale) : '--';

  const handleCopy = useCallback(() => {
    if (result === null) { message.warning('请先填写所有参数'); return; }
    const judgeText = pass === null ? '' : pass ? `（${formula.judgment?.passText}）` : `（${formula.judgment?.failText}）`;
    const text = `${formula.resultLabel}：${displayResult}${formula.resultUnit} ${judgeText}  [${formula.standard || '参考标准'}]`;
    navigator.clipboard.writeText(text).then(() => message.success('已复制结果'));
  }, [result, pass, formula, displayResult]);

  return (
    <Card
      size="small"
      style={{
        marginBottom: 12,
        border: '1px solid #e9e7f4',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text strong style={{ fontSize: 14 }}>{formula.title}</Text>
          {formula.standard && (
            <Tag style={{ fontSize: 10, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
              {formula.standard}
            </Tag>
          )}
        </div>
      </div>

      {/* 公式 */}
      <div style={{
        background: '#fafafa',
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        padding: '6px 10px',
        marginBottom: 10,
        fontFamily: 'var(--font-primary)',
        fontSize: 12,
        color: '#46436a',
      }}>
        <Text type="secondary" style={{ fontSize: 11, marginRight: 6 }}>公式</Text>
        {formula.formulaText}
      </div>

      {/* 输入区 */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 10 }}>
        {formula.inputs.map((inp) => (
          <div key={inp.key}>
            <div style={{ fontSize: 11, color: '#6b6892', marginBottom: 4 }}>
              {inp.label}{inp.unit && <span style={{ color: '#9d9ab8' }}>（{inp.unit}）</span>}
            </div>
            {inp.select ? (
              <Select
                size="small"
                style={{ width: '100%' }}
                value={values[inp.key]}
                onChange={(v) => setValues(prev => ({ ...prev, [inp.key]: v }))}
                options={inp.select.map(o => ({ value: o.value, label: o.label }))}
              />
            ) : (
              <InputNumber
                size="small"
                style={{ width: '100%' }}
                value={isNaN(values[inp.key]) ? undefined : values[inp.key]}
                onChange={(v) => setValues(prev => ({ ...prev, [inp.key]: v ?? NaN }))}
                placeholder={inp.placeholder || `输入${inp.label}`}
                step={inp.key === 'efficiency' ? 0.05 : inp.key === 'pf' ? 0.01 : 1}
                min={0}
              />
            )}
          </div>
        ))}
      </div>

      {/* 结果区 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: result === null ? '#f6f5fc' : pass === true ? '#f0fdf4' : pass === false ? '#fef2f2' : '#f6f5fc',
        border: `1px solid ${result === null ? '#e9e7f4' : pass === true ? '#86efac' : pass === false ? '#fecaca' : '#e9e7f4'}`,
        borderRadius: 8,
        padding: '8px 12px',
        marginBottom: 8,
      }}>
        <div>
          <div style={{ fontSize: 11, color: '#6b6892' }}>{formula.resultLabel}</div>
          <div style={{
            fontSize: 20,
            fontWeight: 600,
            fontFamily: 'monospace',
            color: result === null ? '#9d9ab8' : pass === true ? '#16a34a' : pass === false ? '#dc2626' : '#46436a',
          }}>
            {displayResult}<span style={{ fontSize: 13, marginLeft: 4 }}>{formula.resultUnit}</span>
          </div>
        </div>
        {pass === true && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <CheckCircleFilled style={{ color: '#16a34a', fontSize: 22 }} />
            <span style={{ color: '#16a34a', fontSize: 12 }}>{formula.judgment?.passText}</span>
          </div>
        )}
        {pass === false && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <CloseCircleFilled style={{ color: '#dc2626', fontSize: 22 }} />
            <span style={{ color: '#dc2626', fontSize: 12 }}>{formula.judgment?.failText}</span>
          </div>
        )}
        {pass === null && result !== null && (
          <Tag style={{ background: '#e9e7f4', color: '#6b6892', border: 'none' }}>计算结果（无判定标准）</Tag>
        )}
        {result === null && (
          <Tag style={{ background: '#f0f0f0', color: '#9d9ab8', border: 'none' }}>请填写参数</Tag>
        )}
      </div>

      {/* 底部操作 + 备注 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button
          size="small"
          icon={<CopyOutlined />}
          onClick={handleCopy}
          style={{ borderRadius: 6, fontSize: 11, borderColor: '#d9d9d9' }}
        >
          复制结果
        </Button>
        {formula.note && (
          <Text type="secondary" style={{ fontSize: 10, maxWidth: '70%', textAlign: 'right' }}>
            💡 {formula.note}
          </Text>
        )}
      </div>
    </Card>
  );
}

// ==================== 主页面 ====================
export default function FormulaRef() {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');

  const filtered = useMemo(() => {
    let list = FORMULAS;
    if (category !== 'all') {
      list = list.filter(f => f.category === category);
    }
    if (search.trim()) {
      const kw = search.toLowerCase();
      list = list.filter(f =>
        f.title.toLowerCase().includes(kw) ||
        f.formulaText.toLowerCase().includes(kw) ||
        (f.standard || '').toLowerCase().includes(kw) ||
        (f.note || '').toLowerCase().includes(kw) ||
        CATEGORY_LABELS[f.category].includes(search)
      );
    }
    return list;
  }, [search, category]);

  const byCategory = useMemo(() => {
    const groups: Record<string, FormulaDef[]> = {};
    filtered.forEach(f => {
      const key = f.category;
      (groups[key] = groups[key] || []).push(f);
    });
    return groups;
  }, [filtered]);

  const tabItems = [
    { key: 'all', label: `全部（${FORMULAS.length}）` },
    ...Object.entries(CATEGORY_LABELS).map(([k, v]) => ({
      key: k,
      label: `${CATEGORY_ICONS[k as FormulaCategory]} ${v}（${FORMULAS.filter(f => f.category === k).length}）`,
    })),
  ];

  return (
    <div style={{ padding: isMobile ? 12 : 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* 页头 */}
      <div style={{ marginBottom: 16, textAlign: 'center' }}>
        <Title level={4} style={{ marginBottom: 4 }}>
          <CalculatorOutlined style={{ color: '#6366f1', marginRight: 8 }} />
          测试公式速查
        </Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          输入实测值自动计算并判定是否合格
        </Text>
      </div>

      {/* 搜索 + 分类 */}
      <div style={{ marginBottom: 16 }}>
        <Input
          placeholder="🔍 搜索公式、标准号、关键词..."
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          size="large"
          style={{ marginBottom: 12, borderRadius: 8 }}
        />
        <Tabs
          activeKey={category}
          onChange={setCategory}
          items={tabItems}
          size="small"
        />
      </div>

      {/* 公式卡片 */}
      {filtered.length === 0 ? (
        <Empty description="未找到相关公式" style={{ padding: 60 }} />
      ) : (
        Object.entries(byCategory).map(([cat, formulas]) => (
          <div key={cat} style={{ marginBottom: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 10, paddingBottom: 6,
              borderBottom: '2px solid rgba(99,102,241,0.15)',
            }}>
              <span style={{ fontSize: 18 }}>{CATEGORY_ICONS[cat as FormulaCategory]}</span>
              <Text strong style={{ fontSize: 14, color: '#4f46e5' }}>
                {CATEGORY_LABELS[cat as FormulaCategory]}
              </Text>
              <Tag style={{ background: '#eef0fe', color: '#6366f1', border: 'none', fontSize: 10 }}>
                {formulas.length} 个公式
              </Tag>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
              gap: 12,
            }}>
              {formulas.map(f => <FormulaCard key={f.id} formula={f} />)}
            </div>
          </div>
        ))
      )}

      {/* 底部说明 */}
      <div style={{
        marginTop: 24, padding: '12px 16px',
        background: '#f8f7fd', borderRadius: 8,
        border: '1px solid #e9e7f4',
        fontSize: 11, color: '#6b6892',
        textAlign: 'center',
      }}>
        📖 公式来源：GB/T 7260 / GB/T 2820 / GB/T 12325 / GB/T 15543 / GB/T 14549 / GB 19577 / GB 50974 / GB 51251 等<br/>
        如需新增公式或修正标准值，请联系平台管理员
      </div>
    </div>
  );
}
