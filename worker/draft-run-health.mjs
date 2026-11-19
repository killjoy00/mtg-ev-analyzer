export function summarizeDraftRunPool(rows) {
  const perSet = new Map();
  for (const row of rows || []) {
    const setId = String(row?.set_id || '');
    if (!setId) continue;
    let entry = perSet.get(setId);
    if (!entry) {
      entry = { decisions: 0, sources: new Set() };
      perSet.set(setId, entry);
    }
    entry.decisions += 1;
    if (row.source_draft_hash) entry.sources.add(row.source_draft_hash);
  }
  const by_set = Object.fromEntries(
    [...perSet.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([setId, entry]) => [setId, { drafts: entry.sources.size, decisions: entry.decisions }]),
  );
  return { by_set };
}
