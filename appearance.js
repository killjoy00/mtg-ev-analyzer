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
  const sun = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const moon = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M20.8 15.3A9 9 0 0 1 8.7 3.2 9 9 0 1 0 20.8 15.3Z"/></svg>';
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
    for (const button of document.querySelectorAll('[data-appearance-toggle]')) {
      const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = theme === 'dark' ? sun : moon;
    }
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
  function mountSettings() {
    const panel = document.querySelector('#profile-account #settings-panel-profile');
    if (!panel?.querySelector('#profile-settings-form') || panel.querySelector('[data-appearance-preference]')) return;
    // Use the same section, label and select styles as the existing Profile
    // settings. Keep the browser-local choice outside the account-save form.
    const setting = document.createElement('section');
    setting.className = 'settings-row profile-settings-group appearance-setting';
    setting.setAttribute('aria-labelledby', 'profile-appearance-title');
    setting.innerHTML = '<div class="settings-row-label"><h3 id="profile-appearance-title">Appearance</h3><p class="profile-settings-intro">Saved automatically on this browser.</p></div><div class="settings-row-body"><select class="select" data-appearance-preference aria-labelledby="profile-appearance-title"><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></div>';
    panel.append(setting);
    apply();
  }
  function mount() {
    const footer = document.querySelector('.site-footer nav, .app-footer nav');
    if (footer && !footer.querySelector('[data-appearance-toggle]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'appearance-footer-toggle';
      button.dataset.appearanceToggle = '';
      footer.append(button);
    }
    document.addEventListener('click', event => {
      if (event.target.closest?.('[data-appearance-toggle]')) setPreference(effective() === 'dark' ? 'light' : 'dark');
    });
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
