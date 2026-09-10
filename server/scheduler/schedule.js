const UNIT_MS = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 };

export function intervalMs(schedule) {
  return schedule.interval.every * UNIT_MS[schedule.interval.unit];
}

function nextDaily(schedule, now) {
  const [h, m] = schedule.daily.at.split(':').map(Number);
  const days = Array.isArray(schedule.daily.weekdays) ? schedule.daily.weekdays : [];
  for (let add = 0; add <= 7; add++) {
    const d = new Date(now);
    d.setDate(d.getDate() + add);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now) continue;
    const wd = d.getDay() === 0 ? 7 : d.getDay();
    if (days.length && !days.includes(wd)) continue;
    return d.getTime();
  }
  return null;
}

export function computeNextRun(schedule, now) {
  if (!schedule) return null;
  if (schedule.mode === 'interval') return now + intervalMs(schedule);
  if (schedule.mode === 'daily') return nextDaily(schedule, now);
  return null;
}
