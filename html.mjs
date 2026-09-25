// Use for text and quoted HTML attributes; URLs still need their own validation.
export const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
