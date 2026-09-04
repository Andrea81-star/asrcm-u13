/* ═══════════════════════════════════════════════════════════════════
   NOTIFICHE PUSH — ASRCM U13
   Registra il dispositivo presso Firebase Cloud Messaging e salva il
   token in Firestore, nel documento asrcm/push.
   L'invio non avviene qui: lo fa la funzione programmata su Netlify.
   Caricato DOPO firebase-sync.js.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var PREF_KEY = 'asrcm_notif_pref';   // preferenza locale: 'on' | 'off'

  function supported() {
    return 'Notification' in window &&
           'serviceWorker' in navigator &&
           'PushManager' in window &&
           window.firebase && firebase.messaging &&
           firebase.messaging.isSupported && firebase.messaging.isSupported();
  }

  // Su iPhone le notifiche esistono solo se l'app e stata installata
  // nella schermata Home: in una scheda Safari non sono disponibili.
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  window.notifPrefEnabled = function () {
    try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch (e) { return true; }
  };
  function savePref(on) {
    try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch (e) {}
  }

  /* ── Stato leggibile, mostrato nel pannello Admin ─────────────── */
  window.notifStatus = function () {
    if (!('Notification' in window))       return { code: 'unsupported', txt: 'Non prises en charge par ce navigateur' };
    if (isIOS() && !isStandalone())        return { code: 'ios-browser', txt: "Sur iPhone : ajoutez l'app à l'écran d'accueil pour les activer" };
    if (!supported())                      return { code: 'unsupported', txt: 'Non prises en charge sur cet appareil' };
    if (Notification.permission === 'denied')  return { code: 'denied',  txt: 'Bloquées — à réautoriser dans les réglages du navigateur' };
    if (Notification.permission === 'granted') return { code: 'granted', txt: 'Activées sur cet appareil' };
    return { code: 'default', txt: 'En attente de votre autorisation' };
  };

  /* ── Registrazione del dispositivo ────────────────────────────── */
  window.enablePush = function (silent) {
    if (!window.notifPrefEnabled()) return Promise.resolve(false);

    var st = window.notifStatus();
    if (st.code === 'unsupported' || st.code === 'ios-browser' || st.code === 'denied') {
      if (!silent) console.log('[push]', st.txt);
      return Promise.resolve(false);
    }
    if (!window.FIREBASE_VAPID_KEY || window.FIREBASE_VAPID_KEY.indexOf('INCOLLA') === 0) {
      console.warn('[push] chiave VAPID mancante in firebase-config.js');
      return Promise.resolve(false);
    }

    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { console.log('[push] autorizzazione rifiutata'); return false; }
      return navigator.serviceWorker.ready.then(function (reg) {
        return firebase.messaging().getToken({
          vapidKey: window.FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: reg
        });
      }).then(function (token) {
        if (!token) { console.warn('[push] nessun token ottenuto'); return false; }
        return saveToken(token).then(function () {
          console.log('[push] dispositivo registrato');
          return true;
        });
      });
    }).catch(function (e) {
      console.warn('[push] registrazione non riuscita:', e);
      return false;
    });
  };

  function saveToken(token) {
    var cfg = window.FIREBASE_DOC || { collection: 'asrcm' };
    var ref = firebase.firestore().collection(cfg.collection).doc('push');
    var entry = {};
    entry[window.ASRCM_DEVICE_ID || 'd-anon'] = {
      token: token,
      ts: Date.now(),
      ua: (navigator.userAgent || '').slice(0, 80)
    };
    return ref.set({ devices: entry }, { merge: true });
  }

  /* ── Disattivazione ───────────────────────────────────────────── */
  window.disablePush = function () {
    savePref(false);
    var cfg = window.FIREBASE_DOC || { collection: 'asrcm' };
    var ref = firebase.firestore().collection(cfg.collection).doc('push');
    var upd = {};
    upd['devices.' + (window.ASRCM_DEVICE_ID || 'd-anon')] = firebase.firestore.FieldValue.delete();
    return ref.update(upd).catch(function () { /* documento assente: nulla da fare */ });
  };

  window.setNotifPref = function (on) {
    savePref(on);
    return on ? window.enablePush(false) : window.disablePush();
  };

  /* ── Riallineamento all'avvio ─────────────────────────────────────
     Se il permesso e gia stato concesso, rinnovo il token in silenzio:
     FCM puo cambiarlo dopo mesi o dopo la reinstallazione dell'app.   */
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (window.notifPrefEnabled() && window.Notification &&
          Notification.permission === 'granted') {
        window.enablePush(true);
      }
    }, 2500);
  });
})();
