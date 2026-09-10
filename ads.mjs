function previewCreative(slot, index) {
  const variants = [
    ['Draft night, organized.', 'A realistic display-ad preview lives here after approval.', 'Explore'],
    ['Protect the cards you open.', 'Responsive inventory, visually separated from Pack One actions.', 'Shop now'],
    ['Your next draft starts here.', 'Publisher content remains the focus; ads stay outside gameplay.', 'Learn more'],
  ];
  const [headline, copy, action] = variants[index % variants.length];
  slot.innerHTML = `<div class="ad-preview-creative"><div><small>Advertisement · preview</small><strong>${headline}</strong><p>${copy}</p></div><b>${action}</b></div>`;
}

function loadGoogleAds(slots) {
  const cfg = globalThis.PACKONE_ADSENSE || {};
  if (!cfg.enabled || !cfg.client || document.body.classList.contains('is-game')) return;
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg.client)}`;
  document.head.appendChild(script);
  slots.forEach((slot) => {
    const key = slot.dataset.adSlot;
    const id = cfg.slots?.[key] || cfg.slots?.articleTop || '';
    if (!id) return;
    slot.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${cfg.client}" data-ad-slot="${id}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    (globalThis.adsbygoogle = globalThis.adsbygoogle || []).push({});
  });
}

const slots = [...document.querySelectorAll('[data-ad-slot]')];
if (new URLSearchParams(location.search).get('adpreview') === '1') slots.forEach(previewCreative);
else if (!globalThis.PACKONE_ADSENSE?.enabled) slots.forEach(slot=>slot.hidden=true);
else if (!new URLSearchParams(location.search).has('game') && !new URLSearchParams(location.search).has('mode')) loadGoogleAds(slots);
