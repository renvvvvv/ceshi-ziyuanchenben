import fs from 'node:fs';
import path from 'node:path';

/**
 * E2E 的目标环境与账号一律从环境变量读取，不写进仓库：
 *   E2E_BASE_URL                        被测地址；不设时默认本地 http://localhost:3000
 *   E2E_ADMIN_USER / E2E_ADMIN_PASS     管理员账号
 *   E2E_EDITOR_USER / E2E_EDITOR_PASS   编辑者账号（只有权限相关用例用）
 * 可以把这些写进仓库根目录的 .env.e2e（已被 git 忽略），格式与 .env 相同；已在环境里的变量优先。
 *
 * 背景：此前配置里写死了线上地址和管理员口令——任何人检出仓库后随手一跑，就会对线上做写操作
 * （抓快照、建删资源配置、调 AI），而且仓库是公开的。现在指向线上必须显式配置。
 */

export function loadE2EEnv(file = path.resolve(process.cwd(), '.env.e2e')): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function e2eBaseUrl(): string {
  return process.env.E2E_BASE_URL || 'http://localhost:3000';
}

function cred(userKey: string, passKey: string, label: string): { username: string; password: string } {
  const username = process.env[userKey] || '';
  const password = process.env[passKey] || '';
  if (!username || !password) {
    throw new Error(
      `未配置${label}账号：请设置环境变量 ${userKey} / ${passKey}，或写进仓库根目录的 .env.e2e（该文件不提交）。`
      + `当前被测地址：${e2eBaseUrl()}`,
    );
  }
  return { username, password };
}

export const e2eAdmin = () => cred('E2E_ADMIN_USER', 'E2E_ADMIN_PASS', '管理员');
export const e2eEditor = () => cred('E2E_EDITOR_USER', 'E2E_EDITOR_PASS', '编辑者');
