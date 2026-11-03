const { contextBridge, ipcRenderer } = require('electron');
const call = ch => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('fsx', {
  list: call('list'), places: call('places'), disk: call('disk'), settings: call('settings'), preview: call('preview'),
  open: call('open'), reveal: call('reveal'), mkdir: call('mkdir'), rename: call('rename'), trash: call('trash'),
  paste: call('paste'), search: call('search'), copyPath: call('copy-path'), parent: call('parent'),
  sep: process.platform === 'win32' ? '\\' : '/', platform: process.platform,
});
