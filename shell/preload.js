// 12-源码照搬 · 最小外壳 preload：只暴露安全的、必要的能力
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kun', {
  app: {
    scenarios: () => ipcRenderer.invoke('app:scenarios'),
    config: () => ipcRenderer.invoke('app:config'),
    dirs: () => ipcRenderer.invoke('app:dirs'),
    dshRoot: () => ipcRenderer.invoke('app:dshRoot'),
    openPath: (p) => ipcRenderer.invoke('app:openPath', p),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    load: () => ipcRenderer.invoke('app:load'),
    home: () => ipcRenderer.invoke('app:home'),
    balance: () => ipcRenderer.invoke('app:balance'),
    version: () => ipcRenderer.invoke('app:version'),
    injectMemory: () => ipcRenderer.invoke('mem:inject'),
    disks: () => ipcRenderer.invoke('disk:list'),
  },
  fs: {
    list: (dir) => ipcRenderer.invoke('fs:list', dir),
    read: (p) => ipcRenderer.invoke('fs:read', p),
    // 只对学习工作区开放；主进程侧有路径/扩展名/大小三重白名单，这里不加逻辑
    write: (p, text) => ipcRenderer.invoke('fs:write', p, text),
  },
  // 学习内核通道：到期、判分、续点、复习评分全在 Python 内核算，
  // 界面**不许自己复刻一遍**（复刻过一次，due 全错、还把 items.jsonl 整体重写丢了 seq）
  learn: { call: (req) => ipcRenderer.invoke('learn:call', req) },
  webai: { open: (key, url, title) => ipcRenderer.invoke('webai:open', key, url, title) },
  win: {
    control: (action) => ipcRenderer.invoke('win:control', action),
  },
  topbar: {
    // 本壳没有快照系统：明确返回 supported:false，让「回退」显示"未接入"而不是假按钮
    snapshots: () => Promise.resolve({ rows: [], total: 0, supported: false }),
  },
});
