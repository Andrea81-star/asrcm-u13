# ASRCM U13 — Sincronizzazione Firebase Firestore

App singola (login admin/visiteur, due squadre U13-1 e U13-2) con dati condivisi in tempo reale tra tutti i dispositivi.

## File del progetto

| File | Ruolo |
|---|---|
| `index.html` | App completa + tag script Firebase in fondo |
| `firebase-config.js` | Credenziali del progetto Firebase (**da compilare**) |
| `firebase-sync.js` | Bridge localStorage → Firestore + listener in tempo reale |
| `firestore.rules` | Regole di sicurezza del database |
| `setup.sh` | Script di push su GitHub |

## Come funziona

L'app salvava tutto in `localStorage` sotto la chiave `asrcm_u13_data_v1`.
`firebase-sync.js` sovrascrive la funzione `saveData()`: ogni volta che l'app chiama `persist()` i dati vengono scritti anche sul documento Firestore `asrcm/u13`. Un listener `onSnapshot` riceve le modifiche degli altri dispositivi e ridisegna l'interfaccia. `localStorage` resta come cache offline.

Struttura del documento su Firestore:

```
asrcm/u13
├── pwds: { admin, visitor }
├── teams
│   ├── u13-1: { players[], matches[], notifs[] }
│   └── u13-2: { players[], matches[], notifs[] }
└── updatedAt
```

Un pallino in alto a destra indica lo stato: verde = sincronizzato, rosso = errore/offline.

---

## 1 · Creare il progetto Firebase

1. Vai su https://console.firebase.google.com → **Aggiungi progetto**
2. Nome: `asrcm-u13` — disattiva pure Google Analytics
3. Menu laterale → **Build → Firestore Database** → **Crea database**
   - Modalità: **test** (regole aperte a tempo)
   - Località: **eur3 (europe-west)**
4. Menu laterale → **⚙️ Impostazioni progetto** → sezione *Le tue app* → icona **`</>`** (Web)
   - Nickname: `asrcm-u13-web` → **Registra app**
   - Copia l'oggetto `firebaseConfig` che compare

## 2 · Compilare `firebase-config.js`

Apri `firebase-config.js` e incolla i valori copiati:

```js
window.FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "asrcm-u13.firebaseapp.com",
  projectId:         "asrcm-u13",
  storageBucket:     "asrcm-u13.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abc123..."
};
```

> L'`apiKey` di Firebase Web **non è un segreto**: la sicurezza dipende dalle regole Firestore, non dalla chiave.

## 3 · Applicare le regole di sicurezza

Firebase Console → **Firestore Database** → scheda **Regole** → incolla il contenuto di `firestore.rules` → **Pubblica**.

## 4 · Test in locale

Apri un terminale nella cartella del progetto:

```bash
python -m http.server 8080
```

Poi vai su `http://localhost:8080`.
⚠️ Non aprire `index.html` con doppio clic (`file://`): i tag `<script src="...">` locali non si caricherebbero correttamente.

**Verifica in console (F12):**
- `[sync] Firebase attivo → asrcm/u13`
- `fbDebug.read()` → mostra i dati presenti su Firestore
- `fbDebug.write()` → forza una scrittura di prova
- Su Firebase Console deve comparire la collezione `asrcm` con il documento `u13`

## 5 · Pubblicare su GitHub

**Opzione A — script automatico (Git Bash):**

```bash
bash setup.sh https://github.com/TUO_UTENTE/asrcm-u13.git
```

**Opzione B — manuale:** crea il repo su GitHub (vuoto, senza README) e carica i 6 file con *Add file → Upload files*.

> ⚠️ Se stai **aggiornando** un file già presente su GitHub via interfaccia web, **cancella prima il vecchio file** e poi carica il nuovo: altrimenti resta la versione vecchia in produzione.

## 6 · Pubblicare su Netlify

1. https://app.netlify.com → **Add new site → Import an existing project**
2. **Deploy with GitHub** → autorizza → seleziona il repo `asrcm-u13`
3. Impostazioni di build (sito statico, nessun build step):
   - **Build command:** *(lascia vuoto)*
   - **Publish directory:** `.`
4. **Deploy site**
5. **Site configuration → Change site name** → es. `asrcm-u13` → l'URL sarà `https://asrcm-u13.netlify.app`

*In alternativa (senza GitHub):* trascina la cartella del progetto su https://app.netlify.com/drop.

## 7 · Autorizzare il dominio su Firebase

Firebase Console → **Authentication → Settings → Domini autorizzati** → **Aggiungi dominio** → `asrcm-u13.netlify.app`
(necessario solo se in seguito attiverai Firebase Auth; per il solo Firestore non serve.)

---

## Test finale

1. Apri il sito Netlify su due dispositivi diversi
2. Accedi come `admin` su uno, aggiungi un giocatore o un risultato
3. L'altro dispositivo deve aggiornarsi entro ~1 secondo

## Note di sicurezza

- Le regole attuali sono **aperte fino al 31/12/2026**: chiunque conosca il `projectId` può leggere e scrivere. Aggiorna la data o passa alla versione blindata prima della scadenza.
- Le password `admin`/`visiteur` sono salvate **in chiaro** su Firestore. Per un livello di sicurezza reale serve **Firebase Authentication** (email/password o accesso anonimo) e le regole commentate in fondo a `firestore.rules`.
- Prossimo passo consigliato: attivare Firebase Auth e legare le scritture a `request.auth != null`.
