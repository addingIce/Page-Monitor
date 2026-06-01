class ElementPicker {
  constructor() {
    this.active = false;
    this.hoverEl = null;
    this.overlay = null;
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  init() {
    // Create overlay element hidden by default
    this.overlay = document.createElement('div');
    this.overlay.id = '__page-monitor-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      background: rgba(66, 133, 244, 0.2);
      border: 2px solid rgba(66, 133, 244, 0.8);
      display: none;
      transition: all 0.1s ease;
    `;
    document.body.appendChild(this.overlay);
  }

  start() {
    if (this.active) return;
    this.active = true;
    document.addEventListener('mousemove', this._onMouseMove, true);
    document.addEventListener('click', this._onClick, true);
    document.addEventListener('keydown', this._onKeyDown, true);
    document.body.style.cursor = 'crosshair';
  }

  stop() {
    this.active = false;
    this.hideOverlay();
    document.removeEventListener('mousemove', this._onMouseMove, true);
    document.removeEventListener('click', this._onClick, true);
    document.removeEventListener('keydown', this._onKeyDown, true);
    document.body.style.cursor = '';
  }

  _onMouseMove(e) {
    if (!this.active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el === this.hoverEl || !el) return;
    if (el === this.overlay || el.id === '__page-monitor-overlay') return;

    this.hoverEl = el;
    const rect = el.getBoundingClientRect();
    this.overlay.style.display = 'block';
    this.overlay.style.left = rect.left + 'px';
    this.overlay.style.top = rect.top + 'px';
    this.overlay.style.width = rect.width + 'px';
    this.overlay.style.height = rect.height + 'px';
  }

  _onClick(e) {
    if (!this.active) return;
    e.preventDefault();
    e.stopPropagation();

    const el = this.hoverEl;
    if (!el) return;

    const selector = this.generateBestSelector(el);

    this.hideOverlay();
    this.cleanup();

    // Detect element type
    const elType = this.detectType(el);

    // Send result to service worker so popup can retrieve it
    chrome.runtime.sendMessage({
      type: 'PICK_RESULT',
      payload: { selector, elType },
    }).catch(() => {});
  }

  _onKeyDown(e) {
    if (e.key === 'Escape' && this.active) {
      this.cleanup();
    }
  }

  hideOverlay() {
    if (this.overlay) this.overlay.style.display = 'none';
    this.hoverEl = null;
  }

  cleanup() {
    this.active = false;
    document.removeEventListener('mousemove', this._onMouseMove, true);
    document.removeEventListener('click', this._onClick, true);
    document.removeEventListener('keydown', this._onKeyDown, true);
    document.body.style.cursor = '';
  }

  detectType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      return (t === 'checkbox' || t === 'radio') ? 'checkbox' : 'input';
    }
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'input';
    // Check if it's a label/container for a checkbox or input
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

  generateBestSelector(el) {
    // Strategy 1: Use id
    if (el.id) return `#${CSS.escape(el.id)}`;

    // Strategy 2: Use data-testid or other stable data attributes
    const stableAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-tid', 'data-qa'];
    for (const attr of stableAttrs) {
      const val = el.getAttribute(attr);
      if (val) return `[${attr}="${CSS.escape(val)}"]`;
    }

    // Strategy 3: Use all non-utility classes
    const meaningfulClasses = this.filterMeaningfulClasses(el);
    if (meaningfulClasses.length > 0) {
      // Try all meaningful classes
      const allClasses = meaningfulClasses.map(c => `.${CSS.escape(c)}`).join('');
      const allSel = `${el.tagName.toLowerCase()}${allClasses}`;
      if (document.querySelectorAll(allSel).length === 1) return allSel;

      // Try first 2 classes
      if (meaningfulClasses.length >= 2) {
        const two = meaningfulClasses.slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
        const twoSel = `${el.tagName.toLowerCase()}${two}`;
        if (document.querySelectorAll(twoSel).length <= 3) return twoSel;
      }

      // Try best 1 class (prefer status-like)
      const best = this.pickBestClass(el);
      if (best) {
        const sel = `${el.tagName.toLowerCase()}.${CSS.escape(best)}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }

    // Strategy 4: Find nearest identifiable ancestor and build relative path
    const ancestor = this.findAnchorAncestor(el);
    if (ancestor) {
      const ancSel = this.generateBestSelector(ancestor);
      if (ancSel && !ancSel.includes('nth-of-type')) {
        const relPath = this.pathFromTo(ancestor, el);
        if (relPath) return ancSel + ' ' + relPath;
      }
    }

    // Strategy 5: Short path (max 4 levels)
    return this.buildShortPath(el);
  }

  filterMeaningfulClasses(el) {
    // Filter out utility/framework-generated classes
    const utilityPatterns = [
      // Bootstrap-style utilities
      /^[mp][tblrxy]?-\d+$/,
      /^(d-|flex-|justify-|align-|text-|bg-|border-|rounded-|shadow-|w-|h-|p-[0-9]|m-[0-9]|gap-|col-|row-|offset-|order-)/,
      // Tailwind-style utilities
      /^(tw-|sm:|md:|lg:|xl:|hover:|focus:|active:)/,
      // Framework-generated
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
      // Semantic elements make good anchors
      if (['SECTION', 'MAIN', 'ARTICLE', 'NAV', 'ASIDE', 'HEADER', 'FOOTER'].includes(current.tagName)) {
        // Check if it's identifiable
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
// exported via window.__elementPicker
