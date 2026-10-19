import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { hashPassword } from '../server/security.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(rootDir, '.env');
dotenv.config({ path: envPath, quiet: true });

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const databaseName = process.env.MONGODB_DB || 'anjian_intake';
const username = String(process.env.ADMIN_USERNAME || 'admin').trim();

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(18);
  let password = '';
  for (let index = 0; index < bytes.length; index += 1) {
    password += alphabet[bytes[index] % alphabet.length];
  }
  return password;
}

async function updateEnvPassword(password) {
  let content;
  try {
    content = await fs.readFile(envPath, 'utf8');
  } catch {
    content = '';
  }

  const line = `ADMIN_PASSWORD=${password}`;
  if (/^ADMIN_PASSWORD=.*$/m.test(content)) {
    content = content.replace(/^ADMIN_PASSWORD=.*$/m, line);
  } else {
    content = `${content.trimEnd()}\n${line}\n`;
  }
  await fs.writeFile(envPath, content, { mode: 0o600 });
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 6000 });

try {
  await client.connect();
  const db = client.db(databaseName);
  const admins = db.collection('admins');
  const sessions = db.collection('sessions');

  const existing = await admins.findOne({ username });
  if (!existing) {
    const count = await admins.countDocuments();
    if (count > 0) {
      const names = await admins.find({}, { projection: { username: 1 } }).toArray();
      console.error(`未找到账号 ${username}。当前管理员账号：${names.map((item) => item.username).join('、')}`);
      process.exitCode = 1;
    } else {
      console.error('管理员账号尚未创建，请先启动一次服务完成初始化。');
      process.exitCode = 1;
    }
  } else {
    const password = generatePassword();
    await updateEnvPassword(password);
    await admins.updateOne(
      { _id: existing._id },
      { $set: { passwordHash: hashPassword(password), passwordUpdatedAt: new Date() } },
    );
    const result = await sessions.deleteMany({ adminId: existing._id });
    console.log(`管理员 ${username} 的密码已更新并写入 .env，已注销 ${result.deletedCount} 个旧会话。`);
    console.log(`新密码：${password}`);
    console.log('请立即将新密码保存到安全的位置，本密码不会再次显示。');
  }
} catch (error) {
  console.error('修改密码失败：', error.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
