import { getRuleById, saveRule } from '../utils/storage.js';

async function notifyStatusDetected(payload, sender) {
  const { ruleId, detectionType, details, tabId, bypassCooldown } = payload;

  console.log('[PageMonitor] notifyStatusDetected called:', { ruleId, detectionType, details, bypassCooldown });

  const rule = await getRuleById(ruleId);
  if (!rule) {
    console.warn('[PageMonitor] Rule not found:', ruleId);
    return;
  }
  if (!rule.enabled) {
    console.log('[PageMonitor] Rule disabled, skipping notification');
    return;
  }

  // Cooldown check (skip if bypassCooldown is true — e.g., after auto-click)
  if (!bypassCooldown && rule.lastTriggeredAt) {
    const elapsed = Date.now() - rule.lastTriggeredAt;
    if (elapsed < rule.cooldownMs) {
      console.log('[PageMonitor] Cooldown active, skipping. elapsed:', elapsed, 'ms, cooldown:', rule.cooldownMs, 'ms');
      return;
    }
  }
  if (bypassCooldown) {
    console.log('[PageMonitor] Cooldown bypassed (detection action triggered)');
  }

  // Update last triggered
  rule.lastTriggeredAt = Date.now();
  await saveRule(rule);

  const title = rule.name || 'Page Monitor';
  const pageUrl = payload.url || details.url || '';
  const message = buildMessage(detectionType, details, rule, pageUrl);

  console.log('[PageMonitor] Sending notification:', title, message);

  // System notification
  if (rule.notificationMethod === 'system' || rule.notificationMethod === 'both') {
    const id = await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 2,
    });
    console.log('[PageMonitor] Notification created:', id);
  }

  // Sound notification
  if (rule.notificationMethod === 'sound' || rule.notificationMethod === 'both') {
    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'PLAY_SOUND',
          payload: { soundUrl: chrome.runtime.getURL('sounds/alarm.wav') },
        });
      } catch {}
    }
  }

  // Popup notification
  if (rule.notificationMethod === 'popup') {
    try {
      if (tabId) {
        await chrome.tabs.sendMessage(tabId, { type: 'SHOW_POPUP', payload: { title, message } });
      } else {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
          await chrome.tabs.sendMessage(tabs[0].id, { type: 'SHOW_POPUP', payload: { title, message } });
        }
      }
    } catch {}
  }
}

function buildMessage(detectionType, details, rule, pageUrl) {
  // Use custom template if available
  if (rule?.notificationTemplate) {
    return fillTemplate(rule.notificationTemplate, rule, details, pageUrl);
  }

  // Default format
  if (detectionType === 'dom') {
    const t = details.targetType || 'element';
    let msg = `[${rule.name}] `;
    if (t === 'element') {
      msg += `匹配: ${details.selector}`;
      if (details.elementCount > 0) msg += ` (${details.elementCount} 个)`;
    } else if (t === 'checkbox') {
      msg += `${details.selector} ${details.detail || ''}`;
    } else if (t === 'input') {
      msg += `输入框 ${details.selector} ${details.detail || ''}`;
    } else if (t === 'select') {
      msg += `下拉框 ${details.selector} ${details.detail || ''}`;
    } else {
      msg += `${details.selector} - ${details.detail || ''}`;
    }
    if (details.sampleText) msg += `\n内容: ${details.sampleText}`;
    return msg;
  }
  if (detectionType === 'network') {
    let msg = `API 响应匹配: ${details.method || 'GET'} ${details.url || details.apiUrl}`;
    if (details.responsePreview) msg += `\n内容: ${details.responsePreview}`;
    return msg;
  }
  return `检测到状态变化: ${JSON.stringify(details)}`;
}

function fillTemplate(template, rule, details, pageUrl) {
  const vars = {
    name: rule.name || '',
    selector: details.selector || '',
    text: details.sampleText || '',
    count: String(details.elementCount ?? ''),
    url: pageUrl || '',
  };
  console.log('[PageMonitor] Template vars:', vars);
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
  }
  console.log('[PageMonitor] Template result:', result);
  return result;
}

async function notifyTriggerBlocked(payload, sender) {
  const { ruleId, ruleName, ruleNotificationMethod, ruleNotificationTemplate, triggerSelector, details } = payload;
  console.log('[PageMonitor] Trigger blocked:', { ruleName, triggerSelector, details });

  const title = ruleName || 'Page Monitor';
  let message;
  // details is now an array of matched targets
  const matches = Array.isArray(details) ? details : [details];
  const totalCount = matches.reduce((sum, m) => sum + (m.elementCount || (m.found ? 1 : 0)), 0);

  if (ruleNotificationTemplate) {
    const first = matches[0] || {};
    message = fillTemplate(ruleNotificationTemplate, { name: ruleName }, {
      selector: triggerSelector,
      sampleText: first.sampleText || '',
      elementCount: totalCount,
    }, payload.url || '');
    message = `[拦截] ${message}`;
  } else {
    const lines = matches.map(m => `  · ${m.selector}: ${m.sampleText || '匹配'} (${m.elementCount || 1}个)`).join('\n');
    message = `⚠️ 操作已拦截\n触发的按钮: ${triggerSelector}\n匹配了 ${matches.length} 个目标 (共${totalCount}个元素):\n${lines}`;
  }

  if (ruleNotificationMethod === 'system' || ruleNotificationMethod === 'both') {
    const notifId = await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message: message + '\n\n点击「忽略」后需重新点击按钮',
      buttons: [{ title: '忽略（需重新点击）' }],
      priority: 2,
    });
    // Store context for button click
    if (triggerSelector) {
      await chrome.storage.local.set({ ['_snooze_' + notifId]: { triggerSelector, ruleId: payload.ruleId, tabId: payload.tabId } });
    }
  }
  if (ruleNotificationMethod === 'popup') {
    try {
      const targetTabId = payload.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (targetTabId) {
        await chrome.tabs.sendMessage(targetTabId, {
          type: 'SHOW_POPUP_WITH_CONFIRM',
          payload: { title, message, triggerSelector, ruleId: payload.ruleId },
        });
      }
    } catch {}
  }
}

export { notifyStatusDetected, notifyTriggerBlocked };
