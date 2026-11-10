# Cyberdeck Files

Cyberpunk-styled file manager (Electron) for **Linux and Windows**.

![Node view](docs/knoten.png)

## Features
- **Node view**: folders are nodes. A click expands their contents as new nodes connected by wires. The active path glows red. Large folders are collapsed into "+N more".
- **List view** with sorting (name, size, type, date)
- **Preview**: images, text/code, PDF, audio, video
- **File operations**: new folder, rename, copy/cut/paste, move to trash, drag & drop (Ctrl = copy)
- **Search** in the current folder and below
- **Properties** (Alt+Enter / right-click): size (recursive for folders), contents, dates, owner, permissions (Linux, editable), read-only/hidden (Windows), button for the native Windows properties dialog
- **Windows: Win+E** can open Cyberdeck Files instead of Explorer (toggle in the sidebar, reversible)
- Favorites, drives/mounts, storage usage, show/hide hidden files
- Navigation: pan (drag), zoom (Ctrl+mouse wheel), history, breadcrumbs

## Shortcuts
| Key | Action |
|---|---|
| Ctrl+1 / Ctrl+2 | node / list view |
| Enter, double-click | open / enter folder |
| Backspace, Alt+↑ | parent folder |
| Alt+← / Alt+→ | back / forward |
| Ctrl+C / X / V | copy / cut / paste |
| F2 | rename |
| Alt+Enter | properties |
| Del | move to trash |
| Ctrl+Shift+N | new folder |
| Ctrl+F | search |
| Ctrl+H | hidden files |
| Ctrl+P | toggle preview |
| F5 | reload |

## Development
```bash
npm install
npm start
npm test             # e2e (headless)
npm run dist:linux   # AppImage
npm run dist:win     # Windows installer
```
