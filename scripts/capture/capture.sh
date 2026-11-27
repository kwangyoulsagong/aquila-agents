#!/usr/bin/env bash
# `npm run capture`: rebuild the guide media in src/features/guide/media/ from fixed fixtures, once per language.
# Each run gets a throwaway HOME (fixture shell, demo `claude`/`codex`, demo git projects), so no real user data,
# config or CLI is ever on screen. Needs a build first (`npm run capture` does it). CAPTURE_LANGS="en" for one.
# AQUILA_HIDDEN=1 (`npm run capture:hidden`): nothing on screen while it records (electron/hidden.ts).
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

ago() { date -u -v-"$1"M +%Y-%m-%dT%H:%M:%S.000Z; } # ago <minutes> → ISO time (BSD date)

# json_str <text> → a JSON string literal (python3 ships with macOS' command line tools, like git).
json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1], ensure_ascii=False))' "$1"; }

demo_claude() { # demo_claude <config dir> <cwd> <id> <minutes ago> <branch> <title or ""> <user> <assistant>
  local dir="$1/projects/$(echo "$2" | tr '/.' '--')" t0 t1
  mkdir -p "$dir"
  t0=$(ago "$4"); t1=$(ago $(( $4 - 3 )))
  {
    printf '{"type":"user","isSidechain":false,"message":{"role":"user","content":%s},"timestamp":"%s","cwd":"%s","sessionId":"%s","gitBranch":"%s"}\n' "$(json_str "$7")" "$t0" "$2" "$3" "$5"
    printf '{"type":"assistant","isSidechain":false,"message":{"role":"assistant","content":[{"type":"text","text":%s}]},"timestamp":"%s","cwd":"%s","sessionId":"%s","gitBranch":"%s"}\n' "$(json_str "$8")" "$t1" "$2" "$3" "$5"
    if [ -n "$6" ]; then printf '{"type":"custom-title","customTitle":%s,"sessionId":"%s"}\n' "$(json_str "$6")" "$3"; fi
  } > "$dir/$3.jsonl"
  touch -t "$(date -v-"$(( $4 - 3 ))"M +%Y%m%d%H%M.%S)" "$dir/$3.jsonl"
}

demo_codex() { # demo_codex <home> <cwd> <id> <minutes ago> <user> <assistant>
  local day t0 t1
  day="$1/.codex/sessions/$(date -v-"$4"M +%Y/%m/%d)"
  mkdir -p "$day"
  t0=$(ago "$4"); t1=$(ago $(( $4 - 2 )))
  {
    printf '{"timestamp":"%s","type":"session_meta","payload":{"id":"%s","timestamp":"%s","cwd":"%s","originator":"codex-tui"}}\n' "$t0" "$3" "$t0" "$2"
    printf '{"timestamp":"%s","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":%s}]}}\n' "$t0" "$(json_str "$5")"
    printf '{"timestamp":"%s","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":%s}]}}\n' "$t1" "$(json_str "$6")"
  } > "$day/rollout-$(date -v-"$4"M +%Y-%m-%dT%H-%M-%S)-$3.jsonl"
}

demo_history() { # demo_history <home> <lang>
  local h="$1" P="$1/projects"
  if [ "$2" = ko ]; then
    demo_claude "$h/.claude" "$P/web-shop" 0b6f3a52-1d2e-4c6b-9a51-2f0e7c1d0a01 25 feat/coupon "쿠폰 할인" \
      "장바구니 합계에 쿠폰 할인을 넣어줘" "total()에 coupon 인자를 추가하고 0 미만이 되지 않게 했어요."
    demo_claude "$h/.claude" "$P/web-shop" 0b6f3a52-1d2e-4c6b-9a51-2f0e7c1d0a02 190 main "" \
      "결제 페이지 로딩이 느린 이유 찾아줘" "checkout.ts가 매번 전체 상품을 다시 불러와요. 메모이즈했어요."
    demo_claude "$h/.claude" "$P/api-server" 0b6f3a52-1d2e-4c6b-9a51-2f0e7c1d0a03 1500 main "" \
      "주문 합계 반올림 버그 고쳐줘" "Math.round로 센트 단위 반올림을 맞췄어요. 쿠폰 적용 후에도 같아요."
    demo_claude "$h/.claude-personal" "$P/docs-site" 0b6f3a52-1d2e-4c6b-9a51-2f0e7c1d0a04 4300 main "가이드 목차" \
      "가이드 첫 페이지 목차 정리해줘" "설치, 첫 실행, 단축키 순서로 목차를 나눴어요."
    demo_codex "$h" "$P/mobile-app" 01a1ebf4-1ccd-7221-a7f6-a2d6f4af3c01 380 \
      "설정 화면에 다크 모드 토글 추가" "settings.tsx에 토글을 넣고 시스템 설정을 기본값으로 했어요."
  else
    demo_claude "$h/.claude" "$P/web-shop" 0b6f3a52-1d2e-4c6b-9a51-2f0e7c1d0a01 25 feat/coupon "Coupon discount" \
      "Add a coupon discount to the cart total" "total() takes a coupon now and never goes below zero."
    demo_claude "$h/.claude" "$P/web-shop" 0b6f3a52-1d2e-4c6b-9a51-2f0e7c1d0a02 190 main "" \
      "Why is the checkout page slow to load?" "checkout.ts reloads every product each time. Memoized it."
    demo_claude "$h/.claude" "$P/api-server" 0b6f3a52-1d2e-4c6b-9a51-2f0e7c1d0a03 1500 main "" \
      "Fix the order total rounding bug" "Rounded to cents with Math.round; same result after a coupon."
    demo_claude "$h/.claude-personal" "$P/docs-site" 0b6f3a52-1d2e-4c6b-9a51-2f0e7c1d0a04 4300 main "Guide outline" \
      "Tidy up the outline of the guide's first page" "Split it into install, first run and shortcuts."
    demo_codex "$h" "$P/mobile-app" 01a1ebf4-1ccd-7221-a7f6-a2d6f4af3c01 380 \
      "Add a dark mode toggle to settings" "Added a toggle in settings.tsx, defaulting to the system setting."
  fi
}

demo_commands() { # demo_commands <config dir> <cwd> <session id> <minutes ago>: Bash tool calls appended to a transcript
  local file="$1/projects/$(echo "$2" | tr '/.' '--')/$3.jsonl" m="$4" n=0 cmd err out
  while IFS='|' read -r cmd err out; do
    n=$((n + 1))
    printf '{"type":"assistant","isSidechain":false,"message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_demo%s","name":"Bash","input":{"command":%s}}]},"timestamp":"%s","cwd":"%s","sessionId":"%s"}\n' \
      "$n" "$(json_str "$cmd")" "$(ago "$m")" "$2" "$3" >> "$file"
    printf '{"type":"user","isSidechain":false,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_demo%s","content":%s,"is_error":%s}]},"timestamp":"%s","cwd":"%s","sessionId":"%s"}\n' \
      "$n" "$(json_str "$out")" "$err" "$(ago "$m")" "$2" "$3" >> "$file"
  done <<'CMDS' # command|is_error|result
git status --short|false|M src/cart.ts
npx prisma migrate dev --name coupon|false|Applied migration 20261121_coupon
npm test -- src/cart.test.ts|false|3 passed
npm run lint|true|src/coupon.ts: 'COUPONS' is never reassigned
npm run lint -- --fix|false|done
npm test|false|5 passed
CMDS
  touch -t "$(date -v-"$m"M +%Y%m%d%H%M.%S)" "$file" # keep the session's age
}

SHOP_PORT=47173
python3 -m http.server "$SHOP_PORT" --bind 127.0.0.1 --directory "$FIX/shop" >/dev/null 2>&1 &
SHOP_PID=$!
trap 'kill "$SHOP_PID" 2>/dev/null || true' EXIT

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
  # In-app preview (T33): web-shop's launch.json points at the demo shop page served below.
  mkdir -p "$P/web-shop/.claude"
  printf '{ "version": "0.0.1", "configurations": [{ "name": "web", "port": %s }] }\n' "$SHOP_PORT" > "$P/web-shop/.claude/launch.json"
  demo_repo "$P/web-shop" \
    "src/cart.ts:export function total(items: { price: number }[]) {\n  return items.reduce((sum, i) => sum + i.price, 0);\n}\n" \
    "src/checkout.ts:import { total } from './cart';\n\nexport const pay = (items: { price: number }[]) => total(items);\n" \
    "prisma/schema.prisma:model Order {\n  id    Int @id\n  total Int\n}\n" \
    "README.md:# web-shop\n"
  # Uncommitted work for the changes panel (the schema change gets a risk badge and goes to the top, T57).
  printf '%b' "export function total(items: { price: number }[], coupon?: number) {\n  const sum = items.reduce((s, i) => s + i.price, 0);\n  return coupon ? Math.max(0, sum - coupon) : sum;\n}\n" > "$P/web-shop/src/cart.ts"
  printf '%b' "export const COUPONS: Record<string, number> = { WELCOME: 5 };\n" > "$P/web-shop/src/coupon.ts"
  printf '%b' "model Order {\n  id     Int     @id\n  total  Int\n  coupon String?\n}\n" > "$P/web-shop/prisma/schema.prisma"
  demo_repo "$P/api-server" "orders/total.ts:export const total = (n: number) => Math.round(n * 100) / 100;\n" "README.md:# api-server\n"
  demo_repo "$P/docs-site" "guide/index.md:# Guide\n" "README.md:# docs-site\n"
  demo_repo "$P/mobile-app" "app/settings.tsx:export default function Settings() {}\n" "README.md:# mobile-app\n"
  # Notes kept in each repo its own way (T73): the graph finds them with no setup.
  python3 -I "$ROOT/scripts/capture/demo_notes.py" "$P" "$lang"

  # Past sessions for the history panel (T11): Claude transcripts per account and codex rollouts, dated relative to now.
  demo_history "$home" "$lang"
  # Commands timeline (T59): the coupon session ran a few Bash commands (one failed).
  demo_commands "$home/.claude" "$P/web-shop" 0b6f3a52-1d2e-4c6b-9a51-2f0e7c1d0a01 24

  echo "[capture] $lang in $home"
  # No TERM_PROGRAM/TERM_SESSION_ID from the terminal you run this in: macOS zsh would print "Restored session".
  env -u TERM_PROGRAM -u TERM_SESSION_ID -u TERM_PROGRAM_VERSION \
    HOME="$home" ZDOTDIR="$home" SHELL=/bin/zsh AQUILA_SMOKE=1 AQUILA_CAPTURE="$OUT" AQUILA_HIDDEN="${AQUILA_HIDDEN:-}" \
    "$ROOT/node_modules/.bin/electron" "$ROOT"
  rm -rf "$home"
done
