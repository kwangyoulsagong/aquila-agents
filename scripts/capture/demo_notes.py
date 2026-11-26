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
