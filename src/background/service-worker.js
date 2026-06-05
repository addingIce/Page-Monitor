import {
  getAllRules,
  saveRule,
  deleteRule,
  getMatchingRules,
  saveSettings,
  createDefaultRule,
} from './rule-manager.js';
import { getSettings } from '../utils/storage.js';
import { notifyStatusDetected, notifyTriggerBlocked } from './notification.js';

async function handleMessage(message, sender) {
  const { type, payload } = message;

  switch (type) {
    // Rule management
    case 'RULE_GET_ALL': {
      const rules = await getAllRules();
      return { rules };
    }

    case 'RULE_GET_DEFAULT': {
      return { rule: createDefaultRule(payload?.overrides) };
    }

    case 'RULE_SAVE': {
      try {
        const rule = await saveRule(payload.rule);
        await pushRulesToMatchingTabs(rule.url);
        return { success: true, rule };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // Popup saves directly to storage and notifies SW to push to tabs
    case 'RULE_SAVED': {
      await pushRulesToMatchingTabs(payload.rule?.url || '');
      return { acknowledged: true };
    }

    case 'RULE_DELETE': {
      await deleteRule(payload.ruleId);
      await pushRulesToMatchingTabs('');
      return { success: true };
    }

    // Settings
    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { settings };
    }

    case 'SAVE_SETTINGS': {
      await saveSettings(payload.settings);
      return { success: true };
    }

    // Content script communication
    case 'CONTENT_SCRIPT_READY': {
      const rules = await getMatchingRules(payload.url);
      const settings = await getSettings();
      return { rules, settings, tabId: sender.tab?.id };
    }

    case 'STATUS_DETECTED': {
      await notifyStatusDetected(payload, sender);
      return { acknowledged: true };
    }

    case 'TRIGGER_BLOCKED': {
      payload.tabId = sender.tab?.id;
      await notifyTriggerBlocked(payload, sender);
      return { acknowledged: true };
    }

    case 'START_PICKING': {
      // Forward to content script (fire and forget - popup will close)
      chrome.tabs.sendMessage(payload.tabId, {
        type: 'START_PICKING',
        payload: {},
      }).catch(() => {});
      return { success: true };
    }

    case 'STOP_PICKING': {
      try {
        await chrome.tabs.sendMessage(payload.tabId, {
          type: 'STOP_PICKING',
          payload: {},
        });
        return { success: true };
      } catch {
        return { success: true };
      }
    }

    case 'PICK_RESULT': {
      await chrome.storage.local.set({ _pendingPickResult: payload });
      return { acknowledged: true };
    }

    case 'PAUSE_MONITORING':
    case 'RESUME_MONITORING': {
      // Broadcast to all tabs
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab.id) continue;
        try {
          await chrome.tabs.sendMessage(tab.id, { type, payload: {} });
        } catch {}
      }
      return { acknowledged: true };
    }

    case 'GET_PENDING_PICK_RESULT': {
      const { _pendingPickResult } = await chrome.storage.local.get('_pendingPickResult');
      if (_pendingPickResult) {
        await chrome.storage.local.remove('_pendingPickResult');
      }
      return { result: _pendingPickResult || null };
    }

    case 'SCAN_ELEMENTS': {
      try {
        const result = await chrome.tabs.sendMessage(payload.tabId, {
          type: 'SCAN_ELEMENTS',
          payload: {},
        });
        return { success: true, elements: result?.elements ?? [] };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    default:
      return { error: `Unknown message type: ${type}` };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const result = handleMessage(message, sender);
  if (result instanceof Promise) {
    result.then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  sendResponse(result);
});

async function pushRulesToMatchingTabs(url) {
  const tabs = await chrome.tabs.query({});
  const matchTasks = tabs
    .filter(t => t.url && t.id)
    .map(async tab => {
      const rules = await getMatchingRules(tab.url);
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'UPDATE_RULES',
          payload: { rules },
        });
      } catch {
        // Tab may not have content script loaded yet
      }
    });
  await Promise.all(matchTasks);
}

// On install, initialize default settings if needed
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  if (!settings) {
    await saveSettings({});
  }
});

// Handle notification button clicks ("本次不拦截" → bypass once + re-click)
chrome.notifications.onButtonClicked.addListener(async (notifId) => {
  console.log('[PageMonitor] Notification button clicked:', notifId);
  const key = '_snooze_' + notifId;
  const { [key]: ctx } = await chrome.storage.local.get(key);
  console.log('[PageMonitor] Snooze context:', ctx);
  if (ctx && ctx.triggerSelector) {
    await chrome.storage.local.remove(key);
    const tabId = ctx.tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    console.log('[PageMonitor] Sending BYPASS_ONCE to tab:', tabId, 'selector:', ctx.triggerSelector, 'ruleId:', ctx.ruleId);
    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'BYPASS_ONCE',
          payload: { selector: ctx.triggerSelector, ruleId: ctx.ruleId },
        });
        console.log('[PageMonitor] BYPASS_ONCE sent successfully');
      } catch (e) {
        console.error('[PageMonitor] Failed to send BYPASS_ONCE:', e);
      }
    }
  }
});

// When a tab finishes loading, check if we need to push rules
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const rules = await getMatchingRules(tab.url);
    if (rules.length > 0) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'UPDATE_RULES',
          payload: { rules },
        });
      } catch {
        // Content script may not be ready yet
      }
    }
  }
});
