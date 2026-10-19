import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecognitionPrompt,
  parseRecognitionContent,
  RecognitionParseError,
} from '../server/recognition-utils.js';

const frontPayload = {
  is_identity_card: true,
  side_matches: true,
  name: '林 安',
  ethnicity: '汉',
  id_number: '999999 19900101 0016',
  address: '示例省示例市安笺路 1 号',
  issuing_authority: '',
  valid_from: '',
  valid_to: '',
  is_long_term: false,
  confidence: 'high',
  notes: '',
};

test('extracts front-side fields from model JSON and derives sex and birth date', () => {
  const result = parseRecognitionContent(JSON.stringify(frontPayload), 'front');
  assert.equal(result.fields.name, '林安');
  assert.equal(result.fields.ethnicity, '汉');
  assert.equal(result.fields.idNumber, '999999199001010016');
  assert.equal(result.fields.idAddress, '示例省示例市安笺路 1 号');
  assert.equal(result.fields.sex, '男');
  assert.equal(result.fields.birthDate, '1990-01-01');
  assert.deepEqual(result.warnings, []);
  assert.equal(result.confidence, 'high');
});

test('accepts JSON wrapped in a Markdown code fence', () => {
  const content = `\`\`\`json\n${JSON.stringify(frontPayload, null, 2)}\n\`\`\``;
  const result = parseRecognitionContent(content, 'front');
  assert.equal(result.fields.idNumber, '999999199001010016');
});

test('normalizes back-side validity dates and long-term cards', () => {
  const content = JSON.stringify({
    is_identity_card: true,
    side_matches: true,
    issuing_authority: '示例市公安局',
    valid_from: '2020年01月01日',
    valid_to: '长期',
    is_long_term: true,
    confidence: 'medium',
    notes: '',
  });
  const result = parseRecognitionContent(content, 'back');
  assert.equal(result.fields.issuingAuthority, '示例市公安局');
  assert.equal(result.fields.validFrom, '2020-01-01');
  assert.equal(result.fields.validTo, null);
  assert.equal(result.fields.isLongTerm, true);
  assert.deepEqual(result.warnings, []);
});

test('splits a full range returned in valid_from', () => {
  const content = JSON.stringify({
    is_identity_card: true,
    side_matches: true,
    issuing_authority: '示例市公安局',
    valid_from: '2020.01.01 - 2040.01.01',
    valid_to: '',
    is_long_term: false,
    confidence: 'high',
  });
  const result = parseRecognitionContent(content, 'back');
  assert.equal(result.fields.validFrom, '2020-01-01');
  assert.equal(result.fields.validTo, '2040-01-01');
  assert.equal(result.fields.isLongTerm, false);
});

test('does not prefill fields when the image is not the requested ID side', () => {
  const content = JSON.stringify({
    ...frontPayload,
    side_matches: false,
  });
  const result = parseRecognitionContent(content, 'front');
  assert.equal(result.fields.name, '');
  assert.equal(result.fields.idNumber, '');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /不一致/);
});

test('keeps an invalid ID candidate and returns a checksum warning', () => {
  const content = JSON.stringify({
    ...frontPayload,
    id_number: '999999199001010017',
  });
  const result = parseRecognitionContent(content, 'front');
  assert.equal(result.fields.idNumber, '999999199001010017');
  assert.match(result.warnings.join(' '), /校验未通过/);
});

test('rejects content without a JSON object', () => {
  assert.throws(
    () => parseRecognitionContent('抱歉，我无法识别这张图片。', 'front'),
    RecognitionParseError,
  );
});

test('builds a side-specific JSON extraction prompt', () => {
  const front = buildRecognitionPrompt('front');
  assert.match(front.system, /JSON/);
  assert.match(front.userText, /人像面/);
  assert.equal(front.system.includes('证件面'), true);

  const back = buildRecognitionPrompt('back');
  assert.match(back.userText, /签发机关面/);
});
