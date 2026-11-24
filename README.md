# 간편 근퇴관리

소규모 사업장용 출퇴근·급여 관리 웹앱입니다. 설치나 서버 없이 동작하며, **모든 데이터는 사용하는 PC의 브라우저(IndexedDB)에만 저장**됩니다.

## 기능

- **출퇴근 화면(키오스크)**: 직원번호를 입력한 뒤 출근 또는 퇴근을 누릅니다. 지각과 연장근무는 즉시 안내됩니다.
- **직원 관리**: 직원번호, 이름, 직급, 시급제/월급제, 근무요일과 출퇴근 시간, 휴게시간을 관리하고 최저임금 미달 시 경고합니다.
- **자동 계산**: 지각, 조퇴, 결근, 연장근로(1일 8시간·주 40시간 초과), 야간근로(22~06시), 휴일근로, 주휴수당을 계산합니다.
- **수당 배수**: 기본값은 법정 기준(1.5 / +0.5 / 1.5 / 2.0)이며 조절할 수 있고, **5인 미만 사업장** 스위치도 있습니다.
- **연차·월차**: 직원별 부여일수(법정 참고값 제공), 사용 등록, 잔여일수를 관리합니다.
- **월급명세서 엑셀**: 급여대장과 직원별 명세서를 만들며, 지각·조퇴·연장·결근·미기록은 **빨간색**으로 표시합니다.
- **관리자 비밀번호**, 기록 수정 사유와 **수정 이력**, **백업/복원**, 10분 미사용 시 자동 잠금을 지원합니다.
- PWA라서 "앱 설치"로 바탕화면에 아이콘을 만들 수 있고, 오프라인에서도 실행됩니다.

## 내 PC에서 실행해 보기

```bash
python -m http.server 8765
# 브라우저에서 http://localhost:8765 (소개 페이지) → [프로그램 시작] 또는 /app.html
```

**바탕 화면 바로가기**: `바로가기 만들기.bat`을 더블클릭하고 엣지/크롬/둘 다 중에서 고르면, 주소창 없는 앱 창으로 여는 바로가기가 생깁니다. 직원·출퇴근 데이터는 브라우저마다 따로 저장되니 평소 쓰는 브라우저를 고르세요.

`app.html`(프로그램)을 더블클릭해도 동작하지만, 오프라인 설치(PWA) 기능은 http/https로 열었을 때만 켜집니다.

## 배포 (무료)

이 폴더를 그대로 정적 호스팅에 올리면 됩니다. `tests/`, `tools/` 폴더는 올리지 않아도 됩니다.

- **Cloudflare Pages** 또는 **Netlify**: 사이트에서 폴더를 드래그 앤 드롭
- **GitHub Pages**: 저장소에 올린 뒤 Settings → Pages

AdSense를 쓰려면 **직접 소유한 도메인**(예: `mygeuntae.com`)을 연결하는 것이 좋습니다.

> 파일을 수정해 다시 배포할 때는 `sw.js`의 `VERSION`(예: `geuntae-v8`)을 올려주세요.

## 배포 → 검색 등록 → AdSense 순서

소개 페이지, 가이드 20편(노무 14편 + 가게 운영 팁 6편), 운영자 소개·문의, 개인정보처리방침이 들어 있습니다. 문의 이메일은 `about.html`, `privacy.html` 두 곳에 있습니다.

**1. 도메인 연결과 배포**
1. 도메인을 하나 삽니다 (예: `geuntae.kr`). AdSense는 직접 소유한 도메인이 유리합니다.
2. `site.config.json`의 `siteUrl`에 주소를 넣습니다. 예: `"siteUrl": "https://geuntae.kr"`
3. `node tools/build-pages.mjs` 실행 → `sitemap.xml`, `robots.txt`가 만들어집니다.
4. 폴더를 Cloudflare Pages / Netlify 등에 올리고 도메인을 연결합니다 (`tests/`, `tools/`, `content/`는 올리지 않아도 됩니다).

**2. 검색엔진 등록 (배포 직후)**
- **Google 서치 콘솔** (search.google.com/search-console): 도메인 소유 확인 → [Sitemaps]에 `sitemap.xml` 제출.
- **네이버 서치어드바이저** (searchadvisor.naver.com): 사이트 등록·소유 확인 → [요청 → 사이트맵 제출]에 `sitemap.xml` 제출.
- 2~4주 정도 지나 검색 유입이 조금씩 생기면 AdSense를 신청합니다.

**3. AdSense 신청**
1. AdSense에 사이트를 추가합니다.
2. `js/ads.js`의 `client`에 게시자 ID(`ca-pub-…`)를 넣고 `node tools/build-pages.mjs`를 다시 실행합니다. 모든 페이지 `<head>`에 확인용 태그가 들어가고 `ads.txt`가 만들어집니다. 다시 배포하고 [검토 요청]을 누릅니다.
3. 심사 중에는 `appAds: false`(기본값)로 두어 출퇴근 화면에는 광고를 넣지 않습니다.
4. 승인 후 광고 단위를 만들어 `articleSlot`(가이드 본문 광고)에 넣습니다. 출퇴근 화면 광고를 원하면 `appAds: true` + `appSlot`을 넣습니다.
5. 자동 광고를 켠다면 AdSense의 '페이지 제외'에 `app.html`을 추가하세요.

**가이드 글 추가·수정**: `content/guides/`에 본문 파일을 추가하거나 고친 뒤 `node tools/build-guides.mjs` → `node tools/build-pages.mjs` 순서로 실행합니다.

실수로 누르게 만드는 광고 배치, 자동 새로고침, 본인이나 직원의 클릭은 정책 위반(계정 정지 사유)입니다.

## 데이터 주의사항

- 데이터는 그 PC의 그 브라우저에만 있습니다. 브라우저 데이터 삭제, PC 교체, 브라우저 변경, 시크릿 창 사용 시 사라질 수 있습니다. **[관리자 → 백업]으로 주기적으로 백업**하세요 (7일이 지나면 경고가 뜹니다).
- 관리자 비밀번호는 분실하면 복구할 수 없습니다.
- 공제는 직원별로 고릅니다: 없음 / 4대보험(요율로 계산한 예상액, 그 달 고지액으로 덮어쓰기 가능) / 3.3%. 4대보험 요율은 [설정]에 2026년 값이 들어 있으니 매년 확인해 고치세요. 근로소득세는 간이세액표에 따라 달라 [수당·공제]의 기타 공제에 직접 입력합니다.
- 시급이나 월급을 바꾸면 지난 달도 새 금액으로 다시 계산되므로, 지난 달 명세서는 미리 엑셀로 저장해 두세요.

## 구조

```
index.html            소개(홈) 페이지
guides.html           가이드 모음 (자동 생성)
guide-*.html          사용법·급여·노무 가이드 (howto/juhyu/overtime/monthly-wage는 직접 작성, 나머지는 자동 생성)
content/guides/       자동 생성 가이드의 본문 → node tools/build-guides.mjs 로 페이지 생성
privacy.html          개인정보처리방침
about.html            운영자 소개 · 문의
app.html              프로그램 화면 (검색 노출 제외)
css/site.css          소개·가이드 페이지 스타일
css/style.css         프로그램 스타일
js/calc.js            가이드 페이지 계산기
img/app-kiosk.png     홈 화면용 스크린샷
tools/build-pages.mjs AdSense 태그·ads.txt·sitemap.xml·robots.txt 생성
site.config.json      사이트 주소 (sitemap용)
tools/build-guides.mjs 가이드 페이지·가이드 모음 생성
tools/make-shortcut.ps1 바탕 화면 바로가기 생성 (바로가기 만들기.bat)
js/app.js             화면·동작
js/payroll.js         근태·급여 계산 (순수 함수)
js/xlsx-lite.js       엑셀(.xlsx) 생성기 (외부 라이브러리 없음)
js/store.js           IndexedDB 저장
js/sha256.js          비밀번호 해시
js/ads.js             광고 설정
sw.js, manifest.webmanifest, icon.svg   PWA
tests/payroll.test.js 계산 로직 테스트 (node --test tests/)
```
