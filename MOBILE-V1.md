# MOBILE-V1 移动端适配规范（给改造 agent 的约定）

目标：平台在 ≤767px 手机上可用、不凌乱；**桌面端（≥768px）渲染结果字节级不变**。

## 可用的基建（已建好，直接用）

- `import { useIsMobile } from '../../hooks/useIsMobile'`（按相对路径调整层级）
  - `const isMobile = useIsMobile();` → ≤767px 为 true
- App.css 已有全局移动块（≤767px）：所有 antd Table 自动横向滚动、Tabs 可滑动、分页换行、Modal 收紧。**表格挤碎问题全局规则已覆盖，你不需要给每个 Table 加 scroll.x**。

## 铁律（违反即返工）

1. **桌面零回归**：一切条件必须写成三元式 `isMobile ? <移动值> : <原值>`，`:` 后的分支必须与现有代码完全一致（原值照抄，包括单位）。
2. **禁止**：改 API 调用、改路由、改 state/props 逻辑、改事件处理、改数据结构、加依赖、动 server/。
3. **禁止编辑 App.css**（主会话独占，避免冲突）。页面内样式用内联三元式。
4. 布尔 props 允许条件化：`column={isMobile ? 1 : 3}`、`direction={isMobile ? 'vertical' : 'horizontal'}`。
5. 保持星云紫配色体系（#6366f1/#818cf8/#a855f7、浅紫底 #f6f5fc/#f1f0fe），移动端不得引入暗色底。
6. 每个文件改完跑 tsc（命令见下），报错必须修掉。

## 移动端布局手法（按优先级）

1. **多栏 flex 行** → `flexDirection: isMobile ? 'column' : 'row'`，子项宽度 `isMobile ? '100%' : 原值`
2. **并排卡片/工具栏** → `flexWrap: isMobile ? 'wrap' : 'nowrap'`，子项 `flex: isMobile ? '1 1 100%' : 原值`
3. **grid 多列** → `gridTemplateColumns: isMobile ? '1fr' : 原值`（或两列 `repeat(2, 1fr)` 若卡片很小）
4. **antd Row/Col** → 给 Col 补响应式 props：`xs={24}`（满宽），保留原有 span 作桌面默认。例：`<Col span={12} xs={24}>`。若原 Col 无 span（默认24）则不动。
5. **antd Descriptions** → `column={isMobile ? 1 : 原值}`（无 column prop 的加 `column={isMobile ? 1 : 3}` 需查桌面默认为 3）
6. **固定像素宽度** → `width: isMobile ? '100%' : 原值`；`minWidth` 在移动端通常去掉
7. **左侧固定侧栏 + 右侧内容**（如 AI 页知识库列表）→ 移动端侧栏收成顶部可横滑的条或用折叠按钮
8. **横向时间轴/自定义画布（甘特）** → 外层包 `overflowX: 'auto'` 的 div，内层给 `minWidth: 900`（或内容自然宽），保证可滑动而不是溢出
9. **大号操作按钮组** → 移动端 `flexWrap: 'wrap'`，按钮 `flex: '1 1 calc(50% - 4px)'`
10. **只读次要信息**（大段说明、桌面提示语）→ 可 `display: isMobile ? 'none' : 原值` 隐藏，但**禁止隐藏任何数据/操作**

## tsc 命令

```bash
cd /Users/wangjiasheng/WorkBuddy/2026-06-10-14-09-48/ceshi-ziyuanchenben
PATH="/Users/wangjiasheng/.workbuddy/binaries/node/versions/22.12.0/bin:$PATH" ./node_modules/.bin/tsc --noEmit
```

## 完成标准

- 手机宽 375px：无横向溢出（表格/甘特画布除外，它们应可滑动）、无文字截断、按钮可点、操作完整
- 桌面 ≥768px：与现在完全一致
- tsc 通过
