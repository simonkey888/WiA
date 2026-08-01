import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const required = [
  "src/index.js",
  "wrangler.jsonc",
  "package.json",
  "package-lock.json",
  "public/index.html",
  "public/styles.css",
  "public/app.js",
  "public/voice-selector.js",
  "public/sw.js",
  "public/manifest.webmanifest",
  "public/assets/wia-face-v1-1.webp",
  "public/assets/wia-face-v1-1.png",
  "public/assets/wia-face-v1-1-manifest.json",
];
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size === 0) throw new Error(`missing or empty: ${relative}`);
}
const manifestPath = path.join(root, "public/assets/wia-face-v1-1-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
for (const asset of manifest.assets) {
  const absolute = path.join(root, "public", asset.path.replace(/^\//, ""));
  if (sha(absolute) !== asset.sha256) throw new Error(`asset hash mismatch: ${asset.path}`);
  if (fs.statSync(absolute).size !== asset.bytes) throw new Error(`asset size mismatch: ${asset.path}`);
}
const report = {
  status: "PASS",
  build_kind: "validated-static-assets-no-transformation",
  required_files: required,
  face_assets: manifest.assets,
};
fs.mkdirSync(path.join(root, "ops/evidence/wia-v1-1"), { recursive: true });
fs.writeFileSync(path.join(root, "ops/evidence/wia-v1-1/build-local.json"), JSON.stringify(report, null, 2) + "\n");
console.log("PASS");
