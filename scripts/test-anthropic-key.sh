#!/bin/bash
# Is this Anthropic (Claude) key working?  Run:  bash scripts/test-anthropic-key.sh
# Paste the key when asked (it stays hidden and is not saved anywhere), or press Enter to test the one in .env
API="${ANTHROPIC_BASE_URL:-https://api.anthropic.com}"
KEY="${1:-}"
if [ -z "$KEY" ]; then
  printf "Paste the ANTHROPIC_API_KEY to test (hidden), or press Enter to use the one in .env: "
  read -r -s KEY; echo
fi
if [ -z "$KEY" ] && [ -f .env ]; then
  KEY=$(grep -E '^ANTHROPIC_API_KEY=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')
  [ -n "$KEY" ] && echo "Using the key from .env"
fi
KEY=$(printf '%s' "$KEY" | tr -d ' \r\n')
if [ -z "$KEY" ]; then echo "No key given."; exit 2; fi
echo "Key ends with ...${KEY: -4} (${#KEY} characters)"

TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
H=(-H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json")

echo; echo "1) Does Anthropic accept the key?"
CODE=$(curl -sS -m 30 -o "$TMP" -w '%{http_code}' "$API/v1/models?limit=100" "${H[@]}")
if [ "$CODE" = "401" ]; then echo "   NO - the key is not accepted (wrong, deleted, or replaced by a newer one)."; echo; echo "RESULT: NOT WORKING. Make a new key at console.anthropic.com, put it in Vercel, redeploy."; exit 1; fi
if [ "$CODE" != "200" ]; then echo "   Unexpected answer (HTTP $CODE):"; head -c 400 "$TMP"; echo; echo; echo "RESULT: COULD NOT CONFIRM."; exit 1; fi
echo "   YES - the key is accepted."
MODELS=$(grep -oE '"id": ?"[^"]+"' "$TMP" | sed -E 's/"id": ?"//; s/"$//')

echo; echo "2) Models this app asks for:"
PICK=""
for M in claude-fable-5-1 claude-opus-5-5 claude-sonnet-5-5; do
  if printf '%s\n' "$MODELS" | grep -qx "$M"; then echo "   $M - available"; [ -z "$PICK" ] && PICK="$M"; else echo "   $M - NOT available to this key"; fi
done
[ -z "$PICK" ] && PICK=$(printf '%s\n' "$MODELS" | head -1)
if [ -z "$PICK" ]; then echo "   The key sees no models at all."; echo; echo "RESULT: NOT WORKING."; exit 1; fi

echo; echo "3) A real question to $PICK (costs a fraction of a cent):"
CODE=$(curl -sS -m 60 -o "$TMP" -w '%{http_code}' "$API/v1/messages" "${H[@]}" -d "{\"model\":\"$PICK\",\"max_tokens\":200,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word OK.\"}]}")
if [ "$CODE" = "200" ]; then
  echo "   Claude answered."
  echo; echo "RESULT: WORKING. The key is fine."
  exit 0
fi
echo "   HTTP $CODE:"; head -c 500 "$TMP"; echo
if grep -qi "credit balance" "$TMP"; then echo; echo "RESULT: NOT WORKING - the Anthropic account has no credit. Add credit at console.anthropic.com > Billing."; exit 1; fi
echo; echo "RESULT: NOT WORKING (see the message above)."; exit 1
