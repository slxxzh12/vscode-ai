export interface FlowchartEditorLabels {
  title?: string;
  save?: string;
  cancel?: string;
  addNode?: string;
  addEdge?: string;
  addGroup?: string;
  del?: string;
  layout?: string;
  reconnectSource?: string;
  reconnectTarget?: string;
  hint?: string;
}

export interface FlowchartEditorOptions {
  code: string;
  dark?: boolean;
  labels?: FlowchartEditorLabels;
  onSave?: (code: string) => void;
  onCancel?: () => void;
}

export function openFlowchartEditor(options: FlowchartEditorOptions): { close(): void } | null;
