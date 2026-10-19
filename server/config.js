import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`环境变量 ${name} 无效`);
  }
  return value;
}

const fileEncryptionKey = String(process.env.FILE_ENCRYPTION_KEY || '').trim();
if (!/^[a-f0-9]{64}$/i.test(fileEncryptionKey)) {
  throw new Error('FILE_ENCRYPTION_KEY 必须是 64 位十六进制字符，请检查 .env');
}

const deepseekApiUrl = String(
  process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions',
).trim();
let parsedDeepseekUrl;
try {
  parsedDeepseekUrl = new URL(deepseekApiUrl);
} catch {
  throw new Error('DEEPSEEK_API_URL 不是有效的 URL');
}
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(parsedDeepseekUrl.hostname);
if (parsedDeepseekUrl.protocol !== 'https:' && !(isLocalHost && parsedDeepseekUrl.protocol === 'http:')) {
  throw new Error('DEEPSEEK_API_URL 必须使用 HTTPS，仅本地调试允许 HTTP');
}

const deepseekModel = String(process.env.DEEPSEEK_MODEL || 'deepseek-flash').trim();
if (!/^[a-zA-Z0-9._-]+$/.test(deepseekModel)) {
  throw new Error('DEEPSEEK_MODEL 包含不支持的字符');
}

const deepseekTimeoutMs = numberFromEnv('DEEPSEEK_TIMEOUT_MS', 45000);
if (deepseekTimeoutMs < 5000 || deepseekTimeoutMs > 120000) {
  throw new Error('DEEPSEEK_TIMEOUT_MS 必须在 5000 到 120000 之间');
}

const host = String(process.env.HOST || '0.0.0.0').trim();
if (!/^[a-zA-Z0-9.:-]+$/.test(host)) {
  throw new Error('HOST 配置无效');
}

const dataDir = path.resolve(rootDir, process.env.DATA_DIR || 'data');
const uploadsDir = path.join(dataDir, 'uploads');

for (const directory of [dataDir, uploadsDir]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export const config = {
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir,
  uploadsDir,
  host,
  port: numberFromEnv('PORT', 8788),
  mongodbUri: String(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017'),
  mongodbDb: String(process.env.MONGODB_DB || 'anjian_intake'),
  adminUsername: String(process.env.ADMIN_USERNAME || 'admin').trim(),
  adminInitialPassword: String(process.env.ADMIN_PASSWORD || ''),
  sessionTtlHours: numberFromEnv('SESSION_TTL_HOURS', 12),
  fileEncryptionKey: Buffer.from(fileEncryptionKey, 'hex'),
  maxExportRows: numberFromEnv('MAX_EXPORT_ROWS', 300),
  trustProxy: process.env.TRUST_PROXY === '1',
  deepseek: {
    apiKey: String(process.env.DEEPSEEK_API_KEY || '').trim(),
    apiUrl: parsedDeepseekUrl.toString(),
    model: deepseekModel,
    timeoutMs: deepseekTimeoutMs,
  },
};
