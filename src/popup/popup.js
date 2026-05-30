// ============================================================
// Page Monitor Popup — Direct storage access, no SW dependency
// ============================================================

const $ = id => document.getElementById(id);
let rules = [];
let settings = { globalEnabled: true };
let editingRuleId = null;

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await loadStorage();
  renderList();

  // Check for picker result + form state
  const pending = await chrome.storage.local.get(['_pendingPickResult', '_pickFormState']);
  if (pending._pendingPickResult || pending._pickFormState) {
    await chrome.storage.local.remove(['_pendingPickResult', '_pickFormState']);
    const fs = pending._pickFormState || {};
    showForm(null, fs._formUrl || '');
    // Restore ALL saved fields
    restoreForm(fs);
    // Fill the picker result into the right input
    const targetId = fs._pickerTarget || 'rule-selector';
    if (pending._pendingPickResult?.selector) {
      $(targetId).value = pending._pendingPickResult.selector;
    }
  }
});

async function startPicking(targetInputId) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;

  // Save ALL form state
  await chrome.storage.local.set({
    _pickFormState: {
      _formName: $('rule-name').value,
      _formUrl: $('rule-url').value,
      _formUrlMode: $('rule-url-mode').value,
      _formSelector: $('rule-selector').value,
      _formDomMode: $('rule-dom-mode').value,
      _formTextFilter: $('rule-text-filter').value,
      _formNotifyMethod: $('rule-notify-method').value,
      _formNotifyTemplate: $('rule-notify-template').value,
      _formCooldown: $('rule-cooldown').value,
      _formRefreshEnabled: $('rule-refresh-enabled').checked,
      _formTimedRefresh: $('rule-timed-refresh').checked,
      _formTimedInterval: $('rule-timed-interval').value,
      _formClickRefresh: $('rule-click-refresh').checked,
      _formClickSelector: $('rule-click-selector').value,
      _formClickInterval: $('rule-click-interval').value,
      _formDetectionAction: $('rule-detection-action').checked,
      _formActionSelector: $('rule-action-selector').value,
      _pickerTarget: targetInputId,
    }
  });

  try {
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'START_PICKING' });
  } catch {}
  window.close();
}

// ============================================================
// Storage (direct, no SW needed)
// ============================================================
async function loadStorage() {
  const data = await chrome.storage.local.get(['rules', 'settings']);
  rules = data.rules || [];
  settings = data.settings || { globalEnabled: true };
}

async function save() {
  await chrome.storage.local.set({ rules, settings });
}

function restoreForm(fs) {
  if (!fs) return;
  if (fs._formName) $('rule-name').value = fs._formName;
  if (fs._formUrl) $('rule-url').value = fs._formUrl;
  if (fs._formUrlMode) $('rule-url-mode').value = fs._formUrlMode;
  if (fs._formSelector) $('rule-selector').value = fs._formSelector;
  if (fs._formDomMode) $('rule-dom-mode').value = fs._formDomMode;
  if (fs._formTextFilter) $('rule-text-filter').value = fs._formTextFilter;
  if (fs._formNotifyMethod) $('rule-notify-method').value = fs._formNotifyMethod;
  if (fs._formNotifyTemplate) $('rule-notify-template').value = fs._formNotifyTemplate;
  if (fs._formCooldown) $('rule-cooldown').value = fs._formCooldown;
  if (fs._formRefreshEnabled) {
    $('rule-refresh-enabled').checked = true;
    $('refresh-config').style.display = 'block';
  }
  if (fs._formTimedRefresh) $('rule-timed-refresh').checked = true;
  if (fs._formTimedInterval) $('rule-timed-interval').value = fs._formTimedInterval;
  if (fs._formClickRefresh) $('rule-click-refresh').checked = true;
  if (fs._formClickSelector) $('rule-click-selector').value = fs._formClickSelector;
  if (fs._formClickInterval) $('rule-click-interval').value = fs._formClickInterval;
  if (fs._formDetectionAction) {
    $('rule-detection-action').checked = true;
    $('detection-action-config').style.display = 'block';
  }
  if (fs._formActionSelector) $('rule-action-selector').value = fs._formActionSelector;
}

// ============================================================
// Event Bindings
// ============================================================
function bindEvents() {
  // List delegation — find button by closest()
  $('rule-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    const id = btn.dataset.ruleId;
    if (a === 'edit')   editRule(id);
    if (a === 'toggle') toggleRule(id);
    if (a === 'delete') deleteRule(id);
  });

  // Global toggle
  $('global-toggle').addEventListener('change', () => {
    settings.globalEnabled = $('global-toggle').checked;
    save().then(renderList);
  });

  // New rule button
  $('add-rule-btn').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    showForm(null, tabs[0]?.url || '');
  });

  // Form
  $('rule-form').addEventListener('submit', e => { e.preventDefault(); saveForm(); });
  $('delete-rule-btn').addEventListener('click', () => deleteCurrentRule());
  document.querySelectorAll('.cancel-form').forEach(el => el.addEventListener('click', hideForm));

  // Element pickers
  $('pick-element-btn').addEventListener('click', () => startPicking('rule-selector'));
  $('pick-action-btn').addEventListener('click', () => startPicking('rule-action-selector'));
  $('pick-refresh-btn').addEventListener('click', () => startPicking('rule-click-selector'));

  // Detection action toggle
  $('rule-detection-action').addEventListener('change', e => {
    $('detection-action-config').style.display = e.target.checked ? 'block' : 'none';
  });

  // Scan elements
  $('scan-elements-btn').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) return;
    const btn = $('scan-elements-btn');
    btn.disabled = true; btn.textContent = '扫描中...';
    $('recommendations').style.display = 'none';
    try {
      const resp = await chrome.tabs.sendMessage(tabs[0].id, { type: 'SCAN_ELEMENTS' });
      if (resp?.elements?.length) showRecommendations(resp.elements);
      else alert('未发现状态元素');
    } catch {
      alert('无法扫描，请刷新目标页面后重试');
    }
    btn.disabled = false; btn.textContent = '推荐';
  });

  // Refresh config toggle
  $('rule-refresh-enabled').addEventListener('change', e => {
    $('refresh-config').style.display = e.target.checked ? 'block' : 'none';
  });

  // API endpoints
  $('add-endpoint-btn').addEventListener('click', () => addEndpointRow());
  $('api-endpoints').addEventListener('click', e => {
    if (e.target.classList.contains('remove-endpoint')) {
      const row = e.target.closest('.api-endpoint-row');
      if (row && $('api-endpoints').children.length > 1) row.remove();
    }
  });
}

// ============================================================
// Rule List
// ============================================================
function renderList() {
  const on = settings.globalEnabled;
  $('global-toggle').checked = on;

  if (!rules.length) {
    $('rule-list').innerHTML = '<div class="empty-state">暂无规则，点击「+ 新建」创建</div>';
    return;
  }

  $('rule-list').innerHTML = rules.map(r => {
    const active = r.enabled && on;
    const type = r.domSelector ? 'DOM' : (r.apiEndpoints?.length ? 'API' : '—');
    const last = r.lastTriggeredAt ? ago(r.lastTriggeredAt) : '未触发';
    return `
      <div class="rule-item ${active ? '' : 'disabled'}">
        <span class="rule-status ${active ? 'active' : 'inactive'}"></span>
        <div class="rule-info">
          <div class="rule-name">${esc(r.name)}</div>
          <div class="rule-meta">${type} · ${esc(r.url)} · ${last}</div>
        </div>
        <div class="rule-actions">
          <button class="btn btn-text btn-sm" data-action="toggle" data-rule-id="${r.id}">${r.enabled ? '暂停' : '启用'}</button>
          <button class="btn btn-text btn-sm" data-action="edit" data-rule-id="${r.id}">编辑</button>
          <button class="btn btn-text btn-sm" data-action="delete" data-rule-id="${r.id}">✕</button>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// Rule Actions (direct storage)
// ============================================================
function editRule(id) {
  const r = rules.find(x => x.id === id);
  if (r) showForm(r);
}

function toggleRule(id) {
  const r = rules.find(x => x.id === id);
  if (!r) return;
  r.enabled = !r.enabled;
  r.updatedAt = Date.now();
  save().then(renderList);
}

function deleteRule(id) {
  if (!confirm('确定删除？')) return;
  rules = rules.filter(x => x.id !== id);
  save().then(renderList);
}

function deleteCurrentRule() {
  if (!editingRuleId) return;
  if (!confirm('确定删除？')) return;
  rules = rules.filter(x => x.id !== editingRuleId);
  save().then(hideForm);
}

// ============================================================
// Form
// ============================================================
function showForm(rule, defaultUrl) {
  $('rule-list-section').style.display = 'none';
  $('rule-form-section').style.display = 'block';
  $('rule-form').reset();
  $('api-endpoints').innerHTML = '';
  $('recommendations').style.display = 'none';

  if (rule) {
    editingRuleId = rule.id;
    $('form-title').textContent = '编辑规则';
    $('delete-rule-btn').style.display = 'block';
    $('rule-name').value = rule.name || '';
    $('rule-url').value = rule.url || '';
    $('rule-url-mode').value = rule.urlMatchMode || 'contains';
    $('rule-selector').value = rule.domSelector || '';
    $('rule-dom-mode').value = rule.domCheckMode || 'presence';
    $('rule-text-filter').value = rule.textFilter || '';
    $('rule-notify-method').value = rule.notificationMethod || 'system';
    $('rule-notify-template').value = rule.notificationTemplate || '';
    $('rule-cooldown').value = (rule.cooldownMs / 1000) || 60;

    const da = rule.detectionAction || {};
    $('rule-detection-action').checked = da.enabled || false;
    $('detection-action-config').style.display = da.enabled ? 'block' : 'none';
    $('rule-action-selector').value = da.buttonSelector || '';
    const ar = rule.autoRefresh || {};
    $('rule-refresh-enabled').checked = ar.enabled || false;
    $('refresh-config').style.display = ar.enabled ? 'block' : 'none';
    $('rule-timed-refresh').checked = ar.timedRefresh?.enabled || false;
    $('rule-timed-interval').value = (ar.timedRefresh?.intervalMs / 1000) || 30;
    $('rule-click-refresh').checked = ar.clickRefresh?.enabled || false;
    $('rule-click-selector').value = ar.clickRefresh?.buttonSelector || '';
    $('rule-click-interval').value = (ar.clickRefresh?.intervalMs / 1000) || 60;
    (rule.apiEndpoints || [{ method: 'ANY', pathPattern: '' }]).forEach(addEndpointRow);
  } else {
    editingRuleId = null;
    $('form-title').textContent = '新建规则';
    $('delete-rule-btn').style.display = 'none';
    if (defaultUrl) $('rule-url').value = defaultUrl;
    $('refresh-config').style.display = 'none';
    addEndpointRow();
  }
}

function hideForm() {
  $('rule-form-section').style.display = 'none';
  $('rule-list-section').style.display = 'block';
  editingRuleId = null;
  renderList();
}

function saveForm() {
  const name = $('rule-name').value.trim();
  const url = $('rule-url').value.trim();
  if (!name) return alert('规则名称不能为空');
  if (!url) return alert('监控 URL 不能为空');

  const endpoints = [];
  $('api-endpoints').querySelectorAll('.api-endpoint-row').forEach(row => {
    const m = row.querySelector('.api-method')?.value || 'ANY';
    const p = row.querySelector('.api-path')?.value?.trim();
    if (!p) return;
    endpoints.push({
      method: m,
      pathPattern: p,
      responseCheckField: row.querySelector('.api-field')?.value?.trim() || '',
      responseCheckValue: row.querySelector('.api-value')?.value?.trim() || '',
    });
  });

  const existing = editingRuleId ? rules.find(r => r.id === editingRuleId) : null;

  const rule = {
    id: editingRuleId || crypto.randomUUID(),
    name,
    url,
    urlMatchMode: $('rule-url-mode').value,
    domSelector: $('rule-selector').value.trim(),
    domCheckMode: $('rule-dom-mode').value,
    textFilter: $('rule-text-filter').value.trim(),
    apiEndpoints: endpoints,
    notificationMethod: $('rule-notify-method').value,
    notificationTemplate: $('rule-notify-template').value.trim(),
    cooldownMs: parseInt($('rule-cooldown').value) * 1000 || 60000,
    detectionAction: {
      enabled: $('rule-detection-action').checked,
      buttonSelector: $('rule-action-selector').value.trim(),
    },
    autoRefresh: {
      enabled: $('rule-refresh-enabled').checked,
      timedRefresh: {
        enabled: $('rule-timed-refresh').checked,
        intervalMs: parseInt($('rule-timed-interval').value) * 1000 || 30000,
      },
      clickRefresh: {
        enabled: $('rule-click-refresh').checked,
        buttonSelector: $('rule-click-selector').value.trim(),
        intervalMs: parseInt($('rule-click-interval').value) * 1000 || 60000,
      },
    },
    enabled: existing ? existing.enabled : true,
    lastTriggeredAt: existing ? existing.lastTriggeredAt : null,
  };

  if (existing) {
    rules[rules.indexOf(existing)] = { ...existing, ...rule, updatedAt: Date.now() };
  } else {
    rule.createdAt = Date.now();
    rule.updatedAt = Date.now();
    rules.push(rule);
  }

  save().then(hideForm);

  // Notify SW to push rules to matching tabs
  chrome.runtime.sendMessage({ type: 'RULE_SAVED', payload: { rule } }).catch(() => {});
  alert('规则已保存。请刷新目标监控页面后规则才会生效。');
}

// ============================================================
// Helpers
// ============================================================
function addEndpointRow(data) {
  const row = document.createElement('div');
  row.className = 'api-endpoint-row';
  row.innerHTML = `
    <select class="api-method form-select form-select-sm">
      <option value="ANY">ANY</option><option value="GET">GET</option><option value="POST">POST</option>
    </select>
    <input type="text" class="api-path form-input form-input-sm" placeholder="/api/status" value="${esc(data?.pathPattern || '')}">
    <input type="text" class="api-field form-input form-input-sm" placeholder="JSON字段" value="${esc(data?.responseCheckField || '')}">
    <input type="text" class="api-value form-input form-input-sm" placeholder="预期值" value="${esc(data?.responseCheckValue || '')}">
    <button type="button" class="btn btn-text btn-sm remove-endpoint">✕</button>
  `;
  if (data?.method) row.querySelector('.api-method').value = data.method;
  $('api-endpoints').appendChild(row);
}

function showRecommendations(elements) {
  $('recommendations').style.display = 'block';
  $('rec-count').textContent = `(${elements.length})`;
  $('rec-list').innerHTML = elements.map(el => `
    <div class="rec-item" data-sel="${esc(el.selector)}">
      <span class="rec-selector">${esc(el.selector)}</span>
      <span class="rec-preview">${esc(el.sampleText || '')}</span>
    </div>`).join('');
  $('rec-list').querySelectorAll('.rec-item').forEach(item => {
    item.addEventListener('click', () => {
      $('rec-list').querySelectorAll('.rec-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      $('rule-selector').value = item.dataset.sel;
    });
  });
}

function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}时前` : `${Math.floor(h / 24)}天前`;
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
