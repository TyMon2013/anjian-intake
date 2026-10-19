import {
  formatDateDot,
  formatDateTime,
  formatValidity,
  todayIso,
} from './idcard.js';

const bootView = document.querySelector('#boot-view');
const loginView = document.querySelector('#login-view');
const adminView = document.querySelector('#admin-view');
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const loginSubmit = document.querySelector('#login-submit');
const usernameInput = document.querySelector('#login-username');
const passwordInput = document.querySelector('#login-password');
const passwordToggle = document.querySelector('#password-toggle');
const logoutButton = document.querySelector('#logout-button');
const adminUsername = document.querySelector('#admin-username');
const todayLabel = document.querySelector('#today-label');
const navCount = document.querySelector('#nav-count');

const filterForm = document.querySelector('#filter-form');
const filterQuery = document.querySelector('#filter-query');
const filterCompany = document.querySelector('#filter-company');
const filterFrom = document.querySelector('#filter-from');
const filterTo = document.querySelector('#filter-to');
const resetFiltersButton = document.querySelector('#reset-filters');
const searchButton = document.querySelector('#search-button');
const filterSummary = document.querySelector('#filter-summary');
const filterSummaryText = document.querySelector('#filter-summary-text');
const clearSearchButton = document.querySelector('#clear-search');
const exportButton = document.querySelector('#export-button');
const exportLabel = exportButton.querySelector('span');

const listLoading = document.querySelector('#list-loading');
const tableWrap = document.querySelector('#table-wrap');
const recordsBody = document.querySelector('#records-body');
const recordCards = document.querySelector('#record-cards');
const emptyState = document.querySelector('#empty-state');
const emptyTitle = emptyState.querySelector('h3');
const emptyDescription = document.querySelector('#empty-description');
const emptyResetButton = document.querySelector('#empty-reset');
const archiveResult = document.querySelector('#archive-result');
const sheetCount = document.querySelector('#sheet-count');
const pagination = document.querySelector('#pagination');
const paginationInfo = document.querySelector('#pagination-info');
const pageNumber = document.querySelector('#page-number');
const prevPageButton = document.querySelector('#prev-page');
const nextPageButton = document.querySelector('#next-page');

const statTotal = document.querySelector('#stat-total');
const statToday = document.querySelector('#stat-today');
const statCompanies = document.querySelector('#stat-companies');

const drawer = document.querySelector('#detail-drawer');
const drawerBackdrop = document.querySelector('#drawer-backdrop');
const drawerClose = document.querySelector('#drawer-close');
const detailTitle = document.querySelector('#detail-title');
const drawerScroll = document.querySelector('#drawer-scroll');
const detailLoading = document.querySelector('#detail-loading');
const detailContent = document.querySelector('#detail-content');

const imageViewer = document.querySelector('#image-viewer');
const viewerImage = document.querySelector('#viewer-image');
const viewerTitle = document.querySelector('#viewer-title');
const viewerDownload = document.querySelector('#viewer-download');
const viewerClose = document.querySelector('#viewer-close');

const deleteDialog = document.querySelector('#delete-dialog');
const deleteTarget = document.querySelector('#delete-target');
const deleteCancel = document.querySelector('#delete-cancel');
const deleteConfirm = document.querySelector('#delete-confirm');
const toast = document.querySelector('#admin-toast');

const state = {
  authenticated: false,
  admin: null,
  loading: false,
  listAbort: null,
  appliedFilters: {},
  items: [],
  filteredTotal: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  exportLoading: false,
  currentDetail: null,
  detailRequestId: 0,
  deleteId: '',
  lastFocus: null,
  viewerLastFocus: null,
  toastTimer: null,
};

class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// ---------- Helpers ----------

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[character];
  });
}

function displayValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  return escapeHtml(value);
}

function showToast(message, duration = 3800) {
  if (!message) return;
  window.clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

function syncBodyLock() {
  const locked = !drawer.hidden || !imageViewer.hidden || deleteDialog.open;
  document.body.classList.toggle('is-locked', locked);
}

function setTodayLabels() {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(now);
  if (todayLabel) todayLabel.textContent = formatted;
  if (filterFrom) filterFrom.max = todayIso(now);
  if (filterTo) filterTo.max = todayIso(now);
}

function setLoginError(message) {
  loginError.textContent = message || '';
  loginError.hidden = !message;
}

function clearSensitiveDom() {
  recordsBody.replaceChildren();
  recordCards.replaceChildren();
  detailContent.replaceChildren();
  detailTitle.textContent = '客户档案';
  deleteTarget.textContent = '';
  state.items = [];
  state.currentDetail = null;
  state.filteredTotal = 0;
}

function closeImageViewer({ restoreFocus = true } = {}) {
  if (imageViewer.hidden) return;
  const previousFocus = state.viewerLastFocus;
  imageViewer.hidden = true;
  viewerImage.removeAttribute('src');
  viewerDownload.setAttribute('href', '#');
  syncBodyLock();
  if (restoreFocus && previousFocus instanceof HTMLElement) {
    previousFocus.focus({ preventScroll: true });
  }
}

function closeDeleteDialog() {
  if (deleteDialog.open) deleteDialog.close();
  state.deleteId = '';
  deleteConfirm.classList.remove('is-loading');
  deleteConfirm.disabled = false;
  deleteCancel.disabled = false;
  deleteConfirm.textContent = '确认删除';
  syncBodyLock();
}

function closeDrawer({ restoreFocus = true } = {}) {
  closeImageViewer({ restoreFocus: false });
  if (deleteDialog.open) closeDeleteDialog();
  if (drawer.hidden) return;
  state.detailRequestId += 1;
  drawer.hidden = true;
  drawerBackdrop.hidden = true;
  detailLoading.hidden = false;
  detailContent.hidden = true;
  detailContent.replaceChildren();
  detailTitle.textContent = '客户档案';
  const previousFocus = state.lastFocus;
  state.lastFocus = null;
  syncBodyLock();
  if (restoreFocus && previousFocus instanceof HTMLElement && document.contains(previousFocus)) {
    previousFocus.focus({ preventScroll: true });
  }
}

function closeAllOverlays() {
  closeImageViewer({ restoreFocus: false });
  closeDeleteDialog();
  closeDrawer({ restoreFocus: false });
}

function resetDashboard() {
  closeAllOverlays();
  clearSensitiveDom();
  state.admin = null;
  state.authenticated = false;
  state.loading = false;
  state.appliedFilters = {};
  state.page = 1;
  state.totalPages = 1;
  if (state.listAbort) {
    state.listAbort.abort();
    state.listAbort = null;
  }
  statTotal.textContent = '—';
  statToday.textContent = '—';
  statCompanies.textContent = '—';
  navCount.textContent = '0';
  archiveResult.textContent = '正在读取档案…';
  sheetCount.textContent = '—';
  adminUsername.textContent = '—';
  filterForm.reset();
  filterSummary.hidden = true;
  exportButton.disabled = true;
  exportButton.classList.remove('is-loading');
  exportLabel.textContent = '导出筛选结果';
  setLoginError('');
}

function showLogin(message = '', { focus = true } = {}) {
  bootView.hidden = true;
  adminView.hidden = true;
  loginView.hidden = false;
  resetDashboard();
  setLoginError(message);
  if (passwordInput) passwordInput.value = '';
  if (focus && usernameInput) {
    window.setTimeout(() => usernameInput.focus(), 30);
  }
}

function showAdmin(username) {
  bootView.hidden = true;
  loginView.hidden = true;
  adminView.hidden = false;
  state.authenticated = true;
  state.admin = username;
  adminUsername.textContent = username || 'admin';
  setLoginError('');
}

function handleSessionExpired(message = '登录已失效，请重新登录。') {
  if (!loginView.hidden) return;
  showLogin(message);
}

// ---------- API ----------

async function apiRequest(url, options = {}) {
  const { allowUnauthorized = false, body, headers = {}, ...rest } = options;
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  let requestBody = body;

  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    requestHeaders.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(url, {
    credentials: 'same-origin',
    ...rest,
    headers: requestHeaders,
    body: requestBody,
  });

  let data = null;
  if (response.status !== 204) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        data = null;
      }
    } else {
      data = await response.text();
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !allowUnauthorized) {
      handleSessionExpired();
    }
    const message =
      (data && typeof data === 'object' && data.error) ||
      (typeof data === 'string' && data) ||
      '请求未能完成，请稍后重试';
    throw new ApiError(message, response.status, data);
  }

  return data;
}

// ---------- Auth ----------

async function initializeSession() {
  setTodayLabels();
  try {
    const data = await apiRequest('/api/admin/session', { allowUnauthorized: true });
    showAdmin(data.admin?.username || 'admin');
    await loadSubmissions();
  } catch (error) {
    if (error.status === 401) {
      showLogin();
    } else {
      showLogin('无法验证登录状态，请检查服务连接后刷新页面。');
    }
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoginError('');

  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    setLoginError('请输入管理员账号和登录密码。');
    (!username ? usernameInput : passwordInput).focus();
    return;
  }

  loginSubmit.disabled = true;
  loginSubmit.classList.add('is-loading');
  try {
    const data = await apiRequest('/api/admin/login', {
      method: 'POST',
      body: { username, password },
      allowUnauthorized: true,
    });
    passwordInput.value = '';
    showAdmin(data.admin?.username || username);
    await loadSubmissions();
  } catch (error) {
    if (error.status === 429) {
      setLoginError(error.message || '登录尝试过于频繁，请稍后再试。');
    } else if (error.status === 401) {
      setLoginError('账号或密码不正确，请重新输入。');
      passwordInput.focus();
      passwordInput.select();
    } else {
      setLoginError(error.message || '登录失败，请稍后重试。');
    }
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.classList.remove('is-loading');
  }
});

passwordToggle.addEventListener('click', () => {
  const shouldShow = passwordInput.type === 'password';
  passwordInput.type = shouldShow ? 'text' : 'password';
  passwordToggle.classList.toggle('is-visible', shouldShow);
  passwordToggle.setAttribute('aria-pressed', String(shouldShow));
  passwordToggle.setAttribute('aria-label', shouldShow ? '隐藏密码' : '显示密码');
  passwordInput.focus();
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    await apiRequest('/api/admin/logout', { method: 'POST' });
  } catch (error) {
    if (error.status !== 401) {
      showToast(error.message || '退出登录时发生错误。');
    }
  } finally {
    logoutButton.disabled = false;
    showLogin('', { focus: false });
  }
});

// ---------- Filters and listing ----------

function readFilters() {
  return {
    q: filterQuery.value.trim(),
    company: filterCompany.value.trim(),
    from: filterFrom.value,
    to: filterTo.value,
  };
}

function hasFilters(filters = state.appliedFilters) {
  return Boolean(filters.q || filters.company || filters.from || filters.to);
}

function buildQueryString(filters, includePage = true) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.company) params.set('company', filters.company);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (includePage) {
    params.set('page', String(state.page));
    params.set('pageSize', String(state.pageSize));
  }
  return params.toString();
}

function validateFilters(filters) {
  if (filters.from && filters.to && filters.from > filters.to) {
    showToast('起始日期不能晚于截止日期。');
    filterFrom.focus();
    return false;
  }
  return true;
}

function updateFilterSummary() {
  const filters = state.appliedFilters;
  if (!hasFilters(filters)) {
    filterSummary.hidden = true;
    filterSummaryText.textContent = '';
    return;
  }

  const parts = [];
  if (filters.q) parts.push(`个人信息「${filters.q}」`);
  if (filters.company) parts.push(`企业单位「${filters.company}」`);
  if (filters.from && filters.to) {
    parts.push(`${formatDateDot(filters.from)} 至 ${formatDateDot(filters.to)}`);
  } else if (filters.from) {
    parts.push(`${formatDateDot(filters.from)} 起`);
  } else if (filters.to) {
    parts.push(`截至 ${formatDateDot(filters.to)}`);
  }
  filterSummaryText.textContent = `当前筛选：${parts.join(' · ')}`;
  filterSummary.hidden = false;
}

function applyFilters({ resetPage = true } = {}) {
  const filters = readFilters();
  if (!validateFilters(filters)) return;
  state.appliedFilters = filters;
  if (resetPage) state.page = 1;
  loadSubmissions();
}

filterForm.addEventListener('submit', (event) => {
  event.preventDefault();
  applyFilters();
});

resetFiltersButton.addEventListener('click', () => {
  filterForm.reset();
  state.appliedFilters = {};
  state.page = 1;
  loadSubmissions();
});

clearSearchButton.addEventListener('click', () => {
  filterForm.reset();
  state.appliedFilters = {};
  state.page = 1;
  loadSubmissions();
});

emptyResetButton.addEventListener('click', () => {
  filterForm.reset();
  state.appliedFilters = {};
  state.page = 1;
  loadSubmissions();
});

prevPageButton.addEventListener('click', () => {
  if (state.loading || state.page <= 1) return;
  state.page -= 1;
  loadSubmissions();
});

nextPageButton.addEventListener('click', () => {
  if (state.loading || state.page >= state.totalPages) return;
  state.page += 1;
  loadSubmissions();
});

function setListLoading(loading) {
  state.loading = loading;
  searchButton.disabled = loading;
  resetFiltersButton.disabled = loading;
  if (loading) {
    listLoading.hidden = false;
    tableWrap.hidden = true;
    recordCards.hidden = true;
    emptyState.hidden = true;
    pagination.hidden = true;
    archiveResult.textContent = '正在读取档案…';
  } else {
    listLoading.hidden = true;
  }
  syncExportButton();
}

function syncExportButton() {
  const canExport =
    state.authenticated && state.filteredTotal > 0 && !state.loading && !state.exportLoading;
  exportButton.disabled = !canExport;
  if (!state.exportLoading) {
    exportLabel.textContent = '导出筛选结果';
  }
}

function updateStats(stats) {
  statTotal.textContent = Number(stats?.total || 0).toLocaleString('zh-CN');
  statToday.textContent = Number(stats?.today || 0).toLocaleString('zh-CN');
  statCompanies.textContent = Number(stats?.companyCount || 0).toLocaleString('zh-CN');
  navCount.textContent = Number(stats?.total || 0).toLocaleString('zh-CN');
}

function setRecordsEmpty({ error = null } = {}) {
  tableWrap.hidden = true;
  recordCards.hidden = true;
  recordsBody.replaceChildren();
  recordCards.replaceChildren();
  emptyState.hidden = false;
  pagination.hidden = true;

  const filtered = hasFilters();
  if (error) {
    emptyTitle.textContent = '档案加载失败';
    emptyDescription.textContent = error.message || '暂时无法读取档案，请稍后重试。';
    emptyResetButton.hidden = true;
    archiveResult.textContent = '读取失败';
    sheetCount.textContent = '—';
    return;
  }

  emptyTitle.textContent = filtered ? '未找到符合筛选条件的档案' : '尚无客户档案';
  emptyDescription.textContent = filtered
    ? '可以尝试更换检索关键词，或适当放宽日期范围。'
    : '客户通过采集页提交后，档案会按时间顺序出现在这里。';
  emptyResetButton.hidden = !filtered;
  archiveResult.textContent = filtered ? '筛选结果 0 份' : '暂无档案';
  sheetCount.textContent = '0 份';
}

function renderRecordRows(items) {
  const rows = items
    .map((item) => {
      const dateTime = formatDateTime(item.createdAt);
      const [datePart, timePart] = dateTime.split(' ');
      const age = item.age === null || item.age === undefined ? '—' : `${item.age} 岁`;
      const id = escapeHtml(item.id);
      const name = escapeHtml(item.name);
      return `
        <tr>
          <td>
            <div class="customer-cell">
              <span class="customer-name">${name}</span>
              <span class="customer-phone">${escapeHtml(item.phone)}</span>
            </div>
          </td>
          <td><span class="cell-mono">${escapeHtml(item.idNumberMasked)}</span></td>
          <td><span class="cell-muted">${displayValue(item.sex)} · ${escapeHtml(age)}</span></td>
          <td><span class="cell-muted">${displayValue(item.nativePlace)}</span></td>
          <td><span class="cell-company" title="${escapeHtml(item.company)}">${displayValue(item.company)}</span></td>
          <td><span class="cell-time">${escapeHtml(datePart || '')}<br />${escapeHtml(timePart || '')}</span></td>
          <td>
            <button type="button" class="row-action js-open-detail" data-detail-id="${id}" aria-label="查看 ${name} 的档案">查看</button>
          </td>
        </tr>
      `;
    })
    .join('');
  recordsBody.innerHTML = rows;

  const cards = items
    .map((item) => {
      const age = item.age === null || item.age === undefined ? '—' : `${item.age} 岁`;
      const id = escapeHtml(item.id);
      const name = escapeHtml(item.name);
      return `
        <article class="record-card">
          <div class="record-card-head">
            <div>
              <span class="record-card-name">${name}</span>
              <span class="record-card-phone">${escapeHtml(item.phone)}</span>
            </div>
            <button type="button" class="record-card-open js-open-detail" data-detail-id="${id}" aria-label="查看 ${name} 的档案">查看</button>
          </div>
          <div class="record-card-grid">
            <div><span>身份证号</span><strong>${escapeHtml(item.idNumberMasked)}</strong></div>
            <div><span>性别 / 年龄</span><strong>${displayValue(item.sex)} · ${escapeHtml(age)}</strong></div>
            <div><span>籍贯</span><strong>${displayValue(item.nativePlace)}</strong></div>
            <div><span>证件有效期</span><strong>${escapeHtml(item.validityText || '—')}</strong></div>
          </div>
          <div class="record-card-company">
            <span>企业单位</span>
            <p>${displayValue(item.company)}</p>
          </div>
          <div class="record-card-foot">
            <span>${escapeHtml(item.receipt)}</span>
            <span>${escapeHtml(formatDateTime(item.createdAt))}</span>
          </div>
        </article>
      `;
    })
    .join('');
  recordCards.innerHTML = cards;
}

function renderList() {
  const items = state.items;
  const isFiltered = hasFilters();

  tableWrap.hidden = items.length === 0;
  recordCards.hidden = items.length === 0;
  emptyState.hidden = items.length > 0;
  pagination.hidden = items.length === 0 || state.totalPages <= 1;

  if (items.length === 0) {
    setRecordsEmpty();
    updateFilterSummary();
    syncExportButton();
    return;
  }

  renderRecordRows(items);
  archiveResult.textContent = isFiltered
    ? `筛选结果 ${state.filteredTotal} 份`
    : `共 ${state.filteredTotal} 份档案`;
  sheetCount.textContent = `${state.filteredTotal} 份`;
  paginationInfo.textContent = `共 ${state.filteredTotal} 份 · 每页 ${state.pageSize} 份`;
  pageNumber.textContent = `${state.page} / ${state.totalPages}`;
  prevPageButton.disabled = state.page <= 1;
  nextPageButton.disabled = state.page >= state.totalPages;
  updateFilterSummary();
  syncExportButton();
}

async function loadSubmissions() {
  if (state.listAbort) state.listAbort.abort();
  const controller = new AbortController();
  state.listAbort = controller;
  setListLoading(true);

  const params = buildQueryString(state.appliedFilters);
  try {
    const data = await apiRequest(`/api/admin/submissions?${params}`, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;

    state.items = Array.isArray(data.items) ? data.items : [];
    state.filteredTotal = Number(data.stats?.filteredTotal || 0);
    state.page = Number(data.pagination?.page || 1);
    state.pageSize = Number(data.pagination?.pageSize || 20);
    state.totalPages = Math.max(1, Number(data.pagination?.totalPages || 1));
    updateStats(data.stats);

    if (state.items.length === 0 && state.page > 1 && state.filteredTotal > 0) {
      state.page = state.totalPages;
      if (state.listAbort === controller) {
        state.listAbort = null;
        setListLoading(false);
      }
      loadSubmissions();
      return;
    }

    renderList();
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (error.status === 401) return;
    state.items = [];
    state.filteredTotal = 0;
    setListLoading(false);
    setRecordsEmpty({ error });
    updateFilterSummary();
    syncExportButton();
    showToast(error.message || '档案读取失败，请稍后重试。');
  } finally {
    if (state.listAbort === controller) {
      state.listAbort = null;
      setListLoading(false);
    }
  }
}

// ---------- Detail ----------

function buildDetailMarkup(item) {
  const age = item.age === null || item.age === undefined ? '—' : `${item.age} 岁`;
  const validity = formatValidity(item.validFrom, item.validTo, item.isLongTerm);
  const createdAt = formatDateTime(item.createdAt);
  const frontUrl = escapeHtml(item.images?.front || '');
  const backUrl = escapeHtml(item.images?.back || '');
  const name = escapeHtml(item.name);

  return `
    <div class="detail-hero">
      <div>
        <span class="detail-status">已归档</span>
        <h3>${name}</h3>
        <p class="detail-receipt">${escapeHtml(item.receipt)}</p>
      </div>
      <div class="detail-hero-meta">
        <span>提交时间</span>
        <strong>${escapeHtml(createdAt)}</strong>
      </div>
    </div>

    <section class="detail-section" aria-labelledby="detail-identity">
      <div class="detail-section-heading">
        <h4 id="detail-identity">身份信息</h4>
      </div>
      <dl class="detail-facts">
        <div class="detail-fact"><dt>姓名</dt><dd class="is-strong">${displayValue(item.name)}</dd></div>
        <div class="detail-fact"><dt>性别 / 年龄</dt><dd>${displayValue(item.sex)} · ${escapeHtml(age)}</dd></div>
        <div class="detail-fact"><dt>民族</dt><dd>${displayValue(item.ethnicity)}</dd></div>
        <div class="detail-fact"><dt>出生日期</dt><dd>${escapeHtml(formatDateDot(item.birthDate) || '—')}</dd></div>
        <div class="detail-fact"><dt>籍贯</dt><dd>${displayValue(item.nativePlace)}</dd></div>
        <div class="detail-fact"><dt>现居城市</dt><dd>${displayValue(item.currentCity)}</dd></div>
        <div class="detail-fact"><dt>职业</dt><dd>${displayValue(item.occupation)}</dd></div>
        <div class="detail-fact"><dt>手机号</dt><dd class="is-code">${displayValue(item.phone)}</dd></div>
      </dl>
    </section>

    <section class="detail-section" aria-labelledby="detail-document">
      <div class="detail-section-heading">
        <h4 id="detail-document">证件信息</h4>
      </div>
      <dl class="detail-facts">
        <div class="detail-fact is-full"><dt>身份证号码</dt><dd class="is-code">${displayValue(item.idNumber)}</dd></div>
        <div class="detail-fact"><dt>签发机关</dt><dd>${displayValue(item.issuingAuthority)}</dd></div>
        <div class="detail-fact"><dt>证件有效期</dt><dd>${escapeHtml(validity)}</dd></div>
        <div class="detail-fact is-full"><dt>身份证住址</dt><dd>${displayValue(item.idAddress)}</dd></div>
      </dl>
    </section>

    <section class="detail-section" aria-labelledby="detail-company">
      <div class="detail-section-heading">
        <h4 id="detail-company">企业单位</h4>
      </div>
      <div class="detail-company-box">${displayValue(item.company)}</div>
    </section>

    <section class="detail-section" aria-labelledby="detail-images">
      <div class="detail-section-heading">
        <h4 id="detail-images">证件影像</h4>
      </div>
      <div class="detail-id-images">
        <figure class="id-image-card">
          <button type="button" class="id-image-button js-view-image" data-view-side="front" aria-label="查看${name}的身份证正面大图">
            <img src="${frontUrl}" alt="${name}的身份证正面" decoding="async" />
            <span class="image-hover">查看大图</span>
          </button>
          <figcaption>
            <div><span>身份证正面</span></div>
            <a href="${frontUrl}?download=1">下载原图</a>
          </figcaption>
        </figure>
        <figure class="id-image-card">
          <button type="button" class="id-image-button js-view-image" data-view-side="back" aria-label="查看${name}的身份证反面大图">
            <img src="${backUrl}" alt="${name}的身份证反面" decoding="async" />
            <span class="image-hover">查看大图</span>
          </button>
          <figcaption>
            <div><span>身份证反面</span></div>
            <a href="${backUrl}?download=1">下载原图</a>
          </figcaption>
        </figure>
      </div>
    </section>

    <div class="detail-consent">
      <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M6 4.5h9l3 3v12H6zM14.5 4.5v3.5H18M9 11h6M9 14.5h4.5" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>客户提交时已确认个人信息授权说明（版本 ${escapeHtml(item.consentVersion || '1.0')}），资料仅限用于投保咨询与后续保单服务。</span>
    </div>

    <div class="detail-danger">
      <div>
        <strong>资料管理</strong>
        <p>仅在客户撤回授权或依法处理时删除，删除后不可恢复。</p>
      </div>
      <button type="button" class="button button-secondary" id="detail-delete">删除档案</button>
    </div>

    <p class="detail-audit-note">本次查阅已记录。请勿对敏感影像进行截屏、拍照或通过未授权渠道传输。</p>
  `;
}

function attachDetailImageFallbacks() {
  for (const image of detailContent.querySelectorAll('.id-image-button img')) {
    image.addEventListener('error', () => {
      image.alt = '影像加载失败，请关闭后重试';
      const figure = image.closest('.id-image-card');
      if (figure) figure.classList.add('has-error');
    });
  }
}

async function openDetail(id, trigger) {
  state.currentDetail = null;
  state.lastFocus = trigger || document.activeElement;
  const token = state.detailRequestId + 1;
  state.detailRequestId = token;

  drawer.hidden = false;
  drawerBackdrop.hidden = false;
  drawerScroll.scrollTop = 0;
  detailTitle.textContent = '客户档案';
  detailLoading.hidden = false;
  detailContent.hidden = true;
  detailContent.replaceChildren();
  syncBodyLock();
  window.setTimeout(() => drawerClose.focus({ preventScroll: true }), 50);

  try {
    const data = await apiRequest(`/api/admin/submissions/${encodeURIComponent(id)}`);
    if (token !== state.detailRequestId || drawer.hidden) return;
    state.currentDetail = data.item;
    detailTitle.textContent = `${data.item.name} · 档案`;
    detailContent.innerHTML = buildDetailMarkup(data.item);
    attachDetailImageFallbacks();
    detailLoading.hidden = true;
    detailContent.hidden = false;
    drawerScroll.scrollTop = 0;
  } catch (error) {
    if (error.name === 'AbortError' || error.status === 401) return;
    if (token !== state.detailRequestId) return;
    detailLoading.hidden = true;
    detailContent.hidden = false;
    detailContent.innerHTML = `
      <div class="detail-error">
        <h3>档案未能打开</h3>
        <p></p>
        <button type="button" class="button button-secondary" id="detail-retry">重新加载</button>
      </div>
    `;
    detailContent.querySelector('p').textContent = error.message || '请稍后重试。';
    detailContent.querySelector('#detail-retry').addEventListener('click', () => {
      openDetail(id, state.lastFocus);
    });
  }
}

drawerClose.addEventListener('click', () => closeDrawer());
drawerBackdrop.addEventListener('click', () => closeDrawer());

recordsBody.addEventListener('click', handleRecordClick);
recordCards.addEventListener('click', handleRecordClick);

function handleRecordClick(event) {
  const button = event.target.closest('.js-open-detail');
  if (!button) return;
  openDetail(button.dataset.detailId, button);
}

detailContent.addEventListener('click', (event) => {
  const imageButton = event.target.closest('.js-view-image');
  if (imageButton) {
    openImageViewer(imageButton.dataset.viewSide, imageButton);
    return;
  }

  if (event.target.closest('#detail-delete')) {
    if (!state.currentDetail) return;
    state.deleteId = state.currentDetail.id;
    deleteTarget.textContent = `${state.currentDetail.name} · ${state.currentDetail.receipt}`;
    deleteConfirm.classList.remove('is-loading');
    deleteConfirm.disabled = false;
    deleteCancel.disabled = false;
    deleteConfirm.textContent = '确认删除';
    deleteDialog.showModal();
    syncBodyLock();
    deleteCancel.focus();
  }
});

function openImageViewer(side, trigger) {
  const detail = state.currentDetail;
  if (!detail || !['front', 'back'].includes(side)) return;
  const url = side === 'front' ? detail.images.front : detail.images.back;
  const label = side === 'front' ? '正面' : '反面';
  state.viewerLastFocus = trigger || document.activeElement;
  viewerTitle.textContent = `${detail.name} · 身份证${label}`;
  viewerImage.src = `${url}?v=${Date.now()}`;
  viewerImage.alt = `${detail.name}的身份证${label}`;
  viewerDownload.href = `${url}?download=1`;
  imageViewer.hidden = false;
  syncBodyLock();
  window.setTimeout(() => viewerClose.focus({ preventScroll: true }), 40);
}

viewerClose.addEventListener('click', () => closeImageViewer());
imageViewer.querySelector('.viewer-stage').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeImageViewer();
});

// ---------- Delete ----------

deleteCancel.addEventListener('click', () => closeDeleteDialog());
deleteDialog.addEventListener('close', () => {
  state.deleteId = '';
  deleteConfirm.classList.remove('is-loading');
  deleteConfirm.disabled = false;
  deleteCancel.disabled = false;
  deleteConfirm.textContent = '确认删除';
  syncBodyLock();
});
deleteDialog.addEventListener('click', (event) => {
  if (event.target !== deleteDialog) return;
  const rect = deleteDialog.getBoundingClientRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
  if (!inside) closeDeleteDialog();
});

deleteConfirm.addEventListener('click', async () => {
  const id = state.deleteId;
  if (!id || deleteConfirm.classList.contains('is-loading')) return;

  const isLastItemOnPage = state.items.length === 1;
  deleteConfirm.classList.add('is-loading');
  deleteConfirm.disabled = true;
  deleteCancel.disabled = true;
  deleteConfirm.textContent = '正在删除';

  try {
    await apiRequest(`/api/admin/submissions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    closeDeleteDialog();
    closeDrawer({ restoreFocus: false });
    if (isLastItemOnPage && state.page > 1) state.page -= 1;
    showToast('档案及身份证影像已删除。');
    await loadSubmissions();
  } catch (error) {
    if (error.status !== 401) showToast(error.message || '删除失败，请稍后重试。');
    deleteConfirm.classList.remove('is-loading');
    deleteConfirm.disabled = false;
    deleteCancel.disabled = false;
    deleteConfirm.textContent = '确认删除';
  }
});

// ---------- Export ----------

function filenameFromDisposition(headerValue) {
  if (!headerValue) return '';
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return '';
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(headerValue);
  return plainMatch ? plainMatch[1] : '';
}

function triggerDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
}

exportButton.addEventListener('click', async () => {
  if (state.exportLoading || state.filteredTotal === 0) return;
  state.exportLoading = true;
  exportButton.classList.add('is-loading');
  exportLabel.textContent = '正在生成 Excel…';
  exportButton.disabled = true;

  try {
    const params = buildQueryString(state.appliedFilters, false);
    const response = await fetch(`/api/admin/export?${params}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    });

    if (response.status === 401) {
      handleSessionExpired();
      return;
    }

    if (!response.ok) {
      let message = '导出失败，请稍后重试。';
      try {
        const data = await response.json();
        message = data.error || message;
      } catch {
        // Keep the default message.
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const filename =
      filenameFromDisposition(response.headers.get('content-disposition')) ||
      `anjian-submissions-${new Date().toISOString().slice(0, 10)}.xlsx`;
    triggerDownload(blob, filename);
    showToast(`已生成 Excel 档案，共 ${state.filteredTotal} 条，文件内含身份证影像。`, 5000);
  } catch (error) {
    showToast(error.message || '导出失败，请稍后重试。');
  } finally {
    state.exportLoading = false;
    exportButton.classList.remove('is-loading');
    exportLabel.textContent = '导出筛选结果';
    syncExportButton();
  }
});

// ---------- Keyboard ----------

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (deleteDialog.open) return;
  if (!imageViewer.hidden) {
    closeImageViewer();
    return;
  }
  if (!drawer.hidden) closeDrawer();
});

// ---------- Start ----------

initializeSession();
