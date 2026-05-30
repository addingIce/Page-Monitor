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
      } catch {
        // content script may not be available
      }
    }
  }
}

function buildMessage(detectionType, details, rule, pageUrl) {
  // Use custom template if available
  if (rule?.notificationTemplate) {
    return fillTemplate(rule.notificationTemplate, rule, details, pageUrl);
  }

  // Default format
  if (detectionType === 'dom') {
    let msg = `DOM 匹配: ${details.selector}`;
    if (details.elementCount > 0) msg += ` (${details.elementCount} 个元素)`;
    if (details.sampleText) msg += `\n示例: ${details.sampleText}`;
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

export { notifyStatusDetected };
