import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAge,
  formatIsoDate,
  formatValidity,
  inspectIdNumber,
  maskIdNumber,
  parseValidityText,
} from '../public/js/idcard.js';
import { validateSubmissionPayload } from '../server/submissions.js';

function dateYearsFromNow(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() + years);
  return formatIsoDate(date);
}

test('validates a Chinese ID number and derives identity fields', () => {
  const result = inspectIdNumber('110105199001010010');
  assert.equal(result.valid, true);
  assert.equal(result.birthDate, '1990-01-01');
  assert.equal(result.sex, '男');
  assert.equal(maskIdNumber(result.idNumber), '110105********0010');
});

test('rejects checksum and impossible-date ID numbers', () => {
  assert.equal(inspectIdNumber('110105199001010011').valid, false);
  const impossibleDate = inspectIdNumber('110105199002300019');
  assert.equal(impossibleDate.valid, false);
  assert.match(impossibleDate.reason, /出生日期/);
});

test('calculates age around the birthday boundary', () => {
  assert.equal(calculateAge('1990-01-01', new Date(2026, 9, 19)), 36);
  assert.equal(calculateAge('1990-12-31', new Date(2026, 9, 19)), 35);
});

test('parses fixed-term and long-term ID validity', () => {
  assert.deepEqual(parseValidityText('2015.05.12-2035.05.12'), {
    validFrom: '2015-05-12',
    validTo: '2035-05-12',
    isLongTerm: false,
  });
  assert.deepEqual(parseValidityText('2020年01月01日 - 长期'), {
    validFrom: '2020-01-01',
    validTo: null,
    isLongTerm: true,
  });
  assert.equal(
    formatValidity('2020-01-01', null, true),
    '2020.01.01 — 长期',
  );
});

test('accepts a complete payload and derives sex and birth date server-side', () => {
  const result = validateSubmissionPayload({
    name: '林安',
    idNumber: '110105199001010010',
    ethnicity: '汉',
    nativePlace: '北京',
    idAddress: '北京市朝阳区示例路 1 号',
    issuingAuthority: '示例市公安局',
    validFrom: dateYearsFromNow(-10),
    validTo: dateYearsFromNow(10),
    isLongTerm: false,
    phone: '13800138000',
    currentCity: '北京',
    occupation: '设计师',
    company: '示例有限公司',
    consent: true,
    website: '',
    startedAt: Date.now() - 5000,
  });
  assert.equal(result.data.sex, '男');
  assert.equal(result.data.birthDate, '1990-01-01');
  assert.deepEqual(result.fieldErrors, {});
});

test('rejects an expired ID card', () => {
  const result = validateSubmissionPayload({
    name: '林安',
    idNumber: '110105199001010010',
    nativePlace: '北京',
    idAddress: '北京市朝阳区示例路 1 号',
    issuingAuthority: '示例市公安局',
    validFrom: '2010-01-01',
    validTo: '2020-01-01',
    isLongTerm: false,
    phone: '13800138000',
    company: '示例有限公司',
    consent: true,
  });
  assert.equal(result.data, null);
  assert.match(result.fieldErrors.validTo, /已过期/);
});

test('rejects an invalid mobile number', () => {
  const result = validateSubmissionPayload({
    name: '林安',
    idNumber: '110105199001010010',
    nativePlace: '北京',
    idAddress: '北京市朝阳区示例路 1 号',
    issuingAuthority: '示例市公安局',
    validFrom: dateYearsFromNow(-5),
    validTo: dateYearsFromNow(5),
    isLongTerm: false,
    phone: '1234',
    company: '示例有限公司',
    consent: true,
  });
  assert.equal(result.data, null);
  assert.match(result.fieldErrors.phone, /手机号/);
});

test('requires an enterprise or organization name', () => {
  const result = validateSubmissionPayload({
    name: '林安',
    idNumber: '110105199001010010',
    nativePlace: '北京',
    idAddress: '北京市朝阳区示例路 1 号',
    issuingAuthority: '示例市公安局',
    validFrom: dateYearsFromNow(-5),
    validTo: dateYearsFromNow(5),
    isLongTerm: false,
    phone: '13800138000',
    consent: true,
  });
  assert.equal(result.data, null);
  assert.match(result.fieldErrors.company, /企业单位/);
});
