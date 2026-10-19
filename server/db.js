import { MongoClient } from 'mongodb';
import { config } from './config.js';
import { hashPassword, verifyPassword } from './security.js';

let client;
let database;

export const collections = {};

export async function connectDatabase() {
  client = new MongoClient(config.mongodbUri, {
    serverSelectionTimeoutMS: 6000,
    appName: 'anjian-intake',
  });
  await client.connect();
  database = client.db(config.mongodbDb);
  await database.command({ ping: 1 });

  collections.submissions = database.collection('submissions');
  collections.admins = database.collection('admins');
  collections.sessions = database.collection('sessions');
  collections.auditLogs = database.collection('audit_logs');

  await Promise.all([
    collections.submissions.createIndex({ createdAt: -1 }),
    collections.submissions.createIndex({ receipt: 1 }, { unique: true }),
    collections.submissions.createIndex({ idNumber: 1 }),
    collections.submissions.createIndex({ phone: 1 }),
    collections.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.admins.createIndex({ username: 1 }, { unique: true }),
    collections.auditLogs.createIndex({ at: -1 }),
  ]);

  await ensureAdminAccount();

  return database;
}

async function ensureAdminAccount() {
  const username = config.adminUsername;
  const password = config.adminInitialPassword;

  if (!username) {
    throw new Error('请在 .env 中配置 ADMIN_USERNAME');
  }
  if (password && password.length < 8) {
    throw new Error('ADMIN_PASSWORD 至少需要 8 位');
  }

  const existing = await collections.admins.findOne({ username });

  if (!existing) {
    const allAdmins = await collections.admins.find({}).toArray();

    if (allAdmins.length === 1 && password) {
      const previous = allAdmins[0];
      await collections.admins.updateOne(
        { _id: previous._id },
        {
          $set: {
            username,
            passwordHash: hashPassword(password),
            passwordUpdatedAt: new Date(),
          },
        },
      );
      await collections.sessions.deleteMany({ adminId: previous._id });
      console.log(`管理员账号已同步为：${username}，旧会话已注销。`);
      return;
    }

    if (!password) {
      throw new Error('数据库中不存在管理员账号，请配置 ADMIN_PASSWORD 后重启');
    }

    await collections.admins.insertOne({
      username,
      passwordHash: hashPassword(password),
      createdAt: new Date(),
    });
    console.log(`已创建管理员账号：${username}`);
    console.log('管理员密码以 .env 中的 ADMIN_PASSWORD 为准。');
    return;
  }

  if (!password) {
    console.warn('ADMIN_PASSWORD 为空，保留数据库中的现有管理员密码。');
    return;
  }

  if (!verifyPassword(password, existing.passwordHash)) {
    await collections.admins.updateOne(
      { _id: existing._id },
      { $set: { passwordHash: hashPassword(password), passwordUpdatedAt: new Date() } },
    );
    await collections.sessions.deleteMany({ adminId: existing._id });
    console.log(`管理员 ${username} 的密码已按环境变量同步，旧会话已注销。`);
  }
}

export function getDb() {
  if (!database) throw new Error('数据库尚未连接');
  return database;
}

export async function closeDatabase() {
  if (client) {
    await client.close();
    client = undefined;
    database = undefined;
  }
}
