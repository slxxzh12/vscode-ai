// Windows 上把 .cmd/.bat 包装成 cmd.exe 执行。
//
// Node >=18.20 / >=20.12 / >=22 起（CVE-2024-27980），execFile/spawn 直接执行 .cmd/.bat 会抛 EINVAL，
// 必须显式走 cmd.exe；这里统一成 wrapCmdBin，与 scripts/dev.js 的做法一致。
export function isCmdBin(bin) {
  return /\.(cmd|bat)$/i.test(String(bin || ''));
}

// 返回 { bin, args }：win32 且 bin 是 .cmd/.bat 时包装为 cmd.exe /d /s /c <bin> <args>，否则原样返回。
export function wrapCmdBin(bin, args = [], { platform = process.platform, comspec = process.env.ComSpec } = {}) {
  if (platform !== 'win32' || !isCmdBin(bin)) return { bin, args };
  return { bin: comspec || 'cmd.exe', args: ['/d', '/s', '/c', bin, ...args] };
}
