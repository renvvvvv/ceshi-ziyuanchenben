#!/bin/bash
# ===== 备份定期清理（每周日 04:00 由 crontab 触发） =====
# 策略：删除 7 天前的备份数据
#   1) 日期目录 2026xxxx-xxxxxx（每日自动备份）
#   2) 散落的手工备份包 *.tgz / *.tar.gz（backup.sh 的清理管不到这些，此脚本兜底）
# 安全约束：仅在备份目录内、仅一层深度、仅匹配日期目录/备份包模式，其余一概不动
set -uo pipefail

BACKUP_DIR="/root/test-platform/backups"
LOG="${BACKUP_DIR}/cleanup.log"
RETAIN_DAYS=7

echo "[$(date "+%Y-%m-%d %H:%M:%S")] 清理开始（保留 ${RETAIN_DAYS} 天）" >> "$LOG"

# 1) 过期日期目录
find "$BACKUP_DIR" -maxdepth 1 -type d -regextype posix-extended -regex ".*/20[0-9]{6}-[0-9]{6}" -mtime +${RETAIN_DAYS} -print -exec rm -rf {} \; 2>>"$LOG" | sed "s|^|  删除目录: |" >> "$LOG"

# 1.5) 残留的半途归档临时包（tar 失败遗留）
# 临时包产生在 drawing-archive/（深度2），maxdepth 1 扫不到
find "$BACKUP_DIR/drawing-archive" -maxdepth 1 -type f -name "*.tar.gz.tmp" -mtime +${RETAIN_DAYS} -print -delete 2>>"$LOG" | sed "s|^|  删除临时包: |" >> "$LOG"
find "$BACKUP_DIR" -maxdepth 1 -type f -name "*.tar.gz.tmp" -mtime +${RETAIN_DAYS} -print -delete 2>>"$LOG" | sed "s|^|  删除临时包: |" >> "$LOG"

# 2) 过期的手工备份包（tgz/tar.gz）
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "*.tgz" -o -name "*.tar.gz" \) -mtime +${RETAIN_DAYS} -print -exec rm -f {} \; 2>>"$LOG" | sed "s|^|  删除备份包: |" >> "$LOG"

REMAIN=$(find "$BACKUP_DIR" -maxdepth 1 -type d -name "20*" | wc -l)
SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "[$(date "+%Y-%m-%d %H:%M:%S")] 清理完成，剩余 ${REMAIN} 个日期备份，占用 ${SIZE}" >> "$LOG"
