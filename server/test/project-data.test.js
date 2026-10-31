import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projectKey, projectDir } from '../project-data.js';

test('projectKey：同一根路径稳定，不同根路径不同，空串也有稳定值', () => {
  const a = projectKey('C:\\proj\\app');
  const b = projectKey('C:\\proj\\app');
  const c = projectKey('C:\\proj\\other');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(typeof a, 'string');
  assert.equal(a.length, 16);
  assert.equal(projectKey(''), projectKey(''));
});

test('projectDir：落在 <portDir>/projects/<sha256> 下', () => {
  const dir = projectDir('D:\\data\\ports\\22222', 'C:\\proj\\app');
  assert.equal(dir, path.join('D:\\data\\ports\\22222', 'projects', projectKey('C:\\proj\\app')));
});
