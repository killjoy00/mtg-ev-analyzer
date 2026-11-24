// Mirrors GUIDE_IDS in set-guides.mjs. Native opens the canonical published
// set refresher page rather than duplicating editorial content in the binary,
// so a guide added later on the web still works once this list includes it.
// tests/reveal-parity.test.mjs keeps this list equal to the web module.
export const GUIDE_IDS: readonly string[] = Object.freeze(['fra', 'hob', 'msh', 'sos', 'tmt', 'ecl', 'tla', 'eoe', 'fin', 'tdm', 'dft', 'fdn', 'dsk', 'blb', 'mh3', 'otj', 'mkm', 'ktk', 'lci', 'woe', 'ltr', 'mom', 'one', 'bro', 'dmu', 'snc', 'neo', 'powered-cube']);

export function setGuideUrl(id: string | null | undefined) {
  const set = String(id ?? '').toLowerCase();
  return GUIDE_IDS.includes(set) ? `https://packone.pro/sets/${set}/guide/` : null;
}
