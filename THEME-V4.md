# 星云紫主题（V4）改造规范 —— 所有 agent 必读

平台正从"暗色科技蓝"整体切换为"白底星云紫"。全局 codemod 已完成机械色值替换（1000+ 处），antd ConfigProvider（src/main.tsx）和 App.css 基建已改完。你们负责各自模块的**人工精修**。

## 调色板 tokens（必须遵循）

```ts
// 文字（从深到浅）
'#1e1b2e'  // 主文字（标题、数值）
'#46436a'  // 次强文字
'#6b6892'  // 次要文字（描述）
'#9d9ab8'  // 弱化文字（placeholder、提示）

// 背景
'#fafafd'  // 页面底（微紫白）
'#ffffff'  // 卡片/容器（纯白）
'#f6f5fc'  // 次级填充（卡片内嵌块、输入框底）
'#f1f0fe'  // 强调填充（选中态、lavender）
'#eceafb'  // 更深一档填充

// 边框
'#eeedf8'  // 弱边框
'#e9e7f4'  // 标准边框
'#d9d5f0'  // 强边框

// 品牌色
'#6366f1'  // 主品牌（靛紫）
'#818cf8'  // 品牌浅
'#a855f7'  // 品牌紫
'#ec4899'  // 点缀粉
'linear-gradient(135deg,#6366f1,#a855f7,#ec4899)'  // 三色渐变（logo/大按钮/进度条）
'linear-gradient(135deg,#6366f1,#a855f7)'          // 双色渐变（常规强调）

// 功能色
'#16a34a'  // 成功绿
'#d97706'  // 警告橙
'#dc2626'  // 错误红
'#0d9488'  // 青绿
'#06b6d4'  // 青色

// 阴影（柔紫光）
'0 8px 24px rgba(99,102,241,0.10)'   // 卡片悬浮
'0 4px 12px rgba(99,102,241,0.25)'   // 按钮光晕
```

圆角：卡片 12-14px、按钮/输入 8-10px。

## 你们要修的问题类型（按优先级）

1. **白底白字/对比度错误**：codemod 把半透明白文字换成了深色，但个别地方 `color:'#fff'` 写在**现在已是白/浅底**的容器上（原来底是深色渐变），要逐个判断：底是品牌渐变/深色强调块的保持白字；底是白/浅紫的改成 `#1e1b2e` 或对应深色。
2. **残留暗色**：文件里搜 `rgba(0,`、`rgba(13,`、`rgba(8,`、`#0`、`#1a`、`#0d1f3c`、`#061428`、`#101a33`、`linear-gradient` 中还带深色的——一律按调色板替换。图表（GanttChart 等 canvas/echarts）里的坐标轴文字、网格线、柱色也要浅色化：轴线 `#e9e7f4`、轴文字 `#6b6892`、图例文字 `#46436a`、today 线保持红色系 `#ec4899` 或 `#dc2626`。
3. **渐变翻车**：原来是深蓝渐变背景（如登录页、顶部栏、卡片头），改成 `linear-gradient(135deg,#6366f1,#a855f7)` 或浅紫渐变（文字用白字OK）或纯白+边框，按视觉合理性选。
4. **硬编码旧品牌色**：codemod 已把 #4d9fff→#6366f1 等，但可能有字符串拼接的颜色、rgba(77,159,255,...) 形式的旧品牌色残留——统一换 rgba(99,102,241,...)。
5. **玻璃态残留**：backdrop-filter + 半透明白底在白主题下基本无效果，可保留但确认边框是 #e9e7f4。
6. **状态标签**：antd Tag 的 color prop 用预设色（green/gold/red/purple...）不用动；自定义 style 的按功能色映射，背景用浅色（#f0fdf4/#fff7ed/#fef2f2/#f1f0fe）+ 深色文字。

## 严禁事项

- **不改任何逻辑**：不改 API 调用、props 传递、state、事件处理、路由、数据结构
- 不改组件结构/层级，不动 className 语义（App.css 里 .dark-table 等类名保留，样式已在 CSS 层翻新）
- 不删功能、不加功能
- 只动 color/background/border/shadow/渐变/圆角相关的值

## 验证

改完运行（npx 路径：`/Users/wangjiasheng/.workbuddy/binaries/node/versions/22.12.0/bin/npx`）：
```bash
cd /Users/wangjiasheng/WorkBuddy/2026-06-10-14-09-48/ceshi-ziyuanchenben
PATH="/Users/wangjiasheng/.workbuddy/binaries/node/versions/22.12.0/bin:$PATH" npx tsc --noEmit
```
只关注你自己负责文件的报错（其他 agent 在并行改别的文件）。汇报格式：每个文件改了什么类别的问题、共几处、tsc 是否通过。
