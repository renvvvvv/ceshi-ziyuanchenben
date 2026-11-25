/**
 * 测试管理制度文档路由
 *
 * 文件上传到 /app/uploads/ 目录，元数据存 test_docs 表。
 * 支持多用户共享：上传后任何人可通过下载链接获取文件。
 */
import { Router } from 'express';
import multer from 'multer';
import { sendPreview, startBackgroundConvert } from '../utils/preview.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
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
    // multer originalname 为 latin1 编码，中文名需先解码（与 drawingPipeline 一致）
    const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/]/g, '_').replace(/\s+/g, '_');
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
const UPLOAD_EXT_ALLOW = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg', 'webp', 'zip', 'rar', '7z']);
router.post('/upload', requireAuth, requireRole(['管理者', '编辑者']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '未收到文件' });
    }
    // 扩展名白名单：与预览安全防线呼应，杜绝可执行内容入库
    const upExt = (req.file.originalname.split('.').pop() || '').toLowerCase();
    if (!UPLOAD_EXT_ALLOW.has(upExt)) {
      try { unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(400).json({ success: false, message: `不支持的文件类型 .${upExt}（支持文档/图片/压缩包）` });
    }
    const { title, category, description } = req.body;
    if (!title || !category) {
      // 校验失败也要清理已落盘的文件，避免孤儿文件堆积
      try { unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ success: false, message: '标题和分类必填' });
    }

    const id = 'doc_' + Date.now() + '_' + randomUUID().slice(0, 8);
    // multer 给的 originalname 是按 latin1 解出来的字节串：中文名要还原成 UTF-8（另两个上传接口已是这么做的）。
    // 此前直接落库，下载时的文件名、预览标题都是乱码
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const fileSize = formatFileSize(req.file.size);
    const fileType = (fileName.split('.').pop() || '').toLowerCase();
    const filePath = req.file.filename; // multer 生成的磁盘文件名，直接用作 file_path

    await db.runAsync(
      `INSERT INTO test_docs (id, title, category, description, file_name, file_size, file_type, file_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      id, title, category, description || '', fileName, fileSize, fileType, filePath,
    );

    // 上传即后台预转：第一个打开者不再等 LibreOffice 冷转换
    if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'wps', 'et', 'dps'].includes(fileType)) {
      startBackgroundConvert(join(UPLOAD_DIR, filePath));
    }
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
 * GET /api/test-docs/:id/preview — 在线预览（图片/PDF/文本原生；Office 转 PDF）
 */
router.get('/:id/preview', requireAuth, async (req, res) => {
  try {
    const rows = await db.allAsync('SELECT file_path, file_name, title FROM test_docs WHERE id = $1', req.params.id) as any[];
    const doc = rows[0];
    if (!doc || !doc.file_path) { res.status(404).json({ error: '文件不存在' }); return; }
    const absPath = join(UPLOAD_DIR, doc.file_path);
    if (!existsSync(absPath)) { res.status(404).json({ error: '文件已丢失' }); return; }
    await sendPreview(res, absPath, doc.file_name || doc.title || 'preview', `/api/test-docs/${req.params.id}/preview`);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '预览失败' });
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
    // 先删 DB 记录再删磁盘文件：DB 删除失败时文件仍在，避免留下指向缺失文件的行
    await db.runAsync('DELETE FROM test_docs WHERE id = $1', req.params.id);
    const filePath = join(UPLOAD_DIR, doc.file_path);
    // 顺带清理该文件的预览缓存（key 与 preview.ts 一致：md5(磁盘文件名 + mtime + size)）。
    // 必须在删原文件之前取 mtime/size，并且每个缓存文件各自 try——
    // 此前先删原文件再 stat（必然失败），三个缓存文件一个都没清掉，preview-cache 只增不减
    const cacheFiles: string[] = [];
    try {
      const st = statSync(filePath);
      const hash = createHash('md5').update(doc.file_path).update(String(st.mtimeMs)).update(String(st.size)).digest('hex');
      for (const suffix of ['.pdf', '.pdf.preview.pdf', '.pdf.preview.pdf.skip']) {
        cacheFiles.push(join(UPLOAD_DIR, 'preview-cache', hash + suffix));
      }
    } catch { /* 原文件已不在：没有缓存可清 */ }
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* 文件不在或删不掉，记录已删，不阻塞 */ }
    for (const f of cacheFiles) {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* 缓存不存在或删不掉，忽略 */ }
    }
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
