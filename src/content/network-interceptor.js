class NetworkInterceptor {
  constructor() {
    this.rules = [];
    this._onMessage = this._onMessage.bind(this);
    this._listening = false;
  }

  start(rules) {
    this.rules = rules.filter(
      r => r.enabled && r.apiEndpoints && r.apiEndpoints.length > 0
    );

    if (this.rules.length === 0) return;

    // Inject page-inject.js into page context
    this.injectPageScript();

    // Start listening for messages from the page world
    if (!this._listening) {
      window.addEventListener('message', this._onMessage);
      this._listening = true;
    }
  }

  injectPageScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/content/page-inject.js');
    script.onload = () => script.remove();
    document.documentElement.appendChild(script);
  }

  _onMessage(event) {
    // Security: only accept messages from this window
    if (event.source !== window) return;
    if (event.data?.source !== '__PAGE_MONITOR__') return;

    const { type, url, method, status, responseBody } = event.data;
    if (!responseBody && type !== 'FETCH_COMPLETE' && type !== 'XHR_COMPLETE') return;

    for (const rule of this.rules) {
      for (const endpoint of rule.apiEndpoints) {
        if (!this.matchEndpoint(endpoint, { url, method })) continue;
        if (!this.checkResponse(endpoint, responseBody)) continue;

        this.reportDetection(rule, {
          type: 'network',
          url,
          method,
          status,
          endpointConfig: endpoint,
          responsePreview: (responseBody || '').substring(0, 200),
        });
      }
    }
  }

  matchEndpoint(endpoint, { url, method }) {
    if (endpoint.method !== 'ANY' && endpoint.method !== method) return false;
    if (!url) return false;
    return url.includes(endpoint.pathPattern);
  }

  checkResponse(endpoint, responseBody) {
    if (!responseBody) return false;

    const operator = endpoint.responseCheckOperator || 'contains';
    let fieldValue = responseBody;

    // If responseCheckField is specified, extract from JSON
    if (endpoint.responseCheckField) {
      try {
        const json = JSON.parse(responseBody);
        fieldValue = String(
          endpoint.responseCheckField
            .split('.')
            .reduce((obj, key) => obj?.[key], json) ?? ''
        );
      } catch {
        fieldValue = '';
      }
    }

    switch (operator) {
      case 'contains':
        return String(fieldValue).includes(endpoint.responseCheckValue);
      case 'equals':
        return String(fieldValue) === endpoint.responseCheckValue;
      case 'regex':
        try {
          return new RegExp(endpoint.responseCheckValue).test(String(fieldValue));
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  reportDetection(rule, details) {
    chrome.runtime.sendMessage({
      type: 'STATUS_DETECTED',
      payload: {
        ruleId: rule.id,
        detectionType: 'network',
        tabId: window.__domMonitor?.constructor?.currentTabId,
        url: location.href,
        timestamp: Date.now(),
        details,
      },
    }).catch(() => {});
  }

  updateRules(newRules) {
    this.rules = newRules.filter(
      r => r.enabled && r.apiEndpoints && r.apiEndpoints.length > 0
    );
  }

  stop() {
    this.rules = [];
    if (this._listening) {
      window.removeEventListener('message', this._onMessage);
      this._listening = false;
    }
  }
}

window.__networkInterceptor = new NetworkInterceptor();
// exported via window.__networkInterceptor
