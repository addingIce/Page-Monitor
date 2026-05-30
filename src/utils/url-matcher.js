/**
 * URL matching modes:
 * - contains: target URL includes the rule URL (substring, case-insensitive) — DEFAULT
 * - exact: must match exactly (with trailing slash normalization)
 * - glob: supports * as wildcard
 * - regex: full regex match
 */

export function matchUrl(ruleUrl, targetUrl, mode = 'contains') {
  switch (mode) {
    case 'contains':
      return matchContains(ruleUrl, targetUrl);
    case 'exact':
      return matchExact(ruleUrl, targetUrl);
    case 'glob':
      return matchGlob(ruleUrl, targetUrl);
    case 'regex':
      return matchRegex(ruleUrl, targetUrl);
    default:
      return matchContains(ruleUrl, targetUrl);
  }
}

export function filterRulesByUrl(rules, url) {
  return rules.filter(r => {
    if (!r.enabled) return false;
    return matchUrl(r.url, url, r.urlMatchMode || 'contains');
  });
}

function matchContains(pattern, url) {
  return url.toLowerCase().includes(pattern.toLowerCase());
}

function matchExact(pattern, url) {
  const normalize = (s) => s.replace(/\/+$/, '').toLowerCase();
  return normalize(pattern) === normalize(url);
}

function matchGlob(pattern, url) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`, 'i').test(url);
  } catch {
    return false;
  }
}

function matchRegex(pattern, url) {
  try {
    return new RegExp(pattern, 'i').test(url);
  } catch {
    return false;
  }
}
