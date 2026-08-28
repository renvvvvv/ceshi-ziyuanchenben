# 复刻模块约定（所有 Tab 组件统一遵守）

## 组件接口
```tsx
interface TabProps {
  data: ResourceConfigProject;        // 当前配置全量数据（10 模块）
  assets: AssetLibItem[];             // 自有资源库
  canEdit: boolean;                   // 是否可编辑（管理者/编辑者）
  patch: (updates: Partial<ResourceConfigProject>) => void;  // 局部更新（自动标记脏）
}
```

## 依赖
- 类型与计算函数从 `../../../types/resourceConfig` 导入（calcLabor/calcLoadAllocation/calcInstrumentAllocation/subsidyPostToRole/deriveRole/calcLoadDays）
- antd 组件 + @ant-design/icons，深色主题（平台全局）
- 不引入新依赖

## 统一样式
- 区块卡片容器：
```tsx
<div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
    <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>📋 区块标题</span>
    <Tag style={{ margin: '0 0 0 8px' }}>N 项</Tag>
    <div style={{ flex: 1 }} />
    {canEdit && <Button size="small" icon={<PlusOutlined/>}>添加…</Button>}
  </div>
  …内容
</div>
```
- 表格：antd Table size="small"，列头深蓝底白字已由全局 .rc-edit-table 处理（组件内 Table 加 className="rc-edit-table"）
- 输入控件沉浸式：className="rc-cell-input"（全局 CSS 已定义）
- 统计卡（页头 4-5 卡横排）：
```tsx
<div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: 10, marginBottom: 14 }}>
  <div style={{ background: 'linear-gradient(135deg, rgba(30,58,95,0.45), rgba(30,58,95,0.2))', border: '1px solid rgba(77,159,255,0.18)', borderRadius: 10, padding: '12px 16px' }}>
    <div style={{ fontSize: 22, fontWeight: 700, color: '#7cb8ff' }}>{value}</div>
    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{label}</div>
  </div>
</div>
```

## 原工具源码（唯一真相来源）
`/Users/wangjiasheng/WorkBuddy/incoming-platform/测试资源配置软件/index.html`
复刻时逐行对照对应 renderXxx/bindXxx 函数，功能行为（联动/提示文案/颜色语义）保持一致。

## 数据修改
- 所有修改通过 patch({ 模块key: 新数组 }) 提交；派生值（count/total/days）按原工具公式同步写入
- id 用 `Date.now().toString(36) + Math.random().toString(36).slice(2,8)`
