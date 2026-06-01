// Content script entry point - coordinates all monitoring modules
(function init() {
  console.log('[PageMonitor] Content script loaded on:', location.href);

  // Send ready signal to service worker, receive active rules
  chrome.runtime.sendMessage({
    type: 'CONTENT_SCRIPT_READY',
    payload: { url: location.href, tabId: null },
  }, response => {
    if (chrome.runtime.lastError) {
      console.warn('[PageMonitor] SW not responding:', chrome.runtime.lastError.message);
      return;
    }
    if (!response) {
      console.warn('[PageMonitor] Empty response from SW');
      return;
    }
    const { rules, settings, tabId } = response;
    console.log('[PageMonitor] Received', rules.length, 'rules from SW, tabId:', tabId, 'globalEnabled:', settings?.globalEnabled);

    if (tabId && window.__domMonitor) {
      window.__domMonitor.constructor.currentTabId = tabId;
    }

    // Respect global toggle
    if (window.__domMonitor) {
      if (settings && settings.globalEnabled === false) {
        window.__domMonitor._paused = true;
      }
      window.__domMonitor.start(rules, location.href);
      if (settings && settings.globalEnabled === false) {
        console.log('[PageMonitor] Monitoring paused (global toggle off)');
      }
    }
    if (window.__autoRefresh) {
      window.__autoRefresh.start(rules);
    }
    if (window.__elementPicker) {
      window.__elementPicker.init();
    }
    if (window.__networkInterceptor) {
      window.__networkInterceptor.start(rules);
    }
    if (window.__triggerInterceptor) {
      window.__triggerInterceptor.start(rules);
    }

    window.__currentRules = rules;
    window.__currentSettings = settings;
  });

  // Listen for messages from the service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, payload } = message;

    switch (type) {
      case 'UPDATE_RULES': {
        console.log('[PageMonitor] UPDATE_RULES:', payload.rules.length, 'rules');
        window.__currentRules = payload.rules;
        if (window.__domMonitor) window.__domMonitor.updateRules(payload.rules);
        if (window.__autoRefresh) window.__autoRefresh.updateRules(payload.rules);
        if (window.__networkInterceptor) window.__networkInterceptor.updateRules(payload.rules);
        if (window.__triggerInterceptor) window.__triggerInterceptor.updateRules(payload.rules);
        break;
      }

      case 'PLAY_SOUND': {
        playSound(payload.soundUrl);
        break;
      }

      case 'START_PICKING': {
        if (window.__elementPicker) window.__elementPicker.start();
        break;
      }

      case 'STOP_PICKING': {
        if (window.__elementPicker) window.__elementPicker.stop();
        break;
      }

      case 'SCAN_ELEMENTS': {
        const elements = scanElements();
        sendResponse({ elements });
        return true;
      }

      case 'PERFORM_CHECK': {
        if (window.__domMonitor) window.__domMonitor.checkAllRules();
        break;
      }

      case 'PAUSE_MONITORING': {
        if (window.__domMonitor) window.__domMonitor.pause();
        if (window.__triggerInterceptor) window.__triggerInterceptor.stop();
        break;
      }

      case 'RESUME_MONITORING': {
        if (window.__domMonitor) window.__domMonitor.resume();
        if (window.__triggerInterceptor) window.__triggerInterceptor.start(window.__currentRules || []);
        break;
      }
    }
  });
})();

function playSound(soundUrl) {
  const audio = new Audio(soundUrl);
  audio.volume = 0.7;
  audio.play().catch(() => {});
}

// ============================================================
// Smart element scanning
// ============================================================
function getVisibleText(el) {
  if (!el) return '';
  if (!el.children || el.children.length === 0) {
    return (el.textContent || '').trim().substring(0, 100);
  }
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += ' ' + node.textContent;
    }
  }
  if (text.trim()) return text.trim().substring(0, 100);
  return (el.innerText || '').trim().substring(0, 100);
}

const STATUS_KEYWORDS = [
  'error', 'fail', 'success', 'warning', 'pending',
  'loading', 'complete', 'done', 'ready', 'offline',
  'online', 'active', 'inactive', 'running', 'stopped',
  'critical', 'info', 'progress', 'timeout',
  '未完成', '已完成', '进行中', '待处理', '处理中',
  '失败', '成功', '警告', '错误', '异常',
  '待办', '已办', '已读', '未读',
  '开启', '关闭', '停用', '启用',
];

function scanElements() {
  const results = [];
  const seen = new Set();
  const keywordLower = STATUS_KEYWORDS.map(k => k.toLowerCase());

  // Only scan likely status-containing elements, not every element
  const candidates = new Set();
  // Add elements with status-related class/id
  for (const kw of keywordLower) {
    document.querySelectorAll(`[class*="${kw}" i], [id*="${kw}" i]`).forEach(el => candidates.add(el));
  }
  // Add elements with data-* attributes
  document.querySelectorAll('[data-status],[data-state],[data-type]').forEach(el => candidates.add(el));
  // Also scan <span> and <div> that might contain status text (limit scope)
  if (candidates.size < 10) {
    document.querySelectorAll('span, div.badge, div.tag, div.label, td').forEach(el => candidates.add(el));
  }

  let count = 0;
  for (const el of candidates) {
    if (count > 500) break; // protect against very large sets
    count++;

    const classes = Array.from(el.classList || []);
    const matchClasses = classes.filter(c =>
      keywordLower.some(kw => c.toLowerCase().includes(kw))
    );
    const text = (el.textContent || '').trim().toLowerCase();
    const matchText = keywordLower.some(kw => text.includes(kw));
    const id = (el.id || '').toLowerCase();
    const matchId = keywordLower.some(kw => id.includes(kw));

    if (matchClasses.length || matchText || matchId) {
      const selector = generateSelector(el);
      if (seen.has(selector)) continue;
      seen.add(selector);
      results.push({
        selector,
        tagName: el.tagName,
        id: el.id || undefined,
        classes: matchClasses.length ? matchClasses : undefined,
        sampleText: getVisibleText(el) || undefined,
        reason: matchClasses.length ? 'class' : matchId ? 'id' : 'text',
      });
      if (results.length >= 50) break;
    }
  }
  return results;
}

function generateSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  let current = el;
  while (current && current !== document.body && current !== document.documentElement) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    if (current.classList.length) {
      segment += '.' + Array.from(current.classList).slice(0, 3).map(c => CSS.escape(c)).join('.');
    }
    parts.unshift(segment);
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
      if (siblings.length > 1) {
        parts[0] = `${segment}:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }
    current = parent;
  }
  return parts.join(' > ');
}
