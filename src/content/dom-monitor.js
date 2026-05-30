function getVisibleText(el) {
  if (!el) return '';
  // For leaf elements, just use textContent
  if (!el.children || el.children.length === 0) {
    return (el.textContent || '').trim().substring(0, 200);
  }
  // Try direct text nodes first
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += ' ' + node.textContent;
    }
  }
  if (text.trim()) return text.trim().substring(0, 200);
  // Fallback: use innerText (what user sees) for containers with no direct text
  return (el.innerText || '').trim().substring(0, 200);
}

class DomMonitor {
  constructor() {
    this.rules = [];
    this.observer = null;
    this._checkTimer = null;
    this.debounceMs = 200;
  }

  start(rules, pageUrl) {
    this.rules = rules.filter(r => r.domSelector && r.enabled);
    if (this.rules.length === 0) {
      console.log('[PageMonitor] DomMonitor: no rules with domSelector');
      return;
    }
    console.log('[PageMonitor] DomMonitor starting with', this.rules.length, 'rules on', pageUrl || location.href);
    for (const r of this.rules) {
      console.log('[PageMonitor]   watching:', r.domSelector, 'mode:', r.domCheckMode, 'url:', r.url);
    }

    this.observer = new MutationObserver(() => this.scheduleCheck());
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    // Initial check
    this.checkAllRules();
  }

  scheduleCheck() {
    if (this._checkTimer) clearTimeout(this._checkTimer);
    this._checkTimer = setTimeout(() => this.checkAllRules(), this.debounceMs);
  }

  checkAllRules() {
    for (const rule of this.rules) {
      let elements = Array.from(document.querySelectorAll(rule.domSelector));

      // Apply text filter if specified
      if (rule.textFilter) {
        const filter = rule.textFilter.toLowerCase();
        elements = elements.filter(el =>
          (el.textContent || '').toLowerCase().includes(filter)
        );
      }

      const found = elements.length > 0;
      const shouldReport = rule.domCheckMode === 'presence' ? found : !found;

      console.log('[PageMonitor] check:', rule.domSelector,
        'found:', elements.length,
        (rule.textFilter ? `(text filter: "${rule.textFilter}") ` : ''),
        'shouldReport:', shouldReport);

      if (shouldReport) {
        // Execute detection action first (e.g., click button)
        this.executeAction(rule);
        // One-shot cooldown bypass: only for the detection immediately after auto-refresh
        const refreshTriggered = !!window.__autoRefreshTriggered;
        if (refreshTriggered) window.__autoRefreshTriggered = false;
        const hasDetectionAction = !!(rule.detectionAction?.enabled && rule.detectionAction?.buttonSelector);
        const bypassCooldown = refreshTriggered || hasDetectionAction;
        this.reportDetection(rule, {
          type: 'dom',
          selector: rule.domSelector,
          elementCount: elements.length,
          sampleText: getVisibleText(elements[0]) || '',
        }, bypassCooldown);
      }
    }
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
    }).then(() => {
      console.log('[PageMonitor] Detection reported to SW successfully');
    }).catch(e => {
      console.error('[PageMonitor] Failed to report detection:', e);
    });
  }

  updateRules(newRules) {
    this.stop();
    this.start(newRules, location.href);
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this._checkTimer) {
      clearTimeout(this._checkTimer);
      this._checkTimer = null;
    }
    this.rules = [];
  }
}

// Static property for current tab ID
DomMonitor.currentTabId = null;

window.__domMonitor = new DomMonitor();
// exported via window.__domMonitor
