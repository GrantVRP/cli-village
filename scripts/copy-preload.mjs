// Part of `npm run build`: the desktop app's preload script is plain CommonJS
// (Electron's sandbox needs that), so tsc doesn't touch it. Copy it into dist.
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../src/app/preload.cjs", import.meta.url));
const to = fileURLToPath(new URL("../dist/app/preload.cjs", import.meta.url));
mkdirSync(fileURLToPath(new URL("../dist/app/", import.meta.url)), { recursive: true });
copyFileSync(from, to);
