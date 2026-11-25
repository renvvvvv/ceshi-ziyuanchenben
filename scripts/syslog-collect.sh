#!/bin/bash
# ===== 平台故障日志采集（宿主层，30 分钟 cron）=====
# 采集 docker 容器日志尾部、drawing-runner journal、磁盘/内存状态到
# backups/syslogs/，经只读挂载供后端"故障日志抓取"快照聚合。
# 每个组件文件保留最近 2000 行（轮转截断），磁盘占用恒定 <2MB。
set -uo pipefail
# 目录按本脚本所在项目推导（可用环境变量 PROJECT_DIR 覆盖），不写死 /root/test-platform：
# 换了部署路径还写死的话，日志会写进一个没被挂载的目录，故障快照里就缺宿主日志而且不报错
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
OUT="${PROJECT_DIR}/backups/syslogs"
LOGF="${PROJECT_DIR}/backups/syslog-collect.log"  # 采集自身日志放挂载目录外（防被快照误聚合）
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
# 容器名取决于项目目录名：按 compose 文件查实际容器，查不到时退回默认名
C_BACKEND="$(docker compose -f "${COMPOSE_FILE}" ps -q backend 2>/dev/null | head -n 1)"
C_BACKEND="${C_BACKEND:-test-platform-backend-1}"
C_FRONTEND="$(docker compose -f "${COMPOSE_FILE}" ps -q frontend 2>/dev/null | head -n 1)"
C_FRONTEND="${C_FRONTEND:-test-platform-frontend-1}"
mkdir -p "$OUT"
stamp() { date "+%Y-%m-%d %H:%M:%S"; }

collect() {  # $1=文件名 $2=命令...
  # 追加进主文件再截断（滚动保留最近 2000 行 ≈ 多个采集周期），new+mv 原子替换
  # 防后端快照读取时撞上截断窗口读到空文件
  local f="$OUT/$1"; shift
  { echo "===== $(stamp) ====="; "$@" 2>&1; } >> "$f"
  tail -n 2000 "$f" > "$f.new" && mv -f "$f.new" "$f"
}

collect backend.log  docker logs --since 35m --tail 400 "$C_BACKEND"
collect frontend.log docker logs --since 35m --tail 300 "$C_FRONTEND"
collect runner.log   journalctl -u drawing-runner --since "35 min ago" --no-pager -n 300
{ echo "===== $(stamp) ====="; df -h /; free -m; uptime; } >> "$OUT/host.log"
tail -n 300 "$OUT/host.log" > "$OUT/host.log.new" && mv -f "$OUT/host.log.new" "$OUT/host.log"
