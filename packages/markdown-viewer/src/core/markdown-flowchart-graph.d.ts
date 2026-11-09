export interface FlowGraphNode {
  id: string;
  shape: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  attrs: Record<string, unknown>;
}

export interface FlowGraphTerminal {
  cell: string;
  connectionPoint: { name: string };
}

export interface FlowGraphEdge {
  id: string;
  source: FlowGraphTerminal;
  target: FlowGraphTerminal;
  router: { name: string; args?: Record<string, unknown> };
  connector: { name: string };
  vertices?: Array<{ x: number; y: number }>;
  zIndex: number;
  attrs: Record<string, unknown>;
  labels: unknown[];
}

export function buildFlowGraphModel(
  spec: unknown,
  theme?: { text?: string; axis?: string },
): { nodes: FlowGraphNode[]; edges: FlowGraphEdge[]; width: number; height: number };
