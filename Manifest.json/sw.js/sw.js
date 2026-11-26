// ==========================================
// PrepBox BD V2 — Smart Network-First Service Worker
// ==========================================
const CACHE_NAME = 'prepbox-bd-v2-shell-1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>অফলাইন — PrepBox BD</title>
  <style>
    body { margin:0; font-family: sans-serif; background:#0f172a; color:#f8fafc; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; text-align:center; }
    .card { max-width:340px; background:#1e293b; padding:28px 22px; border-radius:20px; border:1px solid #334155; }
    h1 { font-size:20px; margin:0 0 10px; color:#2dd4bf; }
    p { font-size:14px; color:#cbd5e1; line-height:1.6; margin:0 0 20px; }
    button { background:#0d9488; color:#fff; border:none; padding:12px 24px; border-radius:12px; font-size:14px; font-weight:700; cursor:pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>ইন্টারনেট সংযোগ নেই</h1>
    <p>PrepBox BD-এর প্রশ্নব্যাংক ও লাইভ পরীক্ষা লোড করতে ইন্টারনেট সংযোগ চালু করে আবার চেষ্টা করুন।</p>
    <button onclick="location.reload()">আবার চেষ্টা করুন</button>
  </div>
</body>
</html>`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API ও বাইরের সার্ভার (Supabase/CDN) সরাসরি নেটওয়ার্ক থেকে চলবে
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // মূল পেজ ও নিজের ফাইলগুলোর জন্য Network-First কৌশল
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          return new Response(OFFLINE_HTML, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        return new Response('', { status: 503, statusText: 'Offline' });
      })
  );
});