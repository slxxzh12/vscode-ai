export declare function promptStepId(stageId: string, index: number): string;
export declare function groupAnchorStages(
  stages: unknown[],
  anchorStageId: string,
): { group: string; stages: unknown[] } | null;
export declare function expandGroupSteps(
  stages: unknown[],
  anchorStageId: string,
): {
  group: string;
  steps: Array<{ id: string; stageId: string; index: number; text: string; type: 'cmd' | 'prompt' }>;
} | null;
