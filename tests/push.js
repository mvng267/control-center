// Test Web Push server-side THẬT không cần push service ngoài:
// 1. Spawn dashboard (port test, push-state riêng qua env PUSH_STATE_FILE)
// 2. Giả lập browser: keypair ECDH P-256 + auth secret, subscribe với endpoint local
// 3. Fake push service local nhận POST -> verify VAPID JWT (chữ ký ES256, aud, exp)
//    + giải mã aes128gcm theo RFC 8291 -> payload phải khớp
// 4. Check /sw.js có push + notificationclick handler
// Usage: node push-test.js
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const DASH_PORT = 7797;
const PUSHSVC_PORT = 7796;
const BASE = 'http://127.0.0.1:' + DASH_PORT;
const STATE_FILE = path.join(__dirname, '.push-state.test.json');

const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
};
const b64u = buf => Buffer.from(buf).toString('base64url');

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {} }, res => {
      let buf = '';
      res.on('data', d => { buf += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    r.on('error', reject);
    r.end(body ? JSON.stringify(body) : undefined);
  });
}

(async () => {
  try { fs.unlinkSync(STATE_FILE); } catch {}

  // ---- fake push service: bắt request push từ dashboard ----
  let captured = null;
  let captureResolve = null;
  const pushSvc = http.createServer((rq, rs) => {
    const chunks = [];
    rq.on('data', c => chunks.push(c));
    rq.on('end', () => {
      captured = { headers: rq.headers, body: Buffer.concat(chunks), url: rq.url };
      rs.writeHead(201);
      rs.end();
      if (captureResolve) captureResolve();
    });
  });
  await new Promise(r => pushSvc.listen(PUSHSVC_PORT, '127.0.0.1', r));

  // ---- spawn dashboard ----
  const dash = spawn('node', [path.join(__dirname, '..', 'src', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(DASH_PORT), PUSH_STATE_FILE: STATE_FILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let dashErr = '';
  dash.stderr.on('data', d => { dashErr += d; });
  // đợi server lên
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    await new Promise(r => setTimeout(r, 200));
    try { up = (await req('GET', BASE + '/api/push/vapid')).status === 200; } catch {}
  }
  ok('dashboard khởi động (PORT=' + DASH_PORT + ')', up, dashErr.slice(0, 200));
  if (!up) { dash.kill(); process.exit(1); }

  // ---- VAPID key: sinh ra + persist đúng format ----
  const vap = JSON.parse((await req('GET', BASE + '/api/push/vapid')).body);
  const vapidPub = Buffer.from(vap.key || '', 'base64url');
  ok('VAPID public key 65B uncompressed (0x04...)', vapidPub.length === 65 && vapidPub[0] === 4, vap.key && vap.key.slice(0, 20) + '...');
  const persisted = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  ok('VAPID keys persist vào state file', persisted.publicKey === vap.key && !!persisted.privateKey);

  // ---- sw.js có push handlers ----
  const sw = (await req('GET', BASE + '/sw.js')).body;
  ok('sw.js có push + notificationclick handler', sw.includes("addEventListener('push'") && sw.includes("addEventListener('notificationclick'"));

  // ---- giả lập browser: keypair + subscribe ----
  const ua = crypto.createECDH('prime256v1');
  const uaPub = ua.generateKeys();
  const authSecret = crypto.randomBytes(16);
  const endpoint = 'http://127.0.0.1:' + PUSHSVC_PORT + '/push/v2/fake-sub-token';
  const subResp = JSON.parse((await req('POST', BASE + '/api/push/subscribe', {
    endpoint, keys: { p256dh: b64u(uaPub), auth: b64u(authSecret) },
  })).body);
  ok('subscribe OK (subs=1)', subResp.ok === true && subResp.subs === 1, JSON.stringify(subResp));

  // subscribe thiếu keys phải bị 400
  const bad = await req('POST', BASE + '/api/push/subscribe', { endpoint: 'https://x.test/e' });
  ok('subscribe thiếu keys -> 400', bad.status === 400);

  // ---- gửi push test ----
  const waitPush = new Promise(r => { captureResolve = r; });
  const sendResp = JSON.parse((await req('POST', BASE + '/api/push/send', {
    title: 'Test Push', body: 'Xin chào từ server 🚀',
  })).body);
  ok('/api/push/send: sent=1/1', sendResp.ok === true && sendResp.sent === 1 && sendResp.total === 1, JSON.stringify(sendResp.results));
  await Promise.race([waitPush, new Promise(r => setTimeout(r, 3000))]);
  ok('push service nhận được request', !!captured);

  if (captured) {
    const h = captured.headers;
    ok('header Content-Encoding: aes128gcm', h['content-encoding'] === 'aes128gcm');
    ok('header TTL', !!h.ttl);

    // ---- verify VAPID JWT ----
    const auth = String(h.authorization || '');
    const mT = auth.match(/^vapid t=([^,]+), k=(.+)$/);
    ok('Authorization: vapid t=..., k=...', !!mT);
    if (mT) {
      ok('k khớp VAPID public key', mT[2] === vap.key);
      const [jh, jp, js] = mT[1].split('.');
      const claims = JSON.parse(Buffer.from(jp, 'base64url').toString());
      ok('JWT aud = origin push service', claims.aud === 'http://127.0.0.1:' + PUSHSVC_PORT, claims.aud);
      ok('JWT exp trong tương lai (<=24h)', claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400);
      const pubKeyObj = crypto.createPublicKey({
        format: 'jwk',
        key: { kty: 'EC', crv: 'P-256', x: b64u(vapidPub.subarray(1, 33)), y: b64u(vapidPub.subarray(33, 65)) },
      });
      const sigOk = crypto.verify('sha256', Buffer.from(jh + '.' + jp),
        { key: pubKeyObj, dsaEncoding: 'ieee-p1363' }, Buffer.from(js, 'base64url'));
      ok('JWT chữ ký ES256 hợp lệ', sigOk);
    }

    // ---- giải mã aes128gcm (RFC 8291) như browser thật ----
    try {
      const body = captured.body;
      const salt = body.subarray(0, 16);
      const rs = body.readUInt32BE(16);
      const idlen = body[20];
      const asPub = body.subarray(21, 21 + idlen);
      const cipher = body.subarray(21 + idlen);
      ok('body header: rs=4096, keyid=65B', rs === 4096 && idlen === 65);
      const shared = ua.computeSecret(asPub);
      const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]);
      const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
      const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(cipher.subarray(cipher.length - 16));
      const pt = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
      // strip padding: ...payload 0x02 [0x00...]
      let i = pt.length - 1;
      while (i >= 0 && pt[i] === 0) i--;
      ok('padding delimiter 0x02', pt[i] === 2);
      const payload = JSON.parse(pt.subarray(0, i).toString());
      ok('payload giải mã khớp (title+body)', payload.title === 'Test Push' && payload.body === 'Xin chào từ server 🚀', JSON.stringify(payload));
    } catch (e) {
      ok('giải mã aes128gcm', false, e.message);
    }
  }

  // ---- unsubscribe ----
  const un = JSON.parse((await req('POST', BASE + '/api/push/unsubscribe', { endpoint })).body);
  ok('unsubscribe OK (subs=0)', un.ok === true && un.subs === 0);

  dash.kill();
  pushSvc.close();
  try { fs.unlinkSync(STATE_FILE); } catch {}
  const pass = results.filter(r => r.pass).length;
  console.log('\n== PUSH TEST: ' + pass + '/' + results.length + ' PASS ==');
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
