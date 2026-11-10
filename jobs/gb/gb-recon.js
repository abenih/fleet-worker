// GB-RECON: bounded probe — can a candidate penalty title launch in
// logged-out demo from the Codespace (US) egress? Loads the 1win mirror
// play page, records network hosts/paths (NO query values, NO tokens),
// screenshots, frame texts; clicks the demo gate-card / stay-in-demo
// controls only. NEVER clicks login ("Войти"/"Log in"/"Sign in").
const fs = require('fs');
const { launch, ev, shot, click, sleep, log, frameTexts, dismissDemo, findDemoBtn } = require('./cdp');
const DIR = process.env.GB_OUT || '/home/codespace/gb-work';
const TAG = process.env.GB_TAG || 'recon';
fs.mkdirSync(DIR + '/shots', { recursive: true });
const URL = process.env.GB_URL;
if (!URL) { console.error('GB_URL required'); process.exit(2); }
const net = [];
function cleanUrl(u) {
  try { const x = new URL(u); return x.protocol + '//' + x.host + x.pathname + (x.search ? '?[' + [...x.searchParams.keys()].join(',') + ']' : ''); }
  catch { return String(u).slice(0, 160); }
}
(async () => {
  const { proc, s, S } = await launch();
  s.on((m) => {
    if (m.method === 'Network.requestWillBeSent') net.push({ t: Date.now(), kind: 'req', method: m.params.request.method, url: cleanUrl(m.params.request.url) });
    if (m.method === 'Network.responseReceived') net.push({ t: Date.now(), kind: 'res', status: m.params.response.status, url: cleanUrl(m.params.response.url) });
    if (m.method === 'Network.webSocketCreated') net.push({ t: Date.now(), kind: 'ws-open', url: cleanUrl(m.params.url) });
    if (m.method === 'Network.webSocketFrameSent') net.push({ t: Date.now(), kind: 'ws-send', data: String(m.params.response.payloadData).slice(0, 400) });
    if (m.method === 'Network.webSocketFrameReceived') net.push({ t: Date.now(), kind: 'ws-recv', data: String(m.params.response.payloadData).slice(0, 400) });
  });
  log('nav', URL);
  await S('Page.navigate', { url: URL }).catch((e) => log('nav err', e.message));
  let clickedGate = false, clickedStay = false;
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    const ft = await frameTexts(s);
    const joined = ft.map((f) => f.text).join(' ');
    log('poll', i, 'frames', ft.length, 'textlen', joined.length, JSON.stringify(joined.replace(/\s+/g, ' ').slice(0, 160)));
    if (i === 1 || i === 5 || i === 11) await shot(S, `${DIR}/shots/${TAG}-poll${i}.png`).catch(() => {});
    if (!clickedStay) {
      const stay = await dismissDemo(S);
      if (stay && stay.t && /демо|demo/i.test(stay.t)) { clickedStay = true; log('click stay-in-demo', JSON.stringify(stay)); await click(S, stay.x, stay.y); await sleep(5000); await shot(S, `${DIR}/shots/${TAG}-after-stay.png`).catch(() => {}); continue; }
    }
    if (!clickedGate) {
      const gate = await findDemoBtn(S);
      if (gate) { clickedGate = true; log('click demo gate-card', JSON.stringify(gate)); await click(S, gate.x, gate.y); await sleep(6000); await shot(S, `${DIR}/shots/${TAG}-after-gate.png`).catch(() => {}); }
    }
  }
  const ft = await frameTexts(s);
  fs.writeFileSync(DIR + `/${TAG}-frames.json`, JSON.stringify(ft, null, 1));
  fs.writeFileSync(DIR + `/${TAG}-net.json`, JSON.stringify(net, null, 1));
  await shot(S, `${DIR}/shots/${TAG}-final.png`).catch(() => {});
  log('net entries', net.length);
  proc.kill('SIGKILL');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
