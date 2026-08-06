#!/usr/bin/env bash
set -u -o pipefail
set +x

BASE_URL="${BASE_URL:-https://wia.simondalmasso44.workers.dev}"
WORKER_NAME="${WORKER_NAME:-wia}"
E="ops/evidence/order-003/baseline"
R="${RUNNER_TEMP:-/tmp}/wia-order-003-${GITHUB_RUN_ID:-local}"
mkdir -p "$E" "$R"
rm -f "$E/status.env"

failure_step=""
failure_error=""
record_failure() {
  if [ -z "$failure_step" ]; then
    failure_step="$1"
    failure_error="$2"
  fi
}

get_public() {
  local path="$1" name="$2" status ctype bytes sha
  status=$(curl -sS --max-time 60 -D "$R/$name.headers" -o "$R/$name.body" -w '%{http_code}' "$BASE_URL$path") || status=000
  ctype=$(awk 'BEGIN{IGNORECASE=1} /^content-type:/{sub(/^[^:]+:[[:space:]]*/,"");print;exit}' "$R/$name.headers" 2>/dev/null | tr -d '\r')
  bytes=$(wc -c < "$R/$name.body" 2>/dev/null | tr -d ' '); bytes=${bytes:-0}
  sha=$(sha256sum "$R/$name.body" 2>/dev/null | awk '{print $1}'); sha=${sha:-}
  awk 'BEGIN{IGNORECASE=1}!/^(authorization|cookie|set-cookie):/' "$R/$name.headers" 2>/dev/null | tr -d '\r' > "$E/$name.headers.txt"
  jq -n --arg path "$path" --argjson status "${status:-0}" --arg content_type "$ctype" --argjson bytes "${bytes:-0}" --arg sha256 "$sha" '{path:$path,status:$status,content_type:$content_type,bytes:$bytes,sha256:$sha256}' > "$E/$name.meta.json"
}

chat_attempt() {
  local name="$1" prompt="$2" attempt="$3" status sha client out
  out="$E/$name-attempt-$attempt.json"
  client="order003-${GITHUB_RUN_ID:-local}-$name-$attempt"
  status=$(curl -sS --max-time 150 -D "$R/$name-$attempt.headers" -o "$R/$name-$attempt.body" -w '%{http_code}' -X POST "$BASE_URL/api/chat" -H 'content-type: application/json; charset=utf-8' -H "x-wia-client: $client" --data "$(jq -nc --arg message "$prompt" '{message:$message,history:[]}')") || status=000
  sha=$(sha256sum "$R/$name-$attempt.body" 2>/dev/null | awk '{print $1}'); sha=${sha:-}
  if jq -e . "$R/$name-$attempt.body" >/dev/null 2>&1; then
    jq . "$R/$name-$attempt.body" > "$out"
  else
    jq -n --arg error "NON_JSON_RESPONSE" --arg body_sha256 "$sha" '{ok:false,error:$error,body_sha256:$body_sha256}' > "$out"
  fi
  jq -n --argjson attempt "$attempt" --argjson status "${status:-0}" --arg sha256 "$sha" '{attempt:$attempt,status:$status,sha256:$sha256}' > "$E/$name-attempt-$attempt.meta.json"
  if [ "$status" = 200 ] && jq -e '.ok==true and .degraded==false and (.reply|type=="string" and length>=10) and (.model|type=="string" and length>0)' "$out" >/dev/null 2>&1; then
    cp "$out" "$E/$name.json"
    cp "$E/$name-attempt-$attempt.meta.json" "$E/$name.meta.json"
    return 0
  fi
  return 1
}

run_chat() {
  local name="$1" prompt="$2" attempt
  for attempt in 1 2; do
    if chat_attempt "$name" "$prompt" "$attempt"; then return 0; fi
    [ "$attempt" = 1 ] && sleep 4
  done
  cp "$E/$name-attempt-2.json" "$E/$name.json"
  cp "$E/$name-attempt-2.meta.json" "$E/$name.meta.json"
  return 1
}

compare_file() {
  local remote="$1" local_file="$2" rs ls match=false
  rs=$(sha256sum "$R/$remote.body" 2>/dev/null | awk '{print $1}'); rs=${rs:-}
  ls=$(sha256sum "$local_file" 2>/dev/null | awk '{print $1}'); ls=${ls:-}
  [ -n "$rs" ] && [ "$rs" = "$ls" ] && match=true
  jq -n --arg remote "$remote" --arg local "$local_file" --arg remote_sha256 "$rs" --arg local_sha256 "$ls" --argjson match "$match" '{remote:$remote,local:$local,remote_sha256:$remote_sha256,local_sha256:$local_sha256,match:$match}'
}

cf_read() {
  local suffix="$1" out="$2" status
  status=$(curl -sS --max-time 90 -H "Authorization: Bearer $CF_API_TOKEN" -H 'accept: application/json' -o "$R/$out.raw.json" -w '%{http_code}' "$CF_API$suffix") || status=000
  jq -n --arg endpoint "$suffix" --argjson status "${status:-0}" '{endpoint:$endpoint,http_status:$status}' > "$E/$out.meta.json"
  [ "$status" = 200 ] && jq -e '.success==true' "$R/$out.raw.json" >/dev/null 2>&1
}

get_public / root
get_public /api/health health
get_public /manifest.webmanifest manifest
get_public /sw.js service-worker
get_public /app.js app-js
get_public /styles.css styles-css
get_public /voice-selector.js voice-selector-js
get_public /assets/wia-face-v1-1.webp face-webp
get_public /assets/wia-face-v1-1.png face-png
cp "$R/root.body" "$E/root.html" 2>/dev/null || true
cp "$R/health.body" "$E/health.json" 2>/dev/null || true
cp "$R/manifest.body" "$E/manifest.webmanifest" 2>/dev/null || true
cp "$R/service-worker.body" "$E/sw.js" 2>/dev/null || true

ROOT_PASS=false
HEALTH_PASS=false
CHAT1_PASS=false
CHAT2_PASS=false
jq -e '.status==200' "$E/root.meta.json" >/dev/null 2>&1 && ROOT_PASS=true || record_failure REMOTE_ROOT "GET / did not return HTTP 200"
if jq -e '.status==200' "$E/health.meta.json" >/dev/null 2>&1 && jq -e '.ok==true and .worker=="wia" and (.workset|type=="string" and length>0) and (.marker|type=="string" and length>0)' "$E/health.json" >/dev/null 2>&1; then
  HEALTH_PASS=true
else
  record_failure REMOTE_HEALTH "GET /api/health failed HTTP/body gate"
fi
run_chat chat-identity "Respondé en una frase breve: ¿quién sos?" && CHAT1_PASS=true || record_failure REMOTE_CHAT_IDENTITY "POST /api/chat did not return a real non-degraded model reply after two bounded attempts"
run_chat chat-criterion "No me des la razón porque sí." && CHAT2_PASS=true || record_failure REMOTE_CHAT_CRITERION "POST /api/chat criterion probe did not return a real non-degraded model reply after two bounded attempts"

{
  compare_file root public/index.html
  compare_file manifest public/manifest.webmanifest
  compare_file service-worker public/sw.js
  compare_file app-js public/app.js
  compare_file styles-css public/styles.css
  compare_file voice-selector-js public/voice-selector.js
  compare_file face-webp public/assets/wia-face-v1-1.webp
  compare_file face-png public/assets/wia-face-v1-1.png
} | jq -s . > "$E/public-source-match.json"
SOURCE_MATCH=$(jq -r 'all(.[];.match==true)' "$E/public-source-match.json")

CF_PASS=false
DEPLOYMENT_ID=""
VERSION_ID=""
DEPLOYMENT_CREATED_AT=""
ACCOUNT_HASH=""
if [ -z "${CF_API_TOKEN:-}" ] || [ -z "${CF_ACCOUNT_ID:-}" ]; then
  record_failure CLOUDFLARE_AUTH "DEPLOY_NOW or CLOUDFLARE_ACCOUNT_ID secret unavailable"
else
  ACCOUNT_HASH=$(printf %s "$CF_ACCOUNT_ID" | sha256sum | awk '{print $1}')
  CF_API="https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER_NAME"
  if cf_read /deployments cf-deployments && cf_read /versions cf-versions; then
    DEPLOYMENT_ID=$(jq -r '.result[0].id // empty' "$R/cf-deployments.raw.json")
    DEPLOYMENT_CREATED_AT=$(jq -r '.result[0].created_on // empty' "$R/cf-deployments.raw.json")
    VERSION_ID=$(jq -r '[.result[0].versions[]? | select((.percentage // 0)==100) | (.version_id // .id)][0] // empty' "$R/cf-deployments.raw.json")
    if [ -n "$DEPLOYMENT_ID" ] && [ -n "$DEPLOYMENT_CREATED_AT" ] && [ -n "$VERSION_ID" ] && cf_read "/deployments/$DEPLOYMENT_ID" cf-deployment-detail && cf_read "/versions/$VERSION_ID" cf-version-detail; then
      CF_PASS=true
      python3 - "$R" "$E" <<'PY'
import json,pathlib,re,sys
raw=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2])
def load(name): return json.loads((raw/name).read_text())
secret=re.compile(r'(token|secret|password|credential|authorization|api.?key|private.?key|email)',re.I)
def clean(x):
    if isinstance(x,dict): return {k:('[REDACTED]' if secret.search(k) else clean(v)) for k,v in x.items()}
    if isinstance(x,list): return [clean(v) for v in x]
    return x
safe={'deployments':clean(load('cf-deployments.raw.json')),'versions':clean(load('cf-versions.raw.json')),'active_deployment':clean(load('cf-deployment-detail.raw.json')),'active_version':clean(load('cf-version-detail.raw.json'))}
(out/'cloudflare-snapshot.sanitized.json').write_text(json.dumps(safe,ensure_ascii=False,indent=2)+'\n')
PY
    else
      record_failure CLOUDFLARE_IDENTITY "Active deployment/version could not be resolved as a unique 100 percent deployment"
    fi
  else
    record_failure CLOUDFLARE_READ "Authenticated deployment/version GET failed"
  fi
fi
unset CF_API_TOKEN CF_ACCOUNT_ID 2>/dev/null || true

WORKSET=$(jq -r '.workset // ""' "$E/health.json" 2>/dev/null)
MARKER=$(jq -r '.marker // ""' "$E/health.json" 2>/dev/null)
MODEL=$(jq -r '.model // ""' "$E/health.json" 2>/dev/null)
CHAT1_MODEL=$(jq -r '.model // ""' "$E/chat-identity.json" 2>/dev/null)
CHAT2_MODEL=$(jq -r '.model // ""' "$E/chat-criterion.json" 2>/dev/null)
CAPTURED=$(date -u +%FT%TZ)
SOURCE_SHA=$(git rev-parse HEAD)
SOURCE_TREE=$(git rev-parse HEAD^{tree})
MAIN_SHA=$(git rev-parse origin/main)
STATUS=PASS
if [ "$ROOT_PASS" != true ] || [ "$HEALTH_PASS" != true ] || [ "$CHAT1_PASS" != true ] || [ "$CHAT2_PASS" != true ] || [ "$CF_PASS" != true ]; then STATUS=BLOCKED; fi

jq -n \
  --arg status "$STATUS" --arg captured_at_utc "$CAPTURED" --arg account_id_sha256 "$ACCOUNT_HASH" \
  --arg source_sha "$SOURCE_SHA" --arg source_tree "$SOURCE_TREE" --arg main_sha "$MAIN_SHA" \
  --arg workset "$WORKSET" --arg marker "$MARKER" --arg model "$MODEL" --arg chat1_model "$CHAT1_MODEL" --arg chat2_model "$CHAT2_MODEL" \
  --arg deployment_id "$DEPLOYMENT_ID" --arg version_id "$VERSION_ID" --arg deployment_created_at "$DEPLOYMENT_CREATED_AT" \
  --arg failure_step "$failure_step" --arg failure_error "$failure_error" \
  --argjson root "$ROOT_PASS" --argjson health "$HEALTH_PASS" --argjson chat_identity "$CHAT1_PASS" --argjson chat_criterion "$CHAT2_PASS" --argjson cloudflare "$CF_PASS" --argjson public_source_match "$SOURCE_MATCH" \
  '{claim:"WIA_ORDER_003_BASELINE",status:$status,captured_at_utc:$captured_at_utc,repository:"simonkey888/WiA",branch:"feat/wia-complete-end-to-end-v1",account_id_sha256:$account_id_sha256,source_sha:$source_sha,source_tree:$source_tree,main_sha:$main_sha,remote:{url:"https://wia.simondalmasso44.workers.dev/",workset:$workset,marker:$marker,model:$model,chat_models:[$chat1_model,$chat2_model],deployment_id:$deployment_id,version_id:$version_id,deployment_created_at:$deployment_created_at},validation:{root:$root,health:$health,chat_identity:$chat_identity,chat_criterion:$chat_criterion,cloudflare:$cloudflare,public_source_match:$public_source_match},failure:{step:$failure_step,error:$failure_error},security:{billing_api_called:false,billing_write:false,secret_values_persisted:false,token_output:false},cost:{paid_plan_enabled:false,external_paid_provider:false}}' > "$E/baseline.json"

cat > "$E/status.env" <<EOF
STATUS=$STATUS
CAPTURED=$CAPTURED
SOURCE_SHA=$SOURCE_SHA
SOURCE_TREE=$SOURCE_TREE
MAIN_SHA=$MAIN_SHA
WORKSET=$WORKSET
MARKER=$MARKER
MODEL=$MODEL
CHAT1_MODEL=$CHAT1_MODEL
CHAT2_MODEL=$CHAT2_MODEL
DEPLOYMENT_ID=$DEPLOYMENT_ID
VERSION_ID=$VERSION_ID
DEPLOYMENT_CREATED_AT=$DEPLOYMENT_CREATED_AT
SOURCE_MATCH=$SOURCE_MATCH
FAILURE_STEP=$failure_step
FAILURE_ERROR=$failure_error
EOF
