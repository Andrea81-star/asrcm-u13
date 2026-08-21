#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# ASRCM U13 — Setup Git + push su GitHub
# Uso (Git Bash su Windows):  bash setup.sh <URL_REPO_GITHUB>
# Esempio: bash setup.sh https://github.com/tuoutente/asrcm-u13.git
# ═══════════════════════════════════════════════════════════════════
set -e

REPO_URL="$1"
if [ -z "$REPO_URL" ]; then
  echo "❌ Manca l'URL del repository."
  echo "   Uso: bash setup.sh https://github.com/utente/asrcm-u13.git"
  exit 1
fi

# Controllo che la config sia stata compilata
if grep -q "INCOLLA_QUI" firebase-config.js; then
  echo "⚠️  ATTENZIONE: firebase-config.js contiene ancora dei placeholder."
  echo "   Compila apiKey / messagingSenderId / appId prima di pubblicare."
  read -p "   Continuare comunque? (s/N) " ok
  [ "$ok" = "s" ] || exit 1
fi

git init
git add index.html firebase-config.js firebase-sync.js firestore.rules README.md setup.sh
git commit -m "ASRCM U13 — app con sincronizzazione Firebase Firestore"
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"
git push -u origin main --force

echo ""
echo "✅ Push completato su $REPO_URL"
echo "   Prossimo passo: collega il repo su Netlify (New site → Import from GitHub)."
