const listeners = new Set();
let observer = null;
let scheduled = false;

function report(error) {
  console.error('Pack One render hook failed:', error);
}

function flush() {
  scheduled = false;
  for (const listener of [...listeners]) {
    Promise.resolve().then(listener).catch(report);
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
}

export function installRenderLifecycle(root = document.querySelector('#app')) {
  if (observer || !root || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  schedule();
}

export function onAppRender(listener, { immediate = true } = {}) {
  if (typeof listener !== 'function') throw new TypeError('Render listener must be a function.');
  listeners.add(listener);
  if (immediate) schedule();
  return () => listeners.delete(listener);
}
