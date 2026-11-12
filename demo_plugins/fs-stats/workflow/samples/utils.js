export function sum(list) {
  return (list || []).reduce((acc, n) => acc + Number(n || 0), 0);
}

export function average(list) {
  const arr = list || [];
  return arr.length ? sum(arr) / arr.length : 0;
}
