export type SecretSeverity = 'high' | 'medium';

export interface SecretFinding {
  rel: string;
  line: number;
  rule: string;
  severity: SecretSeverity;
  match: string;
}
export interface SecretRuleTally { rule: string; severity: SecretSeverity; count: number }
export interface SecretScanResult {
  dir: string;
  scanned: number;
  findings: SecretFinding[];
  byRule: SecretRuleTally[];
  totals: { files: number; findings: number; scanned: number };
  truncated?: boolean;
}
export interface SecretScanParams { dir: string; excludeDirs?: string[] }

export interface SecretFileGroup {
  rel: string;
  findings: SecretFinding[];
}

export function groupFindingsByFile(findings: SecretFinding[]): SecretFileGroup[] {
  const map = new Map<string, SecretFinding[]>();
  for (const f of findings) {
    const list = map.get(f.rel);
    if (list) list.push(f);
    else map.set(f.rel, [f]);
  }
  return [...map.entries()]
    .map(([rel, list]) => ({ rel, findings: [...list].sort((a, b) => a.line - b.line) }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

export async function fetchSecretScan(params: SecretScanParams): Promise<SecretScanResult> {
  const res = await fetch('/api/code/secret-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = (j.error || msg) + (j.message ? `：${j.message}` : '');
    } catch { /* keep status */ }
    throw new Error(msg);
  }
  return res.json() as Promise<SecretScanResult>;
}
