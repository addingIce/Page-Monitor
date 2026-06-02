function matchValue(pattern, value) {
  const hasRegexChars = /[.*+?^${}()|[\]\\]/.test(pattern);
  if (hasRegexChars) {
    try { return new RegExp(pattern, 'i').test(value); }
    catch { return value.toLowerCase().includes(pattern.toLowerCase()); }
  }
  return value.toLowerCase() === pattern.toLowerCase();
}

class TriggerInterceptor {
  constructor() {
    this.rules = [];
    this._onClick = this._onClick.bind(this);
    this._active = false;
    this._bypassMap = {}; // selector -> true (one-shot bypass for next click)
  }

  start(rules) {
    this.rules = rules.filter(r =>
      r.enabled && r.blockTriggers && r.blockTriggers.length > 0
    );
    if (this.rules.length === 0) return;
    if (!this._active) {
      document.addEventListener('click', this._onClick, true); // capture phase
      this._active = true;
    }
    console.log('[PageMonitor] TriggerInterceptor active with', this.rules.length, 'rules');
  }

  _onClick(e) {
    // Find which trigger selectors were hit
    const hitTriggers = [];
    for (const rule of this.rules) {
      for (const trigger of (rule.blockTriggers || [])) {
        if (!trigger.selector) continue;
        if (e.target.closest(trigger.selector)) {
          const bypassKey = rule.id + '|' + trigger.selector;
          if (this._bypassMap[bypassKey]) {
            console.log('[PageMonitor] Trigger bypass-once, allowing:', bypassKey);
            delete this._bypassMap[bypassKey];
          } else {
            hitTriggers.push({ trigger, rule, bypassKey });
          }
        }
      }
    }
    if (hitTriggers.length === 0) return;

    // Block the click
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Check ALL rules' domTargets (from dom-monitor which has all rules)
    const allRules = (window.__domMonitor && window.__domMonitor.rules) || window.__currentRules || this.rules;
    console.log('[PageMonitor] Checking all rules:', allRules.length, 'rules');
    const blockingRules = [];
    for (const rule of allRules) {
      const matched = this.checkRule(rule);
      console.log('[PageMonitor]   rule:', rule.name, 'matched:', matched ? matched.length : 0);
      if (matched) {
        blockingRules.push({ rule, matched, triggerSelector: hitTriggers[0].trigger.selector });
      }
    }

    if (blockingRules.length > 0) {
      console.log('[PageMonitor] Blocking click!', blockingRules.length, 'rules matched, details:', blockingRules.map(b => ({ rule: b.rule.name, targets: b.matched.length, totalCount: b.matched.reduce((s,m) => s + (m.elementCount||1), 0) })));
      for (const { rule, matched, triggerSelector } of blockingRules) {
        chrome.runtime.sendMessage({
          type: 'TRIGGER_BLOCKED',
          payload: {
            ruleId: rule.id,
            ruleName: rule.name,
            ruleNotificationMethod: rule.notificationMethod || 'system',
            ruleNotificationTemplate: rule.notificationTemplate || '',
            triggerSelector,
            url: location.href,
            timestamp: Date.now(),
            details: matched,
          },
        }).catch(() => {});
      }
    }
  }

  checkRule(rule) {
    const targets = rule.domTargets?.length ? rule.domTargets
      : rule.domSelector ? [{ selector: rule.domSelector, type: 'element', checkMode: rule.domCheckMode || 'presence' }]
      : [];
    console.log('[PageMonitor] checkRule:', rule.name, 'targets:', targets.length);

    const matched = [];
    for (const target of targets) {
      const result = this.checkTarget(target);
      console.log('[PageMonitor]   target:', target.selector, 'type:', target.type, 'found:', result.found, 'count:', result.elementCount);
      if (result.found) matched.push(result);
    }
    return matched.length > 0 ? matched : null;
  }

  checkTarget(target) {
    const selector = target.selector || '';
    const type = target.type || 'element';
    const checkMode = target.checkMode || 'presence';
    const checkValue = target.checkValue || '';
    const textFilter = target.textFilter || '';
    if (!selector) return { found: false };

    switch (type) {
      case 'element': {
        const allEls = document.querySelectorAll(selector);
        let elements = Array.from(allEls);
        if (textFilter && textFilter.trim()) {
          const tf = textFilter.trim().toLowerCase();
          elements = elements.filter(el => (el.textContent || '').toLowerCase().includes(tf));
        }
        const count = elements.length;
        return { found: count > 0, selector, elementCount: count, sampleText: count > 0 ? (elements[0].textContent || '').trim().substring(0, 100) : '' };
      }
      case 'checkbox': {
        const cb = document.querySelector(selector);
        if (!cb) return { found: false };
        const isChecked = cb.checked === true;
        return { found: (checkMode === 'checked') ? isChecked : !isChecked, selector, elementCount: isChecked ? 1 : 0, sampleText: cb.value || '' };
      }
      case 'input': {
        const inp = document.querySelector(selector);
        if (!inp) return { found: false };
        const val = inp.value || '';
        let found = val.length > 0;
        if (checkValue) found = matchValue(checkValue, val);
        return { found, selector, elementCount: found ? 1 : 0, sampleText: val };
      }
      case 'select': {
        const selEl = document.querySelector(selector);
        if (!selEl) return { found: false };
        const val = selEl.value || '';
        let found = val.length > 0;
        if (checkValue) found = matchValue(checkValue, val);
        return { found, selector, elementCount: found ? 1 : 0, sampleText: val };
      }
    }
    return { found: false };
  }

  bypassOnce(selector, ruleId) {
    const key = (ruleId || '') + '|' + selector;
    this._bypassMap[key] = true;
    console.log('[PageMonitor] Trigger bypass-once set:', key);
  }

  updateRules(newRules) {
    this.stop();
    this.start(newRules);
  }

  stop() {
    if (this._active) {
      document.removeEventListener('click', this._onClick, true);
      this._active = false;
    }
    this.rules = [];
  }
}

window.__triggerInterceptor = new TriggerInterceptor();
