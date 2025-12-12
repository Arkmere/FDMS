#!/usr/bin/env bash
set -euo pipefail
rm -rf docs
cp -R src docs
echo "Copied src to docs for GitHub Pages."
