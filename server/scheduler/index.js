import { SchedulerStore } from './store.js';
import { createEngine } from './engine.js';
import { createRunner } from './runner.js';
import { createSchedulerMount } from './http-mount.js';
import { readAiCommand } from './ai-commands.js';

export function createScheduler({ dir, projectResolver = () => null, logger = console, runner = null, agentCmd = 'opencode', opencodeDataDir = null, manifestRoot = null }) {
  const store = new SchedulerStore({ dir, logger, ...(manifestRoot ? { manifestRoot } : {}) });
  const engine = createEngine({ store, runner: runner || createRunner(), logger, aiBin: agentCmd, opencodeDataDir });
  engine.setProjectResolver(projectResolver);
  engine.setAiPromptLoader((name) => readAiCommand(name));
  const mount = createSchedulerMount({ engine, store, logger });
  return { store, engine, mount };
}

export { SchedulerStore } from './store.js';
export { createEngine } from './engine.js';
export { createRunner } from './runner.js';
export { computeNextRun } from './schedule.js';
