#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo 'Node.js 24 oder neuer wird benötigt.'
  read '?Enter zum Schließen.'
  exit 1
fi
echo 'Nach dem Start öffnen: http://127.0.0.1:4317'
echo 'Stoppen mit Ctrl+C in diesem Fenster.'
node src/server.js
