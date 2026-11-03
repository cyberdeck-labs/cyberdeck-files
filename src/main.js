// Cyberdeck Files – Hauptprozess: Dateisystem-Zugriff, Dateioperationen, Fenster
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, clipboard } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path'), fs = require('fs'), fsp = require('fs/promises'), os = require('os');

app.setName('cyberdeck-files');
if (process.env.FILES_PROFILE) app.setPath('userData', process.env.FILES_PROFILE);   // Tests: eigenes Profil
const IS_WIN = process.platform === 'win32';
let win;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { hidden: false, view: 'nodes', favorites: null, last: null, bounds: null };
try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch {}
const save = () => fsp.writeFile(settingsFile(), JSON.stringify(settings, null, 2)).catch(() => {});

const abs = p => { if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('Ungültiger Pfad'); return path.resolve(p); };
const TEXT = /\.(txt|md|markdown|log|json|ya?ml|toml|ini|conf|cfg|csv|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|sh|bash|zsh|ps1|bat|cmd|lua|c|h|cpp|hpp|cs|java|kt|go|rs|rb|php|sql|dart|gradle|properties|env|gitignore|desktop|service|pkt\.xml)$/i;
const IMG = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i, AUD = /\.(mp3|ogg|wav|flac|m4a|opus|aac)$/i, VID = /\.(mp4|webm|mkv|mov|m4v)$/i, PDF = /\.pdf$/i;
function kind(name, isDir) {
  if (isDir) return 'dir';
  if (IMG.test(name)) return 'img'; if (AUD.test(name)) return 'audio'; if (VID.test(name)) return 'video'; if (PDF.test(name)) return 'pdf';
  if (/\.(zip|7z|rar|tar|gz|xz|zst|bz2|iso)$/i.test(name)) return 'archive';
  if (/\.(exe|msi|appimage|deb|rpm|apk|pkg)$/i.test(name)) return 'app';
  if (/\.(docx?|odt|xlsx?|ods|pptx?|odp)$/i.test(name)) return 'doc';
  if (TEXT.test(name) || !path.extname(name)) return 'text';
  return 'file';
}

async function list(dir) {
  dir = abs(dir);
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  const out = await Promise.all(ents.map(async e => {
    const p = path.join(dir, e.name);
    let st = null, isDir = e.isDirectory(), link = e.isSymbolicLink();
    try { st = await fsp.stat(p); isDir = st.isDirectory(); } catch {}
    const it = { name: e.name, path: p, dir: isDir, link, kind: kind(e.name, isDir), size: st && !isDir ? st.size : null, mtime: st ? st.mtimeMs : 0,
      hidden: e.name.startsWith('.') };
    if (isDir) { try { it.count = (await fsp.readdir(p)).length; } catch { it.count = null; it.denied = true; } }
    return it;
  }));
  out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }));
  return out;
}
function places() {
  const h = os.homedir(), fav = [];
  const add = (label, p, icon) => { try { if (fs.statSync(p).isDirectory()) fav.push({ label, path: p, icon }); } catch {} };
  add('Home', h, '⌂');
  for (const [l, names] of [['Desktop', ['Desktop', 'Schreibtisch']], ['Dokumente', ['Documents', 'Dokumente']], ['Downloads', ['Downloads']],
    ['Bilder', ['Pictures', 'Bilder']], ['Musik', ['Music', 'Musik']], ['Videos', ['Videos']], ['Projekte', ['Projekte', 'Projects']]])
    for (const n of names) { const p = path.join(h, n); if (fs.existsSync(p)) { add(l, p, '▣'); break; } }
  const devs = [];
  if (IS_WIN) { for (let c = 67; c <= 90; c++) { const p = String.fromCharCode(c) + ':\\'; if (fs.existsSync(p)) devs.push({ label: p, path: p }); } }
  else {
    devs.push({ label: 'System', path: '/' });
    try {
      for (const l of fs.readFileSync('/proc/mounts', 'utf8').split('\n')) {
        const mp = (l.split(' ')[1] || '').replace(/\\040/g, ' ');
        if (/^\/(run\/media|media|mnt)\//.test(mp)) devs.push({ label: path.basename(mp), path: mp });
      }
    } catch {}
  }
  return { favorites: fav, devices: devs, home: h };
}
async function disk(p) { try { const s = await fsp.statfs(abs(p)); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return null; } }
async function uniq(target) {
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(target), base = target.slice(0, target.length - ext.length);
  for (let i = 2; ; i++) { const t = `${base} (${i})${ext}`; if (!fs.existsSync(t)) return t; }
}

ipcMain.handle('list', (_e, dir) => list(dir));
ipcMain.handle('places', () => places());
ipcMain.handle('disk', (_e, p) => disk(p));
ipcMain.handle('settings', (_e, patch) => { if (patch) { Object.assign(settings, patch); save(); } return settings; });
ipcMain.handle('preview', async (_e, p) => {
  p = abs(p); const st = await fsp.stat(p); const k = kind(path.basename(p), st.isDirectory());
  const info = { path: p, name: path.basename(p), kind: k, size: st.size, mtime: st.mtimeMs, ctime: st.birthtimeMs };
  if (k === 'text' && st.size < 4e6) {
    const fh = await fsp.open(p, 'r'); const buf = Buffer.alloc(Math.min(st.size, 65536)); await fh.read(buf, 0, buf.length, 0); await fh.close();
    info.binary = buf.includes(0); if (!info.binary) info.text = buf.toString('utf8'); info.truncated = st.size > 65536;
  }
  return info;
});
ipcMain.handle('open', (_e, p) => shell.openPath(abs(p)));
ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(abs(p)));
ipcMain.handle('mkdir', async (_e, dir, name) => {
  if (!name || /[\/\\]/.test(name)) throw new Error('Ungültiger Name');
  const t = await uniq(path.join(abs(dir), name)); await fsp.mkdir(t); return t;
});
ipcMain.handle('rename', async (_e, p, name) => {
  p = abs(p); if (!name || /[\/\\]/.test(name) || name === '.' || name === '..') throw new Error('Ungültiger Name');
  const t = path.join(path.dirname(p), name); if (fs.existsSync(t)) throw new Error('Name existiert bereits');
  await fsp.rename(p, t); return t;
});
ipcMain.handle('trash', async (_e, paths) => {
  const done = [];
  for (const p of paths) {
    try { await shell.trashItem(abs(p)); done.push(p); }
    catch (err) {
      const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Endgültig löschen', 'Abbrechen'], defaultId: 1, cancelId: 1,
        message: 'Papierkorb nicht verfügbar', detail: `${path.basename(p)} kann nicht in den Papierkorb verschoben werden. Endgültig löschen?` });
      if (r.response === 0) { await fsp.rm(abs(p), { recursive: true, force: true }); done.push(p); }
    }
  }
  return done;
});
ipcMain.handle('paste', async (_e, items, dest, mode) => {
  dest = abs(dest); const out = [];
  for (const src0 of items) {
    const src = abs(src0);
    if (dest === src || dest.startsWith(src + path.sep)) throw new Error('Ein Ordner kann nicht in sich selbst kopiert werden');
    let t = path.join(dest, path.basename(src));
    if (mode === 'move' && path.dirname(src) === dest) { out.push(src); continue; }
    t = await uniq(t);
    if (mode === 'move') {
      try { await fsp.rename(src, t); } catch (err) { if (err.code !== 'EXDEV') throw err; await fsp.cp(src, t, { recursive: true }); await fsp.rm(src, { recursive: true, force: true }); }
    } else await fsp.cp(src, t, { recursive: true, errorOnExist: true });
    out.push(t);
  }
  return out;
});
ipcMain.handle('search', async (_e, root, q) => {
  root = abs(root); q = String(q || '').toLowerCase().trim(); if (!q) return [];
  const res = [], queue = [[root, 0]]; let scanned = 0;
  while (queue.length && res.length < 300 && scanned < 40000) {
    const [d, depth] = queue.shift(); let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      scanned++;
      if (!settings.hidden && e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.name.toLowerCase().includes(q)) res.push({ name: e.name, path: p, dir: e.isDirectory(), kind: kind(e.name, e.isDirectory()), parent: d });
      if (e.isDirectory() && depth < 8 && e.name !== 'node_modules') queue.push([p, depth + 1]);
    }
  }
  return res;
});
ipcMain.handle('copy-path', (_e, p) => clipboard.writeText(p));
ipcMain.handle('parent', (_e, p) => path.dirname(abs(p)));

// ---------- Eigenschaften ----------
const run = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (err, out) => res(err ? null : String(out))));
let users = null;
function userName(uid) {
  if (IS_WIN) return null;
  if (!users) { users = {}; try { for (const l of fs.readFileSync('/etc/passwd', 'utf8').split('\n')) { const f = l.split(':'); if (f[2]) users[f[2]] = f[0]; } } catch {} }
  return users[uid] ?? String(uid);
}
function groupName(gid) {
  if (IS_WIN) return null;
  try { for (const l of fs.readFileSync('/etc/group', 'utf8').split('\n')) { const f = l.split(':'); if (f[2] === String(gid)) return f[0]; } } catch {}
  return String(gid);
}
async function winAttrs(p) {
  const out = await run('attrib', [p]); if (!out) return null;
  const flags = out.slice(0, out.toLowerCase().indexOf(p.toLowerCase().slice(0, 2))).toUpperCase();
  return { hidden: flags.includes('H'), system: flags.includes('S'), archive: flags.includes('A'), readonly: flags.includes('R') };
}
const sizeJobs = new Map();
async function dirSize(p, token) {
  let size = 0, files = 0, dirs = 0, partial = false; const stack = [p]; const t0 = Date.now();
  while (stack.length) {
    if (sizeJobs.get(token) === 'stop') { partial = true; break; }
    if (Date.now() - t0 > 60000 || files + dirs > 500000) { partial = true; break; }
    const d = stack.pop(); let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) { dirs++; stack.push(q); }
      else { files++; try { size += (await fsp.lstat(q)).size; } catch {} }
    }
    if ((files + dirs) % 400 < ents.length && win) win.webContents.send('props-progress', { token, size, files, dirs });
  }
  return { size, files, dirs, partial };
}
ipcMain.handle('props', async (_e, p) => {
  p = abs(p);
  const ls = await fsp.lstat(p); let st = ls, target = null;
  if (ls.isSymbolicLink()) { try { target = await fsp.readlink(p); st = await fsp.stat(p); } catch {} }
  const isDir = st.isDirectory();
  const r = { path: p, name: path.basename(p) || p, dir: isDir, kind: kind(path.basename(p), isDir), size: isDir ? null : st.size,
    mtime: st.mtimeMs, atime: st.atimeMs, ctime: st.birthtimeMs || st.ctimeMs, link: target, mode: st.mode & 0o7777,
    owner: userName(st.uid), group: groupName(st.gid), platform: process.platform, ext: path.extname(p).slice(1).toUpperCase() };
  if (IS_WIN) r.attrs = await winAttrs(p); else r.attrs = { hidden: r.name.startsWith('.'), readonly: !(st.mode & 0o200) };
  try { const d = await fsp.statfs(isDir ? p : path.dirname(p)); r.disk = { total: d.blocks * d.bsize, free: d.bavail * d.bsize }; } catch {}
  return r;
});
ipcMain.handle('props-size', async (_e, p, token) => { sizeJobs.set(token, 'run'); const r = await dirSize(abs(p), token); sizeJobs.delete(token); return r; });
ipcMain.handle('props-size-stop', (_e, token) => { if (sizeJobs.has(token)) sizeJobs.set(token, 'stop'); });
ipcMain.handle('props-set', async (_e, p, ch) => {
  p = abs(p);
  if (typeof ch.mode === 'number' && !IS_WIN) await fsp.chmod(p, ch.mode & 0o7777);
  if (typeof ch.readonly === 'boolean') {
    if (IS_WIN) await run('attrib', [ch.readonly ? '+R' : '-R', p]);
    else { const m = (await fsp.stat(p)).mode & 0o7777; await fsp.chmod(p, ch.readonly ? m & ~0o222 : m | 0o200); }
  }
  if (typeof ch.hidden === 'boolean' && IS_WIN) await run('attrib', [ch.hidden ? '+H' : '-H', p]);
  return true;
});
// Windows: den echten Eigenschaften-Dialog des Explorers oeffnen
// PowerShell-Skript: oeffnet den Explorer-Dialog, haelt den Prozess am Leben solange der Dialog offen ist,
// holt ihn nach vorne (Prozess startet versteckt -> Dialog sonst evtl. unsichtbar/hinter dem Fenster). Fehler -> %TEMP%\cyberdeck-files-props.log
const PROPS_PS = `
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'cyberdeck-files-props.log'
try {
  Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class CdW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static IntPtr Find(uint me) {
    IntPtr r = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p);
      if (p == me) { var sb = new StringBuilder(64); GetClassName(h, sb, 64); if (sb.ToString() == "#32770") { r = h; return false; } }
      return true; }, IntPtr.Zero);
    return r;
  }
}
'@
  $sh = New-Object -ComObject Shell.Application
  if ($isRoot) { $f = $sh.Namespace(17); $i = $f.ParseName($target) }
  else { $f = $sh.Namespace($dir); if (-not $f) { throw "Ordner nicht gefunden: $dir" }; $i = $f.ParseName($name) }
  if (-not $i) { throw "Element nicht gefunden: $target" }
  $i.InvokeVerb('properties')
  $me = [uint32]$PID; $seen = $false
  for ($t = 0; $t -lt 3600; $t++) {
    Start-Sleep -Milliseconds 500
    $h = [CdW]::Find($me)
    if ($h -ne [IntPtr]::Zero) { if (-not $seen) { [CdW]::ShowWindow($h, 5) | Out-Null; [CdW]::SetForegroundWindow($h) | Out-Null; $seen = $true } }
    elseif ($seen) { break }
    elseif ($t -gt 30) { throw "Eigenschaften-Dialog ist nicht erschienen: $target" }
  }
} catch { "$(Get-Date -Format s)  $_" | Out-File -Append -Encoding utf8 $log }
`;
ipcMain.handle('props-native', (_e, p) => {
  if (!IS_WIN) return false; p = abs(p);
  const q = s => "'" + String(s).replace(/'/g, "''") + "'";
  const isRoot = path.parse(p).root === p || /^[A-Za-z]:\\?$/.test(p);
  const target = isRoot ? p.slice(0, 2) + '\\' : p;
  const head = `$target = ${q(target)}; $dir = ${q(path.dirname(p))}; $name = ${q(path.basename(p))}; $isRoot = $${isRoot};\n`;
  const enc = Buffer.from(head + PROPS_PS, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
    { detached: true, windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
  return true;
});

// ---------- Windows: Win+E auf Cyberdeck Files umleiten ----------
const WINE_KEY = 'HKCU\\Software\\Classes\\CLSID\\{52205fd8-5dfb-447d-801a-d0b52f2e83e1}';
ipcMain.handle('wine-get', async () => {
  if (!IS_WIN) return null;
  const out = await run('reg', ['query', WINE_KEY + '\\shell\\opennewwindow\\command', '/ve']);
  return !!(out && out.toLowerCase().includes(path.basename(process.execPath).toLowerCase()));
});
ipcMain.handle('wine-set', async (_e, on) => {
  if (!IS_WIN) return null;
  if (on) {
    const cmd = WINE_KEY + '\\shell\\opennewwindow\\command';
    await run('reg', ['add', cmd, '/ve', '/d', `"${process.execPath}"`, '/f']);
    await run('reg', ['add', cmd, '/v', 'DelegateExecute', '/d', '', '/f']);
  } else await run('reg', ['delete', WINE_KEY, '/f']);
  return true;
});
ipcMain.handle('platform', () => process.platform);


const argDir = argv => { for (const a of argv.slice(1)) { if (a.startsWith('-') || a === '.' || /\.js$/.test(a)) continue; try { const r = path.resolve(a); if (fs.existsSync(r)) return fs.statSync(r).isDirectory() ? r : path.dirname(r); } catch {} } return null; };
if (!process.env.FILES_UIEVAL && !app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', (_e, argv) => {   // z. B. Win+E, wenn die App schon offen ist
  if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus();
  const d = argDir(argv); win.webContents.send('goto', d || null);
});
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1400, height: 860, minWidth: 900, minHeight: 560, backgroundColor: '#06060c', title: 'Cyberdeck Files',
    icon: path.join(__dirname, '..', 'build', 'icon.png'), ...(settings.bounds || {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, plugins: true } });
  if (process.env.FILES_SIZE) win.setContentSize(...process.env.FILES_SIZE.split('x').map(Number));
  win.on('close', () => { settings.bounds = win.getBounds(); save(); });
  const startDir = process.env.FILES_START || argDir(process.argv);
  win.loadFile(path.join(__dirname, 'index.html'), startDir ? { query: { start: startDir } } : undefined);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  if (process.env.FILES_UIEVAL) {   // Test-Hook (e2e)
    win.webContents.once('did-finish-load', async () => {
      try {
        const r = await win.webContents.executeJavaScript(fs.readFileSync(process.env.FILES_UIEVAL, 'utf8'));
        console.log('UIEVAL ' + JSON.stringify(r));
        if (process.env.FILES_SHOT) fs.writeFileSync(process.env.FILES_SHOT, (await win.webContents.capturePage()).toPNG());
      } catch (e) { console.log('UIEVAL-ERR ' + e.message); }
      app.exit(0);
    });
  }
  if (app.isPackaged && !process.env.FILES_UIEVAL) { try { require('electron-updater').autoUpdater.checkForUpdatesAndNotify(); } catch {} }
});
app.on('window-all-closed', () => app.quit());
