/**
 * Match value against pattern:
 * - If pattern contains regex special chars, use regex match
 * - Otherwise do exact string match (case-insensitive)
 */
function matchValue(pattern, value) {
  const hasRegexChars = /[.*+?^${}()|[\]\\]/.test(pattern);
  if (hasRegexChars) {
    try {
      return new RegExp(pattern, 'i').test(value);
    } catch {
      // Broken regex, fall back to includes
      return value.toLowerCase().includes(pattern.toLowerCase());
    }
  }
  return value.toLowerCase() === pattern.toLowerCase();
}

function getVisibleText(el) {
  if (!el) return '';
  if (!el.children || el.children.length === 0) {
    return (el.textContent || '').trim().substring(0, 200);
  }
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += ' ' + node.textContent;
  }
  if (text.trim()) return text.trim().substring(0, 200);
  return (el.innerText || '').trim().substring(0, 200);
}

class DomMonitor {
  constructor() {
    this.rules = [];
    this.observer = null;
    this._checkTimer = null;
    this.debounceMs = 300;
    this._lastState = {};
    this._paused = false;

    // Always listen for form events (MutationObserver doesn't detect value changes)
    this._formListener = () => {
      if (this.rules.length > 0 && !this._paused) this.scheduleCheck();
    };
    document.addEventListener('input', this._formListener, true);
    document.addEventListener('change', this._formListener, true);
  }

  start(rules, pageUrl) {
    this.rules = rules.filter(r => {
      const hasTargets = r.domTargets?.length > 0;
      const hasLegacy = r.domSelector && !hasTargets;
      const keep = r.enabled && (hasTargets || hasLegacy);
      // console.log('[PageMonitor] filter rule:', r.name, 'enabled:', r.enabled, 'targets:', r.domTargets?.length, 'keep:', keep);
      return keep;
    });
    if (this.rules.length === 0) {
      console.log('[PageMonitor] DomMonitor: no rules with dom targets');
      return;
    }
    console.log('[PageMonitor] DomMonitor starting with', this.rules.length, 'rules');

    if (!this.observer) {
      this.observer = new MutationObserver(() => this.scheduleCheck());
      this.observer.observe(document.documentElement, {
        childList: true, subtree: true,
      });
    }

    this.checkAllRules();
    // Repeated re-checks for async-populated content
    let delay = 1;
    for (let i = 0; i < 10; i++) {
      setTimeout(() => { if (this.rules.length > 0) this.checkAllRules(); }, delay * 1000);
      delay = Math.min(delay * 1.5, 10);
    }
  }

  scheduleCheck() {
    if (this._checkTimer) clearTimeout(this._checkTimer);
    this._checkTimer = setTimeout(() => this.checkAllRules(), this.debounceMs);
  }

  checkAllRules() {
    if (this._paused) return;
    if (this.rules.length === 0) return;
    for (const rule of this.rules) {
      // Get targets: new format or legacy
      const targets = rule.domTargets?.length ? rule.domTargets
        : rule.domSelector ? [{ selector: rule.domSelector, type: 'element', checkMode: rule.domCheckMode || 'presence' }]
        : [];
      if (!targets.length) continue;

      for (const target of targets) {
        this.checkTarget(rule, target);
      }
    }
  }

  checkTarget(rule, target) {
    const selector = target.selector || '';
    const type = target.type || 'element';
    const checkMode = target.checkMode || 'presence';
    const checkValue = target.checkValue || '';
    const textFilter = target.textFilter || '';
    if (!selector) return;

    const tid = rule.id + '|' + (target.id || selector);
    let found = false;
    let sampleText = '';
    let detailInfo = '';
    let matchCount = 0;

    switch (type) {
      case 'element': {
        const allEls = document.querySelectorAll(selector);
        let elements = Array.from(allEls);
        if (textFilter && textFilter.trim()) {
          const tf = textFilter.trim().toLowerCase();
          elements = elements.filter(el => (el.textContent || '').toLowerCase().includes(tf));
        }
        matchCount = elements.length;
        found = matchCount > 0;
        sampleText = getVisibleText(elements[0]) || '';
        detailInfo = found ? `${matchCount}个匹配` : '无匹配';
        if (textFilter && textFilter.trim()) detailInfo += ` (文本: "${textFilter}")`;
        // console.log('[PageMonitor] element check:', selector, 'all:', allEls.length, 'filtered:', matchCount);
        break;
      }

      case 'checkbox':
        // Check checkbox checked state
        const cb = document.querySelector(selector);
        if (!cb) { found = false; detailInfo = '无匹配元素'; break; }
        const isChecked = cb.checked === true;
        found = (checkMode === 'checked') ? isChecked : !isChecked;
        sampleText = cb.value || cb.name || cb.id || '';
        detailInfo = isChecked ? '已勾选' : '未勾选';
        break;

      case 'input': {
        const inp = document.querySelector(selector);
        if (!inp) { found = false; detailInfo = '无匹配元素'; break; }
        const val = inp.value || '';
        if (checkValue) {
          found = matchValue(checkValue, val);
        } else {
          found = val.length > 0;
        }
        sampleText = val;
        detailInfo = `值为: "${val.substring(0, 50)}"`;
        // console.log('[PageMonitor] input check:', selector, 'val:', val, 'checkValue:', checkValue, 'found:', found);
        break;
      }

      case 'select':
        // Check select value
        const selEl = document.querySelector(selector);
        if (!selEl) { found = false; detailInfo = '无匹配元素'; break; }
        const selVal = selEl.value || '';
        if (checkValue) {
          found = matchValue(checkValue, selVal);
        } else {
          found = selVal.length > 0;
        }
        sampleText = selVal;
        detailInfo = `选中: "${selVal}"`;
        break;
    }

    // matchCount fallback for non-element types
    if (type !== 'element') matchCount = found ? 1 : 0;

    // Build fingerprint
    const fp = type + '|' + found + '|' + sampleText.substring(0, 100);
    const prev = this._lastState[tid] || {};
    const stateChanged = prev.found === undefined || prev.found !== found;
    const contentChanged = !stateChanged && prev.fp !== fp;
    // For absence mode, found=false means "element absent" which IS the trigger condition
    const effectiveFound = (checkMode === 'absence') ? !found : found;
    const shouldReport = (stateChanged || contentChanged) && effectiveFound;

    if (shouldReport) console.log('[PageMonitor] target check:', selector, 'type:', type, 'found:', found, 'stateChanged:', stateChanged, 'contentChanged:', contentChanged);

    if (shouldReport) {
      this._lastState[tid] = { found, fp };
      this.executeAction(rule);

      const refreshTriggered = !!window.__autoRefreshTriggered;
      if (refreshTriggered) window.__autoRefreshTriggered = false;
      const hasDetectionAction = !!(rule.detectionAction?.enabled && rule.detectionAction?.buttonSelector);
      const bypassCooldown = refreshTriggered || hasDetectionAction;

      this.reportDetection(rule, {
        type: 'dom',
        target,
        selector,
        elementCount: matchCount,
        sampleText: sampleText || '',
        detail: detailInfo,
        targetType: type,
        targetCheckMode: checkMode,
      }, bypassCooldown);
    }
    // Always update fingerprint
    this._lastState[tid] = this._lastState[tid] || {};
    this._lastState[tid].fp = fp;
    this._lastState[tid].found = found;
  }

  executeAction(rule) {
    if (!rule.detectionAction?.enabled) return;
    const selector = rule.detectionAction?.buttonSelector;
    if (!selector) return;
    console.log('[PageMonitor] Executing detection action: clicking', selector);
    try {
      const btn = document.querySelector(selector);
      if (btn && typeof btn.click === 'function') {
        btn.click();
        console.log('[PageMonitor] Button clicked:', selector);
      }
    } catch (e) {
      console.error('[PageMonitor] Detection action failed:', e);
    }
  }

  reportDetection(rule, details, bypassCooldown) {
    console.log('[PageMonitor] REPORTING detection:', rule.name, details);
    chrome.runtime.sendMessage({
      type: 'STATUS_DETECTED',
      payload: {
        ruleId: rule.id,
        detectionType: 'dom',
        tabId: DomMonitor.currentTabId,
        url: location.href,
        timestamp: Date.now(),
        details,
        bypassCooldown: !!bypassCooldown,
      },
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[PageMonitor] Failed to report detection:', chrome.runtime.lastError.message);
      }
    });
  }

  updateRules(newRules) {
    this._lastState = {};
    this.rules = newRules.filter(r => {
      const hasTargets = r.domTargets?.length;
      const hasLegacy = r.domSelector && !hasTargets;
      return r.enabled && (hasTargets || hasLegacy);
    });
    if (this.rules.length === 0) {
      this.stop();
      return;
    }
    if (!this.observer) {
      this.observer = new MutationObserver(() => this.scheduleCheck());
      this.observer.observe(document.documentElement, {
        childList: true, subtree: true,
      });
    }
    this.checkAllRules();
  }

  pause() { this._paused = true; console.log('[PageMonitor] DomMonitor paused'); }
  resume() {
    if (this._paused) { this._paused = false; this._lastState = {}; this.checkAllRules(); console.log('[PageMonitor] DomMonitor resumed'); }
  }

  stop() {
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    if (this._checkTimer) { clearTimeout(this._checkTimer); this._checkTimer = null; }
    this.rules = []; this._lastState = {}; this._paused = false;
  }
}

DomMonitor.currentTabId = null;
window.__domMonitor = new DomMonitor();
