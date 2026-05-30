// This script runs in the page's main world (not isolated world)
// It intercepts fetch and XMLHttpRequest to capture response bodies

(function () {
  if (window.__pageMonitorInjected) return;
  window.__pageMonitorInjected = true;

  const MONITOR_NS = '__PAGE_MONITOR__';

  function sendToContent(data) {
    window.postMessage({ source: MONITOR_NS, ...data }, window.location.origin);
  }

  // --- Intercept fetch ---
  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input.url || '');
    const method = (init?.method || 'GET').toUpperCase();

    return nativeFetch.call(window, input, init).then(async (response) => {
      const clone = response.clone();
      try {
        const text = await clone.text();
        sendToContent({
          type: 'FETCH_COMPLETE',
          url,
          method,
          status: response.status,
          statusText: response.statusText,
          responseBody: text.substring(0, 10000),
          truncated: text.length > 10000,
        });
      } catch {
        // opaque response or stream error
      }
      return response;
    });
  };

  // --- Intercept XMLHttpRequest ---
  const { open: nativeOpen, send: nativeSend } = XMLHttpRequest.prototype;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__monitor_method = method;
    this.__monitor_url = typeof url === 'string' ? url : (url?.toString() || '');
    return nativeOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const xhr = this;
    const origReadyState = xhr.onreadystatechange;

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        try {
          sendToContent({
            type: 'XHR_COMPLETE',
            url: xhr.__monitor_url || '',
            method: xhr.__monitor_method || 'GET',
            status: xhr.status,
            responseBody: (xhr.responseText || '').substring(0, 10000),
            truncated: (xhr.responseText?.length || 0) > 10000,
          });
        } catch {
          // cross-origin etc.
        }
      }
      if (origReadyState) origReadyState.apply(xhr, arguments);
    };

    return nativeSend.apply(xhr, arguments);
  };
})();
