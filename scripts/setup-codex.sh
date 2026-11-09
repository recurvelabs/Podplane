#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Podplane needs Node.js 24 or later."); process.exit(1); }'
npm ci --prefix processor --ignore-scripts
npm run build:staging
npm test
npm run build
npm run validate
