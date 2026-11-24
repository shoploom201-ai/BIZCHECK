/* 광고 설정 — 사이트 전체(프로그램 + 가이드 페이지) 공용. 값은 여기 한 곳에서만 바꿉니다.
 *
 *  client      : 'ca-pub-0000000000000000'  AdSense 게시자 ID
 *                → 넣은 뒤 `node tools/build-pages.mjs` 를 다시 실행하면 모든 페이지 <head>에
 *                  승인 확인용 메타태그/스크립트, ads.txt 가 자동으로 들어갑니다.
 *  appSlot     : 프로그램 화면(app.html) 하단 배너 광고 단위 ID (승인 후에 넣으세요)
 *  articleSlot : 가이드 글 본문 중간 광고 단위 ID (비워두면 '자동 광고'만 사용)
 *
 * AdSense 정책 주의
 *  - 출퇴근 버튼/키패드 근처에 광고 금지 (실수 클릭 유도). 프로그램 화면은 하단 고정 배너만 사용합니다.
 *  - 자동 광고를 켤 경우 AdSense > 광고 > 사이트별 설정 > '페이지 제외'에 app.html 을 추가하세요.
 *  - 광고 자동 새로고침, 본인·직원 클릭은 무효 트래픽(계정 정지 사유)입니다.
 */
window.AD_CONFIG = {
  client: '',
  appSlot: '',
  articleSlot: '',
  // 프로그램(출퇴근) 화면 하단 광고 켜기/끄기.
  //  - AdSense 심사 중에는 false 권장: 시계·키패드만 있는 화면은 '콘텐츠가 없는 화면'으로 보일 수 있습니다.
  //  - 승인 후 켜려면 true + appSlot 입력. 직원이 광고를 누르지 않도록 안내하세요(무효 클릭).
  appAds: false,
};

(function () {
  'use strict';
  const cfg = window.AD_CONFIG || {};
  const online = location.protocol.startsWith('http') && navigator.onLine;
  const appBox = document.getElementById('ad-bottom');
  const inline = Array.from(document.querySelectorAll('.ad-slot[data-slot]'));

  const ready = !!(cfg.client && online);
  if (ready && !document.querySelector('script[src*="adsbygoogle.js"]')) {
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(cfg.client);
    document.head.appendChild(s);
  }

  function place(box, slot, style, format) {
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.cssText = style;
    ins.setAttribute('data-ad-client', cfg.client);
    ins.setAttribute('data-ad-slot', slot);
    if (format) ins.setAttribute('data-ad-format', format);
    ins.setAttribute('data-full-width-responsive', 'true');
    box.appendChild(ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  }

  // 프로그램 화면 하단 고정 배너
  if (appBox) {
    if (!cfg.appAds) {
      // 광고를 끈 상태: 자리까지 없애고 화면을 아래까지 씀
      appBox.remove();
      document.documentElement.classList.add('no-app-ad');
    } else if (ready && cfg.appSlot) place(appBox, cfg.appSlot, 'display:block;width:100%;height:90px', 'horizontal');
    else appBox.innerHTML = '<span class="ad-ph">광고 영역</span>';
  }

  // 가이드 글 본문 광고 (슬롯 미설정이면 자리 자체를 숨김)
  inline.forEach(box => {
    if (ready && cfg.articleSlot) { box.hidden = false; place(box, cfg.articleSlot, 'display:block', 'auto'); }
    else box.remove();
  });
})();
