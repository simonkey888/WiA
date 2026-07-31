#!/usr/bin/env bash
set -euo pipefail
root=$(pwd)
tmp=$(mktemp -d)
cleanup(){ rm -rf "$tmp"; }
trap cleanup EXIT
mkdir -p "$tmp/preserve/public"
cp -a public/icons "$tmp/preserve/public/icons"
{
  cat ops/materialize-v3/part-00.b64
  cat ops/materialize-v5/part-01a.b64
  cat ops/materialize-v5/part-01b.b64
  cat ops/materialize-v4/part-02.b64
  cat ops/materialize-v5/part-03a.b64
  cat ops/materialize-v5/part-03b.b64
  cat ops/materialize-v5/part-04a.b64
  cat ops/materialize-v5/part-04b.b64
  cat ops/materialize-v5/part-05a.b64
  cat ops/materialize-v5/part-05b.b64
  cat ops/materialize-v5/part-06a.b64
  cat ops/materialize-v5/part-06b.b64
  cat ops/materialize-v5/part-07.b64
} > "$tmp/source.tar.gz.b64"
base64 -d "$tmp/source.tar.gz.b64" > "$tmp/source.tar.gz"
expected="651ea0e3df836f5a191706015c7bb9b74b2ebcfaf915e57e42c3e5e7fdef4cd3"
actual=$(sha256sum "$tmp/source.tar.gz" | awk '{print $1}')
test "$actual" = "$expected"
mkdir -p "$tmp/source"
tar -xzf "$tmp/source.tar.gz" -C "$tmp/source"
find "$root" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$tmp/source/." "$root/"
mkdir -p public
cp -a "$tmp/preserve/public/icons" public/icons
git add -A
git config user.name github-actions
git config user.email 41898282+github-actions[bot]@users.noreply.github.com
git commit -m "feat: reconcile WiA V1.1 runtime and assets [skip ci]"
git push origin HEAD:refs/heads/feat/wia-face-voice-ux-v1-1
