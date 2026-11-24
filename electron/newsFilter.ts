// AI trends: what a developer can apply, not corporate news. Deterministic keyword rules (no LLM): a title about
// money, people, courts or politics is dropped from every source; general news sources (OpenAI News, Hacker News)
// must also show enough technical signal (a release, a library, an API, a paper, code on GitHub…). The score also
// decides which items a busy source keeps. Korean words have no `\b`: Hangul isn't a word character.
import type { NewsItem, NewsSourceId } from '../src/shared/api/types';

/**
 * Business, finance, people, courts and politics — matched on the title only (a technical post's body may mention
 * funding or a CEO in passing). Kept specific: "policy" (RL), "contract" (design by contract), "인수" (argument),
 * "파트너십" (a team-talk post), "전력" (low-power), "예산" (token budget), "수상" (suspicious), "judge" (LLM as a
 * judge) and "fired" (a hook fired) are left out on purpose.
 */
export const BUSINESS = new RegExp(
  [
    // Markets and money
    String.raw`\b(?:stocks?|shares? (?:rose|rise|rises|fell|fall|falls|jump\w*|surg\w*|soar\w*|drop\w*|plung\w*|slid\w*|tumbl\w*)|share price|stock price|market (?:cap|value)|wall street|nasdaq|investors?|earnings|revenue|profits?|quarterly results|Q[1-4] results|valuation|valued at|IPO|funding|fundrais\w*|raises? \$|raised \$|series [A-F]\b|venture capital|VCs?|ARR|GTM|go-to-market|unicorn)\b`,
    // Deals
    String.raw`\b(?:acquires?|acquired|acquiring|acquisitions?|mergers?|buyouts?|takeover|partner(?:s|ed|ing)?|partnerships?|teams up|joins? forces|strikes? (?:a )?deal|billion[- ]dollar deal|customer stor(?:y|ies)|case study|helps (?:companies|teams|businesses|enterprises))\b`,
    // People
    String.raw`\b(?:CEO|CFO|COO|chairman|chairwoman|board of directors|executives?|steps? down|stepping down|resigns?|resigned|resignation|ousted|layoffs?|lays off|laid off|hires?|hired|poach\w*|appoint(?:s|ed)|succession|billionaires?|returns? as)\b`,
    // Courts and politics
    String.raw`\b(?:lawsuits?|sue|sues|sued|suing|court|verdict|settlement|antitrust|regulators?|regulation|lawmakers?|congress|senate|white house|government|president trump|trump|tariffs?|sanctions?|export (?:controls?|ban)|blacklist\w*|election\w*|lobby\w*)\b`,
    // Infrastructure deals
    String.raw`\b(?:data ?cent(?:er|re)s?|gigawatts?|power purchase)\b`,
    // Korean: markets and money
    '주가|주식|증시|시총|시가총액|관련주|급등|급락|매출|실적|영업이익|순이익|투자 ?유치|투자를 유치|펀딩|기업가치|밸류에이션|상장|억달러|조원',
    // Korean: deals, people, courts, politics, events
    '인수합병|에 인수|인수했|인수한다|인수 추진|M&A|파트너십 체결|업무 ?협약|MOU|구매 ?계약|공급 ?계약|계약 체결|수주',
    'CEO|대표이사|회장|사임|복귀|취임|연임|임원 ?인사|영입|해고|감원|구조조정',
    '소송|제소|고소|판결|법원|규제|제재|블랙리스트|수출 ?통제|의회|국회|정부|장관|대통령|트럼프|지자체|편성|데이터센터|개최|박람회',
  ].join('|'),
  'i',
);

/** Technical signals with their weight: 2 = something you can install, read the code of, or follow step by step. */
export const TECH_SIGNALS: readonly [RegExp, number][] = [
  // Code and artifacts
  [/github\.com\/|gitlab\.com\/|huggingface\.co\/|arxiv\.org\/|pypi\.org\/|npmjs\.com\//i, 2],
  [/\bShow HN\b/, 2],
  [/\bv?\d+\.\d+(?:\.\d+)?\b(?! ?(?:billion|million|%))/i, 1],
  [/\breleas(?:e|ed|es|ing)\b|\bchangelog\b|\bnow available\b|\bgenerally available\b|\bGA\b/i, 2],
  [/\bopen[- ]?(?:source[sd]?|weights?)\b|오픈 ?소스|오픈 ?웨이트/i, 2],
  [
    /\b(?:librar(?:y|ies)|frameworks?|SDKs?|APIs?|CLIs?|toolkits?|plugins?|extensions?|MCP|servers?|runtimes?|compilers?|kernels?|repo(?:sitor(?:y|ies))?)\b|라이브러리|프레임워크/i,
    2,
  ],
  [
    /\b(?:papers?|benchmarks?|evals?|evaluations?|datasets?|fine[- ]?tun\w*|quantiz\w*|inference|distill\w*|LoRA|MoE|RAG|embeddings?|vector)\b|논문|벤치마크|파인 ?튜닝|추론|양자화/i,
    2,
  ],
  [
    /\b(?:how (?:to|we|i)|tutorial|guide|walkthrough|deep dive|under the hood|lessons learned|post-?mortem|implement\w*|built|building|architecture)\b|구축기|개발기|도입기|적용기|만들기|방법|실전|가이드|튜토리얼|아키텍처|구현/i,
    2,
  ],
  // Topic words: enough together, not alone
  [
    /\b(?:agents?|agentic|prompts?|tokens?|context|harness|sandbox|skills?|hooks?|subagents?|workflows?)\b|에이전트|프롬프트|하네스|컨텍스트|스킬|워크플로/i,
    1,
  ],
  [
    /\b(?:code|coding|developers?|devtools?|IDE|terminal|debug\w*|tests?|testing|refactor\w*|TypeScript|Python|Rust|JavaScript|WebAssembly|Docker|Kubernetes|GPU|CUDA|Postgres\w*|SQL)\b|코드|코딩|개발자|테스트|디버깅/i,
    1,
  ],
  [
    /\b(?:model|LLMs?|GPT-\d[\w.]*|Claude|Gemini|Llama|Qwen|DeepSeek|Mistral|Codex|Copilot|Cursor|introducing|launch(?:es|ed)?)\b|모델/i,
    1,
  ],
];

/**
 * The technical score (title + excerpt + link) a source's items need. General news (OpenAI News, Hacker News) needs a
 * real signal; GeekNews (dev news, already AI-only) just one; release feeds, dev blogs, papers and repos none.
 */
export const MIN_SCORE: Partial<Record<NewsSourceId, number>> = { openai: 3, hn: 3, geeknews: 1 };

/** Sum of the weights of the technical signals found (each signal counts once). */
export function techScore(text: string): number {
  return TECH_SIGNALS.reduce((sum, [re, w]) => sum + (re.test(text) ? w : 0), 0);
}

export const isBusiness = (title: string): boolean => BUSINESS.test(title);

const itemText = (it: Pick<NewsItem, 'title' | 'excerpt' | 'url'>) => `${it.title} ${it.excerpt} ${it.url}`;

export const itemScore = (it: Pick<NewsItem, 'title' | 'excerpt' | 'url'>): number => techScore(itemText(it));

/** Whether an industry item is worth a developer's time: never business news, and its source's minimum score. */
export function isTechnical(it: Pick<NewsItem, 'source' | 'title' | 'excerpt' | 'url'>): boolean {
  if (isBusiness(it.title)) return false;
  return itemScore(it) >= (MIN_SCORE[it.source] ?? 0);
}
