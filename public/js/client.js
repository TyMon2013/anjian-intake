import {
  calculateAge,
  formatDateDot,
  formatDateTime,
  formatValidity,
  inspectIdNumber,
  isMainlandMobile,
  maskIdNumber,
  normalizeIdNumber,
  normalizePhone,
  parseIsoDate,
  todayIso,
} from './idcard.js';

const form = document.querySelector('#intake-form');
const panels = [...document.querySelectorAll('[data-step-panel]')];
const stepNavs = [...document.querySelectorAll('[data-step-nav]')];
const nextButton = document.querySelector('#next-btn');
const nextLabel = document.querySelector('#next-label');
const backButton = document.querySelector('#back-btn');
const actionCaption = document.querySelector('#action-caption');
const formAlert = document.querySelector('#form-alert');
const successView = document.querySelector('#success-view');
const folioStatus = document.querySelector('.folio-stamp-value');
const paperPanel = document.querySelector('.paper-panel');
const liveRegion = document.querySelector('#live-region');
const toast = document.querySelector('#client-toast');
const privacyDialog = document.querySelector('#privacy-dialog');

const sideLabels = { front: '正面', back: '反面' };
const recognitionEndpoint = '/api/recognize';
const maxUploadBytes = 30 * 1024 * 1024;

const state = {
  step: 1,
  startedAt: Date.now(),
  submitting: false,
  submitted: false,
  touched: new Set(),
  autoValues: {},
  images: {
    front: createEmptyImageState(),
    back: createEmptyImageState(),
  },
};

let toastTimer = null;

function createEmptyImageState() {
  return {
    file: null,
    previewUrl: '',
    recognitionState: 'idle',
    processing: false,
    requestId: 0,
    controller: null,
    timeoutId: null,
    warnings: [],
  };
}

const fields = {};
for (const name of [
  'name',
  'ethnicity',
  'idNumber',
  'nativePlace',
  'issuingAuthority',
  'idAddress',
  'validFrom',
  'validTo',
  'isLongTerm',
  'phone',
  'currentCity',
  'occupation',
  'company',
  'consent',
  'recognitionConsent',
]) {
  fields[name] = form.elements.namedItem(name);
}

const derivedEls = {
  sex: document.querySelector('#derived-sex'),
  birth: document.querySelector('#derived-birth'),
  age: document.querySelector('#derived-age'),
};

const reviewEls = {
  name: document.querySelector('#review-name'),
  id: document.querySelector('#review-id'),
  validity: document.querySelector('#review-validity'),
};

const validToWrap = document.querySelector('#validTo-wrap');
const validityMobileValue = document.querySelector('#validity-mobile-value');
const editValidityButton = document.querySelector('#edit-validity-btn');
const validityDialog = document.querySelector('#validity-dialog');
const validityStartInput = document.querySelector('#validity-start');
const validityEndInput = document.querySelector('#validity-end');
const validityEndWrap = document.querySelector('#validity-end-wrap');
const validityLongTermInput = document.querySelector('#validity-long-term');
const validityDialogError = document.querySelector('#validity-dialog-error');
const validityDialogClose = document.querySelector('#validity-dialog-close');
const validityDialogCancel = document.querySelector('#validity-dialog-cancel');
const validityDialogSave = document.querySelector('#validity-dialog-save');
const validityDialogMedia = window.matchMedia('(max-width: 700px), (pointer: coarse)');
let lastScrollAt = 0;

for (const input of form.querySelectorAll('input, textarea')) {
  if (input.closest('.honeypot') || input.type === 'file' || input.type === 'hidden') continue;
  input.addEventListener('input', () => {
    state.touched.add(input.name);
  });
  input.addEventListener('change', () => {
    state.touched.add(input.name);
  });
}

for (const nav of stepNavs) {
  nav.dataset.initialClasses = nav.className;
}

// ---------- Utilities ----------

function showToast(message, duration = 3600) {
  if (!message) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

function hideToast() {
  window.clearTimeout(toastTimer);
  toast.hidden = true;
}

function announce(message) {
  if (!liveRegion) return;
  liveRegion.textContent = '';
  window.setTimeout(() => {
    liveRegion.textContent = message;
  }, 30);
}

function setFormAlert(message) {
  if (!message) {
    formAlert.textContent = '';
    formAlert.hidden = true;
    return;
  }
  formAlert.textContent = message;
  formAlert.hidden = false;
}

function fieldErrorElement(name) {
  return document.querySelector(`[data-field-error="${name}"]`);
}

function focusField(name) {
  const target = fields[name];
  if (!target) return;
  const element = target instanceof RadioNodeList ? target[0] : target;
  if (!element) return;

  if (validityDialogMedia.matches && ['validFrom', 'validTo'].includes(name)) {
    editValidityButton.focus({ preventScroll: true });
    const container = element.closest('.validity-block');
    if (container) {
      window.setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 20);
    }
    return;
  }

  element.focus({ preventScroll: true });
  const container = element.closest('.field, .validity-block, .consent-block, .recognition-consent-block');
  if (container) {
    window.setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'center' }), 20);
  }
}

function setFieldError(name, message) {
  const errorElement = fieldErrorElement(name);
  if (errorElement) errorElement.textContent = message || '';
  const input = fields[name];
  if (input) {
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function clearAllFieldErrors() {
  for (const element of form.querySelectorAll('[data-field-error]')) {
    if (element.matches('[data-side-error]')) continue;
    element.textContent = '';
  }
  for (const input of form.querySelectorAll('[aria-invalid="true"]')) {
    if (input.type !== 'file') input.removeAttribute('aria-invalid');
  }
}

function setSideError(side, message, tone = 'error') {
  const element = document.querySelector(`[data-side-error="${side}"]`);
  if (!element) return;
  element.textContent = message || '';
  element.classList.toggle('is-gentle', tone === 'gentle');
  const uploadButton = document.querySelector(`[data-upload="${side}"]`);
  if (uploadButton) {
    if (tone === 'error' && message) uploadButton.setAttribute('aria-invalid', 'true');
    else uploadButton.removeAttribute('aria-invalid');
  }
}

function setStep(step, { scroll = true } = {}) {
  state.step = step;
  hideToast();
  for (const panel of panels) {
    const isCurrent = Number(panel.dataset.stepPanel) === step;
    panel.hidden = !isCurrent;
    if (isCurrent) {
      panel.classList.remove('is-entering');
      void panel.offsetWidth;
      panel.classList.add('is-entering');
    }
  }

  for (const nav of stepNavs) {
    const navStep = Number(nav.dataset.stepNav);
    nav.classList.toggle('is-active', navStep === step);
    nav.classList.toggle('is-complete', navStep < step);
    if (navStep === step) nav.setAttribute('aria-current', 'step');
    else nav.removeAttribute('aria-current');
  }

  backButton.hidden = step === 1;
  const labels = {
    1: '下一步：核对信息',
    2: '下一步：填写联系方式',
    3: '确认并提交',
  };
  const captions = {
    1: '预计 2 分钟完成',
    2: '请对照证件逐项核对',
    3: '提交后资料将加密归档',
  };
  nextLabel.textContent = labels[step];
  actionCaption.textContent = captions[step];
  setFormAlert('');

  if (scroll && window.innerWidth <= 1020) {
    window.setTimeout(() => {
      paperPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
  }
}

function markSubmittedState() {
  for (const nav of stepNavs) {
    nav.classList.remove('is-active');
    nav.classList.add('is-complete');
    nav.removeAttribute('aria-current');
  }
}

function updateDerivedFields() {
  const info = inspectIdNumber(fields.idNumber.value);
  if (info.valid) {
    derivedEls.sex.textContent = info.sex;
    derivedEls.birth.textContent = formatDateDot(info.birthDate);
    derivedEls.age.textContent = `${calculateAge(info.birthDate)} 岁`;
    for (const element of Object.values(derivedEls)) {
      element.closest('.derived-cell').classList.remove('is-pending');
    }
  } else {
    derivedEls.sex.textContent = '待核对';
    derivedEls.birth.textContent = '待核对';
    derivedEls.age.textContent = '待计算';
    for (const element of Object.values(derivedEls)) {
      element.closest('.derived-cell').classList.add('is-pending');
    }
  }
  updateReview();
}

function updateReview() {
  const name = fields.name.value.trim();
  const id = normalizeIdNumber(fields.idNumber.value);
  const validFrom = fields.validFrom.value;
  const validTo = fields.validTo.value;
  const isLongTerm = fields.isLongTerm.checked;

  reviewEls.name.textContent = name || '待填写';
  reviewEls.id.textContent = id.length === 18 ? maskIdNumber(id) : '待填写';
  reviewEls.validity.textContent =
    validFrom && (isLongTerm || validTo)
      ? formatValidity(validFrom, validTo, isLongTerm)
      : '待填写';
}

function syncLongTermState({ userAction = false } = {}) {
  const isLongTerm = fields.isLongTerm.checked;
  fields.validTo.disabled = isLongTerm;
  validToWrap.classList.toggle('is-disabled', isLongTerm);
  if (isLongTerm) {
    fields.validTo.value = '';
    setFieldError('validTo', '');
  }
  if (userAction) state.touched.add('isLongTerm');
  updateReview();
  updateValiditySummary();
}

function updateValiditySummary() {
  if (!validityMobileValue) return;
  const validFrom = fields.validFrom.value;
  const validTo = fields.validTo.value;
  const isLongTerm = fields.isLongTerm.checked;

  if (!validFrom) {
    validityMobileValue.textContent = '待填写';
    return;
  }
  if (isLongTerm) {
    validityMobileValue.textContent = `${formatDateDot(validFrom)} — 长期`;
    return;
  }
  validityMobileValue.textContent = validTo
    ? formatValidity(validFrom, validTo, false)
    : `${formatDateDot(validFrom)} — 待填写`;
}

function syncValidityDialogState() {
  const isLongTerm = validityLongTermInput.checked;
  validityEndInput.disabled = isLongTerm;
  validityEndWrap.classList.toggle('is-disabled', isLongTerm);
}

function openValidityDialog() {
  if (validityDialog.open) return;
  hideToast();
  validityStartInput.value = fields.validFrom.value;
  validityEndInput.value = fields.validTo.value;
  validityLongTermInput.checked = fields.isLongTerm.checked;
  validityStartInput.max = todayIso();
  validityDialogError.textContent = '';
  syncValidityDialogState();
  validityDialog.showModal();
  document.body.classList.add('is-locked');
}

function closeValidityDialog() {
  if (validityDialog.open) validityDialog.close();
}

function saveValidityDialog() {
  validityDialogError.textContent = '';
  const startValue = validityStartInput.value;
  const endValue = validityEndInput.value;
  const isLongTerm = validityLongTermInput.checked;
  const today = parseIsoDate(todayIso());
  const start = parseIsoDate(startValue);
  const end = parseIsoDate(endValue);

  if (!startValue || !start) {
    validityDialogError.textContent = '请选择证件起始日期。';
    validityStartInput.focus();
    return;
  }
  if (start.getTime() > today.getTime()) {
    validityDialogError.textContent = '证件起始日期不能晚于今天。';
    validityStartInput.focus();
    return;
  }
  if (!isLongTerm) {
    if (!endValue || !end) {
      validityDialogError.textContent = '请选择证件到期日期，或勾选长期有效。';
      validityEndInput.focus();
      return;
    }
    if (end.getTime() < start.getTime()) {
      validityDialogError.textContent = '证件到期日期不能早于起始日期。';
      validityEndInput.focus();
      return;
    }
    if (end.getTime() < today.getTime()) {
      validityDialogError.textContent = '该身份证已过期，请更换有效证件。';
      validityEndInput.focus();
      return;
    }
  }

  fields.validFrom.value = startValue;
  fields.validTo.value = isLongTerm ? '' : endValue;
  fields.isLongTerm.checked = isLongTerm;
  state.touched.add('validFrom');
  state.touched.add('validTo');
  state.touched.add('isLongTerm');
  setFieldError('validFrom', '');
  setFieldError('validTo', '');
  syncLongTermState();
  updateReview();
  updateValiditySummary();
  closeValidityDialog();
}

editValidityButton.addEventListener('click', () => {
  if (Date.now() - lastScrollAt < 550) {
    showToast('请停止滑动后再修改有效期。');
    return;
  }
  openValidityDialog();
});
validityLongTermInput.addEventListener('change', syncValidityDialogState);
validityDialogClose.addEventListener('click', closeValidityDialog);
validityDialogCancel.addEventListener('click', closeValidityDialog);
validityDialogSave.addEventListener('click', saveValidityDialog);
validityDialog.addEventListener('click', (event) => {
  if (event.target !== validityDialog) return;
  const rect = validityDialog.getBoundingClientRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
  if (!inside) closeValidityDialog();
});
validityDialog.addEventListener('close', () => {
  document.body.classList.remove('is-locked');
});

window.addEventListener('scroll', () => {
  lastScrollAt = Date.now();
}, { passive: true });
window.addEventListener('touchmove', () => {
  lastScrollAt = Date.now();
}, { passive: true });

function requireRecognitionConsent() {
  const consent = fields.recognitionConsent;
  if (consent.checked) {
    setFieldError('recognitionConsent', '');
    return true;
  }

  setFieldError('recognitionConsent', '请先确认证件识别授权，再上传身份证照片。');
  showToast('请先确认证件识别授权。');
  announce('请先确认证件识别授权');
  consent.focus({ preventScroll: true });
  const block = consent.closest('.recognition-consent-block');
  if (block) {
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return false;
}

function validateStepOne() {
  if (!requireRecognitionConsent()) return false;

  let valid = true;
  setSideError('front', '');
  setSideError('back', '');

  for (const side of ['front', 'back']) {
    if (!state.images[side].file) {
      setSideError(side, `请上传身份证${sideLabels[side]}照片`);
      valid = false;
    }
  }

  if (!valid) {
    const firstMissing = ['front', 'back'].find((side) => !state.images[side].file);
    const target = firstMissing ? uploadElements(firstMissing).button : null;
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    announce('请先上传身份证正反面照片');
    return false;
  }

  const loadingSide = ['front', 'back'].find(
    (side) => state.images[side].recognitionState === 'loading' || state.images[side].processing,
  );
  if (loadingSide) {
    showToast(`身份证${sideLabels[loadingSide]}正在识别，请稍候片刻。`);
    announce('证件正在识别，请稍候');
    return false;
  }

  return true;
}

function validateFields(names) {
  const errors = {};
  const trim = (name) => String(fields[name].value || '').trim();

  if (names.includes('name')) {
    if (trim('name').length < 2) {
      errors.name = '请填写与证件一致的完整姓名';
    } else if (!/^[\u3400-\u9fff·A-Za-z.\s]+$/.test(trim('name'))) {
      errors.name = '姓名包含不支持的字符';
    }
  }

  if (names.includes('idNumber')) {
    const info = inspectIdNumber(fields.idNumber.value);
    if (!info.valid) errors.idNumber = info.reason;
  }

  if (names.includes('nativePlace') && trim('nativePlace').length < 2) {
    errors.nativePlace = '请填写籍贯，例如：浙江杭州';
  }

  if (names.includes('issuingAuthority') && trim('issuingAuthority').length < 2) {
    errors.issuingAuthority = '请填写证件上的签发机关';
  }

  if (names.includes('idAddress') && trim('idAddress').length < 5) {
    errors.idAddress = '请填写证件上的完整住址';
  }

  if (names.includes('validFrom') || names.includes('validTo')) {
    const today = parseIsoDate(todayIso());
    const start = parseIsoDate(fields.validFrom.value);
    const isLongTerm = fields.isLongTerm.checked;
    const end = parseIsoDate(fields.validTo.value);

    if (!fields.validFrom.value) {
      errors.validFrom = '请选择证件起始日期';
    } else if (!start) {
      errors.validFrom = '证件起始日期无效';
    } else if (start.getTime() > today.getTime()) {
      errors.validFrom = '证件起始日期不能晚于今天';
    }

    if (!isLongTerm) {
      if (!fields.validTo.value) {
        errors.validTo = '请选择证件到期日期，或勾选长期有效';
      } else if (!end) {
        errors.validTo = '证件到期日期无效';
      } else if (start && end.getTime() < start.getTime()) {
        errors.validTo = '到期日期不能早于起始日期';
      } else if (end.getTime() < today.getTime()) {
        errors.validTo = '该身份证已过期，请更换有效证件';
      }
    }
  }

  if (names.includes('phone')) {
    const phone = normalizePhone(fields.phone.value);
    if (!isMainlandMobile(phone)) {
      errors.phone = '请填写正确的 11 位本人实名手机号';
    }
  }

  if (names.includes('company') && trim('company').length < 2) {
    errors.company = '请填写企业单位名称';
  }

  if (names.includes('consent') && !fields.consent.checked) {
    errors.consent = '请阅读并同意个人信息授权说明';
  }

  for (const name of names) {
    setFieldError(name, errors[name] || '');
  }

  return errors;
}

function validateStepTwo() {
  const errors = validateFields([
    'name',
    'idNumber',
    'nativePlace',
    'issuingAuthority',
    'idAddress',
    'validFrom',
    'validTo',
  ]);
  const firstError = [
    'name',
    'idNumber',
    'nativePlace',
    'issuingAuthority',
    'idAddress',
    'validFrom',
    'validTo',
  ].find((name) => errors[name]);
  if (firstError) {
    setFormAlert('请完善标记的信息后再继续。');
    focusField(firstError);
    announce('请检查表单中的必填信息');
    return false;
  }
  return true;
}

function validateStepThree() {
  const errors = validateFields(['phone', 'company', 'consent']);
  const firstError = ['phone', 'company', 'consent'].find((name) => errors[name]);
  if (firstError) {
    setFormAlert('请完善联系方式、企业单位并确认授权说明。');
    focusField(firstError);
    announce('请检查手机号、企业单位与授权确认');
    return false;
  }
  return true;
}

function goNext() {
  if (state.submitting) return;
  if (state.step === 1) {
    if (!validateStepOne()) return;
    setStep(2);
    updateDerivedFields();
    updateReview();
    return;
  }

  if (state.step === 2) {
    if (!validateStepTwo()) return;
    setStep(3);
    updateDerivedFields();
    updateReview();
    return;
  }

  submitIntake();
}

function goBack() {
  if (state.submitting) return;
  if (state.step > 1) setStep(state.step - 1);
}

// ---------- Upload + recognition ----------

function uploadElements(side) {
  const slot = document.querySelector(`.upload-slot[data-side="${side}"]`);
  return {
    slot,
    button: slot.querySelector('[data-upload]'),
    empty: slot.querySelector('.upload-empty'),
    preview: slot.querySelector('.upload-preview'),
    previewImage: slot.querySelector(`#${side}-preview`),
    scan: slot.querySelector('.scan-layer'),
    badge: slot.querySelector('[data-recognition-badge]'),
    status: slot.querySelector('[data-upload-state]'),
    actions: slot.querySelector('[data-upload-actions]'),
    input: document.querySelector(`#${side}-input`),
  };
}

function renderUploadSide(side) {
  const imageState = state.images[side];
  const ui = uploadElements(side);
  const hasFile = Boolean(imageState.file);

  ui.button.classList.toggle('has-image', hasFile);
  ui.button.setAttribute('aria-busy', String(imageState.processing || imageState.recognitionState === 'loading'));
  ui.button.disabled = imageState.processing;
  ui.empty.hidden = hasFile;
  ui.preview.hidden = !hasFile;
  ui.actions.hidden = !hasFile;
  ui.scan.hidden = imageState.recognitionState !== 'loading';
  ui.badge.hidden = !['success', 'error'].includes(imageState.recognitionState);

  if (hasFile) {
    ui.button.setAttribute('aria-label', `更换身份证${sideLabels[side]}照片`);
  } else {
    ui.button.setAttribute('aria-label', `上传身份证${sideLabels[side]}照片`);
  }

  if (imageState.previewUrl) {
    ui.previewImage.src = imageState.previewUrl;
  } else {
    ui.previewImage.removeAttribute('src');
  }

  ui.status.classList.remove('is-busy', 'is-success', 'is-error');
  if (imageState.processing) {
    ui.status.textContent = '正在处理照片';
    ui.status.classList.add('is-busy');
  } else if (imageState.recognitionState === 'loading') {
    ui.status.textContent = '识别中 · 请稍候';
    ui.status.classList.add('is-busy');
  } else if (imageState.recognitionState === 'success') {
    ui.status.textContent = imageState.warnings.length ? '识别完成 · 有待核对信息' : '识别完成 · 请核对';
    ui.status.classList.add('is-success');
  } else if (imageState.recognitionState === 'error') {
    ui.status.textContent = '需手动填写';
    ui.status.classList.add('is-error');
  } else if (hasFile) {
    ui.status.textContent = '照片已就绪';
  } else {
    ui.status.textContent = '待上传';
  }

  for (const actionButton of ui.actions.querySelectorAll('button')) {
    actionButton.disabled = imageState.processing;
  }

  ui.badge.classList.remove('is-error', 'is-neutral');
  if (imageState.recognitionState === 'success') {
    ui.badge.textContent = imageState.warnings.length ? '识别完成 · 待核对' : '自动识别完成';
    if (imageState.warnings.length) ui.badge.classList.add('is-neutral');
  } else if (imageState.recognitionState === 'error') {
    ui.badge.textContent = '需手动填写';
    ui.badge.classList.add('is-error');
  }
}

function abortRecognition(side) {
  const imageState = state.images[side];
  imageState.requestId += 1;
  window.clearTimeout(imageState.timeoutId);
  imageState.timeoutId = null;
  if (imageState.controller) {
    imageState.controller.abort();
    imageState.controller = null;
  }
}

function resetUploadSide(side) {
  const imageState = state.images[side];
  abortRecognition(side);
  if (imageState.previewUrl) URL.revokeObjectURL(imageState.previewUrl);
  state.images[side] = createEmptyImageState();
  state.images[side].requestId = imageState.requestId;
  const ui = uploadElements(side);
  ui.previewImage.removeAttribute('src');
  ui.input.value = '';
  setSideError(side, '');
  renderUploadSide(side);
}

function openFilePicker(side) {
  if (state.submitting) return;
  if (!requireRecognitionConsent()) return;
  const ui = uploadElements(side);
  if (ui.button.disabled) return;
  ui.input.click();
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to the HTMLImageElement decoder.
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片无法读取'));
    };
    image.src = url;
  });
}

async function compressImage(file) {
  if (!file) throw new Error('请选择图片');
  if (file.size > maxUploadBytes) {
    throw new Error('原始图片不能超过 30MB，请重新拍摄或选择');
  }
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }

  const source = await decodeImage(file);
  const width = source.width;
  const height = source.height;
  if (Math.max(width, height) < 600 || Math.min(width, height) < 240) {
    if (typeof source.close === 'function') source.close();
    throw new Error('图片分辨率过低，请上传清晰完整的身份证照片');
  }

  const maxEdge = 1800;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  if (typeof source.close === 'function') source.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error('图片处理失败，请更换图片重试'));
      },
      'image/jpeg',
      0.9,
    );
  });

  if (blob.size > 8 * 1024 * 1024) {
    throw new Error('照片体积过大，请重新选择图片');
  }

  return new File([blob], `${Date.now()}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

async function handleSelectedFile(side, file) {
  if (!file || state.images[side].processing) return;
  if (!requireRecognitionConsent()) return;
  const previousState = state.images[side];
  previousState.processing = true;
  setSideError(side, '');
  renderUploadSide(side);

  let compressed;
  try {
    compressed = await compressImage(file);
  } catch (error) {
    previousState.processing = false;
    renderUploadSide(side);
    const message = error.message?.includes('无法读取')
      ? '浏览器无法读取该图片，请重试或将其转换为 JPG 后上传'
      : error.message || '图片处理失败，请重新选择';
    setSideError(side, message);
    showToast(message);
    return;
  }

  abortRecognition(side);
  if (previousState.previewUrl) URL.revokeObjectURL(previousState.previewUrl);
  const requestId = previousState.requestId;
  state.images[side] = {
    ...createEmptyImageState(),
    file: compressed,
    previewUrl: URL.createObjectURL(compressed),
    recognitionState: 'loading',
    requestId,
  };
  renderUploadSide(side);
  announce(`身份证${sideLabels[side]}照片已上传，正在识别`);
  await runRecognition(side);
}

async function runRecognition(side) {
  const imageState = state.images[side];
  if (!imageState.file) return;
  const requestId = imageState.requestId;
  const controller = new AbortController();
  imageState.controller = controller;
  imageState.timeoutId = window.setTimeout(() => {
    controller.abort();
  }, 90_000);

  const body = new FormData();
  body.append('side', side);
  body.append('recognitionConsent', 'true');
  body.append('image', imageState.file, `${side}.jpg`);

  try {
    const response = await fetch(recognitionEndpoint, {
      method: 'POST',
      body,
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      throw new Error(data?.error || '自动识别暂时不可用');
    }
    if (state.images[side].requestId !== requestId) return;

    const returnedFields = data.fields || {};
    const hasAnyField = Object.values(returnedFields).some((value) => {
      return value !== '' && value !== null && value !== undefined && value !== false;
    });
    imageState.warnings = Array.isArray(data.warnings) ? data.warnings : [];

    if (!hasAnyField) {
      imageState.recognitionState = 'error';
      imageState.warnings = imageState.warnings.length
        ? imageState.warnings
        : ['未读取到可用信息，请手动填写'];
      setSideError(
        side,
        '未能自动读取证件信息，请在第 2 步手动填写。若照片模糊，可更换清晰照片重试。',
      );
      announce(`身份证${sideLabels[side]}未能识别，可手动填写`);
    } else {
      imageState.recognitionState = 'success';
      applyRecognitionFields(side, returnedFields);
      if (imageState.warnings.length > 0) {
        setSideError(side, imageState.warnings.join('；'), 'gentle');
      } else {
        setSideError(side, '');
      }
      const filledCount = Object.entries(returnedFields).filter(([, value]) => Boolean(value)).length;
      announce(`身份证${sideLabels[side]}识别完成，读取到 ${filledCount} 项信息，请在下一步核对`);
    }
    imageState.controller = null;
    window.clearTimeout(imageState.timeoutId);
    imageState.timeoutId = null;
    renderUploadSide(side);
  } catch (error) {
    if (state.images[side].requestId !== requestId) return;
    imageState.recognitionState = 'error';
    imageState.controller = null;
    window.clearTimeout(imageState.timeoutId);
    imageState.timeoutId = null;
    const isTimeout = error.name === 'AbortError';
    let failureMessage;
    if (isTimeout) {
      failureMessage = '识别等待超时，请在下一步手动核对或补充信息。';
    } else if (error instanceof TypeError) {
      failureMessage = '网络连接异常，自动识别未完成，可在下一步手动填写。';
    } else {
      failureMessage = error.message || '自动识别未完成，可在下一步手动填写。';
      if (!/[。！？]$/.test(failureMessage)) failureMessage += '。';
      if (!/手动|重试/.test(failureMessage)) failureMessage += ' 您可在下一步手动填写。';
    }
    setSideError(side, failureMessage);
    announce(`身份证${sideLabels[side]}自动识别未完成，可手动填写`);
    renderUploadSide(side);
  }
}

function applyRecognitionFields(side, incoming) {
  const frontFieldMap = {
    name: 'name',
    ethnicity: 'ethnicity',
    idNumber: 'idNumber',
    idAddress: 'idAddress',
  };
  const backFieldMap = {
    issuingAuthority: 'issuingAuthority',
    validFrom: 'validFrom',
    validTo: 'validTo',
  };
  const mapping = side === 'front' ? frontFieldMap : backFieldMap;
  let filledAny = false;

  for (const [sourceKey, fieldName] of Object.entries(mapping)) {
    const value = incoming[sourceKey];
    if (!value || state.touched.has(fieldName)) continue;
    const currentValue = fields[fieldName].value;
    if (
      currentValue &&
      currentValue !== state.autoValues[fieldName] &&
      state.autoValues[fieldName] !== undefined
    ) {
      continue;
    }
    if (fieldName === 'idNumber') {
      fields[fieldName].value = normalizeIdNumber(value).slice(0, 18);
    } else {
      fields[fieldName].value = String(value);
    }
    state.autoValues[fieldName] = fields[fieldName].value;
    const wrapper = fields[fieldName].closest('.field');
    if (wrapper) {
      wrapper.classList.remove('just-filled');
      void wrapper.offsetWidth;
      wrapper.classList.add('just-filled');
      window.setTimeout(() => wrapper.classList.remove('just-filled'), 1200);
    }
    filledAny = true;
  }

  if (side === 'back') {
    if (!state.touched.has('isLongTerm') && typeof incoming.isLongTerm === 'boolean') {
      fields.isLongTerm.checked = incoming.isLongTerm;
      state.autoValues.isLongTerm = incoming.isLongTerm;
    }
    syncLongTermState();
    if (
      !state.touched.has('validTo') &&
      !fields.isLongTerm.checked &&
      !fields.validTo.value &&
      incoming.validTo
    ) {
      fields.validTo.value = incoming.validTo;
      state.autoValues.validTo = incoming.validTo;
      filledAny = true;
    }
  }

  updateDerivedFields();
  updateReview();
  if (filledAny) {
    showToast('自动识别结果已填入，请在第 2 步逐项核对。');
  }
}

// ---------- Form events ----------

for (const side of ['front', 'back']) {
  const ui = uploadElements(side);
  ui.button.addEventListener('click', () => openFilePicker(side));
  ui.input.addEventListener('change', () => {
    const [file] = ui.input.files || [];
    ui.input.value = '';
    if (file) handleSelectedFile(side, file);
  });
  ui.slot.querySelector('[data-replace]').addEventListener('click', (event) => {
    event.stopPropagation();
    openFilePicker(side);
  });
  ui.slot.querySelector('[data-remove]').addEventListener('click', (event) => {
    event.stopPropagation();
    resetUploadSide(side);
  });

  for (const eventName of ['dragenter', 'dragover']) {
    ui.slot.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (!state.submitting) ui.button.classList.add('is-dragover');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    ui.slot.addEventListener(eventName, (event) => {
      event.preventDefault();
      ui.button.classList.remove('is-dragover');
    });
  }
  ui.slot.addEventListener('drop', (event) => {
    if (state.submitting || state.images[side].processing) return;
    const [file] = event.dataTransfer?.files || [];
    if (file) handleSelectedFile(side, file);
  });
}

fields.idNumber.addEventListener('input', () => {
  const cleaned = normalizeIdNumber(fields.idNumber.value).replace(/[^0-9X]/g, '').slice(0, 18);
  if (fields.idNumber.value !== cleaned) fields.idNumber.value = cleaned;
  setFieldError('idNumber', '');
  updateDerivedFields();
});

fields.phone.addEventListener('input', () => {
  const cleaned = normalizePhone(fields.phone.value);
  if (fields.phone.value !== cleaned) fields.phone.value = cleaned;
  setFieldError('phone', '');
});

fields.name.addEventListener('input', updateReview);
fields.validFrom.addEventListener('change', () => {
  setFieldError('validFrom', '');
  if (!fields.isLongTerm.checked) setFieldError('validTo', '');
  updateReview();
  updateValiditySummary();
});
fields.validTo.addEventListener('change', () => {
  setFieldError('validTo', '');
  updateReview();
  updateValiditySummary();
});
fields.isLongTerm.addEventListener('change', () => {
  syncLongTermState({ userAction: true });
});
fields.company.addEventListener('input', () => setFieldError('company', ''));
fields.consent.addEventListener('change', () => setFieldError('consent', ''));
fields.recognitionConsent.addEventListener('change', () => {
  setFieldError('recognitionConsent', '');
  setFormAlert('');
});

fields.idNumber.addEventListener('blur', () => {
  if (!fields.idNumber.value) return;
  const info = inspectIdNumber(fields.idNumber.value);
  setFieldError('idNumber', info.valid ? '' : info.reason);
});

fields.phone.addEventListener('blur', () => {
  if (!fields.phone.value) return;
  if (!isMainlandMobile(fields.phone.value)) {
    setFieldError('phone', '请填写正确的 11 位本人实名手机号');
  }
});

for (const name of ['name', 'nativePlace', 'issuingAuthority', 'idAddress']) {
  fields[name].addEventListener('input', () => setFieldError(name, ''));
}
for (const name of ['ethnicity', 'currentCity', 'occupation']) {
  fields[name].addEventListener('input', () => setFieldError(name, ''));
}

nextButton.addEventListener('click', goNext);
backButton.addEventListener('click', goBack);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  goNext();
});

form.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (event.target instanceof HTMLTextAreaElement) return;
  if (event.target instanceof HTMLButtonElement) return;
  event.preventDefault();
  goNext();
});

// ---------- Submit ----------

function collectPayload() {
  return {
    name: fields.name.value.trim(),
    idNumber: normalizeIdNumber(fields.idNumber.value),
    ethnicity: fields.ethnicity.value.trim(),
    nativePlace: fields.nativePlace.value.trim(),
    idAddress: fields.idAddress.value.trim(),
    issuingAuthority: fields.issuingAuthority.value.trim(),
    validFrom: fields.validFrom.value,
    validTo: fields.isLongTerm.checked ? null : fields.validTo.value,
    isLongTerm: fields.isLongTerm.checked,
    phone: normalizePhone(fields.phone.value),
    currentCity: fields.currentCity.value.trim(),
    occupation: fields.occupation.value.trim(),
    company: fields.company.value.trim(),
    consent: fields.consent.checked,
    website: document.querySelector('#field-website').value,
    startedAt: state.startedAt,
  };
}

function setSubmitting(isSubmitting) {
  state.submitting = isSubmitting;
  nextButton.disabled = isSubmitting;
  backButton.disabled = isSubmitting;
  nextButton.classList.toggle('is-loading', isSubmitting);
  if (isSubmitting) {
    nextLabel.textContent = '正在加密提交';
    actionCaption.textContent = '请勿关闭当前页面';
    setFormAlert('');
  } else {
    const captions = {
      1: '预计 2 分钟完成',
      2: '请对照证件逐项核对',
      3: '提交后资料将加密归档',
    };
    const labels = {
      1: '下一步：核对信息',
      2: '下一步：填写联系方式',
      3: '确认并提交',
    };
    nextLabel.textContent = labels[state.step];
    actionCaption.textContent = captions[state.step];
  }
}

async function submitIntake() {
  if (state.submitting || state.submitted) return;

  if (!state.images.front.file || !state.images.back.file) {
    setStep(1);
    validateStepOne();
    return;
  }

  if (!validateStepTwo()) {
    setStep(2);
    validateStepTwo();
    return;
  }
  if (!validateStepThree()) return;

  const summary = {
    name: fields.name.value.trim(),
    idNumber: normalizeIdNumber(fields.idNumber.value),
  };

  const body = new FormData();
  body.append('front', state.images.front.file, 'front.jpg');
  body.append('back', state.images.back.file, 'back.jpg');
  body.append('payload', JSON.stringify(collectPayload()));

  setSubmitting(true);
  hideToast();
  announce('正在安全提交您的信息');

  try {
    const response = await fetch('/api/submissions', {
      method: 'POST',
      body,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      if (response.status === 422 && data?.fieldErrors) {
        const stepTwoFields = [
          'name',
          'idNumber',
          'nativePlace',
          'issuingAuthority',
          'idAddress',
          'validFrom',
          'validTo',
        ];
        const hasStepTwoErrors = stepTwoFields.some((name) => data.fieldErrors[name]);
        for (const [name, message] of Object.entries(data.fieldErrors)) {
          if (fieldErrorElement(name)) setFieldError(name, message);
        }
        const firstMessage = Object.values(data.fieldErrors)[0] || '请检查表单信息';
        if (hasStepTwoErrors) setStep(2);
        setFormAlert(firstMessage);
        const firstField = Object.keys(data.fieldErrors).find((name) => fieldErrorElement(name));
        if (firstField) focusField(firstField);
        showToast('部分信息需要修正，请检查标记项。');
        return;
      }

      if (response.status === 429) {
        const wait = data?.retryAfter ? `请约 ${Math.ceil(data.retryAfter / 60)} 分钟后再试。` : '';
        setFormAlert(data?.error || '提交过于频繁，请稍后再试。');
        showToast(`${data?.error || '提交过于频繁'} ${wait}`.trim());
        return;
      }

      setFormAlert(data?.error || '提交未完成，请稍后重试。');
      showToast(data?.error || '提交未完成，请稍后重试。');
      return;
    }

    finishSubmission({
      receipt: data.receipt,
      submittedAt: data.submittedAt,
      name: summary.name,
      idNumber: summary.idNumber,
    });
  } catch {
    setFormAlert('网络连接异常，信息尚未提交。请检查网络后重试。');
    showToast('网络连接异常，信息尚未提交。');
  } finally {
    if (!state.submitted) setSubmitting(false);
  }
}

function finishSubmission(result) {
  state.submitted = true;
  hideToast();
  setSubmitting(false);
  nextButton.disabled = true;
  backButton.disabled = true;

  document.querySelector('#receipt-code').textContent = result.receipt || '—';
  document.querySelector('#success-time').textContent = formatDateTime(result.submittedAt) || '—';
  document.querySelector('#success-name').textContent = result.name || '—';
  document.querySelector('#success-id').textContent = maskIdNumber(result.idNumber) || '—';
  folioStatus.textContent = '已归档';

  form.hidden = true;
  setFormAlert('');
  successView.hidden = false;
  markSubmittedState();

  for (const side of ['front', 'back']) {
    abortRecognition(side);
    if (state.images[side].previewUrl) URL.revokeObjectURL(state.images[side].previewUrl);
    const image = document.querySelector(`#${side}-preview`);
    image.removeAttribute('src');
    state.images[side] = createEmptyImageState();
  }

  form.reset();
  updateDerivedFields();
  syncLongTermState();
  clearAllFieldErrors();
  window.removeEventListener('beforeunload', handleBeforeUnload);
  document.title = '提交成功 · 安笺投保信息采集';

  successView.setAttribute('tabindex', '-1');
  successView.focus({ preventScroll: true });
  paperPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Privacy dialog ----------

function openPrivacyDialog() {
  if (!privacyDialog) return;
  if (typeof privacyDialog.showModal === 'function') {
    privacyDialog.showModal();
    document.body.classList.add('is-locked');
  } else {
    privacyDialog.setAttribute('open', '');
  }
}

function closePrivacyDialog() {
  if (!privacyDialog.open) return;
  privacyDialog.close();
}

for (const button of document.querySelectorAll('.js-open-privacy')) {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPrivacyDialog();
  });
}
for (const button of document.querySelectorAll('.js-close-privacy')) {
  button.addEventListener('click', closePrivacyDialog);
}
if (privacyDialog) {
  privacyDialog.addEventListener('click', (event) => {
    if (event.target !== privacyDialog) return;
    const rect = privacyDialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) closePrivacyDialog();
  });
  privacyDialog.addEventListener('close', () => {
    document.body.classList.remove('is-locked');
  });
}

// ---------- Page lifecycle ----------

function handleBeforeUnload(event) {
  if (state.submitted || state.submitting) return;
  const hasImage = Boolean(state.images.front.file || state.images.back.file);
  const hasFieldContent = [...form.elements].some((element) => {
    if (!element.name || ['website', 'consent', 'recognitionConsent'].includes(element.name)) return false;
    if (element.type === 'checkbox') return element.checked;
    return Boolean(String(element.value || '').trim());
  });
  if (!hasImage && !hasFieldContent) return;
  event.preventDefault();
  event.returnValue = '';
}

window.addEventListener('beforeunload', handleBeforeUnload);

window.addEventListener('online', () => {
  setFormAlert('');
});

window.addEventListener('offline', () => {
  showToast('当前网络已断开，提交前请恢复网络连接。', 5000);
});

updateDerivedFields();
updateReview();
syncLongTermState();
updateValiditySummary();
renderUploadSide('front');
renderUploadSide('back');
setStep(1, { scroll: false });
