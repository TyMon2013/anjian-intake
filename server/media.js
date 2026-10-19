import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export class ImageValidationError extends Error {}

function decryptPayload(payload) {
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    config.fileEncryptionKey,
    iv,
  );
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function encryptPayload(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.fileEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export async function validateAndProcessImage(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: 60_000_000,
    }).metadata();
  } catch {
    throw new ImageValidationError('图片无法读取，请重新拍摄或选择图片');
  }

  if (!ACCEPTED_FORMATS.has(metadata.format)) {
    throw new ImageValidationError('仅支持 JPG、PNG 或 WebP 格式的图片');
  }
  if (!metadata.width || !metadata.height) {
    throw new ImageValidationError('图片尺寸无效，请重新选择');
  }
  const longestSide = Math.max(metadata.width, metadata.height);
  const shortestSide = Math.min(metadata.width, metadata.height);
  if (longestSide < 600 || shortestSide < 240) {
    throw new ImageValidationError('图片分辨率过低，请上传清晰完整的身份证照片');
  }

  try {
    const output = await sharp(buffer, { failOn: 'error' })
      .rotate()
      .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 91, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: output.data,
      width: output.info.width,
      height: output.info.height,
    };
  } catch {
    throw new ImageValidationError('图片处理失败，请更换一张图片后重试');
  }
}

export async function prepareImageForRecognition(buffer) {
  return sharp(buffer, { failOn: 'error' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

export async function storeEncryptedImage(buffer, side) {
  const now = new Date();
  const relativeDirectory = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const directory = path.join(config.uploadsDir, relativeDirectory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });

  const filename = `${crypto.randomUUID()}-${side}.bin`;
  const relativePath = path.join(relativeDirectory, filename).replace(/\\/g, '/');
  const absolutePath = resolveStoredPath(relativePath);
  await fs.writeFile(absolutePath, encryptPayload(buffer), { mode: 0o600 });
  return relativePath;
}

function resolveStoredPath(relativePath) {
  const absolutePath = path.resolve(config.uploadsDir, relativePath);
  if (!absolutePath.startsWith(`${config.uploadsDir}${path.sep}`)) {
    throw new Error('非法的影像路径');
  }
  return absolutePath;
}

export async function readStoredImage(relativePath) {
  const payload = await fs.readFile(resolveStoredPath(relativePath));
  return decryptPayload(payload);
}

export async function deleteStoredImages(paths) {
  await Promise.all(
    paths.filter(Boolean).map(async (relativePath) => {
      try {
        await fs.unlink(resolveStoredPath(relativePath));
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('删除影像失败：', error.message);
        }
      }
    }),
  );
}
