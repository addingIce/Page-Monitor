// ============================================================
// Page Monitor Popup
// ============================================================

const $ = id => document.getElementById(id);
let rules = [];
let settings = { globalEnabled: true };
let editingRuleId = null;
let targetCounter = 0;
let triggerCounter = 0; // for generating unique target IDs

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await loadStorage();
  renderList();
  const pending = await chrome.storage.local.get(['_pendingPickResult', '_pickFormState']);
  if (pending._pendingPickResult || pending._pickFormState) {
    await chrome.storage.local.remove(['_pendingPickResult', '_pickFormState']);
    const fs = pending._pickFormState || {};
    showForm(null, fs._formUrl || '');
    restoreForm(fs);
    // Rebuild domTargets from saved state
    if (fs._domTargets && fs._domTargets.length > 0) {
      $('dom-targets').innerHTML = '';
      targetCounter = 0;
      fs._domTargets.forEach(t => addTargetRow(t));
    }
    if (fs._blockTriggers && fs._blockTriggers.length > 0) {
      $('block-triggers').innerHTML = '';
      triggerCounter = 0;
      fs._blockTriggers.forEach(t => addTriggerRow(t));
    }
    // Restore editing context (was editing a rule before picking)
    if (fs._editRuleId) {
      $('rule-form').dataset.ruleId = fs._editRuleId;
      const ruleBeingEdited = rules.find(r => r.id === fs._editRuleId);
      if (ruleBeingEdited) {
        $('form-title').textContent = '编辑规则';
        $('delete-rule-btn').style.display = 'block';
        $('rule-name').value = ruleBeingEdited.name || '';
        // Keep url from saved form state
        $('rule-notify-method').value = ruleBeingEdited.notificationMethod || 'system';
        $('rule-notify-template').value = ruleBeingEdited.notificationTemplate || '';
        $('rule-cooldown').value = (ruleBeingEdited.cooldownMs / 1000) || 60;
        const ar = ruleBeingEdited.autoRefresh || {};
        $('rule-refresh-enabled').checked = ar.enabled || false;
        $('refresh-config').style.display = ar.enabled ? 'block' : 'none';
        $('rule-timed-refresh').checked = ar.timedRefresh?.enabled || false;
        $('rule-timed-interval').value = (ar.timedRefresh?.intervalMs / 1000) || 30;
        $('rule-click-refresh').checked = ar.clickRefresh?.enabled || false;
        $('rule-click-selector').value = ar.clickRefresh?.buttonSelector || '';
        $('rule-click-interval').value = (ar.clickRefresh?.intervalMs / 1000) || 60;
        const da = ruleBeingEdited.detectionAction || {};
        $('rule-detection-action').checked = da.enabled || false;
        $('detection-action-config').style.display = da.enabled ? 'block' : 'none';
        $('rule-action-selector').value = da.buttonSelector || '';
        editingRuleId = fs._editRuleId;
      }
    }
    if (pending._pendingPickResult?.selector && fs._pickerTarget) {
      $(fs._pickerTarget).value = pending._pendingPickResult.selector;
      // Auto-detect element type from picker result
      if (pending._pendingPickResult.elType) {
        const targetId = fs._pickerTarget.replace('-selector', '');
        const typeSelect = $(targetId + '-type');
        if (typeSelect) {
          typeSelect.value = pending._pendingPickResult.elType;
          typeSelect.dispatchEvent(new Event('change'));
        }
      }
    }
  }
});

// ============================================================
// Storage
// ============================================================
async function loadStorage() {
  const data = await chrome.storage.local.get(['rules', 'settings']);
  rules = data.rules || [];
  settings = data.settings || { globalEnabled: true };
}
async function save() { await chrome.storage.local.set({ rules, settings }); }

function restoreForm(fs) {
  if (!fs) return;
  if (fs._formName) $('rule-name').value = fs._formName;
  if (fs._formUrl) $('rule-url').value = fs._formUrl;
  if (fs._formUrlMode) $('rule-url-mode').value = fs._formUrlMode;
  if (fs._formNotifyMethod) $('rule-notify-method').value = fs._formNotifyMethod;
  if (fs._formNotifyTemplate) $('rule-notify-template').value = fs._formNotifyTemplate;
  if (fs._formCooldown) $('rule-cooldown').value = fs._formCooldown;
  if (fs._formRefreshEnabled) { $('rule-refresh-enabled').checked = true; $('refresh-config').style.display = 'block'; }
  if (fs._formTimedRefresh) $('rule-timed-refresh').checked = true;
  if (fs._formTimedInterval) $('rule-timed-interval').value = fs._formTimedInterval;
  if (fs._formClickRefresh) $('rule-click-refresh').checked = true;
  if (fs._formClickSelector) $('rule-click-selector').value = fs._formClickSelector;
  if (fs._formClickInterval) $('rule-click-interval').value = fs._formClickInterval;
  if (fs._formDetectionAction) { $('rule-detection-action').checked = true; $('detection-action-config').style.display = 'block'; }
  if (fs._formActionSelector) $('rule-action-selector').value = fs._formActionSelector;
}

// ============================================================
// Event Bindings
// ============================================================
function bindEvents() {
  $('rule-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const a = btn.dataset.action, id = btn.dataset.ruleId;
    if (a === 'edit')   doEdit(id);
    if (a === 'toggle') doToggle(id);
    if (a === 'delete') doDelete(id);
  });

  $('global-toggle').addEventListener('change', () => {
    settings.globalEnabled = $('global-toggle').checked;
    save().then(renderList);
    chrome.runtime.sendMessage({ type: settings.globalEnabled ? 'RESUME_MONITORING' : 'PAUSE_MONITORING' }).catch(()=>{});
  });

  // Export config
  $('export-btn').addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['rules', 'settings']);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `page-monitor-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import config
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.rules && !data.settings) throw new Error('无效的配置文件');
      if (!confirm(`导入 ${(data.rules||[]).length} 条规则和设置，是否覆盖当前配置？`)) return;
      if (data.rules) await chrome.storage.local.set({ rules: data.rules });
      if (data.settings) await chrome.storage.local.set({ settings: data.settings });
      await loadStorage();
      renderList();
      alert('导入成功');
    } catch (err) {
      alert('导入失败: ' + err.message);
    }
    e.target.value = '';
  });

  $('add-rule-btn').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    showForm(null, tabs[0]?.url || '');
  });

  $('add-dom-target-btn').addEventListener('click', () => addTargetRow());

  $('rule-form').addEventListener('submit', e => { e.preventDefault(); saveForm(); });
  $('delete-rule-btn').addEventListener('click', () => deleteCurrentRule());
  document.querySelectorAll('.cancel-form').forEach(el => el.addEventListener('click', hideForm));

  // Pickers
  $('pick-refresh-btn').addEventListener('click', () => startPicking('rule-click-selector'));
  $('pick-action-btn').addEventListener('click', () => startPicking('rule-action-selector'));

  $('scan-elements-btn').addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) return;
    const btn = $('scan-elements-btn');
    btn.disabled = true; btn.textContent = '扫描中...';
    $('recommendations').style.display = 'none';
    try {
      const resp = await chrome.tabs.sendMessage(tabs[0].id, { type: 'SCAN_ELEMENTS' });
      if (resp?.elements?.length) {
        mmRecos = resp.elements;
        showRecommendations(resp.elements);
      } else alert('未发现状态元素');
    } catch { alert('无法扫描，请刷新目标页面后重试'); }
    btn.disabled = false; btn.textContent = '推荐';
  });

  $('rule-refresh-enabled').addEventListener('change', e => {
    $('refresh-config').style.display = e.target.checked ? 'block' : 'none';
  });
  $('rule-detection-action').addEventListener('change', e => {
    $('detection-action-config').style.display = e.target.checked ? 'block' : 'none';
  });
  $('add-endpoint-btn').addEventListener('click', () => addEndpointRow());
  $('add-trigger-btn').addEventListener('click', () => addTriggerRow());
  $('api-endpoints').addEventListener('click', e => {
    if (e.target.classList.contains('remove-endpoint')) {
      const row = e.target.closest('.api-endpoint-row');
      if (row && $('api-endpoints').children.length > 1) row.remove();
    }
  });
}

let mmRecos = [];

// ============================================================
// Target Rows
// ============================================================
function addTargetRow(data) {
  data = data || { selector: '', type: 'element', checkMode: 'presence', checkValue: '' };
  // Use provided id or generate new one
  let idx, id;
  if (data.id && data.id.startsWith('target-')) {
    id = data.id;
    idx = parseInt(id.replace('target-', '')) || targetCounter;
    if (idx >= targetCounter) targetCounter = idx + 1;
  } else {
    idx = targetCounter++;
    id = 'target-' + idx;
  }

  const row = document.createElement('div');
  row.className = 'dom-target-row';
  row.id = id + '-row';
  row.innerHTML = `
    <div class="target-header">
      <input type="text" id="${id}-selector" class="form-input" placeholder="CSS 选择器" value="${esc(data.selector||'')}">
      <button type="button" class="btn btn-text btn-sm pick-target" data-target="${id}">选取</button>
      <select id="${id}-type" class="form-select">
        <option value="element" ${(data.type||'element')==='element'?'selected':''}>元素</option>
        <option value="checkbox" ${data.type==='checkbox'?'selected':''}>复选框</option>
        <option value="input" ${data.type==='input'?'selected':''}>输入框</option>
        <option value="select" ${data.type==='select'?'selected':''}>下拉框</option>
      </select>
      <button type="button" class="btn btn-text btn-sm remove-target" data-row="${id}-row">✕</button>
    </div>
    <div class="target-detail" id="${id}-detail">
    </div>
    <div class="target-detail">
      <input type="text" id="${id}-textfilter" class="form-input" placeholder="文本过滤（可选，只匹配包含此文本的元素）" value="${esc(data.textFilter||'')}">
    </div>
  `;

  $('dom-targets').appendChild(row);

  // Explicitly set values via .value to avoid escaping issues
  const selInput = row.querySelector(`#${id}-selector`);
  if (selInput) selInput.value = data.selector || '';
  const tfInput = row.querySelector(`#${id}-textfilter`);
  if (tfInput) tfInput.value = data.textFilter || '';

  // Wire events
  const typeSelect = row.querySelector(`#${id}-type`);
  typeSelect.value = data.type || 'element';
  typeSelect.addEventListener('change', () => updateTargetDetail(id));

  row.querySelector('.pick-target').addEventListener('click', () => startPicking(`${id}-selector`));
  row.querySelector('.remove-target').addEventListener('click', () => {
    const el = $(`${id}-row`);
    if ($('dom-targets').children.length > 1) el.remove();
  });

  updateTargetDetail(id, data);
}

function updateTargetDetail(id, data) {
  const type = data?.type || $(`${id}-type`)?.value || 'element';
  const detail = $(`${id}-detail`);
  if (!detail) return;

  if (type === 'element') {
    detail.innerHTML = `
      <select id="${id}-mode" class="form-select">
        <option value="presence" ${(data?.checkMode||'presence')==='presence'?'selected':''}>元素存在时触发</option>
        <option value="absence" ${data?.checkMode==='absence'?'selected':''}>元素消失时触发</option>
      </select>
    `;
  } else if (type === 'checkbox') {
    detail.innerHTML = `
      <select id="${id}-mode" class="form-select">
        <option value="checked" ${(data?.checkMode||'checked')==='checked'?'selected':''}>已勾选时触发</option>
        <option value="unchecked" ${data?.checkMode==='unchecked'?'selected':''}>未勾选时触发</option>
      </select>
    `;
  } else if (type === 'input') {
    detail.innerHTML = `
      <select id="${id}-mode" class="form-select">
        <option value="value-match">值匹配时触发</option>
      </select>
      <input type="text" id="${id}-value" class="form-input" placeholder="预期值或正则" value="${esc(data?.checkValue||'')}">
    `;
  } else if (type === 'select') {
    detail.innerHTML = `
      <select id="${id}-mode" class="form-select">
        <option value="value-match">选中值匹配时触发</option>
      </select>
      <input type="text" id="${id}-value" class="form-input" placeholder="预期选中值" value="${esc(data?.checkValue||'')}">
    `;
  }
}

function collectTargets() {
  const targets = [];
  $('dom-targets').querySelectorAll('.dom-target-row').forEach(row => {
    const id = row.id.replace('-row', '');
    const sel = $(id + '-selector');
    const type = $(id + '-type');
    const mode = $(id + '-mode');
    const val = $(id + '-value');
    const tf = $(id + '-textfilter');
    targets.push({
      id: id,
      selector: sel ? sel.value.trim() : '',
      type: type ? type.value : 'element',
      checkMode: mode ? mode.value : 'presence',
      checkValue: val ? val.value.trim() : '',
      textFilter: tf ? tf.value.trim() : '',
    });
  });
  return targets;
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
    const tc = (r.domTargets?.length) || (r.domSelector ? 1 : 0);
    const type = tc > 0 ? `${tc}个DOM` : (r.apiEndpoints?.length ? 'API' : '—');
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
// Rule Actions
// ============================================================
function doEdit(id) { const r = rules.find(x => x.id === id); if (r) showForm(r); }
function doToggle(id) {
  const r = rules.find(x => x.id === id); if (!r) return;
  r.enabled = !r.enabled; r.updatedAt = Date.now(); save().then(renderList);
}
function doDelete(id) {
  if (!confirm('确定删除？')) return;
  rules = rules.filter(x => x.id !== id); save().then(renderList);
}
function deleteCurrentRule() {
  const formId = $('rule-form').dataset.ruleId; if (!formId) return;
  if (!confirm('确定删除？')) return;
  rules = rules.filter(x => x.id !== formId); save().then(hideForm);
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
  $('dom-targets').innerHTML = '';
  $('block-triggers').innerHTML = '';
  targetCounter = 0;
  triggerCounter = 0;

  if (rule) {
    $('form-title').textContent = '编辑规则';
    $('rule-form').dataset.ruleId = rule.id;
    $('delete-rule-btn').style.display = 'block';
    $('rule-name').value = rule.name || '';
    $('rule-url').value = rule.url || '';
    $('rule-url-mode').value = rule.urlMatchMode || 'contains';
    $('rule-notify-method').value = rule.notificationMethod || 'system';
    $('rule-notify-template').value = rule.notificationTemplate || '';
    $('rule-cooldown').value = (rule.cooldownMs / 1000) || 60;

    const ar = rule.autoRefresh || {};
    $('rule-refresh-enabled').checked = ar.enabled || false;
    $('refresh-config').style.display = ar.enabled ? 'block' : 'none';
    $('rule-timed-refresh').checked = ar.timedRefresh?.enabled || false;
    $('rule-timed-interval').value = (ar.timedRefresh?.intervalMs / 1000) || 30;
    $('rule-click-refresh').checked = ar.clickRefresh?.enabled || false;
    $('rule-click-selector').value = ar.clickRefresh?.buttonSelector || '';
    $('rule-click-interval').value = (ar.clickRefresh?.intervalMs / 1000) || 60;

    const da = rule.detectionAction || {};
    $('rule-detection-action').checked = da.enabled || false;
    $('detection-action-config').style.display = da.enabled ? 'block' : 'none';
    $('rule-action-selector').value = da.buttonSelector || '';

    // DOM targets: migrate old format if needed
    const targets = rule.domTargets?.length ? rule.domTargets
      : rule.domSelector ? [{ selector: rule.domSelector, type: 'element', checkMode: rule.domCheckMode || 'presence' }]
      : [];
    targets.forEach(t => addTargetRow(t));
    if (!targets.length) addTargetRow();

    // Block triggers
    (rule.blockTriggers || []).forEach(t => addTriggerRow(t));

    (rule.apiEndpoints || [{ method: 'ANY', pathPattern: '' }]).forEach(addEndpointRow);
  } else {
    $('form-title').textContent = '新建规则';
    $('rule-form').removeAttribute('data-rule-id');
    $('delete-rule-btn').style.display = 'none';
    if (defaultUrl) $('rule-url').value = defaultUrl;
    $('refresh-config').style.display = 'none';
    addTargetRow();
    addEndpointRow();
  }
}

function hideForm() {
  $('rule-form-section').style.display = 'none';
  $('rule-list-section').style.display = 'block';
  $('rule-form').removeAttribute('data-rule-id');
  loadStorage().then(renderList);
}

function saveForm() {
  const formId = $('rule-form').dataset.ruleId;
  const name = $('rule-name').value.trim();
  const url = $('rule-url').value.trim();
  if (!name) return alert('规则名称不能为空');
  if (!url) return alert('监控 URL 不能为空');

  const endpoints = [];
  $('api-endpoints').querySelectorAll('.api-endpoint-row').forEach(row => {
    const m = row.querySelector('.api-method')?.value || 'ANY';
    const p = row.querySelector('.api-path')?.value?.trim();
    if (!p) return;
    endpoints.push({ method: m, pathPattern: p,
      responseCheckField: row.querySelector('.api-field')?.value?.trim() || '',
      responseCheckValue: row.querySelector('.api-value')?.value?.trim() || '' });
  });

  const domTargets = collectTargets().filter(t => t.selector);
  const blockTriggers = collectTriggers().filter(t => t.selector);

  const rule = {
    ...(formId ? { id: formId } : {}),
    name, url,
    urlMatchMode: $('rule-url-mode').value,
    domTargets,
    blockTriggers,
    apiEndpoints: endpoints,
    notificationMethod: $('rule-notify-method').value,
    notificationTemplate: $('rule-notify-template').value.trim(),
    cooldownMs: parseInt($('rule-cooldown').value) * 1000 || 60000,
    autoRefresh: {
      enabled: $('rule-refresh-enabled').checked,
      timedRefresh: { enabled: $('rule-timed-refresh').checked, intervalMs: parseInt($('rule-timed-interval').value) * 1000 || 30000 },
      clickRefresh: { enabled: $('rule-click-refresh').checked, buttonSelector: $('rule-click-selector').value.trim(), intervalMs: parseInt($('rule-click-interval').value) * 1000 || 60000 },
    },
    detectionAction: { enabled: $('rule-detection-action').checked, buttonSelector: $('rule-action-selector').value.trim() },
  };

  if (formId) {
    const idx = rules.findIndex(x => x.id === formId);
    if (idx >= 0) rules[idx] = { ...rules[idx], ...rule, updatedAt: Date.now() };
  } else {
    rule.id = rule.id || crypto.randomUUID();
    rule.enabled = true;
    rule.lastTriggeredAt = null;
    rule.createdAt = Date.now();
    rule.updatedAt = Date.now();
    rules.push(rule);
  }

  save().then(hideForm).then(() => {
    chrome.runtime.sendMessage({ type: 'RULE_SAVED', payload: { rule } }).catch(() => {});
  });
  alert('规则已保存。请刷新目标监控页面后规则才会生效。');
}

// ============================================================
// Block Triggers
// ============================================================
function addTriggerRow(data) {
  data = data || { selector: '' };
  const idx = ++triggerCounter;
  const id = 'trigger-' + idx;

  const row = document.createElement('div');
  row.className = 'dom-target-row';
  row.id = id + '-row';
  row.innerHTML = `
    <div class="target-header">
      <input type="text" id="${id}-selector" class="form-input" placeholder="按钮 CSS 选择器" value="${esc(data.selector||'')}">
      <button type="button" class="btn btn-text btn-sm pick-target" data-target="${id}">选取</button>
      <button type="button" class="btn btn-text btn-sm remove-target" data-row="${id}-row">✕</button>
    </div>
  `;

  $('block-triggers').appendChild(row);
  const trigSel = row.querySelector(`#${id}-selector`);
  if (trigSel) trigSel.value = data.selector || '';
  row.querySelector('.pick-target').addEventListener('click', () => startPicking(id + '-selector'));
  row.querySelector('.remove-target').addEventListener('click', () => {
    if ($('block-triggers').children.length > 0) row.remove();
  });
}

function collectTriggers() {
  const triggers = [];
  $('block-triggers').querySelectorAll('.dom-target-row').forEach(row => {
    const id = row.id.replace('-row', '');
    const sel = $(id + '-selector');
    // Save all rows, including empty ones (so picker state can restore them)
    triggers.push({ selector: sel ? sel.value.trim() : '' });
  });
  return triggers;
}

// ============================================================
// Picker
// ============================================================
async function startPicking(targetInputId) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;
  // Save all current form state including domTargets and triggers
  const currentTargets = collectTargets();
  const currentTriggers = collectTriggers();
  await chrome.storage.local.set({
    _pickFormState: {
      _formName: $('rule-name').value,
      _formUrl: $('rule-url').value,
      _formUrlMode: $('rule-url-mode').value,
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
      _domTargets: currentTargets,
      _blockTriggers: currentTriggers,
      _editRuleId: $('rule-form').dataset.ruleId || '',
    }
  });
  try { await chrome.tabs.sendMessage(tabs[0].id, { type: 'START_PICKING' }); } catch {}
  window.close();
}

// ============================================================
// Recommendations
// ============================================================
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
      // Fill into the first target row's selector
      const firstSel = $('dom-targets').querySelector('[id$="-selector"]');
      if (firstSel) firstSel.value = item.dataset.sel;
    });
  });
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

function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}时前` : `${Math.floor(h / 24)}天前`;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
