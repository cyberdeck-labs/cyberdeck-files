// Prueft das Windows-Eigenschaften-Skript unter Linux mit pwsh: Quoting, Syntax, Add-Type, Fehler-Log
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const PS = src.match(/const PROPS_PS = `([\s\S]*?)`;/)[1];
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const p = "C:\\Users\\Lea\\Lea's Ordner $(rm -rf x)\\Datei `n.txt";
const head = `$target = ${q(p)}; $dir = ${q('C:\\Users\\Lea')}; $name = ${q("Lea's Ordner $(rm -rf x)")}; $isRoot = $false;\n`;
const script = head + PS;
// 1) Syntax
const tmp = path.join(os.tmpdir(), 'cdf-props-test.ps1'); fs.writeFileSync(tmp, script);
const parse = execFileSync('pwsh', ['-NoProfile', '-Command',
  `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${tmp}',[ref]$null,[ref]$e);$e.Count`]).toString().trim();
console.log('Syntaxfehler:', parse);
// 2) Ausfuehren per -EncodedCommand (COM gibt es unter Linux nicht -> erwarteter Fehler im Log)
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-')); 
const enc = Buffer.from(script, 'utf16le').toString('base64');
execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { env: { ...process.env, TEMP: logDir } });
const log = fs.readFileSync(path.join(logDir, 'cyberdeck-files-props.log'), 'utf8');
console.log('Log:', log.trim().slice(0, 200));
const target = execFileSync('pwsh', ['-NoProfile', '-Command', head + '$target']).toString().trim();
console.log('Pfad korrekt uebergeben:', target === p, '|', target);
process.exit(parse === '0' && target === p && /Shell\.Application|COM|ComObject/i.test(log) ? 0 : 1);
