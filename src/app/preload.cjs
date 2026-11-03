// The bridge between the desktop app's window and the main process.
// The window gets exactly these few functions and nothing else from Node.js.
// (Plain CommonJS on purpose: Electron's sandboxed preload scripts can't use ESM.)

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cliVillage", {
  /** Mode, version, folder, git branch, Infisical status, and the village's socket. */
  info: () => ipcRenderer.invoke("app:info"),
  pty: {
    create: (cols, rows) => ipcRenderer.invoke("pty:create", cols, rows),
    write: (data) => ipcRenderer.send("pty:write", data),
    resize: (cols, rows) => ipcRenderer.send("pty:resize", cols, rows),
    onData: (listener) => {
      const handler = (_event, data) => listener(data);
      ipcRenderer.on("pty:data", handler);
      return () => ipcRenderer.off("pty:data", handler);
    },
    onExit: (listener) => {
      const handler = (_event, code) => listener(code);
      ipcRenderer.on("pty:exit", handler);
      return () => ipcRenderer.off("pty:exit", handler);
    },
  },
  /** Play one round of the demo in the open village. */
  playDemo: () => ipcRenderer.invoke("demo:play"),
});
