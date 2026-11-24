// AdSense 게시자 ID를 js/ads.js 에 넣은 뒤 실행:  node tools/build-pages.mjs
//  - 모든 루트 *.html 의 <!-- adsense:start --> ~ <!-- adsense:end --> 사이에
//    승인 확인용 메타태그와 광고 스크립트를 넣습니다 (ID가 비어 있으면 비웁니다).
//  - 사이트 루트에 ads.txt 를 만듭니다.
//  - 여러 번 실행해도 결과가 같습니다.
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adsJs = readFileSync(join(root, 'js/ads.js'), 'utf8');
const client = (adsJs.match(/client:\s*'([^']*)'/) || [])[1] || '';

if (client && !/^ca-pub-\d{10,20}$/.test(client)) {
  console.error(`js/ads.js 의 client 값이 올바르지 않습니다: "${client}" (예: ca-pub-1234567890123456)`);
  process.exit(1);
}

const snippet = client
  ? `<!-- adsense:start --><meta name="google-adsense-account" content="${client}">` +
    `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script><!-- adsense:end -->`
  : '<!-- adsense:start --><!-- adsense:end -->';

const marker = /<!-- adsense:start -->[\s\S]*?<!-- adsense:end -->/;
let changed = 0;
for (const f of readdirSync(root).filter(n => n.endsWith('.html'))) {
  const p = join(root, f);
  const html = readFileSync(p, 'utf8');
  if (!marker.test(html)) { console.warn(`건너뜀 (표시 없음): ${f}`); continue; }
  const next = html.replace(marker, snippet);
  if (next !== html) { writeFileSync(p, next); changed++; }
}

const adsTxt = join(root, 'ads.txt');
if (client) {
  writeFileSync(adsTxt, `google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
} else if (existsSync(adsTxt)) {
  unlinkSync(adsTxt);
}

console.log(client
  ? `완료: ${changed}개 페이지 갱신, ads.txt 생성 (${client})`
  : `AdSense ID가 비어 있어 광고 태그를 비웠습니다 (${changed}개 페이지 갱신).`);

// ---- 검색 등록용 sitemap.xml / robots.txt ----
// site.config.json 의 siteUrl (예: "https://geuntae.kr") 을 넣으면 만들어집니다.
let siteUrl = '';
try { siteUrl = String(JSON.parse(readFileSync(join(root, 'site.config.json'), 'utf8')).siteUrl || '').trim().replace(/\/+$/, ''); } catch { /* 설정 없음 */ }
if (siteUrl && !/^https:\/\/[^/\s]+$/.test(siteUrl)) {
  console.error(`site.config.json 의 siteUrl 이 올바르지 않습니다: "${siteUrl}" (예: https://geuntae.kr)`);
  process.exit(1);
}
const NOINDEX = new Set(['app.html']); // 프로그램 화면은 검색 노출 제외
const pages = readdirSync(root).filter(n => n.endsWith('.html') && !NOINDEX.has(n)).sort((a, b) =>
  (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
const sitemapPath = join(root, 'sitemap.xml');
if (siteUrl) {
  const urls = pages.map(f => {
    // Cloudflare Pages·Netlify 는 /x.html → /x 로 리디렉트하므로 최종 주소(.html 없음)를 씁니다
    const loc = f === 'index.html' ? `${siteUrl}/` : `${siteUrl}/${f.replace(/\.html$/, '')}`;
    const lastmod = statSync(join(root, f)).mtime.toISOString().slice(0, 10);
    const pri = f === 'index.html' ? '1.0' : f === 'guides.html' ? '0.9' : f.startsWith('guide-') ? '0.8' : '0.5';
    return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><priority>${pri}</priority></url>`;
  });
  writeFileSync(sitemapPath, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
} else if (existsSync(sitemapPath)) {
  unlinkSync(sitemapPath);
}
writeFileSync(join(root, 'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /app\n${siteUrl ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ''}`);
console.log(siteUrl
  ? `sitemap.xml (${pages.length}개 페이지), robots.txt 생성 — ${siteUrl}`
  : 'robots.txt 생성 (site.config.json 에 siteUrl 을 넣으면 sitemap.xml 도 만들어집니다)');
