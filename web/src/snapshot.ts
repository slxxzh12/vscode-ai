export function snapshotFileName(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ymd = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const hms = `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `devflow-${ymd}-${hms}.png`;
}
