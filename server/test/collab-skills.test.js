import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSkills, packSkill } from '../collaboration/skill-packer.js';
import { installZip, validateSkillZip } from '../collaboration/skill-installer.js';
import { createPairHarness } from '../collaboration/engine.js';

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

test('master 发布捆绑包 → slave 拉取并安装到本机技能根', async () => {
  const h = await createPairHarness({ skipSkills: false });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    const jr = await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    assert.equal(jr.code, 'joined');

    const skillDir = path.join(A.skillsRoot, 'foo');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# foo', 'utf8');
    const rec = await A.buildPackage({ skills: ['foo'] });
    const pub = A.publishPackage(rec.id);
    assert.equal(pub.code, 'ok', JSON.stringify(pub));
    assert.ok(fs.existsSync(path.join(A.downloadsDir, pub.name)));
    assert.ok(A.readManifest().files.some((f) => f.name === pub.name));

    const pull = await B.pullDownloads();
    assert.equal(pull.code, 'ok');
    assert.ok(pull.files.includes(pub.name));

    const inst = B.installDownload(pub.name);
    assert.equal(inst.code, 'ok', JSON.stringify(inst));
    assert.ok(fs.existsSync(path.join(B.skillsRoot, 'foo', 'SKILL.md')), '已安装到 B 技能根');
  } finally { await h.stop(); }
});

test('非 master 发布被拒', async () => {
  const h = await createPairHarness({ skipSkills: false });
  try {
    const [A, B] = h.nodes;
    A.verifyAccessToken = (tk) => tk === 'good';
    A.ensureGroup();
    await B.joinByLink({ host: '127.0.0.1', port: 39991, token: 'good' });
    const r = B.publishPackage('nope');
    assert.equal(r.code, 'not-master');
  } finally { await h.stop(); }
});
