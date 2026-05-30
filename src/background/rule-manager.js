import {
  getRules,
  saveRule as storageSaveRule,
  deleteRule as storageDeleteRule,
  getSettings,
  setSettings,
} from '../utils/storage.js';
import { filterRulesByUrl } from '../utils/url-matcher.js';
import { generateId } from '../utils/id-generator.js';

function validateRule(rule) {
  if (!rule.name || typeof rule.name !== 'string') throw new Error('规则名称不能为空');
  if (!rule.url || typeof rule.url !== 'string') throw new Error('监控 URL 不能为空');
  if (rule.domSelector && typeof rule.domSelector !== 'string') throw new Error('CSS 选择器格式无效');
  return rule;
}

function createDefaultRule(overrides = {}) {
  return {
    id: generateId(),
    name: '',
    enabled: true,
    url: '',
    urlMatchMode: 'contains',
    domSelector: '',
    domCheckMode: 'presence',
    apiEndpoints: [],
    notificationMethod: 'system',
    cooldownMs: 60000,
    lastTriggeredAt: null,
    autoRefresh: {
      enabled: false,
      timedRefresh: { enabled: false, intervalMs: 30000 },
      clickRefresh: { enabled: false, buttonSelector: '', intervalMs: 60000 },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

async function getAllRules() {
  return await getRules();
}

async function saveRule(rule) {
  const validated = validateRule(rule);
  return await storageSaveRule(validated);
}

async function deleteRule(id) {
  await storageDeleteRule(id);
}

async function getMatchingRules(url) {
  const all = await getRules();
  const settings = await getSettings();
  if (!settings.globalEnabled) return [];
  return filterRulesByUrl(all, url);
}

async function saveSettings(settings) {
  await setSettings(settings);
}

export {
  createDefaultRule,
  validateRule,
  getAllRules,
  saveRule,
  deleteRule,
  getMatchingRules,
  saveSettings,
};
