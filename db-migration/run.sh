#!/bin/sh
# Copies every MongoDB database from the old cluster to the new one, then verifies.
# Usage: sh db-migration/run.sh            (first copy)
#        sh db-migration/run.sh --replace  (final re-sync at cutover: drops & recopies on NEW only)
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/.." || exit 1
set -a; . "$DIR/credentials.local.sh"; set +a
NODE=node
[ -x /opt/homebrew/opt/node@22/bin/node ] && NODE=/opt/homebrew/opt/node@22/bin/node
LOG="$DIR/log-$(date +%Y%m%d-%H%M%S).txt"
{
  echo "=== INSPECT $(date)"; $NODE "$DIR/migrate-cluster.mjs" inspect || exit 1
  echo "=== COPY $(date)";    $NODE "$DIR/migrate-cluster.mjs" copy "$@" || exit 1
  echo "=== VERIFY $(date)";  $NODE "$DIR/migrate-cluster.mjs" verify
  echo "=== FINISHED $(date)"
} 2>&1 | tee "$LOG"
echo; echo "Log saved to $LOG"
