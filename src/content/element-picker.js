class ElementPicker {
  constructor() {
    this.active = false;
    this.hoverEl = null;
    this.highlight = null;
    this.blocker = null;
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  init() {
    // Full-page transparent blocker — intercepts ALL clicks
    this.blocker = document.createElement('div');
    this.blocker.id = '__pm-blocker';
    this.blocker.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483646;
      cursor: crosshair; display: none;
    `;

    // Highlight rectangle
    this.highlight = document.createElement('div');
    this.highlight.id = '__pm-highlight';
    this.highlight.style.cssText = `
      position: fixed; pointer-events: none; z-index: 2147483647;
      background: rgba(66,133,244,0.2); border: 2px solid rgba(66,133,244,0.8);
      display: none; transition: all 0.08s ease;
    `;

    document.body.appendChild(this.highlight);
    document.body.appendChild(this.blocker);

    this.blocker.addEventListener('mousemove', this._onMouseMove);
    this.blocker.addEventListener('click', this._onClick);
  }

  start() {
    if (this.active) return;
    this.active = true;
    document.addEventListener('keydown', this._onKeyDown, true);
    this.blocker.style.display = 'block';
  }

  stop() {
    this.active = false;
    this.hideHighlight();
    document.removeEventListener('keydown', this._onKeyDown, true);
    this.blocker.style.display = 'none';
  }

  _onMouseMove(e) {
    // Hide blocker temporarily to find element underneath
    this.blocker.style.display = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    this.blocker.style.display = 'block';

    if (!el || el === this.highlight || el.id === '__pm-highlight' ||
        el === this.blocker || el.id === '__pm-blocker' ||
        el === document.body || el === document.documentElement) {
      this.hideHighlight();
      return;
    }

    const resolved = this.resolveToInput(el);
    if (resolved === this.hoverEl) return;
    this.hoverEl = resolved;
    const r = resolved.getBoundingClientRect();
    this.highlight.style.display = 'block';
    this.highlight.style.left = r.left + 'px';
    this.highlight.style.top = r.top + 'px';
    this.highlight.style.width = r.width + 'px';
    this.highlight.style.height = r.height + 'px';
  }

  _onClick(e) {
    if (!this.active) return;
    e.preventDefault();
    e.stopPropagation();

    let el = this.hoverEl;
    if (!el) {
      // Fallback: find element at click position
      this.blocker.style.display = 'none';
      el = document.elementFromPoint(e.clientX, e.clientY);
      this.blocker.style.display = 'block';
      if (el) el = this.resolveToInput(el);
    }
    if (!el || el === this.highlight || el === this.blocker ||
        el === document.body || el === document.documentElement) return;

    const selector = this.generateBestSelector(el);
    const elType = this.detectType(el);

    this.hideHighlight();
    this.stop();

    chrome.runtime.sendMessage({
      type: 'PICK_RESULT',
      payload: { selector, elType },
    }).catch(() => {});
  }

  _onKeyDown(e) {
    if (e.key === 'Escape' && this.active) {
      this.stop();
    }
  }

  // If element is a label or wrapper, find the actual radio/checkbox inside
  resolveToInput(el) {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return el;
    if (el.tagName === 'LABEL') {
      const forId = el.getAttribute('for');
      if (forId) {
        const target = document.getElementById(forId);
        if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return target;
      }
    }
    const inner = el.querySelector('input[type="radio"], input[type="checkbox"]');
    if (inner) return inner;
    if (el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox') return el;
    return el;
  }

  hideHighlight() {
    if (this.highlight) this.highlight.style.display = 'none';
    this.hoverEl = null;
  }

  detectType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      return (t === 'checkbox' || t === 'radio') ? 'checkbox' : 'input';
    }
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'input';
    const inner = el.querySelector('input, select, textarea');
    if (inner) {
      const itag = inner.tagName.toLowerCase();
      if (itag === 'input') {
        const it = (inner.type || 'text').toLowerCase();
        return (it === 'checkbox' || it === 'radio') ? 'checkbox' : 'input';
      }
      if (itag === 'select') return 'select';
      if (itag === 'textarea') return 'input';
    }
    return 'element';
  }

  // --- Selector generation (unchanged) ---

  generateBestSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const stableAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-tid', 'data-qa'];
    for (const attr of stableAttrs) {
      const val = el.getAttribute(attr);
      if (val) return `[${attr}="${CSS.escape(val)}"]`;
    }
    if ((el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) && el.name && el.value) {
      const attrSel = `input[name="${CSS.escape(el.name)}"][value="${CSS.escape(el.value)}"]`;
      if (document.querySelectorAll(attrSel).length === 1) return attrSel;
    }
    const meaningfulClasses = this.filterMeaningfulClasses(el);
    if (meaningfulClasses.length > 0) {
      const allClasses = meaningfulClasses.map(c => `.${CSS.escape(c)}`).join('');
      const allSel = `${el.tagName.toLowerCase()}${allClasses}`;
      if (document.querySelectorAll(allSel).length === 1) return allSel;
      if (meaningfulClasses.length >= 2) {
        const two = meaningfulClasses.slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
        const twoSel = `${el.tagName.toLowerCase()}${two}`;
        if (document.querySelectorAll(twoSel).length <= 3) return twoSel;
      }
      const best = this.pickBestClass(el);
      if (best) {
        const sel = `${el.tagName.toLowerCase()}.${CSS.escape(best)}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }
    const ancestor = this.findAnchorAncestor(el);
    if (ancestor) {
      const ancSel = this.generateBestSelector(ancestor);
      if (ancSel && !ancSel.includes('nth-of-type')) {
        const relPath = this.pathFromTo(ancestor, el);
        if (relPath) return ancSel + ' ' + relPath;
      }
    }
    return this.buildShortPath(el);
  }

  filterMeaningfulClasses(el) {
    const utilityPatterns = [
      /^[mp][tblrxy]?-\d+$/,
      /^(d-|flex-|justify-|align-|text-|bg-|border-|rounded-|shadow-|w-|h-|p-[0-9]|m-[0-9]|gap-|col-|row-|offset-|order-)/,
      /^(tw-|sm:|md:|lg:|xl:|hover:|focus:|active:)/,
      /^(ng-|css-|s-|scoped-|v-|react-|_|data-v-)/,
    ];
    return Array.from(el.classList).filter(c =>
      c.length >= 2 && !utilityPatterns.some(p => p.test(c))
    );
  }

  pickBestClass(el) {
    const meaningful = this.filterMeaningfulClasses(el);
    if (meaningful.length === 0) return (el.classList[0] || null);
    const statusLike = meaningful.filter(c =>
      /status|state|type|kind|level|badge|tag|label|text/i.test(c)
    );
    return (statusLike[0] || meaningful[0]);
  }

  findAnchorAncestor(el) {
    let current = el.parentElement;
    while (current && current !== document.body) {
      if (current.id) return current;
      if (current.getAttribute('data-testid') || current.getAttribute('data-cy')) return current;
      if (['SECTION', 'MAIN', 'ARTICLE', 'NAV', 'ASIDE', 'HEADER', 'FOOTER'].includes(current.tagName)) {
        if (current.classList.length > 0 || current.id) return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  pathFromTo(ancestor, el) {
    const parts = [];
    let current = el;
    while (current && current !== ancestor) {
      const tag = current.tagName.toLowerCase();
      const meaningful = this.filterMeaningfulClasses(current);
      if (meaningful.length > 0) {
        parts.unshift(`${tag}.${CSS.escape(meaningful[0])}`);
      } else if (current.classList.length > 0) {
        parts.unshift(`${tag}.${CSS.escape(current.classList[0])}`);
      } else {
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
          parts.unshift(siblings.length > 1
            ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})`
            : tag);
        } else {
          parts.unshift(tag);
        }
      }
      current = current.parentElement;
    }
    return parts.join(' > ') || null;
  }

  buildShortPath(el) {
    const parts = [];
    let current = el;
    let levels = 0;
    const maxLevels = 4;
    while (current && current !== document.body && current !== document.documentElement && levels < maxLevels) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      const meaningful = this.filterMeaningfulClasses(current);
      if (meaningful.length > 0) {
        parts.unshift(`${tag}.${CSS.escape(meaningful[0])}`);
      } else if (current.classList.length > 0) {
        parts.unshift(`${tag}.${CSS.escape(current.classList[0])}`);
      } else if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      } else {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        parts.unshift(siblings.length > 1
          ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})`
          : tag);
      }
      current = parent;
      levels++;
    }
    return parts.join(' > ');
  }
}

window.__elementPicker = new ElementPicker();
