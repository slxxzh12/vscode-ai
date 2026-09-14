export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface MobileLandingInput {
  firstSeen: number | null;
  lastMobileDate: string | null;
  now: number;
  thresholdDays?: number;
}

export interface MobileLandingResult {
  firstSeen: number;
  lastMobileDate: string;
  openMobile: boolean;
}

export const FIRST_SEEN_KEY = 'devflow-first-seen';
export const LAST_MOBILE_KEY = 'devflow-last-mobile-date';
export const DEFAULT_THRESHOLD_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function toDateStr(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function decideMobileLanding({
  firstSeen,
  lastMobileDate,
  now,
  thresholdDays = DEFAULT_THRESHOLD_DAYS,
}: MobileLandingInput): MobileLandingResult {
  const seen = firstSeen == null ? now : firstSeen;
  const today = toDateStr(now);
  const oldEnough = now - seen >= thresholdDays * DAY_MS;
  const openMobile = oldEnough && lastMobileDate !== today;
  return {
    firstSeen: seen,
    lastMobileDate: openMobile ? today : (lastMobileDate || ''),
    openMobile,
  };
}

export function readMobileLanding(storage: StorageLike, now: number, thresholdDays = DEFAULT_THRESHOLD_DAYS): MobileLandingResult {
  const raw = storage.getItem(FIRST_SEEN_KEY);
  const n = raw == null ? NaN : Number(raw);
  return decideMobileLanding({
    firstSeen: Number.isFinite(n) ? n : null,
    lastMobileDate: storage.getItem(LAST_MOBILE_KEY),
    now,
    thresholdDays,
  });
}

export function writeMobileLanding(storage: StorageLike, r: MobileLandingResult): void {
  storage.setItem(FIRST_SEEN_KEY, String(r.firstSeen));
  if (r.lastMobileDate) storage.setItem(LAST_MOBILE_KEY, r.lastMobileDate);
}
