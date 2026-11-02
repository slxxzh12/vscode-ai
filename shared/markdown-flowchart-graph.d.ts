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

export interface FlowGraphEdge {
  id: string;
  source: string;
  target: string;
  router: { name: string };
  connector: { name: string };
  zIndex: number;
  attrs: Record<string, unknown>;
  labels: unknown[];
}

export function buildFlowGraphModel(
  spec: unknown,
  theme?: { text?: string; axis?: string },
): { nodes: FlowGraphNode[]; edges: FlowGraphEdge[]; width: number; height: number };
