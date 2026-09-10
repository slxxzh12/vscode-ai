import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dfgit-')); }

export function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
}

export function commit(repo, msg, iso) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'tester', GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 'tester', GIT_COMMITTER_EMAIL: 't@t',
    GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso,
  };
  execFileSync('git', ['-C', repo, 'add', '-A'], { env, windowsHide: true });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg], { env, windowsHide: true });
}

export function makeRepo() {
  const repo = tmpDir();
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'tester']);
  git(repo, ['config', 'user.email', 't@t']);
  return repo;
}

// 固定剧本（区间 2026-09-01 ~ 2026-09-10）：
//  c0 08-25  add m.txt,k.txt（区间前，用于造「纯修改」）
//  c1 09-01  A a.txt, M m.txt, M k.txt
//  c2 09-05  A b.txt
//  c3 09-06  R m.txt -> m2.txt
//  c4 09-08  D b.txt
//  c5 09-20  A out.txt（区间外）
export function seedRepo() {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'm.txt'), 'm0');
  fs.writeFileSync(path.join(repo, 'k.txt'), 'k0');
  commit(repo, 'c0', '2026-08-25T10:00:00');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a1');
  fs.writeFileSync(path.join(repo, 'm.txt'), 'm1');
  fs.writeFileSync(path.join(repo, 'k.txt'), 'k1');
  commit(repo, 'c1', '2026-09-01T10:00:00');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b1');
  commit(repo, 'c2', '2026-09-05T10:00:00');
  git(repo, ['mv', 'm.txt', 'm2.txt']);
  commit(repo, 'c3', '2026-09-06T10:00:00');
  fs.rmSync(path.join(repo, 'b.txt'));
  commit(repo, 'c4', '2026-09-08T10:00:00');
  fs.writeFileSync(path.join(repo, 'out.txt'), 'o');
  commit(repo, 'c5', '2026-09-20T10:00:00');
  return repo;
}
