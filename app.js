/* ============================================================================
   Mart Studio · laboratorio multimodal sobre MartLLM
   Una pieza en la mesa compartida por Imagen, Video y Audio; el chat vive en
   Texto. Cada trabajo se cotiza gratis (validate) antes de cobrar.
   ========================================================================== */
'use strict';

window.addEventListener('error', (e) => {
  try { document.body.setAttribute('data-js-error', `${e.message} @ ${String(e.filename || '').split('/').pop()}:${e.lineno}`); } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  try { document.body.setAttribute('data-js-error', 'promise: ' + (e.reason?.message || e.reason)); } catch {}
});

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const mmss = (s) => { const t = Math.max(0, Math.round(s || 0)); return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60); };
const MOTION = () => window.gsap && !matchMedia('(prefers-reduced-motion: reduce)').matches;
const NARROW = () => matchMedia('(max-width:1040px)').matches;
const MODES = ['imagen', 'video', 'audio', 'texto', 'biblioteca', 'modelos', 'gasto'];
const WORK = ['imagen', 'video', 'audio', 'texto'];
const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'expired']);

const money = (v) => {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a > 0 && a < 1e-6) return (v < 0 ? '−' : '') + '<$0.000001';
  const s = a >= 1 ? a.toFixed(2) : a >= 0.1 ? a.toFixed(3) : a >= 0.001 ? a.toFixed(4) : a === 0 ? '0'
    : a.toFixed(Math.min(8, 1 - Math.floor(Math.log10(a))));
  return (v < 0 ? '−$' : '$') + s;
};
const UNIT = { image: 'imagen', second: 's', job: 'trabajo', '1K characters': '1K car.', minute: 'min', megapixel: 'MP', request: 'pedido', '1M tokens': '1M tok' };
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) + ' · ' + d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
};
const dayKey = (d) => { d = new Date(d || 0); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const dayLabel = (key) => {
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (key === dayKey(new Date())) return 'Hoy';
  if (key === dayKey(y)) return 'Ayer';
  const [yy, mo, dd] = key.split('-').map(Number);
  return new Date(yy, mo - 1, dd).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' });
};
const bytesTxt = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB');

/* ------------------------------------------------------------- tipos de trabajo */
const KINDS = {
  image: { mode: 'imagen', label: 'Crear imagen', run: 'Generar', est: 25, media: 'image', prompt: 'Prompt',
    ph: 'Sujeto, composición, luz, estilo… Casi todos los modelos rinden mejor en inglés.',
    filter: (m) => m.endpoints.includes('/v1/images/generations'), def: ['venice/z-image-turbo', 'fal-ai/flux/schnell'] },
  edit: { mode: 'imagen', label: 'Editar imagen', run: 'Editar', est: 40, media: 'image', prompt: 'Qué cambiar',
    ph: 'Ej.: make the sky a sunset, keep everything else untouched',
    filter: (m) => m.endpoints.includes('/v1/images/edits'), def: ['google/nano-banana-pro-edit'] },
  video: { mode: 'video', label: 'Video', run: 'Generar video', est: 150, media: 'video', prompt: 'Prompt',
    ph: 'Qué pasa, cómo se mueve la cámara, el ritmo, la luz…',
    filter: (m) => m.type === 'video', def: ['fal-ai/vidu/q3/text-to-video/turbo'] },
  music: { mode: 'audio', label: 'Música · SFX', run: 'Generar audio', est: 70, media: 'audio', prompt: 'Descripción',
    ph: 'Ej.: lo-fi hip hop, 80 bpm, piano y vinilo / lluvia sobre un techo de calamina',
    filter: (m) => m.type === 'music', def: ['venice/mmaudio-v2-text-to-audio'] },
  speech: { mode: 'audio', label: 'Voz', run: 'Hablar', est: 10, media: 'audio', prompt: 'Texto a decir',
    ph: 'Se cobra por cada 1 000 caracteres empezados.',
    filter: (m) => m.type === 'speech', def: ['venice/kokoro-tts'] },
  transcribe: { mode: 'audio', label: 'Transcribir', run: 'Transcribir', est: 25, media: 'text', prompt: 'Palabras a esperar',
    ph: 'Opcional: nombres propios o términos raros que debería reconocer.',
    filter: (m) => m.type === 'transcription', def: ['venice/whisper-1', 'fal-ai/fal-wizper'] },
  chat: { mode: 'texto', label: 'Chat', run: 'Enviar', est: 15, media: 'text', prompt: 'Mensaje',
    ph: 'Escribe… (Ctrl ⏎ envía)', filter: (m) => m.type === 'chat', def: ['deepseek/deepseek-v4.1-flash-1017', 'openai/gpt-oss-120b'] },
};
const SUBS = {
  imagen: [['image', 'Crear'], ['edit', 'Editar']],
  audio: [['music', 'Música · SFX'], ['speech', 'Voz'], ['transcribe', 'Transcribir']],
};
const TYPE_LABEL = { image: 'Imagen', video: 'Video', music: 'Música · SFX', speech: 'Voz', transcription: 'Transcripción', chat: 'Chat' };
const KIND_LABEL = { image: 'Imagen', edit: 'Edición', video: 'Video', music: 'Música/SFX', speech: 'Voz', transcribe: 'Transcripción', chat: 'Chat' };
const PARAM_LABEL = {
  aspect_ratio: 'Proporción', resolution: 'Resolución', size: 'Tamaño', n: 'Cantidad', duration_seconds: 'Duración (s)',
  audio: 'Con sonido', voice: 'Voz', speed: 'Velocidad', language: 'Idioma', response_format: 'Formato',
  negative_prompt: 'Prompt negativo', seed: 'Semilla', quality: 'Calidad', style: 'Estilo', fps: 'Cuadros/s',
  lyrics: 'Letra', instrumental: 'Instrumental', temperature: 'Temperatura', max_tokens: 'Tokens máx.',
};
const HIDDEN_PARAMS = new Set(['model', 'prompt', 'input', 'image_url', 'end_image_url', 'input_images', 'images', 'image', 'file',
  'validate', 'max_cost', 'quote_id', 'provider', 'models', 'metadata', 'messages']);

/* ------------------------------------------------------------------- estado */
const LS_KEY = 'mart.v1';
const saved = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; } })();
const S = {
  cfg: null, settings: { max_cost: 1, nsfw: true },
  cat: null, byId: new Map(), picks: {}, detail: new Map(),
  assets: [], piece: null,
  mode: saved.mode && MODES.includes(saved.mode) ? saved.mode : 'imagen',
  lastWork: saved.lastWork || 'imagen',
  sub: { imagen: 'image', audio: 'music', ...(saved.sub || {}) },
  models: saved.models || {},
  params: saved.params || {},
  prompts: saved.prompts || {},
  inputs: saved.inputs || {},
  source: saved.source || '',
  chat: saved.chat || { messages: [], system: '' },
  chatImgs: [],
  jobs: [], seen: new Set(), mine: new Set(),
  quote: null, quoteErr: '', quoteKey: '', quoting: false, override: false,
  balance: null, usage: null,
  libF: 'all', libQ: '', libSel: null,
  catF: 'image', catQ: '', catSort: 'price', catLimit: 120, catSel: null,
  pickKind: null, pickF: 'all', pickSort: 'price',
};
let SAVE_T = null;
function persist() {
  clearTimeout(SAVE_T);
  SAVE_T = setTimeout(() => {
    const chat = { system: S.chat.system, messages: S.chat.messages.filter((m) => !m.pending).slice(-80) };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ mode: S.mode, lastWork: S.lastWork, sub: S.sub, models: S.models, params: S.params,
        prompts: S.prompts, inputs: S.inputs, source: S.source, chat }));
    } catch {}
  }, 250);
}

const curKind = (mode = S.mode) => (mode === 'imagen' ? S.sub.imagen : mode === 'video' ? 'video' : mode === 'audio' ? S.sub.audio : mode === 'texto' ? 'chat' : null);
const assetById = (id) => S.assets.find((a) => a.id === id);
const modelById = (id) => S.byId.get(id);
const modelName = (id) => modelById(id)?.name || id || '—';
const kindOfModel = (m) => (m.type === 'chat' ? 'chat' : m.type === 'image' ? (m.endpoints.includes('/v1/images/edits') ? 'edit' : 'image')
  : m.type === 'transcription' ? 'transcribe' : m.type);
const inputsOf = (kind) => (S.inputs[kind] ||= { image_url: '', end_image_url: '', input_images: [] });

/* ---------------------------------------------------------------------- api */
async function api(path, body) {
  const opts = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const res = await fetch(path, opts);
  if (res.status === 401) { location.href = '/login'; throw new Error('La sesión venció.'); }
  let data = {};
  try { data = await res.json(); } catch { throw new Error('El servidor respondió algo que no es JSON (HTTP ' + res.status + ').'); }
  if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

function toast(msg, kind = 'ok', action) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'bad' ? ' bad' : '');
  el.innerHTML = `<svg class="i"><use href="#${kind === 'bad' ? 'i-alert' : 'i-check'}"/></svg><span>${esc(msg)}</span>` +
    (action ? `<button class="btn">${esc(action.label)}</button>` : '');
  $('#toasts').appendChild(el);
  let timer;
  const close = () => { clearTimeout(timer); el.style.transition = 'opacity .25s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 260); };
  if (action) el.querySelector('button').onclick = () => { close(); action.run(); };
  timer = setTimeout(close, kind === 'bad' ? 8000 : action ? 6500 : 3400);
}
function askConfirm(message, yes = 'Borrar') {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'toast bad';
    el.innerHTML = `<svg class="i"><use href="#i-alert"/></svg><span style="flex:1">${esc(message)}</span><button class="btn" data-yes>${esc(yes)}</button><button class="btn" data-no>No</button>`;
    $('#toasts').appendChild(el);
    const done = (v) => { el.remove(); resolve(v); };
    el.querySelector('[data-yes]').onclick = () => done(true);
    el.querySelector('[data-no]').onclick = () => done(false);
    el.querySelector('[data-no]').focus();
    setTimeout(() => { if (el.isConnected) done(false); }, 9000);
  });
}
function runError(msg) { $('#runErr').hidden = !msg; if (msg) $('#runErrTxt').textContent = msg; }

/* ------------------------------------------------------------------- precios */
function priceOf(m) {
  const p = m?.price;
  if (!p) return { main: '—', sub: 'al cotizar', v: Infinity };
  if (m.type === 'chat') {
    if (p.in == null) return { main: '—', sub: '', v: Infinity };
    return { main: `${money(p.in)} · ${money(p.out)}`, sub: 'entrada · salida / 1M tok', v: (p.in || 0) + (p.out || 0) };
  }
  const res = (p.res || []).filter((r) => r.usd != null);
  const min = res.length ? Math.min(p.usd ?? Infinity, ...res.map((r) => r.usd)) : p.usd;
  return { main: (res.length > 1 ? 'desde ' : '') + money(min), sub: '/ ' + (UNIT[p.unit] || p.unit || '—'), v: min ?? Infinity };
}

/* ---------------------------------------------------------------- catálogo */
async function loadCatalog(force) {
  const r = await api('/api/catalog' + (force ? '?force=1' : ''));
  S.cat = r;
  S.picks = r.picks || {};
  S.byId = new Map(r.models.map((m) => [m.id, m]));
  for (const m of r.models) for (const a of m.alias || []) if (!S.byId.has(a)) S.byId.set(a, m);
  for (const k of Object.keys(KINDS)) ensureModel(k);
}
function modelsFor(kind) {
  return (S.cat?.models || []).filter((m) => m.available !== false && KINDS[kind].filter(m) && (S.settings.nsfw || !m.nsfw));
}
function ensureModel(kind) {
  const cur = S.models[kind];
  if (cur && modelById(cur)) return cur;
  const list = modelsFor(kind);
  const pick = KINDS[kind].def.find((id) => list.some((m) => m.id === id))
    || [...list].sort((a, b) => priceOf(a).v - priceOf(b).v)[0]?.id;
  if (pick) S.models[kind] = pick;
  return pick;
}
async function getDetail(id) {
  if (!id) return null;
  if (S.detail.has(id)) return S.detail.get(id);
  try {
    const r = await api('/api/model?id=' + encodeURIComponent(id));
    S.detail.set(id, r.model);
  } catch (e) {
    S.detail.set(id, { id, error: e.message, parameters: {} });
  }
  return S.detail.get(id);
}
const isPick = (id) => Object.values(S.picks || {}).some((arr) => (arr || []).includes(id));

/* -------------------------------------------------------------------- modos */
const EMPTY = {
  imagen: ['Mesa vacía', 'Elige un modelo a la derecha y escribe el prompt. El botón te dice el precio exacto antes de cobrar.'],
  video: ['Sin video', 'Texto a video o imagen a video. Los videos tardan de 1 a 5 minutos; puedes seguir trabajando mientras se cocinan.'],
  audio: ['Sin audio', 'Música y efectos, voz a partir de texto o transcripción de un audio o video de la biblioteca.'],
};

function setMode(mode, opts = {}) {
  if (!MODES.includes(mode)) return;
  const prev = S.mode;
  S.mode = mode;
  if (WORK.includes(mode)) S.lastWork = mode;
  document.body.dataset.mode = mode;
  document.body.classList.toggle('no-side', mode === 'gasto');
  $$('.rail-item[data-mode]').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('is-active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  placeRailInd();
  const work = WORK.includes(mode);
  $('#desk').hidden = !work;
  $('#library').hidden = mode !== 'biblioteca';
  $('#models').hidden = mode !== 'modelos';
  $('#usage').hidden = mode !== 'gasto';
  $('#compose').hidden = !work;
  $('#ficha').hidden = mode !== 'biblioteca';
  $('#modelPanel').hidden = mode !== 'modelos';
  $('#settingsPanel').hidden = true;
  $('#runbar').hidden = !work;
  const chat = mode === 'texto';
  $('#thread').hidden = !chat;
  $('#view').hidden = chat;
  $('#pieceBar').hidden = chat;
  $('#dock').hidden = chat;
  runError('');
  S.override = false;
  if (work) { renderCompose(); paintStage(); }
  if (mode === 'biblioteca') { renderLibrary(); renderFicha(); }
  if (mode === 'modelos') { renderCatalog(); renderModelPanel(); }
  if (mode === 'gasto') renderUsage(true);
  persist();
  try { const q = new URLSearchParams(location.search); q.set('m', mode); history.replaceState(null, '', '?' + q); } catch {}
  if (prev !== mode && !opts.silent && MOTION() && work) {
    gsap.fromTo('#compose .ph h2, #compose .ph p', { x: -14, opacity: 0 }, { x: 0, opacity: 1, duration: .32, stagger: .04, ease: 'expo.out' });
    gsap.fromTo('#compose .field, #compose details.more', { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: .3, stagger: .03, ease: 'power2.out', clearProps: 'transform,opacity' });
  }
  if (NARROW()) window.scrollTo({ top: 0 });
}
function placeRailInd() {
  const a = $('.rail-item.is-active');
  if (a) $('#railInd').style.setProperty('--y', a.offsetTop + 'px');
}

/* ------------------------------------------------------------- compositor */
function modelCard(kind) {
  const id = S.models[kind];
  const m = modelById(id);
  if (!m) return `<button class="mcard" data-act="pick-model"><strong>Elegir modelo</strong><span class="id">${S.cat ? 'ninguno disponible' : 'cargando catálogo…'}</span></button>`;
  const p = priceOf(m);
  return `<button class="mcard" data-act="pick-model" title="Cambiar modelo (M)">
    <strong>${esc(m.name)}</strong><span class="price">${esc(p.main)}<small>${esc(p.sub)}</small></span>
    <span class="id">${esc(m.id)}</span>
    <span class="chg">Cambiar · ${modelsFor(kind).length} modelos</span></button>
    <div class="badges">${isPick(m.id) ? '<span class="badge ink">Recomendado</span>' : ''}${m.nsfw ? '<span class="badge warn">NSFW</span>' : ''}
    ${(m.in || []).filter((x) => x !== 'text').map((x) => `<span class="badge">entra ${esc(x)}</span>`).join('')}
    ${m.type === 'chat' && m.ctx ? `<span class="badge">${Math.round(m.ctx / 1000)}K ctx</span>` : ''}${m.reasoning ? '<span class="badge">razona</span>' : ''}</div>`;
}

function renderCompose() {
  const kind = curKind();
  if (!kind) return;
  const K = KINDS[kind];
  ensureModel(kind);
  const subs = SUBS[S.mode];
  const title = { imagen: 'Imagen', video: 'Video', audio: 'Audio', texto: 'Texto' }[S.mode];
  const desc = {
    image: 'Texto a imagen. Cada modelo trae sus propios tamaños y opciones.',
    edit: 'Imagen a imagen: base + referencias. Hasta 8 imágenes según el modelo.',
    video: 'Texto o imagen a video. Se cobra por segundo según resolución.',
    music: 'Música, jingles y efectos de sonido. Algunos cobran por trabajo, otros por segundo.',
    speech: 'Texto a voz. Se cobra por cada 1 000 caracteres empezados.',
    transcribe: 'Audio o video a texto. Se cobra por minuto empezado.',
    chat: 'Cientos de LLM por tokens. Puedes adjuntar imágenes a modelos con visión.',
  }[kind];
  let html = `<div class="ph"><h2>${title}</h2><p>${desc}</p>${subs ? `<div class="seg" id="subSeg" role="radiogroup">${subs.map(([k, l]) =>
    `<button type="button" data-sub="${k}" class="${k === kind ? 'is-on' : ''}" role="radio" aria-checked="${k === kind}">${l}</button>`).join('')}</div>` : ''}</div>`;
  html += `<div class="field"><div class="field-head"><span class="lbl">Modelo</span><button class="chip" data-act="model-info"><svg class="i"><use href="#i-cube"/></svg>Ficha</button></div><div id="modelBox">${modelCard(kind)}</div></div>`;
  html += `<div id="inputsBox"></div>`;
  if (kind === 'transcribe') html += `<div class="field"><div class="field-head"><span class="lbl">Audio o video</span></div><div id="srcBox"></div></div>`;
  if (kind === 'chat') {
    html += `<div class="field"><div class="field-head"><label class="lbl" for="chatSystem">Instrucciones del sistema <small>opcional</small></label></div>
      <textarea id="chatSystem" rows="2" style="min-height:60px" placeholder="Ej.: Responde en español, breve y directo.">${esc(S.chat.system)}</textarea></div>`;
  }
  html += `<div class="field"><div class="field-head"><label class="lbl" for="promptBox">${K.prompt}</label><span class="counter" id="promptCount"></span></div>
    <textarea class="prompt" id="promptBox" spellcheck="false" placeholder="${esc(K.ph)}" ${kind === 'transcribe' ? 'style="min-height:70px"' : ''}>${esc(kind === 'chat' ? (S.prompts.chat || '') : (S.prompts[kind] || ''))}</textarea>
    ${kind === 'chat' ? `<div class="chips" id="chatAttach"></div>` : ''}
    <div class="chips" id="promptChips"></div></div>`;
  html += `<details class="more" id="paramsMore" open><summary><span class="lbl">Parámetros del modelo</span><span class="sum" id="paramsSum"></span><svg class="i"><use href="#i-chev"/></svg></summary><div class="more-body" id="paramsBox"><p class="hint" style="margin:0">Cargando la ficha…</p></div></details>`;
  if (kind === 'chat') html += `<div class="field"><div class="row"><button class="btn sm" data-act="new-chat"><svg class="i"><use href="#i-plus"/></svg>Nuevo chat</button><span class="hint" style="margin:0">${S.chat.messages.length} mensajes en el hilo</span></div></div>`;
  $('#compose').innerHTML = html;
  paintPromptCount();
  paintPromptChips();
  if (kind === 'transcribe') paintSource();
  if (kind === 'chat') paintChatAttach();
  loadModelForm(kind);
  syncRun();
}

async function loadModelForm(kind) {
  const id = S.models[kind];
  if (!id) { $('#paramsBox').innerHTML = '<p class="hint" style="margin:0">Elige un modelo.</p>'; return; }
  const d = await getDetail(id);
  if (curKind() !== kind || S.models[kind] !== id) return;
  renderInputs(kind, d);
  renderParams(kind, d);
  requestQuote();
}

/* -- imágenes de entrada */
function slotsOf(kind, d) {
  const props = d?.parameters?.properties || {};
  const req = JSON.stringify(d?.parameters?.anyOf || '').includes('image_url') || JSON.stringify(d?.parameters?.anyOf || '').includes('input_images');
  const out = [];
  if (kind === 'chat' || kind === 'transcribe' || kind === 'speech' || kind === 'music') return out;
  const refLike = /reference|r2v|ref-to|multi/i.test(d?.id || '');
  if (props.input_images && (kind !== 'video' || refLike || !props.image_url)) {
    out.push({ key: 'input_images', label: kind === 'edit' ? 'Imágenes' : 'Referencias', many: true, max: props.input_images.maxItems || 8, req,
      hint: kind === 'edit' ? 'La 1.ª es la que se edita; las demás son referencias.' : 'Imágenes de referencia para el video.' });
  } else if (props.image_url) {
    out.push({ key: 'image_url', label: kind === 'video' ? 'Primer cuadro' : 'Imagen base', many: false, max: 1, req });
  }
  if (props.end_image_url) out.push({ key: 'end_image_url', label: 'Último cuadro', many: false, max: 1, req: false });
  return out;
}
function renderInputs(kind, d) {
  const box = $('#inputsBox');
  if (!box) return;
  const slots = slotsOf(kind, d);
  const inp = inputsOf(kind);
  box.innerHTML = slots.map((s) => {
    const ids = s.many ? (inp[s.key] || []).filter(assetById) : (inp[s.key] && assetById(inp[s.key]) ? [inp[s.key]] : []);
    const cells = ids.map((id, i) => {
      const a = assetById(id);
      return `<div class="ref"><img src="${esc(a.thumb_url || a.url)}" alt="${esc(a.name)}" loading="lazy"><span class="no">${s.many ? i + 1 : ''}</span>
        <button class="x" data-slot="${s.key}" data-rm="${esc(id)}" aria-label="Quitar"><svg class="i"><use href="#i-close"/></svg></button></div>`;
    }).join('');
    const add = ids.length < s.max ? `<button class="ref-add" data-slot="${s.key}" data-act="add-input"><svg class="i"><use href="#i-plus"/></svg>Biblioteca</button>
      <button class="ref-add" data-slot="${s.key}" data-act="up-input"><svg class="i"><use href="#i-upload"/></svg>Subir</button>` : '';
    return `<div class="field"><div class="field-head"><span class="lbl">${s.label} ${s.req ? '<small>obligatoria</small>' : '<small>opcional</small>'}</span>
      <span class="counter">${ids.length} / ${s.max}</span></div><div class="refs" data-drop="${s.key}">${cells}${add}</div>
      ${s.hint ? `<p class="hint">${s.hint}</p>` : ''}${S.piece && assetById(S.piece)?.media === 'image' && ids.length < s.max && !ids.includes(S.piece)
        ? `<div class="chips"><button class="chip" data-slot="${s.key}" data-act="piece-input"><svg class="i"><use href="#i-arrow"/></svg>Usar la pieza de la mesa</button></div>` : ''}</div>`;
  }).join('');
}
function addInput(kind, slot, id) {
  const inp = inputsOf(kind);
  const a = assetById(id);
  if (!a || a.media !== 'image') { toast('Eso no es una imagen.', 'bad'); return; }
  if (slot === 'input_images') {
    if (!inp.input_images.includes(id)) inp.input_images.push(id);
    const max = S.detail.get(S.models[kind])?.parameters?.properties?.input_images?.maxItems || 8;
    inp.input_images = inp.input_images.slice(0, max);
  } else inp[slot] = id;
  persist();
  if (curKind() === kind) { renderInputs(kind, S.detail.get(S.models[kind])); requestQuote(); }
}
function activeImages(kind) {
  const d = S.detail.get(S.models[kind]);
  const inp = inputsOf(kind);
  const out = {};
  for (const s of slotsOf(kind, d)) {
    if (s.many) { const ids = (inp[s.key] || []).filter(assetById); if (ids.length) out[s.key] = ids; }
    else if (inp[s.key] && assetById(inp[s.key])) out[s.key] = inp[s.key];
  }
  return out;
}

/* -- fuente para transcribir */
function paintSource() {
  const box = $('#srcBox');
  if (!box) return;
  const a = assetById(S.source);
  box.innerHTML = a && ['audio', 'video'].includes(a.media)
    ? `<div class="src"><span class="kd" data-k="${a.media}"></span><div class="t"><b>${esc(a.name)}</b><span>${a.duration ? mmss(a.duration) : '—'} · ${bytesTxt(a.bytes)}</span></div>
       <button class="btn sm" data-act="pick-source">Cambiar</button></div>`
    : `<div class="src is-none"><div class="t"><b>Ninguno elegido</b><span>mp3, wav, ogg, flac, m4a, mp4, webm · hasta 40 MB</span></div>
       <button class="btn sm" data-act="pick-source">Biblioteca</button><button class="btn sm" data-act="up-source">Subir</button></div>`;
}

/* -- parámetros dinámicos */
function paramsFor(kind, d) {
  if (kind === 'chat') {
    return {
      temperature: { type: 'number', minimum: 0, maximum: 2, description: '0 = preciso, 1 = normal, más alto = creativo.' },
      max_tokens: { type: 'integer', minimum: 1, maximum: d?.max_out || 131072, description: 'Tope de la respuesta. Los modelos que razonan gastan parte en pensar.' },
    };
  }
  const props = { ...(d?.parameters?.properties || {}) };
  for (const k of Object.keys(props)) if (HIDDEN_PARAMS.has(k)) delete props[k];
  if (kind === 'image' || kind === 'edit') delete props.response_format;
  if (kind === 'speech' && props.response_format && !props.response_format.enum) props.response_format = { ...props.response_format, enum: ['mp3', 'wav', 'opus', 'flac'] };
  if (props.n) props.n = { ...props.n, maximum: Math.min(props.n.maximum || 4, 4) };
  return props;
}
function renderParams(kind, d) {
  const box = $('#paramsBox');
  if (!box) return;
  const id = S.models[kind];
  const vals = (S.params[id] ||= {});
  const props = paramsFor(kind, d);
  const keys = Object.keys(props);
  if (d?.error && kind !== 'chat') {
    box.innerHTML = `<p class="hint" style="margin:0">MartLLM no publica la ficha de este modelo (${esc(d.error)}). Se usan sus valores por defecto.</p>`;
  } else if (!keys.length) {
    box.innerHTML = '<p class="hint" style="margin:0">Este modelo no tiene opciones: solo el prompt.</p>';
  } else {
    box.innerHTML = `<div class="params">${keys.map((k) => paramWidget(k, props[k], vals[k])).join('')}</div>
      <div class="row"><button class="chip" data-act="reset-params"><svg class="i"><use href="#i-redo"/></svg>Valores por defecto</button></div>`;
  }
  paintParamsSum(kind);
}
function paramWidget(key, sch, val) {
  const label = PARAM_LABEL[key] || key.replace(/_/g, ' ');
  const desc = sch.description && !/^(What to make|Detail level|Shape of the (picture|video)|How many pictures)\.?$/i.test(sch.description) ? sch.description : '';
  const has = val !== undefined && val !== null && val !== '';
  const def = sch.default;
  let ctrl;
  if (sch.enum) {
    const opts = sch.enum;
    const short = opts.length <= 6 && opts.reduce((n, o) => n + String(o).length, 0) <= 28;
    if (short) {
      const auto = def === undefined ? `<button type="button" data-pv="" class="${!has ? 'is-on' : ''}">Auto</button>` : '';
      ctrl = `<div class="seg" data-param="${esc(key)}">${auto}${opts.map((o) => {
        const on = has ? val === o : def === o;
        return `<button type="button" data-pv='${esc(JSON.stringify(o))}' class="${on ? 'is-on' : ''}">${esc(o)}</button>`;
      }).join('')}</div>`;
    } else {
      ctrl = `<select data-param="${esc(key)}"><option value="">${def !== undefined ? 'Por defecto (' + esc(def) + ')' : 'Por defecto'}</option>${opts.map((o) =>
        `<option value='${esc(JSON.stringify(o))}' ${has && val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    }
  } else if (sch.type === 'boolean') {
    const cur = has ? val : def;
    ctrl = `<div class="seg" data-param="${esc(key)}"><button type="button" data-pv="" class="${!has ? 'is-on' : ''}">Auto</button>
      <button type="button" data-pv="true" class="${has && cur === true ? 'is-on' : ''}">Sí</button><button type="button" data-pv="false" class="${has && cur === false ? 'is-on' : ''}">No</button></div>`;
  } else if (sch.type === 'integer' || sch.type === 'number') {
    ctrl = `<input type="number" data-param="${esc(key)}" data-num="${sch.type}" ${sch.minimum != null ? `min="${sch.minimum}"` : ''} ${sch.maximum != null ? `max="${sch.maximum}"` : ''}
      step="${sch.type === 'integer' ? 1 : 'any'}" value="${has ? esc(val) : ''}" placeholder="${def !== undefined ? esc(def) : 'por defecto'}">`;
  } else if (sch.type === 'array' || sch.type === 'object') {
    return '';
  } else {
    const long = /prompt|lyrics|letra/i.test(key);
    ctrl = long ? `<textarea data-param="${esc(key)}" rows="2" style="min-height:60px" placeholder="${def !== undefined ? esc(def) : 'opcional'}">${has ? esc(val) : ''}</textarea>`
      : `<input type="text" data-param="${esc(key)}" value="${has ? esc(val) : ''}" placeholder="${def !== undefined ? esc(def) : 'opcional'}">`;
  }
  const range = sch.minimum != null || sch.maximum != null ? `<small>${sch.minimum ?? ''}–${sch.maximum ?? ''}</small>` : '';
  return `<div class="param"><div class="lbl"><span>${esc(label)}</span>${range}</div>${ctrl}${desc ? `<p class="desc">${esc(desc)}</p>` : ''}</div>`;
}
function setParam(key, raw, numType) {
  const kind = curKind();
  const id = S.models[kind];
  const vals = (S.params[id] ||= {});
  let v = raw;
  if (numType) v = raw === '' ? '' : (numType === 'integer' ? parseInt(raw, 10) : parseFloat(raw));
  if (v === '' || v === undefined || (typeof v === 'number' && isNaN(v))) delete vals[key]; else vals[key] = v;
  persist();
  paintParamsSum(kind);
  requestQuote();
}
function paintParamsSum(kind) {
  const el = $('#paramsSum');
  if (!el) return;
  const vals = S.params[S.models[kind]] || {};
  const ks = Object.keys(vals);
  el.textContent = ks.length ? ks.map((k) => `${PARAM_LABEL[k] || k}: ${vals[k]}`).join(' · ') : 'por defecto';
}

/* -- prompt */
function paintPromptCount() {
  const kind = curKind();
  const el = $('#promptCount');
  const box = $('#promptBox');
  if (!el || !box) return;
  const n = box.value.length;
  el.textContent = kind === 'speech' ? `${n} car. · ${Math.max(1, Math.ceil(n / 1000))} bloque${n > 1000 ? 's' : ''} de 1K` : n ? `${n} car.` : '';
}
function paintPromptChips() {
  const box = $('#promptChips');
  if (!box) return;
  const kind = curKind();
  const saved = (S.cfg?.prompts || []).filter((p) => !p.kind || p.kind === kind).slice(0, 6);
  const chips = [];
  if (kind !== 'chat' && kind !== 'transcribe') chips.push(`<button class="chip" data-act="save-prompt"><svg class="i"><use href="#i-plus"/></svg>Guardar prompt</button>`);
  for (const p of saved) chips.push(`<button class="chip" data-load-prompt="${esc(p.name)}" title="${esc(p.text.slice(0, 200))}">${esc(p.name)}</button>`);
  box.innerHTML = chips.join('');
}
function paintChatAttach() {
  const box = $('#chatAttach');
  if (!box) return;
  const m = modelById(S.models.chat);
  const vision = m && (m.in || []).includes('image');
  box.innerHTML = (vision ? `<button class="chip" data-act="chat-img"><svg class="i"><use href="#i-image"/></svg>Adjuntar imagen</button>` : '') +
    S.chatImgs.map((id) => { const a = assetById(id); return a ? `<button class="chip is-on" data-rm-chatimg="${esc(id)}" title="Quitar">${esc(a.name.slice(0, 18))} <svg class="i"><use href="#i-close"/></svg></button>` : ''; }).join('');
  if (!vision && S.chatImgs.length) S.chatImgs = [];
}

/* ------------------------------------------------------------- cotización */
let QUOTE_T = null;
function quoteBody() {
  const kind = curKind();
  const model = S.models[kind];
  const body = { kind, model, prompt: ($('#promptBox')?.value || S.prompts[kind] || '').trim(), params: S.params[model] || {}, images: activeImages(kind) };
  if (kind === 'transcribe') body.duration = assetById(S.source)?.duration || 60;
  return body;
}
function requestQuote() {
  clearTimeout(QUOTE_T);
  S.override = false;
  const kind = curKind();
  if (!kind || kind === 'chat' || !S.models[kind]) { S.quote = null; S.quoteErr = ''; syncRun(); return; }
  QUOTE_T = setTimeout(async () => {
    const body = quoteBody();
    if (body.kind === 'speech' && !body.prompt) { S.quote = null; S.quoteErr = ''; syncRun(); return; }
    // el texto solo cambia el precio en voz; en el resto no se recotiza por cada tecla
    const key = JSON.stringify({ ...body, prompt: body.kind === 'speech' ? Math.ceil(body.prompt.length / 1000) : '' });
    if (key === S.quoteKey && (S.quote || S.quoteErr)) { syncRun(); return; }
    S.quoteKey = key;
    S.quoting = true;
    syncRun();
    try {
      const r = await api('/api/quote', body);
      if (S.quoteKey !== key) return;
      S.quote = r.quote; S.quoteErr = '';
    } catch (e) {
      if (S.quoteKey !== key) return;
      S.quote = null; S.quoteErr = e.message;
    }
    S.quoting = false;
    syncRun();
  }, 550);
}
function chatEstimate() {
  const m = modelById(S.models.chat);
  if (!m?.price?.in) return null;
  const chars = (S.chat.system || '').length + S.chat.messages.reduce((n, x) => n + (x.content || '').length, 0) + ($('#promptBox')?.value || '').length;
  const tin = Math.ceil(chars / 3.6) + 8 * (S.chat.messages.length + 1);
  const tout = Number((S.params[m.id] || {}).max_tokens) || 800;
  return { tin, cost: tin * m.price.in / 1e6, max: tin * m.price.in / 1e6 + tout * (m.price.out || 0) / 1e6 };
}

/* ------------------------------------------------------------- ejecutar */
let LAUNCHING = false;
function syncRun() {
  const kind = curKind();
  if (!kind) return;
  const K = KINDS[kind];
  const btn = $('#runBtn');
  const cap = S.settings.max_cost;
  let label = K.run, px = '', noteL = '', noteR = '', block = false;
  if (!S.models[kind]) { block = true; noteL = 'Elige un modelo.'; }
  if (kind === 'chat') {
    const est = chatEstimate();
    if (est) { px = '≈ ' + money(est.cost); noteL = `≈ ${est.tin.toLocaleString('es-PE')} tok de entrada`; noteR = `máx. ≈ ${money(est.max)}`; }
    else noteL = 'Precio por tokens: se ve al responder.';
    if (S.chat.messages.some((m) => m.pending)) { block = true; label = 'Respondiendo…'; }
  } else if (S.quoting) {
    noteL = 'Cotizando…';
  } else if (S.quote) {
    const q = S.quote;
    px = money(q.cost_usd);
    const held = q.max_cost_usd && Math.abs(q.max_cost_usd - q.cost_usd) > 1e-6 ? ` · retiene ${money(q.max_cost_usd)}` : '';
    noteL = `<b>${q.units ?? ''} ${esc(UNIT[q.unit] || q.unit || '')}</b>${held}`;
    const defs = q.defaults_applied ? Object.entries(q.defaults_applied).map(([k, v]) => `${PARAM_LABEL[k] || k}: ${v}`).join(', ') : '';
    noteR = defs ? `por defecto: ${esc(defs)}` : 'cotizado · sin cobrar';
    const top = q.max_cost_usd || q.cost_usd;
    if (cap && top > cap) {
      noteR = `<span class="warn">Supera tu tope de ${money(cap)}</span>`;
      if (S.override) label = 'Confirmar';
    }
    if (S.balance && S.balance.available != null && top > S.balance.available) { noteR = `<span class="warn">Saldo insuficiente (${money(S.balance.available)})</span>`; }
  } else if (S.quoteErr) {
    noteL = `<span class="warn">${esc(S.quoteErr)}</span>`;
  }
  if (LAUNCHING) { block = true; label = 'Enviando…'; }
  $('#runLabel').textContent = label;
  $('#runPx').textContent = px;
  $('#runNoteL').innerHTML = noteL;
  $('#runNoteR').innerHTML = noteR;
  btn.disabled = block;
}

async function run() {
  const kind = curKind();
  if (!kind || $('#runBtn').disabled) return;
  runError('');
  if (kind === 'chat') return sendChat();
  const body = quoteBody();
  if (kind === 'speech' && !body.prompt) return runError('Escribe el texto a decir.');
  if (!['speech', 'transcribe'].includes(kind) && body.prompt.length < 3) return runError('Escribe un prompt.');
  if (kind === 'transcribe' && !assetById(S.source)) return runError('Elige un audio o video para transcribir.');
  const d = S.detail.get(body.model);
  const missing = slotsOf(kind, d).find((s) => s.req && !body.images[s.key]);
  if (missing && !Object.keys(body.images).length) return runError(`Este modelo necesita ${missing.label.toLowerCase()}.`);
  if (kind === 'edit' && !Object.keys(body.images).length) return runError('Suma al menos una imagen para editar.');
  const q = S.quote;
  const top = q ? (q.max_cost_usd || q.cost_usd) : 0;
  if (q && S.settings.max_cost && top > S.settings.max_cost) {
    if (!S.override) { S.override = true; syncRun(); toast(`Cuesta hasta ${money(top)}, más que tu tope de ${money(S.settings.max_cost)}. Vuelve a pulsar para confirmar.`); return; }
    body.max_cost = Math.ceil(top * 1.1 * 1000) / 1000;
  }
  if (kind === 'transcribe') body.source = S.source;
  LAUNCHING = true; syncRun();
  try {
    const r = await api('/api/run', body);
    S.mine.add(r.job.id);
    S.jobs.unshift(r.job);
    renderSlots();
    ensurePolling(true);
    toast(`${KINDS[kind].label} en camino · ${modelName(body.model)}`);
  } catch (e) { runError(e.message); }
  finally { LAUNCHING = false; S.override = false; syncRun(); }
}

/* ------------------------------------------------------------------- chat */
function renderThread() {
  const box = $('#thread');
  const msgs = S.chat.messages;
  if (!msgs.length) {
    box.innerHTML = `<div class="thread-empty"><b>Chat</b>Elige un modelo y escribe. El costo de cada respuesta aparece debajo, sacado de la cabecera de MartLLM.</div>`;
    return;
  }
  box.innerHTML = (S.chat.system ? `<div class="msg system"><div class="bub">${esc(S.chat.system)}</div></div>` : '') + msgs.map((m, i) => {
    const imgs = (m.images || []).map((id) => assetById(id)).filter(Boolean);
    const meta = m.role === 'assistant' && !m.pending
      ? `<div class="meta"><span>${esc(modelName(m.model))}</span>${m.cost != null ? `<span>${money(m.cost)}</span>` : ''}${m.usage?.prompt_tokens ? `<span>${m.usage.prompt_tokens}→${m.usage.completion_tokens} tok</span>` : ''}${m.elapsed ? `<span>${m.elapsed}s</span>` : ''}
         <button class="chip" style="height:22px;padding:0 8px;font-size:11px" data-copy-msg="${i}">Copiar</button></div>` : '';
    const reason = m.reasoning ? `<details><summary>Razonamiento</summary><pre>${esc(m.reasoning)}</pre></details>` : '';
    return `<div class="msg ${m.role}${m.pending ? ' pending' : ''}${m.error ? ' err' : ''}">${imgs.length ? `<div class="imgs">${imgs.map((a) => `<img src="${esc(a.thumb_url || a.url)}" alt="">`).join('')}</div>` : ''}
      ${reason}<div class="bub">${m.pending ? 'Pensando… ' + mmss((Date.now() - m.t0) / 1000) : esc(m.error || m.content || (m.reasoning ? '(sin texto final: subí «Tokens máx.»)' : '(vacío)'))}</div>${meta}</div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}
async function sendChat() {
  const box = $('#promptBox');
  const text = (box?.value || '').trim();
  if (!text && !S.chatImgs.length) return runError('Escribe un mensaje.');
  const model = S.models.chat;
  const user = { role: 'user', content: text, images: [...S.chatImgs] };
  S.chat.messages.push(user);
  const pend = { role: 'assistant', pending: true, model, t0: Date.now() };
  S.chat.messages.push(pend);
  box.value = ''; S.prompts.chat = ''; S.chatImgs = [];
  paintChatAttach(); renderThread(); syncRun(); persist();
  const history = S.chat.messages.filter((m) => !m.pending && !m.error).map((m) => ({ role: m.role, content: m.content || '', images: m.images || [] }));
  if (S.chat.system) history.unshift({ role: 'system', content: S.chat.system });
  try {
    const r = await api('/api/run', { kind: 'chat', model, messages: history, params: S.params[model] || {} });
    S.mine.add(r.job.id); S.seen.add(r.job.id);
    let j = r.job;
    const tick = setInterval(() => { if (S.mode === 'texto') renderThread(); }, 1000);
    while (!TERMINAL.has(j.status)) {
      await new Promise((res) => setTimeout(res, 1200));
      try { j = (await api('/api/job/' + r.job.id)).job; } catch {}
    }
    clearInterval(tick);
    Object.assign(pend, { pending: false, content: j.text, reasoning: j.reasoning, cost: j.cost, usage: j.usage, elapsed: j.elapsed, error: j.status === 'succeeded' ? '' : j.error });
    loadUsage();
    refreshBalance(true);
  } catch (e) {
    Object.assign(pend, { pending: false, error: e.message });
  }
  if (S.mode === 'texto') { renderThread(); renderCompose(); }
  persist(); syncRun();
}

/* ------------------------------------------------------------------- jobs */
let POLL = null;
function ensurePolling(now) {
  if (POLL) clearTimeout(POLL);
  POLL = setTimeout(pollJobs, now ? 900 : 2000);
}
async function pollJobs() {
  POLL = null;
  try {
    const r = await api('/api/jobs');
    const prev = new Map(S.jobs.map((j) => [j.id, j]));
    S.jobs = r.jobs;
    for (const j of r.jobs) {
      if (TERMINAL.has(j.status) && !S.seen.has(j.id)) {
        S.seen.add(j.id);
        if (j.kind !== 'chat' && (S.mine.has(j.id) || (prev.get(j.id) && !TERMINAL.has(prev.get(j.id).status)))) onJobDone(j);
      }
    }
    renderSlots();
    paintJobsPill(r.inflight);
    if (!$('#jobsSheet').hidden) renderJobsSheet();
    if (r.inflight) ensurePolling();
  } catch {
    ensurePolling();
  }
}
async function onJobDone(j) {
  if (j.status !== 'succeeded') {
    toast(`${KIND_LABEL[j.kind]} falló: ${j.error || j.status}`, 'bad');
    return;
  }
  await refreshLibrary();
  const a = assetById(j.assets?.[0]);
  const c = j.cost != null ? money(j.cost) : j.estimate != null ? '≈ ' + money(j.estimate) : '';
  toast(`${KIND_LABEL[j.kind]} lista${c ? ' · ' + c : ''}`, 'ok', a && !WORK.includes(S.mode) ? { label: 'Ver', run: () => { setPiece(a.id); setMode(KINDS[j.kind].mode); } } : null);
  if (a && WORK.includes(S.mode) && S.mode !== 'texto') setPiece(a.id);
  loadUsage();
  refreshBalance(true);
}
function estFor(j) { return KINDS[j.kind]?.est || 30; }
function renderSlots() {
  const live = S.jobs.filter((j) => j.kind !== 'chat' && (!TERMINAL.has(j.status) || (S.mine.has(j.id) && Date.now() - new Date(j.ended || j.created).getTime() < 15 * 60e3)));
  $('#batchSec').hidden = !live.length;
  const run = live.filter((j) => !TERMINAL.has(j.status)).length;
  $('#batchInfo').textContent = run ? `${run} en curso` : 'terminadas';
  $('#slots').innerHTML = live.slice(0, 8).map((j) => {
    const m = KINDS[j.kind]?.media || 'image';
    if (j.status === 'succeeded') {
      const a = assetById(j.assets?.[0]);
      const img = a?.thumb_url ? `<img src="${esc(a.thumb_url)}" alt="">` : '';
      return `<button class="slot is-done${S.piece && a && S.piece === a.id ? ' is-on' : ''}" data-m="${m}" data-open="${esc(a?.id || '')}" title="${esc(j.prompt)}">${img}
        <span class="lbl"><b>${j.cost != null ? money(j.cost) : 'OK'}</b><span>${esc(modelName(j.model))}</span></span></button>`;
    }
    if (TERMINAL.has(j.status)) {
      return `<div class="slot is-fail" data-m="${m}" title="${esc(j.error)}"><span class="lbl"><b>✕</b><span>${esc(j.status === 'canceled' ? 'cancelado' : 'falló')}</span></span></div>`;
    }
    const p = j.progress != null ? j.progress : Math.min(.94, (j.elapsed || 0) / estFor(j));
    return `<div class="slot is-run" data-m="${m}" style="--p:${p.toFixed(3)}" title="${esc(j.prompt)}"><span class="fill"></span>
      <span class="lbl"><b class="num">${mmss(j.elapsed)}</b><span>${esc(j.status === 'queued' ? 'en cola' : KIND_LABEL[j.kind])}</span></span></div>`;
  }).join('');
}
function paintJobsPill(n) {
  const pill = $('#jobsBtn');
  pill.classList.toggle('is-live', !!n);
  $('#jobsTxt').innerHTML = n ? `<span class="count">${n}</span> en vuelo` : 'Trabajos';
}
function renderJobsSheet() {
  const jobs = S.jobs;
  $('#jobsBody').innerHTML = jobs.length ? jobs.map((j) => {
    const a = assetById(j.assets?.[0]);
    const th = a?.thumb_url ? `<img class="jt" src="${esc(a.thumb_url)}" alt="">` : `<span class="jt"></span>`;
    const st = { queued: 'En cola', running: 'Corriendo', succeeded: 'Listo', failed: 'Falló', canceled: 'Cancelado', expired: 'Expiró' }[j.status] || j.status;
    const canCancel = ['video', 'music'].includes(j.kind) && !TERMINAL.has(j.status);
    return `<div class="job">${th}<div class="jb"><p>${esc(j.prompt || KIND_LABEL[j.kind])}</p>
      <div class="jm"><span>${esc(KIND_LABEL[j.kind])}</span><span>${esc(modelName(j.model))}</span><span>${mmss(j.elapsed)}</span>
      <span>${j.cost != null ? money(j.cost) : j.estimate != null ? '≈ ' + money(j.estimate) : ''}${j.cost_pending ? ' (asentando)' : ''}</span></div>
      ${j.error ? `<div class="er">${esc(j.error)}</div>` : ''}</div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end"><span class="st ${j.status}">${st}</span>
      ${canCancel ? `<button class="btn sm" data-cancel="${esc(j.id)}">Cancelar</button>` : ''}${a ? `<button class="btn sm" data-open="${esc(a.id)}">Ver</button>` : ''}</div></div>`;
  }).join('') : '<div class="blank"><b>Nada todavía</b>Los trabajos de esta sesión del servidor aparecen acá.</div>';
}

/* -------------------------------------------------------------- la mesa */
function setPiece(id) {
  S.piece = id || null;
  paintStage();
  renderRecent();
  renderSlots();
  const kind = curKind();
  if (kind && kind !== 'chat') renderInputs(kind, S.detail.get(S.models[kind]));
}
function paintStage() {
  if (S.mode === 'texto') { renderThread(); return; }
  const a = assetById(S.piece);
  const stage = $('#stage');
  const [t, x] = EMPTY[S.mode] || EMPTY.imagen;
  $('#emptyTitle').textContent = t;
  $('#emptyText').textContent = x;
  stage.classList.toggle('is-empty', !a);
  const view = $('#view');
  if (!a) {
    view.innerHTML = '';
    $('#hud').innerHTML = '';
    $('#pieceName').textContent = 'Sin pieza en la mesa';
    $('#pieceSub').textContent = 'Genera, sube o elige una de la biblioteca';
    $('#pieceActs').innerHTML = `<button class="btn" data-act="upload"><svg class="i"><use href="#i-upload"/></svg><span class="lab">Subir</span></button>`;
    renderRecent();
    return;
  }
  if (a.media === 'image') view.innerHTML = `<img src="${esc(a.url)}" alt="${esc(a.name)}" class="${a.alpha ? 'is-checker' : ''}" data-act="open-full">`;
  else if (a.media === 'video') view.innerHTML = `<video src="${esc(a.url)}" controls loop playsinline preload="metadata" ${a.thumb_url ? `poster="${esc(a.thumb_url)}"` : ''}></video>`;
  else if (a.media === 'audio') view.innerHTML = `<div class="audio-piece"><div class="wave">${a.thumb_url ? `<img src="${esc(a.thumb_url)}" alt="">` : '<b>Audio</b>'}</div><audio src="${esc(a.url)}" controls preload="metadata"></audio></div>`;
  else view.innerHTML = `<div class="text-piece">${esc(a.text || 'Cargando…')}</div>`;
  if (a.media === 'text' && !a.text) fetch(a.url).then((r) => r.text()).then((t) => { a.text = t; if (S.piece === a.id) $('.text-piece').textContent = t; });
  const dims = a.w ? `${a.w}×${a.h}` : '';
  $('#hud').innerHTML = [a.model ? modelName(a.model) : 'subida', dims, a.duration ? mmss(a.duration) : '', bytesTxt(a.bytes)].filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join('') +
    (a.cost != null ? `<span class="cost">${money(a.cost)}</span>` : '');
  $('#pieceName').textContent = a.name;
  $('#pieceSub').innerHTML = `<span class="kd" data-k="${a.media}"></span><span>${esc(KIND_LABEL[a.origin] || 'Subida')}</span><span>${esc(fmtDate(a.created))}</span>${a.prompt ? `<span>${esc(a.prompt.slice(0, 90))}</span>` : ''}`;
  const acts = [`<a class="btn ink" href="${esc(a.url)}" download="${esc(a.file.split('/').pop())}"><svg class="i"><use href="#i-download"/></svg><span class="lab">Descargar</span></a>`];
  if (a.media === 'image') {
    acts.push(`<button class="btn" data-act="to-edit" title="Editarla"><svg class="i"><use href="#i-image"/></svg><span class="lab">Editar</span></button>`);
    acts.push(`<button class="btn" data-act="to-video" title="Animarla: imagen a video"><svg class="i"><use href="#i-video"/></svg><span class="lab">A video</span></button>`);
  }
  if (a.media === 'audio' || a.media === 'video') acts.push(`<button class="btn" data-act="to-transcribe"><svg class="i"><use href="#i-mic"/></svg><span class="lab">Transcribir</span></button>`);
  if (a.prompt && a.origin !== 'upload' && a.origin !== 'transcribe') acts.push(`<button class="btn" data-act="reuse"><svg class="i"><use href="#i-redo"/></svg><span class="lab">Reusar</span></button>`);
  acts.push(`<button class="btn danger sq" data-act="del" title="Mover a la papelera"><svg class="i"><use href="#i-trash"/></svg></button>`);
  $('#pieceActs').innerHTML = acts.join('');
  renderRecent();
}
function glyph(a) {
  const ic = { image: 'i-image', video: 'i-video', audio: 'i-audio', text: 'i-text' }[a.media] || 'i-text';
  return `<span class="glyph" data-k="${a.media}"><svg class="i"><use href="#${ic}"/></svg></span>`;
}
function renderRecent() {
  const list = S.assets.slice(0, 16);
  $('#recent').innerHTML = list.length ? list.map((a) => `<button class="thumb${S.piece === a.id ? ' is-on' : ''}" data-open="${esc(a.id)}" title="${esc(a.name)}">
    ${a.thumb_url ? `<img src="${esc(a.thumb_url)}" alt="" loading="lazy">` : glyph(a)}<span class="kd" data-k="${a.media}"></span></button>`).join('')
    : '<span class="dock-none">Aún no hay piezas.</span>';
}
async function pieceAction(act) {
  const a = assetById(S.piece);
  if (act === 'upload') return pickFiles('library');
  if (act === 'models') return setMode('modelos');
  if (!a) return;
  if (act === 'open-full') return window.open(a.url, '_blank');
  if (act === 'to-edit') { S.sub.imagen = 'edit'; setMode('imagen'); addAsFirstInput('edit', a.id); }
  if (act === 'to-video') { setMode('video'); addAsFirstInput('video', a.id); }
  if (act === 'to-transcribe') { S.sub.audio = 'transcribe'; S.source = a.id; setMode('audio'); requestQuote(); }
  if (act === 'reuse') reusePrompt(a);
  if (act === 'del') deleteAssets([a.id]);
}
async function addAsFirstInput(kind, id) {
  const d = await getDetail(S.models[kind]);
  const slots = slotsOf(kind, d);
  if (!slots.length) { toast('Este modelo no acepta imágenes: elige uno que diga «entra image».', 'bad'); openModelPicker(kind); return; }
  const s = slots[0];
  const inp = inputsOf(kind);
  if (s.many) inp[s.key] = [id, ...(inp[s.key] || []).filter((x) => x !== id)];
  else inp[s.key] = id;
  persist();
  renderInputs(kind, d);
  requestQuote();
}
function reusePrompt(a) {
  const kind = a.origin;
  if (!KINDS[kind]) return;
  S.prompts[kind] = a.prompt;
  if (a.model && modelById(a.model)) S.models[kind] = a.model;
  if (a.params && a.model) S.params[a.model] = { ...a.params };
  if (KINDS[kind].mode === 'imagen') S.sub.imagen = kind;
  if (KINDS[kind].mode === 'audio') S.sub.audio = kind;
  setMode(KINDS[kind].mode);
  toast('Prompt, modelo y parámetros cargados.');
}
async function deleteAssets(ids) {
  if (!(await askConfirm(ids.length > 1 ? `¿Mover ${ids.length} piezas a la papelera?` : '¿Mover esta pieza a la papelera?'))) return;
  try {
    const r = await api('/api/delete', { ids });
    if (r.ids.includes(S.piece)) S.piece = null;
    await refreshLibrary();
    paintStage(); if (S.mode === 'biblioteca') { S.libSel = null; renderLibrary(); renderFicha(); }
    toast(`En la ${r.where === 'papelera' ? 'Papelera de Windows' : r.where}.`);
  } catch (e) { toast(e.message, 'bad'); }
}

/* ------------------------------------------------------------- biblioteca */
async function refreshLibrary() {
  const r = await api('/api/library');
  S.assets = r.assets;
  if (S.cfg) S.cfg.prompts = r.prompts;
  else S.cfg = { prompts: r.prompts };
  if (S.piece && !assetById(S.piece)) S.piece = null;
  renderRecent();
  if (S.mode === 'biblioteca') renderLibrary();
}
function libItems() {
  const q = S.libQ.trim().toLowerCase();
  return S.assets.filter((a) => (S.libF === 'all' || (S.libF === 'upload' ? a.origin === 'upload' : a.media === S.libF))
    && (!q || `${a.name} ${a.prompt} ${a.model} ${a.text || ''}`.toLowerCase().includes(q)));
}
function renderLibrary() {
  const counts = { all: S.assets.length, upload: 0, image: 0, video: 0, audio: 0, text: 0 };
  for (const a of S.assets) { counts[a.media] = (counts[a.media] || 0) + 1; if (a.origin === 'upload') counts.upload++; }
  $$('#libFilters [data-c]').forEach((b) => { b.textContent = counts[b.dataset.c] || 0; });
  $$('#libFilters .filter').forEach((b) => b.classList.toggle('is-on', b.dataset.f === S.libF));
  const items = libItems();
  const spent = S.assets.reduce((n, a) => n + (a.cost || 0), 0);
  $('#libTotal').textContent = `${S.assets.length} piezas · ${money(spent)} en total`;
  if (!items.length) {
    $('#libScroll').innerHTML = `<div class="lib-empty"><b>${S.assets.length ? 'Nada coincide' : 'Vacía'}</b><p>${S.assets.length ? 'Prueba otra búsqueda o filtro.' : 'Lo que generes o subas queda acá, con su prompt, modelo y costo.'}</p></div>`;
    return;
  }
  const groups = new Map();
  for (const a of items) { const k = dayKey(a.created); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
  $('#libScroll').innerHTML = [...groups].map(([k, list]) => `<div class="day-h"><h3>${esc(dayLabel(k))}</h3><span>${list.length} · ${money(list.reduce((n, a) => n + (a.cost || 0), 0))}</span></div>
    <div class="grid">${list.map((a) => `<button class="card${S.libSel === a.id ? ' is-sel' : ''}" data-k="${a.media}" data-sel="${esc(a.id)}">
      ${a.thumb_url ? `<img src="${esc(a.thumb_url)}" alt="" loading="lazy">` : a.media === 'text' ? `<span class="snip">${esc((a.text || a.prompt || '').slice(0, 260))}</span>` : glyph(a)}
      <span class="kd"></span>${a.duration ? `<span class="tag">${mmss(a.duration)}</span>` : a.cost != null ? `<span class="tag">${money(a.cost)}</span>` : ''}
      <span class="cap">${esc(a.prompt || a.name)}</span></button>`).join('')}</div>`).join('');
}
function renderFicha() {
  const a = assetById(S.libSel);
  const box = $('#ficha');
  if (!a) { box.innerHTML = `<div class="ph"><h2>Ficha</h2><p>Elige una pieza: aquí ves su prompt, modelo, parámetros y lo que costó.</p></div>`; return; }
  const prev = a.media === 'image' ? `<img src="${esc(a.url)}" alt="">` : a.media === 'video' ? `<video src="${esc(a.url)}" controls loop playsinline preload="metadata"></video>`
    : a.media === 'audio' ? `<audio src="${esc(a.url)}" controls preload="metadata"></audio>` : `<pre>${esc(a.text || '')}</pre>`;
  const params = Object.entries(a.params || {}).map(([k, v]) => `${PARAM_LABEL[k] || k}: ${v}`).join(' · ');
  box.innerHTML = `<div class="ph"><h2>Ficha</h2><p>${esc(KIND_LABEL[a.origin] || 'Subida')} · ${esc(fmtDate(a.created))}</p></div>
    <div class="ficha-prev">${prev}</div>
    <div class="field"><div class="ficha-name"><span class="kd" data-k="${a.media}"></span>${esc(a.name)}</div>
      <dl class="kv"><dt>Modelo</dt><dd>${esc(a.model || '—')}</dd><dt>Costo</dt><dd>${a.cost != null ? money(a.cost) : '—'}</dd>
      ${a.w ? `<dt>Medidas</dt><dd>${a.w}×${a.h}</dd>` : ''}${a.duration ? `<dt>Duración</dt><dd>${mmss(a.duration)}</dd>` : ''}
      <dt>Peso</dt><dd>${bytesTxt(a.bytes)}</dd>${params ? `<dt>Ajustes</dt><dd>${esc(params)}</dd>` : ''}${a.refs?.length ? `<dt>Entradas</dt><dd>${a.refs.length} imagen(es)</dd>` : ''}</dl></div>
    ${a.prompt ? `<div class="field"><div class="field-head"><span class="lbl">Prompt</span><button class="chip" data-copy="${esc(a.id)}"><svg class="i"><use href="#i-copy"/></svg>Copiar</button></div><div class="promptbox">${esc(a.prompt)}</div></div>` : ''}
    <div class="field"><div class="acts-grid">
      <a class="btn ink" href="${esc(a.url)}" download="${esc(a.file.split('/').pop())}"><svg class="i"><use href="#i-download"/></svg>Descargar</a>
      <button class="btn" data-fact="desk"><svg class="i"><use href="#i-arrow"/></svg>A la mesa</button>
      ${a.media === 'image' ? `<button class="btn" data-fact="to-edit"><svg class="i"><use href="#i-image"/></svg>Editar</button><button class="btn" data-fact="to-video"><svg class="i"><use href="#i-video"/></svg>A video</button>` : ''}
      ${['audio', 'video'].includes(a.media) ? `<button class="btn" data-fact="to-transcribe"><svg class="i"><use href="#i-mic"/></svg>Transcribir</button>` : ''}
      ${a.prompt && KINDS[a.origin] && a.origin !== 'transcribe' ? `<button class="btn" data-fact="reuse"><svg class="i"><use href="#i-redo"/></svg>Reusar</button>` : ''}
      <button class="btn danger" data-fact="del"><svg class="i"><use href="#i-trash"/></svg>Papelera</button></div></div>`;
}

/* --------------------------------------------------------------- catálogo */
const CAT_TYPES = [['image', 'Imagen'], ['video', 'Video'], ['music', 'Música · SFX'], ['speech', 'Voz'], ['transcription', 'Transcripción'], ['chat', 'Chat']];
function renderCatalog() {
  if (!S.cat) { $('#catScroll').innerHTML = '<div class="lib-empty"><b>Cargando</b><p>Bajando el catálogo de MartLLM…</p></div>'; return; }
  const all = S.cat.models.filter((m) => S.settings.nsfw || !m.nsfw);
  const counts = {};
  for (const m of all) counts[m.type] = (counts[m.type] || 0) + 1;
  $('#catFilters').innerHTML = CAT_TYPES.map(([k, l]) => `<button class="filter${S.catF === k ? ' is-on' : ''}" data-catf="${k}">${l} <b>${counts[k] || 0}</b></button>`).join('') +
    `<button class="filter nsfw-tog${S.settings.nsfw ? ' is-on' : ''}" data-nsfw aria-pressed="${!!S.settings.nsfw}" title="Mostrar u ocultar los modelos para adultos">+18 ${S.settings.nsfw ? 'visibles' : 'ocultos'} <b>${S.cat.models.filter((m) => m.nsfw).length}</b></button>` +
    `<select id="catSort" aria-label="Orden"><option value="price">Más baratos</option><option value="price-desc">Más caros</option><option value="new">Más nuevos</option><option value="name">Nombre</option><option value="pick">Recomendados primero</option></select>`;
  $('#catSort').value = S.catSort;
  const q = S.catQ.trim().toLowerCase();
  let list = all.filter((m) => m.type === S.catF && (!q || `${m.name} ${m.id} ${m.owner}`.toLowerCase().includes(q)));
  const sorters = {
    price: (a, b) => priceOf(a).v - priceOf(b).v, 'price-desc': (a, b) => (priceOf(b).v === Infinity ? -1 : priceOf(b).v) - (priceOf(a).v === Infinity ? -1 : priceOf(a).v),
    new: (a, b) => (b.created || 0) - (a.created || 0), name: (a, b) => a.name.localeCompare(b.name), pick: (a, b) => (isPick(b.id) - isPick(a.id)) || (priceOf(a).v - priceOf(b).v),
  };
  list.sort(sorters[S.catSort] || sorters.price);
  $('#catTotal').textContent = `${S.cat.models.length} modelos · catálogo de ${fmtDate(S.cat.at)}${S.cat.stale ? ' (sin conexión)' : ''}`;
  const shown = list.slice(0, S.catLimit);
  $('#catScroll').innerHTML = list.length ? `<table class="mtable"><thead><tr><th>Modelo</th><th class="own">Proveedor</th><th class="mods">Entra</th><th class="r">Precio</th></tr></thead><tbody>
    ${shown.map((m) => { const p = priceOf(m); return `<tr data-model="${esc(m.id)}" class="${S.catSel === m.id ? 'is-sel' : ''}"><td class="nm"><b>${esc(m.name)}${isPick(m.id) ? ' <span class="badge ink">rec.</span>' : ''}${m.nsfw ? ' <span class="badge warn">NSFW</span>' : ''}</b><span>${esc(m.id)}</span></td>
      <td class="typ own">${esc(m.owner)}</td><td class="mods">${esc((m.in || []).join(' · '))}</td><td class="r px">${esc(p.main)}<small>${esc(p.sub)}</small></td></tr>`; }).join('')}
    </tbody></table>${list.length > shown.length ? `<div class="more-rows"><button class="btn" id="catMore">Ver ${Math.min(120, list.length - shown.length)} más (${list.length - shown.length} restantes)</button></div>` : ''}`
    : '<div class="lib-empty"><b>Nada</b><p>Ningún modelo coincide.</p></div>';
}
async function renderModelPanel() {
  const box = $('#modelPanel');
  const id = S.catSel;
  if (!id) { box.innerHTML = `<div class="ph"><h2>Ficha</h2><p>Elige un modelo para ver su precio por resolución, sus parámetros y probarlo.</p></div>`; return; }
  const m = modelById(id);
  box.innerHTML = `<div class="ph"><h2>Ficha</h2><p>${esc(m?.name || id)}</p></div><div class="blank">Cargando…</div>`;
  const d = await getDetail(id);
  if (S.catSel !== id) return;
  const p = m?.price || {};
  let price = '';
  if (m?.type === 'chat') {
    price = `<dl class="kv"><dt>Entrada</dt><dd>${money(p.in)} / 1M tok${p.list_in ? ` (lista ${money(p.list_in)})` : ''}</dd><dt>Salida</dt><dd>${money(p.out)} / 1M tok${p.list_out ? ` (lista ${money(p.list_out)})` : ''}</dd>
      ${p.cache_read ? `<dt>Caché</dt><dd>${money(p.cache_read)} / 1M tok</dd>` : ''}<dt>Contexto</dt><dd>${m.ctx ? m.ctx.toLocaleString('es-PE') : '—'} tok</dd><dt>Salida máx.</dt><dd>${m.max_out ? m.max_out.toLocaleString('es-PE') : '—'} tok</dd>
      <dt>Base</dt><dd>${p.basis === 'paid_7d' ? 'lo que pagaron otros en 7 días' : 'precio de lista'}</dd></dl>`;
  } else if (p.unit) {
    const res = (p.res || []).filter((r) => r.r);
    price = `<dl class="kv"><dt>Precio</dt><dd>${money(p.usd)} / ${esc(UNIT[p.unit] || p.unit)}${p.list && p.list !== p.usd ? ` (lista ${money(p.list)})` : ''}</dd></dl>
      ${res.length ? `<table class="ttable"><thead><tr><th>Resolución</th><th class="r">Precio / ${esc(UNIT[p.unit] || p.unit)}</th>${res.some((r) => r.s) ? '<th class="r">Clip de 5 s</th>' : ''}</tr></thead><tbody>
      ${res.map((r) => `<tr><td>${esc(r.r)}</td><td class="r mono">${money(r.usd)}</td>${res.some((x) => x.s) ? `<td class="r mono">${p.unit === 'second' ? money(r.usd * 5) : ''}</td>` : ''}</tr>`).join('')}</tbody></table>` : ''}`;
  } else price = '<p class="hint">Sin precio publicado: cotiza antes de usarlo.</p>';
  const props = d?.parameters?.properties || {};
  const plist = Object.entries(props).filter(([k]) => !['model'].includes(k)).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td>${esc(v.enum ? v.enum.join(' · ') : (v.type || '') + (v.minimum != null ? ` ${v.minimum}–${v.maximum ?? ''}` : ''))}${v.description ? `<br><span style="color:var(--dim)">${esc(v.description)}</span>` : ''}</td></tr>`).join('');
  const kind = m ? kindOfModel(m) : null;
  box.innerHTML = `<div class="ph"><h2>Ficha</h2><p>${esc(m?.owner || '')}</p></div>
    <div class="field"><div class="ficha-name">${esc(m?.name || id)}</div><div class="hint" style="font-family:var(--f-mono);font-size:11.5px">${esc(id)}</div>
      <div class="badges">${isPick(id) ? '<span class="badge ink">Recomendado por MartLLM</span>' : ''}${m?.nsfw ? '<span class="badge warn">NSFW</span>' : ''}
      ${(m?.in || []).map((x) => `<span class="badge">entra ${esc(x)}</span>`).join('')}${(m?.endpoints || []).map((e) => `<span class="badge">${esc(e.replace('/v1/', ''))}</span>`).join('')}</div></div>
    <div class="field"><div class="field-head"><span class="lbl">Precio</span></div>${price}</div>
    ${plist ? `<div class="field"><div class="field-head"><span class="lbl">Parámetros</span></div><table class="ttable"><tbody>${plist}</tbody></table></div>` : d?.error ? `<div class="field"><p class="hint">${esc(d.error)}</p></div>` : ''}
    <div class="field"><div class="acts-grid">${kind && KINDS[kind] ? `<button class="btn ink" data-use-model="${esc(id)}"><svg class="i"><use href="#i-arrow"/></svg>Probarlo</button>` : ''}
      <button class="btn" data-copy-id="${esc(id)}"><svg class="i"><use href="#i-copy"/></svg>Copiar id</button></div></div>`;
}
function useModel(id) {
  const m = modelById(id);
  if (!m) return;
  const kind = kindOfModel(m);
  S.models[kind] = m.id;
  if (KINDS[kind].mode === 'imagen') S.sub.imagen = kind;
  if (KINDS[kind].mode === 'audio') S.sub.audio = kind;
  persist();
  setMode(KINDS[kind].mode);
}

async function setNsfw(on) {
  try {
    const r = await api('/api/settings', { nsfw: on });
    S.settings = r.settings;
  } catch (e) { toast(e.message, 'bad'); return; }
  if (!on && S.pickF === 'adult') S.pickF = 'all';
  if (S.mode === 'modelos') renderCatalog();
  if (!$('#pickSheet').hidden) renderPicker();
  if (S.mode === 'gasto') renderUsage();
  if (curKind()) renderCompose();
  toast(on ? 'Modelos +18 visibles.' : 'Modelos +18 ocultos.');
}

/* -------------------------------------------------------- selector modelo */
function openModelPicker(kind) {
  S.pickKind = kind;
  S.pickF = 'all';
  $('#pickTitle').textContent = 'Modelo · ' + KINDS[kind].label;
  $('#pickSearch').value = '';
  openSheet('pickSheet');
  renderPicker();
  setTimeout(() => $('#pickSearch').focus(), 60);
}
function renderPicker() {
  const kind = S.pickKind;
  const f = [['all', 'Todos'], ['pick', 'Recomendados']];
  if (kind === 'video') f.push(['img', 'Acepta imagen'], ['txt', 'Solo texto']);
  if (kind === 'chat') f.push(['vision', 'Con visión'], ['reason', 'Razonan']);
  if (S.settings.nsfw) f.push(['adult', 'Solo +18']);
  $('#pickFilters').innerHTML = f.map(([k, l]) => `<button class="chip${S.pickF === k ? ' is-on' : ''}" data-pf="${k}">${l}</button>`).join('') +
    `<button class="chip${S.settings.nsfw ? ' is-on' : ''}" data-nsfw aria-pressed="${!!S.settings.nsfw}">+18 ${S.settings.nsfw ? 'visibles' : 'ocultos'}</button>` +
    `<select id="pickSort" style="width:auto;height:30px;padding:0 28px 0 11px;border-radius:999px;font-size:12.5px;margin-left:auto"><option value="price">Más baratos</option><option value="new">Más nuevos</option><option value="name">Nombre</option></select>`;
  $('#pickSort').value = S.pickSort;
  const q = $('#pickSearch').value.trim().toLowerCase();
  let list = modelsFor(kind).filter((m) => (!q || `${m.name} ${m.id} ${m.owner}`.toLowerCase().includes(q)) && (
    S.pickF === 'all' || (S.pickF === 'pick' && isPick(m.id)) || (S.pickF === 'img' && m.in.includes('image')) || (S.pickF === 'txt' && !m.in.includes('image'))
    || (S.pickF === 'vision' && m.in.includes('image')) || (S.pickF === 'reason' && m.reasoning) || (S.pickF === 'adult' && m.nsfw)));
  const sorters = { price: (a, b) => priceOf(a).v - priceOf(b).v, new: (a, b) => (b.created || 0) - (a.created || 0), name: (a, b) => a.name.localeCompare(b.name) };
  list.sort(sorters[S.pickSort]);
  const cur = S.models[kind];
  $('#pickBody').innerHTML = list.length ? list.slice(0, 300).map((m) => {
    const p = priceOf(m);
    return `<button class="pick${m.id === cur ? ' is-on' : ''}" data-pick="${esc(m.id)}"><b>${esc(m.name)}</b><span class="px">${esc(p.main)}<small>${esc(p.sub)}</small></span><span class="id">${esc(m.id)}</span>
      <span class="badges">${isPick(m.id) ? '<span class="badge ink">rec.</span>' : ''}${m.nsfw ? '<span class="badge warn">NSFW</span>' : ''}${(m.in || []).filter((x) => x !== 'text').map((x) => `<span class="badge">${esc(x)}</span>`).join('')}${m.reasoning ? '<span class="badge">razona</span>' : ''}</span></button>`;
  }).join('') : '<div class="blank"><b>Nada</b>Ningún modelo coincide.</div>';
}

/* -------------------------------------------------------- selector piezas */
let ASSET_PICK = null;
function openAssetPicker(title, media, onPick) {
  ASSET_PICK = { media, onPick };
  $('#assetTitle').textContent = title;
  $('#assetSearch').value = '';
  openSheet('assetSheet');
  renderAssetPicker();
}
function renderAssetPicker() {
  const q = $('#assetSearch').value.trim().toLowerCase();
  const list = S.assets.filter((a) => ASSET_PICK.media.includes(a.media) && (!q || `${a.name} ${a.prompt}`.toLowerCase().includes(q))).slice(0, 240);
  $('#assetGrid').innerHTML = list.length ? list.map((a) => `<button data-apick="${esc(a.id)}" title="${esc(a.name)}" data-k="${a.media}">${a.thumb_url ? `<img src="${esc(a.thumb_url)}" alt="" loading="lazy">` : glyph(a)}
    <span class="kd" data-k="${a.media}"></span><span class="nm">${esc(a.name)}${a.duration ? ' · ' + mmss(a.duration) : ''}</span></button>`).join('')
    : '<p class="hint" style="grid-column:1/-1">No hay piezas de ese tipo. Súbelas con U o arrastrándolas.</p>';
}
function openSheet(id) { $('#' + id).hidden = false; }
function closeSheets() { $$('.sheet').forEach((s) => { s.hidden = true; }); }

/* ------------------------------------------------------------------ subir */
let UP_TARGET = null;
function pickFiles(target) { UP_TARGET = target; const fi = $('#fileInput'); fi.accept = target?.accept || 'image/*,audio/*,video/*'; fi.value = ''; fi.click(); }
function readAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('No pude leer ' + file.name)); r.readAsDataURL(file); });
}
async function uploadFiles(files, target) {
  const out = [];
  for (const f of files) {
    if (f.size > 100 * 1024 * 1024) { toast(`${f.name}: pesa más de 100 MB.`, 'bad'); continue; }
    try {
      const r = await api('/api/upload', { data_url: await readAsDataURL(f), name: f.name });
      out.push(r.asset);
    } catch (e) { toast(`${f.name}: ${e.message}`, 'bad'); }
  }
  if (!out.length) return;
  await refreshLibrary();
  if (target?.slot) for (const a of out) if (a.media === 'image') addInput(target.kind, target.slot, a.id);
  if (target === 'source' || (target?.source)) { const a = out.find((x) => ['audio', 'video'].includes(x.media)); if (a) { S.source = a.id; paintSource(); requestQuote(); persist(); } }
  if (target === 'chat') { for (const a of out) if (a.media === 'image') S.chatImgs.push(a.id); paintChatAttach(); }
  if (target === 'library' || !target) { if (WORK.includes(S.mode) && S.mode !== 'texto') setPiece(out[0].id); }
  toast(out.length > 1 ? `${out.length} archivos subidos.` : `Subido: ${out[0].name}`);
}
function dropTarget(files) {
  const kind = curKind();
  const imgs = files.every((f) => f.type.startsWith('image/'));
  if (kind === 'transcribe' && files.some((f) => /^(audio|video)\//.test(f.type))) return 'source';
  if (kind === 'chat' && imgs) return 'chat';
  if (kind && imgs && WORK.includes(S.mode)) {
    const slot = slotsOf(kind, S.detail.get(S.models[kind]))[0];
    if (slot) return { kind, slot: slot.key };
  }
  return 'library';
}

/* ------------------------------------------------------------------ saldo */
async function refreshBalance(force) {
  try {
    const r = await api('/api/balance' + (force ? '?force=1' : ''));
    S.balance = r;
    $('#statusDot').classList.remove('bad');
    $('#statusTxt').textContent = 'MartLLM';
  } catch (e) {
    $('#statusDot').classList.add('bad');
    $('#statusTxt').textContent = 'Sin conexión';
    $('#statusPill').title = e.message;
  }
  paintWallet();
  syncRun();
}
function spentSince(ms) { return (S.usage?.ledger || []).filter((r) => new Date(r.at).getTime() >= ms).reduce((n, r) => n + (r.cost || 0), 0); }
function paintWallet() {
  const b = S.balance;
  $('#walletAmt').textContent = b ? money(b.available ?? b.balance) : '—';
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = spentSince(start.getTime());
  $('#walletToday').textContent = today ? `−${money(today).replace('$', '$')} hoy` : '';
  $('#walletBtn').classList.toggle('is-low', !!b && (b.available ?? 0) < 1);
  $('#walletBtn').title = b ? `Saldo ${money(b.balance)} · retenido ${money(b.held)} · disponible ${money(b.available)}` : 'Saldo';
}
async function loadUsage() {
  try { S.usage = await api('/api/usage'); S.settings = S.usage.settings || S.settings; } catch {}
  paintWallet();
  if (S.mode === 'gasto') renderUsage();
}

/* ------------------------------------------------------------------ gasto */
async function renderUsage(fetchFirst) {
  if (fetchFirst) { await Promise.all([loadUsage(), refreshBalance(true)]); return; }
  const L = S.usage?.ledger || [];
  const B = S.usage?.balances || [];
  const b = S.balance;
  const now = Date.now();
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const total = L.reduce((n, r) => n + (r.cost || 0), 0);
  const day7 = spentSince(now - 7 * 864e5);
  const today = spentSince(d0.getTime());
  // recargas y consumo según las fotos del saldo
  let topups = 0, drops = 0;
  for (let i = 1; i < B.length; i++) { const dlt = (B[i].balance || 0) - (B[i - 1].balance || 0); if (dlt > 0.0001) topups += dlt; else drops -= dlt; }
  const firstAt = B[0] ? new Date(B[0].at).getTime() : now;
  const inApp = L.filter((r) => new Date(r.at).getTime() >= firstAt).reduce((n, r) => n + (r.cost || 0), 0);
  const outside = drops - inApp;
  $('#useStamp').textContent = b ? `saldo al ${fmtDate(b.at)}` : '';
  const byKind = {};
  const byModel = {};
  for (const r of L) { byKind[r.kind] = (byKind[r.kind] || 0) + (r.cost || 0); byModel[r.model] = (byModel[r.model] || 0) + (r.cost || 0); }
  const avg = L.length ? total / L.length : 0;
  const daysLeft = day7 > 0 && b ? (b.available / (day7 / 7)) : null;
  const html = `<div class="dash">
    <div class="tile hero"><h4>Saldo disponible</h4><div class="sub">MartLLM · recarga prepaga</div><b>${b ? money(b.available) : '—'}</b>
      <div class="sm">${b ? `saldo ${money(b.balance)} · retenido ${money(b.held)}` : 'sin datos'}${b?.saved_24h ? ` · ahorraste ${money(b.saved_24h)} en 24 h` : ''}</div></div>
    <div class="tile"><h4>Gastado</h4><div class="sub">lo que pasó por esta app</div>
      <div class="stat"><span>Hoy</span><b>${money(today)}</b></div><div class="stat"><span>Últimos 7 días</span><b>${money(day7)}</b></div>
      <div class="stat"><span>Total registrado</span><b>${money(total)}</b></div><div class="stat"><span>Llamadas · promedio</span><b>${L.length} · ${money(avg)}</b></div></div>
    <div class="tile"><h4>Saldo en el tiempo</h4><div class="sub">desde ${B[0] ? fmtDate(B[0].at) : '—'}</div>
      <div class="stat"><span>Recargas detectadas</span><b>${money(topups)}</b></div><div class="stat"><span>Consumo según saldo</span><b>${money(drops)}</b></div>
      <div class="stat"><span>Fuera de la app / sin asentar</span><b>${money(Math.max(0, outside))}</b></div>
      <div class="stat"><span>A este ritmo te alcanza</span><b>${daysLeft != null ? (daysLeft > 365 ? '+1 año' : Math.round(daysLeft) + ' días') : '—'}</b></div></div>
    <div class="tile wide"><h4>Saldo</h4><div class="sub">una foto por cada cambio; subidas = recargas</div><div class="chart" id="chBal"></div></div>
    <div class="tile"><h4>Por tipo</h4><div class="sub">total registrado</div><div class="hbars">${hbars(byKind, (k) => KIND_LABEL[k] || k)}</div></div>
    <div class="tile wide"><h4>Gasto por día</h4><div class="sub">últimos 14 días</div><div class="chart" id="chDay"></div></div>
    <div class="tile"><h4>Modelos que más gastan</h4><div class="sub">top 8</div><div class="hbars">${hbars(byModel, (k) => modelName(k), 8)}</div></div>
    <div class="tile"><h4>Tope por trabajo</h4><div class="sub">se manda como max_cost; si un trabajo cuesta más, te pide confirmar</div>
      <div class="row" style="margin-top:12px"><input type="number" id="capIn" min="0" step="0.05" value="${S.settings.max_cost ?? ''}" placeholder="sin tope" style="width:120px"><button class="btn sm ink" id="capSave">Guardar</button></div>
      <label class="chip" style="margin-top:12px"><input type="checkbox" id="nsfwIn" ${S.settings.nsfw ? 'checked' : ''}>Mostrar modelos +18 (NSFW)</label></div>
    <div class="tile wide"><h4>Cómo se cuenta</h4><p class="note" style="margin-top:8px">MartLLM no expone el historial por API, así que esta app <b>anota cada llamada</b> que pasa por ella con el costo exacto que devuelve MartLLM (cabecera <b>X-UberLLM-Cost-USD</b> o <b>usage.cost_usd</b>). Video y música se asientan unos segundos después de terminar. Además guarda una <b>foto del saldo</b> cada vez que cambia: si gastas desde otro lado (Hermes, otra app), aparece como «fuera de la app». Los precios del catálogo se renuevan cada 6 h; el botón de generar siempre cotiza en vivo.</p></div>
    <div class="tile full"><h4>Últimas llamadas</h4><div class="sub">${L.length} en total · exporta todo en CSV</div>
      <table class="ttable"><thead><tr><th>Fecha</th><th>Tipo</th><th>Modelo</th><th>Detalle</th><th class="r">Costo</th></tr></thead><tbody>
      ${L.slice(-80).reverse().map((r) => `<tr><td class="mono">${esc(fmtDate(r.at))}</td><td>${esc(KIND_LABEL[r.kind] || r.kind)}</td><td class="mono clip">${esc(r.model)}</td>
        <td class="clip">${esc(r.prompt || '')}${r.tokens_in ? ` · ${r.tokens_in}→${r.tokens_out} tok` : ''}</td><td class="r mono">${money(r.cost)}${r.pending ? ' *' : ''}</td></tr>`).join('') || '<tr><td colspan="5">Todavía no hay llamadas.</td></tr>'}
      </tbody></table></div></div>`;
  $('#useScroll').innerHTML = html;
  drawBalance($('#chBal'), B, b);
  drawDays($('#chDay'), L);
}
function hbars(obj, name, top = 10) {
  const rows = Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, top);
  if (!rows.length) return '<p class="hint" style="margin:0">Sin gasto todavía.</p>';
  const max = rows[0][1];
  return rows.map(([k, v]) => `<div class="hb" title="${esc(k)}"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name(k))}</span><span class="track"><i style="width:${(v / max * 100).toFixed(1)}%"></i></span><b>${money(v)}</b></div>`).join('');
}
function chartTip(box, x, y, html) {
  let t = box.querySelector('.tip');
  if (!t) { t = document.createElement('div'); t.className = 'tip'; box.appendChild(t); }
  t.hidden = !html;
  if (html) { t.innerHTML = html; t.style.left = x + 'px'; t.style.top = y + 'px'; }
}
function drawBalance(box, B, cur) {
  const pts = B.map((s) => ({ t: new Date(s.at).getTime(), v: s.balance })).filter((p) => p.v != null);
  if (cur && cur.balance != null) pts.push({ t: Date.now(), v: cur.balance });
  if (pts.length < 2) { box.innerHTML = '<p class="hint">Hace falta más historia: cada vez que el saldo cambie se suma un punto.</p>'; return; }
  const W = 720, H = 200, L = 52, R = 10, T = 12, Bm = 24;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  if (hi - lo < 0.01) { lo -= 0.05; hi += 0.05; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const X = (t) => L + (t - t0) / Math.max(1, t1 - t0) * (W - L - R);
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - Bm);
  // escalón: el saldo se mantiene hasta la siguiente foto
  let d = `M${X(pts[0].t)},${Y(pts[0].v)}`;
  for (let i = 1; i < pts.length; i++) d += `H${X(pts[i].t)}V${Y(pts[i].v)}`;
  const ticks = [0, 1, 2, 3].map((i) => lo + (hi - lo) * i / 3);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo en el tiempo">
    ${ticks.map((v) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 3.5}" text-anchor="end">${money(v)}</text>`).join('')}
    <text x="${L}" y="${H - 6}">${esc(fmtDate(new Date(t0).toISOString()))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">ahora</text>
    <path class="ar" d="${d}V${H - Bm}H${X(pts[0].t)}Z"/><path class="ln" d="${d}"/>
    <line class="cross" id="balX" y1="${T}" y2="${H - Bm}" visibility="hidden"/><circle class="dotm" id="balDot" r="4.5" visibility="hidden"/>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - Bm}"/></svg>`;
  const svg = box.querySelector('svg');
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const sx = (e.clientX - r.left) / r.width * W;
    const t = t0 + (sx - L) / (W - L - R) * (t1 - t0);
    let p = pts[0];
    for (const q of pts) if (q.t <= t) p = q;
    const cx = X(Math.max(t0, Math.min(t1, t))), cy = Y(p.v);
    svg.querySelector('#balX').setAttribute('x1', cx); svg.querySelector('#balX').setAttribute('x2', cx); svg.querySelector('#balX').setAttribute('visibility', 'visible');
    const dot = svg.querySelector('#balDot'); dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
    chartTip(box, cx / W * r.width, cy / H * r.height, `${money(p.v)}<small>${esc(fmtDate(new Date(p.t).toISOString()))}</small>`);
  });
  hit.addEventListener('pointerleave', () => { svg.querySelector('#balX').setAttribute('visibility', 'hidden'); svg.querySelector('#balDot').setAttribute('visibility', 'hidden'); chartTip(box); });
}
function drawDays(box, L) {
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push({ k: dayKey(d), d, v: 0, n: 0 }); }
  const idx = new Map(days.map((x) => [x.k, x]));
  for (const r of L) { const x = idx.get(dayKey(r.at)); if (x) { x.v += r.cost || 0; x.n++; } }
  const W = 720, H = 190, Lm = 52, R = 6, T = 12, Bm = 24;
  const max = Math.max(...days.map((x) => x.v), 0.0001);
  const nice = max * 1.12;
  const bw = (W - Lm - R) / days.length;
  const Y = (v) => T + (1 - v / nice) * (H - T - Bm);
  const ticks = [0, 0.5, 1].map((f) => nice * f);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gasto por día">
    ${ticks.map((v) => `<line class="gl" x1="${Lm}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${Lm - 8}" y="${Y(v) + 3.5}" text-anchor="end">${money(v)}</text>`).join('')}
    ${days.map((x, i) => {
      const bx = Lm + i * bw + 2, w = bw - 4, h = Math.max(x.v ? 2 : 0, (H - T - Bm) - (Y(x.v) - T));
      const y = H - Bm - h, r = Math.min(4, w / 2, h);
      const path = h ? `M${bx},${H - Bm}V${y + r}Q${bx},${y} ${bx + r},${y}H${bx + w - r}Q${bx + w},${y} ${bx + w},${y + r}V${H - Bm}Z` : '';
      const lab = i % 2 === 1 || i === days.length - 1 ? `<text x="${bx + w / 2}" y="${H - 6}" text-anchor="middle">${x.d.getDate()}</text>` : '';
      return `<rect class="hit" data-i="${i}" x="${Lm + i * bw}" y="${T}" width="${bw}" height="${H - T - Bm}"/>${path ? `<path class="bar" d="${path}"/>` : '<g></g>'}${lab}`;
    }).join('')}</svg>`;
  const svg = box.querySelector('svg');
  svg.querySelectorAll('.hit').forEach((el) => {
    el.addEventListener('pointerenter', () => {
      const x = days[+el.dataset.i];
      const r = svg.getBoundingClientRect();
      const cx = (Lm + (+el.dataset.i + 0.5) * bw) / W * r.width;
      chartTip(box, cx, Y(x.v) / H * r.height, `${money(x.v)}<small>${esc(dayLabel(x.k))} · ${x.n} llamada${x.n === 1 ? '' : 's'}</small>`);
    });
    el.addEventListener('pointerleave', () => chartTip(box));
  });
}
function exportCsv() {
  const L = S.usage?.ledger || [];
  const cols = ['at', 'kind', 'model', 'cost', 'pending', 'prompt', 'tokens_in', 'tokens_out', 'remote', 'job'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...L.map((r) => cols.map((c) => q(r[c])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `mart-gasto-${dayKey(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ------------------------------------------------------------------ eventos */
function bind() {
  $$('.rail-item[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#uploadBtn').onclick = () => pickFiles('library');
  $('#walletBtn').onclick = () => setMode('gasto');
  $('#jobsBtn').onclick = () => { renderJobsSheet(); openSheet('jobsSheet'); };
  $('#helpBtn').onclick = () => openSheet('helpSheet');
  $('#openFolder').onclick = () => api('/api/reveal', {}).catch((e) => toast(e.message, 'bad'));
  $('#runBtn').onclick = run;
  $('#runErrX').onclick = () => runError('');
  $$('.sheet').forEach((s) => s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-close]')) s.hidden = true; }));
  $('#fileInput').addEventListener('change', (e) => { const files = [...e.target.files]; if (files.length) uploadFiles(files, UP_TARGET); });

  // compositor (delegación)
  const comp = $('#compose');
  comp.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const kind = curKind();
    if (t.dataset.sub) {
      if (S.mode === 'imagen') S.sub.imagen = t.dataset.sub; else S.sub.audio = t.dataset.sub;
      S.quote = null; S.quoteErr = ''; S.quoteKey = '';
      persist(); renderCompose(); return;
    }
    if (t.dataset.pv !== undefined) {
      const seg = t.closest('[data-param]');
      $$('button', seg).forEach((b) => b.classList.toggle('is-on', b === t));
      setParam(seg.dataset.param, t.dataset.pv === '' ? '' : JSON.parse(t.dataset.pv));
      return;
    }
    if (t.dataset.rm) {
      const inp = inputsOf(kind);
      if (t.dataset.slot === 'input_images') inp.input_images = inp.input_images.filter((x) => x !== t.dataset.rm); else inp[t.dataset.slot] = '';
      persist(); renderInputs(kind, S.detail.get(S.models[kind])); requestQuote(); return;
    }
    if (t.dataset.loadPrompt) {
      const p = (S.cfg?.prompts || []).find((x) => x.name === t.dataset.loadPrompt);
      if (p) { $('#promptBox').value = p.text; S.prompts[kind] = p.text; persist(); paintPromptCount(); requestQuote(); }
      return;
    }
    if (t.dataset.rmChatimg) { S.chatImgs = S.chatImgs.filter((x) => x !== t.dataset.rmChatimg); paintChatAttach(); return; }
    const act = t.dataset.act;
    if (act === 'pick-model') openModelPicker(kind);
    if (act === 'model-info') { S.catSel = S.models[kind]; const m = modelById(S.catSel); if (m) S.catF = m.type; setMode('modelos'); }
    if (act === 'add-input') openAssetPicker('Elegir imagen', ['image'], (id) => addInput(kind, t.dataset.slot, id));
    if (act === 'up-input') pickFiles({ kind, slot: t.dataset.slot, accept: 'image/*' });
    if (act === 'piece-input') addInput(kind, t.dataset.slot, S.piece);
    if (act === 'pick-source') openAssetPicker('Audio o video', ['audio', 'video'], (id) => { S.source = id; paintSource(); requestQuote(); persist(); });
    if (act === 'up-source') pickFiles({ source: true, accept: 'audio/*,video/*' });
    if (act === 'chat-img') openAssetPicker('Imagen para el chat', ['image'], (id) => { if (!S.chatImgs.includes(id)) S.chatImgs.push(id); paintChatAttach(); });
    if (act === 'new-chat') { S.chat.messages = []; persist(); renderThread(); renderCompose(); }
    if (act === 'reset-params') { S.params[S.models[kind]] = {}; persist(); renderParams(kind, S.detail.get(S.models[kind])); requestQuote(); }
    if (act === 'save-prompt') {
      const text = $('#promptBox').value.trim();
      if (!text) return toast('El prompt está vacío.', 'bad');
      const name = prompt('Nombre para este prompt:', text.slice(0, 28));
      if (!name) return;
      try { await api('/api/prompt', { name, text, kind }); await refreshLibrary(); paintPromptChips(); toast('Prompt guardado.'); } catch (err) { toast(err.message, 'bad'); }
    }
  });
  comp.addEventListener('input', (e) => {
    const t = e.target;
    const kind = curKind();
    if (t.id === 'promptBox') { S.prompts[kind] = t.value; persist(); paintPromptCount(); if (kind === 'speech') requestQuote(); else if (kind === 'chat') syncRun(); }
    if (t.id === 'chatSystem') { S.chat.system = t.value; persist(); }
    if (t.dataset.param && t.tagName !== 'SELECT') {
      clearTimeout(t._t);
      t._t = setTimeout(() => setParam(t.dataset.param, t.value, t.dataset.num), 350);
    }
  });
  comp.addEventListener('change', (e) => {
    const t = e.target;
    if (t.tagName === 'SELECT' && t.dataset.param) setParam(t.dataset.param, t.value === '' ? '' : JSON.parse(t.value));
  });
  comp.addEventListener('dragover', (e) => { const z = e.target.closest('.refs'); if (z) { e.preventDefault(); z.classList.add('is-over'); } });
  comp.addEventListener('dragleave', (e) => { const z = e.target.closest('.refs'); if (z) z.classList.remove('is-over'); });

  // mesa
  $('#pieceActs').addEventListener('click', (e) => { const t = e.target.closest('[data-act]'); if (t) pieceAction(t.dataset.act); });
  $('#view').addEventListener('click', (e) => { const t = e.target.closest('[data-act]'); if (t) pieceAction(t.dataset.act); });
  $('.empty-acts').addEventListener('click', (e) => { const t = e.target.closest('[data-act]'); if (t) pieceAction(t.dataset.act); });
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o && o.dataset.open && (o.closest('#dock') || o.closest('#jobsBody'))) {
      setPiece(o.dataset.open);
      if (!WORK.includes(S.mode) || S.mode === 'texto') setMode(S.lastWork === 'texto' ? 'imagen' : S.lastWork);
      if (o.closest('#jobsBody')) closeSheets();
    }
    const c = e.target.closest('[data-cancel]');
    if (c) api('/api/cancel', { id: c.dataset.cancel }).then((r) => toast(r.note)).catch((err) => toast(err.message, 'bad'));
  });
  $('#thread').addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy-msg]');
    if (b) navigator.clipboard.writeText(S.chat.messages[+b.dataset.copyMsg]?.content || '').then(() => toast('Copiado.'));
  });

  // biblioteca
  $('#libFilters').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { S.libF = b.dataset.f; renderLibrary(); } });
  $('#libSearch').addEventListener('input', (e) => { S.libQ = e.target.value; renderLibrary(); });
  $('#libScroll').addEventListener('click', (e) => {
    const c = e.target.closest('[data-sel]');
    if (!c) return;
    S.libSel = c.dataset.sel;
    $$('#libScroll .card').forEach((x) => x.classList.toggle('is-sel', x.dataset.sel === S.libSel));
    renderFicha();
    if (NARROW()) $('#side').scrollIntoView({ behavior: 'smooth' });
  });
  $('#libScroll').addEventListener('dblclick', (e) => { const c = e.target.closest('[data-sel]'); if (c) { setPiece(c.dataset.sel); setMode(S.lastWork === 'texto' ? 'imagen' : S.lastWork); } });
  $('#ficha').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const a = assetById(S.libSel);
    if (!a) return;
    if (t.dataset.copy) navigator.clipboard.writeText(a.prompt).then(() => toast('Prompt copiado.'));
    const f = t.dataset.fact;
    if (!f) return;
    if (f === 'del') return deleteAssets([a.id]);
    S.piece = a.id;
    if (f === 'desk') { setMode(['audio', 'video'].includes(a.media) ? (a.media === 'video' ? 'video' : 'audio') : S.lastWork === 'texto' ? 'imagen' : S.lastWork); return; }
    pieceAction(f);
  });

  // modelos
  document.addEventListener('click', (e) => { if (e.target.closest('[data-nsfw]')) setNsfw(!S.settings.nsfw); });
  $('#catFilters').addEventListener('click', (e) => { const b = e.target.closest('[data-catf]'); if (b) { S.catF = b.dataset.catf; S.catLimit = 120; renderCatalog(); } });
  $('#catFilters').addEventListener('change', (e) => { if (e.target.id === 'catSort') { S.catSort = e.target.value; renderCatalog(); } });
  $('#catRefresh').onclick = async () => {
    const b = $('#catRefresh'); b.disabled = true;
    try { await loadCatalog(true); renderCatalog(); toast(`Catálogo al día: ${S.cat.models.length} modelos.`); }
    catch (e) { toast(e.message, 'bad'); }
    b.disabled = false;
  };
  $('#catSearch').addEventListener('input', (e) => { S.catQ = e.target.value; S.catLimit = 120; renderCatalog(); });
  $('#catScroll').addEventListener('click', (e) => {
    if (e.target.id === 'catMore') { S.catLimit += 120; renderCatalog(); return; }
    const tr = e.target.closest('[data-model]');
    if (!tr) return;
    S.catSel = tr.dataset.model;
    $$('#catScroll tr[data-model]').forEach((x) => x.classList.toggle('is-sel', x.dataset.model === S.catSel));
    renderModelPanel();
    if (NARROW()) $('#side').scrollIntoView({ behavior: 'smooth' });
  });
  $('#modelPanel').addEventListener('click', (e) => {
    const u = e.target.closest('[data-use-model]');
    if (u) useModel(u.dataset.useModel);
    const c = e.target.closest('[data-copy-id]');
    if (c) navigator.clipboard.writeText(c.dataset.copyId).then(() => toast('Id copiado.'));
  });

  // selector de modelo
  $('#pickSearch').addEventListener('input', renderPicker);
  $('#pickFilters').addEventListener('click', (e) => { const b = e.target.closest('[data-pf]'); if (b) { S.pickF = b.dataset.pf; renderPicker(); } });
  $('#pickFilters').addEventListener('change', (e) => { if (e.target.id === 'pickSort') { S.pickSort = e.target.value; renderPicker(); } });
  $('#pickBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    S.models[S.pickKind] = b.dataset.pick;
    S.quote = null; S.quoteErr = ''; S.quoteKey = '';
    persist(); closeSheets();
    if (curKind() === S.pickKind) renderCompose();
  });
  $('#assetSearch').addEventListener('input', renderAssetPicker);
  $('#assetGrid').addEventListener('click', (e) => { const b = e.target.closest('[data-apick]'); if (b && ASSET_PICK) { ASSET_PICK.onPick(b.dataset.apick); closeSheets(); } });

  // gasto
  $('#useRefresh').onclick = () => renderUsage(true);
  $('#useCsv').onclick = exportCsv;
  $('#useScroll').addEventListener('click', async (e) => {
    if (e.target.id !== 'capSave') return;
    try {
      const r = await api('/api/settings', { max_cost: $('#capIn').value === '' ? null : parseFloat($('#capIn').value), nsfw: $('#nsfwIn').checked });
      S.settings = r.settings; toast('Ajustes guardados.'); renderUsage();
    } catch (err) { toast(err.message, 'bad'); }
  });

  // arrastrar y soltar
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { depth++; $('#dropover').hidden = false; } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('#dropover').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; $('#dropover').hidden = true;
    $$('.refs.is-over').forEach((z) => z.classList.remove('is-over'));
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    const zone = e.target.closest?.('.refs[data-drop]');
    uploadFiles(files, zone ? { kind: curKind(), slot: zone.dataset.drop } : dropTarget(files));
  });

  // teclado
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); return; }
    if (e.key === 'Escape') { closeSheets(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-7]$/.test(e.key)) setMode(MODES[+e.key - 1]);
    else if (e.key === 'u' || e.key === 'U') pickFiles('library');
    else if ((e.key === 'm' || e.key === 'M') && curKind()) openModelPicker(curKind());
    else if (e.key === '?') openSheet('helpSheet');
    else if (e.key === '/') { e.preventDefault(); const el = S.mode === 'modelos' ? $('#catSearch') : (setMode('biblioteca'), $('#libSearch')); el.focus(); }
  });
  window.addEventListener('resize', placeRailInd);
}

/* --------------------------------------------------------------------- init */
async function init() {
  bind();
  try {
    const cfg = await api('/api/config');
    S.settings = cfg.settings || S.settings;
    S.cfg = { ...cfg, prompts: [] };
    if (!cfg.has_key) toast('No encuentro la API key de MartLLM (martllm-key en el .env).', 'bad');
  } catch (e) { toast(e.message, 'bad'); }
  const qm = new URLSearchParams(location.search).get('m');
  setMode(qm && MODES.includes(qm) ? qm : S.mode, { silent: true });
  await Promise.allSettled([refreshLibrary(), loadUsage(), refreshBalance(false)]);
  try { await loadCatalog(); } catch (e) { toast('Catálogo: ' + e.message, 'bad'); }
  try {
    const r = await api('/api/jobs');
    S.jobs = r.jobs;
    for (const j of r.jobs) if (TERMINAL.has(j.status)) S.seen.add(j.id);
    paintJobsPill(r.inflight);
    if (r.inflight) ensurePolling();
  } catch {}
  setMode(S.mode, { silent: true });
  setInterval(() => refreshBalance(false), 60000);
  setInterval(() => { if (S.jobs.some((j) => !TERMINAL.has(j.status))) renderSlots(); }, 1000);
}
init();
