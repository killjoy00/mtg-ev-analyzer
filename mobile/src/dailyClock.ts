export function pacificDay(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dailyDate(day: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`));
}

// Find the next Pacific date, including both 23-hour and 25-hour DST days.
export function dailyResetCue(now = new Date()) {
  const day = pacificDay(now);
  let low = now.getTime();
  let high = low + 26 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (pacificDay(new Date(middle)) === day) low = middle; else high = middle;
  }
  const minutes = Math.max(1, Math.ceil((high - now.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  return `New Dailies in ${hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`}`;
}
