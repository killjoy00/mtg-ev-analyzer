export const GAME_TIME_ZONE = 'America/New_York';
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: GAME_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
export function gameDateKey(date = new Date()) {
  const parts=Object.fromEntries(formatter.formatToParts(date instanceof Date ? date : new Date(date)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
