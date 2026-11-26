/* Service worker for Study & Quran Timer.
   Put it in the SAME folder as study-quran-timer.html. Works on https or localhost (Live Server). */
const SHELL = 'sq-shell-v2', AUDIO = 'sq-audio', FONT = 'sq-fonts';
const PAGE = new URL(self.location.href).searchParams.get('page') || './';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => c.add(PAGE)).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sq-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* serve a cached full file as a 206 when the audio element asks for a byte range */
async function ranged(req, res) {
  const h = req.headers.get('range');
  if (!h || !res || res.status !== 200) return res;
  const m = /bytes=(\d*)-(\d*)/.exec(h); if (!m) return res;
  const blob = await res.blob(), size = blob.size;
  const s = m[1] === '' ? Math.max(0, size - +m[2]) : +m[1];
  const e = (m[1] === '' || m[2] === '') ? size - 1 : Math.min(+m[2], size - 1);
  if (s >= size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(blob.slice(s, e + 1), { status: 206, statusText: 'Partial Content', headers: {
    'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg', 'Content-Range': 'bytes ' + s + '-' + e + '/' + size,
    'Content-Length': String(e - s + 1), 'Accept-Ranges': 'bytes' } });
}
async function audio(req) {
  const c = await caches.open(AUDIO); let res = await c.match(req.url);
  if (!res) {
    try {
      const net = await fetch(req.url, { mode: 'cors' });
      if (!net.ok) return net;
      await c.put(req.url, net.clone()); res = net;
    } catch (err) { return fetch(req); }
  }
  return ranged(req, res);
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname === 'everyayah.com' && u.pathname.endsWith('.mp3')) { e.respondWith(audio(req)); return; }
  /* whole-surah files (mp3quran): only served from the offline cache once downloaded; otherwise normal network */
  if (u.hostname.endsWith('mp3quran.net') && u.pathname.endsWith('.mp3')) {
    e.respondWith(caches.open(AUDIO).then(async c => { const hit = await c.match(req.url); return hit ? ranged(req, hit) : fetch(req); }));
    return;
  }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  /* the page itself: network first (so edits show up), cache as the offline fallback */
  if (req.mode === 'navigate' && u.origin === self.location.origin) {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return r;
    }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || (await caches.match(PAGE, { ignoreSearch: true })) || Response.error()));
  }
});
