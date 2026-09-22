import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeLaunchPs1, makeLaunchSh, makeStartCommand } = require('../../scripts/launcher.js');

test('launch.ps1 含 desired/running 双端口与 -Plan 钩子', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /param\(\[switch\]\$NoBrowser, \[switch\]\$NoShortcut, \[switch\]\$Plan/);
  assert.match(ps, /'data\\port\.txt'/);
  assert.match(ps, /'data\\runtime-port\.txt'/);
  assert.match(ps, /\$desired/);
  assert.match(ps, /\$running/);
  assert.match(ps, /PLAN desired=\{0\} running=\{1\} alive=\{2\} action=\{3\}/);
  assert.match(ps, /-f \$desired, \$running, \[int\]\$alive, \$action/);
});

test('launch.ps1 结束旧实例前有安全校验（只杀本应用）', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /runtime\\node\.exe/);
  assert.match(ps, /server\\\\index\\\.js/, '命令行匹配 server\\\\index\\.js（PS 正则转义）');
  assert.match(ps, /Stop-Process/);
  assert.match(ps, /WARN/, '非本应用进程要打印告警而不是杀掉');
});

test('launch.ps1 保留原有能力（快捷方式 / 关联子命令 / 浏览器）', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /Void\.lnk/);
  assert.match(ps, /Set-VoidAssoc/);
  assert.match(ps, /\?open=/);
  assert.match(ps, /22222/, '默认端口写入脚本');
});

test('launch.ps1 已在运行时只开浏览器并立即退出（不建快捷方式、不弹关联提示）', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  const early = ps.indexOf('已在运行：只打开浏览器');
  assert.ok(early > -1, '存在 action=open 的早退分支');
  const seg = ps.slice(early, early + 400);
  assert.match(seg, /exit 0/);
  assert.ok(early < ps.indexOf('Void.lnk'), '早退应出现在快捷方式之前');
  assert.ok(ps.indexOf('file-assoc.json') < early, '启动自查应出现在 open 早退之前（已在运行时也纠正关联）');
});

test('launch.ps1 含 -Assoc 子命令与启动自查，且不再有 WScript 首启弹窗', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /\[string\]\$Assoc = ''/);
  assert.match(ps, /function Set-VoidAssoc/);
  assert.match(ps, /if \(\$Assoc\) \{ Set-VoidAssoc \$Assoc; exit 0 \}/);
  assert.match(ps, /file-assoc\.json/);
  assert.match(ps, /ports\\' \+ \$desired/, '偏好改读端口数据目录');
  assert.match(ps, /'\.pdf'/, '扩展名含 .pdf');
  assert.match(ps, /'\.txt'/, '扩展名含 .txt');
  assert.match(ps, /\$p\.selected/, '按偏好里的 selected 逐扩展设置/移除');
  assert.ok(!ps.includes('assoc-prompted'), '移除了旧的首启 WScript 关联弹窗');
  assert.match(ps, /DeleteSubKeyTree/, '删 UserChoice 才能成为默认程序');
  assert.match(ps, /UserChoiceLatest/, '新版 Windows 还需删 UserChoiceLatest');
  assert.match(ps, /SHChangeNotify/, '设置后广播 SHCNE_ASSOCCHANGED 刷新 Shell 关联');
});

test('launch.sh 含 desired 优先、nc 存活探测与 --plan 钩子', () => {
  const sh = makeLaunchSh({ port: 22222 });
  assert.match(sh, /data\/port\.txt/);
  assert.match(sh, /data\/runtime-port\.txt/);
  assert.match(sh, /--plan/);
  assert.match(sh, /PLAN desired=/);
  assert.match(sh, /nc -z 127\.0\.0\.1 "\$RUNNING"/);
  assert.match(sh, /exec "\$DIR\/runtime\/node" "server\/index\.js"/);
});

test('start.command 只转发到 launch.sh', () => {
  const sc = makeStartCommand();
  assert.match(sc, /exec "\$DIR\/script\/launch\.sh" "\$@"/);
});

test('launch.ps1 可选注入包内 opencode 到 PATH（不传则维持现状）', () => {
  const withOc = makeLaunchPs1({ port: 22222, opencodeDir: 'opencode' });
  assert.match(withOc, /\$ocDir = Join-Path \$root 'opencode'/);
  assert.match(withOc, /\$env:PATH = \$ocDir \+ ';' \+ \$env:PATH/);
  assert.ok(
    withOc.indexOf('$env:PATH') < withOc.indexOf('Start-Process'),
    'PATH 注入必须出现在启动服务之前',
  );

  const plain = makeLaunchPs1({ port: 22222 });
  assert.ok(!plain.includes('$env:PATH'), '不传 opencodeDir 时输出不含 PATH 注入');
});
