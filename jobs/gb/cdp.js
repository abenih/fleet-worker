// Minimal CDP driver for the bustwin step-1 sessions (2026-11-06).
// Written fresh for this task, following the programme's established
// Arch-PC pattern: spawn chrome-headless-shell, drive via /json/version WS.
// Env: BW_CHROME, BW_PORT, BW_PROFILE, BW_PROXY ('none'/unset = direct),
//      BW_SIZE (e.g. '1280,900' or '360,640'), BW_MOBILE ('1' = touch emulation),
//      BW_UA (user-agent override — needed for Spribe demos, not for 1win).
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = process.env.BW_CHROME || '/home/benji/capture-tools/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = parseInt(process.env.BW_PORT || '9611', 10);
const PROFILE = process.env.BW_PROFILE || '/tmp/chrome-1win-bustwin';
const PROXY = process.env.BW_PROXY ? process.env.BW_PROXY : null;
const SIZE = process.env.BW_SIZE || '1280,900';
const MOBILE = process.env.BW_MOBILE === '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

async function fetchJson(url) { const r = await fetch(url); return r.json(); }

class Sess {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0; this.pending = new Map(); this.listeners = [];
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
      } else if (m.method) { for (const f of this.listeners) f(m); }
    });
    const drop = () => { for (const p of this.pending.values()) p.reject(new Error('ws closed')); this.pending.clear(); };
    this.ws.addEventListener('close', drop); this.ws.addEventListener('error', drop);
  }
  ready() { return new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', rej, { once: true }); }); }
  send(method, params = {}, timeoutMs = 45000, sessionId) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout ' + method)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }
  on(fn) { this.listeners.push(fn); }
}

async function launch(extraArgs = []) {
  const args = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-sandbox', '--disable-gpu', '--lang=en-US', `--window-size=${SIZE}`,
    '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors', '--mute-audio', ...extraArgs];
  if (PROXY) args.push(`--proxy-server=${PROXY}`);
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', () => {});
  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await fetchJson(`http://127.0.0.1:${PORT}/json/version`); break; }
    catch { await sleep(1000); }
  }
  if (!ver) throw new Error('chrome devtools never answered');
  const s = new Sess(ver.webSocketDebuggerUrl);
  await s.ready();
  const { targetId } = await s.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await s.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p, t) => s.send(m, p, t, sessionId);
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
  if (process.env.BW_UA) {
    await S('Emulation.setUserAgentOverride', { userAgent: process.env.BW_UA }).catch(() => {});
  }
  if (MOBILE) {
    const [w, h] = SIZE.split(',').map(Number);
    await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  return { proc, s, S, sessionId };
}

// Evaluate in the main session; returns value or undefined on error.
async function ev(S, expr) {
  try {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 25000);
    if (r.exceptionDetails) return undefined;
    return r.result ? r.result.value : undefined;
  } catch { return undefined; }
}

async function shot(S, path) {
  const r = await S('Page.captureScreenshot', { format: 'png' }, 30000);
  fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
  return r.data.length;
}

async function click(S, x, y, opts = {}) {
  const holdMs = opts.holdMs || 0;
  if (MOBILE) {
    await S('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    if (holdMs) await sleep(holdMs);
    await S('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  if (holdMs) await sleep(holdMs);
  await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

// Attach to an iframe (OOPIF) target whose URL matches `match`; returns session fn or null.
async function attachIframe(s, match) {
  const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`).catch(() => []);
  const t = targets.find((x) => (x.type === 'iframe' || x.type === 'page') && x.url && x.url.includes(match));
  if (!t) return null;
  const { sessionId } = await s.send('Target.attachToTarget', { targetId: t.id, flatten: true });
  const S2 = (m, p, tm) => s.send(m, p, tm, sessionId);
  await S2('Runtime.enable').catch(() => {});
  await S2('Page.enable').catch(() => {});
  return { S2, sessionId, url: t.url };
}

// Dump visible text of every frame target (page + iframes).
async function frameTexts(s) {
  const out = [];
  let targets = [];
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch {}
  for (const t of targets) {
    if (t.type !== 'iframe' && t.type !== 'page') continue;
    if (!t.url || t.url === 'about:blank') continue;
    try {
      const { sessionId } = await s.send('Target.attachToTarget', { targetId: t.id, flatten: true });
      const S2 = (m, p, tm) => s.send(m, p, tm, sessionId);
      await S2('Runtime.enable').catch(() => {});
      const txt = await ev(S2, `(document.body ? (document.body.innerText || '') : '').slice(0, 5000)`);
      out.push({ url: t.url.slice(0, 200), text: txt || '' });
    } catch (e) { out.push({ url: t.url.slice(0, 200), text: 'ATTACH-ERR ' + e.message }); }
  }
  return out;
}

// Dismiss the 1win "You're in demo mode" modal: click a confirm/close control (bilingual).
// B2 lesson: this shell variant's modal offers "Войти" (log in — NEVER click)
// vs "Остаться в демо" (stay in demo) — the stay button is the first choice.
async function dismissDemo(S) {
  return ev(S, `(() => {
    const words = ['Остаться в демо', 'Stay in demo', 'OK', 'Ок', 'Понятно', 'Close', 'Закрыть', 'Хорошо', 'Got it'];
    const els = [...document.querySelectorAll('button,div,span,a')].filter(e => e.offsetParent !== null && !/войти/i.test(e.textContent || '') || (e.textContent || '').trim() === 'Остаться в демо');
    for (const w of words) {
      const hits = els.filter(e => (e.textContent || '').trim() === w)
        .map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, t: w }; })
        .filter(h => h.w < 260);
      if (hits.length) return hits[0];
    }
    return null;
  })()`);
}

// Find the demo-mode GATE-CARD button on a play page (bilingual).
// Session B1 lesson: a loose regex matched the card's container DIV whose
// centre falls in the gap between "Log in" and "Demo mode" — clicks died.
// Now: leaf elements whose trimmed text is EXACTLY the demo label, narrow
// width, below the header band; lowest match wins (the card, not the
// header toggle label).
async function findDemoBtn(S) {
  return ev(S, `(() => {
    const labels = ['Демо-режим', 'Demo mode', 'Demo-mode', 'ДЕМО-РЕЖИМ'];
    const els = [...document.querySelectorAll('button,div,span,a')].filter(e => e.offsetParent !== null);
    const hits = els.filter(e => labels.includes((e.textContent || '').trim()))
      .map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, t: (e.textContent || '').trim(), tag: e.tagName }; })
      .filter(h => h.y > 200 && h.w < 220);
    if (!hits.length) return null;
    hits.sort((a, b) => b.y - a.y);
    return hits[0];
  })()`);
}

module.exports = { launch, ev, shot, click, sleep, log, attachIframe, frameTexts, dismissDemo, findDemoBtn, PORT, MOBILE };
