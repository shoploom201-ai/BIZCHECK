// 가이드 글 생성기:  node tools/build-guides.mjs
//  content/guides/<slug>.html (본문만) → guide-<slug>.html (머리말·목차·계산기·관련 글·꼬리말 포함)
//  그리고 전체 목록 페이지 guides.html 을 만듭니다.
//  본문 첫 줄: <!--meta {"slug","title","h1","summary","desc","cat","laws":[{"name","url"}],"related":["slug"]} -->
//  본문 안의 <!--AD--> 자리에 본문 광고 슬롯이 들어갑니다.
//  만든 뒤 광고 ID가 있다면 node tools/build-pages.mjs 도 실행하세요.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'content', 'guides');
const WRITTEN = '2026년 11월 작성';

// 손으로 쓴 기존 가이드 (목록·관련 글에 함께 표시)
const HANDWRITTEN = [
  { slug: 'howto', h1: '5분 시작 가이드', summary: '처음 설정부터 월말 명세서 출력까지 순서대로', cat: '프로그램 사용법' },
  { slug: 'juhyu', h1: '주휴수당 계산법과 조건 총정리', summary: '주 15시간 기준, 개근 조건, 단시간 근로자 계산', cat: '임금·수당' },
  { slug: 'overtime', h1: '연장·야간·휴일근로수당 계산법', summary: '1.5배·2배가 붙는 경우와 겹칠 때 계산, 5인 미만 예외', cat: '임금·수당' },
  { slug: 'monthly-wage', h1: '시급으로 월급 계산하기', summary: '209시간의 의미와 2026년 최저임금 월 환산액', cat: '임금·수당' },
];
const CATS = ['임금·수당', '근로시간·휴가', '계약·퇴직', '4대보험·세금', '가게 운영 팁', '프로그램 사용법'];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function header(current) {
  const a = (href, label) => `      <a href="${href}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`;
  return `  <a class="skip" href="#main">본문 바로가기</a>
  <header class="site-head"><div class="wrap">
    <a class="logo" href="index.html"><img src="icon.svg" alt="">간편 근퇴관리</a>
    <nav class="site-nav" aria-label="주요 메뉴">
${a('guide-howto.html', '사용법')}
${a('guides.html', '가이드 모음')}
${a('guide-juhyu.html', '주휴수당')}
${a('guide-overtime.html', '가산수당')}
${a('guide-monthly-wage.html', '월급 계산')}
      <a class="cta" href="app.html">프로그램 시작</a>
    </nav>
  </div></header>`;
}

const FOOTER = `  <footer class="site-foot"><div class="wrap">
    <nav aria-label="사이트 정보">
      <a href="index.html">소개</a>
      <a href="guide-howto.html">사용법</a>
      <a href="guides.html">가이드 모음</a>
      <a href="guide-juhyu.html">주휴수당</a>
      <a href="guide-overtime.html">가산수당</a>
      <a href="guide-monthly-wage.html">월급 계산</a>
      <a href="about.html">운영자 소개·문의</a>
      <a href="privacy.html">개인정보처리방침</a>
    </nav>
    <p>간편 근퇴관리는 소규모 사업장을 위한 무료 도구입니다. 계산 결과와 가이드는 참고용이며 법률 자문이 아닙니다.</p>
  </div></footer>`;

function head(title, desc) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="theme-color" content="#2449a8">
  <link rel="icon" href="icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="css/site.css">
  <!-- adsense:start --><!-- adsense:end -->
</head>
<body>`;
}

// ---- 본문 읽기 ----
const guides = readdirSync(srcDir).filter(f => f.endsWith('.html')).sort().map(f => {
  const raw = readFileSync(join(srcDir, f), 'utf8');
  const m = raw.match(/^\s*<!--meta\s+([\s\S]*?)\s*-->/);
  if (!m) throw new Error(`meta 주석이 없습니다: ${f}`);
  const meta = JSON.parse(m[1]);
  for (const k of ['slug', 'title', 'h1', 'summary', 'desc', 'cat']) if (!meta[k]) throw new Error(`${f}: meta.${k} 없음`);
  if (!CATS.includes(meta.cat)) throw new Error(`${f}: 알 수 없는 분류 ${meta.cat}`);
  return { ...meta, body: raw.slice(m[0].length).trim() };
});
const all = [...HANDWRITTEN, ...guides];
const bySlug = Object.fromEntries(all.map(g => [g.slug, g]));
const card = g => `<a class="card" href="guide-${g.slug}.html"><strong>${esc(g.h1)}</strong><span>${esc(g.summary)}</span></a>`;

// ---- 글 페이지 ----
for (const g of guides) {
  const toc = [...g.body.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(x => `<li><a href="#${x[1]}">${x[2].replace(/<[^>]+>/g, '')}</a></li>`);
  const body = g.body.replace('<!--AD-->', '<div class="ad-slot" data-slot hidden></div>');
  const related = (g.related || []).filter(s => bySlug[s] && s !== g.slug).slice(0, 4);
  const laws = (g.laws || []).map(l => `<a href="${esc(l.url)}" rel="noopener">${esc(l.name)}</a>`).join(' · ');
  const html = `${head(`${g.title} — 간편 근퇴관리`, g.desc)}
${header('')}

  <main id="main" class="wrap">
    <p class="crumb"><a href="index.html">홈</a> › <a href="guides.html">가이드 모음</a> › ${esc(g.cat)}</p>
    <article class="post">
      <div class="post-head">
        <h1>${esc(g.h1)}</h1>
        <p class="summary">${esc(g.summary)}</p>
        <p class="byline">${g.basis ? esc(g.basis) + ' · ' : ''}${WRITTEN}</p>
      </div>
${toc.length > 2 ? `
      <nav class="toc" aria-label="목차"><strong>목차</strong>
        <ol>
          ${toc.join('\n          ')}
        </ol>
      </nav>
` : ''}
      <div class="ad-slot" data-slot hidden></div>
${body}

      <div class="ad-slot" data-slot hidden></div>
      <div class="cta-box">
        <div><strong>${esc(g.ctaTitle || '출퇴근 기록부터 명세서까지 한 번에')}</strong><p>${esc(g.ctaText || '간편 근퇴관리는 직원번호로 출퇴근을 찍고, 수당과 공제를 계산해 엑셀 월급명세서로 출력합니다.')}</p></div>
        <a class="btn" href="app.html">프로그램 시작</a>
      </div>

      <p class="disclaimer">${g.disclaimer ? esc(g.disclaimer) : `이 글은 ${WRITTEN.replace(' 작성', '')} 기준 법령과 고용노동부 자료를 바탕으로 정리한 일반 정보이며 법률 자문이 아닙니다.${laws ? ` 근거 법령: ${laws}.` : ''} 개별 사안은 고용노동부 고객상담센터(국번 없이 1350)나 공인노무사에게 확인하세요.`}</p>
${related.length ? `
      <section class="related">
        <h2>함께 보면 좋은 글</h2>
        <div class="cards">
          ${related.map(s => card(bySlug[s])).join('\n          ')}
        </div>
      </section>` : ''}
    </article>
  </main>

${FOOTER}
${/class="calc"/.test(body) ? '  <script src="js/calc.js"></script>\n' : ''}  <script src="js/ads.js"></script>
</body>
</html>
`;
  writeFileSync(join(root, `guide-${g.slug}.html`), html);
}

// ---- 가이드 모음 ----
const sections = CATS.map(cat => {
  const list = all.filter(g => g.cat === cat);
  if (!list.length) return '';
  return `
    <section class="section"><div class="wrap">
      <h2>${esc(cat)}</h2>
      <div class="cards">
        ${list.map(card).join('\n        ')}
      </div>
    </div></section>`;
}).join('');
writeFileSync(join(root, 'guides.html'), `${head('급여·노무 가이드 모음 (2026년) — 간편 근퇴관리', '주휴수당, 연장수당, 연차, 퇴직금, 4대보험, 최저임금, 근로계약서부터 식자재 구매처, 알바 구인, 세금 일정까지 작은 가게 사장님이 알아야 할 정보를 2026년 기준으로 정리했습니다.')}
${header('guides.html')}

  <main id="main">
    <div class="wrap">
      <p class="crumb"><a href="index.html">홈</a> › 가이드 모음</p>
      <div class="post-head">
        <h1>급여·노무·가게 운영 가이드 모음</h1>
        <p class="summary">작은 가게를 운영하며 자주 막히는 급여 계산과 노무 기준을 2026년 기준으로 정리했습니다. 대부분의 글에 바로 숫자를 넣어 볼 수 있는 계산기가 있습니다.</p>
      </div>
    </div>${sections}
  </main>

${FOOTER}
  <script src="js/ads.js"></script>
</body>
</html>
`);

console.log(`완료: 가이드 ${guides.length}편 생성 + guides.html (전체 ${all.length}편)`);
