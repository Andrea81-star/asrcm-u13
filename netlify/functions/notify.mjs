/* ═══════════════════════════════════════════════════════════════════
   NOTIFICHE ASRCM U13 — funzione programmata su Netlify
   Gira ogni 5 minuti. Se i dati sono stati modificati e sono passati
   almeno 5 minuti dall'ultima modifica, invia una notifica a tutti i
   dispositivi registrati, escluso quello che ha effettuato la modifica.
   ═══════════════════════════════════════════════════════════════════ */
import admin from 'firebase-admin';

const DELAY_MS = 5 * 60 * 1000;   // attesa dopo l'ultima modifica

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Variabile FIREBASE_SERVICE_ACCOUNT non impostata su Netlify');
  const key = JSON.parse(raw);
  // Netlify salva le variabili su una riga: gli a capo della chiave vanno ripristinati.
  if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, '\n');
  admin.initializeApp({ credential: admin.credential.cert(key) });
}

export default async () => {
  try {
    init();
    const db = admin.firestore();
    const dataRef = db.collection('asrcm').doc('u13');
    const pushRef = db.collection('asrcm').doc('push');

    const [dataSnap, pushSnap] = await Promise.all([dataRef.get(), pushRef.get()]);
    if (!dataSnap.exists) return json({ sent: 0, reason: 'nessun dato' });

    const data      = dataSnap.data();
    const push      = pushSnap.exists ? pushSnap.data() : {};
    const updatedAt = Number(data.updatedAt || 0);
    const notified  = Number(push.notifiedAt || 0);
    const now       = Date.now();

    if (!updatedAt)                    return json({ sent: 0, reason: 'nessuna data di modifica' });
    if (updatedAt <= notified)         return json({ sent: 0, reason: 'gia notificato' });
    if (now - updatedAt < DELAY_MS)    return json({ sent: 0, reason: 'attesa dei 5 minuti' });

    const devices = push.devices || {};
    // Tutti i dispositivi registrati ricevono la notifica,
    // compreso quello da cui e stata fatta la modifica.
    const targets = Object.entries(devices)
      .filter(([id, d]) => d && d.token)
      .map(([id, d]) => ({ id, token: d.token }));

    if (!targets.length) {
      await pushRef.set({ notifiedAt: now }, { merge: true });
      return json({ sent: 0, reason: 'nessun destinatario' });
    }

    const res = await admin.messaging().sendEachForMulticast({
      tokens: targets.map(t => t.token),
      data: {
        title: 'ASRCM U13',
        body:  'Nouvelles mises à jour disponibles'
      },
      webpush: {
        headers: { Urgency: 'normal', TTL: '3600' },
        fcmOptions: { link: process.env.APP_URL || '/' }
      }
    });

    // Rimuovo i dispositivi il cui token non e piu valido (app disinstallata).
    const dead = {};
    res.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error && r.error.code ? r.error.code : '';
      if (code.includes('registration-token-not-registered') ||
          code.includes('invalid-argument')) {
        dead['devices.' + targets[i].id] = admin.firestore.FieldValue.delete();
      }
    });

    await pushRef.set({ notifiedAt: now }, { merge: true });
    if (Object.keys(dead).length) await pushRef.update(dead);

    return json({
      sent: res.successCount,
      failed: res.failureCount,
      removed: Object.keys(dead).length
    });
  } catch (e) {
    console.error('[notify]', e);
    return json({ error: String(e && e.message || e) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json' }
  });
}

export const config = { schedule: '*/5 * * * *' };
