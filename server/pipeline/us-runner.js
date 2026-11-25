import fs from 'node:fs';
import path from 'node:path';
import { collectUsDocs, renderUsPrompt } from './us-prompt.js';
import { extractUsCommands } from './us-commands.js';
import * as defaultGit from './us-git.js';
import { runCommand as defaultExec } from './us-exec.js';

const AI_TIMEOUT_MS = 30 * 60 * 1000;
const CMD_TIMEOUT_MS = 10 * 60 * 1000;

function commitSubject(us) {
  const code = (String(us).match(/^(US\d{6})/) || [])[1] || String(us);
  const title = String(us).replace(/^US\d{6}-\d{4}-/, '') || String(us);
  return { code, title };
}

export async function runOneUs({
  us, solutionDir, codeDir, user, logDir, runId,
  template, git = defaultGit, exec = defaultExec, runAi = null,
  now = Date.now,
}) {
  fs.mkdirSync(logDir, { recursive: true });
  const item = {
    us, status: 'failed', branch: null, commit: null, error: null,
    logFiles: [], commands: {}, startedAt: now(), finishedAt: null,
  };

  const prepared = await git.prepareUserBranch(codeDir, user);
  if (prepared.error) {
    item.error = prepared.error;
    item.finishedAt = now();
    return item;
  }
  item.branch = prepared.branch;

  const collected = collectUsDocs(path.join(solutionDir, us));
  const files = Object.fromEntries(collected.docs.map((d) => [d.rel, d.text]));
  const commands = extractUsCommands(files);
  if (commands.error) {
    item.error = commands.error;
    item.finishedAt = now();
    return item;
  }

  const prompt = renderUsPrompt(template, {
    us, branch: prepared.branch, cwd: codeDir, docs: collected.docs, commands,
  });
  const aiLog = path.join(logDir, 'ai.log');
  let aiOk = false;
  if (runAi) {
    const ai = await runAi({ us, cwd: codeDir, prompt, logPath: aiLog, timeoutMs: AI_TIMEOUT_MS });
    item.logFiles.push('ai.log');
    aiOk = !!ai?.ok;
    if (!aiOk) item.error = ai?.error || 'ai-failed';
  } else {
    item.error = 'missing-ai-runner';
  }

  let commandsOk = aiOk;
  if (aiOk) {
    for (const name of ['test', 'build', 'package']) {
      const command = commands[name];
      if (!command) continue;
      const logPath = path.join(logDir, `${name}.log`);
      const r = await exec({ cwd: codeDir, command, logPath, timeoutMs: CMD_TIMEOUT_MS });
      item.logFiles.push(`${name}.log`);
      item.commands[name] = {
        command, exitCode: r.exitCode ?? null, timedOut: !!r.timedOut, ok: !!r.ok,
      };
      if (!r.ok) {
        commandsOk = false;
        item.error = `${name}-failed`;
        break;
      }
    }
  }

  const ok = aiOk && commandsOk;
  const { code, title } = commitSubject(us);
  const message = ok ? `feat(${code}): ${title}` : `wip(${code}): ${title} [failed]`;
  const committed = await git.commitAll(codeDir, message);
  if (committed.error) {
    item.error = committed.error;
  } else {
    item.commit = committed.commit || null;
    if (item.commit && git.pushBranch) {
      const pushed = await git.pushBranch(codeDir, prepared.branch);
      if (!pushed.ok) item.error = pushed.error || 'push-failed';
      else item.status = ok && !item.error ? 'success' : 'failed';
    } else if (!item.error) {
      item.status = ok ? 'success' : 'failed';
    }
  }

  item.finishedAt = now();
  return item;
}
