class AutoRefresh {
  constructor() {
    this.timers = [];
    this.rules = [];
  }

  start(rules) {
    this.rules = rules.filter(r => r.enabled && r.autoRefresh?.enabled);
    this.scheduleAll();
  }

  scheduleAll() {
    this.clearAll();

    for (const rule of this.rules) {
      const config = rule.autoRefresh;

      // Timed page refresh
      if (config.timedRefresh?.enabled) {
        const interval = Math.max(5000, config.timedRefresh.intervalMs || 30000);
        const timer = setInterval(() => {
          if (!this.shouldRefresh(rule)) return;
          window.__autoRefreshTriggered = true;
          location.reload();
        }, interval);
        this.timers.push(timer);
      }

      // Click refresh
      if (config.clickRefresh?.enabled && config.clickRefresh.buttonSelector) {
        const interval = Math.max(5000, config.clickRefresh.intervalMs || 60000);
        const timer = setInterval(() => {
          if (!this.shouldRefresh(rule)) return;
          window.__autoRefreshTriggered = true;
          this.clickButton(config.clickRefresh.buttonSelector);
        }, interval);
        this.timers.push(timer);
      }
    }
  }

  shouldRefresh(rule) {
    try {
      const ruleOrigin = new URL(rule.url).origin;
      return location.origin === ruleOrigin;
    } catch {
      return false;
    }
  }

  clickButton(selector) {
    try {
      const btn = document.querySelector(selector);
      if (btn && typeof btn.click === 'function') {
        btn.click();
      }
    } catch {
      // selector may be invalid
    }
  }

  updateRules(newRules) {
    this.rules = newRules.filter(r => r.enabled && r.autoRefresh?.enabled);
    this.scheduleAll();
  }

  clearAll() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  stop() {
    this.clearAll();
    this.rules = [];
  }
}

window.__autoRefresh = new AutoRefresh();
// exported via window.__autoRefresh
