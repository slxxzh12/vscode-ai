export interface MermaidLike {
  initialize(options: { startOnLoad: boolean; securityLevel: string; theme: string }): void;
  render(id: string, code: string): Promise<{ svg: string }>;
}

export function groupMermaidSides(container: HTMLElement): void;
export function renderMermaidBlocks(
  container: HTMLElement,
  mermaid: MermaidLike,
  options?: { theme?: string; errorText?: (msg: string) => string },
): Promise<void>;
