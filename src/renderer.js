// Cyberdeck Files – Oberfläche: Knoten-Ansicht, Liste, Vorschau, Dateioperationen
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SEP = fsx.sep;
const fileUrl = p => { const parts = p.replace(/\\/g, '/').split('/'); return 'file://' + (SEP === '\\' ? '/' : '') + parts.map((s, i) => SEP === '\\' && i === 0 ? s : encodeURIComponent(s)).join('/'); };
const fmtSize = n => n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
const fmtDate = t => t ? new Date(t).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' }) : '';
const KIND = { dir: 'Ordner', img: 'Bild', pdf: 'PDF', audio: 'Audio', video: 'Video', archive: 'Archiv', app: 'Programm', doc: 'Dokument', text: 'Text', file: 'Datei' };
const nameOf = p => p.split(SEP).filter(Boolean).pop() || p;
const parentOf = p => { const a = p.replace(/[\\/]+$/, ''); const i = a.lastIndexOf(SEP); return i <= 0 ? (SEP === '/' ? '/' : a.slice(0, 3)) : (/^[A-Z]:$/i.test(a.slice(0, i)) ? a.slice(0, i) + '\\' : a.slice(0, i)); };

const S = { root: null, view: 'nodes', hidden: false, expanded: new Set(), cache: new Map(), page: new Map(), sel: new Set(), active: null,
  hist: [], hpos: -1, clip: null, sort: { k: 'name', d: 1 }, search: null, zoom: 1, pan: { x: 40, y: 0 } };
const COLW = 274, ROWH = 46, PAGE = 14;

async function load(dir, force) {
  if (!force && S.cache.has(dir)) return S.cache.get(dir);
  let items; try { items = await fsx.list(dir); } catch (e) { items = []; items.error = e.message; }
  S.cache.set(dir, items); return items;
}
const visible = items => items.filter(i => S.hidden || !i.hidden);

// ---------- Navigation ----------
async function go(dir, { push = true, keepSel = false } = {}) {
  S.root = dir; S.search = null; $('search').value = '';
  if (push) { S.hist = S.hist.slice(0, S.hpos + 1); S.hist.push(dir); S.hpos = S.hist.length - 1; }
  S.expanded = new Set([dir]); if (!keepSel) { S.sel.clear(); S.active = null; }
  await load(dir, true);
  S.pan = { x: 40, y: 0 }; S.zoom = 1; S.centerNext = true;
  fsx.settings({ last: dir });
  render(); crumbs(); sidebarMark(); diskInfo();
}
function crumbs() {
  const parts = S.root.split(SEP).filter(Boolean); let acc = SEP === '/' ? '' : '';
  const out = [];
  if (SEP === '/') out.push(`<span data-p="/">/</span>`);
  parts.forEach((p, i) => { acc = SEP === '/' ? acc + '/' + p : (i === 0 ? p + '\\' : acc.replace(/\\$/, '') + '\\' + p); out.push((out.length ? '<i>›</i>' : '') + `<span data-p="${esc(acc)}">${esc(p)}</span>`); });
  $('crumbs').innerHTML = out.join('');
  $('back').disabled = S.hpos <= 0; $('fwd').disabled = S.hpos >= S.hist.length - 1;
  $('up').disabled = parentOf(S.root) === S.root;
}
$('crumbs').onclick = e => { const p = e.target.dataset?.p; if (p) go(p); };
$('back').onclick = () => { if (S.hpos > 0) go(S.hist[--S.hpos], { push: false }); };
$('fwd').onclick = () => { if (S.hpos < S.hist.length - 1) go(S.hist[++S.hpos], { push: false }); };
$('up').onclick = () => { const p = parentOf(S.root); if (p !== S.root) { const child = S.root; go(p).then(() => select(child)); } };

// ---------- Seitenleiste ----------
async function sidebar() {
  const pl = await fsx.places();
  const row = (x, icon) => `<div class="pl" data-p="${esc(x.path)}" title="${esc(x.path)}"><b>${icon || x.icon}</b>${esc(x.label)}</div>`;
  $('favs').innerHTML = pl.favorites.map(f => row(f)).join(''); $('devs').innerHTML = pl.devices.map(d => row(d, '◉')).join('');
  document.querySelectorAll('.pl').forEach(el => el.onclick = () => go(el.dataset.p));
  return pl;
}
function sidebarMark() { document.querySelectorAll('.pl').forEach(el => el.classList.toggle('on', el.dataset.p === S.root)); }
async function diskInfo() {
  const d = await fsx.disk(S.root); if (!d) { $('disk').innerHTML = ''; return; }
  const used = d.total - d.free, pct = Math.round(100 * used / d.total);
  $('disk').innerHTML = `SPEICHER ${fmtSize(used)} / ${fmtSize(d.total)}<br>${fmtSize(d.free)} frei<i><b style="width:${pct}%;${pct > 90 ? 'background:#ff003c' : ''}"></b></i>`;
}

// ---------- Knoten-Ansicht ----------
function buildTree() {
  let row = 0; const nodes = [], edges = [];
  const walk = (item, depth, parent) => {
    const n = { item, depth, x: depth * COLW, y: 0, parent };
    nodes.push(n);
    if (item.dir && S.expanded.has(item.path) && S.cache.has(item.path)) {
      const all = visible(S.cache.get(item.path)), lim = S.page.get(item.path) || PAGE;
      const kids = all.slice(0, lim).map(c => walk(c, depth + 1, n));
      if (all.length > lim) kids.push(walk({ more: true, path: item.path + '#more', name: `${all.length - lim} weitere`, owner: item.path }, depth + 1, n));
      if (!all.length) kids.push(walk({ empty: true, path: item.path + '#empty', name: S.cache.get(item.path).error ? 'Kein Zugriff' : 'leer' }, depth + 1, n));
      kids.forEach(k => edges.push([n, k]));
      n.y = kids.length ? (kids[0].y + kids[kids.length - 1].y) / 2 : row++ * ROWH;
    } else n.y = row++ * ROWH;
    return n;
  };
  const rootItem = { name: nameOf(S.root) || S.root, path: S.root, dir: true, kind: 'dir', count: visible(S.cache.get(S.root) || []).length, root: true };
  walk(rootItem, 0, null);
  return { nodes, edges, rows: row };
}
const isOnPath = p => S.active && (S.active === p || S.active.startsWith(p.endsWith(SEP) ? p : p + SEP));
function renderNodes() {
  const { nodes, edges } = buildTree();
  const maxX = Math.max(...nodes.map(n => n.x)) + 260, maxY = Math.max(...nodes.map(n => n.y)) + 60;
  let svg = '<defs><filter id="glow"><feGaussianBlur stdDeviation="3"/></filter></defs>';
  for (const [a, b] of edges) {
    const x1 = a.x + 224, y1 = a.y + 18, x2 = b.x, y2 = b.y + 18, mx = x1 + 25;
    const d = `M${x1},${y1} L${mx},${y1} L${mx},${y2} L${x2},${y2}`, on = !b.item.more && !b.item.empty && isOnPath(b.item.path);
    svg += on ? `<path d="${d}" stroke="#ff2d3d" stroke-width="5" fill="none" filter="url(#glow)" opacity=".6"/><path d="${d}" stroke="#ff2d3d" stroke-width="2" fill="none"/>`
      : `<path d="${d}" stroke="#5ef4f8" stroke-width="1.1" fill="none" opacity=".45"/>`;
    svg += `<circle cx="${x2}" cy="${y2}" r="2.5" fill="${on ? '#ff2d3d' : '#5ef4f8'}"/>`;
  }
  $('wires').setAttribute('width', maxX); $('wires').setAttribute('height', maxY); $('wires').innerHTML = svg;
  $('nodes').innerHTML = nodes.map(n => {
    const it = n.item, c = ['n'];
    if (it.more) c.push('more'); else if (it.empty) c.push('more');
    else {
      c.push(it.dir ? 'dir' : 'k-' + it.kind);
      if (it.root) c.push('root'); if (it.dir && S.expanded.has(it.path) && !it.root) c.push('open');
      if (S.sel.has(it.path)) c.push('sel'); else if (isOnPath(it.path) && it.dir) c.push('path');
      if (it.hidden) c.push('hid'); if (it.denied) c.push('denied');
      if (S.clip && S.clip.mode === 'move' && S.clip.items.includes(it.path)) c.push('cut');
    }
    const sub = it.more ? 'anzeigen' : it.empty ? '' : it.dir ? (it.denied ? 'kein Zugriff' : (it.count ?? 0) + ' Elemente') : `${fmtSize(it.size)} · ${KIND[it.kind]}`;
    return `<div class="${c.join(' ')}" style="left:${n.x}px;top:${n.y}px" data-p="${esc(it.path)}" title="${esc(it.name)}" ${!it.more && !it.empty && !it.root ? 'draggable="true"' : ''}${it.owner ? ` data-owner="${esc(it.owner)}"` : ''}>
      <div class="t">${esc(it.name)}</div><div class="s">${esc(sub)}</div></div>`;
  }).join('');
  if (S.centerNext) { S.centerNext = false; const st = $('stage').getBoundingClientRect(); S.pan.y = Math.max(20, st.height / 2 - nodes[0].y - 18); }
  applyTransform();
}
// Ausgewählten Knoten (und seine aufgeklappten Kinder) in den sichtbaren Bereich schieben
function ensureVisible(p) {
  const el = [...document.querySelectorAll('.n')].find(n => n.dataset.p === p); if (!el) return;
  let x1 = el.offsetLeft, y1 = el.offsetTop, x2 = x1 + el.offsetWidth, y2 = y1 + el.offsetHeight;
  for (const k of document.querySelectorAll('.n')) if (k.dataset.p.startsWith(p + SEP) || k.dataset.p.startsWith(p + '#')) {
    if (k.offsetLeft > x2 + 300) continue; x2 = Math.max(x2, k.offsetLeft + k.offsetWidth); y1 = Math.min(y1, k.offsetTop); y2 = Math.max(y2, k.offsetTop + k.offsetHeight); }
  const st = $('stage').getBoundingClientRect(), m = 30, z = S.zoom;
  const toScreen = v => v * z;
  const vw = st.width, vh = st.height - 30;
  if (toScreen(x2) + S.pan.x > vw - m) S.pan.x = vw - m - toScreen(x2);
  if (toScreen(x1) + S.pan.x < m) S.pan.x = m - toScreen(x1);
  if (toScreen(y2 - y1) < vh - 2 * m) { if (toScreen(y2) + S.pan.y > vh - m) S.pan.y = vh - m - toScreen(y2); if (toScreen(y1) + S.pan.y < m) S.pan.y = m - toScreen(y1); }
  else S.pan.y = m - toScreen(el.offsetTop) + Math.min(vh / 3, 120);
  $('world').classList.add('anim'); applyTransform(); setTimeout(() => $('world').classList.remove('anim'), 260);
}
function applyTransform() { $('world').style.transform = `translate(${S.pan.x}px,${S.pan.y}px) scale(${S.zoom})`; }
const itemOf = p => { if (p === S.root) return { path: S.root, dir: true, name: nameOf(S.root), kind: 'dir' }; const par = parentOf(p); return (S.cache.get(par) || []).find(i => i.path === p) || (S.search || []).find(i => i.path === p); };

$('nodes').addEventListener('click', async e => {
  const el = e.target.closest('.n'); if (!el) return;
  if (el.dataset.owner) { S.page.set(el.dataset.owner, (S.page.get(el.dataset.owner) || PAGE) + 40); render(); ensureVisible(el.dataset.owner); return; }
  const p = el.dataset.p; if (p.includes('#')) return;
  const it = itemOf(p);
  if (e.ctrlKey || e.metaKey) { S.sel.has(p) ? S.sel.delete(p) : S.sel.add(p); S.active = p; render(); preview(p); return; }
  S.sel = new Set([p]); S.active = p;
  if (it && it.dir && p !== S.root) {
    if (S.expanded.has(p)) { for (const x of [...S.expanded]) if (x === p || x.startsWith(p + SEP)) S.expanded.delete(x); }
    else { S.expanded.add(p); await load(p, true); }
  }
  render(); ensureVisible(p); preview(p);
});
$('nodes').addEventListener('dblclick', e => {
  const el = e.target.closest('.n'); if (!el || el.dataset.p.includes('#')) return;
  const it = itemOf(el.dataset.p); if (!it) return;
  if (it.dir) go(it.path); else fsx.open(it.path);
});
// Pan & Zoom
let drag = null;
$('stage').addEventListener('mousedown', e => { if (e.button !== 0 || e.target.closest('.n')) return; drag = { x: e.clientX - S.pan.x, y: e.clientY - S.pan.y }; $('stage').classList.add('drag'); });
window.addEventListener('mousemove', e => { if (!drag) return; S.pan.x = e.clientX - drag.x; S.pan.y = e.clientY - drag.y; applyTransform(); });
window.addEventListener('mouseup', () => { drag = null; $('stage').classList.remove('drag'); });
$('stage').addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey) {
    const r = $('stage').getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, z = Math.min(2, Math.max(.3, S.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    S.pan.x = mx - (mx - S.pan.x) * z / S.zoom; S.pan.y = my - (my - S.pan.y) * z / S.zoom; S.zoom = z;
  } else { S.pan.x -= e.shiftKey ? e.deltaY : e.deltaX; S.pan.y -= e.shiftKey ? 0 : e.deltaY; }
  applyTransform();
}, { passive: false });

// ---------- Liste ----------
function renderList() {
  const items = S.search ? S.search : visible(S.cache.get(S.root) || []);
  $('listhead').textContent = S.search ? `▸ SUCHERGEBNISSE „${$('search').value}“ · ${items.length}${items.length >= 300 ? '+' : ''} TREFFER` : '';
  const k = S.sort.k, d = S.sort.d;
  const sorted = [...items].sort((a, b) => (b.dir - a.dir) || ((k === 'name' ? a.name.localeCompare(b.name, 'de', { numeric: true }) : (a[k] ?? 0) > (b[k] ?? 0) ? 1 : (a[k] ?? 0) < (b[k] ?? 0) ? -1 : 0) * d));
  $('rows').innerHTML = sorted.map(i => `<tr class="${i.dir ? 'dir' : 'k-' + i.kind}${S.sel.has(i.path) ? ' sel' : ''}${S.clip && S.clip.mode === 'move' && S.clip.items.includes(i.path) ? ' cut' : ''}" data-p="${esc(i.path)}" draggable="true">
    <td class="nm">${esc(i.name)}${S.search ? `<span class="sub">${esc(i.parent)}</span>` : ''}</td><td class="num">${i.dir ? (i.count != null ? i.count + ' Elem.' : '') : fmtSize(i.size)}</td>
    <td class="dim">${KIND[i.kind] || ''}</td><td class="dim">${fmtDate(i.mtime)}</td></tr>`).join('') || `<tr><td class="dim" colspan="4">${(S.cache.get(S.root) || {}).error ? 'Kein Zugriff: ' + esc(S.cache.get(S.root).error) : 'Ordner ist leer'}</td></tr>`;
}
$('rows').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-p]'); if (!tr) return; const p = tr.dataset.p;
  if (e.ctrlKey) { S.sel.has(p) ? S.sel.delete(p) : S.sel.add(p); } else S.sel = new Set([p]);
  S.active = p; renderList(); status(); preview(p);
});
$('rows').addEventListener('dblclick', e => {
  const tr = e.target.closest('tr[data-p]'); if (!tr) return; const it = itemOf(tr.dataset.p) || { path: tr.dataset.p, dir: tr.classList.contains('dir') };
  if (it.dir) go(it.path); else fsx.open(it.path);
});
document.querySelectorAll('th').forEach(th => th.onclick = () => { S.sort.d = S.sort.k === th.dataset.k ? -S.sort.d : 1; S.sort.k = th.dataset.k; renderList(); });

function render() {
  $('stage').classList.toggle('hidden', S.view !== 'nodes' || !!S.search); $('listview').classList.toggle('hidden', S.view === 'nodes' && !S.search);
  $('vNodes').classList.toggle('on', S.view === 'nodes'); $('vList').classList.toggle('on', S.view === 'list'); $('hiddenBtn').classList.toggle('on', S.hidden);
  if (S.view === 'nodes' && !S.search) renderNodes(); else renderList();
  status();
}
function status() {
  const n = visible(S.cache.get(S.root) || []).length;
  $('status').textContent = `${n} Elemente${S.sel.size ? ` · ${S.sel.size} ausgewählt` : ''}`;
  $('buffer').textContent = S.clip ? `PUFFER: ${S.clip.items.length} × ${S.clip.mode === 'move' ? 'AUSSCHNEIDEN' : 'KOPIEREN'} — Strg+V zum Einfügen` : '';
}
async function select(p) { S.sel = new Set([p]); S.active = p; render(); if (S.view === 'nodes') ensureVisible(p); preview(p); }

// ---------- Vorschau ----------
async function preview(p) {
  let i; try { i = await fsx.preview(p); } catch (e) { $('pv').innerHTML = `<div class="dim">${esc(e.message)}</div>`; return; }
  if (S.active !== p) return;
  let body = '';
  if (i.kind === 'img') body = `<img class="img" src="${fileUrl(i.path)}">`;
  else if (i.kind === 'pdf') body = `<embed src="${fileUrl(i.path)}" type="application/pdf">`;
  else if (i.kind === 'video') body = `<video src="${fileUrl(i.path)}" controls></video>`;
  else if (i.kind === 'audio') body = `<audio src="${fileUrl(i.path)}" controls></audio>`;
  else if (i.text != null) body = `<pre>${esc(i.text)}${i.truncated ? '\n…' : ''}</pre>`;
  const it = itemOf(p);
  $('pv').innerHTML = `${body}<div class="name">${esc(i.name)}</div><div class="meta">${i.kind === 'dir' ? `Ordner · ${it && it.count != null ? it.count + ' Elemente' : ''}` : `${KIND[i.kind] || 'Datei'} · ${fmtSize(i.size)}`}<br>geändert ${fmtDate(i.mtime)}<br>
    <span style="word-break:break-all">${esc(i.path)}</span></div><div class="acts"><button data-a="open">ÖFFNEN</button><button data-a="reveal">IM SYSTEM</button><button data-a="copypath">PFAD KOPIEREN</button><button data-a="props">EIGENSCHAFTEN</button></div>`;
}
$('pv').addEventListener('click', e => {
  const a = e.target.dataset.a; if (!a || !S.active) return;
  if (a === 'open') { const it = itemOf(S.active); it && it.dir ? go(S.active) : fsx.open(S.active); }
  if (a === 'props') showProps(S.active);
  if (a === 'reveal') fsx.reveal(S.active); if (a === 'copypath') fsx.copyPath(S.active);
});

// ---------- Dateioperationen ----------
const curDir = () => { const a = S.active && itemOf(S.active); return a && a.dir && S.expanded.has(a.path) ? a.path : S.active && S.active !== S.root ? parentOf(S.active) : S.root; };
async function refresh(dirs) { for (const d of new Set(dirs)) if (S.cache.has(d)) await load(d, true); await load(S.root, true); render(); diskInfo(); }
function ask(title, value = '') {
  return new Promise(res => {
    $('mTitle').textContent = title; $('mInput').value = value; $('modal').classList.remove('hidden'); $('mInput').focus();
    const dot = value.lastIndexOf('.'); $('mInput').setSelectionRange(0, dot > 0 ? dot : value.length);
    const done = v => { $('modal').classList.add('hidden'); $('mOk').onclick = $('mCancel').onclick = $('mInput').onkeydown = null; res(v); };
    $('mOk').onclick = () => done($('mInput').value.trim()); $('mCancel').onclick = () => done(null);
    $('mInput').onkeydown = e => { if (e.key === 'Enter') done($('mInput').value.trim()); if (e.key === 'Escape') done(null); e.stopPropagation(); };
  });
}
const toast = m => { $('status').textContent = m; setTimeout(status, 3500); };
const Ops = {
  async newFolder() { const d = curDir(); const n = await ask('NEUER ORDNER IN ' + nameOf(d).toUpperCase(), 'Neuer Ordner'); if (!n) return;
    try { const t = await fsx.mkdir(d, n); S.expanded.add(d); await refresh([d]); select(t); } catch (e) { toast('Fehler: ' + e.message); } },
  async rename() { if (!S.active || S.active === S.root) return; const old = S.active; const n = await ask('UMBENENNEN', nameOf(old)); if (!n || n === nameOf(old)) return;
    try { const t = await fsx.rename(old, n); if (S.expanded.has(old)) { S.expanded.delete(old); S.expanded.add(t); } await refresh([parentOf(old)]); select(t); } catch (e) { toast('Fehler: ' + e.message); } },
  async trash() { const items = [...S.sel].filter(p => p !== S.root); if (!items.length) return;
    const done = await fsx.trash(items); S.sel.clear(); S.active = null; await refresh(items.map(parentOf)); toast(`${done.length} in den Papierkorb verschoben`); },
  copy(mode = 'copy') { const items = [...S.sel].filter(p => p !== S.root); if (items.length) { S.clip = { items, mode }; render(); } },
  async paste(dest = curDir()) { if (!S.clip) return;
    try { const out = await fsx.paste(S.clip.items, dest, S.clip.mode); const dirs = [dest, ...S.clip.items.map(parentOf)];
      if (S.clip.mode === 'move') S.clip = null; S.expanded.add(dest); await refresh(dirs); toast(`${out.length} eingefügt in ${nameOf(dest)}`); }
    catch (e) { toast('Fehler: ' + e.message); } },
};

// Kontextmenü
function menu(x, y, p) {
  if (p && !S.sel.has(p)) { S.sel = new Set([p]); S.active = p; render(); preview(p); }
  const it = p && itemOf(p), many = S.sel.size > 1, isRoot = p === S.root;
  const E = [
    it && ['Öffnen', 'Enter', () => it.dir ? go(p) : fsx.open(p)],
    it && it.dir && !isRoot && ['Hier als Wurzel', '', () => go(p)],
    it && ['Im System anzeigen', '', () => fsx.reveal(p)], '-',
    ['Neuer Ordner', 'Strg+Umschalt+N', Ops.newFolder],
    it && !isRoot && ['Kopieren', 'Strg+C', () => Ops.copy('copy')], it && !isRoot && ['Ausschneiden', 'Strg+X', () => Ops.copy('move')],
    ['Einfügen' + (S.clip ? ` (${S.clip.items.length})` : ''), 'Strg+V', () => Ops.paste(it && it.dir ? p : curDir()), !S.clip], '-',
    it && !isRoot && !many && ['Umbenennen', 'F2', Ops.rename], it && ['Pfad kopieren', '', () => fsx.copyPath(p)],
    it && !isRoot && ['In den Papierkorb', 'Entf', Ops.trash], '-',
    it && ['Eigenschaften', 'Alt+Enter', () => showProps(p)],
  ].filter(Boolean);
  $('menu').innerHTML = E.map((m, i) => m === '-' ? '<hr>' : `<div data-i="${i}" class="${m[3] ? 'off' : ''}">${m[0]}<span>${m[1]}</span></div>`).join('');
  $('menu').classList.remove('hidden');
  const mw = $('menu').offsetWidth, mh = $('menu').offsetHeight;
  $('menu').style.left = Math.min(x, innerWidth - mw - 4) + 'px'; $('menu').style.top = Math.min(y, innerHeight - mh - 4) + 'px';
  $('menu').onclick = e => { const d = e.target.closest('[data-i]'); if (!d) return; $('menu').classList.add('hidden'); E[+d.dataset.i][2](); };
}
document.addEventListener('contextmenu', e => {
  e.preventDefault(); const el = e.target.closest('.n[data-p], tr[data-p]');
  if (!el && !e.target.closest('#stage, #listview')) return;
  const p = el && !el.dataset.p.includes('#') ? el.dataset.p : null; menu(e.clientX, e.clientY, p);
});
document.addEventListener('mousedown', e => { if (!e.target.closest('#menu')) $('menu').classList.add('hidden'); });

// Drag & Drop (verschieben, mit Strg kopieren)
let dragItems = null;
document.addEventListener('dragstart', e => {
  const el = e.target.closest('[data-p][draggable]'); if (!el) return; const p = el.dataset.p;
  if (!S.sel.has(p)) S.sel = new Set([p]); dragItems = [...S.sel]; e.dataTransfer.effectAllowed = 'copyMove';
});
document.addEventListener('dragover', e => {
  const el = e.target.closest('.n.dir[data-p], tr.dir[data-p], .n.root'); document.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
  if (!el || !dragItems || dragItems.includes(el.dataset.p)) return; e.preventDefault(); e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'; el.classList.add('drop');
});
document.addEventListener('drop', async e => {
  const el = e.target.closest('.n.dir[data-p], tr.dir[data-p], .n.root'); document.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
  if (!el || !dragItems) return; e.preventDefault();
  const keep = S.clip; S.clip = { items: dragItems, mode: e.ctrlKey ? 'copy' : 'move' }; await Ops.paste(el.dataset.p); S.clip = keep && keep.mode === 'copy' ? keep : null; dragItems = null; render();
});
document.addEventListener('dragend', () => { dragItems = null; document.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')); });

// Suche
$('search').addEventListener('keydown', async e => {
  if (e.key === 'Escape') { $('search').value = ''; S.search = null; render(); $('search').blur(); }
  if (e.key !== 'Enter') return;
  const q = $('search').value.trim(); if (!q) { S.search = null; render(); return; }
  $('status').textContent = 'Suche …'; S.search = await fsx.search(S.root, q); render();
});

// Ansicht & Tastatur
$('vNodes').onclick = () => { S.view = 'nodes'; S.search = null; fsx.settings({ view: 'nodes' }); render(); };
$('vList').onclick = () => { S.view = 'list'; fsx.settings({ view: 'list' }); render(); };
$('pvBtn').onclick = () => { const off = document.body.classList.toggle('nopv'); $('pvBtn').classList.toggle('on', !off); fsx.settings({ preview: !off }); };
$('hiddenBtn').onclick = () => { S.hidden = !S.hidden; fsx.settings({ hidden: S.hidden }); render(); };
document.addEventListener('keydown', e => {
  if (!$('modal').classList.contains('hidden') || e.target.tagName === 'INPUT') { if (e.ctrlKey && e.key === 'f') { e.preventDefault(); $('search').focus(); } return; }
  const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
  if (c && k === 'f') { e.preventDefault(); $('search').focus(); $('search').select(); }
  else if (c && k === 'c') Ops.copy('copy'); else if (c && k === 'x') Ops.copy('move'); else if (c && k === 'v') Ops.paste();
  else if (c && e.shiftKey && k === 'n') Ops.newFolder(); else if (c && k === 'h') $('hiddenBtn').click(); else if (c && k === 'p') $('pvBtn').click();
  else if (c && k === '1') $('vNodes').click(); else if (c && k === '2') $('vList').click();
  else if (c && k === 'a') { S.sel = new Set(visible(S.cache.get(S.root) || []).map(i => i.path)); render(); }
  else if (e.altKey && k === 'enter' && S.active) showProps(S.active);
  else if (k === 'f2') Ops.rename(); else if (k === 'delete') Ops.trash();
  else if (k === 'backspace' || (e.altKey && k === 'arrowup')) $('up').click();
  else if (e.altKey && k === 'arrowleft') $('back').click(); else if (e.altKey && k === 'arrowright') $('fwd').click();
  else if (k === 'enter' && S.active) { const it = itemOf(S.active); it && it.dir ? go(it.path) : fsx.open(S.active); }
  else if (k === 'f5') refresh([...S.expanded]);
  else if (k === 'escape') { S.sel.clear(); S.active = null; render(); }
});

(async () => {
  const st = await fsx.settings(); S.view = st.view || 'nodes'; S.hidden = !!st.hidden;
  if (st.preview === false) { document.body.classList.add('nopv'); $('pvBtn').classList.remove('on'); }
  const pl = await sidebar();
  const q = new URLSearchParams(location.search).get('start');
  go(q || st.last || pl.home);
})();
setTimeout(() => document.querySelector('.hint')?.classList.add('fade'), 9000);

// ---------- Eigenschaften ----------
const ICON = { dir: '▣', img: '▨', pdf: '◈', audio: '♪', video: '▶', archive: '▤', app: '⚙', doc: '▦', text: '◇', file: '◇' };
let propsToken = null, propsShow = null;
fsx.onPropsProgress(d => { if (d.token === propsToken && propsShow) propsShow(d); });
const fmtBytes = n => n == null ? '—' : `${fmtSize(n)}${n >= 1024 ? ` (${n.toLocaleString('de-AT')} Bytes)` : ''}`;
const fmtLong = t => t ? new Date(t).toLocaleString('de-AT', { dateStyle: 'full', timeStyle: 'medium' }) : '—';
async function showProps(p) {
  if (!p || p.includes('#')) return;
  let r; try { r = await fsx.props(p); } catch (e) { toast('Fehler: ' + e.message); return; }
  const tok = propsToken = Math.random().toString(36).slice(2);
  const row = (k, v, cls = '') => `<div class="k">${k}</div><div class="v ${cls}">${v}</div>`;
  let perm = '';
  if (r.platform !== 'win32') {
    const bits = [['Besitzer', 6], ['Gruppe', 3], ['Andere', 0]];
    perm = `<div class="pgrid"><div class="k">BERECHTIGUNGEN</div><div class="v"><table class="perm"><tr><th></th><th>LESEN</th><th>SCHREIBEN</th><th>${r.dir ? 'BETRETEN' : 'AUSFÜHREN'}</th></tr>
      ${bits.map(([n, sh]) => `<tr><td>${n}</td>${[4, 2, 1].map(b => `<td><input type="checkbox" data-bit="${b << sh}" ${r.mode & (b << sh) ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}</table>
      <div class="dim" style="margin-top:4px">Modus <span id="pMode" class="c">${r.mode.toString(8).padStart(4, '0')}</span></div></div></div>`;
  }
  const attrs = r.platform === 'win32'
    ? `<label class="chk"><input type="checkbox" id="pRo" ${r.attrs?.readonly ? 'checked' : ''}> Schreibgeschützt</label><label class="chk"><input type="checkbox" id="pHid" ${r.attrs?.hidden ? 'checked' : ''}> Versteckt</label>${r.attrs?.system ? '<div class="dim">Systemdatei</div>' : ''}`
    : `<label class="chk"><input type="checkbox" id="pRo" ${r.attrs?.readonly ? 'checked' : ''}> Schreibgeschützt (für Besitzer)</label>${r.attrs?.hidden ? '<div class="dim">Versteckt (Name beginnt mit „.“)</div>' : ''}`;
  const disk = r.disk ? (() => { const used = r.disk.total - r.disk.free, pct = Math.round(100 * used / r.disk.total);
    return row('DATENTRÄGER', `${fmtSize(r.disk.free)} frei von ${fmtSize(r.disk.total)}<div class="pbar"><b style="width:${pct}%"></b></div>`); })() : '';
  $('pBody').innerHTML = `<div class="phead"><div class="big">${ICON[r.kind] || '◇'}</div><div><div class="nm">${esc(r.name)}</div><div class="ty">${r.dir ? 'Ordner' : (KIND[r.kind] || 'Datei') + (r.ext ? ` (.${esc(r.ext.toLowerCase())})` : '')}${r.link ? ' · Verknüpfung' : ''}</div></div></div>
    <div class="pgrid">${row('ORT', esc(parentOf(r.path)))}${r.link ? row('ZIEL', esc(r.link), 'c') : ''}
      ${r.dir ? row('GRÖSSE', '<span id="pSize" class="c">wird berechnet …</span>') + row('INHALT', '<span id="pCount">…</span>') : row('GRÖSSE', fmtBytes(r.size), 'c')}
      ${disk}</div>
    <div class="pgrid">${row('ERSTELLT', fmtLong(r.ctime))}${row('GEÄNDERT', fmtLong(r.mtime))}${row('LETZTER ZUGRIFF', fmtLong(r.atime))}</div>
    ${r.owner ? `<div class="pgrid">${row('BESITZER', esc(r.owner))}${row('GRUPPE', esc(r.group))}</div>` : ''}
    ${perm}<div class="pgrid"><div class="k">ATTRIBUTE</div><div class="v">${attrs}</div></div>
    <div class="pacts">${r.platform === 'win32' ? '<button id="pNative">WINDOWS-EIGENSCHAFTEN</button>' : ''}<button id="pCopy">PFAD KOPIEREN</button><button id="pOk" class="primary">SCHLIESSEN</button></div>`;
  $('props').classList.remove('hidden');
  const close = () => { $('props').classList.add('hidden'); fsx.propsSizeStop(tok); propsToken = null; };
  $('pClose').onclick = $('pOk').onclick = close;
  $('props').onmousedown = e => { if (e.target.id === 'props') close(); };
  $('pCopy').onclick = () => { fsx.copyPath(r.path); toast('Pfad kopiert'); };
  if ($('pNative')) $('pNative').onclick = async () => { $('pNative').disabled = true; await fsx.propsNative(r.path); toast('Windows-Eigenschaften werden geöffnet …'); setTimeout(() => { if ($('pNative')) $('pNative').disabled = false; }, 2500); };
  const apply = async ch => { try { await fsx.propsSet(r.path, ch); toast('Gespeichert'); refresh([parentOf(r.path)]); } catch (e) { toast('Fehler: ' + e.message); showProps(p); } };
  $('pRo').onchange = e => apply({ readonly: e.target.checked });
  if ($('pHid')) $('pHid').onchange = e => apply({ hidden: e.target.checked });
  $('pBody').querySelectorAll('[data-bit]').forEach(cb => cb.onchange = () => {
    let m = r.mode & ~0o777; $('pBody').querySelectorAll('[data-bit]').forEach(x => { if (x.checked) m |= +x.dataset.bit; });
    r.mode = m; $('pMode').textContent = m.toString(8).padStart(4, '0'); apply({ mode: m });
  });
  if (r.dir) {
    const show = d => { if (propsToken !== tok || !$('pSize')) return; $('pSize').textContent = fmtBytes(d.size) + (d.partial ? ' (abgebrochen)' : ''); $('pCount').textContent = `${d.files.toLocaleString('de-AT')} Dateien, ${d.dirs.toLocaleString('de-AT')} Ordner`; };
    propsShow = d => { show(d); if ($('pSize')) $('pSize').textContent += ' …'; };
    fsx.propsSize(r.path, tok).then(show);
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('props').classList.contains('hidden')) { $('pClose').click(); e.stopImmediatePropagation(); } }, true);
fsx.onGoto(d => { if (d) go(d); });
// Windows-Option Win+E
fsx.wineGet().then(v => { if (v === null) return; $('winopt').classList.remove('hidden'); $('wineChk').checked = v;
  $('wineChk').onchange = async e => { await fsx.wineSet(e.target.checked); toast(e.target.checked ? 'Win+E öffnet jetzt Cyberdeck Files' : 'Win+E öffnet wieder den Explorer'); }; });
