/* Synchronous head initializer: apply the preference before CSS paints. */
(() => {
  'use strict';
  const key = 'packone-appearance-v1';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const normalize = value => ['system','light','dark'].includes(value) ? value : 'light';
  const read = () => { try { return normalize(localStorage.getItem(key)); } catch { return 'light'; } };
  let preference = read();
  const effective = () => preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  function apply() {
    const theme = effective();
    root.dataset.theme = theme;
    root.dataset.appearance = preference;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.append(meta);
    }
    meta.content = theme === 'dark' ? '#10171f' : '#f7f8fa';
    for (const select of document.querySelectorAll('[data-appearance-preference]')) select.value = preference;
  }
  function setPreference(value) {
    preference = normalize(value);
    try { localStorage.setItem(key, preference); } catch { /* still works on this page */ }
    apply();
  }
  apply();
  const onSystemChange = () => { if (preference === 'system') apply(); };
  if (media.addEventListener) media.addEventListener('change', onSystemChange);
  else media.addListener(onSystemChange);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = read(); apply(); }
  });
  function selector(className) {
    const label = document.createElement('label');
    label.className = className;
    label.innerHTML = '<span>Appearance</span><select data-appearance-preference aria-label="Appearance"><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select>';
    return label;
  }
  function mountSettings() {
    const overview = document.querySelector('#profile-account .settings-overview');
    if (!overview || overview.querySelector('[data-appearance-preference]')) return;
    const setting = selector('appearance-setting');
    const description = document.createElement('small');
    description.textContent = 'Applies to this browser.';
    setting.append(description);
    overview.prepend(setting);
    apply();
  }
  function mount() {
    const footer = document.querySelector('.site-footer nav, .app-footer nav');
    if (footer && !footer.querySelector('[data-appearance-preference]')) footer.append(selector('appearance-footer'));
    document.addEventListener('change', event => {
      if (event.target.matches?.('[data-appearance-preference]')) setPreference(event.target.value);
    });
    mountSettings();
    const app = document.querySelector('#app');
    if (app) new MutationObserver(mountSettings).observe(app, {childList:true,subtree:true});
    apply();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();
