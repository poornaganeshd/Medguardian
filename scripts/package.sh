#!/usr/bin/env bash
#
# Builds MedGuardian_Final.zip — the complete source and documentation,
# without dependencies, secrets, user uploads or build output.
#
# Usage:  bash scripts/package.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARCHIVE="MedGuardian_Final.zip"
rm -f "$ARCHIVE"

echo "Packaging MedGuardian…"

zip -r -q "$ARCHIVE" . \
  -x '*/node_modules/*' 'node_modules/*' \
  -x '*/.env' '.env' '*/.env.local' '*.env.*.local' \
  -x '*/dist/*' 'dist/*' \
  -x '*/build/*' \
  -x '*/coverage/*' \
  -x '.git/*' '*/.git/*' \
  -x '*/backend/uploads/*' \
  -x '*.log' '*/logs/*' \
  -x '*.tsbuildinfo' '*/.cache/*' '*/.vite/*' '*/.eslintcache' \
  -x '*/tmp/*' '*/temp/*' \
  -x '.DS_Store' '*/.DS_Store' 'Thumbs.db' \
  -x '*/.vscode/*' '*/.idea/*' \
  -x "$ARCHIVE"

# The upload directories must exist for the server to start, so keep their
# placeholder files even though their contents are excluded.
zip -q "$ARCHIVE" \
  backend/uploads/.gitkeep \
  backend/uploads/medicines/.gitkeep \
  backend/uploads/records/.gitkeep \
  backend/uploads/tmp/.gitkeep 2>/dev/null || true

echo
echo "Created $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1), $(unzip -l "$ARCHIVE" | tail -1 | awk '{print $2}') files)"

# ---------------------------------------------------------------- verification
# The listing is captured once: piping `unzip -l` straight into `grep -q`
# makes grep exit early, which SIGPIPEs unzip and trips `pipefail`.
LISTING="$(unzip -l "$ARCHIVE")"
FAILED=0

echo
echo "Verifying exclusions…"
for pattern in 'node_modules/' '/\.env$' '/dist/' '^\.git/' 'coverage/'; do
  if printf '%s\n' "$LISTING" | awk '{print $4}' | grep -qE "$pattern"; then
    echo "  x FOUND $pattern - this should have been excluded"
    FAILED=1
  else
    echo "  - no $pattern"
  fi
done

echo
echo "Verifying required contents…"
for required in \
  'README.md' \
  'PROJECT_PROGRESS.md' \
  '.env.example' \
  'docs/ARCHITECTURE.md' \
  'docs/DRPA.md' \
  'docs/DRUG_INTERACTIONS.md' \
  'docs/SECURITY.md' \
  'docs/API.md' \
  'docs/TESTING.md' \
  'backend/package.json' \
  'backend/src/server.js' \
  'backend/src/app.js' \
  'backend/src/services/refillPredictionService.js' \
  'backend/src/services/drugInteractionService.js' \
  'backend/src/services/adherenceService.js' \
  'backend/src/data/drugInteractions.json' \
  'backend/src/data/medicineKnowledgeBase.json' \
  'backend/src/utils/seed.js' \
  'backend/tests/setup.js' \
  'frontend/package.json' \
  'frontend/index.html' \
  'frontend/src/App.jsx' \
  'frontend/src/main.jsx' \
  'frontend/src/styles/global.css'
do
  if printf '%s\n' "$LISTING" | grep -qF "$required"; then
    echo "  - $required"
  else
    echo "  x MISSING $required"
    FAILED=1
  fi
done

# Count what went in, per area.
echo
echo "Contents:"
for area in backend/src backend/tests frontend/src docs; do
  n="$(printf '%s\n' "$LISTING" | awk '{print $4}' | grep -c "^$area/" || true)"
  printf '  %-16s %s files\n' "$area" "$n"
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo "Package verified: $ARCHIVE"
else
  echo "Package verification FAILED."
  exit 1
fi
