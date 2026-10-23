// Exposes exactly one capability to the page: writing the finished translation to the system clipboard.
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('transcrilatorDesktop', {
  copy: (text, html) => ipcRenderer.invoke('transcrilator:copy', {text: String(text), html: String(html)})
});
