const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 필요한 경우 안전한 API만 노출
});