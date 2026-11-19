#!/usr/bin/env bash
# `npm run capture`: rebuild the guide media in src/features/guide/media/ from fixed fixtures, once per language.
# Each run gets a throwaway HOME (fixture shell, demo `claude`/`codex`, demo git projects), so no real user data,
# config or CLI is ever on screen. Needs a build first (`npm run capture` does it). CAPTURE_LANGS="en" for one.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIX="$ROOT/scripts/capture/fixtures"
OUT="$ROOT/src/features/guide/media"
mkdir -p "$OUT"

demo_repo() { # demo_repo <dir> <file:content>...
  local dir="$1"; shift
  mkdir -p "$dir"
  for spec in "$@"; do mkdir -p "$dir/$(dirname "${spec%%:*}")"; printf '%b' "${spec#*:}" > "$dir/${spec%%:*}"; done
  git -C "$dir" init -q -b main
  git -C "$dir" add -A
  git -C "$dir" -c user.name=Demo -c user.email=demo@example.com commit -qm "initial commit"
}

for lang in ${CAPTURE_LANGS:-ko en}; do
  # A short fixed path: it shows up in some screens (checklist, worktree hint).
  home=/tmp/aquila-demo
  rm -rf "$home" && mkdir -p "$home"
  cp -R "$FIX/home/." "$home/"
  mkdir -p "$home/.aquila" "$home/.claude" "$home/.claude-personal"
  # Both demo accounts look logged in (the app only checks that oauthAccount exists), so no setup banners.
  login='{ "oauthAccount": { "emailAddress": "demo@example.com" } }'
  echo "$login" > "$home/.claude.json"
  echo "$login" > "$home/.claude-personal/.claude.json"
  sed "s/__LANG__/$lang/" "$FIX/config.json" > "$home/.aquila/config.json"
  P="$home/projects"
  demo_repo "$P/web-shop" \
    "src/cart.ts:export function total(items: { price: number }[]) {\n  return items.reduce((sum, i) => sum + i.price, 0);\n}\n" \
    "src/checkout.ts:import { total } from './cart';\n\nexport const pay = (items: { price: number }[]) => total(items);\n" \
    "README.md:# web-shop\n"
  # Uncommitted work for the changes panel.
  printf '%b' "export function total(items: { price: number }[], coupon?: number) {\n  const sum = items.reduce((s, i) => s + i.price, 0);\n  return coupon ? Math.max(0, sum - coupon) : sum;\n}\n" > "$P/web-shop/src/cart.ts"
  printf '%b' "export const COUPONS: Record<string, number> = { WELCOME: 5 };\n" > "$P/web-shop/src/coupon.ts"
  demo_repo "$P/api-server" "orders/total.ts:export const total = (n: number) => Math.round(n * 100) / 100;\n" "README.md:# api-server\n"
  demo_repo "$P/docs-site" "guide/index.md:# Guide\n" "README.md:# docs-site\n"
  demo_repo "$P/mobile-app" "app/settings.tsx:export default function Settings() {}\n" "README.md:# mobile-app\n"

  echo "[capture] $lang in $home"
  # No TERM_PROGRAM/TERM_SESSION_ID from the terminal you run this in: macOS zsh would print "Restored session".
  env -u TERM_PROGRAM -u TERM_SESSION_ID -u TERM_PROGRAM_VERSION \
    HOME="$home" ZDOTDIR="$home" SHELL=/bin/zsh AQUILA_SMOKE=1 AQUILA_CAPTURE="$OUT" \
    "$ROOT/node_modules/.bin/electron" "$ROOT"
  rm -rf "$home"
done
