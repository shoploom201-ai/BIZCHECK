/* [앱 설치] 버튼 — data-install 속성이 붙은 버튼/링크 (홈 화면, 출퇴근 화면)
 *  - 크롬·엣지에서 https(또는 localhost)로 열었을 때: 브라우저의 설치 창을 띄웁니다.
 *  - 설치할 수 없는 상황(파일로 열기, 사파리 등)에는 방법을 안내합니다.
 *  - 이미 설치된 앱 창에서는 버튼이 보이지 않습니다 (css: display-mode standalone).
 */
(function () {
  'use strict';
  let deferred = null;

  // 파일로 연 경우(바탕 화면 바로가기 등)는 브라우저가 앱 설치를 허용하지 않으므로 버튼을 숨김.
  // 바탕 화면 바로가기 자체가 설치된 앱과 같은 역할을 합니다.
  if (location.protocol === 'file:') document.documentElement.classList.add('no-install');

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    document.documentElement.classList.add('app-installed');
  });

  function guide() {
    const ua = navigator.userAgent;
    if (location.protocol === 'file:') {
      return '지금은 파일로 열어서 앱 설치를 할 수 없습니다.\n\n'
        + '· 바탕 화면의 "간편 근퇴관리 (엣지)" 또는 "(크롬)" 바로가기로 실행하거나\n'
        + '· 인터넷 주소(https://…)로 접속한 뒤 다시 눌러주세요.';
    }
    if (/iPhone|iPad|iPod/.test(ua)) return '사파리 아래쪽 [공유] 버튼 → [홈 화면에 추가]를 누르세요.';
    if (/Edg\//.test(ua)) return '주소창 오른쪽의 앱 설치 아이콘을 누르거나,\n메뉴(⋯) → [앱] → [이 사이트를 앱으로 설치]를 누르세요.\n\n이미 설치했다면 바탕 화면이나 시작 메뉴에서 실행하세요.';
    if (/Chrome\//.test(ua)) return '주소창 오른쪽의 설치 아이콘을 누르거나,\n메뉴(⋮) → [저장 및 공유] → [앱 설치]를 누르세요.\n\n이미 설치했다면 바탕 화면이나 시작 메뉴에서 실행하세요.';
    return '이 브라우저는 앱 설치를 지원하지 않습니다. 크롬이나 엣지에서 열어주세요.';
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-install]');
    if (!b) return;
    e.preventDefault();
    if (deferred) {
      const p = deferred;
      deferred = null;
      p.prompt();
      const r = await p.userChoice.catch(() => null);
      if (r && r.outcome === 'accepted') document.documentElement.classList.add('app-installed');
      return;
    }
    alert(guide());
  });
})();
