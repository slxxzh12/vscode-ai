import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUsCommands } from '../pipeline/us-commands.js';

test('us-commands：pipeline.json 优先，字段级回退', () => {
  const r = extractUsCommands({
    'pipeline.json': JSON.stringify({ build: 'npm run build' }),
    '01-需求分析.md': '---\npackage: npm run pack\n---\n',
    '05-构建发布.md': '## 测试\n```bash\nnpm test\n```\n',
  });
  assert.equal(r.error, undefined);
  assert.equal(r.build, 'npm run build');
  assert.equal(r.package, 'npm run pack');
  assert.equal(r.test, 'npm test');
});

test('us-commands：frontmatter 去引号', () => {
  const r = extractUsCommands({
    '01-需求分析.md': '---\nbuild: "pnpm build"\ntest: \'pnpm test\'\n---\n',
  });
  assert.equal(r.build, 'pnpm build');
  assert.equal(r.test, 'pnpm test');
});

test('us-commands：05 文档按标题取第一个代码块', () => {
  const md = [
    '# 构建发布', '',
    '## 构建', '说明', '```bash', 'npm ci', 'npm run build', '```', '',
    '## 打包', '```powershell', 'npm run package', '```',
  ].join('\n');
  const r = extractUsCommands({ '05-构建发布.md': md });
  assert.equal(r.build, 'npm ci\nnpm run build');
  assert.equal(r.package, 'npm run package');
});

test('us-commands：缺少 build 返回错误', () => {
  const r = extractUsCommands({ 'pipeline.json': '{"test":"npm test"}' });
  assert.equal(r.error, 'missing_build');
});
