#!/bin/sh
# MongoDB cluster move: old (Mumbai M0) -> new (US East M10). Never writes to the old cluster.
#   sh db-migration/run.sh             first copy (refuses if NEW already has the database)
#   sh db-migration/run.sh --replace   fresh re-copy: drops turboClean on NEW only, copies again, verifies
#   sh db-migration/run.sh catchup     after the live app points at NEW: adds rows created on OLD meanwhile (no overwrites)
#   sh db-migration/run.sh verify      compare only
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/.." || exit 1
set -a; . "$DIR/credentials.local.sh"; set +a
NODE=node
[ -x /opt/homebrew/opt/node@22/bin/node ] && NODE=/opt/homebrew/opt/node@22/bin/node
S="$DIR/migrate-cluster.mjs"
LOG="$DIR/log-$(date +%Y%m%d-%H%M%S)-${1:-copy}.txt"
{
  case "$1" in
    catchup) echo "=== CATCHUP $(date)"; $NODE "$S" catchup ;;
    verify)  echo "=== VERIFY $(date)";  $NODE "$S" verify ;;
    *)
      echo "=== INSPECT $(date)"; $NODE "$S" inspect || exit 1
      echo "=== COPY $(date)";    $NODE "$S" copy "$@" || exit 1
      echo "=== VERIFY $(date)";  $NODE "$S" verify ;;
  esac
  echo "=== FINISHED $(date)"
} 2>&1 | tee "$LOG"
echo; echo "Log saved to $LOG"
