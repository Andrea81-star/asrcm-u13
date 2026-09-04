/* ═══════════════════════════════════════════════════════════
   CONFIGURAZIONE FIREBASE — ASRCM U13
   Sostituisci i valori qui sotto con quelli del TUO progetto
   Firebase (Console → Impostazioni progetto → Le tue app → Web)
   ═══════════════════════════════════════════════════════════ */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCYp6sJ5jc3zFhtE8dkHLopyufgoomrUtw",
  authDomain: "asrcm-u13.firebaseapp.com",
  projectId: "asrcm-u13",
  storageBucket: "asrcm-u13.firebasestorage.app",
  messagingSenderId: "529797900071",
  appId: "1:529797900071:web:4cd10d78de61aea52aab02"
};

/* Percorso del documento su Firestore: collezione/documento */
window.FIREBASE_DOC = { collection: "asrcm", doc: "u13" };

/* ═══════════════════════════════════════════════════════════════════
   CHIAVE PER LE NOTIFICHE PUSH (VAPID)
   Console Firebase → ⚙️ Impostazioni progetto → scheda Cloud Messaging
   → sezione "Web Push certificates" → Genera coppia di chiavi.
   Copia qui la chiave pubblica. Non e un segreto.
   ═══════════════════════════════════════════════════════════════════ */
window.FIREBASE_VAPID_KEY = "BH677246NGNEASBCX9ErtoABKEn6V-95FrK20Viud0uT1Ls_xTZ-mG3i3CiRLLTJKT5OSZiJlYMRT72AFAHnDt0";

/* Percorso del documento su Firestore: collezione/documento */
window.FIREBASE_DOC = { collection: "asrcm", doc: "u13" };
