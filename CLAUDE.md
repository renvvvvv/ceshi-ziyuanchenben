# 数据中心测试验证平台 (Data Center Test Verification Platform)


称呼用户为：归儿
## 项目概述

面向数据中心测试交付的 Web 平台，核心功能是根据输入参数（兆瓦数、工期、机柜功率、变压器配置等）自动计算 IT/动力/暖通/弱电/消防/柴发各专业的人力资源需求、负载配置和测试排期。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + Ant Design 5 + ECharts |
| 后端 | Node.js + Express + TypeScript + sql.js (SQLite) |
| 计算引擎 | Python 3 (`resource_plan.py` V200) |
| 报表 | Python + openpyxl (`generate_excel.py`) |
| 部署 | Docker Compose (backend + nginx frontend) |

## 项目结构

```
/
├── src/                          # React 前端源码
│   ├── App.tsx                   # 路由定义 (7个页面)
│   ├── pages/
│   │   ├── Dashboard/            # 仪表盘
│   │   ├── Projects/             # 项目列表
│   │   ├── ProjectDetail/        # 项目详情
│   │   ├── History/              # 历史记录
│   │   ├── TeamPool/             # 团队资源池
│   │   ├── TestGuide/            # 测试指导
│   │   └── ResourceCalculator/   # 资源计算器（核心页面）
│   ├── components/               # 通用组件
│   ├── api/                      # API 调用封装
│   └── utils/                    # 前端工具函数（Excel导入导出等）
├── server/
│   ├── src/
│   │   ├── index.ts              # Express 入口 (端口3001)
│   │   ├── database.ts           # sql.js 数据库封装（模拟 better-sqlite3 API）
│   │   └── routes/
│   │       ├── resourceCalc.ts   # /api/resource-calc 资源计算 + 历史CRUD
│   │       └── projects.ts       # /api/projects 项目管理CRUD
│   ├── scripts/
│   │   ├── resource_plan.py      # 核心计算引擎 (V200.2)
│   │   ├── generate_excel.py     # Excel报告生成 (V200)
│   │   ├── gen_liquid_excel.py   # 液冷项目Excel输出
│   │   ├── gen_deviation_report.py # 偏差报告生成
│   │   ├── image_recognize.py    # AI图像识别参数提取
│   │   └── imgproc/              # 图像识别后端模块
│   ├── config_v7.json            # 旧版计算参数配置
│   └── config_v100.json          # V200计算参数配置
├── data/                         # SQLite 数据目录 (platform.db)
├── note/                         # 初始化SQL、部署脚本
├── Dockerfile.backend            # 后端镜像 (Node 20 + Python 3)
├── Dockerfile.frontend           # 前端镜像 (Nginx SPA)
├── docker-compose.yml            # 双服务编排
└── nginx.conf                    # Nginx 配置（API代理 + SPA fallback）
```

## 开发命令

```bash
# 前端开发（端口3000，API代理到3001）
npm run dev

# 前端构建
npm run build

# 后端开发
cd server && npx tsx src/index.ts

# Python 计算脚本（独立运行）
python3 server/scripts/resource_plan.py --input input.json --output result.json
python3 server/scripts/generate_excel.py result.json 模板.xlsx output.xlsx

# AI图像识别提取参数
python3 server/scripts/image_recognize.py photo.jpg --backend claude --output params.json

# 偏差报告生成
python3 server/scripts/gen_deviation_report.py

# Docker 部署
docker compose up -d
```

## 核心计算流程

1. 用户在前端 `ResourceCalculator` 页面填写参数（MW、工期、变压器、机柜功率段等）
2. POST `/api/resource-calc` → Express 将 JSON 写入临时文件
3. `execFile` 调用 `python3 resource_plan.py --input <tmpfile>` (V200.2)
4. Python 返回 JSON 结果（含多版本对比：标准/紧凑/压缩；含工器具清单）
5. Express 解析结果存入 SQLite `resource_calc_history` 表
6. 前端展示计算结果 + 支持 Excel 导出

## Python 计算引擎关键点

- `resource_plan.py` V200.2：核心入口 `make_input()` → `calculate()`
- **项目类型自动识别**：`detect_project_type()` 根据空调+机柜类型自动识别风冷/水冷/液冷/风液混合/阿里巴拿马3.0
- **类型配置**：`get_type_config()` 按项目类型调整 staff/parallel/hvac/gen/fixed 参数
- 并行数范围 2~7（增项项目可低至1），公式 `ceil(台数 × 单台天数 / 工期)`
- IEEE 754 浮点精度修正：使用 `- 1e-12` 微调消除 ceil 误差
- 电气人员按类型配置：风冷 IT=5人/台、水冷 IT=5人/台、液冷 IT=4人/台、阿里巴拿马3.0 IT=2人/台
- 默认配置：IT=6人/台、动力=4人/台、混合=5人/台
- **弱电V200修正**：按组数配置（一组电气/暖通配一个弱电记录员），非人头/4
- 暖通记录员按组数 1:1
- 支持多功率段输入（`cabinet_power_segments`）和 `tight_schedule` 紧凑排期
- `calc_loads` 覆盖率动态计算：混合项目默认0.85覆盖，风冷项目按柜数/组数动态推算
- 工器具按IT并行组数动态计算（`calc_tools`），支持项目类型调整系数
- **多版本计算**：`calculate_scenarios()` 默认输出标准/紧凑/压缩三版本对比
- 新增 `image_recognize.py`：AI视觉识别从设备照片提取参数，支持 Claude/Qwen 双后端

## 数据库

- 使用 sql.js（纯 JS 实现的 SQLite），数据库文件 `data/platform.db`
- `dbWrapper` 提供类 better-sqlite3 API（`prepare().run/get/all`），每次写操作后自动 `save()` 持久化
- 初始化时执行 `note/init.sql` 建表
- 编译后路径：`dist/src/` 运行，故 `DATA_DIR = join(__dirname, '..', '..', 'data')`

## 注意事项

- 后端在 Docker 中需要 Python 3 环境来执行 `resource_plan.py` 和 `generate_excel.py`
- 前端开发时 Vite 代理 `/api` 到 `localhost:3001`
- `config_v7.json` / `config_v100.json` 为计算参数配置，Python 脚本优先查找同目录下的配置文件
- 中国区部署使用国内镜像源（Debian mirrors.ustc.edu.cn）

## 生产环境部署

| 项目 | 值 |
|---|---|
| 服务器 | `154.8.213.134` |
| SSH | `ssh root@154.8.213.134`（免密登录） |
| 项目路径 | `/root/test-platform/` |
| 端口 | 80 (前端), 3001 (后端, 仅内网) |
| 部署方式 | Docker Compose (`test-platform` 项目名) |

### 部署更新命令

```bash
# 1. 本地打包（排除 node_modules、.git、data 等）
tar --exclude='node_modules' --exclude='.git' --exclude='./data' \
    --exclude='__pycache__' --exclude='server/node_modules' --exclude='server/dist' \
    -czf /tmp/deploy-platform.tar.gz .

# 2. 上传到服务器
scp /tmp/deploy-platform.tar.gz root@154.8.213.134:/root/

# 3. 在服务器上执行部署
ssh root@154.8.213.134
cd /root/test-platform
docker compose down                          # 停止旧容器
find . -maxdepth 1 -not -name '.' -not -name 'data' -exec rm -rf {} +  # 清理旧文件
tar xzf /root/deploy-platform.tar.gz         # 解压新文件
docker compose up -d --build                 # 构建并启动
docker compose logs -f backend               # 查看日志
```

### 服务器上的其他服务（不可影响）

| 服务 | 位置 | 端口 | 说明 |
|---|---|---|---|
| QQ Bot | `/opt/qq-bot/` | - | Java 机器人 |
| QQ | `/opt/QQ/` | - | QQ Linux 客户端 |
| Napcat | `/root/Napcat/` | - | QQ 机器人框架 |
| Platform (备用) | `/root/platform/` | 80/3001 | 旧版项目镜像（未运行） |

- SQLite 数据库通过 Docker named volume `sqlite_data` 持久化，`docker compose down` 不删除
- 旧项目备份位于 `/root/test-platform-backup/`
- 防火墙只开放 80 端口公网访问，3001 仅内网可达（前端通过 Nginx 代理 `/api/`）
