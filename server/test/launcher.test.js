import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeLaunchPs1, makeOpenVbs, makeStartVbs, makeStopVbs, makeLaunchSh, makeStartCommand } = require('../../scripts/launcher.js');

test('launch.ps1 含 desired/running 双端口与 -Plan 钩子', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /param\(\[switch\]\$NoBrowser, \[switch\]\$NoShortcut, \[switch\]\$Plan/);
  assert.match(ps, /'data\\port\.txt'/);
  assert.match(ps, /'data\\runtime-port\.txt'/);
  assert.match(ps, /\$desired/);
  assert.match(ps, /\$running/);
  assert.match(ps, /PLAN desired=\{0\} running=\{1\} alive=\{2\} action=\{3\}/);
  assert.match(ps, /-f \$desired, \$running, \[int\]\$alive, \$action/);
  assert.match(ps, /访问地址: http:\/\/127\.0\.0\.1:\{0\}\//);
  assert.match(ps, /-f \$running/);
  assert.match(ps, /-f \$openPort/);
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

test('launch.ps1 已在运行时只开浏览器并立即退出（打开文件不重写快捷方式/关联）', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  const early = ps.indexOf('已在运行：只打开浏览器');
  assert.ok(early > -1, '存在 action=open 的早退分支');
  const seg = ps.slice(early, early + 400);
  assert.match(seg, /exit 0/);
  assert.ok(ps.indexOf('Void.lnk') > -1, '存在桌面快捷方式检查');
  assert.ok(ps.indexOf('Void.lnk') < early, '快捷方式版本检查出现在 open 早退之前（但仅 start/restart 执行）');
  assert.match(ps, /if \(-not \$NoShortcut -and \$action -ne 'open'\)/);
  const apply = ps.indexOf("$pref.enabled) { Set-VoidAssoc 'apply' }");
  assert.ok(apply > early, '关联静默校正只在 open 早退之后（真正启动时）执行');
});

test('launch.ps1 按版本决定是否更新桌面快捷方式', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /function Get-VoidVersion/);
  assert.match(ps, /function Compare-VoidVersion/);
  assert.match(ps, /version\.txt/);
  assert.match(ps, /Compare-VoidVersion \$oldVer \$curVer/);
  assert.match(ps, /Split-Path -Parent \$target/);
  assert.match(ps, /start-hidden\.vbs/);
  assert.match(ps, /\$lnk\.TargetPath = \$wscript/);
  assert.match(ps, /\$lnk\.Arguments = '\/\/nologo/);
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

test('文件关联命令指向隐藏启动器而不是 start.bat', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /wscript\.exe/);
  assert.match(ps, /open\.vbs/);
  assert.match(ps, /\$cmd\.SetValue\('', \('"' \+ \$wscript \+ '" \/\/B "' \+ \$openVbs \+ '" "%1"'\)\)/);
});

test('open.vbs 隐藏窗口并显式传 -Open（不依赖位置参数隐式绑定）', () => {
  const vbs = makeOpenVbs();
  assert.match(vbs, /WindowStyle Hidden/);
  assert.match(vbs, /-Open /);
  assert.match(vbs, /sh\.Run cmd, 0, False/, '0 = 隐藏窗口');
  assert.match(vbs, /launch\.ps1/);
  assert.ok(!/[^\x00-\x7F]/.test(vbs), 'VBS 保持纯 ASCII，避免 WSH 按 ANSI 解码出问题');
});

test('隐藏启动/停止入口经 wscript 调 launch.ps1，不留控制台', () => {
  for (const vbs of [makeStartVbs(), makeStopVbs()]) {
    assert.match(vbs, /WindowStyle Hidden/);
    assert.match(vbs, /launch\.ps1/);
    assert.match(vbs, /sh\.Run cmd, 0, False/, '0 = 隐藏窗口');
    assert.ok(!/[^\x00-\x7F]/.test(vbs), 'VBS 保持纯 ASCII');
  }
  assert.match(makeStopVbs(), /-Stop/);
});

test('node 以 Hidden 启动，且提供 -Stop 子命令', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /\[switch\]\$Stop/);
  assert.match(ps, /-WindowStyle Hidden/);
  assert.ok(!ps.includes('-WindowStyle Minimized'), '不再使用最小化黑框');
  assert.match(ps, /if \(\$Stop\) \{/);
  assert.match(ps, /Stop-Process/);
});

test('launch.sh 含 desired 优先、nc 存活探测与 --plan 钩子', () => {
  const sh = makeLaunchSh({ port: 22222 });
  assert.match(sh, /data\/port\.txt/);
  assert.match(sh, /data\/runtime-port\.txt/);
  assert.match(sh, /--plan/);
  assert.match(sh, /PLAN desired=/);
  assert.match(sh, /nc -z 127\.0\.0\.1 "\$RUNNING"/);
  assert.match(sh, /exec "\$DIR\/runtime\/node" "server\/index\.js"/);
  assert.match(sh, /访问地址: \$URL/);
  assert.match(sh, /访问地址: http:\/\/127\.0\.0\.1:\$\{RUNNING\}/);
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

test('launch.ps1 读 startup-prefs.json：默认隐藏，取消后以 Normal 窗口启动 node', () => {
  const ps = makeLaunchPs1({ port: 22222 });
  assert.match(ps, /startup-prefs\.json/);
  assert.match(ps, /\$hideServer = \$true/);
  assert.match(ps, /if \(\$sp\.hide -eq \$false\) \{ \$hideServer = \$false \}/);
  assert.match(ps, /if \(\$hideServer\) \{/);
  assert.match(ps, /-WindowStyle Hidden -RedirectStandardOutput \$logOut -RedirectStandardError \$logErr/);
  assert.match(ps, /-WindowStyle Normal/);
});
