# 智航万恒 · 数据中心测试验证管理平台 — 项目总结

> 生成时间：2026-07-19  ·  版本：v1.0.0  ·  仓库：renvvvvv/ceshi-ziyuanchenben

---

## 一、项目定位

**面向数据中心机电测试交付的一体化 Web 平台**，整合项目进度管理、团队资源池调度、资源测算、测试报告 AI 审核与知识库四大模块，支撑从项目立项、人员排期、现场测试到文档交付的全流程数字化。

平台服务客户涵盖腾讯、阿里、字节、华为、百度、京东、小米、幻方等头部互联网企业，覆盖太仓 17 号楼 12MW、阿里数据中心 5.0、中国电信宁夏中卫三期、乌兰大三期 A3 等机电施工图项目。

---

## 二、技术栈

| 层 | 技术选型 |
|---|---|
| **前端** | React 18 + TypeScript 5 + Vite 5 + Ant Design 5 + ECharts |
| **后端** | Node.js + Express + TypeScript（ESM 模块）+ PostgreSQL 16（pg 驱动） |
| **AI 引擎** | MiniMax `abab6.5g-chat`（错别字检测 + 长文档分块并行） |
| **部署** | Docker Compose（postgres + backend + frontend/nginx 三容器） |
| **存储** | 持久化卷 `pg_data`（数据库）、`./data`（学习纠错库 / sessions.json） |
| **认证** | Session token（内存 Map + `sessions.json` 持久化）+ httpOnly Cookie |

---

## 三、模块清单

### 前端页面（13 个，懒加载 + 路由守卫）

| 模块 | 路径 | 说明 |
|---|---|---|
| 仪表盘 | `/dashboard` | KPI 卡片 + 地区兆瓦分布 + 7 阶段时间线 + 逾期预警条 |
| 项目管理 | `/projects` `/projects/:id` | 项目列表 + 详情编辑 + 归档操作 |
| 历史项目 | `/history` `/history/:id` | 27 条完整字段历史项目（城市/经理/人力/业务类型） |
| 团队人员池 | `/team-pool` | 跨项目人员调度 + 状态筛选（空闲/测试中/休假） |
| 考勤管理 | `/attendance` | 按月周期校准 + 后端同步持久化 |
| 测试指导 | `/test-guide` | 测试流程文档导航 |
| 资源计算器 | `/resource-calculator` | 兆瓦数→IT/动力/暖通/弱电/消防/柴发人力测算 |
| 报告审核 | `/report-review` | Word/PDF 解析 + AI 错别字检测 + 学习纠错库 |
| 知识库 | `/kb` | 本地 markdown 树形目录 + 飞书 iframe 兜底 |
| 权限配置 | `/permission` | 按角色（管理者/编辑/读者）分配模块可见性 |
| 登录页 | `/login` | 账号密码 + 24h Cookie |

### 后端 API 路由（9 个）

| 路由文件 | 端点 | 权限 |
|---|---|---|
| `auth.ts` | `/api/auth/login` `/logout` `/me` `/users` | 全局 authMiddleware 解析 |
| `projects.ts` | `/api/projects` + `/members` + `/history` | requireAuth + DELETE requireRole(['管理者']) |
| `attendance.ts` | `/api/attendance-adjustments` | requireAuth |
| `kb.ts` | `/api/kb` 树形 CRUD | requireAuth |
| `reportReview.ts` | `/api/report-review` + `/learn` + `/learned` | requireAuth |
| `resourceCalc.ts` | `/api/resource-calc` + `/batch` | requireAuth |
| `terminology.ts` | 数据中心专业术语词典（90+ 条） | 内部模块 |
| `learnedCorrections.ts` | 自我学习纠错库（top-50 注入） | 内部模块 |
| `commonTypos.ts` | 常见错别字规则库 | 内部模块 |

---

## 四、当前版本进度

### Git 历史
- 总提交数：**97 个 commit**
- 本月（2026-07）提交：**55 个**（密集迭代期）
- 最新 commit：`7442114 fix(report-review): 修复会话失效导致的 AI 审核失败`

### 已完成里程碑

| 阶段 | 时间 | 内容 |
|---|---|---|
| Phase 1 | 2026-06-10 ~ 06-15 | 仪表盘 + 团队人员池基础页面 |
| Phase 2 | 2026-06-15 ~ 06-23 | 项目管理 + 历史项目 + 文件上传 |
| Phase 3 | 2026-06-23 ~ 06-30 | 数据库 schema + seed-from-mock 脚本 |
| Phase 4 | 2026-07-01 ~ 07-04 | Docker 多阶段构建 + 首次服务器部署 |
| Phase 5 | 2026-07-04 ~ 07-10 | 资源计算器 4 个 P0 bug 修复 |
| Phase 6 | 2026-07-10 ~ 07-14 | 全栈审计（3 agent 并行审查 23 个问题） |
| Phase 7 | 2026-07-14 ~ 07-17 | 持久化 CRUD 打通 + 显式归档 + 逾期预警 + 学习库治理 |
| Phase 8 | 2026-07-17 ~ 07-18 | 后端权限认证 + 知识库本地化 + 数据治理 |
| Phase 9 | 2026-07-18 ~ 07-19 | 数据一致性 + 安全加固 + AI 审核会话修复 |

### 关键功能状态

- ✅ **全栈 CRUD**：项目、成员、历史项目、考勤、知识库、资源计算全部前后端打通
- ✅ **权限体系**：3 角色（管理者/编辑/读者）+ 模块可见性配置 + 路由守卫
- ✅ **AI 错别字审核**：长文档分块 + 词典兜底 + 自学习纠错库（持久化到 `data/learned-corrections.json`）
- ✅ **仪表盘**：KPI 卡片 + 地区分布图 + 7 阶段甘特 + 逾期预警（严重/普通分级）+ 5 分钟自动刷新
- ✅ **资源计算器**：兆瓦数→变压器选型 + 各专业人力 + Excel 导出
- ✅ **考勤**：月周期反推算法（13 边界用例全通过）+ 后端同步持久化
- ✅ **知识库**：本地树形 + markdown 渲染 + 外部链接 + 飞书 iframe 兜底

---

## 五、部署架构

```
┌──────────────────────────────────────────────────────────┐
│  服务器 49.232.147.149 (Ubuntu 24.04 + Docker 29.6.1)     │
│  部署路径: /root/test-platform/                            │
│                                                            │
│  ┌────────────┐    ┌────────────┐    ┌──────────────┐     │
│  │  frontend  │───▶│  backend   │───▶│   postgres   │     │
│  │ nginx:80   │    │ node:3001  │    │  pg:5432     │     │
│  │ 静态 dist  │    │ Express    │    │  pg_data 卷  │     │
│  └────────────┘    └────┬───────┘    └──────────────┘     │
│                         │                                  │
│                         ▼                                  │
│                   ./data 卷                                  │
│                   (learned-corrections.json                │
│                    sessions.json)                           │
└──────────────────────────────────────────────────────────┘
```

- **公网入口**：http://49.232.147.149/（Nginx 反向代理 /api/ → backend）
- **数据库密码**：`c3e55476fec464721c52895d`
- **默认账号**：admin / admin123（24h Cookie 有效期）
- **端口隔离**：DB 与 backend 仅绑定 127.0.0.1，仅 frontend 暴露 80

---

## 六、AI 错别字审核机制（核心能力）

```
Word/PDF ──▶ mammoth/pdfjs 解析 ──▶ 文本
                                         │
                  ┌──────────────────────┴──────────────────────┐
                  ▼                                               │
        长度 > 3500 字？                                          │
        ├─ 是：按段分块 ──▶ 并行调 MiniMax ──▶ 合并结果           │
        └─ 否：单次调 MiniMax                                     │
                  │                                               │
                  ▼                                               │
        AI 输出 JSON 错字列表                                     │
                  │                                               │
                  ▼                                               │
        ruleBasedDetect 兜底（terminology + learnedCorrections） │
                  │                                               │
                  ▼                                               │
        前端展示错别字卡片                                        │
        ├─ "修改并学习" → POST /learn（写学习库）                 │
        └─ "仅采纳"     → 只更新前端                              │
```

**关键配置**：
- 模型：`abab6.5g-chat`（精度比 `abab6.5s-chat` 大幅提升）
- 专业术语词典：90+ 条（供配电/暖通/弱电/消防/监控运维）
- 学习库：top-50 高频纠错注入 prompt，持久化到 volume 挂载

---

## 七、经验教训（避坑指南）

### 7.1 部署类

1. **rsync `--delete` 会删除服务器 `.env`**：必须加 `--exclude='.env' --exclude='data'`，备份到部署目录外 `/root/.test-platform-env-backups/`
2. **`docker compose restart` 不重读 `.env`**：改 .env 后必须 `docker compose up -d`（不带 restart）
3. **`__dirname` 在容器内错位**：编译后 `__dirname=/app/dist/src/routes`，用 `path.resolve(process.cwd(), 'data')` 替代

### 7.2 代码类

4. **前端 setState 必须对应 API 同步**：只改 localStorage 的"假持久化"是数据丢失的根源
5. **Express GET 路由顺序**：具体路径（`/history/list`）必须在 `/:id` 之前定义
6. **PG init.sql 多语句 sequence 冲突**：INSERT 前先 `SELECT setval(..., 100, false)` 避免与 id=1 撞键
7. **sessions.json 原子写入**：先写 `.tmp` 再 `rename`，防止写一半崩溃
8. **全局 error middleware 必须 4 参数**：否则 Express 不识别，前端拿到 HTML 错误页

### 7.3 安全类

9. **飞书密钥绝不能进 git**：硬编码后即使删除也留在历史，需 `git filter-repo` 清理 + 飞书平台 rotate 密钥
10. **httpOnly Cookie + credentials:'include'**：防 XSS + 跨域自动带 cookie
11. **会话失效的假登录状态**：前端启动必须调 `/api/auth/me` 校验，401 清除本地，加 `authReady` 防路由抢跑

---

## 八、待办事项

### 短期（可选迭代）

- [ ] P1-12 数据治理：孤儿数据清理脚本化（目前已内建自检 useEffect，可进一步独立化）
- [ ] 时区：`init.sql` 全部 `TIMESTAMP` → `TIMESTAMPTZ`
- [ ] CHECK 约束：`team_members.status` 加 `IN ('空闲','测试中','休假')`
- [ ] mock 数据 id 前缀化（避免字符串数字 parseInt 后命中 DB 真实 id）

### 中期（功能扩展）

- [ ] 仪表盘底部项目信息改甘特图展示（区分进行中/未开始/已交付）
- [ ] 仪表盘新增"新项目 vs 历史项目"对比功能
- [ ] 人员池按项目筛选（筛出每个项目的工作人员）
- [ ] 脚本线上化（测试流程脚本上传 → 知识库关联）

### 长期

- [ ] 飞书 Open API 集成（替代 iframe 兜底）
- [ ] 移动端适配（当前仅桌面端）
- [ ] 多租户隔离（支持多个子公司独立管理）

---

## 九、验证路径

### 本地验证
```bash
# 前端类型检查
npx tsc --noEmit

# 前端构建
npm run build

# 后端构建
npm --prefix server run build
```

### 部署后端到端验证
```bash
# 1. 健康检查
curl http://49.232.147.149/api/health   # 期望: {status:'ok'}

# 2. 登录
curl -c /tmp/c.txt -X POST http://49.232.147.149/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'   # 期望: 200 + token

# 3. 鉴权 GET
curl -b /tmp/c.txt http://49.232.147.149/api/projects   # 期望: 200 + 列表

# 4. AI 审核端到端
curl -b /tmp/c.txt -X POST http://49.232.147.149/api/report-review \
  -H "Content-Type: application/json" \
  -d '{"text":"测试数据心中心项目，UPS不间断电源，柴发机组"}'   # 期望: 200 + errors[]

# 5. 学习库持久化
docker compose restart backend
curl -b /tmp/c.txt http://49.232.147.149/api/report-review/learned  # 期望: 保留
```

---

## 十、关键文件索引

| 类别 | 路径 |
|---|---|
| 前端入口 | `src/main.tsx` → `src/App.tsx` |
| 状态管理 | `src/store/AuthContext.tsx` `src/store/DataContext.tsx` |
| API 封装 | `src/api/index.ts` |
| 后端入口 | `server/src/index.ts` |
| 数据库初始化 | `server/src/database.ts` + `server/scripts/init.sql` |
| 认证路由 | `server/src/routes/auth.ts` |
| 项目路由 | `server/src/routes/projects.ts` |
| AI 审核 | `server/src/routes/reportReview.ts` |
| 专业术语 | `server/src/routes/terminology.ts` |
| 学习纠错 | `server/src/routes/learnedCorrections.ts` |
| 部署配置 | `docker-compose.yml` `Dockerfile.backend` `Dockerfile.frontend` `nginx.conf` |
| 环境变量 | `.env`（仅服务器，含 DB_PASSWORD + MINIMAX_API_KEY） |

---

**项目当前状态**：本地与远端 `origin/main` 同步，工作区干净，线上运行正常。
**访问地址**：http://49.232.147.149/
