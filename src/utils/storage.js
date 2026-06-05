import { generateId } from './id-generator.js';

const STORAGE_KEYS = {
  RULES: 'rules',
  SETTINGS: 'settings',
  RULE_ORDER: 'ruleOrder',
};

const DEFAULT_SETTINGS = {
  globalEnabled: true,
  defaultCooldownMs: 60000,
  maxResponseSize: 10240,
  defaultNotificationMethod: 'system',
};

async function getRules() {
  try {
    const { rules } = await chrome.storage.local.get(STORAGE_KEYS.RULES);
    return rules ?? [];
  } catch {
    return [];
  }
}

async function setRules(rules) {
  await chrome.storage.local.set({ [STORAGE_KEYS.RULES]: rules });
}

async function getRuleById(id) {
  const rules = await getRules();
  return rules.find(r => r.id === id) ?? null;
}

async function saveRule(rule) {
  const rules = await getRules();
  // Ensure rule has an id
  if (!rule.id) {
    rule.id = generateId();
  }
  const idx = rules.findIndex(r => r.id === rule.id);
  if (idx >= 0) {
    rules[idx] = { ...rules[idx], ...rule, updatedAt: Date.now() };
  } else {
    rules.push({ ...rule, createdAt: Date.now(), updatedAt: Date.now() });
  }
  await setRules(rules);
  return rule;
}

async function deleteRule(id) {
  const rules = await getRules();
  const filtered = rules.filter(r => r.id !== id);
  await setRules(filtered);
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

async function setSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

export {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  getRules,
  setRules,
  getRuleById,
  saveRule,
  deleteRule,
  getSettings,
  setSettings,
};
