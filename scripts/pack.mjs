import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const versionSource = await readFile(join(root, "shared/version.ts"), "utf8");
assert(versionSource.includes(`VERSION = "${pkg.version}"`), "UI and package versions differ");
for (const name of ["OVERVIEW.md", "OVERVIEW.zh-CN.md"]) {
  const overview = await readFile(join(root, name), "utf8");
  assert(!/paseo plugin add|npm install|npm i\b/.test(overview), "Listing overview contains installation commands");
}
const icon = await readFile(join(root, "assets/icon.png"));
assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert(icon.readUInt32BE(16) >= 256 && icon.readUInt32BE(20) >= 256, "Icon must be at least 256px");
await mkdir(join(root, "dist"), { recursive: true });
const { stdout } = await exec("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", "dist"], { cwd: root });
const [packed] = JSON.parse(stdout);
for (const entry of packed.files) {
  assert(/^(package\.json|README\.md|LICENSE|CHANGELOG\.md|OVERVIEW(?:\.zh-CN)?\.md|paseo-plugin\.json|index\.(?:client\.tsx|server\.ts)|docs\/(?:releasing|verification|research\/paseo-direct-feasibility)\.md|(?:client|server|shared|assets)\/[^.].*)$/.test(entry.path), `Unexpected release file: ${entry.path}`);
  assert(!/node_modules|\.env|credential|test-results|\.map$/.test(entry.path), `Unexpected private/development file: ${entry.path}`);
}
const filename = packed.filename;
const hash = createHash("sha256").update(await readFile(join(root, "dist", filename))).digest("hex");
await writeFile(join(root, "dist", filename + ".sha256"), `${hash}  ${filename}\n`);
console.log(JSON.stringify({ filename, version: pkg.version, files: packed.files.length, bytes: packed.size, sha256: hash }, null, 2));
