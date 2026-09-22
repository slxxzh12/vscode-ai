export interface FileAssocExt { ext: string; isDefault: boolean; enabled: boolean }
export interface FileAssocState { available: boolean; enabled: boolean; prompted: boolean; extensions: FileAssocExt[] }

export async function getFileAssoc(): Promise<FileAssocState | null> {
  try {
    const r = await fetch('/api/file-assoc');
    if (!r.ok) return null;
    return (await r.json()) as FileAssocState;
  } catch { return null; }
}

export async function setFileAssoc(enabled: boolean, selected: string[]): Promise<FileAssocState | null> {
  try {
    const r = await fetch('/api/file-assoc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, selected }),
    });
    if (!r.ok) return null;
    return (await r.json()) as FileAssocState;
  } catch { return null; }
}
