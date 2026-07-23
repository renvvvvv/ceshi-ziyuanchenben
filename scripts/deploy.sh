#!/usr/bin/env bash
# ============================================
# 数据中心测试验证平台 - 一键部署脚本
# ============================================
# 用法：
#   bash scripts/deploy.sh                    # 使用默认配置
#   REMOTE_USER=root REMOTE_HOST=1.2.3.4 bash scripts/deploy.sh  # 自定义
#
# 环境变量（可在运行前 export 覆盖）：
#   REMOTE_USER   — SSH 用户名（默认 root）
#   REMOTE_HOST   — 服务器 IP（必填，无默认）
#   REMOTE_DIR    — 服务器项目路径（默认 /root/test-platform）
#   DB_PASSWORD   — 数据库密码（默认随机生成）
#   MINIMAX_API_KEY — AI API Key（可选）
set -euo pipefail

# ======== 配置（可通过环境变量覆盖）========
REMOTE_USER="${REMOTE_USER:-root}"
if [ -z "${REMOTE_HOST:-}" ]; then
  echo "❌ REMOTE_HOST 未设置。请通过环境变量指定服务器 IP："
  echo "   REMOTE_HOST=1.2.3.4 bash scripts/deploy.sh"
  exit 1
fi
REMOTE_DIR="${REMOTE_DIR:-/root/test-platform}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 12 2>/dev/null || echo 'ChangeMe2024')}"
MINIMAX_API_KEY="${MINIMAX_API_KEY:-}"
SSH_TARGET="${REMOTE_USER}@${REMOTE_HOST}"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
log()  { echo -e "${CYAN}==>${NC} $1"; }
ok()   { echo -e "${GREEN}✅${NC} $1"; }
warn() { echo -e "${YELLOW}⚠️${NC} $1"; }

# ======== [0] 前置检查 ========
log "前置检查"

if ! command -v docker &>/dev/null && ! ssh "$SSH_TARGET" "command -v docker" &>/dev/null; then
  echo "❌ 本地和远程都没有 docker，请先安装 Docker"; exit 1
fi

if ! ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$SSH_TARGET" "echo ok" &>/dev/null; then
  echo "❌ SSH 连接失败：$SSH_TARGET"
  echo "   请确认免密登录已配置：ssh-copy-id $SSH_TARGET"
  exit 1
fi
ok "SSH 连接正常"

# ======== [1] 本地打包源码 ========
log "打包项目文件（排除 node_modules / .git / dist）"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

TARBALL="/tmp/deploy-platform-${USER}-$$.tar.gz"
TARBALL_BASE="$(basename "$TARBALL")"
tar --exclude='node_modules' --exclude='dist' --exclude='.git' \
    --exclude='server/node_modules' --exclude='server/dist' \
    --exclude='server/data' --exclude='server/.env' \
    --exclude='.env' --exclude='__pycache__' \
    --exclude='.DS_Store' --exclude='*.log' \
    --exclude='.claude' --exclude='.workbuddy' \
    -czf "$TARBALL" .
ok "打包完成 ($(du -h "$TARBALL" | cut -f1))"

# ======== [2] 上传到服务器 ========
log "上传到 ${SSH_TARGET}:${REMOTE_DIR}"
ssh "$SSH_TARGET" "mkdir -p ${REMOTE_DIR}"
scp -q "$TARBALL" "${SSH_TARGET}:/tmp/${TARBALL_BASE}"
rm -f "$TARBALL"
ok "上传完成"

# ======== [3] 远程部署 ========
log "远程构建并启动 Docker 服务"
ssh "$SSH_TARGET" "bash -s" <<EOS
set -euo pipefail
cd "${REMOTE_DIR}"

# 停止旧容器（保留数据卷）
docker compose down --remove-orphans 2>/dev/null || true

# 解压新代码（保留 pg_data 卷）
tar xzf "/tmp/${TARBALL_BASE}"
rm -f "/tmp/${TARBALL_BASE}"

# 写入 .env
cat > .env <<ENV
DB_PASSWORD=${DB_PASSWORD}
MINIMAX_API_KEY=${MINIMAX_API_KEY}
ENV

# 构建并启动
echo "  构建镜像..."
# 首次部署或 Dockerfile 变更时改用：docker compose build --no-cache
docker compose build 2>&1 | tail -5

echo "  启动服务..."
docker compose up -d

# 等待健康检查
echo "  等待服务启动..."
sleep 8

# 验证
HTTP_CODE=\$(curl -s -o /dev/null -w "%{http_code}" http://localhost:80/ 2>/dev/null || echo "000")
if [ "\$HTTP_CODE" = "200" ]; then
  echo "✅ 前端服务正常 (HTTP 200)"
else
  echo "❌ 前端异常 (HTTP \$HTTP_CODE)，查看日志："
  docker compose logs --tail 30 frontend
fi

# 验证后端
API_CODE=\$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health 2>/dev/null || echo "000")
if [ "\$API_CODE" = "200" ]; then
  echo "✅ 后端服务正常 (HTTP 200)"
else
  echo "❌ 后端异常 (HTTP \$API_CODE)，查看日志："
  docker compose logs --tail 30 backend
fi

echo ""
echo "--- 容器状态 ---"
docker compose ps
EOS

# ======== [4] 完成 ========
echo ""
ok "部署完成！"
echo ""
echo "   访问地址：  http://${REMOTE_HOST}"
echo "   项目路径：  ${REMOTE_DIR}"
echo "   数据库密码：已写入服务器 .env（不在此显示，可 ssh 查看）"
echo ""
echo "   查看日志：  ssh ${SSH_TARGET} \"cd ${REMOTE_DIR} && docker compose logs -f\""
echo "   重启服务：  ssh ${SSH_TARGET} \"cd ${REMOTE_DIR} && docker compose restart\""
echo "   重新部署：  bash scripts/deploy.sh"
