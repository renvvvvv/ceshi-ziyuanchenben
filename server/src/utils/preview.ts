/**
 * 文件预览公共工具 v2：异步转换 + 加载页 + 永不降级下载
 * - 图片 / PDF / 文本：浏览器原生 inline 直出
 * - Office：LibreOffice 转 PDF（缓存 uploads/preview-cache/）
 *   - 有缓存 → 直接出 PDF（秒开）
 *   - 无缓存 → 触发后台转换 + 返回自动刷新的加载页（3 秒轮询）
 */
import { Response } from 'express';
import { execFile } from 'child_process';
import { existsSync, mkdirSync, statSync, renameSync, unlinkSync } from 'fs';
import { join, extname, basename } from 'path';
import { createHash, randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const UPLOAD_ROOT = join(__dirname, '..', '..', '..', 'uploads');
const CACHE_DIR = join(UPLOAD_ROOT, 'preview-cache');

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']); // svg/svgz 移除（可内嵌脚本）
const DANGEROUS_EXT = new Set(['svg', 'svgz', 'html', 'htm', 'xhtml', 'xht', 'shtml', 'shtm', 'mht', 'mhtml', 'xml']); // 强制下载（含所有可执行/样式注入变体）

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'log', 'json', 'yml', 'yaml', 'ini', 'conf']); // xml 归 DANGEROUS_EXT
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
  execFile('soffice', ['-env:UserInstallation=file:///tmp/lo_' + randomUUID().slice(0, 8), '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', CACHE_DIR, absPath],
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
    execFile('soffice', ['-env:UserInstallation=file:///tmp/lo_' + randomUUID().slice(0, 8), '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', CACHE_DIR, absPath],
      { timeout: 300_000 }, (err) => {
        if (err) { reject(err); return; }
        const produced = join(CACHE_DIR, basename(absPath, extname(absPath)) + '.pdf');
        try { renameSync(produced, cache); resolve(cache); } catch (e) { reject(e); }
      });
  });
}

/** 加载等待页（JS 轮询检测转换完成，无整页刷新闪烁；失败回退 6 秒 meta 刷新） */
function loadingPage(res: Response, previewUrl: string, fileName: string): void {
  res.type('html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>正在转换: ${escHtml(fileName)}</title>
<meta http-equiv="refresh" content="30;url=${escHtml(previewUrl)}">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f6f5fc;margin:0}
.box{text-align:center;padding:40px 60px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08)}
.spinner{width:40px;height:40px;border:4px solid #e9e7f4;border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}
h3{color:#1e1b2e;margin:0 0 8px;font-size:16px}p{color:#6b6892;font-size:13px;margin:0}</style></head>
<body><div class="box"><div class="spinner"></div>
<h3>正在转换为 PDF...</h3>
<p>${escHtml(fileName)}</p><p id="t" style="margin-top:8px">大文件首次转换需要一些时间，转完自动展示</p>
</div>
<script>
(function(){
  var n = 0, timer;
  function poll(){
    fetch(location.href, { cache: 'no-store' }).then(function(r){
      var ct = r.headers.get('content-type') || '';
      if (ct.indexOf('pdf') >= 0) { location.replace(location.href); return; }
      tick();
    }).catch(tick);
  }
  function tick(){
    n++;
    var el = document.getElementById('t');
    if (el) el.textContent = '已等待 ' + (n * 3) + ' 秒，仍在转换中...';
    timer = setTimeout(poll, 3000);
  }
  poll();
})();
</script></body></html>`);
}

// ============ PDF 预览压缩（公网带宽有限，大 PDF 用 ghostscript 压缩版预览，原文件下载不受影响）============
const COMPRESS_THRESHOLD = 1.5 * 1024 * 1024; // 超过 1.5MB 才压缩
const compressing = new Set<string>();

function compressedPreviewPath(pdfPath: string): string {
  const st = statSync(pdfPath);
  const hash = createHash('md5').update(pdfPath).update(String(st.mtimeMs)).update(String(st.size)).digest('hex');
  return join(CACHE_DIR, hash + '.preview.pdf');
}

/** gs 压缩单次执行（输出到临时文件，成功后由调用方原子改名——避免半成品 PDF 被并发请求直出） */
function gsCompress(pdfPath: string, tmpOut: string, setting: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('gs', ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=${setting}`,
      '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${tmpOut}`, pdfPath],
      { timeout: 300_000 }, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * 后台 gs 压缩（两级：/ebook 150dpi → 无收益时降级 /screen 72dpi）
 * 扫描版图片 PDF 可压 5-10 倍；矢量文字版无收益则写 .skip 负缓存标记、直发原文件
 */
function startBackgroundCompress(pdfPath: string): void {
  const out = compressedPreviewPath(pdfPath);
  const skip = out + '.skip';
  if (existsSync(out) || existsSync(skip) || compressing.has(out)) return;
  compressing.add(out);
  const origSize = statSync(pdfPath).size;
  const tmp = out + '.tmp.pdf';
  (async () => {
    for (const setting of ['/ebook', '/screen']) {
      try {
        await gsCompress(pdfPath, tmp, setting);
        const tmpSize = existsSync(tmp) ? statSync(tmp).size : Infinity;
        // 收益判定：压到 80% 以下才接受；/ebook 不达标换 /screen，/screen 仍不达标写 .skip 放弃
        if (tmpSize < origSize * 0.8) {
          const { renameSync: rn } = await import('fs');
          rn(tmp, out); // 原子替换：并发请求要么看到完整旧状态要么看到完整压缩版
          console.log(`[preview] PDF压缩完成(${setting}): ${basename(pdfPath)} ${Math.round(origSize / 1024)}KB → ${Math.round(tmpSize / 1024)}KB`);
          return;
        }
        if (existsSync(tmp)) { try { unlinkSync(tmp); } catch { /* ignore */ } }
      } catch (err: any) {
        console.warn(`[preview] PDF压缩失败(${setting}):`, basename(pdfPath), err.message);
        if (existsSync(tmp)) { try { unlinkSync(tmp); } catch { /* ignore */ } }
      }
    }
    // 两级均无收益：写负缓存标记（源文件指纹），避免每次预览重复空烧 CPU
    const { writeFileSync: wf } = await import('fs');
    try { wf(skip, String(origSize)); } catch { /* ignore */ }
    console.log('[preview] PDF压缩无收益（已标记跳过），使用原文件:', basename(pdfPath));
  })().finally(() => compressing.delete(out));
}

/** 预览用 PDF 路径：大的优先发压缩版（首次触发后台压缩、本次先回原版） */
function pdfForPreview(pdfPath: string): string {
  try {
    if (statSync(pdfPath).size > COMPRESS_THRESHOLD) {
      const out = compressedPreviewPath(pdfPath);
      if (existsSync(out)) return out;
      startBackgroundCompress(pdfPath);
    }
  } catch { /* stat 失败回原版 */ }
  return pdfPath;
}

/**
 * 发送预览响应。Office 文件无缓存时返回加载页并触发后台转换。
 */
export async function sendPreview(res: Response, absPath: string, displayName: string, previewUrl?: string): Promise<void> {
  const ext = extname(absPath).slice(1).toLowerCase();
  // 全局安全头：禁止浏览器 MIME 嗅探（防"未知类型被当 HTML 执行"）
  res.setHeader('X-Content-Type-Options', 'nosniff');

  /** 发送预览文件：express sendFile 的 options.headers 会被静默忽略（send 0.19 不支持），
   *  必须显式 setHeader。缓存语义：终态（原文件小 / 压缩版就绪）才允许长缓存；
   *  压缩进行中回原版时用 no-cache——否则浏览器按启发式缓存把大原版缓存数天，压缩版永远不生效 */
  const sendInline = (filePath: string, finalState: boolean, type?: string) => {
    if (type) res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(displayName)}`);
    res.setHeader('Cache-Control', finalState ? 'private, max-age=3600' : 'private, no-cache');
    res.sendFile(filePath);
  };

  // 图片 / PDF / 文本：直接 inline（PDF 走压缩版预览）
  if (IMG_EXT.has(ext) || ext === 'pdf' || TEXT_EXT.has(ext)) {
    if (ext === 'pdf') {
      const target = pdfForPreview(absPath);
      sendInline(target, target === absPath ? statSync(absPath).size <= COMPRESS_THRESHOLD : true, 'application/pdf');
    } else if (TEXT_EXT.has(ext)) {
      sendInline(absPath, true, 'text/plain; charset=utf-8'); // 显式 text/plain：即使内容含 <script> 也不被当 HTML 渲染
    } else {
      sendInline(absPath, true);
    }
    return;
  }

  // Office：有缓存出 PDF（压缩版预览），无缓存触发后台转换 + 加载页
  if (OFFICE_EXT.has(ext)) {
    const cache = pdfCachePath(absPath);
    if (existsSync(cache)) {
      const target = pdfForPreview(cache);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(basename(displayName, extname(displayName)) + '.pdf')}`);
      res.setHeader('Cache-Control', target === cache ? 'private, max-age=3600' : 'private, no-cache');
      res.sendFile(target);
      return;
    }
    // 无缓存：触发后台转换，返回加载页
    startBackgroundConvert(absPath);
    loadingPage(res, previewUrl || '', displayName);
    return;
  }

  // SVG/HTML/XML 等可执行类型（含 svgz/xht/shtml/mht 变体）：强制 attachment 下载（防存储型 XSS）
  if (DANGEROUS_EXT.has(ext)) {
    res.download(absPath, displayName);
    return;
  }
  // 其他未知类型：默认拒绝内联，强制下载（默认放行会让未来新扩展绕过全部防线）
  res.download(absPath, displayName);
}
