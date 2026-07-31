import fs from "node:fs";

const required = [
  "src/index.js",
  "public/index.html",
  "public/styles.css",
  "public/app.js",
  "public/sw.js",
  "public/manifest.webmanifest",
  "public/assets/wia-face-base.v1.svg",
  "public/assets/wia-face-layer-2.v1.svg",
  "public/assets/wia-face-layer-3-4.v1.svg",
  "public/assets/wia-face-manifest.json",
  "wrangler.jsonc",
];

for (const file of required) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size === 0) throw new Error(`missing or empty: ${file}`);
}

console.log("PASS");
