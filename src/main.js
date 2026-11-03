// Cyberdeck Files – Hauptprozess: Dateisystem-Zugriff, Dateioperationen, Fenster
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, clipboard } = require('electron');
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1400, height: 860, minWidth: 900, minHeight: 560, backgroundColor: '#06060c', title: 'Cyberdeck Files',
    icon: path.join(__dirname, '..', 'build', 'icon.png'), ...(settings.bounds || {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, plugins: true } });
  if (process.env.FILES_SIZE) win.setContentSize(...process.env.FILES_SIZE.split('x').map(Number));
  win.on('close', () => { settings.bounds = win.getBounds(); save(); });
  win.loadFile(path.join(__dirname, 'index.html'), process.env.FILES_START ? { query: { start: process.env.FILES_START } } : undefined);
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
