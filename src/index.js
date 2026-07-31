const WORKSET = "WIA-CF-FIRST-LIVE-001";
const MARKER = "WIA_CF_FIRST_LIVE_001";
const PRIMARY_MODEL = "@cf/zai-org/glm-4.7-flash";
const FALLBACK_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

const SYSTEM_PROMPT = `Sos WiA, una presencia conversacional femenina. Hablás en español rioplatense natural, con frases relativamente cortas. Sos directa, perceptiva y tenés criterio propio. No adulás ni das la razón porque sí. Si algo es flojo, incoherente o riesgoso, lo decís con tacto. No uses muletillas de asistente, lenguaje corporativo, entusiasmo automático ni frases como "como inteligencia artificial". Respondé solamente el contenido útil para la conversación.`;

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "permissions-policy": "microphone=(self)",
  "x-content-type-options": "nosniff",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

function extractText(output) {
  if (!output) return "";
  if (typeof output === "string") return output.trim();
  const direct = [output.response, output.result, output.text, output.output_text, output.answer];
  for (const value of direct) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const choices = Array.isArray(output.choices) ? output.choices : [];
  for (const choice of choices) {
    const value = choice?.message?.content ?? choice?.text;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (Array.isArray(output.output)) {
    const pieces = [];
    for (const item of output.output) {
      if (typeof item === "string") pieces.push(item);
      if (typeof item?.text === "string") pieces.push(item.text);
      if (Array.isArray(item?.content)) {
        for (const content of item.content) {
          if (typeof content?.text === "string") pieces.push(content.text);
        }
      }
    }
    return pieces.join("\n").trim();
  }
  return "";
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-12).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null;
    const content = typeof item.content === "string" ? item.content.trim().slice(0, 4000) : "";
    return role && content ? [{ role, content }] : [];
  });
}

async function runModel(env, model, messages) {
  const output = await env.AI.run(model, {
    messages,
    max_tokens: 420,
    temperature: 0.72,
  });
  const reply = extractText(output).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!reply) throw new Error("EMPTY_MODEL_RESPONSE");
  return reply;
}

async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json({ ok: false, error: "MESSAGE_REQUIRED" }, 400);
  if (message.length > 6000) return json({ ok: false, error: "MESSAGE_TOO_LONG" }, 413);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...normalizeHistory(body?.history),
    { role: "user", content: message },
  ];

  const failures = [];
  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    try {
      const reply = await runModel(env, model, messages);
      return json({
        ok: true,
        reply,
        degraded: false,
        model,
        reaction: "neutral",
        intensity: 0.5,
      });
    } catch (error) {
      failures.push({ model, error: String(error?.message || error).slice(0, 300) });
    }
  }
  return json({ ok: false, error: "MODEL_UNAVAILABLE", failures }, 503);
}

const page = `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d0716">
<title>WiA</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#0d0716;color:#f7efff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}body{display:grid;place-items:center;overflow:hidden}.app{position:relative;width:min(100vw,430px);height:100dvh;max-height:900px;background:radial-gradient(circle at 50% 36%,#36145e 0,#170b29 45%,#09050f 100%);overflow:hidden}.presence{position:absolute;inset:0;display:grid;place-items:center;transition:.35s transform,.35s filter}.face{position:relative;width:238px;height:286px;cursor:pointer;touch-action:none;filter:drop-shadow(0 22px 35px #0008)}.head{position:absolute;inset:12px 19px 14px;border-radius:48% 48% 45% 45%/42% 42% 57% 57%;background:linear-gradient(135deg,#9f6aff 0%,#5b28a5 42%,#35145f 100%);clip-path:polygon(18% 3%,72% 0,96% 24%,91% 72%,66% 99%,30% 94%,4% 66%,1% 26%)}.facet{position:absolute;inset:0;background:linear-gradient(115deg,#ffffff18,transparent 34%),linear-gradient(280deg,#0005,transparent 48%);clip-path:polygon(0 0,100% 0,100% 100%,0 100%,18% 50%,48% 29%,70% 53%,48% 90%)}.eye{position:absolute;top:112px;width:49px;height:27px;border-radius:50%;background:#f9efff;box-shadow:0 0 17px #d9b9ff}.eye:after{content:"";position:absolute;width:17px;height:17px;border-radius:50%;background:#180724;top:5px;left:16px;box-shadow:inset 4px 0 #9c63df}.eye.left{left:55px;transform:rotate(3deg)}.eye.right{right:55px;transform:rotate(-3deg)}.brow{position:absolute;top:94px;width:54px;height:13px;border-top:5px solid #2b1047;border-radius:50%}.brow.left{left:53px;transform:rotate(-6deg)}.brow.right{right:53px;transform:rotate(6deg)}.nose{position:absolute;top:137px;left:109px;width:24px;height:51px;background:#7040b0;clip-path:polygon(50% 0,100% 80%,64% 100%,5% 84%);opacity:.75}.mouth{position:absolute;left:84px;top:205px;width:70px;height:18px;border-bottom:7px solid #260e3b;border-radius:0 0 50% 50%;transition:.12s}.face.speaking .mouth{animation:speak .2s infinite alternate}.face.listening{filter:drop-shadow(0 0 28px #ce9cff)}.face.listening .head{animation:pulse .8s infinite alternate}.hint{position:absolute;bottom:70px;left:0;right:0;text-align:center;font-size:13px;opacity:.67;letter-spacing:.02em}.panel{position:absolute;left:12px;right:12px;bottom:12px;height:min(64dvh,520px);display:flex;flex-direction:column;border:1px solid #ffffff1c;border-radius:24px;background:#0c0714e8;backdrop-filter:blur(18px);box-shadow:0 28px 80px #000b;transform:translateY(calc(100% + 24px));transition:.35s transform}.app.open .panel{transform:translateY(0)}.app.open .presence{transform:translateY(-28% ) scale(.62);filter:saturate(.85)}.messages{flex:1;overflow:auto;padding:20px 14px 10px}.msg{max-width:88%;padding:11px 13px;border-radius:17px;margin:0 0 10px;line-height:1.35;font-size:15px;white-space:pre-wrap}.msg.user{margin-left:auto;background:#7338bd}.msg.wia{background:#21112f;border:1px solid #ffffff12}.composer{display:flex;gap:8px;padding:10px;border-top:1px solid #ffffff12}.composer input{flex:1;min-width:0;border:1px solid #ffffff20;border-radius:16px;background:#160c21;color:#fff;padding:13px;outline:none}.composer button{border:0;border-radius:16px;background:#8f4ee8;color:#fff;padding:0 17px;font-weight:700}.status{text-align:center;font-size:12px;min-height:18px;opacity:.72;padding-bottom:4px}@keyframes speak{to{height:28px;border-radius:50%;border:6px solid #260e3b;background:#b56aff44}}@keyframes pulse{to{filter:brightness(1.16)}}
</style>
</head>
<body><main class="app" id="app">
<section class="presence"><div class="face" id="face" aria-label="Abrir WiA"><div class="head"><div class="facet"></div></div><div class="brow left"></div><div class="brow right"></div><div class="eye left"></div><div class="eye right"></div><div class="nose"></div><div class="mouth"></div></div><div class="hint">Toque: chat · mantener: hablar</div></section>
<section class="panel"><div class="messages" id="messages"><div class="msg wia">Estoy acá.</div></div><div class="status" id="status"></div><form class="composer" id="form"><input id="input" autocomplete="off" placeholder="Decime algo"><button>Enviar</button></form></section>
</main><script>
const app=document.getElementById('app'),face=document.getElementById('face'),form=document.getElementById('form'),input=document.getElementById('input'),messages=document.getElementById('messages'),statusEl=document.getElementById('status');let holdTimer,holding=false,history=[];
function add(role,text){const el=document.createElement('div');el.className='msg '+(role==='user'?'user':'wia');el.textContent=text;messages.append(el);messages.scrollTop=messages.scrollHeight;history.push({role:role==='user'?'user':'assistant',content:text});history=history.slice(-12)}
function speak(text){if(!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);const voices=speechSynthesis.getVoices();u.voice=voices.find(v=>v.lang==='es-AR')||voices.find(v=>v.lang.startsWith('es-419'))||voices.find(v=>v.lang.startsWith('es'));u.lang=u.voice?.lang||'es-AR';u.rate=.98;u.onstart=()=>face.classList.add('speaking');u.onend=()=>face.classList.remove('speaking');speechSynthesis.speak(u)}
async function send(text){text=text.trim();if(!text)return;add('user',text);input.value='';statusEl.textContent='Pensando…';try{const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text,history:history.slice(0,-1)})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'No respondió');add('assistant',d.reply);speak(d.reply);statusEl.textContent=d.model}catch(e){statusEl.textContent='Error: '+e.message}}
form.addEventListener('submit',e=>{e.preventDefault();send(input.value)});face.addEventListener('click',()=>{if(!holding)app.classList.toggle('open')});
function startVoice(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){app.classList.add('open');statusEl.textContent='Tu navegador no habilitó dictado';return}const rec=new SR();rec.lang='es-AR';rec.interimResults=false;rec.onstart=()=>{face.classList.add('listening');statusEl.textContent='Te escucho…'};rec.onresult=e=>{app.classList.add('open');send(e.results[0][0].transcript)};rec.onerror=e=>statusEl.textContent='Micrófono: '+e.error;rec.onend=()=>face.classList.remove('listening');rec.start()}
face.addEventListener('pointerdown',()=>{holding=false;holdTimer=setTimeout(()=>{holding=true;startVoice()},380)});face.addEventListener('pointerup',()=>clearTimeout(holdTimer));face.addEventListener('pointercancel',()=>clearTimeout(holdTimer));
</script></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        worker: "wia",
        workset: WORKSET,
        marker: MARKER,
        model: PRIMARY_MODEL,
        fallback: FALLBACK_MODEL,
        mobile_first: true,
        pwa: false,
      });
    }
    if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(page, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "permissions-policy": "microphone=(self)",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  },
};
