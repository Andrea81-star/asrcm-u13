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
const CACHE = 'asrcm-u13-v1';

const APP_SHELL = [
  './',
  './index.html',
  './firebase-config.js',
  './firebase-sync.js',
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

/* ── Aggiornamento forzato su richiesta della pagina ─────────────── */
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
