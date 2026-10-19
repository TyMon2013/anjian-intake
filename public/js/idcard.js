const CHECK_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

export function normalizeIdNumber(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

export function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

export function isMainlandMobile(value) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(value));
}

export function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function formatIsoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function calculateAge(birthDate, at = new Date()) {
  const birth = parseIsoDate(birthDate);
  if (!birth) return null;
  let age = at.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    at.getMonth() < birth.getMonth() ||
    (at.getMonth() === birth.getMonth() && at.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 150 ? age : null;
}

export function inspectIdNumber(value) {
  const idNumber = normalizeIdNumber(value);
  if (!idNumber) {
    return { valid: false, reason: '请填写身份证号码', idNumber };
  }
  if (!/^\d{17}[\dX]$/.test(idNumber)) {
    return { valid: false, reason: '身份证号应为 18 位，末位可为 X', idNumber };
  }

  const year = Number(idNumber.slice(6, 10));
  const month = Number(idNumber.slice(10, 12));
  const day = Number(idNumber.slice(12, 14));
  const birth = new Date(year, month - 1, day);
  const dateIsReal =
    year >= 1900 &&
    birth.getFullYear() === year &&
    birth.getMonth() === month - 1 &&
    birth.getDate() === day;
  if (!dateIsReal || birth.getTime() > Date.now()) {
    return { valid: false, reason: '身份证号中的出生日期无效', idNumber };
  }

  let sum = 0;
  for (let index = 0; index < 17; index += 1) {
    sum += Number(idNumber[index]) * CHECK_WEIGHTS[index];
  }
  const expected = CHECK_CODES[sum % 11];
  if (expected !== idNumber[17]) {
    return { valid: false, reason: '身份证号校验未通过，请核对后重试', idNumber };
  }

  const birthDate = formatIsoDate(birth);
  return {
    valid: true,
    reason: '',
    idNumber,
    birthDate,
    sex: Number(idNumber[16]) % 2 === 1 ? '男' : '女',
    age: calculateAge(birthDate),
  };
}

export function maskIdNumber(value) {
  const idNumber = normalizeIdNumber(value);
  if (idNumber.length !== 18) return idNumber;
  return `${idNumber.slice(0, 6)}********${idNumber.slice(-4)}`;
}

export function formatDateDot(value) {
  return String(value || '').replace(/-/g, '.');
}

export function formatValidity(validFrom, validTo, isLongTerm = false) {
  const start = formatDateDot(validFrom);
  if (!start) return '待核对';
  const end = isLongTerm || !validTo ? '长期' : formatDateDot(validTo);
  return `${start} — ${end}`;
}

export function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/\//g, '.');
}

export function parseValidityText(input) {
  const text = String(input || '')
    .replace(/\s+/g, '')
    .replace(/[—–~～至]/g, '-');
  const isLongTerm = /长期|永久/.test(text);
  const dates = [];
  const pattern = /((?:19|20)\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      dates.push(formatIsoDate(date));
    }
  }
  return {
    validFrom: dates[0] || '',
    validTo: isLongTerm ? null : dates[1] || '',
    isLongTerm,
  };
}

export function todayIso(now = new Date()) {
  return formatIsoDate(now);
}
