// Web 预览与静态网站共用的 PPT 演示控制器。
// 这里统一负责：DOM 结构、翻页、键盘、全屏、等待增强完成后再显隐。
// 调用方只注入“这一页怎么渲染、怎么增强、怎么释放”三件事。

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {{
 *   document?: Document,
 *   mount?: HTMLElement,
 *   filename?: string | (() => string),
 *   slideCount: () => number,
 *   slideTitle?: (index: number) => string,
 *   renderSlide: (index: number) => string | Promise<string>,
 *   enhance?: (body: HTMLElement) => Promise<any> | any,
 *   dispose?: (body: HTMLElement) => void,
 *   renderError?: (error: any) => string,
 *   labels?: { open?: string, close?: string, prev?: string, next?: string },
 *   showOpenButton?: boolean,
 *   onOpen?: () => void,
 *   onClose?: (restore: boolean) => void,
 * }} options
 */
export function createPptPresenter(options) {
  const opts = options || {};
  const doc = opts.document || document;
  const mount = opts.mount || doc.body;
  const labels = opts.labels || {};

  let open = false;
  let index = 0;
  let seq = 0;
  let fullscreen = false;
  let prevOverflow = '';

  let openButton = null;
  if (opts.showOpenButton) {
    openButton = make('button', 'df-ppt-open', labels.open || 'PPT');
    openButton.type = 'button';
    openButton.addEventListener('click', () => show(0));
    mount.appendChild(openButton);
  }

  const root = make('div', 'df-ppt');
  root.hidden = true;
  const win = make('div', 'df-ppt-window');
  const head = make('header', 'df-ppt-head');
  const fileEl = make('span', 'df-ppt-file', '');
  const titleEl = make('span', 'df-ppt-title', '');
  const closeBtn = make('button', 'df-ppt-close', '\u00d7');
  closeBtn.type = 'button';
  if (labels.close) closeBtn.title = labels.close;
  const main = make('div', 'df-ppt-main');
  const body = make('div', 'md-body df-ppt-body');
  const foot = make('footer', 'df-ppt-foot');
  const prevBtn = make('button', 'df-ppt-btn df-ppt-nav', labels.prev || '\u2190');
  prevBtn.type = 'button';
  const countEl = make('span', 'df-ppt-count', '');
  const nextBtn = make('button', 'df-ppt-btn df-ppt-nav', labels.next || '\u2192');
  nextBtn.type = 'button';
  const hideBtn = make('button', 'df-ppt-btn df-ppt-hide', labels.hide || 'Hide pager');
  hideBtn.type = 'button';

  head.append(fileEl, titleEl, closeBtn);
  main.appendChild(body);
  foot.append(prevBtn, countEl, nextBtn, hideBtn);
  win.append(head, main, foot);
  root.appendChild(win);
  mount.appendChild(root);

  function total() {
    const n = Number(opts.slideCount && opts.slideCount());
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function filename() {
    return typeof opts.filename === 'function' ? (opts.filename() || '') : (opts.filename || '');
  }

  function release() {
    if (opts.dispose) {
      try { opts.dispose(body); } catch { /* ignore */ }
    }
  }

  let navHidden = false;

  function applyNavHidden() {
    foot.classList.toggle('is-nav-hidden', navHidden);
    hideBtn.textContent = labels.hide || 'Hide pager';
    hideBtn.title = hideBtn.textContent;
    hideBtn.setAttribute('aria-pressed', navHidden ? 'true' : 'false');
  }

  applyNavHidden();

  function setChrome(size) {
    fileEl.textContent = filename();
    titleEl.textContent = (opts.slideTitle && opts.slideTitle(index)) || '';
    countEl.textContent = size ? `${index + 1} / ${size}` : `0 / ${size}`;
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= size - 1;
  }

  async function render() {
    if (!open) return;
    const size = total();
    if (index >= size) index = Math.max(0, size - 1);
    if (index < 0) index = 0;
    const my = ++seq;
    setChrome(size);
    if (!size) {
      release();
      body.innerHTML = '';
      delete body.dataset.dfPending;
      return;
    }
    release();
    let html = '';
    try {
      html = await opts.renderSlide(index);
    } catch (e) {
      if (my === seq && open) {
        body.innerHTML = opts.renderError ? opts.renderError(e) : '';
        delete body.dataset.dfPending;
      }
      return;
    }
    if (my !== seq || !open) return;
    body.innerHTML = html || '';
    // 有 Mermaid/图表时先隐藏整页，增强完成再显示，避免原始代码 / 尺寸跳变
    if (body.querySelector('pre.mermaid')) body.dataset.dfPending = '1';
    else delete body.dataset.dfPending;
    try {
      if (opts.enhance) await opts.enhance(body);
    } catch (e) {
      if (my !== seq || !open) return;
      body.innerHTML = opts.renderError ? opts.renderError(e) : '';
    }
    if (my !== seq || !open) return;
    delete body.dataset.dfPending;
  }

  async function requestFullscreen() {
    if (doc.fullscreenElement || typeof win.requestFullscreen !== 'function') return;
    try {
      await win.requestFullscreen();
      fullscreen = true;
    } catch {
      // 浏览器 / 用户拒绝时保持铺满视口
    }
  }

  function exitFullscreen() {
    fullscreen = false;
    if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') {
      try {
        const p = doc.exitFullscreen();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch { /* ignore */ }
    }
  }

  function onFullscreenChange() {
    if (!fullscreen) return;
    if (!doc.fullscreenElement) {
      fullscreen = false;
      hide();
    }
  }

  function onKey(e) {
    if (!open) return;
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'Escape': e.preventDefault(); hide(); break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp': e.preventDefault(); prev(); break;
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown': e.preventDefault(); next(); break;
      case ' ':
      case 'Spacebar': e.preventDefault(); if (e.shiftKey) prev(); else next(); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(total() - 1); break;
      default: break;
    }
  }

  function go(i) {
    if (!open) return;
    const size = total();
    const nextIndex = Math.min(Math.max(0, Number(i) || 0), Math.max(0, size - 1));
    if (nextIndex === index) return;
    index = nextIndex;
    void render();
  }

  function show(startIndex) {
    const size = total();
    if (!size) return;
    open = true;
    index = Math.min(Math.max(0, Number(startIndex) || 0), size - 1);
    prevOverflow = doc.documentElement.style.overflow;
    doc.documentElement.style.overflow = 'hidden';
    root.hidden = false;
    navHidden = false;
    applyNavHidden();
    if (opts.onOpen) opts.onOpen();
    void requestFullscreen();
    void render();
  }

  function hide(restore) {
    if (!open) return;
    open = false;
    seq++;
    exitFullscreen();
    release();
    body.innerHTML = '';
    delete body.dataset.dfPending;
    root.hidden = true;
    doc.documentElement.style.overflow = prevOverflow;
    if (opts.onClose) opts.onClose(restore !== false);
  }

  function next() {
    if (!open) return;
    if (index < total() - 1) { index++; void render(); }
  }

  function prev() {
    if (!open) return;
    if (index > 0) { index--; void render(); }
  }

  function refresh() {
    if (!open) return;
    void render();
  }

  function destroy() {
    hide(false);
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('fullscreenchange', onFullscreenChange);
    root.remove();
    if (openButton) openButton.remove();
  }

  closeBtn.addEventListener('click', () => hide());
  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);
  hideBtn.addEventListener('click', () => { navHidden = true; applyNavHidden(); });
  root.addEventListener('click', (e) => { if (e.target === root) hide(); });
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('fullscreenchange', onFullscreenChange);

  return {
    element: root,
    isOpen: () => open,
    open: show,
    close: hide,
    toggle: (startIndex) => (open ? hide() : show(startIndex || 0)),
    next,
    prev,
    refresh,
    destroy,
  };
}
