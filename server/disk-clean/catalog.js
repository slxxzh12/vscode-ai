import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env = (k) => process.env[k] || '';
const home = () => os.homedir();
const localAppData = () => env('LOCALAPPDATA') || path.join(home(), 'AppData', 'Local');
const roamingAppData = () => env('APPDATA') || path.join(home(), 'AppData', 'Roaming');
const systemRoot = () => env('SystemRoot') || env('windir') || path.join(path.parse(os.homedir()).root, 'Windows');
const systemDrive = () => env('SystemDrive') || path.parse(systemRoot()).root.replace(/[\\/]+$/, '');

function dirExists(p) {
  if (!p) return false;
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function subdirs(base) {
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(base, e.name));
  } catch { return []; }
}

const C = (p, extra = {}) => ({ path: p, mode: 'contents', ...extra });
const E = (p, patterns, extra = {}) => ({ path: p, mode: 'entry', patterns, ...extra });
const F = (p, extra = {}) => ({ path: p, mode: 'file', ...extra });

function browserTargets(appRoot) {
  const out = [];
  for (const profile of subdirs(appRoot)) {
    out.push(C(path.join(profile, 'Cache')));
    out.push(C(path.join(profile, 'Code Cache')));
    out.push(C(path.join(profile, 'GPUCache')));
    out.push(C(path.join(profile, 'Service Worker', 'ScriptCache')));
  }
  return out;
}

const CATEGORIES = [
  { id: 'user-temp', group: 'system', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'Temp'))] },
  { id: 'windows-temp', group: 'system', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(systemRoot(), 'Temp'), { needsAdmin: true })] },
  { id: 'recycle-bin', group: 'system', risk: 'caution', minAgeDays: 0, targets: () => [{ path: systemDrive(), mode: 'recycle-bin' }] },
  { id: 'update-cache', group: 'system', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(systemRoot(), 'SoftwareDistribution', 'Download'), { needsAdmin: true })] },
  {
    id: 'crash-dumps', group: 'system', risk: 'caution', minAgeDays: 0,
    targets: () => [
      C(path.join(localAppData(), 'CrashDumps')),
      F(path.join(systemRoot(), 'MEMORY.DMP'), { needsAdmin: true }),
    ],
  },
  {
    id: 'wer-reports', group: 'system', risk: 'caution', minAgeDays: 0,
    targets: () => [
      C(path.join(localAppData(), 'Microsoft', 'Windows', 'WER', 'ReportQueue')),
      C(path.join(localAppData(), 'Microsoft', 'Windows', 'WER', 'ReportArchive')),
    ],
  },
  {
    id: 'thumbnails', group: 'system', risk: 'caution', minAgeDays: 0,
    targets: () => [E(path.join(localAppData(), 'Microsoft', 'Windows', 'Explorer'), ['thumbcache_*.db', 'iconcache_*.db'])],
  },
  { id: 'system-logs', group: 'system', risk: 'caution', minAgeDays: 7, targets: () => [C(path.join(systemRoot(), 'Logs', 'CBS'), { needsAdmin: true })] },
  { id: 'windows-old', group: 'system', risk: 'risky', minAgeDays: 0, targets: () => [C(path.join(path.parse(systemRoot()).root, 'Windows.old'), { needsAdmin: true, removeRoot: true })] },

  { id: 'npm', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'npm-cache', '_cacache'))] },
  { id: 'yarn', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'Yarn', 'Cache'))] },
  { id: 'pnpm', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'pnpm', 'store'))] },
  { id: 'pip', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'pip', 'Cache'))] },
  { id: 'nuget', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(home(), '.nuget', 'packages'))] },
  { id: 'go-build', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'go-build'))] },
  { id: 'go-mod', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(env('GOMODCACHE') || path.join(home(), 'go', 'pkg', 'mod', 'cache'))] },
  { id: 'cargo', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(home(), '.cargo', 'registry', 'cache'))] },
  { id: 'maven', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(home(), '.m2', 'repository'))] },
  { id: 'gradle', group: 'app', risk: 'caution', minAgeDays: 0, targets: () => [C(path.join(home(), '.gradle', 'caches'))] },
  { id: 'office-cache', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'Microsoft', 'Office', '16.0', 'OfficeFileCache'))] },
  { id: 'netease-music', group: 'app', risk: 'safe', minAgeDays: 0, targets: () => [C(path.join(localAppData(), 'Netease', 'CloudMusic', 'Cache'))] },
  {
    id: 'electron-apps', group: 'app', risk: 'safe', minAgeDays: 0,
    targets: () => [
      C(path.join(roamingAppData(), 'Slack', 'Cache')),
      C(path.join(roamingAppData(), 'Microsoft', 'Teams', 'Cache')),
      C(path.join(roamingAppData(), 'Code', 'CachedExtensionVSIXs')),
    ],
  },
  {
    id: 'wechat', group: 'app', risk: 'caution', minAgeDays: 0,
    targets: () => [
      ...subdirs(path.join(home(), 'Documents', 'WeChat Files')).map((p) => C(path.join(p, 'FileStorage', 'Cache'))),
      ...subdirs(path.join(home(), 'Documents', 'xwechat_files')).map((p) => C(path.join(p, 'cache'))),
    ],
  },
  {
    id: 'qq', group: 'app', risk: 'risky', minAgeDays: 0,
    targets: () => subdirs(path.join(home(), 'Documents', 'Tencent Files')).map((p) => C(path.join(p, 'Image'))),
  },
  {
    id: 'dingtalk', group: 'app', risk: 'caution', minAgeDays: 0,
    targets: () => [
      C(path.join(roamingAppData(), 'DingTalk', 'cache')),
      C(path.join(localAppData(), 'DingTalk', 'cache')),
    ],
  },
  {
    id: 'wps', group: 'app', risk: 'caution', minAgeDays: 0,
    targets: () => [
      C(path.join(roamingAppData(), 'kingsoft', 'office6', 'backup')),
      C(path.join(localAppData(), 'Kingsoft', 'WPS Office', 'cache')),
    ],
  },
  {
    id: 'steam', group: 'app', risk: 'caution', minAgeDays: 0,
    targets: () => {
      const roots = [
        path.join(env('ProgramFiles(x86)'), 'Steam'),
        path.join(env('ProgramFiles'), 'Steam'),
      ].filter(dirExists);
      const out = [];
      for (const r of roots) {
        out.push(C(path.join(r, 'appcache', 'httpcache')));
        out.push(C(path.join(r, 'steamapps', 'downloading')));
        out.push(C(path.join(r, 'steamapps', 'shadercache')));
      }
      return out;
    },
  },
  {
    id: 'downloads-partial', group: 'app', risk: 'safe', minAgeDays: 1,
    targets: () => [E(path.join(home(), 'Downloads'), ['*.part', '*.crdownload', '*.tmp', '*.download'])],
  },

  { id: 'chrome', group: 'browser', risk: 'safe', minAgeDays: 0, targets: () => browserTargets(path.join(localAppData(), 'Google', 'Chrome', 'User Data')) },
  { id: 'edge', group: 'browser', risk: 'safe', minAgeDays: 0, targets: () => browserTargets(path.join(localAppData(), 'Microsoft', 'Edge', 'User Data')) },
  { id: 'brave', group: 'browser', risk: 'safe', minAgeDays: 0, targets: () => browserTargets(path.join(localAppData(), 'BraveSoftware', 'Brave-Browser', 'User Data')) },
  {
    id: 'firefox', group: 'browser', risk: 'safe', minAgeDays: 0,
    targets: () => subdirs(path.join(localAppData(), 'Mozilla', 'Firefox', 'Profiles')).map((p) => C(path.join(p, 'cache2'))),
  },
];

function existingTargets(targets) {
  return targets.filter((t) => (t.mode === 'recycle-bin' ? true : fs.existsSync(t.path)));
}

function needsAdminOf(targets) {
  return targets.some((t) => Boolean(t.needsAdmin));
}

export function isSupportedPlatform() {
  return process.platform === 'win32';
}

export function resolveTargets(id, { customDirs = [] } = {}) {
  if (id === 'custom') {
    return (customDirs || []).filter(Boolean).map((p) => C(p));
  }
  const cat = CATEGORIES.find((c) => c.id === id);
  if (!cat) return [];
  return existingTargets(cat.targets()).map((t) => ({ minAgeDays: cat.minAgeDays, ...t }));
}

export function listCategories({ customDirs = [] } = {}) {
  const out = [];
  for (const cat of CATEGORIES) {
    const targets = existingTargets(cat.targets());
    if (!targets.length) continue;
    out.push({
      id: cat.id,
      group: cat.group,
      risk: cat.risk,
      defaultChecked: cat.risk === 'safe',
      needsAdmin: needsAdminOf(targets),
      minAgeDays: cat.minAgeDays,
    });
  }
  if (customDirs.length) {
    out.push({ id: 'custom', group: 'custom', risk: 'risky', defaultChecked: false, needsAdmin: false, minAgeDays: 0 });
  }
  return out;
}
