export interface FlowNodeModel {
  id: string;
  label: string;
  shapeRaw: string;
  group: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlowEdgeModel {
  source: string;
  target: string;
  label: string;
  arrow: string;
}

export interface FlowGroupModel {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowchartModel {
  direction: string;
  nodes: FlowNodeModel[];
  edges: FlowEdgeModel[];
  groups: FlowGroupModel[];
  extras: string[];
  positions: Record<string, { x?: number; y?: number; w?: number; h?: number }>;
}

export function parseFlowchartModel(code: string): FlowchartModel | null;
export function serializeFlowchartModel(model: FlowchartModel): string;
export function replaceMermaidBlock(markdown: string, blockIndex: number, newCode: string): string;
