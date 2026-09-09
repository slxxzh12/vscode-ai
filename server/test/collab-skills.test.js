import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSkills, packSkill } from '../collaboration/skill-packer.js';
import { installZip, validateSkillZip } from '../collaboration/skill-installer.js';

function makeSkillRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-skills-'));
  const s = path.join(dir, 'demo');
  fs.mkdirSync(path.join(s, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(s, 'SKILL.md'), '# demo\nhello', 'utf8');
  fs.writeFileSync(path.join(s, 'scripts', 'run.js'), 'console.log(1)', 'utf8');
  fs.writeFileSync(path.join(s, '.hidden'), 'skip', 'utf8');
  return { root: dir, skillDir: s };
}

test('listSkills 只列出含 SKILL.md 的目录', () => {
  const { root } = makeSkillRoot();
  fs.mkdirSync(path.join(root, 'noskill'), { recursive: true });
  fs.writeFileSync(path.join(root, 'noskill', 'x.txt'), 'x');
  const names = listSkills(root).map((s) => s.name);
  assert.ok(names.includes('demo'));
  assert.ok(!names.includes('noskill'));
});

test('packSkill 产出含 SKILL.md 的 zip，忽略隐藏文件', async () => {
  const { skillDir } = makeSkillRoot();
  const buf = await packSkill(skillDir);
  assert.ok(buf.zip.length > 0);
  assert.ok(validateSkillZip(buf.zip, 'demo'), 'zip 结构合法');
});

test('installZip 解压到目标目录且不越界；二次安装同名备份', async () => {
  const { skillDir } = makeSkillRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-dest-'));
  const pkg = await packSkill(skillDir);
  installZip({ zip: pkg.zip, skillName: 'demo', destRoot: dest });
  assert.ok(fs.existsSync(path.join(dest, 'demo', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dest, 'demo', 'scripts', 'run.js')));
  assert.ok(!fs.existsSync(path.join(dest, 'demo', '.hidden')));
  installZip({ zip: pkg.zip, skillName: 'demo', destRoot: dest });
  const bak = fs.readdirSync(dest).filter((f) => f.startsWith('demo.bak'));
  assert.ok(bak.length >= 1, '已有同名应生成 .bak');
});

test('恶意 zip（无 SKILL.md）被拒', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-dest2-'));
  const fake = Buffer.from('this is not a real zip but enough to be refused by validator');
  assert.equal(validateSkillZip(fake, 'demo'), false);
  assert.throws(() => installZip({ zip: fake, skillName: 'demo', destRoot: dest }));
});
