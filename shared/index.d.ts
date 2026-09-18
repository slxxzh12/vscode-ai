export declare const C2S: Readonly<{
  LIST: 'list'; CREATE: 'create'; START: 'start'; INPUT: 'input';
  RESIZE: 'resize'; STOP: 'stop'; KILL: 'kill'; PING: 'ping'; RESTORE: 'restore';
  WF_LIST: 'wf-list'; WF_RUN: 'wf-run'; WF_NEXT: 'wf-next'; WF_ABORT: 'wf-abort';
}>;
export declare const S2C: Readonly<{
  OUTPUT: 'output'; REPLAY: 'replay'; SESSION_CREATED: 'session-created';
  SESSION_LIST: 'session-list'; SESSION_EXITED: 'session-exited';
  ERROR: 'error'; PONG: 'pong';
  WF_LIST_RESULT: 'wf-list-result'; WF_STARTED: 'wf-started';
  WF_STATUS: 'wf-status'; WF_FINISHED: 'wf-finished';
  CONFIG_CHANGED: 'config-changed';
}>;
export declare type WfAdvance = 'auto' | 'manual';
export declare type StepStatus = 'waiting' | 'running' | 'manual' | 'done' | 'error';
export declare type RunStatus = 'running' | 'paused' | 'done' | 'aborted';
export interface SessionSummary { id: string; name: string; projectId: string | null; state: 'running' | 'exited'; cwd: string; cols: number; rows: number; exitCode: number | null; kind?: 'agent' | 'shell' | 'workflow'; agentId?: string | null; restored?: boolean; resumed?: boolean; recreated?: boolean; }
export interface ProjectInfo { id: string; name: string; root: string; temp?: boolean; }
export interface TreeItem { name: string; type: 'file' | 'dir'; }
export interface WorkflowStep { id: string; cmd: string; advance: WfAdvance; hint?: string; }
export interface WorkflowTemplate { id: string; name: string; steps: WorkflowStep[]; }
export interface RunStep extends WorkflowStep { status: StepStatus; startedAt: number | null; finishedAt: number | null; }
export interface RunSnapshot { runId: string; workflowId: string; workflowName: string; sessionId: string; status: RunStatus; currentIndex: number; steps: RunStep[]; errorMessage: string | null; }
