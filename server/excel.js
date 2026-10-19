import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { calculateAge, formatValidity } from '../public/js/idcard.js';
import { readStoredImage } from './media.js';

const INK = '1F1E1B';
const PAPER = 'F4F0E7';
const LINE = 'D9D1C2';
const ACCENT = 'A9442E';

function formatDateTime(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/\//g, '-');
}

async function imageForExcel(relativePath) {
  const buffer = await readStoredImage(relativePath);
  return sharp(buffer)
    .resize({ width: 640, height: 420, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84 })
    .toBuffer();
}

export async function buildSubmissionsWorkbook(documents, filters = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '安笺投保信息采集';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = '投保客户信息汇总';
  workbook.description = '含身份证影像的客户信息汇总表，仅限授权业务使用。';

  const sheet = workbook.addWorksheet('客户信息', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  sheet.columns = [
    { key: 'index', width: 6 },
    { key: 'receipt', width: 18 },
    { key: 'name', width: 12 },
    { key: 'idNumber', width: 22 },
    { key: 'sex', width: 7 },
    { key: 'age', width: 7 },
    { key: 'birthDate', width: 12 },
    { key: 'nativePlace', width: 14 },
    { key: 'ethnicity', width: 8 },
    { key: 'phone', width: 15 },
    { key: 'currentCity', width: 14 },
    { key: 'occupation', width: 14 },
    { key: 'idAddress', width: 38 },
    { key: 'issuingAuthority', width: 28 },
    { key: 'validity', width: 24 },
    { key: 'company', width: 30 },
    { key: 'createdAt', width: 20 },
    { key: 'front', width: 22 },
    { key: 'back', width: 22 },
  ];

  sheet.mergeCells(1, 1, 1, 19);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = '安笺 · 投保客户信息汇总';
  titleCell.font = { name: 'Microsoft YaHei', size: 18, bold: true, color: { argb: INK } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } };
  sheet.getRow(1).height = 38;

  sheet.mergeCells(2, 1, 2, 19);
  const filterBits = [];
  if (filters.q) filterBits.push(`个人信息：${filters.q}`);
  if (filters.company) filterBits.push(`企业单位：${filters.company}`);
  if (filters.from) filterBits.push(`起始：${filters.from}`);
  if (filters.to) filterBits.push(`截止：${filters.to}`);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = `导出时间 ${formatDateTime(new Date())}　·　共 ${documents.length} 条　·　${filterBits.join('　·　') || '全部记录'}`;
  subtitleCell.font = { name: 'Microsoft YaHei', size: 9, color: { argb: '6F685C' } };
  subtitleCell.alignment = { vertical: 'middle' };
  subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } };
  sheet.getRow(2).height = 24;

  const headers = [
    '序号',
    '回执编号',
    '姓名',
    '身份证号码',
    '性别',
    '年龄',
    '出生日期',
    '籍贯',
    '民族',
    '手机号',
    '现居城市',
    '职业',
    '身份证住址',
    '签发机关',
    '证件有效期',
    '企业单位',
    '提交时间',
    '身份证正面',
    '身份证反面',
  ];
  sheet.getRow(3).values = headers;
  const headerRow = sheet.getRow(3);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: ACCENT } } };
  });

  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    const rowNumber = index + 4;
    const row = sheet.getRow(rowNumber);
    row.values = [
      index + 1,
      document.receipt,
      document.name,
      document.idNumber,
      document.sex,
      calculateAge(document.birthDate),
      document.birthDate,
      document.nativePlace,
      document.ethnicity || '',
      document.phone,
      document.currentCity || '',
      document.occupation || '',
      document.idAddress,
      document.issuingAuthority,
      formatValidity(document.validFrom, document.validTo, document.isLongTerm),
      document.company,
      formatDateTime(new Date(document.createdAt)),
      '',
      '',
    ];
    row.height = 96;

    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: 'Microsoft YaHei', size: 9, color: { argb: INK } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: [1, 5, 6, 9, 17].includes(columnNumber) ? 'center' : 'left',
        wrapText: [13, 14, 16].includes(columnNumber),
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: index % 2 === 0 ? 'FFFFFF' : 'FBF8F2' },
      };
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
    });

    row.getCell(4).numFmt = '@';
    row.getCell(10).numFmt = '@';
    sheet.getCell(rowNumber, 4).font = {
      name: 'Consolas',
      size: 9,
      color: { argb: INK },
    };
    sheet.getCell(rowNumber, 10).font = {
      name: 'Consolas',
      size: 9,
      color: { argb: INK },
    };
    sheet.getCell(rowNumber, 15).font = {
      name: 'Microsoft YaHei',
      size: 9,
      color: { argb: document.isLongTerm ? ACCENT : INK },
      bold: Boolean(document.isLongTerm),
    };

    const [frontBuffer, backBuffer] = await Promise.all([
      imageForExcel(document.frontImagePath),
      imageForExcel(document.backImagePath),
    ]);

    const frontImageId = workbook.addImage({ buffer: frontBuffer, extension: 'jpeg' });
    const backImageId = workbook.addImage({ buffer: backBuffer, extension: 'jpeg' });
    const offset = { width: 148, height: 91 };
    sheet.addImage(frontImageId, {
      tl: { col: 17.08, row: rowNumber - 1 + 0.08 },
      ext: offset,
      editAs: 'oneCell',
    });
    sheet.addImage(backImageId, {
      tl: { col: 18.08, row: rowNumber - 1 + 0.08 },
      ext: offset,
      editAs: 'oneCell',
    });
  }

  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: Math.max(3, documents.length + 3), column: 19 },
  };

  const noteRow = sheet.getRow(documents.length + 5);
  sheet.mergeCells(noteRow.number, 1, noteRow.number, 19);
  const noteCell = sheet.getCell(noteRow.number, 1);
  noteCell.value = '保密提示：本表包含身份证影像等敏感个人信息，仅限用于已获授权的保险咨询与投保业务，禁止转发或另作他用。';
  noteCell.font = { name: 'Microsoft YaHei', size: 9, color: { argb: ACCENT } };
  noteCell.alignment = { vertical: 'middle', horizontal: 'left' };
  noteRow.height = 24;

  sheet.printTitles = { rows: '1:3' };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
