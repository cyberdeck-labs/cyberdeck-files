#!/usr/bin/env bash
# End-to-End-Test: startet die App headless gegen einen Test-Ordner und prüft Knoten, Vorschau, Dateioperationen
cd "$(dirname "$0")/.."
T=$(mktemp -d); [ -n "$KEEP" ] || trap 'rm -rf "$T"' EXIT
mkdir -p "$T/root/Projekte/app/src" "$T/root/Bilder" "$T/root/Leer"
echo "# Hallo Cyberdeck" > "$T/root/notiz.md"; echo "console.log(1)" > "$T/root/Projekte/app/src/main.js"
for i in $(seq 1 20); do echo $i > "$T/root/Bilder/bild$i.txt"; done
magick -size 64x64 xc:'#ff2d3d' "$T/root/Bilder/rot.png" 2>/dev/null || cp build/icon.png "$T/root/Bilder/rot.png"
cat > "$T/ui.js" <<'EOF'
(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); const r = {}; const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
  const node = name => qa('.n').find(n => n.querySelector('.t').textContent === name) || { click() { throw new Error('Knoten fehlt: ' + name + ' / ' + qa('.n').map(n => n.querySelector('.t').textContent).join(',')); } };
  await w(800);
  r.rootNodes = qa('.n').length; r.wires = qa('#wires path').length;
  node('Projekte').click(); await w(400); r.expanded = !!qa('.n').find(n => n.textContent.includes('app'));
  node('app').click(); await w(400); node('src').click(); await w(400); r.deep = !!node('main.js');
  r.redPath = qa('#wires path[stroke="#ff2d3d"]').length > 0;
  node('Bilder').click(); await w(400); r.more = !!qa('.n.more').find(n => /weitere/.test(n.textContent));
  node('notiz.md').click(); await w(500); r.preview = (q('#pv pre')?.textContent || '').includes('Hallo Cyberdeck');
  qa('.n.more').find(n => /weitere/.test(n.textContent)).click(); await w(400); r.moreOpened = qa('.n').some(n => n.textContent.includes('bild20')); node('rot.png').click(); await w(500); r.imgPreview = !!q('#pv img');
  // Neuer Ordner via Modal
  node('Leer').click(); await w(300); r.emptyNode = !!node('leer');
  q('.n.root').click(); await w(200); const p1 = Ops.newFolder(); await w(200); q('#mInput').value = 'Neu'; q('#mOk').click(); await p1; await w(400);
  r.mkdir = !!node('Neu');
  // Kopieren + Einfügen
  node('notiz.md').click(); await w(200); Ops.copy('copy'); node('Neu').click(); await w(300); S.active = S.sel.values().next().value; await Ops.paste(); await w(400);
  r.copied = qa('.n').filter(n => n.querySelector('.t').textContent === 'notiz.md').length === 2;
  // Umbenennen
  node('Leer').click(); await w(200); const p2 = Ops.rename(); await w(200); q('#mInput').value = 'Archiv'; q('#mOk').click(); await p2; await w(400);
  r.renamed = qa('.n').some(n => n.querySelector('.t').textContent === 'Archiv') && !qa('.n').some(n => n.querySelector('.t').textContent === 'Leer'); r.renStatus = q('#status').textContent;
  // Liste + Suche
  q('#vList').click(); await w(300); r.listRows = qa('#rows tr[data-p]').length;
  q('#search').value = 'main'; q('#search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await w(800);
  r.search = qa('#rows tr[data-p]').some(t => t.textContent.includes('main.js'));
  q('#vNodes').click(); await w(300);
  r.disk = /SPEICHER/.test(q('#disk').textContent);
  // Eigenschaften
  const root = S.root, sep = fsx.sep;
  await showProps(root + sep + 'notiz.md'); await w(400);
  r.propsFile = /18 B/.test(q('#pBody').textContent) && !!q('#pRo');
  q('#pRo').click(); await w(600); q('#pClose').click();
  await showProps(root + sep + 'Bilder'); await w(1500);
  r.propsDir = q('#pCount')?.textContent || ''; q('#pClose').click();
  return r; })()
EOF
FILES_PROFILE="$T/prof" FILES_START="$T/root" FILES_UIEVAL="$T/ui.js" FILES_SHOT="${SHOT:-$T/shot.png}" timeout 60 node_modules/.bin/electron . --ozone-platform=headless > "$T/out.txt" 2>&1
J=$(grep -o 'UIEVAL {.*}' "$T/out.txt" | sed 's/^UIEVAL //')
[ -z "$J" ] && { echo "FAIL: keine Ausgabe"; grep -i err "$T/out.txt" | head; exit 1; }
echo "$J"
node -e '
const r = JSON.parse(process.argv[1]); const fs = require("fs"), T = process.argv[2]; let ok = 0, n = 0;
const t = (name, c) => { n++; if (c) ok++; else console.log("FAIL", name); };
t("Wurzel-Knoten", r.rootNodes >= 5 && r.wires > 0); t("Aufklappen", r.expanded); t("Tiefe Ebenen", r.deep); t("Roter Pfad", r.redPath);
t("+weitere bei großen Ordnern", r.more && r.moreOpened); t("Text-Vorschau", r.preview); t("Bild-Vorschau", r.imgPreview); t("Leerer Ordner", r.emptyNode);
t("Neuer Ordner", r.mkdir && fs.existsSync(T + "/root/Neu")); t("Kopieren", r.copied && fs.existsSync(T + "/root/Neu/notiz.md") && fs.existsSync(T + "/root/notiz.md"));
t("Umbenennen", r.renamed && fs.existsSync(T + "/root/Archiv")); t("Liste", r.listRows >= 5); t("Suche", r.search); t("Speicheranzeige", r.disk);
t("Eigenschaften Datei", r.propsFile); t("Ordnergröße", /21 Dateien/.test(r.propsDir));
t("Schreibschutz", (fs.statSync(T + "/root/notiz.md").mode & 0o200) === 0);
console.log(ok + "/" + n + " bestanden"); process.exit(ok === n ? 0 : 1);' "$J" "$T"
