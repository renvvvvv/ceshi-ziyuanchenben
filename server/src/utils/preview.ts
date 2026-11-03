/**
 * 文件预览公共工具 v2：异步转换 + 加载页 + 永不降级下载
 * - 图片 / PDF / 文本：浏览器原生 inline 直出
 * - Office：LibreOffice 转 PDF（缓存 uploads/preview-cache/）
 *   - 有缓存 → 直接出 PDF（秒开）
 *   - 无缓存 → 触发后台转换 + 返回自动刷新的加载页（3 秒轮询）
 */
import { Response } from 'express';
import { execFile } from 'child_process';
import { existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { join, extname, basename } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const UPLOAD_ROOT = join(__dirname, '..', '..', '..', 'uploads');
const CACHE_DIR = join(UPLOAD_ROOT, 'preview-cache');

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']); // svg 移除（可内嵌脚本）
const DANGEROUS_EXT = new Set(['svg', 'html', 'htm', 'xhtml', 'xml']); // 强制下载

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf']);
const OFFICE_EXT = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'wps', 'et', 'dps']);

/** 正在转换中的文件集合（防重复触发） */
const converting = new Set<string>();

function pdfCachePath(absPath: string): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  const st = statSync(absPath);
  const hash = createHash('md5').update(basename(absPath)).update(String(st.mtimeMs)).update(String(st.size)).digest('hex');
  return join(CACHE_DIR, hash + '.pdf');
}

/** 后台异步转 PDF（不等待，不抛错） */
export function startBackgroundConvert(absPath: string): void {
  const cache = pdfCachePath(absPath);
  if (existsSync(cache) || converting.has(cache)) return;
  converting.add(cache);
  execFile('soffice', ['-env:UserInstallation=file:///tmp/lo_profile', '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', CACHE_DIR, absPath],
    { timeout: 300_000 }, (err) => {
      converting.delete(cache);
      if (err) { console.warn('[preview] 后台转换失败:', basename(absPath), err.message); return; }
      const produced = join(CACHE_DIR, basename(absPath, extname(absPath)) + '.pdf');
      try { renameSync(produced, cache); console.log('[preview] 后台转换完成:', basename(absPath)); }
      catch { /* 已被其他进程处理 */ }
    });
}

/** 同步转 PDF（小文件用，带等待） */
export async function convertToPdf(absPath: string): Promise<string> {
  const cache = pdfCachePath(absPath);
  if (existsSync(cache)) return cache;
  return new Promise((resolve, reject) => {
    execFile('soffice', ['-env:UserInstallation=file:///tmp/lo_profile', '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', CACHE_DIR, absPath],
      { timeout: 300_000 }, (err) => {
        if (err) { reject(err); return; }
        const produced = join(CACHE_DIR, basename(absPath, extname(absPath)) + '.pdf');
        try { renameSync(produced, cache); resolve(cache); } catch (e) { reject(e); }
      });
  });
}

/** 加载等待页（自动 3 秒刷新，转完自动跳到 PDF） */
function loadingPage(res: Response, previewUrl: string, fileName: string): void {
  res.type('html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>正在转换: ${escHtml(fileName)}</title>
<meta http-equiv="refresh" content="3;url=${previewUrl}">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f6f5fc;margin:0}
.box{text-align:center;padding:40px 60px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08)}
.spinner{width:40px;height:40px;border:4px solid #e9e7f4;border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}
h3{color:#1e1b2e;margin:0 0 8px;font-size:16px}p{color:#6b6892;font-size:13px;margin:0}</style></head>
<body><div class="box"><div class="spinner"></div>
<h3>正在转换为 PDF...</h3>
<p>${escHtml(fileName)}</p><p style="margin-top:8px">大文件首次转换需要一些时间，页面将自动刷新</p>
</div></body></html>`);
}

/**
 * 发送预览响应。Office 文件无缓存时返回加载页并触发后台转换。
 */
export async function sendPreview(res: Response, absPath: string, displayName: string, previewUrl?: string): Promise<void> {
  const ext = extname(absPath).slice(1).toLowerCase();

  // 图片 / PDF / 文本：直接 inline
  if (IMG_EXT.has(ext) || ext === 'pdf' || TEXT_EXT.has(ext)) {
    res.sendFile(absPath, {
      headers: { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(displayName)}`, 'Cache-Control': 'private, max-age=3600' },
    } as never);
    return;
  }

  // Office：有缓存出 PDF，无缓存触发后台转换 + 加载页
  if (OFFICE_EXT.has(ext)) {
    const cache = pdfCachePath(absPath);
    if (existsSync(cache)) {
      res.type('application/pdf');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(basename(displayName, extname(displayName)) + '.pdf')}`);
      res.sendFile(cache, { headers: { 'Cache-Control': 'private, max-age=3600' } } as never);
      return;
    }
    // 无缓存：触发后台转换，返回加载页
    startBackgroundConvert(absPath);
    loadingPage(res, previewUrl || '', displayName);
    return;
  }

  // SVG/HTML 等可执行类型：强制 attachment 下载（防存储型 XSS）
  if (DANGEROUS_EXT.has(ext)) {
    res.download(absPath, displayName);
    return;
  }
  // 其他未知类型：inline 直出
  res.sendFile(absPath, {
    headers: { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(displayName)}` },
  } as never);
}
