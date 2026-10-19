import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { config } from './config.js';
import { collections, connectDatabase, closeDatabase } from './db.js';
import { rateLimit } from './rate-limit.js';
import { randomReceiptCode } from './security.js';
import {
  currentSession,
  login,
  logout,
  recordAudit,
  requireAdmin,
  requireSameOrigin,
} from './auth.js';
import {
  buildSubmissionFilter,
  parsePagination,
  toAdminDetail,
  toAdminListItem,
  validateSubmissionPayload,
} from './submissions.js';
import {
  deleteStoredImages,
  ImageValidationError,
  readStoredImage,
  storeEncryptedImage,
  validateAndProcessImage,
} from './media.js';
import {
  recognitionConfigured,
  recognizeIdCardImage,
  RecognitionNotConfiguredError,
  RecognitionUpstreamError,
} from './recognition.js';
import { buildSubmissionsWorkbook } from './excel.js';

const app = express();
const router = express.Router();

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'blob:', 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  }),
);
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  next();
});

const uploadLimits = {
  fileSize: 12 * 1024 * 1024,
  files: 2,
  fields: 12,
  fieldSize: 64 * 1024,
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: uploadLimits,
  fileFilter(req, file, callback) {
    if (!/^image\//i.test(file.mimetype)) {
      return callback(new ImageValidationError('请选择图片文件'));
    }
    return callback(null, true);
  },
});

function useUpload(middleware) {
  return function uploadMiddleware(req, res, next) {
    middleware(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
        const message =
          error.code === 'LIMIT_FILE_SIZE'
            ? '单张图片不能超过 12MB'
            : error.code === 'LIMIT_UNEXPECTED_FILE'
              ? '上传字段不正确，请刷新页面后重试'
              : '图片上传失败，请重试';
        return res.status(400).json({ error: message });
      }
      if (error instanceof ImageValidationError) {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    });
  };
}

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function dateStamp() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/-/g, '');
}

function contentDisposition(type, asciiName, unicodeName) {
  return `${type}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(unicodeName)}`;
}

// ---------- Public intake ----------

router.post(
  '/recognize',
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 40,
    keyPrefix: 'recognition',
    message: '识别请求过于频繁，请稍后再试或手动填写',
  }),
  useUpload(upload.single('image')),
  asyncRoute(async (req, res) => {
    const side = req.body?.side === 'back' ? 'back' : req.body?.side === 'front' ? 'front' : '';
    if (!side) return res.status(400).json({ error: '请指定身份证正反面' });
    if (req.body?.recognitionConsent !== 'true') {
      return res.status(400).json({ error: '请先确认证件识别授权' });
    }
    if (!req.file) return res.status(400).json({ error: '请先选择身份证照片' });

    const processed = await validateAndProcessImage(req.file.buffer);
    try {
      const result = await recognizeIdCardImage(processed.buffer, side);
      return res.json({
        ok: true,
        side,
        fields: result.fields,
        warnings: result.warnings,
      });
    } catch (error) {
      if (error instanceof RecognitionNotConfiguredError) {
        return res.status(503).json({
          error: '自动识别暂时不可用，请手动填写信息或联系服务人员。',
        });
      }
      if (error instanceof RecognitionUpstreamError) {
        console.error('智能识别失败：', error.message);
        return res.status(error.httpStatus).json({ error: error.publicMessage });
      }
      throw error;
    }
  }),
);

router.post(
  '/submissions',
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    keyPrefix: 'submit',
    message: '提交次数过多，请稍后再试或联系服务人员',
  }),
  useUpload(
    upload.fields([
      { name: 'front', maxCount: 1 },
      { name: 'back', maxCount: 1 },
    ]),
  ),
  asyncRoute(async (req, res) => {
    let payload;
    try {
      payload = JSON.parse(req.body?.payload || '{}');
    } catch {
      return res.status(400).json({ error: '表单数据格式不正确，请刷新页面后重试' });
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: '表单数据格式不正确，请刷新页面后重试' });
    }

    if (String(payload.website || '').trim() !== '') {
      return res.status(400).json({ error: '提交失败，请刷新页面后重试' });
    }

    if (Number.isFinite(payload.startedAt)) {
      const elapsed = Date.now() - Number(payload.startedAt);
      if (elapsed >= 0 && elapsed < 1200) {
        return res.status(400).json({ error: '提交速度过快，请核对信息后再提交' });
      }
    }

    const frontFile = req.files?.front?.[0];
    const backFile = req.files?.back?.[0];
    if (!frontFile || !backFile) {
      return res.status(400).json({ error: '请上传身份证正面和反面照片' });
    }

    const { data, fieldErrors } = validateSubmissionPayload(payload);
    if (!data) {
      return res.status(422).json({ error: '请检查表单中的信息', fieldErrors });
    }

    let frontProcessed;
    let backProcessed;
    try {
      [frontProcessed, backProcessed] = await Promise.all([
        validateAndProcessImage(frontFile.buffer),
        validateAndProcessImage(backFile.buffer),
      ]);
    } catch (error) {
      if (error instanceof ImageValidationError) {
        return res.status(422).json({ error: error.message });
      }
      throw error;
    }

    const imagePaths = [];
    let inserted;
    try {
      const frontPath = await storeEncryptedImage(frontProcessed.buffer, 'front');
      imagePaths.push(frontPath);
      const backPath = await storeEncryptedImage(backProcessed.buffer, 'back');
      imagePaths.push(backPath);

      const now = new Date();
      const receipt = `AJ-${dateStamp()}-${randomReceiptCode()}`;
      const document = {
        receipt,
        name: data.name,
        idNumber: data.idNumber,
        birthDate: data.birthDate,
        sex: data.sex,
        ethnicity: data.ethnicity || '',
        nativePlace: data.nativePlace,
        idAddress: data.idAddress,
        issuingAuthority: data.issuingAuthority,
        validFrom: data.validFrom,
        validTo: data.validTo,
        isLongTerm: data.isLongTerm,
        phone: data.phone,
        currentCity: data.currentCity || '',
        occupation: data.occupation || '',
        company: data.company,
        frontImagePath: frontPath,
        backImagePath: backPath,
        consentVersion: '1.1',
        consentAt: now,
        createdAt: now,
      };

      const result = await collections.submissions.insertOne(document);
      inserted = { ...document, _id: result.insertedId };
    } catch (error) {
      await deleteStoredImages(imagePaths);
      throw error;
    }

    return res.status(201).json({
      receipt: inserted.receipt,
      submittedAt: inserted.createdAt.toISOString(),
      message: '信息已加密保存',
    });
  }),
);

// ---------- Admin auth ----------

router.post(
  '/admin/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyPrefix: 'admin-login',
    message: '登录尝试过于频繁，请 15 分钟后再试',
  }),
  requireSameOrigin,
  asyncRoute(login),
);
router.post('/admin/logout', requireSameOrigin, asyncRoute(logout));
router.get('/admin/session', asyncRoute(currentSession));

// ---------- Admin data ----------

router.get(
  '/admin/submissions',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { filter, error } = buildSubmissionFilter(req.query);
    if (error) return res.status(400).json({ error });

    const { page, pageSize, skip } = parsePagination(req.query);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [total, filteredTotal, today, companies, documents] = await Promise.all([
      collections.submissions.countDocuments({}),
      collections.submissions.countDocuments(filter),
      collections.submissions.countDocuments({ createdAt: { $gte: todayStart } }),
      collections.submissions.distinct('company'),
      collections.submissions
        .find(filter)
        .project({ frontImagePath: 0, backImagePath: 0 })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .toArray(),
    ]);

    return res.json({
      items: documents.map(toAdminListItem),
      stats: {
        total,
        today,
        companyCount: companies.length,
        filteredTotal,
      },
      pagination: {
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(filteredTotal / pageSize)),
      },
    });
  }),
);

router.get(
  '/admin/submissions/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: '记录不存在' });
    }
    const document = await collections.submissions.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!document) return res.status(404).json({ error: '记录不存在' });
    await recordAudit(req, 'view_submission', { submissionId: req.params.id });
    return res.json({ item: toAdminDetail(document) });
  }),
);

router.get(
  '/admin/submissions/:id/image/:side',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { id, side } = req.params;
    if (!ObjectId.isValid(id) || !['front', 'back'].includes(side)) {
      return res.status(404).json({ error: '影像不存在' });
    }
    const document = await collections.submissions.findOne(
      { _id: new ObjectId(id) },
      { projection: { frontImagePath: 1, backImagePath: 1, name: 1 } },
    );
    if (!document) return res.status(404).json({ error: '影像不存在' });

    const relativePath =
      side === 'front' ? document.frontImagePath : document.backImagePath;
    if (!relativePath) return res.status(404).json({ error: '影像不存在' });

    try {
      const buffer = await readStoredImage(relativePath);
      const download = req.query.download === '1';
      const sideLabel = side === 'front' ? '正面' : '反面';
      await recordAudit(req, download ? 'download_image' : 'view_image', {
        submissionId: id,
        meta: { side },
      });
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        contentDisposition(
          download ? 'attachment' : 'inline',
          `id-card-${side}.jpg`,
          `${document.name}-身份证${sideLabel}.jpg`,
        ),
      );
      return res.send(buffer);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: '影像文件不存在' });
      }
      throw error;
    }
  }),
);

router.delete(
  '/admin/submissions/:id',
  requireSameOrigin,
  requireAdmin,
  asyncRoute(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: '记录不存在' });
    }
    const deleted = await collections.submissions.findOneAndDelete({
      _id: new ObjectId(req.params.id),
    });
    if (!deleted) return res.status(404).json({ error: '记录不存在' });

    await deleteStoredImages([deleted.frontImagePath, deleted.backImagePath]);
    await recordAudit(req, 'delete_submission', {
      submissionId: req.params.id,
      meta: { receipt: deleted.receipt },
    });
    return res.status(204).end();
  }),
);

router.get(
  '/admin/export',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { filter, error } = buildSubmissionFilter(req.query);
    if (error) return res.status(400).json({ error });

    const total = await collections.submissions.countDocuments(filter);
    if (total === 0) {
      return res.status(404).json({ error: '当前筛选条件下没有可导出的记录' });
    }
    if (total > config.maxExportRows) {
      return res.status(413).json({
        error: `单次最多导出 ${config.maxExportRows} 条记录，请缩小筛选范围后重试`,
      });
    }

    const documents = await collections.submissions
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(config.maxExportRows)
      .toArray();

    const workbookBuffer = await buildSubmissionsWorkbook(documents, {
      q: req.query.q,
      company: req.query.company,
      from: req.query.from,
      to: req.query.to,
    });

    await recordAudit(req, 'export_submissions', {
      meta: {
        count: documents.length,
        hasQuery: Boolean(req.query.q || req.query.company),
        from: req.query.from || '',
        to: req.query.to || '',
      },
    });

    const asciiName = `anjian-submissions-${dateStamp()}.xlsx`;
    const unicodeName = `安笺-投保客户信息-${dateStamp()}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', contentDisposition('attachment', asciiName, unicodeName));
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.send(workbookBuffer);
  }),
);

app.use('/api', router);

// ---------- Static pages ----------

app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

app.get(['/admin', '/admin/', '/admin.html'], (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(config.publicDir, 'admin.html'));
});

app.use(
  express.static(config.publicDir, {
    index: false,
    dotfiles: 'deny',
    maxAge: 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(config.publicDir, '404.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求数据格式不正确' });
  }
  console.error('请求处理失败：', error);
  if (error instanceof ImageValidationError) {
    return res.status(400).json({ error: error.message });
  }
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '图片大小超出限制' });
  }
  return res.status(500).json({ error: '服务暂时不可用，请稍后重试' });
});

let server;
async function start() {
  await connectDatabase();
  server = app.listen(config.port, config.host, () => {
    const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
    console.log(`安笺信息采集运行于 http://${displayHost}:${config.port}`);
    console.log(`管理端入口 http://localhost:${config.port}/admin`);
    if (recognitionConfigured()) {
      console.log(`智能识别：DeepSeek ${config.deepseek.model}`);
    } else {
      console.warn('未配置 DEEPSEEK_API_KEY：图片自动识别不可用，用户仍可手动填写。');
    }
  });
}

async function shutdown(signal) {
  console.log(`收到 ${signal}，正在关闭服务...`);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closeDatabase();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((error) => {
  console.error('服务启动失败：', error.message);
  process.exit(1);
});
