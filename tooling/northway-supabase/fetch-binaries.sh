#!/usr/bin/env bash
# LOCAL TEST STACK ONLY: download the official Supabase Auth (GoTrue) and
# PostgREST release binaries for tooling/northway-supabase/local-stack.mjs.
# Linux x86-64. Output goes to .northway-local/ (git-ignored).
set -euo pipefail
GOTRUE_VERSION="${GOTRUE_VERSION:-v2.180.0}"
POSTGREST_VERSION="${POSTGREST_VERSION:-v12.2.3}"
DEST="$(cd "$(dirname "$0")/../.." && pwd)/.northway-local"
mkdir -p "$DEST/auth"
curl -fsSL "https://github.com/supabase/auth/releases/download/${GOTRUE_VERSION}/auth-${GOTRUE_VERSION}-x86.tar.gz" | tar xz -C "$DEST/auth"
curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-linux-static-x64.tar.xz" | tar xJ -C "$DEST"
echo "Supabase Auth ${GOTRUE_VERSION} and PostgREST ${POSTGREST_VERSION} are in $DEST"
