class TriggerInterceptor {
  constructor() {
    this.rules = [];
    this._onClick = this._onClick.bind(this);
    this._active = false;
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
    for (const rule of this.rules) {
      for (const trigger of (rule.blockTriggers || [])) {
        if (!trigger.selector) continue;
        const btn = e.target.closest(trigger.selector);
        if (!btn) continue;

        console.log('[PageMonitor] Trigger button clicked:', trigger.selector);

        // Run checks on all dom targets for this rule
        const matched = this.checkRule(rule);
        if (matched) {
          console.log('[PageMonitor] Blocking click! Rule matched:', rule.name, 'targets:', matched.length);
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          // Report to SW for notification (include all matched targets)
          chrome.runtime.sendMessage({
            type: 'TRIGGER_BLOCKED',
            payload: {
              ruleId: rule.id,
              ruleName: rule.name,
              ruleNotificationMethod: rule.notificationMethod || 'system',
              ruleNotificationTemplate: rule.notificationTemplate || '',
              triggerSelector: trigger.selector,
              url: location.href,
              timestamp: Date.now(),
              details: matched, // array of matched targets
            },
          }).catch(() => {});
          return;
        }
      }
    }
  }

  checkRule(rule) {
    const targets = rule.domTargets?.length ? rule.domTargets
      : rule.domSelector ? [{ selector: rule.domSelector, type: 'element', checkMode: rule.domCheckMode || 'presence' }]
      : [];
    if (!targets.length) return null;

    const matched = [];
    for (const target of targets) {
      const result = this.checkTarget(target);
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
        if (checkValue) {
          try { found = new RegExp(checkValue, 'i').test(val); } catch { found = val.includes(checkValue); }
        }
        return { found, selector, elementCount: found ? 1 : 0, sampleText: val };
      }
      case 'select': {
        const sel = document.querySelector(selector);
        if (!sel) return { found: false };
        const val = sel.value || '';
        let found = val.length > 0;
        if (checkValue) {
          try { found = new RegExp(checkValue, 'i').test(val); } catch { found = val.includes(checkValue); }
        }
        return { found, selector, elementCount: found ? 1 : 0, sampleText: val };
      }
    }
    return { found: false };
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
