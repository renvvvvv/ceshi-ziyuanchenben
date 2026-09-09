#!/bin/bash
# ===== 数据中心测试验证平台 - 自动备份脚本 =====
# 备份内容：PostgreSQL 数据库 + data/ JSON 文件 + uploads/ 附件
# 保留策略：每日备份，保留最近 7 天
set -euo pipefail

PROJECT_DIR="/root/test-platform"
BACKUP_DIR="${PROJECT_DIR}/backups"
DATE=$(date +%Y%m%d-%H%M%S)
TODAY_DIR="${BACKUP_DIR}/${DATE}"
PG_CONTAINER="test-platform-postgres-1"
DB_NAME="test_platform"
DB_USER="postgres"
RETAIN_DAYS=7

echo "[$(date "+%Y-%m-%d %H:%M:%S")] 开始备份..."

# 1. 创建备份目录
mkdir -p "${TODAY_DIR}"

# 2. PostgreSQL 数据库 dump（自定义格式，支持选择性恢复）
echo "  → 备份 PostgreSQL 数据库..."
docker exec "${PG_CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" -Fc --no-owner --no-privileges > "${TODAY_DIR}/database.dump" 2>/dev/null
DB_SIZE=$(du -h "${TODAY_DIR}/database.dump" | cut -f1)
echo "    数据库备份完成: ${DB_SIZE}"

# 3. JSON 数据文件（session/用户/学习库）
echo "  → 备份 JSON 数据文件..."
if [ -d "${PROJECT_DIR}/data" ]; then
  cp -r "${PROJECT_DIR}/data" "${TODAY_DIR}/data"
  echo "    JSON 文件备份完成"
fi

# 4. 上传附件（不含 drawing —— 图纸任务体量大且完成后不变，单独长期归档，见 4.6）
echo "  → 备份 uploads 附件（不含图纸任务）..."
if [ -d "${PROJECT_DIR}/uploads" ]; then
  mkdir -p "${TODAY_DIR}/uploads"
  (cd "${PROJECT_DIR}/uploads" && find . -maxdepth 1 ! -name drawing ! -name . -exec cp -r {} "${TODAY_DIR}/uploads/" \;)
  echo "    附件备份完成"
fi

# 4.6 图纸任务长期归档：每任务一个 tar.gz，仅内容有变更时重打包；不参与 7 天轮换
ARCHIVE_DIR="${BACKUP_DIR}/drawing-archive"
if [ -d "${PROJECT_DIR}/uploads/drawing" ]; then
  echo "  → 归档图纸任务（长期保留）..."
  mkdir -p "${ARCHIVE_DIR}"
  for job in "${PROJECT_DIR}/uploads/drawing"/*/; do
    jid=$(basename "${job}")
    [ -f "${job}/JOB" ] || continue
    tgz="${ARCHIVE_DIR}/${jid}.tar.gz"
    if [ ! -f "${tgz}" ] || [ -n "$(find "${job}" -newer "${tgz}" -print -quit 2>/dev/null)" ]; then
      tar czf "${tgz}.tmp" -C "${PROJECT_DIR}/uploads/drawing" "${jid}" && mv -f "${tgz}.tmp" "${tgz}"
    fi
  done
  echo "    图纸归档完成: $(du -sh "${ARCHIVE_DIR}" | cut -f1)（$(ls "${ARCHIVE_DIR}" | wc -l) 个任务）"
fi

# 4.5 图纸路由流水线脚本（dwg转换/挖掘/生成链路）
echo "  → 备份图纸流水线脚本..."
if [ -d "/root/drawing-tools" ]; then
  tar -czf "${TODAY_DIR}/drawing-tools-scripts.tar.gz" -C /root drawing-tools/scripts 2>/dev/null
  echo "    流水线脚本备份完成"
fi

# 5. 写入备份元信息
cat > "${TODAY_DIR}/BACKUP_INFO.txt" << EOF
备份时间: $(date "+%Y-%m-%d %H:%M:%S")
备份内容: PostgreSQL ${DB_NAME} + data/ + uploads/(不含drawing) + drawing-tools脚本
图纸归档: backups/drawing-archive/（每任务一包，长期保留，不随7天轮换删除）
数据库大小: ${DB_SIZE}
备份类型: 全量自动备份
EOF

# 6. 清理超过保留期的旧备份
DELETED=$(find "${BACKUP_DIR}" -maxdepth 1 -type d -name "20*" -mtime +${RETAIN_DAYS} | wc -l)
find "${BACKUP_DIR}" -maxdepth 1 -type d -name "20*" -mtime +${RETAIN_DAYS} -exec rm -rf {} \; 2>/dev/null || true
echo "  → 清理 ${DELETED} 个过期备份（保留 ${RETAIN_DAYS} 天）"

# 6.5 磁盘余量告警（只告警，绝不自动删除任何数据）
AVAIL_GB=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
if [ "${AVAIL_GB}" -lt 5 ]; then
  echo "  ⚠️⚠️ 磁盘剩余 ${AVAIL_GB}G，低于 5G 告警线！请扩容磁盘或清理构建缓存（docker builder prune -af）"
fi

# 7. 统计
TOTAL_SIZE=$(du -sh "${TODAY_DIR}" | cut -f1)
BACKUP_COUNT=$(find "${BACKUP_DIR}" -maxdepth 1 -type d -name "20*" | wc -l)
echo ""
echo "[$(date "+%Y-%m-%d %H:%M:%S")] 备份完成！"
echo "  本次大小: ${TOTAL_SIZE}"
echo "  备份路径: ${TODAY_DIR}"
echo "  总备份份数: ${BACKUP_COUNT}"
