// Makes desktop/icon.png (1024×1024, transparent corners) from desktop/icon.svg, with
// Chromium's own SVG renderer. electron-builder turns that PNG into the Windows .ico, the
// macOS .icns and the Linux icons. Run it after changing the SVG:
//
//   npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const svg = path.join(__dirname, "../desktop/icon.svg");
const png = path.join(__dirname, "../desktop/icon.png");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL("data:text/html,<!doctype html><title>icon</title>");
  const source = `data:image/svg+xml;base64,${readFileSync(svg).toString("base64")}`;
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1024;
      canvas.getContext("2d").drawImage(img, 0, 0, 1024, 1024);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("the SVG didn't load"));
    img.src = ${JSON.stringify(source)};
  })`);
  writeFileSync(png, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`wrote ${path.relative(process.cwd(), png)}`);
  app.quit();
});
