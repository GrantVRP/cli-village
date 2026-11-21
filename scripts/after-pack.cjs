// electron-builder's afterPack hook (see electron-builder.yml). It runs after the app folder
// is made and before it's signed and packed into installers.
//
// node-pty's prebuilt spawn-helper (macOS) arrives without its executable bit, and without it
// the terminal can't start a shell ("posix_spawnp failed"). The app terminal's own
// cli-village command needs the bit too, and git on Windows may not keep it. So both get it here.
const { chmodSync, existsSync, readdirSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const pty = path.join(resources, "node-pty");
  const prebuilds = path.join(pty, "prebuilds");
  const programs = [
    path.join(resources, "bin", "cli-village"),
    path.join(pty, "build", "Release", "spawn-helper"),
    ...(existsSync(prebuilds) ? readdirSync(prebuilds).map((dir) => path.join(prebuilds, dir, "spawn-helper")) : []),
  ];
  for (const file of programs) {
    if (existsSync(file)) chmodSync(file, 0o755);
  }
};
