// This is a cross-platform measurement diagnostic, not a native-only metric.
// The backend deliberately counts only eligible first encounters.
export function missingViewCoverageText(count) {
  const value=Number(count);
  const formatted=Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:0}):'N/A';
  return `View coverage: ${formatted} first-encounter answers without a recorded view, across web and native (included in answer totals).`;
}
