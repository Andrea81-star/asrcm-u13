/* ═══════════════════════════════════════════════════════════════════
   FIREBASE SYNC — ASRCM U13
   Sostituisce la persistenza localStorage con Firestore in tempo reale.
   - Ogni persist() dell'app scrive anche su Firestore (debounce 400 ms)
   - onSnapshot aggiorna l'app in tempo reale su tutti i dispositivi
   - localStorage resta come cache offline (fallback)
   Deve essere caricato DOPO lo script principale dell'app.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (!window.firebase || !window.FIREBASE_CONFIG) {
    console.error('[sync] Firebase SDK o firebase-config.js non caricati.');
    return;
  }
  if (typeof window.saveData !== 'function' || typeof window.TEAMS !== 'object') {
    console.error('[sync] App non pronta: firebase-sync.js deve stare DOPO lo script dell\'app.');
    return;
  }

  var CFG  = window.FIREBASE_DOC || { collection: 'asrcm', doc: 'u13' };
  var app  = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
  var db   = firebase.firestore();
  var DOC  = db.collection(CFG.collection).doc(CFG.doc);

  var applyingRemote = false;   // evita il loop scrittura↔lettura
  var saveTimer      = null;
  var seeded         = false;

  /* ── Indicatore di stato (pallino in alto a destra) ────────────── */
  var dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;top:8px;right:8px;width:9px;height:9px;border-radius:50%;' +
                      'background:#bbb;z-index:99999;transition:background .3s;box-shadow:0 0 0 2px rgba(255,255,255,.7)';
  dot.title = 'Firebase : connexion…';
  document.body.appendChild(dot);
  function status(color, label) { dot.style.background = color; dot.title = 'Firebase : ' + label; }

  /* ── Lettura dello stato corrente dell'app ─────────────────────── */
  function snapshotLocal() {
    var out = { pwds: window.pwds, teams: {}, updatedAt: Date.now() };
    for (var k in window.TEAMS) {
      out.teams[k] = {
        players: window.TEAMS[k].players,
        matches: window.TEAMS[k].matches,
        notifs:  window.TEAMS[k].notifs
      };
    }
    return JSON.parse(JSON.stringify(out)); // ripulisce undefined per Firestore
  }

  /* ── Applicazione dei dati remoti all'app ──────────────────────── */
  function applyRemote(data) {
    if (!data) return;
    applyingRemote = true;
    try {
      if (data.pwds) {
        window.pwds.admin   = data.pwds.admin   || window.pwds.admin;
        window.pwds.visitor = data.pwds.visitor || window.pwds.visitor;
      }
      if (data.teams) {
        for (var k in window.TEAMS) {
          var s = data.teams[k];
          if (!s) continue;
          if (Array.isArray(s.players)) window.TEAMS[k].players = s.players;
          if (Array.isArray(s.matches)) window.TEAMS[k].matches = s.matches;
          if (Array.isArray(s.notifs))  window.TEAMS[k].notifs  = s.notifs;
        }
      }
      window.bindTeamData();
      window.updateTeamUI();

      var main = document.getElementById('S-main');
      if (main && main.classList.contains('on')) {
        try { window.initMain(); } catch (e) { console.warn('[sync] initMain:', e); }
      }

      try { localStorage.setItem(window.STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
    } finally {
      applyingRemote = false;
    }
  }

  /* ── Override di saveData : locale + Firestore ─────────────────── */
  var origSave = window.saveData;
  window.saveData = function () {
    try { origSave(); } catch (e) {}
    if (applyingRemote) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      DOC.set(snapshotLocal())
        .then(function () { status('#2E7D32', 'synchronisé'); })
        .catch(function (e) { status('#CC1020', 'erreur écriture'); console.error('[sync] write:', e); });
    }, 400);
  };

  /* ── Autenticazione anonima ────────────────────────────────────────
     Le regole Firestore richiedono una sessione autenticata. L'app apre
     da sola una sessione anonima: l'utente non se ne accorge.
     Se in Console non e stato abilitato il metodo "Anonyme", proseguo
     comunque: con regole aperte l'app continua a funzionare.          */
  function connect() {
    if (connected) return;
    connected = true;
    startListening();
  }
  var connected = false;

  if (firebase.auth) {
    firebase.auth().onAuthStateChanged(function (user) {
      if (user) { console.log('[sync] sessione anonima attiva'); connect(); }
    });
    firebase.auth().signInAnonymously().catch(function (e) {
      console.warn('[sync] autenticazione anonima non riuscita:', e.code || e);
      if (e && e.code === 'auth/operation-not-allowed') {
        console.warn('[sync] abilita "Anonyme" in Firebase Console → Authentication → Sign-in method');
      }
      connect();   // tentativo comunque, utile con regole aperte
    });
  } else {
    console.warn('[sync] SDK Auth non caricato: connessione diretta a Firestore');
    connect();
  }

  /* ── Ascolto in tempo reale ────────────────────────────────────── */
  function startListening() {
  DOC.onSnapshot(function (snap) {
    if (snap.exists) {
      seeded = true;
      applyRemote(snap.data());
      status('#2E7D32', 'synchronisé');
      console.log('[sync] dati ricevuti da Firestore');
    } else if (!seeded) {
      seeded = true;
      console.log('[sync] documento assente — invio dati iniziali');
      DOC.set(snapshotLocal())
        .then(function () { status('#2E7D32', 'initialisé'); })
        .catch(function (e) { status('#CC1020', 'erreur init'); console.error('[sync] seed:', e); });
    }
  }, function (err) {
    status('#CC1020', 'hors ligne');
    console.error('[sync] onSnapshot:', err);
    if (err && err.code === 'permission-denied') {
      console.error('[sync] Regole Firestore: accesso rifiutato. '
        + 'Verifica di aver abilitato "Anonyme" in Authentication e pubblicato firestore.rules.');
    }
  });
  }

  /* ── Diagnostica da console ────────────────────────────────────── */
  window.fbDebug = {
    read:  function () { return DOC.get().then(function (s) { console.log(s.exists ? s.data() : 'documento inesistente'); }); },
    write: function () { return DOC.set(snapshotLocal()).then(function () { console.log('scrittura OK'); }); },
    local: snapshotLocal
  };

  console.log('[sync] Firebase attivo →', CFG.collection + '/' + CFG.doc);
})();
