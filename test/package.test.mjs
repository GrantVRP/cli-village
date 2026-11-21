// What `npm publish` would put in the npm package (`npm pack --dry-run`): the command line
// and the browser village, and nothing from the desktop app or the repository itself.
// The desktop app is published separately, as installers (see docs/RELEASING.md).

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
// --ignore-scripts: the tests have built already (pretest); don't build again here.
const [pack] = JSON.parse(execSync("npm pack --dry-run --json --ignore-scripts", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const files = pack.files.map((f) => f.path.replaceAll("\\", "/"));

describe("the npm package", () => {
  it("has the command line and the browser village", () => {
    for (const file of ["dist/cli.js", "dist/web/index.html", "package.json", "README.md", "LICENSE", "SECURITY.md"]) assert.ok(files.includes(file), `${file} is missing`);
    assert.ok(files.includes(pkg.bin["cli-village"].replace(/^\.\//, "")), "the cli-village command is missing");
  });

  it("has nothing from the desktop app or the repository, and no source maps", () => {
    const unwanted = files.filter(
      (f) =>
        f.startsWith("dist/app/") ||
        f.endsWith(".map") ||
        /^(src|test|docs|app|web|scripts|build|release|\.github|\.style-preview)\//.test(f) ||
        /(^|\/)\.env|\.(pem|key|p12|pfx)$/.test(f),
    );
    assert.deepEqual(unwanted, []);
  });

  it("depends on no native code and no Electron", () => {
    const desktopOnly = ["node-pty", "electron", "electron-builder", "@xterm/xterm", "@xterm/addon-fit", "three"];
    assert.deepEqual(Object.keys(pkg.dependencies ?? {}).filter((name) => desktopOnly.includes(name)), []);
    assert.equal(pkg.optionalDependencies, undefined, "npm installs optional dependencies too");
  });

  it("is always built fresh before it's packed", () => {
    assert.equal(pkg.scripts.prepack, "npm run build");
  });
});
