import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSkills, detectSkillTargets, skillsStatus, installSkills, readVoidSkills, readSkillsChecked, markSkillsChecked, skillsStateFile } from '../skills-install.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'df-skills-')); }

function writeSkill(root, id, body = '# skill') {
  const dir = path.join(root, ...id.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `${body} ${id}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'extra.txt'), `${id}-extra\n`, 'utf8');
  return dir;
}

function fakeTargets() {
  const oc = tmp();
  const cc = tmp();
  return {
    ocTool: oc,
    ccTool: cc,
    targets: [
      { id: 'opencode', label: 'opencode', toolDir: oc, dir: path.join(oc, 'skills') },
      { id: 'claudecode', label: 'Claude Code', toolDir: cc, dir: path.join(cc, 'skills') },
    ],
  };
}

test('listSkills 递归识别 <group>/<skill>/SKILL.md 并忽略非技能目录', () => {
  const root = tmp();
  writeSkill(root, 'ecc/coding-standards');
  writeSkill(root, 'superpowers/brainstorming');
  fs.mkdirSync(path.join(root, 'not-a-skill'), { recursive: true });
  const out = listSkills(root);
  assert.deepEqual(out.map((s) => s.id), ['ecc/coding-standards', 'superpowers/brainstorming']);
  assert.equal(out[0].group, 'ecc');
  assert.equal(out[1].name, 'brainstorming');
});

test('detectSkillTargets 只返回检测到的工具（toolDir 或 skills 目录存在）', () => {
  const { targets, ocTool, ccTool } = fakeTargets();
  const got = detectSkillTargets(targets);
  assert.deepEqual(got.map((t) => t.id), ['opencode', 'claudecode']);
  assert.equal(got[0].exists, false, 'skills 目录还没建');
  const missing = detectSkillTargets([
    { id: 'ghost', label: 'Ghost', toolDir: path.join(tmp(), 'nope'), dir: path.join(tmp(), 'nope', 'skills') },
  ]);
  assert.equal(missing.length, 0);
  assert.ok(fs.existsSync(ocTool) && fs.existsSync(ccTool));
});

test('skillsStatus 统计每个目标的缺失技能，未检测到的工具不出现', () => {
  const { targets, ccTool } = fakeTargets();
  const src = tmp();
  writeSkill(src, 'ecc/a');
  writeSkill(src, 'gstack/b');
  writeSkill(path.join(ccTool, 'skills'), 'ecc/a');
  const st = skillsStatus({ sourceDirs: [src], targets });
  assert.deepEqual(st.skills, ['ecc/a', 'gstack/b']);
  assert.equal(st.targets.length, 2);
  assert.deepEqual(st.targets.find((t) => t.id === 'opencode').missing, ['ecc/a', 'gstack/b']);
  assert.deepEqual(st.targets.find((t) => t.id === 'claudecode').missing, ['gstack/b']);
  assert.equal(st.missing, 3);
});

test('installSkills 只补缺失、保留分组、不覆盖已有', () => {
  const { targets, ocTool, ccTool } = fakeTargets();
  const src = tmp();
  writeSkill(src, 'ecc/a', 'new');
  writeSkill(src, 'superpowers/b', 'new');
  const ocSkill = path.join(ocTool, 'skills', 'ecc', 'a');
  fs.mkdirSync(ocSkill, { recursive: true });
  fs.writeFileSync(path.join(ocSkill, 'SKILL.md'), 'old\n', 'utf8');

  const r = installSkills({ sourceDirs: [src], targets });
  assert.equal(r.skills, 2);
  assert.equal(r.installed, 3, 'opencode 装 1 个 + claudecode 装 2 个');
  const oc = r.targets.find((t) => t.id === 'opencode');
  assert.deepEqual(oc.installed, ['superpowers/b']);
  assert.equal(fs.readFileSync(path.join(ocSkill, 'SKILL.md'), 'utf8'), 'old\n', '已存在不覆盖');
  assert.ok(fs.existsSync(path.join(ocTool, 'skills', 'superpowers', 'b', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(ccTool, 'skills', 'ecc', 'a', 'extra.txt')), '整个技能目录一起拷');
});

test('installSkills 支持 targetIds 限定目标', () => {
  const { targets } = fakeTargets();
  const src = tmp();
  writeSkill(src, 'ecc/a');
  const r = installSkills({ sourceDirs: [src], targets, targetIds: ['claudecode'] });
  assert.deepEqual(r.targets.map((t) => t.id), ['claudecode']);
  assert.equal(r.installed, 1);
});

test('readVoidSkills 多来源目录按 id 去重，先出现者优先', () => {
  const a = tmp();
  const b = tmp();
  writeSkill(a, 'ecc/a', 'from-a');
  writeSkill(a, 'ecc/b');
  writeSkill(b, 'ecc/a', 'from-b');
  const out = readVoidSkills([a, b]);
  assert.deepEqual(out.map((s) => s.id), ['ecc/a', 'ecc/b']);
  assert.ok(fs.readFileSync(path.join(out[0].dir, 'SKILL.md'), 'utf8').includes('from-a'));
});

test('检测状态记录：写在 <baseDir>/.void/skills-checked.json，可重复读取', () => {
  const base = tmp();
  assert.equal(readSkillsChecked(base), null, '初始未检测');
  assert.equal(skillsStateFile(base), path.join(base, '.void', 'skills-checked.json'));
  const data = markSkillsChecked(base, { missing: 3, targets: [{ id: 'opencode', missing: 3 }] });
  assert.equal(data.missing, 3);
  const back = readSkillsChecked(base);
  assert.equal(back.missing, 3);
  assert.deepEqual(back.targets, [{ id: 'opencode', missing: 3 }]);
  assert.ok(Number.isFinite(back.checkedAt));
});
