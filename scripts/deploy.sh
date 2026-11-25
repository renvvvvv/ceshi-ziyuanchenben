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
#   SSH_PORT      — SSH 端口（默认 22）
#   REMOTE_DIR    — 服务器项目路径（默认 /root/test-platform）
#   DB_PASSWORD   — 数据库密码（默认随机生成）
#   ZHIPU_API_KEY — 智谱 API Key（可选）
#
# 顺序：打包 → 上传 → 解压 → 构建镜像 → 切换容器 → 健康检查。
# 构建失败时停在这一步，旧容器继续提供服务（不做任何切换）；健康检查失败时以非零码退出。
set -euo pipefail

# ======== 配置（可通过环境变量覆盖）========
REMOTE_USER="${REMOTE_USER:-root}"
if [ -z "${REMOTE_HOST:-}" ]; then
  echo "❌ REMOTE_HOST 未设置。请通过环境变量指定服务器 IP："
  echo "   REMOTE_HOST=1.2.3.4 bash scripts/deploy.sh"
  exit 1
fi
SSH_PORT="${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/root/test-platform}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 12 2>/dev/null || echo 'ChangeMe2024')}"
ZHIPU_API_KEY="${ZHIPU_API_KEY:-}"
SSH_TARGET="${REMOTE_USER}@${REMOTE_HOST}"
# 不走交互式口令提示：免密没配好时直接报错，而不是卡在后台等输入
SSH_OPTS=(-p "${SSH_PORT}" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

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

if ! command -v docker &>/dev/null && ! ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "command -v docker" &>/dev/null; then
  echo "❌ 本地和远程都没有 docker，请先安装 Docker"; exit 1
fi

if ! ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "echo ok" &>/dev/null; then
  echo "❌ SSH 连接失败：${SSH_TARGET}（端口 ${SSH_PORT}，需要免密登录）"
  echo "   请确认免密登录已配置：ssh-copy-id -p ${SSH_PORT} ${SSH_TARGET}"
  exit 1
fi
ok "SSH 连接正常"

# ======== [1] 本地打包源码 ========
log "打包项目文件（排除依赖、构建产物、密钥文件与本地数据）"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BASE_NAME="$(basename "$ROOT_DIR")"

TARBALL="/tmp/deploy-platform-${USER}-$$.tar.gz"
TARBALL_BASE="$(basename "$TARBALL")"
# 从上级目录打包，排除规则一律带上项目目录名做前缀。tar 的 --exclude 默认不锚定在路径开头，
# 直接写 --exclude=data 会把前端的 src/data 源码目录也排除掉（macOS 的 bsdtar 与服务器的 GNU tar 上均实测）。
# 必须排除的几类：
#   密钥      .env*（含 .env.e2e、.env.bak-*）、server/.env*
#   本地数据  data/（账号库、会话——不排除的话会用开发机的版本覆盖线上账号）、server/data/、uploads/
#   其余      依赖、构建产物、备份、测试产物、日志
# 改动这里的规则后，务必在两种 tar 上各验证一次包内容。
tar --exclude="$BASE_NAME/node_modules" --exclude="$BASE_NAME/dist" --exclude="$BASE_NAME/.git" \
    --exclude="$BASE_NAME/backups" --exclude='._*' --exclude='.DS_Store' \
    --exclude="$BASE_NAME/server/node_modules" --exclude="$BASE_NAME/server/dist" \
    --exclude="$BASE_NAME/server/data" --exclude="$BASE_NAME/server/.env*" --exclude="$BASE_NAME/.env*" \
    --exclude='__pycache__' --exclude='*.log' \
    --exclude="$BASE_NAME/.claude" --exclude="$BASE_NAME/.workbuddy" \
    --exclude="$BASE_NAME/data" --exclude="$BASE_NAME/uploads" \
    --exclude="$BASE_NAME/test-results" --exclude="$BASE_NAME/e2e-report" --exclude="$BASE_NAME/playwright-report" \
    -czf "$TARBALL" -C "$(dirname "$ROOT_DIR")" "$BASE_NAME"
ok "打包完成 ($(du -h "$TARBALL" | cut -f1))"

# ======== [2] 上传到服务器 ========
log "上传到 ${SSH_TARGET}:${REMOTE_DIR}"
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "mkdir -p ${REMOTE_DIR}"
scp -q -P "${SSH_PORT}" "$TARBALL" "${SSH_TARGET}:/tmp/${TARBALL_BASE}"
rm -f "$TARBALL"
ok "上传完成"

# ======== [3] 远程部署 ========
log "远程构建并切换 Docker 服务"
# 变量经 stdin 送过去（和脚本一起），不出现在服务器的进程列表里；脚本体用带引号的 heredoc，内部不需要转义
if ! {
  printf 'REMOTE_DIR=%q\nTARBALL_BASE=%q\nDB_PASSWORD=%q\nZHIPU_API_KEY=%q\n' \
    "$REMOTE_DIR" "$TARBALL_BASE" "$DB_PASSWORD" "$ZHIPU_API_KEY"
  cat <<'EOS'
set -euo pipefail
cd "${REMOTE_DIR}"

# 解压新代码（去掉包里的首层项目目录）。运行中的容器用的是镜像里的代码，这一步不影响它们
tar xzf "/tmp/${TARBALL_BASE}" --strip-components=1
rm -f "/tmp/${TARBALL_BASE}"

# .env 保护：绝不覆盖服务器现有配置（历史事故：覆盖式写入曾抹掉 ZHIPU/FEISHU 等
# 9 个变量并随机重置 DB_PASSWORD 导致后端起不来）。仅当 .env 不存在时生成初始文件；
# 已存在时只提示，不做任何修改。
if [ ! -f .env ]; then
  cat > .env <<ENV
DB_PASSWORD=${DB_PASSWORD}
ZHIPU_API_KEY=${ZHIPU_API_KEY}
ENV
  echo "  已生成初始 .env"
else
  echo "  ⚠️ 检测到已有 .env，跳过写入（如需变更请手动编辑服务器 .env）"
fi

# 先构建、后切换。构建失败（编译错误、网络问题、拉不到基础镜像）就停在这里：
# 旧容器还在正常提供服务，没有任何切换。此前是先 down 再 build，构建一失败线上就一直不可用。
# 首次部署或 Dockerfile 变更时想强制重建，可先手动执行：docker compose build --no-cache
echo "  构建镜像..."
if ! docker compose build 2>&1 | tail -30; then
  echo "❌ 镜像构建失败：线上仍是旧版本，未做任何切换（原因见上方输出末尾）"
  exit 1
fi

echo "  切换到新版本..."
# up -d 只重建镜像有变化的服务；数据库容器不受影响，不再整体 down
docker compose up -d --remove-orphans

# 健康检查：后端启动要先连库、建表，给它最多 60 秒
echo "  等待服务启动..."
FAILED=0
check_url() {
  local url="$1" name="$2" service="$3" code=000 i
  for i in $(seq 1 12); do
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    [ "$code" = "200" ] && break
    sleep 5
  done
  if [ "$code" = "200" ]; then
    echo "✅ ${name}正常 (HTTP 200)"
  else
    echo "❌ ${name}异常 (HTTP ${code})，最近日志："
    docker compose logs --tail 30 "$service" || true
    FAILED=1
  fi
}
# /api/health 会顺带探测数据库：库连不上时返回 503
check_url "http://localhost:3001/api/health" "后端服务" backend
check_url "http://localhost:80/" "前端页面" frontend

echo ""
echo "--- 容器状态 ---"
docker compose ps
if [ "$FAILED" -ne 0 ]; then
  echo "❌ 部署未通过健康检查，请根据上方日志处理；需要回退时重新部署上一版代码即可"
  exit 1
fi
EOS
} | ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "bash -s"; then
  echo ""
  echo "❌ 部署未完成，见上方输出。"
  exit 1
fi

# ======== [4] 完成 ========
echo ""
ok "部署完成！"
echo ""
echo "   访问地址：  http://${REMOTE_HOST}"
echo "   项目路径：  ${REMOTE_DIR}"
echo "   数据库密码：已写入服务器 .env（不在此显示，可 ssh 查看）"
echo ""
echo "   查看日志：  ssh -p ${SSH_PORT} ${SSH_TARGET} \"cd ${REMOTE_DIR} && docker compose logs -f\""
echo "   重启服务：  ssh -p ${SSH_PORT} ${SSH_TARGET} \"cd ${REMOTE_DIR} && docker compose restart\""
echo "   重新部署：  bash scripts/deploy.sh"
