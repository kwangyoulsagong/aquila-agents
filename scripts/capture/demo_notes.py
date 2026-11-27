"""Demo notes for the graph guide capture (T73): each demo repo keeps its notes its own way (no shared layout), and
some specs share a feature ID across repos (F012 in web-shop and api-server), so the Map shows repos linked.

Usage: python3 -I demo_notes.py <projects dir> <ko|en>
"""

import os
import sys

root, lang = sys.argv[1], sys.argv[2]
KO = lang == 'ko'

TOPICS = (
    ['쿠폰 할인', '장바구니 합계', '결제 재시도', '주문 내역', '배송 조회', '회원 가입', '비밀번호 재설정',
     '상품 검색', '리뷰 작성', '알림 설정', '환불 처리', '재고 표시', '위시리스트', '포인트 적립']
    if KO else
    ['Coupon discount', 'Cart total', 'Payment retry', 'Order history', 'Delivery tracking', 'Sign-up',
     'Password reset', 'Product search', 'Write a review', 'Notification settings', 'Refunds', 'Stock badge',
     'Wishlist', 'Reward points']
)
DECISIONS = (
    ['금액은 정수 센트로', '주문 ID는 ULID', '결제는 멱등 키로', '푸시는 서버에서만', '검색은 Postgres FTS',
     '세션은 쿠키 대신 토큰', '환불은 비동기 작업', '재고는 캐시 5분']
    if KO else
    ['Money in integer cents', 'Order IDs are ULIDs', 'Payments use idempotency keys', 'Push only from the server',
     'Search on Postgres FTS', 'Tokens instead of cookies', 'Refunds as async jobs', 'Stock cached for 5 minutes']
)
STATUS = {'done': '완료' if KO else 'done', 'doing': '진행 중' if KO else 'in progress'}
RELATED = '관련' if KO else 'Related'


def write(rel, title, body):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(f'# {title}\n\n{body}\n')


def spec(repo, folder, n, topic, status, links):
    title = f'F{n:03d} {topic}'
    body = f'status: {STATUS[status]}\n\n{RELATED}: ' + ', '.join(f'[[{l}]]' for l in links)
    write(f'{repo}/{folder}/{title}.md', title, body)
    return title


adr = [f'ADR-{i + 1} {d}' for i, d in enumerate(DECISIONS)]
for i, name in enumerate(adr):
    write(f'api-server/decisions/{name}.md', name, f'{RELATED}: [[{adr[(i + 1) % len(adr)]}]]')

# web-shop: requirements/specs/{done,in-progress}
for i, topic in enumerate(TOPICS):
    status = 'done' if i < 9 else 'doing'
    sub = 'done' if status == 'done' else 'in-progress'
    spec('web-shop', f'requirements/specs/{sub}', 10 + i, topic, status, [adr[i % len(adr)]])
    spec('web-shop', f'requirements/checklists', 10 + i, f'{topic} ✓', 'done', [f'F{10 + i:03d} {topic}'])
# api-server: same feature IDs (F010…) in its own requirements folder
for i, topic in enumerate(TOPICS[:12]):
    status = 'done' if i < 8 else 'doing'
    sub = 'done' if status == 'done' else 'in-progress'
    spec('api-server', f'requirements/specs/{sub}', 10 + i, f'{topic} API', status,
         [adr[(i + 2) % len(adr)], f'F{10 + i:03d} {topic}'])
    spec('api-server', 'requirements/checklists', 10 + i, f'{topic} API ✓', 'done', [f'F{10 + i:03d} {topic} API'])
# mobile-app: flat notes folder, its own way
for i, topic in enumerate(TOPICS[:10]):
    spec('mobile-app', 'notes', 10 + i, f'{topic} ({"앱" if KO else "app"})', 'doing', [f'F{10 + i:03d} {topic}'])

# Note features (T77–T83): web-shop's login specs with frontmatter (properties, table view, requirement IDs, the
# explorer) and a guide written like a document (blocks, reading mode). FE-REQ-032 is defined twice (a duplicate) and
# FE-REQ-099 nowhere (unknown).
LOGIN = (
    [('로그인 유지', 'doing', '민아', '2026-12-04'), ('소셜 로그인', 'todo', '준', '2026-12-11'),
     ('비밀번호 규칙', 'done', '아라', '2026-11-20'), ('2단계 인증', 'todo', '민아', '2026-12-18'),
     ('로그인 기록', 'doing', '소라', '2026-12-09'), ('계정 잠금', 'done', '준', '2026-11-27')]
    if KO else
    [('Remember me', 'doing', 'mina', '2026-12-04'), ('Social login', 'todo', 'jun', '2026-12-11'),
     ('Password rules', 'done', 'ara', '2026-11-20'), ('Two-step verification', 'todo', 'mina', '2026-12-18'),
     ('Sign-in history', 'doing', 'sora', '2026-12-09'), ('Account lockout', 'done', 'jun', '2026-11-27')]
)
CHECK = '체크리스트' if KO else 'Checklist'
SPEC_BODY = (
    '{topic} 화면과 API를 정해요. FE-REQ-030 다음에 FE-REQ-032 규칙을 따르고, 예전 FE-REQ-099 메모는 지워졌어요.'
    if KO else
    'Defines the {topic} screen and API. Builds on FE-REQ-030, follows FE-REQ-032, and replaces the old FE-REQ-099 memo.'
)
ITEMS = (['화면 시안', 'API 계약', '테스트'] if KO else ['Screen design', 'API contract', 'Tests'])


def front(lines):
    return '---\n' + '\n'.join(lines) + '\n---\n'


def raw(rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


for i, (topic, status, owner, due) in enumerate(LOGIN):
    rid = f'FE-REQ-{30 + i:03d}'
    ticks = ''.join(f'- [{"x" if status == "done" or (status == "doing" and j == 0) else " "}] {item}\n'
                    for j, item in enumerate(ITEMS))
    raw(f'web-shop/specs/login/{rid}.md',
        front([f'id: {rid}', f'status: {status}', f'owner: {owner}', f'due: {due}']) +
        f'# {rid} {topic}\n\n{SPEC_BODY.format(topic=topic)}\n\n## {CHECK}\n\n{ticks}')
raw('web-shop/specs/archive/FE-REQ-032.md',
    front(['id: FE-REQ-032', 'status: done']) + ('# FE-REQ-032 예전 비밀번호 규칙\n\n8자 이상.\n' if KO else
                                                 '# FE-REQ-032 Old password rules\n\nAt least 8 characters.\n'))

FENCE = '`' * 3
if KO:
    guide = f"""# 결제 화면 가이드

결제 화면을 고칠 때 먼저 읽는 문서예요. 요구사항은 [[FE-REQ-030]]에서 시작해요.

> [!NOTE]
> 금액은 항상 정수 센트로 계산해요.

## 순서

1. 장바구니 합계 확인
2. 쿠폰 적용
3. 결제 요청

## 상태

| 단계 | 담당 |
| --- | --- |
| 합계 | 민아 |
| 쿠폰 | 준 |

{FENCE}ts
export const total = (cents: number[]) => cents.reduce((a, b) => a + b, 0);
{FENCE}

- [x] 금액 단위 정하기
- [ ] 쿠폰 테스트 추가

"""
else:
    guide = f"""# Checkout screen guide

Read this first when you change the checkout screen. Requirements start at [[FE-REQ-030]].

> [!NOTE]
> Money is always counted in integer cents.

## Steps

1. Check the cart total
2. Apply the coupon
3. Request payment

## Status

| Step | Owner |
| --- | --- |
| Total | mina |
| Coupon | jun |

{FENCE}ts
export const total = (cents: number[]) => cents.reduce((a, b) => a + b, 0);
{FENCE}

- [x] Decide the money unit
- [ ] Add coupon tests

"""
raw('web-shop/docs/checkout-guide.md', guide)
