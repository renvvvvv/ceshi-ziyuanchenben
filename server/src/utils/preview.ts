/**
 * 文件预览公共工具：按类型 inline 直出或转 PDF 后直出（不外发第三方，文件不出服务器）
 * - 图片 / PDF / 文本：浏览器原生预览（Content-Disposition: inline）
 * - Office（doc/docx/xls/xlsx/ppt/pptx）：LibreOffice headless 转 PDF（缓存 uploads/preview-cache/）
 */
import { Response } from 'express';
import { execFile } from 'child_process';
import { existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { join, extname, basename } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = dirnameOf(import.meta.url);
function dirnameOf(u: string) { return join(fileURLToPath(u), '..'); }

const UPLOAD_ROOT = join(__dirname, '..', '..', '..', 'uploads');
const CACHE_DIR = join(UPLOAD_ROOT, 'preview-cache');

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf']);
const OFFICE_EXT = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'wps', 'et', 'dps']);

/** LibreOffice 转换（首次冷启动约 5-20s，结果按文件内容哈希缓存） */
function officeToPdf(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    mkdirSync(CACHE_DIR, { recursive: true });
    const st = statSync(absPath);
    const hash = createHash('md5').update(basename(absPath)).update(String(st.mtimeMs)).update(String(st.size)).digest('hex');
    const cached = join(CACHE_DIR, hash + '.pdf');
    if (existsSync(cached)) { resolve(cached); return; }
    execFile('soffice', ['-env:UserInstallation=file:///tmp/lo_profile', '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', CACHE_DIR, absPath],
      { timeout: 60_000 }, (err) => {
        if (err) { reject(err); return; }
        // soffice 输出名为 原名.pdf，重命名为 hash.pdf 作缓存
        const produced = join(CACHE_DIR, basename(absPath, extname(absPath)) + '.pdf');
        try {
          renameSync(produced, cached);
          resolve(cached);
        } catch (e) { reject(e); }
      });
  });
}

/**
 * 发送预览响应。absPath 必须位于 uploads 白名单内。
 * 不支持的类型返回 false（调用方降级为下载）。
 */
export async function sendPreview(res: Response, absPath: string, displayName: string): Promise<boolean> {
  const ext = extname(absPath).slice(1).toLowerCase();
  const inline = (p: string) => res.sendFile(p, {
    headers: { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(displayName)}`, 'Cache-Control': 'private, max-age=300' },
  } as never);
  try {
    if (IMG_EXT.has(ext) || ext === 'pdf' || TEXT_EXT.has(ext)) {
      inline(absPath);
      return true;
    }
    if (OFFICE_EXT.has(ext)) {
      const pdf = await officeToPdf(absPath);
      res.type('application/pdf');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(basename(displayName, extname(displayName)) + '.pdf')}`);
      res.sendFile(pdf, { headers: { 'Cache-Control': 'private, max-age=300' } } as never);
      return true;
    }
  } catch (e) {
    console.warn('[preview] 转换失败，降级下载:', basename(absPath), (e as Error).message);
  }
  return false;
}
