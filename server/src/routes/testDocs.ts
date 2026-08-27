/**
 * 测试管理制度文档路由
 *
 * 文件上传到 /app/uploads/ 目录，元数据存 test_docs 表。
 * 支持多用户共享：上传后任何人可通过下载链接获取文件。
 */
import { Router } from 'express';
import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
// 上传目录：/app/uploads（Docker WORKDIR=/app）
const UPLOAD_DIR = join(__dirname, '..', '..', '..', 'uploads');

// 确保上传目录存在
if (!existsSync(UPLOAD_DIR)) {
  try { mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
}

// multer 配置：先用临时名存，handler 里生成 id 后直接用 multer 的 filename 作为 file_path
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // 安全文件名：去掉路径，保留扩展名；加随机前缀防同毫秒并发覆盖
    const safeName = file.originalname.replace(/[\\/]/g, '_').replace(/\s+/g, '_');
    cb(null, `${Date.now()}_${randomUUID().slice(0, 8)}_${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

/**
 * GET /api/test-docs
 * 列出所有文档元数据
 */
router.get('/', requireAuth, async (_req, res) => {
  try {
    const rows = await db.allAsync('SELECT * FROM test_docs ORDER BY created_at DESC') as any[];
    const docs = rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      description: r.description || '',
      fileName: r.file_name,
      fileSize: r.file_size,
      fileType: r.file_type,
      lastUpdated: r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 10) : '',
      fileUrl: `/api/test-docs/${r.id}/download`,
      content: r.description || '',
    }));
    res.json({ success: true, data: docs });
  } catch (err: any) {
    console.error('[TestDocs] 列表失败:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/test-docs/upload
 * multipart 上传：file(文件) + title + category + description
 */
router.post('/upload', requireAuth, requireRole(['管理者', '编辑者']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '未收到文件' });
    }
    const { title, category, description } = req.body;
    if (!title || !category) {
      // 校验失败也要清理已落盘的文件，避免孤儿文件堆积
      try { unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ success: false, message: '标题和分类必填' });
    }

    const id = 'doc_' + Date.now() + '_' + randomUUID().slice(0, 8);
    const fileName = req.file.originalname;
    const fileSize = formatFileSize(req.file.size);
    const fileType = (fileName.split('.').pop() || '').toLowerCase();
    const filePath = req.file.filename; // multer 生成的磁盘文件名，直接用作 file_path

    await db.runAsync(
      `INSERT INTO test_docs (id, title, category, description, file_name, file_size, file_type, file_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      id, title, category, description || '', fileName, fileSize, fileType, filePath,
    );

    res.json({
      success: true,
      data: {
        id, title, category, description: description || '',
        fileName, fileSize, fileType,
        lastUpdated: new Date().toISOString().slice(0, 10),
        fileUrl: `/api/test-docs/${id}/download`,
        content: description || '',
      },
    });
  } catch (err: any) {
    // DB 失败时同样清理已落盘文件
    if (req.file) { try { unlinkSync(req.file.path); } catch {} }
    console.error('[TestDocs] 上传失败:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/test-docs/:id/download
 * 下载文件
 */
router.get('/:id/download', requireAuth, async (req, res) => {
  try {
    const rows = await db.allAsync('SELECT * FROM test_docs WHERE id = $1', req.params.id) as any[];
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    const doc = rows[0];
    const filePath = join(UPLOAD_DIR, doc.file_path);
    if (!existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件已被删除' });
    }
    res.download(filePath, doc.file_name || doc.title);
  } catch (err: any) {
    console.error('[TestDocs] 下载失败:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/test-docs/:id
 * 删除文件 + DB 记录
 */
router.delete('/:id', requireRole(['管理者']), async (req, res) => {
  try {
    const rows = await db.allAsync('SELECT * FROM test_docs WHERE id = $1', req.params.id) as any[];
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    const doc = rows[0];
    // 删除磁盘文件
    const filePath = join(UPLOAD_DIR, doc.file_path);
    try {
      const { unlinkSync } = await import('fs');
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch {}
    // 删除 DB 记录
    await db.runAsync('DELETE FROM test_docs WHERE id = $1', req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[TestDocs] 删除失败:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export default router;
