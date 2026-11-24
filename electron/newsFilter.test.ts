import { describe, expect, it } from 'vitest';
import { isBusiness, isTechnical, itemScore, MIN_SCORE, techScore } from './newsFilter';
import type { NewsSourceId } from '../src/shared/api/types';

const item = (source: NewsSourceId, title: string, excerpt = '', url = 'https://example.com/post') => ({
  source,
  title,
  excerpt,
  url,
});

describe('business titles', () => {
  it.each([
    'Jensen Huang returns as Nvidia CEO, stock jumps 31%',
    'Nvidia shares soar after Huang comeback',
    'Anysphere raises $2B at a $30B valuation',
    'Mistral AI in talks for Series C funding',
    'Scaling Linear’s GTM to $100M ARR — Cristina Cordova, COO',
    'Amazon acquires Descartes for $7B',
    'OpenAI and Le Figaro partner to bring journalism to ChatGPT',
    'Authors sue Anthropic over training data',
    'Meta lays off 600 from its AI unit',
    'Senate pushes export controls on AI chips',
    'Microsoft signs 5 gigawatt data center deal',
    'Richpanel helps companies automate 50% of support in 30 days',
  ])('drops "%s"', (title) => expect(isBusiness(title)).toBe(true));

  it.each([
    '젠슨 황 복귀에 엔비디아 주가 31% 급등…AI 관련주 동반 반등',
    '고객 서비스 AI 기업 시에라, 17.5억달러 투자 유치…기업가치 두 배로',
    '아마존, 데카르트의 AI 최적화 기술 10조원에 인수…창업자도 영입',
    '미 2개 주, 그록의 아동 성착취물 생성 문제로 스페이스X 제소',
    '엔비디아 CEO 후보였던 르네 하스, Arm CEO 2033년까지 연임',
    '미국, 알리바바 계열사도 블랙리스트 등재',
    '정부, 중소 제조기업 AI 도입 지원 확대',
    '삼성전자, 2027 임원인사…반도체 인재 중용',
    'LG, 업무협약 체결로 AI 데이터센터 구축',
  ])('drops "%s"', (title) => expect(isBusiness(title)).toBe(true));

  it.each([
    'Claude Code hooks deep dive',
    'LLM as a judge: building reliable evals',
    'RL policy optimization for coding agents',
    'Design by contract for agent tool calls',
    'Why the PreToolUse hook fired twice',
    'Intent Contracts: Taking Tools Away from Agents',
    'llama.cpp v1.0.0 : A stronger foundation for the local AI ecosystem',
    '함수 인수를 타입으로 검증하기',
    '저전력 모델로 온디바이스 추론하기',
    '토큰 예산 안에서 컨텍스트 설계하기',
    '수상한 패키지를 찾는 에이전트 만들기',
    '주니어를 성장시키는 파트너십 대화법',
    'Kanana-2-v-decide 오픈소스 공개',
  ])('keeps "%s"', (title) => expect(isBusiness(title)).toBe(false));
});

describe('technical score', () => {
  it('rewards things you can install, read or follow', () => {
    expect(techScore('Show HN: a CLI that runs Claude Code in a sandbox')).toBeGreaterThanOrEqual(5);
    expect(techScore('Introducing the Responses API SDK')).toBeGreaterThanOrEqual(3);
    expect(techScore('Qwen 4 open-weights release with benchmarks')).toBeGreaterThanOrEqual(5);
    expect(techScore('KV 캐시 오프로딩 구축기: 추론 비용 줄이기')).toBeGreaterThanOrEqual(4);
  });

  it('counts the link: GitHub, arXiv and Hugging Face are signals', () => {
    expect(itemScore(item('hn', 'Fast diffing', '', 'https://github.com/a/b'))).toBe(
      itemScore(item('hn', 'Fast diffing')) + 2,
    );
  });

  it('opinion, culture and company news score low', () => {
    expect(techScore('AI is becoming a climate disaster')).toBe(0);
    expect(techScore('What I learned from 10 years of startups')).toBe(0);
    expect(techScore('The AI bubble and the future of work')).toBe(0);
  });
});

describe('isTechnical', () => {
  it('general news sources need a real technical signal', () => {
    expect(MIN_SCORE.hn).toBeGreaterThan(1);
    expect(isTechnical(item('hn', 'Ask HN: Is AI overhyped?'))).toBe(false);
    expect(isTechnical(item('hn', 'The AI bubble and the future of work'))).toBe(false);
    expect(
      isTechnical(item('hn', 'Show HN: Open-source MCP server for Postgres', '', 'https://github.com/x/y')),
    ).toBe(true);
    expect(
      isTechnical(item('openai', 'Hebbia sees improvements in financial research with GPT-6 Astra')),
    ).toBe(false);
    expect(
      isTechnical(
        item('openai', 'How OpenAI’s Performance Factory keeps ChatGPT fast', 'How we profile inference'),
      ),
    ).toBe(true);
  });

  it('dev blogs, release feeds, papers and repos only lose business titles', () => {
    expect(isTechnical(item('cursor', 'Voice chat'))).toBe(true);
    expect(isTechnical(item('naver-d2', '온톨로지, 구축에서 활용까지'))).toBe(true);
    expect(
      isTechnical(item('latent-space', 'Scaling Linear’s GTM to $100M ARR — Cristina Cordova, COO')),
    ).toBe(false);
    expect(isTechnical(item('geeknews', '젠슨 황 복귀에 엔비디아 주가 급등'))).toBe(false);
  });

  it('GeekNews needs at least one signal', () => {
    expect(isTechnical(item('geeknews', 'AI가 기후에 재앙이 되어가고 있다'))).toBe(false);
    expect(
      isTechnical(item('geeknews', 'Words - AI 응답을 실시간으로 표시하는 Markdown 렌더러', '코드')),
    ).toBe(true);
  });
});
