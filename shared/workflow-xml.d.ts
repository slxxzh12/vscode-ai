export interface WorkflowStage { id: string; label: string; group?: string; prompts: string[]; }
export interface Workflow { id: string; label: string; priority?: number; stages: WorkflowStage[]; }
export declare function parseWorkflowsXml(xml: string): Workflow[];
export declare function serializeWorkflow(w: Workflow): string;
export declare function serializeWorkflowsFragment(workflows: Workflow[]): string;
export declare function sortWorkflows<T extends { id: string; label?: string; priority?: number }>(workflows: T[]): T[];
export declare function escXml(s: unknown): string;
export declare function decode(s: unknown): string;
