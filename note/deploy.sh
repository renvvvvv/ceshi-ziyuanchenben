#!/usr/bin/env bash
# 数据中心测试验证平台 - 部署到云服务器
#
# 用法：bash note/deploy.sh
# 服务器通过 Docker 运行（无需安装 Node.js/nginx）
set -euo pipefail

# ======== 配置 ========
REMOTE_USER="alice"
REMOTE_HOST="154.8.213.134"
REMOTE_DIR="/home/alice/test-platform"
MINIMAX_API_KEY="${MINIMAX_API_KEY:-sk-hwFt84tf9GM09rK1ys0XPeacYZG1fYlFIpJ6EGlNcj1wJULf}"

# ======== [0] SSH 检查 ========
echo "==> [0] 检查 SSH 连接"
if ! ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" "echo ok" 2>/dev/null; then
  echo "❌ SSH 连接失败"
  exit 1
fi

# ======== [1] 上传源码 ========
echo "==> [1/3] 上传项目文件"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

ssh "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR}"

# 上传 Docker 构建所需文件（排除 node_modules）
tar --exclude='node_modules' --exclude='dist' --exclude='.git' \
    --exclude='server/node_modules' --exclude='server/dist' --exclude='server/data' \
    -czf - . | ssh "${REMOTE_USER}@${REMOTE_HOST}" "cd ${REMOTE_DIR} && tar -xzf -"

# ======== [2] 远程构建 & 启动 ========
echo "==> [2/3] 远程 Docker 构建并启动"
ssh "${REMOTE_USER}@${REMOTE_HOST}" "bash -s" <<EOS
set -euo pipefail
cd "${REMOTE_DIR}"

# 停止旧容器
docker compose down --remove-orphans 2>/dev/null || true

# 构建镜像
echo "  构建镜像..."
docker compose build --no-cache

# 启动
echo "  启动服务..."
export MINIMAX_API_KEY="${MINIMAX_API_KEY}"
docker compose up -d

sleep 3

# 验证
if curl -s -o /dev/null -w "%{http_code}" http://localhost:80/ | grep -q 200; then
  echo "✅ 部署成功"
  docker compose ps
else
  echo "❌ 服务未正常启动，日志："
  docker compose logs --tail 40
  exit 1
fi
EOS

# ======== [3] 完成 ========
echo ""
echo "✅ 发布完成"
echo "   http://${REMOTE_HOST}"
echo ""
echo "   查看日志: ssh ${REMOTE_USER}@${REMOTE_HOST} \"cd ${REMOTE_DIR} && docker compose logs -f\""
echo "   重新部署: bash note/deploy.sh"
