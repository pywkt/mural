#!/bin/bash
# Rebuild the svg-to-mural worker from tsc/ source and copy it + paper.js
# into this tool directory. Run from anywhere; paths are resolved relative
# to this script.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${REPO_ROOT}/tsc"
if [ ! -d node_modules ]; then
  npm install
fi
npm run build

mkdir -p "${SCRIPT_DIR}/worker" "${SCRIPT_DIR}/lib"
cp dist_packed/main.js "${SCRIPT_DIR}/worker/worker.js"
cp node_modules/paper/dist/paper-full.min.js "${SCRIPT_DIR}/lib/paper-full.min.js"

echo "Built worker.js ($(wc -c < "${SCRIPT_DIR}/worker/worker.js") bytes) and paper-full.min.js into docs/svg-to-mural/"
