import { collections } from './db.js';
import { config } from './config.js';
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from './security.js';

const COOKIE_NAME = 'anjian_admin_session';
const DUMMY_PASSWORD_HASH = hashPassword('not-a-real-admin-password');

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function setSessionCookie(req, res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureRequest(req),
    path: '/',
    expires: expiresAt,
  });
}

function clearSessionCookie(req, res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureRequest(req),
    path: '/',
  });
}

async function findSession(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = await collections.sessions.findOne({
    tokenHash,
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  const admin = await collections.admins.findOne({ _id: session.adminId });
  if (!admin) return null;
  return { tokenHash, session, admin };
}

export async function login(req, res) {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: '请输入管理员账号和密码' });
  }

  const admin = await collections.admins.findOne({ username });
  const passwordOk = verifyPassword(
    password,
    admin?.passwordHash || DUMMY_PASSWORD_HASH,
  );

  if (!admin || !passwordOk) {
    return res.status(401).json({ error: '账号或密码不正确' });
  }

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
  await collections.sessions.insertOne({
    tokenHash: hashSessionToken(token),
    adminId: admin._id,
    createdAt: new Date(),
    expiresAt,
  });

  setSessionCookie(req, res, token, expiresAt);
  return res.json({
    authenticated: true,
    admin: { username: admin.username },
    expiresAt: expiresAt.toISOString(),
  });
}

export async function logout(req, res) {
  const token = readCookie(req, COOKIE_NAME);
  if (token) {
    await collections.sessions.deleteOne({ tokenHash: hashSessionToken(token) });
  }
  clearSessionCookie(req, res);
  return res.status(204).end();
}

export async function currentSession(req, res) {
  const found = await findSession(req);
  if (!found) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    admin: { username: found.admin.username },
    expiresAt: found.session.expiresAt.toISOString(),
  });
}

export async function requireAdmin(req, res, next) {
  try {
    const found = await findSession(req);
    if (!found) {
      return res.status(401).json({ error: '登录已失效，请重新登录' });
    }
    req.admin = found.admin;
    req.adminSessionTokenHash = found.tokenHash;
    return next();
  } catch (error) {
    return next(error);
  }
}

export async function requireSameOrigin(req, res, next) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const allowedHost = req.headers.host;
  if (!origin && !referer) {
    return next();
  }

  try {
    const source = new URL(origin || referer);
    if (source.host === allowedHost) return next();
  } catch {
    // Fall through to the rejection below.
  }

  return res.status(403).json({ error: '请求来源校验失败' });
}

export async function recordAudit(req, action, details = {}) {
  try {
    await collections.auditLogs.insertOne({
      action,
      adminId: req.admin?._id || null,
      adminUsername: req.admin?.username || '',
      submissionId: details.submissionId || null,
      meta: details.meta || {},
      at: new Date(),
    });
  } catch (error) {
    console.error('审计日志写入失败：', error.message);
  }
}
