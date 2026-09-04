/* ═══════════════════════════════════════════════════════════════════
   SERVICE WORKER — ASRCM U13
   Strategia:
   · Pagina e script dell'app  → rete per prima, cache come riserva
     (così un nuovo deploy su Netlify arriva subito)
   · Icone e risorse statiche  → cache per prima (veloci e stabili)
   · Firebase e Firestore      → sempre rete, mai in cache
   ═══════════════════════════════════════════════════════════════════ */

// ⚠️ Cambia questo numero a ogni aggiornamento dell'app:
// forza la cancellazione delle vecchie cache su tutti i dispositivi.
const CACHE = 'asrcm-u13-v6';

const APP_SHELL = [
  './',
  './index.html',
  './firebase-config.js',
  './firebase-sync.js',
  './firebase-push.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

/* ── Installazione : precarico l'app ─────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll fallisce in blocco se un file manca: li aggiungo uno a uno
      .then((cache) => Promise.all(
        APP_SHELL.map((url) => cache.add(url).catch((e) => {
          console.warn('[sw] impossibile mettere in cache', url, e);
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

/* ── Attivazione : elimino le cache delle versioni precedenti ────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Intercettazione delle richieste ─────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo GET: le scritture non si mettono mai in cache
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Firebase, Firestore e Google: sempre dalla rete, mai intercettati.
  // Firestore usa connessioni persistenti che la cache romperebbe.
  if (/googleapis\.com|gstatic\.com|firebaseio\.com|firebaseapp\.com|google\.com/.test(url.hostname)) {
    return;
  }

  // Domini esterni non gestiti (CDN di font o icone): lascio fare al browser
  if (url.origin !== self.location.origin) return;

  const isAppFile = req.mode === 'navigate' ||
                    /\.(html|js|json)$/.test(url.pathname) ||
                    url.pathname.endsWith('/');

  if (isAppFile) {
    // RETE PER PRIMA — l'utente vede sempre l'ultima versione pubblicata
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('./index.html'))
        )
    );
  } else {
    // CACHE PER PRIMA — icone e immagini non cambiano
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════
   NOTIFICHE PUSH
   Il messaggio arriva da Firebase Cloud Messaging, inviato dalla
   funzione programmata su Netlify. Qui viene solo mostrato.
   ═══════════════════════════════════════════════════════════════════ */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    const raw = event.data ? event.data.json() : {};
    payload = raw.data || raw.notification || raw;
  } catch (e) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'ASRCM U13';
  const body  = payload.body  || 'Nouvelles mises à jour disponibles';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      // tag + renotify: una sola notifica alla volta, sostituita se ne arriva un'altra
      tag: 'asrcm-maj',
      renotify: true,
      data: { url: './index.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Se l'app e gia aperta, la porto in primo piano invece di duplicarla.
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

/* ── Aggiornamento forzato su richiesta della pagina ─────────────── */
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
