import { z } from 'zod';
import {
  calculateAge,
  formatValidity,
  inspectIdNumber,
  normalizeIdNumber,
  normalizePhone,
  parseIsoDate,
  todayIso,
} from '../public/js/idcard.js';

const text = (max, label, minimum = 0) =>
  z
    .string({ error: `请填写${label}` })
    .trim()
    .min(minimum, minimum > 0 ? `${label}不能为空` : undefined)
    .max(max, `${label}不能超过 ${max} 个字符`);

const submissionSchema = z.object({
  name: z
    .string({ error: '请填写姓名' })
    .trim()
    .min(2, '请填写完整姓名')
    .max(30, '姓名不能超过 30 个字符')
    .regex(/^[\u3400-\u9fff·A-Za-z.\s]+$/, '姓名包含不支持的字符'),
  idNumber: z
    .string({ error: '请填写身份证号码' })
    .regex(/^\d{17}[\dX]$/, '身份证号格式不正确'),
  ethnicity: text(20, '民族').optional().default(''),
  nativePlace: text(60, '籍贯', 2),
  idAddress: text(200, '身份证住址', 5),
  issuingAuthority: text(60, '签发机关', 2),
  validFrom: z.string({ error: '请填写证件起始日期' }),
  validTo: z.string().nullable().optional(),
  isLongTerm: z.boolean({ error: '请确认证件有效期类型' }),
  phone: z
    .string({ error: '请填写手机号' })
    .regex(/^1[3-9]\d{9}$/, '请填写正确的 11 位手机号'),
  currentCity: text(60, '现居城市').optional().default(''),
  occupation: text(60, '职业').optional().default(''),
  company: text(100, '企业单位', 2),
  consent: z.literal(true, { error: '请阅读并同意个人信息授权说明' }),
  website: z.string().max(100).optional().default(''),
  startedAt: z.number().finite().optional(),
});

export function validateSubmissionPayload(payload) {
  const normalized = {
    ...payload,
    idNumber: normalizeIdNumber(payload?.idNumber),
    phone: normalizePhone(payload?.phone),
    isLongTerm: payload?.isLongTerm,
    validTo: payload?.isLongTerm === true ? null : payload?.validTo || '',
  };

  const parsed = submissionSchema.safeParse(normalized);
  if (!parsed.success) {
    const fieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] ? String(issue.path[0]) : 'form';
      if (!fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return { data: null, fieldErrors };
  }

  const data = parsed.data;
  const fieldErrors = {};
  const idInspection = inspectIdNumber(data.idNumber);
  if (!idInspection.valid) {
    fieldErrors.idNumber = idInspection.reason;
  }

  const today = parseIsoDate(todayIso());
  const start = parseIsoDate(data.validFrom);
  if (!start) {
    fieldErrors.validFrom = '请选择或填写正确的证件起始日期';
  } else if (start.getTime() > today.getTime()) {
    fieldErrors.validFrom = '证件起始日期不能晚于今天';
  }

  if (!data.isLongTerm) {
    if (!data.validTo) {
      fieldErrors.validTo = '请选择证件到期日期，或勾选长期有效';
    } else {
      const end = parseIsoDate(data.validTo);
      if (!end) {
        fieldErrors.validTo = '请选择正确的证件到期日期';
      } else if (start && end.getTime() < start.getTime()) {
        fieldErrors.validTo = '证件到期日期不能早于起始日期';
      } else if (end.getTime() < today.getTime()) {
        fieldErrors.validTo = '该身份证已过期，请更换有效证件后重新提交';
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { data: null, fieldErrors };
  }

  return {
    data: {
      ...data,
      validTo: data.isLongTerm ? null : data.validTo,
      birthDate: idInspection.birthDate,
      sex: idInspection.sex,
    },
    fieldErrors: {},
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function regexContains(value) {
  return new RegExp(escapeRegExp(value), 'i');
}

export function buildSubmissionFilter(query = {}) {
  const q = String(query.q || '').trim().slice(0, 80);
  const company = String(query.company || '').trim().slice(0, 100);
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();
  const conditions = [];

  if (q) {
    const pattern = regexContains(q);
    conditions.push({
      $or: [
        { name: pattern },
        { idNumber: pattern },
        { phone: pattern },
        { receipt: pattern },
        { nativePlace: pattern },
        { currentCity: pattern },
      ],
    });
  }

  if (company) {
    conditions.push({ company: regexContains(company) });
  }

  if (from) {
    const fromDate = parseIsoDate(from);
    if (!fromDate) return { error: '开始日期格式不正确' };
    conditions.push({ createdAt: { $gte: new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()) } });
  }

  if (to) {
    const toDate = parseIsoDate(to);
    if (!toDate) return { error: '结束日期格式不正确' };
    conditions.push({
      createdAt: {
        $lte: new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999),
      },
    });
  }

  if (conditions.length === 0) return { filter: {} };
  if (conditions.length === 1) return { filter: conditions[0] };
  return { filter: { $and: conditions } };
}

export function parsePagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requestedSize = Number.parseInt(query.pageSize, 10) || 20;
  const pageSize = [10, 20, 50].includes(requestedSize) ? requestedSize : 20;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function toAdminListItem(doc) {
  return {
    id: doc._id.toString(),
    receipt: doc.receipt,
    name: doc.name,
    idNumberMasked: `${doc.idNumber.slice(0, 6)}********${doc.idNumber.slice(-4)}`,
    phone: doc.phone,
    sex: doc.sex,
    birthDate: doc.birthDate,
    age: calculateAge(doc.birthDate),
    ethnicity: doc.ethnicity,
    nativePlace: doc.nativePlace,
    currentCity: doc.currentCity || '',
    occupation: doc.occupation || '',
    company: doc.company || '',
    validFrom: doc.validFrom,
    validTo: doc.validTo,
    isLongTerm: doc.isLongTerm,
    validityText: formatValidity(doc.validFrom, doc.validTo, doc.isLongTerm),
    createdAt: new Date(doc.createdAt).toISOString(),
  };
}

export function toAdminDetail(doc) {
  return {
    ...toAdminListItem(doc),
    idNumber: doc.idNumber,
    idAddress: doc.idAddress,
    issuingAuthority: doc.issuingAuthority,
    consentVersion: doc.consentVersion || '1.0',
    images: {
      front: `/api/admin/submissions/${doc._id.toString()}/image/front`,
      back: `/api/admin/submissions/${doc._id.toString()}/image/back`,
    },
  };
}
