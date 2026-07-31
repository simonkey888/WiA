#!/usr/bin/env bash
set -euo pipefail

root=$(pwd)
tmp=$(mktemp -d)
cleanup(){ rm -rf "$tmp"; }
trap cleanup EXIT

mkdir -p "$tmp/preserve/public"
if [ -d public/icons ]; then
  cp -a public/icons "$tmp/preserve/public/icons"
fi

cat ops/materialize-v8/source-*.b64 > "$tmp/source.tar.gz.b64"
base64 -d "$tmp/source.tar.gz.b64" > "$tmp/source.tar.gz"
source_expected="5c5ffd4da0a8eabbc7129dd0477d5a58942e17826eed08486670f6c2c9f9fc77"
source_actual=$(sha256sum "$tmp/source.tar.gz" | awk '{print $1}')
test "$source_actual" = "$source_expected"

mkdir -p "$tmp/source"
tar -xzf "$tmp/source.tar.gz" -C "$tmp/source"

mkdir -p "$tmp/source/public/assets"
cat ops/materialize-v8/face-*.b64 > "$tmp/face.webp.b64"
base64 -d "$tmp/face.webp.b64" > "$tmp/source/public/assets/wia-face-v1-1.webp"
face_expected="9c9d36f7e8b24eaa5e80628b1eb527931d8ff5d4f01281f0102a84a994241649"
face_actual=$(sha256sum "$tmp/source/public/assets/wia-face-v1-1.webp" | awk '{print $1}')
test "$face_actual" = "$face_expected"

sudo apt-get update -qq
sudo apt-get install -y -qq imagemagick
if command -v magick >/dev/null 2>&1; then
  image_tool=(magick)
else
  image_tool=(convert)
fi

"${image_tool[@]}" "$tmp/source/public/assets/wia-face-v1-1.webp" -strip PNG32:"$tmp/source/public/assets/wia-face-v1-1.png"
test -s "$tmp/source/public/assets/wia-face-v1-1.png"

if [ -d "$tmp/preserve/public/icons" ]; then
  mkdir -p "$tmp/source/public"
  cp -a "$tmp/preserve/public/icons" "$tmp/source/public/icons"
else
  mkdir -p "$tmp/source/public/icons"
  "${image_tool[@]}" "$tmp/source/public/assets/wia-face-v1-1.webp" -background '#0b0712' -gravity center -extent 469x469 -resize 192x192 -strip "$tmp/source/public/icons/icon-192.png"
  "${image_tool[@]}" "$tmp/source/public/assets/wia-face-v1-1.webp" -background '#0b0712' -gravity center -extent 469x469 -resize 512x512 -strip "$tmp/source/public/icons/icon-512.png"
fi

test -s "$tmp/source/public/icons/icon-192.png"
test -s "$tmp/source/public/icons/icon-512.png"

python3 - "$tmp/source/public/assets/wia-face-v1-1.webp" "$tmp/source/public/assets/wia-face-v1-1.png" "$tmp/source/public/assets/wia-face-v1-1-manifest.json" <<'PY'
import hashlib
import json
import pathlib
import sys

webp = pathlib.Path(sys.argv[1])
png = pathlib.Path(sys.argv[2])
out = pathlib.Path(sys.argv[3])

def item(path, public_path, content_type):
    data = path.read_bytes()
    return {
        "path": public_path,
        "content_type": content_type,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }

manifest = {
    "asset_version": "WIA_FACE_V1_1",
    "source": "reference image supplied by Simon in Issue #2 workset",
    "identity_policy": "reference-derived clean raster; no replacement identity",
    "principal": "/assets/wia-face-v1-1.webp",
    "fallback": "/assets/wia-face-v1-1.png",
    "width": 420,
    "height": 469,
    "alpha": True,
    "assets": [
        item(webp, "/assets/wia-face-v1-1.webp", "image/webp"),
        item(png, "/assets/wia-face-v1-1.png", "image/png"),
    ],
    "old_triangulated_assets_active": False,
}
out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

find "$root" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$tmp/source/." "$root/"

git add -A
git config user.name github-actions
git config user.email 41898282+github-actions[bot]@users.noreply.github.com
git commit -m "feat: materialize WiA V1.1 runtime and raster assets"
git push origin HEAD:refs/heads/feat/wia-face-voice-ux-v1-1
