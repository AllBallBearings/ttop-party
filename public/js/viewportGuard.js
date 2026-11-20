// Mobile viewport guard: keeps the game full-screen and un-zoomable.
//
// - iOS WebKit (Safari and every iOS browser, including Chrome) ignores
//   `user-scalable=no`, so a quick double tap on JUMP zooms in, and a thumb on
//   the stick plus a thumb on a button reads as a pinch. We cancel those
//   gestures at the touch level and snap back if a zoom slips through.
// - The Fullscreen API hides the browser chrome on Android / desktop / iPad.
//   iPhone has no element fullscreen; there the only way to hide the address
//   bar is launching from the Home Screen (see manifest + apple meta tags).

const VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

const root = document.documentElement;

export function isFullscreenSupported() {
  return Boolean(
    (root.requestFullscreen || root.webkitRequestFullscreen) &&
    (document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? true)
  );
}

export function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

export function isStandaloneApp() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.matchMedia?.('(display-mode: standalone)').matches
  );
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Must be called from a user gesture (click / pointerdown). */
export function enterFullscreen() {
  if (isFullscreen() || !isFullscreenSupported()) return Promise.resolve(false);
  try {
    const p = root.requestFullscreen
      ? root.requestFullscreen({ navigationUI: 'hide' })
      : root.webkitRequestFullscreen();
    return Promise.resolve(p).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function exitFullscreen() {
  if (!isFullscreen()) return Promise.resolve();
  try {
    const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen();
    return Promise.resolve(p).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

export function onFullscreenChange(cb) {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
}

function isEditable(el) {
  return el instanceof Element && Boolean(el.closest('input, textarea, select, [contenteditable="true"]'));
}

/** Force the page back to 1x if the browser zoomed it anyway. */
export function resetZoom() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  // Re-writing the viewport meta (with a tiny change, then back) makes
  // WebKit/Blink re-apply initial-scale, which un-zooms the page.
  meta.setAttribute('content', VIEWPORT_CONTENT.replace('initial-scale=1.0', 'initial-scale=0.99'));
  requestAnimationFrame(() => {
    meta.setAttribute('content', VIEWPORT_CONTENT);
    window.scrollTo(0, 0);
  });
}

export function installZoomGuard() {
  const opts = { passive: false };

  // Pinch: any multi-touch move. WebKit's proprietary gesture events too.
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 || (e.scale !== undefined && e.scale !== 1)) e.preventDefault();
  }, opts);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), opts);
  }

  // Double-tap zoom: cancel the second tap of any quick pair, plus every
  // touchend on the game controls (they run on pointer events, so cancelling
  // the touch's synthesized click/zoom costs nothing).
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = performance.now();
    const onControls = e.target instanceof Element && e.target.closest('.touch-overlay');
    if (onControls || (now - lastTouchEnd < 350 && !isEditable(e.target))) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, opts);

  // Second finger landing on the controls while another is down.
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1 && !isEditable(e.target)) e.preventDefault();
  }, opts);

  document.addEventListener('dblclick', (e) => e.preventDefault(), opts);

  // Safety net: if a zoom still happens, snap back right away.
  const vv = window.visualViewport;
  if (vv) {
    let pending = false;
    const check = () => {
      if (pending || vv.scale <= 1.01) return;
      if (isEditable(document.activeElement)) return; // let iOS zoom to a focused input
      pending = true;
      setTimeout(() => {
        pending = false;
        if (vv.scale > 1.01) resetZoom();
      }, 120);
    };
    vv.addEventListener('resize', check);
    vv.addEventListener('scroll', check);
  }
  window.addEventListener('orientationchange', () => setTimeout(resetZoom, 300));
  document.addEventListener('focusout', () => setTimeout(() => {
    if (window.visualViewport && window.visualViewport.scale > 1.01) resetZoom();
  }, 50));
}
