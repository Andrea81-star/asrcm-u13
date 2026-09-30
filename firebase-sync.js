/* ═══════════════════════════════════════════════════════════════════
   FIREBASE SYNC — ASRCM U13
   Sostituisce la persistenza localStorage con Firestore in tempo reale.

   PROTEZIONI CONTRO LA PERDITA DI DATI (obbligatorie, non opzionali)
   1. Nessuna scrittura prima della prima sincronizzazione.
      All'avvio l'app si carica da localStorage, che può essere vecchio.
      Finché il primo snapshot remoto non è arrivato e applicato, le
      modifiche restano locali: non si pubblica mai uno stato non
      confrontato con il cloud.
   2. Scrittura solo dentro una transazione, con controllo di revisione.
      Ogni documento porta un contatore "rev". Si scrive solo se il rev
      remoto è ancora quello che abbiamo letto: se qualcun altro ha
      scritto nel frattempo la scrittura viene rifiutata e i dati remoti
      ricaricati, invece di sovrascriverli. Le transazioni non vengono
      accodate offline, quindi nessuna scrittura vecchia può risvegliarsi
      giorni dopo.
   3. Ogni stato locale sostituito finisce nella cronologia (histPush),
      così nulla è mai perso senza rete di sicurezza.

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

  var REV_KEY      = 'asrcm_u13_rev_v1';   // ultima revisione remota vista
  var FIRST_WAIT   = 9000;                 // attesa max della 1a sincro (ms)
  var RETRY_MS     = 20000;                // nuovo tentativo se la rete manca

  /* ── Identificativo del dispositivo ──────────────────────────────
     Serve per tracciare chi ha scritto per ultimo. Resta nel browser,
     non identifica la persona.                                       */
  window.ASRCM_DEVICE_ID = (function () {
    try {
      var k = 'asrcm_device_id', v = localStorage.getItem(k);
      if (!v) { v = 'd' + Date.now() + Math.random().toString(36).slice(2, 8);
                localStorage.setItem(k, v); }
      return v;
    } catch (e) { return 'd-anon'; }
  })();

  var applyingRemote  = false;  // evita il loop scrittura↔lettura
  var saveTimer       = null;
  var retryTimer      = null;
  var seeded          = false;
  var syncReady       = false;  // ⬅ PROTEZIONE 1 : true dopo il 1° snapshot
  var pendingLocal    = false;  // modifiche locali non ancora pubblicate
  var warnedNotReady  = false;
  var inFlightRev     = 0;      // revisione che stiamo scrivendo in questo momento
  var lastSeenRev     = (function () {
    try { return Number(localStorage.getItem(REV_KEY)) || 0; } catch (e) { return 0; }
  })();

  function rememberRev(r) {
    lastSeenRev = Number(r) || 0;
    try { localStorage.setItem(REV_KEY, String(lastSeenRev)); } catch (e) {}
  }
  function say(msg) { try { if (window.toast) window.toast(msg); } catch (e) {} }
  function keepHistory(label) { try { if (window.histPush) window.histPush(label); } catch (e) {} }

  /* ── Indicatore di stato (pallino in alto a destra) ────────────── */
  var dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;top:8px;right:8px;width:9px;height:9px;border-radius:50%;' +
                      'background:#bbb;z-index:99999;transition:background .3s;box-shadow:0 0 0 2px rgba(255,255,255,.7)';
  dot.title = 'Firebase : connexion…';
  document.body.appendChild(dot);
  function status(color, label) { dot.style.background = color; dot.title = 'Firebase : ' + label; }

  /* ── Lettura dello stato corrente dell'app ─────────────────────── */
  // Senza il messaggio di notifica: usata anche per i confronti.
  function buildState() {
    var out = { pwds: window.pwds, teams: {}, updatedAt: Date.now(),
                lastEditor: window.ASRCM_DEVICE_ID };
    for (var k in window.TEAMS) {
      out.teams[k] = {
        players: window.TEAMS[k].players,
        matches: window.TEAMS[k].matches,
        notifs:  window.TEAMS[k].notifs,
        tournaments: window.TEAMS[k].tournaments || []
      };
    }
    return JSON.parse(JSON.stringify(out)); // ripulisce undefined per Firestore
  }
  /* Messaggio scritto dall'amministratore: e l'UNICA cosa che fa partire
     una notifica. Deve restare nel documento anche nei salvataggi
     successivi, altrimenti una modifica fatta subito dopo lo cancella
     prima che la funzione Netlify (che gira ogni 5 minuti) lo veda.
     Il doppio invio e impedito dal server, che confronta notice.ts.     */
  var carriedNotice = null;
  function snapshotLocal() {
    var out = buildState();
    if (window.pendingNotice) { carriedNotice = window.pendingNotice; window.pendingNotice = null; }
    if (carriedNotice) out.notice = carriedNotice;
    return out;
  }
  function sameTeams(a, b) {
    try { return JSON.stringify(a && a.teams) === JSON.stringify(b && b.teams); }
    catch (e) { return false; }
  }

  /* ── Applicazione dei dati remoti all'app ──────────────────────── */
  function applyRemote(data) {
    if (!data) return;
    // Conservo l'ultimo messaggio anche quando i dati arrivano da un altro
    // dispositivo: cosi non sparisce alla prima scrittura di questo.
    if (data.notice && data.notice.text) carriedNotice = data.notice;
    // PROTEZIONE 3 : conservo lo stato locale prima di sostituirlo.
    if (!sameTeams(data, buildState())) keepHistory('avant réception cloud');

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
          // I tornei sono arrivati dopo: i documenti creati prima non li hanno.
          // In quel caso conservo quelli locali invece di cancellarli.
          if (Array.isArray(s.tournaments)) window.TEAMS[k].tournaments = s.tournaments;
          else if (!Array.isArray(window.TEAMS[k].tournaments)) window.TEAMS[k].tournaments = [];
        }
      }
      window.bindTeamData();
      window.updateTeamUI();

      var main = document.getElementById('S-main');
      if (main && main.classList.contains('on')) {
        try { window.initMain(); } catch (e) { console.warn('[sync] initMain:', e); }
        try { if (window.renderTournois) window.renderTournois(); }
        catch (e) { console.warn('[sync] renderTournois:', e); }
      }

      try { localStorage.setItem(window.STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
      rememberRev(data.rev);
    } finally {
      applyingRemote = false;
    }
  }

  /* ── Scrittura protetta ─────────────────────────────────────────── */
  function flush() {
    if (!syncReady) { pendingLocal = true; return; }
    var payload = snapshotLocal();
    var target  = lastSeenRev;              // revisione su cui ci basiamo
    payload.rev = target + 1;
    inFlightRev = payload.rev;

    status('#E8A33D', 'enregistrement…');

    db.runTransaction(function (tx) {
      return tx.get(DOC).then(function (snap) {
        var remoteRev = snap.exists ? (Number((snap.data() || {}).rev) || 0) : 0;
        // PROTEZIONE 2 : qualcun altro ha scritto dopo la nostra lettura.
        if (remoteRev !== target) {
          var err = new Error('conflit de version');
          err.asrcmConflict = true;
          err.remote = snap.exists ? snap.data() : null;
          throw err;
        }
        tx.set(DOC, payload);
      });
    })
    .then(function () {
      pendingLocal = false;
      inFlightRev = 0;
      rememberRev(payload.rev);
      status('#2E7D32', 'synchronisé');
    })
    .catch(function (e) {
      inFlightRev = 0;
      // Il messaggio resta in carriedNotice: ripartira col prossimo tentativo.

      if (e && e.asrcmConflict && !e.remote) {
        // Il documento non esiste più: la nostra revisione non è valida.
        rememberRev(0);
        pendingLocal = true;
        scheduleRetry();
        return;
      }

      if (e && e.asrcmConflict) {
        // Non sovrascriviamo: i dati del cloud sono più récents.
        // Lo stato locale finisce nella cronologia (Admin → Historique).
        console.warn('[sync] conflitto: il cloud è più recente, ricarico');
        status('#E8A33D', 'conflit — données rechargées');
        say('Données plus récentes reçues — ta saisie est dans Admin › Historique');
        if (e.remote) applyRemote(e.remote);
        pendingLocal = false;
        return;
      }

      // Rete assente o errore momentaneo: si riprova, nulla è perso in locale.
      console.error('[sync] write:', e);
      status('#CC1020', 'hors ligne — non publié');
      pendingLocal = true;
      scheduleRetry();
    });
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () { if (pendingLocal) flush(); }, RETRY_MS);
  }

  /* ── Override di saveData : locale + Firestore ─────────────────── */
  var origSave = window.saveData;
  window.saveData = function () {
    try { origSave(); } catch (e) {}
    if (applyingRemote) return;

    if (!syncReady) {
      // PROTEZIONE 1 : si salva in locale, ma non si pubblica ancora.
      pendingLocal = true;
      status('#E8A33D', 'attente de la 1re synchro');
      if (!warnedNotReady) {
        warnedNotReady = true;
        say('Synchronisation en cours — modification enregistrée localement');
      }
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  };

  /* ── Autenticazione anonima ────────────────────────────────────────
     Le regole Firestore richiedono una sessione autenticata. L'app apre
     da sola una sessione anonima: l'utente non se ne accorge.
     Se in Console non e stato abilitato il metodo "Anonyme", proseguo
     comunque: con regole aperte l'app continua a funzionare.          */
  var connected = false;
  function connect() {
    if (connected) return;
    connected = true;
    startListening();
  }

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

  /* ── Sblocco di sicurezza ──────────────────────────────────────────
     Se il cloud non risponde (offline, regole, rete del campo), dopo
     FIRST_WAIT si lavora comunque: le scritture partiranno appena la
     connessione torna, sempre passando dal controllo di revisione.    */
  setTimeout(function () {
    if (syncReady) return;
    syncReady = true;
    console.warn('[sync] prima sincronizzazione non riuscita: modalità locale');
    status('#CC1020', 'hors ligne — travail local');
    say('Hors ligne : les modifications partiront au retour du réseau');
    if (pendingLocal) flush();
  }, FIRST_WAIT);

  /* ── Ascolto in tempo reale ────────────────────────────────────── */
  function startListening() {
    DOC.onSnapshot(function (snap) {
      if (snap.exists) {
        seeded = true;
        var data = snap.data() || {};
        var rrev = Number(data.rev) || 0;
        // Eco della nostra stessa scrittura: niente da riapplicare.
        var mine = data.lastEditor === window.ASRCM_DEVICE_ID
                   && (rrev === lastSeenRev || rrev === inFlightRev);
        if (!mine) applyRemote(data);
        else rememberRev(data.rev);

        if (!syncReady) {
          syncReady = true;
          console.log('[sync] prima sincronizzazione completata');
        }
        status('#2E7D32', 'synchronisé');
        // Modifiche fatte prima della sincro: ora si possono pubblicare.
        if (pendingLocal) flush();
      } else if (!seeded) {
        seeded = true;
        syncReady = true;
        rememberRev(0);   // nessun documento : si riparte dalla revisione 0
        console.log('[sync] documento assente — invio dati iniziali');
        flush();
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
    write: function () { flush(); return 'scrittura protetta avviata'; },
    local: buildState,
    state: function () { return { syncReady: syncReady, pendingLocal: pendingLocal, lastSeenRev: lastSeenRev }; }
  };

  console.log('[sync] Firebase attivo →', CFG.collection + '/' + CFG.doc);
})();
