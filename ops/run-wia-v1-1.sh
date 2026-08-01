#!/usr/bin/env bash
set -Eeuo pipefail

: "${BASE_URL:=https://wia.simondalmasso44.workers.dev}"
: "${EXPECTED_WORKSET:=WIA-FACE-VOICE-UX-V1_1}"
: "${EXPECTED_MARKER:=WIA_FACE_VOICE_UX_V1_1}"
: "${SOURCE_BRANCH:=feat/wia-face-voice-ux-v1-1}"
: "${ISSUE_NUMBER:=2}"
: "${WRANGLER_VERSION:=4.116.0}"
: "${GITHUB_REPOSITORY:=simonkey888/WiA}"

run_url="https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-unknown}"
step="INITIALIZE"
remote_state="NOT_DEPLOYED_BY_THIS_RUN"
main_before=$(git ls-remote origin refs/heads/main | awk '{print $1}')

append_blocker() {
  local code=$?
  set +e
  local current
  current=$(git rev-parse HEAD 2>/dev/null || printf UNKNOWN)
  cat > /tmp/wia-blocker.txt <<EOF
WIA_FACE_VOICE_UX_V1_1

STATUS=BLOCKED
BLOCKING_GATE=${step}
EXACT_ERROR=Command failed with exit code ${code}; exact command output is preserved in ${run_url}.
CURRENT_COMMIT=${current}
REMOTE_STATE=${remote_state}
MINIMUM_RECOVERY=Correct only the first failed command in ${run_url}
EOF
  gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body-file /tmp/wia-blocker.txt >/dev/null 2>&1 || true
  exit "$code"
}
trap append_blocker ERR

step="GATE_1_SOURCE_BRANCH"
test "$(git branch --show-current)" = "$SOURCE_BRANCH"
test -s src/index.js
test -s public/assets/wia-face-v1-1.webp
test -s public/assets/wia-face-v1-1.png
test -s public/assets/wia-face-v1-1-manifest.json
source_sha=$(git rev-parse HEAD)
mkdir -p ops/evidence/wia-v1-1
printf '%s\n' "$source_sha" > ops/evidence/wia-v1-1/source-commit.txt
face_sha=$(sha256sum public/assets/wia-face-v1-1.webp | awk '{print $1}')

step="GATE_2_BUILD"
npm ci --ignore-scripts --no-audit --no-fund
npm run check 2>&1 | tee ops/evidence/wia-v1-1/source-syntax.txt
npm test 2>&1 | tee ops/evidence/wia-v1-1/tests.txt
npm run build 2>&1 | tee ops/evidence/wia-v1-1/build.txt
! grep -R -E 'wia-face-base\.v1\.svg|wia-face-layer-2\.v1\.svg|wia-face-layer-3-4\.v1\.svg' src public tests
grep -q 'MESSAGE_LIMIT = 600' src/index.js
grep -q 'HISTORY_LIMIT = 8' src/index.js
grep -q 'MAX_TOKENS = 180' src/index.js
grep -q 'CHAT_RATE_LIMITER' wrangler.jsonc
grep -q 'neutral.*warm.*amused.*curious.*skeptical.*surprised.*concerned' src/index.js
sha256sum public/assets/wia-face-v1-1.webp public/assets/wia-face-v1-1.png public/assets/wia-face-v1-1-manifest.json > ops/evidence/wia-v1-1/asset-hashes.txt

step="GATE_2_WRANGLER_DRY_RUN"
{
  echo WRANGLER_VERSION="$WRANGLER_VERSION"
  npx --yes "wrangler@${WRANGLER_VERSION}" deploy --dry-run --outdir .wrangler-dry-run
} 2>&1 | tee ops/evidence/wia-v1-1/dry-run.txt

step="GATE_3_4_PREFLIGHT"
curl -fsS --max-time 30 -H 'cache-control: no-cache' "$BASE_URL/api/health?preflight=$GITHUB_RUN_ID" > /tmp/preflight-health.json
jq -e '.ok == true and .worker == "wia"' /tmp/preflight-health.json
pre_http=$(curl -sS --max-time 150 -o /tmp/preflight-chat.json -w '%{http_code}' -X POST "$BASE_URL/api/chat" \
  -H 'content-type: application/json; charset=utf-8' -H 'x-wia-client: github-preflight-v1-1' \
  --data '{"message":"Respondé en una frase breve: ¿quién sos?","history":[]}')
test "$pre_http" = 200
jq -e '.ok == true and .degraded == false and (.reply|type=="string" and length>0) and (.model|type=="string" and length>0)' /tmp/preflight-chat.json

step="GATE_3_DEPLOY"
npx --yes "wrangler@${WRANGLER_VERSION}" deploy 2>&1 | tee ops/evidence/wia-v1-1/deploy.txt
remote_state="DEPLOYED_V1_1_AWAITING_VALIDATION"

step="GATE_3_ACTIVE_IDENTITY"
npx --yes "wrangler@${WRANGLER_VERSION}" deployments list --name wia --json > /tmp/deployments.json
npx --yes "wrangler@${WRANGLER_VERSION}" versions list --name wia --json > /tmp/versions.json
deployment_id=$(jq -r '.[0].id // .[0].deployment_id // empty' /tmp/deployments.json)
deployment_created=$(jq -r '.[0].created_on // .[0].created_at // empty' /tmp/deployments.json)
version_id=$(jq -r '.[0].id // .[0].version_id // empty' /tmp/versions.json)
test -n "$deployment_id"
test -n "$version_id"
jq '{deployment_id:(.[0].id // .[0].deployment_id),created_on:(.[0].created_on // .[0].created_at),versions:.[0].versions}' /tmp/deployments.json > ops/evidence/wia-v1-1/cloudflare-deployment.json
jq '{version_id:(.[0].id // .[0].version_id),created_on:(.[0].created_on // .[0].created_at),annotations:.[0].annotations}' /tmp/versions.json > ops/evidence/wia-v1-1/cloudflare-version.json

step="GATE_3_REMOTE_HEALTH"
for attempt in $(seq 1 30); do
  health_http=$(curl -sS --max-time 25 -H 'cache-control: no-cache' -o /tmp/health.json -w '%{http_code}' "$BASE_URL/api/health?run=$GITHUB_RUN_ID&attempt=$attempt" || true)
  if [ "$health_http" = 200 ] && jq -e --arg w "$EXPECTED_WORKSET" --arg m "$EXPECTED_MARKER" '.ok==true and .workset==$w and .marker==$m and .face_asset=="/assets/wia-face-v1-1.webp" and .voice_selector_version=="WIA_LATAM_VOICE_SELECTOR_V1_1" and .message_limit==600 and .history_limit==8 and .max_tokens==180 and .rate_limiter=="CHAT_RATE_LIMITER" and (.reaction_enum|length)==7' /tmp/health.json >/dev/null 2>&1; then
    break
  fi
  sleep 4
done
jq -e --arg w "$EXPECTED_WORKSET" --arg m "$EXPECTED_MARKER" '.ok==true and .workset==$w and .marker==$m and (.reaction_enum|length)==7' /tmp/health.json
cp /tmp/health.json ops/evidence/wia-v1-1/remote-health.json

step="GATE_4_REMOTE_CHAT"
root_http=$(curl -sS --max-time 30 -D /tmp/root.headers -o /tmp/root.html -w '%{http_code}' "$BASE_URL/?run=$GITHUB_RUN_ID")
test "$root_http" = 200
grep -qi '^cache-control:.*no-store' /tmp/root.headers
grep -q 'wia-face-v1-1.webp' /tmp/root.html
! grep -Eq 'wia-face-base.v1.svg|wia-face-layer-2.v1.svg|wia-face-layer-3-4.v1.svg' /tmp/root.html
webp_http=$(curl -sS --max-time 30 -D /tmp/webp.headers -o /tmp/face.webp -w '%{http_code}' "$BASE_URL/assets/wia-face-v1-1.webp")
png_http=$(curl -sS --max-time 30 -D /tmp/png.headers -o /tmp/face.png -w '%{http_code}' "$BASE_URL/assets/wia-face-v1-1.png")
test "$webp_http" = 200
test "$png_http" = 200
grep -qi '^content-type: image/webp' /tmp/webp.headers
grep -qi '^content-type: image/png' /tmp/png.headers
test "$(sha256sum /tmp/face.webp|awk '{print $1}')" = "$face_sha"
test "$(sha256sum /tmp/face.png|awk '{print $1}')" = "$(sha256sum public/assets/wia-face-v1-1.png|awk '{print $1}')"
chat_http=$(curl -sS --max-time 150 -o /tmp/chat.json -w '%{http_code}' -X POST "$BASE_URL/api/chat" \
  -H 'content-type: application/json; charset=utf-8' -H 'x-wia-client: github-remote-v1-1' \
  --data '{"message":"No me des la razón porque sí.","history":[]}')
test "$chat_http" = 200
jq -e '.ok==true and .degraded==false and (.reply|type=="string" and length>0) and (.model|type=="string" and length>0) and (.reaction as $r | ["neutral","warm","amused","curious","skeptical","surprised","concerned"] | index($r) != null)' /tmp/chat.json
# Separate intensity gate avoids jq input ambiguity.
jq -e '.intensity|type=="number" and .>=0 and .<=1' /tmp/chat.json
cp /tmp/chat.json ops/evidence/wia-v1-1/remote-chat.json
{
  echo ROOT_HTTP="$root_http"
  grep -i '^cache-control:' /tmp/root.headers | tr -d '\r'
  echo WEBP_HTTP="$webp_http"
  grep -i '^content-type:' /tmp/webp.headers | tr -d '\r'
  echo PNG_HTTP="$png_http"
  grep -i '^content-type:' /tmp/png.headers | tr -d '\r'
  echo SERVICE_WORKER_CACHE=wia-v1-1-shell-20260731
  echo OLD_ASSET_REFERENCES_IN_ROOT=0
} > ops/evidence/wia-v1-1/cache-validation.txt
remote_state="V1_1_REMOTE_TECHNICAL_PASS"

step="GATE_7_9_10_11_13_BROWSER"
npm install --no-save --package-lock=false --ignore-scripts playwright@1.54.1
npx playwright install --with-deps chromium
node tests/capture-remote.mjs

step="CONTROL_PLANE_EVIDENCE"
cp ops/evidence/wia-v1-1/WIA-TTS-OPTIONS-V1_1.md ops/evidence/WIA-TTS-OPTIONS-V1_1.md
SOURCE_SHA="$source_sha" FACE_SHA="$face_sha" DEPLOYMENT_ID="$deployment_id" VERSION_ID="$version_id" DEPLOYMENT_CREATED="$deployment_created" node <<'NODE'
const fs=require('fs');
const health=JSON.parse(fs.readFileSync('ops/evidence/wia-v1-1/remote-health.json','utf8'));
const chat=JSON.parse(fs.readFileSync('ops/evidence/wia-v1-1/remote-chat.json','utf8'));
const voices=JSON.parse(fs.readFileSync('ops/evidence/wia-v1-1/voice-selection.json','utf8'));
const cp={claim:'WIA_FACE_VOICE_UX_V1_1',status:'READY_FOR_PHYSICAL_VALIDATION',url:process.env.BASE_URL+'/',workset:process.env.EXPECTED_WORKSET,marker:process.env.EXPECTED_MARKER,source_branch:process.env.SOURCE_BRANCH,source_commit_sha:process.env.SOURCE_SHA,deploy_run:`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,deployment_id:process.env.DEPLOYMENT_ID,version_id:process.env.VERSION_ID,deployment_created_at:process.env.DEPLOYMENT_CREATED,face_asset:'/assets/wia-face-v1-1.webp',face_asset_sha256:process.env.FACE_SHA,old_face_removed:true,remote_health:health.ok===true,remote_chat:chat.ok===true&&chat.degraded===false,viewport_360_closed:'ops/evidence/wia-v1-1/viewport-360x800-closed.png',viewport_360_open:'ops/evidence/wia-v1-1/viewport-360x800-open.png',viewport_430:'ops/evidence/wia-v1-1/viewport-430x900.png',voice_selector_version:'WIA_LATAM_VOICE_SELECTOR_V1_1',selected_voice_name:voices.selected?.name||'NONE_IN_HEADLESS_CHROMIUM',selected_voice_lang:voices.selected?.lang||'NONE_IN_HEADLESS_CHROMIUM',voice_inventory_evidence:'ops/evidence/wia-v1-1/voice-inventory.json',cache_invalidation:true,physical_face_validation:'PENDING_SIMON',physical_voice_validation:'PENDING_SIMON'};
fs.writeFileSync('ops/evidence/wia-v1-1/final-checkpoint.json',JSON.stringify(cp,null,2)+'\n');
const current=JSON.parse(fs.readFileSync('ops/CURRENT.json','utf8'));
Object.assign(current,{status:'READY_FOR_PHYSICAL_VALIDATION',workset:process.env.EXPECTED_WORKSET,marker:process.env.EXPECTED_MARKER,branch:process.env.SOURCE_BRANCH,source_commit:process.env.SOURCE_SHA,deployment_id:process.env.DEPLOYMENT_ID,version_id:process.env.VERSION_ID,updated_at_utc:new Date().toISOString()});
fs.writeFileSync('ops/CURRENT.json',JSON.stringify(current,null,2)+'\n');
const event={seq:'AUTO-'+process.env.GITHUB_RUN_ID,at_utc:new Date().toISOString(),actor:'ARQ',event:'TECHNICAL_VALIDATION_READY',workset:process.env.EXPECTED_WORKSET,source_commit:process.env.SOURCE_SHA,deployment_id:process.env.DEPLOYMENT_ID,version_id:process.env.VERSION_ID,physical_face_validation:'PENDING_SIMON',physical_voice_validation:'PENDING_SIMON'};
fs.appendFileSync('ops/EVENTS.ndjson',JSON.stringify(event)+'\n');
NODE

git config user.name github-actions
git config user.email 41898282+github-actions[bot]@users.noreply.github.com
git add ops
git commit -m "docs: record WiA V1.1 technical checkpoint [skip ci]"
git push origin HEAD:refs/heads/feat/wia-face-voice-ux-v1-1
evidence_sha=$(git rev-parse HEAD)

step="CLOSURE_IDENTITY"
remote_branch=$(git ls-remote origin refs/heads/feat/wia-face-voice-ux-v1-1 | awk '{print $1}')
main_after=$(git ls-remote origin refs/heads/main | awk '{print $1}')
test "$remote_branch" = "$evidence_sha"
test "${main_after:-}" = "${main_before:-}"
final_health=$(curl -fsS --max-time 30 -H 'cache-control: no-cache' "$BASE_URL/api/health?closure=$GITHUB_RUN_ID")
echo "$final_health" | jq -e --arg w "$EXPECTED_WORKSET" --arg m "$EXPECTED_MARKER" '.ok==true and .workset==$w and .marker==$m'
selected_name=$(jq -r '.selected.name // "NONE_IN_HEADLESS_CHROMIUM"' ops/evidence/wia-v1-1/voice-selection.json)
selected_lang=$(jq -r '.selected.lang // "NONE_IN_HEADLESS_CHROMIUM"' ops/evidence/wia-v1-1/voice-selection.json)
cat > /tmp/wia-checkpoint.txt <<EOF
WIA_FACE_VOICE_UX_V1_1

STATUS=READY_FOR_PHYSICAL_VALIDATION
URL=$BASE_URL/
WORKSET=$EXPECTED_WORKSET
MARKER=$EXPECTED_MARKER
SOURCE_BRANCH=$SOURCE_BRANCH
SOURCE_COMMIT_SHA=$source_sha
EVIDENCE_COMMIT_SHA=$evidence_sha
DEPLOY_RUN=$run_url
DEPLOYMENT_ID=$deployment_id
VERSION_ID=$version_id
FACE_ASSET=/assets/wia-face-v1-1.webp
FACE_ASSET_SHA256=$face_sha
OLD_FACE_REMOVED=PASS
REMOTE_HEALTH=PASS
REMOTE_CHAT=PASS
VIEWPORT_360_CLOSED=ops/evidence/wia-v1-1/viewport-360x800-closed.png
VIEWPORT_360_OPEN=ops/evidence/wia-v1-1/viewport-360x800-open.png
VIEWPORT_430=ops/evidence/wia-v1-1/viewport-430x900.png
VOICE_SELECTOR_VERSION=WIA_LATAM_VOICE_SELECTOR_V1_1
SELECTED_VOICE_NAME=$selected_name
SELECTED_VOICE_LANG=$selected_lang
VOICE_INVENTORY_EVIDENCE=ops/evidence/wia-v1-1/voice-inventory.json
CACHE_INVALIDATION=PASS
PHYSICAL_FACE_VALIDATION=PENDING_SIMON
PHYSICAL_VOICE_VALIDATION=PENDING_SIMON
EOF
gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body-file /tmp/wia-checkpoint.txt
trap - ERR
printf '%s\n' "$(cat /tmp/wia-checkpoint.txt)"
