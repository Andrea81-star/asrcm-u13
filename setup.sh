#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# ASRCM U13 — Setup Git + push su GitHub
# Uso (Git Bash su Windows):  bash setup.sh <URL_REPO_GITHUB>
# Esempio: bash setup.sh https://github.com/Andrea81-star/asrcm-u13.git
# ═══════════════════════════════════════════════════════════════════
# Nota: NON usiamo "set -e". Git restituisce un codice di errore anche
# in situazioni normali (per esempio quando non c'e nulla da committare)
# e lo script si interromperebbe prima del push.

REPO_URL="$1"
if [ -z "$REPO_URL" ]; then
  echo "❌ Manca l'URL del repository."
  echo "   Uso: bash setup.sh https://github.com/utente/asrcm-u13.git"
  exit 1
fi

# ── Controllo che la configurazione sia stata compilata ──────────────
if grep -q "INCOLLA_QUI" firebase-config.js 2>/dev/null; then
  echo "⚠️  firebase-config.js contiene ancora dei segnaposto."
  read -p "   Continuare comunque? (s/N) " ok
  [ "$ok" = "s" ] || exit 1
fi

# ── Controllo che i file attesi ci siano ─────────────────────────────
MANCANTI=""
for f in index.html manifest.json service-worker.js firebase-config.js \
         firebase-sync.js firebase-push.js firestore.rules \
         package.json netlify.toml netlify/functions/notify.mjs \
         icons/icon-192.png icons/icon-512.png icons/maskable-192.png \
         icons/maskable-512.png icons/apple-touch-icon.png; do
  [ -f "$f" ] || MANCANTI="$MANCANTI\n   - $f"
done
if [ -n "$MANCANTI" ]; then
  echo "❌ File mancanti nella cartella:"
  echo -e "$MANCANTI"
  echo "   Copiali qui e rilancia lo script."
  exit 1
fi

# ── Repository ───────────────────────────────────────────────────────
if [ ! -d .git ]; then
  echo "→ Inizializzo il repository..."
  git init
fi
git branch -M main

echo "→ Aggiungo i file..."
git add index.html manifest.json service-worker.js firebase-config.js \
        firebase-sync.js firebase-push.js firestore.rules setup.sh icons/ \
        package.json netlify.toml netlify/

if git diff --cached --quiet; then
  echo "→ Nessuna modifica da registrare: i file erano gia aggiornati."
else
  git commit -m "ASRCM U13 — PWA, backup dati e regole Firestore senza scadenza"
  echo "→ Commit creato."
fi

# ── Collegamento a GitHub ────────────────────────────────────────────
echo "→ Collego il repository remoto..."
git remote remove origin 2>/dev/null
git remote add origin "$REPO_URL"

echo "→ Invio a GitHub..."
if git push -u origin main --force; then
  echo ""
  echo "✅ Push completato su $REPO_URL"
  echo "   Netlify ripubblichera il sito entro un minuto."
else
  echo ""
  echo "❌ Push non riuscito."
  echo "   Se ti ha chiesto la password: GitHub non accetta piu la password"
  echo "   dell'account. Serve un token (Settings → Developer settings →"
  echo "   Personal access tokens → Tokens classic), da usare al suo posto."
  exit 1
fi
