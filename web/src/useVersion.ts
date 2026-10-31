import { ref } from 'vue';

const version = ref('');
let pending: Promise<void> | null = null;

export function loadVersion(): Promise<void> {
  if (version.value) return Promise.resolve();
  if (pending) return pending;
  pending = fetch('/api/version')
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { version?: string } | null) => { if (d && d.version) version.value = d.version; })
    .catch(() => { /* offline: keep empty */ })
    .finally(() => { pending = null; });
  return pending;
}

export function useVersion() {
  return { version, loadVersion };
}
