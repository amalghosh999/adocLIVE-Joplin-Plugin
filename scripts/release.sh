#!/usr/bin/env bash
set -euo pipefail

echo "The legacy bump/build/publish release path is disabled."
echo "Use 'npm run release:prepare', complete baseline review/application, then run the explicit artifact-preserving 'npm run release:publish -- --bundle <dir> --receipt <file> --confirm <version>'."
exit 1
