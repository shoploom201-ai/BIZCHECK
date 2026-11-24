/* 간편 근퇴관리 — 화면/동작 */
'use strict';
(function () {
  const P = window.Payroll, X = window.XlsxLite;
  const WD = '일월화수목금토';
  const IDLE_MS = 10 * 60 * 1000; // 관리자 화면 자동 잠금
  const LEAVE_TYPES = [['연차', 1], ['월차', 1], ['반차(오전)', 0.5], ['반차(오후)', 0.5]];
  const TABS = [
    ['today', '오늘 현황'], ['employees', '직원 관리'], ['records', '출퇴근 기록'],
    ['leaves', '연차·월차'], ['payroll', '급여·명세서'], ['settings', '설정'], ['backup', '백업'],
  ];

  const app = document.getElementById('app');
  let S = null;
  let authed = false, view = 'kiosk', tab = 'today';
  let clockTimer = null, idleTimer = null, msgTimer = null, pendingReload = false;
  const ui = { month: P.dateKey(new Date()).slice(0, 7), recQ: '', recScope: 'month', year: new Date().getFullYear() };
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('geuntae') : null;

  const DED_LABEL = { none: '직접 입력', insurance: '4대보험', tax33: '3.3%' };

  // ---------- 유틸 ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => Math.round(n || 0).toLocaleString('ko-KR') + '원';
  const num = n => Math.round(n || 0).toLocaleString('ko-KR');
  const fmtMin = m => {
    m = Math.round(m || 0);
    const h = Math.floor(m / 60), mm = m % 60;
    return h ? (mm ? `${h}시간 ${mm}분` : `${h}시간`) : `${mm}분`;
  };
  const hours = m => Math.round(((m || 0) / 60) * 100) / 100;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => P.dateKey(new Date());
  const dateLabel = k => { const d = P.parseDate(k); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };
  const hm = dt => (dt ? dt.slice(11, 16) : '');
  const outLabel = r => (r.out ? (r.out.slice(0, 10) !== r.date ? '익일 ' : '') + hm(r.out) : '');
  const fmtRange = (a, b) => `${a.replace('T', ' ')} ~ ${b ? b.replace('T', ' ') : '미기록'}`;
  const daysLabel = ds => [1, 2, 3, 4, 5, 6, 0].filter(d => ds.map(Number).includes(d)).map(d => WD[d]).join('');
  const byId = (a, b) => a.id.localeCompare(b.id, 'ko', { numeric: true });
  const bizName = () => S.settings.businessName || '간편 근퇴관리';
  const fail = msg => { throw new Error(msg); };
  const val = (w, id) => { const el = w.querySelector('#' + id); return el ? el.value.trim() : ''; };
  const empById = id => S.employees.find(e => e.id === id);
  const empName = id => { const e = empById(id); return e ? e.name : `(삭제된 직원)`; };
  const activeEmps = () => S.employees.filter(e => e.active !== false).sort(byId);

  // ---------- 상태 ----------
  function defaultState() {
    return {
      app: 'geuntae', schema: 1,
      settings: {
        businessName: '', adminSalt: '', adminHash: '', under5: false, mul: { ...P.LEGAL_MUL },
        clockFormat: '24', lateGraceMin: 0, clipEarly: true, otUnitMin: 0, weeklyHolidayPay: true, holidays: [], lastBackup: null,
      },
      employees: [], records: [], leaves: [], leaveGrants: {}, adjustments: {}, audit: [],
    };
  }
  function normalize(s) {
    const d = defaultState();
    s = Object.assign(d, s || {});
    s.settings = Object.assign(defaultState().settings, s.settings || {});
    s.settings.mul = Object.assign({ ...P.LEGAL_MUL }, s.settings.mul || {});
    ['employees', 'records', 'leaves', 'audit'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
    ['leaveGrants', 'adjustments'].forEach(k => { if (!s[k] || typeof s[k] !== 'object') s[k] = {}; });
    return s;
  }
  async function save() {
    try {
      await Store.set('state', S);
      if (bc) bc.postMessage('saved');
    } catch (e) {
      alert('저장에 실패했습니다: ' + e.message);
      throw e;
    }
  }
  function audit(action, detail) {
    S.audit.unshift({ at: P.toDT(new Date()), action, detail });
    if (S.audit.length > 3000) S.audit.length = 3000;
  }

  // ---------- 공통 UI ----------
  function toast(msg, type = '') {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.className = 'toast show ' + type;
    t.textContent = msg;
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  function closeModal() {
    document.querySelectorAll('.modal-bg').forEach(m => m.remove());
    if (pendingReload) reloadFromStore();
  }
  function openModal(title, body, { okText = '저장', onOk = null, cancelText = '취소', wide = false, danger = false } = {}) {
    document.querySelectorAll('.modal-bg').forEach(m => m.remove());
    const w = document.createElement('div');
    w.className = 'modal-bg';
    w.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3><div class="modal-body">${body}</div><div class="modal-err" role="alert"></div>
      <div class="modal-foot">${cancelText ? `<button type="button" class="btn" data-m="cancel">${cancelText}</button>` : ''}
      ${onOk ? `<button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-m="ok">${okText}</button>` : ''}</div></div>`;
    document.body.appendChild(w);
    let busy = false;
    const submit = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await onOk(w);
        if (r !== false) closeModal();
      } catch (err) {
        w.querySelector('.modal-err').textContent = err.message;
      } finally { busy = false; }
    };
    w.addEventListener('click', e => {
      const m = e.target.dataset && e.target.dataset.m;
      if (m === 'cancel') closeModal();
      if (m === 'ok') submit();
    });
    w.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
      if (e.key === 'Enter' && onOk && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); submit(); }
    });
    const f = w.querySelector('input:not([readonly]):not([type=hidden]),select,textarea');
    if (f) setTimeout(() => f.focus(), 30);
    return w;
  }

  function download(data, filename, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---------- 렌더 ----------
  function render() {
    clearInterval(clockTimer);
    if (view === 'kiosk') renderKiosk(); else renderAdmin();
  }

  // ===== 키오스크(직원 출퇴근 화면) =====
  function renderKiosk() {
    app.innerHTML = `
    <div class="kiosk">
      <header class="k-head">
        <div class="brand">${esc(bizName())}</div>
        <div class="k-head-btns"><button class="btn ghost small" data-install>앱 설치</button>
        <button class="btn ghost small" data-act="toAdmin">관리자</button></div>
      </header>
      <div class="k-main">
        <section class="k-left">
          <div class="clock" id="clock" data-act="clockFmt" role="button" tabindex="-1" title="누르면 24시간제 / 12시간제(AM·PM)로 바뀝니다"></div>
          <div class="cdate" id="cdate"></div>
          <div class="k-msg" id="kmsg" aria-live="polite"><div>직원번호를 입력하고 <b>출근</b> 또는 <b>퇴근</b>을 눌러주세요</div></div>
        </section>
        <section class="k-right">
          <input id="empNo" class="empno" inputmode="numeric" autocomplete="off" placeholder="직원번호" aria-label="직원번호">
          <div class="keypad">
            ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(n => `<button data-act="key" data-k="${n}">${n}</button>`).join('')}
            <button data-act="key" data-k="C" class="fn">지움</button>
            <button data-act="key" data-k="0">0</button>
            <button data-act="key" data-k="B" class="fn" aria-label="한 글자 지우기">←</button>
          </div>
          <div class="punch">
            <button class="btn-in" data-act="punch" data-type="in">출근</button>
            <button class="btn-out" data-act="punch" data-type="out">퇴근</button>
          </div>
        </section>
      </div>
    </div>`;
    const tick = () => {
      const now = new Date();
      const c = document.getElementById('clock');
      if (!c) return;
      const h = now.getHours(), ms = `${P.pad(now.getMinutes())}:${P.pad(now.getSeconds())}`;
      c.innerHTML = S.settings.clockFormat === '12'
        ? `<span class="ampm">${h < 12 ? 'AM' : 'PM'}</span>${h % 12 || 12}:${ms}`
        : `${P.pad(h)}:${ms}`;
      document.getElementById('cdate').textContent = dateLabel(P.dateKey(now));
    };
    tick();
    clockTimer = setInterval(tick, 1000);
    document.getElementById('clock').addEventListener('tick', tick);
    focusEmpNo();
  }
  function focusEmpNo() { const i = document.getElementById('empNo'); if (i) i.focus(); }

  function kmsg(html, type) {
    const m = document.getElementById('kmsg');
    if (!m) return;
    m.className = 'k-msg ' + (type || '');
    m.innerHTML = `<div>${html}</div>`;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => {
      m.className = 'k-msg';
      m.innerHTML = '<div>직원번호를 입력하고 <b>출근</b> 또는 <b>퇴근</b>을 눌러주세요</div>';
    }, 7000);
  }

  let punching = false;
  async function punch(type) {
    if (punching) return;
    const input = document.getElementById('empNo');
    const no = input.value.trim();
    if (!no) { kmsg('직원번호를 입력해주세요', 'warn'); focusEmpNo(); return; }
    const emp = S.employees.find(e => e.id === no && e.active !== false);
    if (!emp) { kmsg('등록되지 않은 직원번호입니다', 'err'); input.select(); return; }
    punching = true;
    try {
      const now = new Date(); now.setSeconds(0, 0);
      const nowS = P.toDT(now);
      const open = S.records.filter(r => r.empId === emp.id && !r.out).sort((a, b) => (a.in < b.in ? 1 : -1))[0];
      const openRecent = open && now - P.parseDT(open.in) < 24 * 3600e3;
      const who = `<b>${esc(emp.name)}</b>${emp.position ? ` <span class="pos">${esc(emp.position)}</span>` : ''}`;

      if (type === 'in') {
        if (openRecent) { kmsg(`${who}님은 이미 출근 처리되었습니다 (${hm(open.in)})`, 'warn'); return; }
        const rec = { id: uid(), empId: emp.id, date: nowS.slice(0, 10), in: nowS, out: null };
        S.records.push(rec);
        await save();
        const d = P.analyzeDays(S.records, emp, S.settings, rec.date, rec.date)[rec.date];
        const late = d && d.records[0] === rec ? d.late : 0;
        kmsg(`${who}님 <b>출근</b> ${hm(nowS)}${late ? ` <span class="late">지각 ${fmtMin(late)}</span>` : ' 좋은 하루 되세요!'}`, late ? 'err' : 'ok');
      } else {
        if (!openRecent) { kmsg(`${who}님의 출근 기록이 없습니다. 관리자에게 문의하세요.`, 'err'); return; }
        open.out = nowS > open.in ? nowS : open.in;
        await save();
        const w = P.recordWork(open, emp, S.settings);
        const d = P.analyzeDays(S.records, emp, S.settings, open.date, open.date)[open.date];
        const ot = d ? d.dailyOT : 0;
        kmsg(`${who}님 <b>퇴근</b> ${hm(open.out)} · 오늘 근무 ${fmtMin(d ? d.work : w.work)}${ot ? ` <span class="late">연장 ${fmtMin(ot)}</span>` : ''} 수고하셨습니다!`, 'ok');
      }
      input.value = '';
    } finally {
      punching = false;
      focusEmpNo();
    }
  }

  // ===== 관리자 =====
  function askAdmin() {
    if (authed) { view = 'admin'; render(); return; }
    if (!S.settings.adminHash) {
      openModal('관리자 비밀번호 설정', `
        <p class="hint">처음 사용하시네요. 관리자 화면을 보호할 비밀번호를 정해주세요.<br><b>분실하면 복구할 수 없으니</b> 꼭 기억해 두세요.</p>
        <label>비밀번호 (4자 이상)<input type="password" id="pw1" autocomplete="new-password"></label>
        <label>비밀번호 확인<input type="password" id="pw2" autocomplete="new-password"></label>`, {
        okText: '설정',
        onOk: async w => {
          const a = w.querySelector('#pw1').value, b = w.querySelector('#pw2').value;
          if (a.length < 4) fail('4자 이상 입력하세요');
          if (a !== b) fail('비밀번호가 일치하지 않습니다');
          S.settings.adminSalt = uid();
          S.settings.adminHash = Sha256(S.settings.adminSalt + ':' + a);
          audit('관리자', '비밀번호 설정');
          await save();
          enterAdmin();
        },
      });
      return;
    }
    openModal('관리자 로그인', `<label>비밀번호<input type="password" id="pw" autocomplete="current-password"></label>`, {
      okText: '확인',
      onOk: async w => {
        if (Sha256(S.settings.adminSalt + ':' + w.querySelector('#pw').value) !== S.settings.adminHash) fail('비밀번호가 틀렸습니다');
        enterAdmin();
      },
    });
  }
  function enterAdmin() { authed = true; view = 'admin'; tab = 'today'; resetIdle(); render(); }
  function toKiosk() { authed = false; view = 'kiosk'; clearTimeout(idleTimer); closeModal(); render(); }
  function resetIdle() {
    clearTimeout(idleTimer);
    if (view === 'admin') idleTimer = setTimeout(() => { toKiosk(); toast('10분 동안 사용이 없어 관리자 화면을 잠갔습니다'); }, IDLE_MS);
  }

  function renderAdmin() {
    const body = ({ today: tabToday, employees: tabEmployees, records: tabRecords, leaves: tabLeaves, payroll: tabPayroll, settings: tabSettings, backup: tabBackup }[tab] || tabToday)();
    app.innerHTML = `
    <div class="admin">
      <header class="a-head">
        <div class="brand">${esc(bizName())} <small>관리자</small></div>
        <nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" class="tab${tab === k ? ' on' : ''}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</nav>
        <button class="btn ghost" data-act="toKiosk">출퇴근 화면으로</button>
      </header>
      <main class="a-main">${body}</main>
    </div>`;
  }

  function backupBanner() {
    if (!S.employees.length) return '';
    const lb = S.settings.lastBackup;
    const days = lb ? Math.floor((Date.now() - new Date(lb).getTime()) / 86400000) : null;
    if (days !== null && days < 7) return '';
    return `<div class="banner warn">${lb ? `마지막 백업 후 ${days}일이 지났습니다.` : '아직 백업한 적이 없습니다.'}
      데이터는 이 PC 브라우저에만 저장되므로 주기적으로 백업해 주세요.
      <button class="btn small" data-act="tab" data-tab="backup">지금 백업</button></div>`;
  }

  // --- 오늘 현황 ---
  function tabToday() {
    const t = today(), now = new Date(), y = P.addDays(t, -1);
    const emps = activeEmps();
    let cIn = 0, cWork = 0, cLate = 0, cAbsent = 0;
    const rows = emps.map(e => {
      const recs = S.records.filter(r => r.empId === e.id && (r.date === t || (r.date === y && !r.out))).sort((a, b) => (a.in < b.in ? -1 : 1));
      const day = P.analyzeDays(S.records, e, S.settings, t, t)[t];
      const lv = S.leaves.filter(l => l.empId === e.id && l.date === t);
      const open = recs.find(r => !r.out && now - P.parseDT(r.in) < 24 * 3600e3);
      const stale = recs.find(r => !r.out && r !== open);
      const sched = P.isScheduledDay(e, t, S.settings);
      const s = P.schedOf(e);
      let status, cls = '';
      if (open) { status = '근무중'; cls = 'ok'; cWork++; }
      else if (stale) { status = '퇴근 미기록'; cls = 'bad'; }
      else if (recs.length) status = '퇴근';
      else if (lv.length) { status = lv.map(l => l.type).join(', '); cls = 'info'; }
      else if (sched) {
        const st = P.parseDate(t); st.setMinutes(P.hmToMin(s.start));
        if (now > st) { status = '미출근'; cls = 'bad'; cAbsent++; } else status = '출근 전';
      } else status = '휴무';
      if (recs.length) cIn++;
      const late = day && day.late;
      if (late) cLate++;
      const last = recs[recs.length - 1];
      return `<tr><td>${esc(e.id)}</td><td><b>${esc(e.name)}</b></td><td>${esc(e.position || '')}</td>
        <td>${sched ? `${s.start}~${s.end}` : '-'}</td>
        <td class="${late ? 'red' : ''}">${recs.length ? hm(recs[0].in) : '-'}${late ? ` <small>(지각 ${fmtMin(late)})</small>` : ''}</td>
        <td>${last && last.out ? outLabel(last) : '-'}</td>
        <td><span class="badge ${cls}">${status}</span></td></tr>`;
    });
    return `${backupBanner()}
      <h2>${dateLabel(t)}</h2>
      <div class="cards">
        <div class="card"><span>재직</span><b>${emps.length}</b></div>
        <div class="card"><span>출근</span><b>${cIn}</b></div>
        <div class="card"><span>근무중</span><b>${cWork}</b></div>
        <div class="card ${cLate ? 'bad' : ''}"><span>지각</span><b>${cLate}</b></div>
        <div class="card ${cAbsent ? 'bad' : ''}"><span>미출근</span><b>${cAbsent}</b></div>
      </div>
      ${emps.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>직원번호</th><th>이름</th><th>직급</th><th>근무시간</th><th>출근</th><th>퇴근</th><th>상태</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
        : `<div class="empty">등록된 직원이 없습니다.<br><button class="btn primary" data-act="tab" data-tab="employees">직원 등록하러 가기</button></div>`}`;
  }

  // --- 직원 관리 ---
  function tabEmployees() {
    const year = new Date().getFullYear(), mw = P.minWage(year);
    const list = S.employees.slice().sort((a, b) => ((a.active === false) - (b.active === false)) || byId(a, b));
    const rows = list.map(e => {
      const s = P.schedOf(e);
      const pay = e.payType === 'monthly' ? `월급 ${won(e.monthlySalary)}`
        : `시급 ${won(e.hourlyWage)}${Number(e.hourlyWage) < mw ? ` <span class="badge bad">최저임금 미달</span>` : ''}`;
      return `<tr class="${e.active === false ? 'dim' : ''}"><td>${esc(e.id)}</td><td><b>${esc(e.name)}</b></td><td>${esc(e.position || '')}</td>
        <td>${pay}</td><td>${daysLabel(s.days)}</td><td>${s.start}~${s.end}</td><td>${esc(e.hireDate || '-')}</td>
        <td>${e.active === false ? `<span class="badge">퇴사${e.leaveDate ? ' ' + esc(e.leaveDate) : ''}</span>` : '<span class="badge ok">재직</span>'}</td>
        <td class="actions"><button class="btn small" data-act="empEdit" data-id="${esc(e.id)}">수정</button>
        <button class="btn small ghost" data-act="empDel" data-id="${esc(e.id)}">삭제</button></td></tr>`;
    });
    return `<div class="bar"><h2>직원 관리</h2><button class="btn primary" data-act="empAdd">+ 직원 추가</button></div>
      <p class="hint">직원은 출퇴근 화면에서 <b>직원번호</b>만 입력해 출퇴근합니다. ${year}년 최저시급: ${won(mw)}</p>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>직원번호</th><th>이름</th><th>직급</th><th>급여</th><th>근무요일</th><th>근무시간</th><th>입사일</th><th>상태</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
        : '<div class="empty">아직 직원이 없습니다. [+ 직원 추가]를 눌러 등록하세요.</div>'}`;
  }

  function empForm(emp) {
    const isNew = !emp;
    const year = new Date().getFullYear(), mw = P.minWage(year);
    const nextId = () => {
      const nums = S.employees.map(e => Number(e.id)).filter(n => Number.isInteger(n));
      return String(nums.length ? Math.max(...nums) + 1 : 1001);
    };
    const e = emp || { id: nextId(), name: '', position: '', payType: 'hourly', hourlyWage: mw, monthlySalary: '', hireDate: today(), schedule: P.defaultSchedule(), deductMode: 'none' };
    const s = P.schedOf(e);
    const body = `
      <div class="grid2">
        <label>직원번호 *<input id="f_id" value="${esc(e.id)}" ${isNew ? '' : 'readonly'} inputmode="numeric"></label>
        <label>이름 *<input id="f_name" value="${esc(e.name)}"></label>
        <label>직급<input id="f_pos" value="${esc(e.position || '')}" placeholder="예: 매니저, 주임, 아르바이트"></label>
        <label>입사일<input type="date" id="f_hire" value="${esc(e.hireDate || '')}"></label>
        <label>급여 형태<select id="f_pay">
          <option value="hourly" ${e.payType !== 'monthly' ? 'selected' : ''}>시급제 (근무시간으로 자동 계산)</option>
          <option value="monthly" ${e.payType === 'monthly' ? 'selected' : ''}>월급제 (출퇴근 기록만 관리)</option></select></label>
        <label class="only-hourly">시급 (원)<input type="number" id="f_wage" min="0" step="10" value="${esc(e.hourlyWage || '')}"></label>
        <label class="only-monthly">월급 (원)<input type="number" id="f_salary" min="0" step="1000" value="${esc(e.monthlySalary || '')}"></label>
      </div>
      <div class="warn-text" id="f_warn"></div>
      <fieldset><legend>급여 공제 <small>(명세서에 자동 반영)</small></legend>
        <div class="grid2">
          <label>공제 방식<select id="f_ded">
            <option value="none" ${e.deductMode !== 'insurance' && e.deductMode !== 'tax33' ? 'selected' : ''}>자동 공제 안 함 (직접 입력)</option>
            <option value="insurance" ${e.deductMode === 'insurance' ? 'selected' : ''}>4대보험 (예상액 자동 계산)</option>
            <option value="tax33" ${e.deductMode === 'tax33' ? 'selected' : ''}>3.3% 사업소득 (프리랜서)</option></select></label>
          <label class="only-ins">비과세 월액 (원)<input type="number" id="f_taxfree" min="0" step="10000" value="${esc(e.taxFree || '')}" placeholder="예: 식대 200000"><small>식대(월 20만원까지) 등 비과세 금액은 보험료 계산에서 뺍니다</small></label>
          <label class="only-ins">신고 보수월액 (원)<input type="number" id="f_insbase" min="0" step="10000" value="${esc(e.insBase || '')}" placeholder="비우면 그 달 급여로 계산"><small>공단에 신고한 금액을 넣으면 실제 고지액과 더 가까워집니다</small></label>
          <div class="only-ins chk-col">
            <label class="chk"><input type="checkbox" id="f_nopen" ${e.noPension ? 'checked' : ''}> 국민연금 제외 <small>(만 60세 이상 등)</small></label>
            <label class="chk"><input type="checkbox" id="f_noemp" ${e.noEmploy ? 'checked' : ''}> 고용보험 제외 <small>(만 65세 이후 신규 채용 등)</small></label>
          </div>
        </div>
        <p class="hint only-ins">근로소득세는 국세청 간이세액표(부양가족 수)에 따라 달라 자동 계산하지 않습니다. 매달 [급여·명세서 → 수당·공제]의 '기타 공제'에 입력하세요. 월 60시간 미만 단시간 근로자는 4대보험 적용이 제외될 수 있습니다.</p>
        <p class="warn-text only-tax33">⚠ 출퇴근 시간과 장소를 정해 주는 직원은 법적으로 근로자로 판단될 가능성이 높아, 3.3%가 아니라 4대보험 대상일 수 있습니다. 계약 형태를 확인하세요.</p>
      </fieldset>
      <fieldset><legend>근무 스케줄 <small>(지각·조퇴·연장·휴일 판단 기준)</small></legend>
        <div class="days">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="chk"><input type="checkbox" name="f_days" value="${d}" ${s.days.map(Number).includes(d) ? 'checked' : ''}>${WD[d]}</label>`).join('')}</div>
        <div class="grid2">
          <label>출근 시간<input type="time" id="f_start" value="${esc(s.start)}"></label>
          <label>퇴근 시간<input type="time" id="f_end" value="${esc(s.end)}"></label>
          <label>휴게시간<select id="f_bmode">
            <option value="auto" ${s.breakMode !== 'fixed' ? 'selected' : ''}>자동 (체류 4시간↑ 30분, 8시간↑ 1시간)</option>
            <option value="fixed" ${s.breakMode === 'fixed' ? 'selected' : ''}>직접 지정</option></select></label>
          <label class="only-fixed">휴게시간 (분)<input type="number" id="f_bmin" min="0" step="10" value="${esc(s.breakMin)}"></label>
        </div>
        <p class="hint">근무요일이 아닌 날(주말 등)의 근무는 휴일근로로 계산됩니다.</p>
      </fieldset>
      ${isNew ? '' : `<label class="chk"><input type="checkbox" id="f_active" ${e.active !== false ? 'checked' : ''}> 재직 중 <small>(해제하면 퇴사 처리되며 기록은 보존됩니다)</small></label>
        <p class="hint">시급·월급을 바꾸면 지난 달 명세서도 바뀐 금액으로 다시 계산됩니다. 지난 달 명세서는 미리 엑셀로 저장해 두세요.</p>`}`;

    const w = openModal(isNew ? '직원 추가' : `직원 수정 — ${e.name}`, body, {
      wide: true,
      onOk: async w => {
        const id = val(w, 'f_id'), name = val(w, 'f_name');
        if (!id) fail('직원번호를 입력하세요');
        if (/\s/.test(id)) fail('직원번호에는 공백을 넣을 수 없습니다');
        if (isNew && S.employees.some(x => x.id === id)) fail('이미 사용 중인 직원번호입니다');
        if (!name) fail('이름을 입력하세요');
        const payType = val(w, 'f_pay');
        const wage = Number(val(w, 'f_wage')) || 0, salary = Number(val(w, 'f_salary')) || 0;
        if (payType === 'hourly' && wage <= 0) fail('시급을 입력하세요');
        if (payType === 'monthly' && salary <= 0) fail('월급을 입력하세요');
        const days = [...w.querySelectorAll('input[name=f_days]:checked')].map(x => Number(x.value));
        if (!days.length) fail('근무 요일을 하나 이상 선택하세요');
        const start = val(w, 'f_start'), end = val(w, 'f_end');
        if (!start || !end) fail('출근·퇴근 시간을 입력하세요');
        const data = {
          id, name, position: val(w, 'f_pos'), payType, hourlyWage: wage, monthlySalary: salary, hireDate: val(w, 'f_hire'),
          schedule: { days, start, end, breakMode: val(w, 'f_bmode'), breakMin: Math.max(0, Number(val(w, 'f_bmin')) || 0) },
          deductMode: val(w, 'f_ded') || 'none',
          taxFree: Math.max(0, Math.round(Number(val(w, 'f_taxfree')) || 0)),
          insBase: Math.max(0, Math.round(Number(val(w, 'f_insbase')) || 0)),
          noPension: w.querySelector('#f_nopen').checked,
          noEmploy: w.querySelector('#f_noemp').checked,
        };
        if (isNew) {
          S.employees.push(Object.assign(data, { active: true }));
          audit('직원 추가', `${id} ${name}`);
        } else {
          const ch = [];
          if (emp.payType !== payType) ch.push(`급여형태 → ${payType === 'hourly' ? '시급제' : '월급제'}`);
          if (payType === 'hourly' && Number(emp.hourlyWage) !== wage) ch.push(`시급 ${num(emp.hourlyWage)} → ${num(wage)}`);
          if (payType === 'monthly' && Number(emp.monthlySalary) !== salary) ch.push(`월급 ${num(emp.monthlySalary)} → ${num(salary)}`);
          if ((emp.position || '') !== data.position) ch.push(`직급 → ${data.position || '(없음)'}`);
          if ((emp.deductMode || 'none') !== data.deductMode) ch.push(`공제 → ${DED_LABEL[data.deductMode]}`);
          const active = w.querySelector('#f_active').checked;
          if (emp.active !== false && !active) { data.leaveDate = today(); ch.push('퇴사 처리'); }
          else if (emp.active === false && active) { data.leaveDate = ''; ch.push('재직 복귀'); }
          Object.assign(emp, data, { active });
          audit('직원 수정', `${id} ${name}${ch.length ? ' · ' + ch.join(', ') : ''}`);
        }
        await save(); render(); toast('저장했습니다');
      },
    });
    const sync = () => {
      const pay = w.querySelector('#f_pay').value;
      w.querySelectorAll('.only-hourly').forEach(el => { el.hidden = pay !== 'hourly'; });
      w.querySelectorAll('.only-monthly').forEach(el => { el.hidden = pay !== 'monthly'; });
      w.querySelectorAll('.only-fixed').forEach(el => { el.hidden = w.querySelector('#f_bmode').value !== 'fixed'; });
      const dm = w.querySelector('#f_ded').value;
      w.querySelectorAll('.only-ins').forEach(el => { el.hidden = dm !== 'insurance'; });
      w.querySelectorAll('.only-tax33').forEach(el => { el.hidden = dm !== 'tax33'; });
      const wage = Number(w.querySelector('#f_wage').value) || 0;
      w.querySelector('#f_warn').textContent = pay === 'hourly' && wage > 0 && wage < mw ? `⚠ ${year}년 최저시급(${won(mw)})보다 낮습니다` : '';
    };
    w.addEventListener('input', sync);
    w.addEventListener('change', sync);
    sync();
  }

  function empDelete(id) {
    const e = empById(id);
    if (!e) return;
    if (S.records.some(r => r.empId === id) || S.leaves.some(l => l.empId === id)) {
      toast('출퇴근 기록이 있는 직원은 삭제할 수 없습니다. [수정]에서 재직 해제(퇴사 처리)하세요.', 'err');
      return;
    }
    openModal('직원 삭제', `<p><b>${esc(e.name)}</b> (${esc(e.id)}) 직원을 삭제할까요?</p>`, {
      okText: '삭제', danger: true,
      onOk: async () => {
        S.employees = S.employees.filter(x => x !== e);
        audit('직원 삭제', `${e.id} ${e.name}`);
        await save(); render(); toast('삭제했습니다');
      },
    });
  }

  // --- 출퇴근 기록 ---
  // 출퇴근 기록 검색: 이름·직원번호 + 기간(선택한 달 / 전체 기간)
  function recMatchEmps() {
    const q = ui.recQ.trim().toLowerCase();
    if (!q) return null; // 전체 직원
    return S.employees.filter(e => e.id.toLowerCase().includes(q) || String(e.name || '').toLowerCase().includes(q));
  }
  function recSingleEmp() {
    const m = recMatchEmps();
    return m && m.length === 1 ? m[0] : null;
  }
  function recordQuery() {
    const ym = ui.month, all = ui.recScope === 'all';
    const m = recMatchEmps();
    const ids = m ? new Set(m.map(e => e.id)) : null;
    const recs = S.records.filter(r => (all || r.date.startsWith(ym)) && (!ids || ids.has(r.empId)))
      .sort((a, b) => (a.date === b.date ? (a.empId === b.empId ? (a.in < b.in ? -1 : 1) : byId({ id: a.empId }, { id: b.empId })) : a.date < b.date ? -1 : 1));
    const from = all ? (recs.length ? recs[0].date : `${ym}-01`) : `${ym}-01`;
    const to = all ? (recs.length ? recs[recs.length - 1].date : P.lastDayOfMonth(ym)) : P.lastDayOfMonth(ym);
    const dm = {};
    const items = recs.map(r => {
      const e = empById(r.empId);
      let d = null;
      if (e) {
        if (!dm[e.id]) dm[e.id] = P.analyzeDays(S.records, e, S.settings, from, to);
        d = dm[e.id][r.date] || null;
      }
      const first = d && d.records[0] === r, last = d && d.records[d.records.length - 1] === r;
      const w = r.out && e ? P.recordWork(r, e, S.settings) : null;
      return {
        r, e, d,
        late: first ? d.late : 0,
        early: last ? d.early : 0,
        ot: last ? d.dailyOT + d.weeklyOT : 0,
        holiday: !!(d && d.holiday),
        edited: !!(r.edited || r.manual),
        work: w ? w.work : null,
        brk: w ? w.brk : null,
      };
    });
    const sum = { count: items.length, days: new Set(items.map(x => x.r.empId + x.r.date)).size, work: 0, lateN: 0, late: 0, earlyN: 0, ot: 0, missing: 0 };
    for (const x of items) {
      sum.work += x.work || 0;
      if (x.late) { sum.lateN++; sum.late += x.late; }
      if (x.early) sum.earlyN++;
      sum.ot += x.ot;
      if (!x.r.out && x.r.date < today()) sum.missing++;
    }
    return { items, sum, m };
  }
  function recScopeLabel() {
    const [y, mo] = ui.month.split('-').map(Number);
    const q = ui.recQ.trim();
    return `${ui.recScope === 'all' ? '전체 기간' : `${y}년 ${mo}월`}${q ? ` · "${q}" 검색` : ' · 전체 직원'}`;
  }
  function recPrintTitle() {
    return `${esc(bizName())} 출퇴근 기록 — ${esc(recScopeLabel())} <small>(출력일 ${today()})</small>`;
  }

  function recResultsHtml() {
    const { items, sum, m } = recordQuery();
    if (m && !m.length) return `<div class="empty">"${esc(ui.recQ.trim())}"에 해당하는 직원이 없습니다.</div>`;
    if (!items.length) return '<div class="empty">조건에 맞는 기록이 없습니다.</div>';
    const rows = items.map(x => {
      const { r, e } = x;
      const notes = [];
      if (x.late) notes.push(`<span class="red">지각 ${fmtMin(x.late)}</span>`);
      if (x.early) notes.push(`<span class="red">조퇴 ${fmtMin(x.early)}</span>`);
      if (x.ot) notes.push(`<span class="red">연장 ${fmtMin(x.ot)}</span>`);
      if (x.holiday) notes.push('<span class="badge info">휴일근무</span>');
      if (x.edited) notes.push('<span class="badge">수정됨</span>');
      const k = r.date, wd = P.weekday(k);
      return `<tr><td>${ui.recScope === 'all' ? k : k.slice(5)} <span class="wd${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}">${WD[wd]}</span></td>
        <td>${esc(r.empId)}</td><td><b>${esc(e ? e.name : '(삭제된 직원)')}</b></td>
        <td class="${x.late ? 'red' : ''}">${hm(r.in)}</td>
        <td>${r.out ? outLabel(r) : '<span class="red">미기록</span>'}</td>
        <td>${x.work != null ? fmtMin(x.work) : '-'}</td>
        <td>${notes.join(' ')}</td>
        <td class="actions no-print"><button class="btn small" data-act="recEdit" data-id="${r.id}">수정</button>
        <button class="btn small ghost" data-act="recDel" data-id="${r.id}">삭제</button></td></tr>`;
    });
    return `${sum.missing ? `<div class="banner warn no-print">퇴근 미기록 ${sum.missing}건이 있습니다. 미기록 건은 급여에 포함되지 않으니 [수정]에서 퇴근 시간을 입력하세요.</div>` : ''}
      <p class="rec-sum"><b>${esc(recScopeLabel())}</b> — ${sum.count}건 · 근무 ${sum.days}일 · 총 근무 ${fmtMin(sum.work)}
        · <span class="${sum.lateN ? 'red' : ''}">지각 ${sum.lateN}회</span> · <span class="${sum.earlyN ? 'red' : ''}">조퇴 ${sum.earlyN}회</span>
        · <span class="${sum.ot ? 'red' : ''}">연장 ${fmtMin(sum.ot)}</span>${sum.missing ? ` · <span class="red">미기록 ${sum.missing}건</span>` : ''}</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>날짜</th><th>직원번호</th><th>이름</th><th>출근</th><th>퇴근</th><th>근무</th><th>비고</th><th class="no-print"></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function tabRecords() {
    const auditRows = S.audit.slice(0, 300).map(a => `<tr><td class="nowrap">${esc(a.at.replace('T', ' '))}</td><td class="nowrap">${esc(a.action)}</td><td>${esc(a.detail)}</td></tr>`);
    const all = ui.recScope === 'all';
    return `<div class="bar"><h2>출퇴근 기록</h2>
        <div class="filters no-print">
          <input type="search" id="recQ" class="rec-q" data-input="recQ" value="${esc(ui.recQ)}" placeholder="이름 또는 직원번호 검색" list="recEmpList" aria-label="이름 또는 직원번호 검색" autocomplete="off">
          <datalist id="recEmpList">${S.employees.slice().sort(byId).map(e => `<option value="${esc(e.name)}">${esc(e.id)}${e.position ? ' · ' + esc(e.position) : ''}</option>`).join('')}</datalist>
          <select data-change="recScope" aria-label="기간"><option value="month" ${all ? '' : 'selected'}>선택한 달</option><option value="all" ${all ? 'selected' : ''}>전체 기간</option></select>
          <input type="month" value="${ui.month}" data-change="month" aria-label="월 선택" ${all ? 'disabled' : ''}>
          <button class="btn" data-act="recXls">엑셀 저장</button>
          <button class="btn" data-act="recPrint">인쇄</button>
          <button class="btn primary" data-act="recAdd">+ 기록 추가</button>
        </div></div>
      <div class="print-only print-title">${recPrintTitle()}</div>
      <div id="recResults">${recResultsHtml()}</div>
      <details class="audit no-print"><summary>수정 이력 보기 (최근 ${Math.min(300, S.audit.length)}건)</summary>
        ${S.audit.length ? `<div class="tbl-wrap"><table class="tbl small"><thead><tr><th>일시</th><th>구분</th><th>내용</th></tr></thead><tbody>${auditRows.join('')}</tbody></table></div>` : '<p class="hint">이력이 없습니다.</p>'}
      </details>`;
  }

  function exportRecords() {
    const { items, sum, m } = recordQuery();
    if (!items.length) { toast(m && !m.length ? '해당하는 직원이 없습니다' : '저장할 기록이 없습니다', 'err'); return; }
    const head = ['날짜', '요일', '직원번호', '이름', '직급', '출근', '퇴근', '휴게(분)', '근무(h)', '지각(분)', '조퇴(분)', '연장(h)', '비고'];
    const rows = [
      [{ v: `출퇴근 기록 — ${recScopeLabel()}`, s: 'title' }],
      [{ v: `${bizName()}  |  출력일 ${today()}  |  빨간색: 지각 · 조퇴 · 연장근로 · 퇴근 미기록`, s: 'note' }],
      [],
      head.map(v => ({ v, s: 'header' })),
    ];
    for (const x of items) {
      const { r, e } = x;
      const notes = [];
      if (x.late) notes.push(`지각 ${fmtMin(x.late)}`);
      if (x.early) notes.push(`조퇴 ${fmtMin(x.early)}`);
      if (x.ot) notes.push(`연장 ${fmtMin(x.ot)}`);
      if (x.holiday) notes.push('휴일근무');
      if (!r.out) notes.push('퇴근 미기록');
      if (x.edited) notes.push('수정됨');
      const red = x.late || x.early || x.ot || !r.out;
      rows.push([
        { v: r.date, s: 'center' }, { v: WD[P.weekday(r.date)], s: 'center' },
        { v: r.empId, s: 'center' }, { v: e ? e.name : '(삭제된 직원)', s: 'cell' }, { v: e ? e.position || '' : '', s: 'cell' },
        { v: hm(r.in), s: x.late ? 'red' : 'center' },
        { v: r.out ? outLabel(r) : '미기록', s: !r.out || x.early ? 'red' : 'center' },
        { v: x.brk != null ? x.brk : '', s: 'center' },
        { v: x.work != null ? hours(x.work) : '', s: 'hours' },
        { v: x.late || '', s: x.late ? 'red' : 'center' },
        { v: x.early || '', s: x.early ? 'red' : 'center' },
        { v: x.ot ? hours(x.ot) : '', s: x.ot ? 'redHours' : 'hours' },
        { v: notes.join(', '), s: red ? 'redText' : 'cell' },
      ]);
    }
    rows.push([
      { v: `합계 (${sum.count}건 · 근무 ${sum.days}일)`, s: 'label' }, ...Array(7).fill({ s: 'label' }),
      { v: hours(sum.work), s: 'total' },
      { v: sum.late || '', s: sum.late ? 'red' : 'label' },
      { v: sum.earlyN ? `${sum.earlyN}회` : '', s: sum.earlyN ? 'red' : 'label' },
      { v: sum.ot ? hours(sum.ot) : '', s: sum.ot ? 'redHours' : 'label' },
      { v: `지각 ${sum.lateN}회${sum.missing ? ` · 미기록 ${sum.missing}건` : ''}`, s: 'label' },
    ]);
    const n = rows.length;
    const bytes = X.build([{
      name: '출퇴근 기록', landscape: true,
      cols: [11, 6, 9, 10, 9, 8, 10, 8, 8, 8, 8, 8, 28],
      rows, merges: ['A1:M1', 'A2:M2', `A${n}:H${n}`], heights: { 0: 28, 3: 24 },
    }]);
    const safe = v => String(v).replace(/[\\/:*?"<>|]/g, '_');
    const one = recSingleEmp();
    const who = one ? `_${one.name}` : ui.recQ.trim() ? `_${ui.recQ.trim()}` : '';
    const when = ui.recScope === 'all' ? '전체' : ui.month;
    download(bytes, safe(`출퇴근기록_${when}${who}.xlsx`), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast('엑셀 파일을 저장했습니다');
  }

  function recordForm(rec) {
    const isNew = !rec;
    const emps = activeEmps();
    if (isNew && !emps.length) { toast('먼저 직원을 등록하세요', 'err'); return; }
    const defDate = ui.month === today().slice(0, 7) ? today() : `${ui.month}-01`;
    const body = `
      ${isNew ? `<label>직원<select id="r_emp">${emps.map(e => `<option value="${esc(e.id)}" ${(recSingleEmp() || {}).id === e.id ? 'selected' : ''}>${esc(e.id)} · ${esc(e.name)}</option>`).join('')}</select></label>`
        : `<p><b>${esc(empName(rec.empId))}</b> (${esc(rec.empId)})</p>`}
      <div class="grid2">
        <label>출근<input type="datetime-local" id="r_in" value="${esc(rec ? rec.in : `${defDate}T09:00`)}"></label>
        <label>퇴근 <small>(비우면 미기록)</small><input type="datetime-local" id="r_out" value="${esc(rec && rec.out ? rec.out : '')}"></label>
      </div>
      <label>사유 *<input id="r_reason" placeholder="예: 퇴근 버튼 누락, 출근 시간 정정"></label>
      <p class="hint">수정 내용과 사유는 수정 이력에 기록됩니다.</p>`;
    openModal(isNew ? '출퇴근 기록 추가' : '출퇴근 기록 수정', body, {
      onOk: async w => {
        const empId = isNew ? val(w, 'r_emp') : rec.empId;
        const inV = val(w, 'r_in').slice(0, 16), outV = val(w, 'r_out').slice(0, 16), reason = val(w, 'r_reason');
        if (!inV) fail('출근 시간을 입력하세요');
        const A = P.parseDT(inV), B = outV ? P.parseDT(outV) : new Date(A.getTime() + 60000);
        if (outV) {
          const span = P.diffMin(A, B);
          if (span <= 0) fail('퇴근 시간은 출근 시간보다 늦어야 합니다');
          if (span > 24 * 60) fail('근무 시간이 24시간을 넘습니다');
        }
        if (!reason) fail('사유를 입력하세요');
        const clash = S.records.find(r => {
          if (r === rec || r.empId !== empId) return false;
          const r1 = P.parseDT(r.in), r2 = r.out ? P.parseDT(r.out) : new Date(r1.getTime() + 60000);
          return r1 < B && A < r2;
        });
        if (clash) fail(`다른 기록(${fmtRange(clash.in, clash.out)})과 시간이 겹칩니다`);
        const name = empName(empId);
        if (isNew) {
          S.records.push({ id: uid(), empId, date: inV.slice(0, 10), in: inV, out: outV || null, manual: true });
          audit('기록 추가', `${name}(${empId}) ${fmtRange(inV, outV)} · 사유: ${reason}`);
        } else {
          const before = fmtRange(rec.in, rec.out);
          Object.assign(rec, { in: inV, out: outV || null, date: inV.slice(0, 10), edited: true });
          audit('기록 수정', `${name}(${empId}) ${before} → ${fmtRange(inV, outV)} · 사유: ${reason}`);
        }
        await save(); render(); toast('저장했습니다');
      },
    });
  }

  function recordDelete(id) {
    const rec = S.records.find(r => r.id === id);
    if (!rec) return;
    openModal('기록 삭제', `<p><b>${esc(empName(rec.empId))}</b> ${esc(fmtRange(rec.in, rec.out))}</p>
      <label>삭제 사유 *<input id="d_reason" placeholder="예: 잘못 누른 출근"></label>`, {
      okText: '삭제', danger: true,
      onOk: async w => {
        const reason = val(w, 'd_reason');
        if (!reason) fail('사유를 입력하세요');
        S.records = S.records.filter(r => r !== rec);
        audit('기록 삭제', `${empName(rec.empId)}(${rec.empId}) ${fmtRange(rec.in, rec.out)} · 사유: ${reason}`);
        await save(); render(); toast('삭제했습니다');
      },
    });
  }

  // --- 연차·월차 ---
  function tabLeaves() {
    const y = ui.year, ys = String(y);
    const used = id => S.leaves.filter(l => l.empId === id && l.date.startsWith(ys)).reduce((a, l) => a + (Number(l.days) || 0), 0);
    const emps = S.employees.filter(e => e.active !== false || S.leaves.some(l => l.empId === e.id && l.date.startsWith(ys))).sort(byId);
    const rows = emps.map(e => {
      const key = `${e.id}|${y}`;
      const g = S.leaveGrants[key];
      const u = used(e.id);
      const remain = (Number(g) || 0) - u;
      const hint = P.legalLeaveHint(e, y, S.settings);
      return `<tr><td>${esc(e.id)}</td><td><b>${esc(e.name)}</b></td><td>${esc(e.hireDate || '-')}</td>
        <td class="hint-cell">${esc(hint.text)}${hint.days != null && hint.days !== Number(g) ? ` <button class="btn small ghost" data-act="grantHint" data-id="${esc(e.id)}" data-days="${hint.days}">적용</button>` : ''}</td>
        <td><input type="number" class="num-in" min="0" step="0.5" value="${g ?? ''}" data-change="grant" data-id="${esc(e.id)}" aria-label="${esc(e.name)} 부여일수"></td>
        <td>${u}</td><td class="${remain < 0 ? 'red' : ''}"><b>${g == null ? '-' : remain}</b></td></tr>`;
    });
    const list = S.leaves.filter(l => l.date.startsWith(ys)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const yrs = [y - 2, y - 1, y, y + 1];
    return `<div class="bar"><h2>연차 · 월차</h2>
        <div class="filters"><select data-change="year" aria-label="연도">${yrs.map(v => `<option ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn primary" data-act="leaveAdd">+ 휴가 사용 등록</button></div></div>
      <p class="hint">직원별 <b>부여일수</b>를 직접 입력하세요. 법정 참고값의 [적용]을 누르면 자동으로 채워집니다. 등록한 휴가는 유급으로 처리되어 시급제 직원은 소정근로시간만큼 급여에 포함됩니다.</p>
      ${emps.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>직원번호</th><th>이름</th><th>입사일</th><th>법정 참고</th><th>부여(일)</th><th>사용</th><th>잔여</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<div class="empty">직원이 없습니다.</div>'}
      <h3>${y}년 사용 내역</h3>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>날짜</th><th>직원</th><th>종류</th><th>일수</th><th>메모</th><th></th></tr></thead><tbody>
        ${list.map(l => `<tr><td>${l.date} (${WD[P.weekday(l.date)]})</td><td>${esc(empName(l.empId))}</td><td>${esc(l.type)}</td><td>${l.days}</td><td>${esc(l.memo || '')}</td>
        <td class="actions"><button class="btn small ghost" data-act="leaveDel" data-id="${l.id}">삭제</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">사용 내역이 없습니다.</p>'}`;
  }

  function leaveForm() {
    const emps = activeEmps();
    if (!emps.length) { toast('먼저 직원을 등록하세요', 'err'); return; }
    openModal('휴가 사용 등록', `
      <label>직원<select id="l_emp">${emps.map(e => `<option value="${esc(e.id)}">${esc(e.id)} · ${esc(e.name)}</option>`).join('')}</select></label>
      <div class="grid2"><label>날짜<input type="date" id="l_date" value="${today()}"></label>
      <label>종류<select id="l_type">${LEAVE_TYPES.map(([t, d], i) => `<option value="${i}">${t} (${d}일)</option>`).join('')}</select></label></div>
      <label>메모<input id="l_memo" placeholder="선택 입력"></label>`, {
      okText: '등록',
      onOk: async w => {
        const empId = val(w, 'l_emp'), date = val(w, 'l_date');
        const [type, days] = LEAVE_TYPES[Number(val(w, 'l_type'))];
        if (!date) fail('날짜를 선택하세요');
        const exist = S.leaves.filter(l => l.empId === empId && l.date === date).reduce((a, l) => a + Number(l.days), 0);
        if (exist + days > 1) fail('해당 날짜에 이미 휴가가 등록되어 있습니다');
        S.leaves.push({ id: uid(), empId, date, type, days, memo: val(w, 'l_memo') });
        audit('휴가 등록', `${empName(empId)}(${empId}) ${date} ${type}`);
        if (String(ui.year) !== date.slice(0, 4)) ui.year = Number(date.slice(0, 4));
        await save(); render(); toast('등록했습니다');
      },
    });
  }

  // --- 급여·명세서 ---
  function payrollEmps(ym) {
    const mStart = `${ym}-01`, mEnd = P.lastDayOfMonth(ym);
    return S.employees.filter(e => {
      if (S.records.some(r => r.empId === e.id && r.date.startsWith(ym))) return true;
      if (e.hireDate && e.hireDate > mEnd) return false;
      if (e.active === false && (!e.leaveDate || e.leaveDate < mStart)) return false;
      return true;
    }).sort(byId);
  }

  function tabPayroll() {
    const ym = ui.month;
    const calcs = payrollEmps(ym).map(e => P.calcMonth(S, e, ym, today()));
    const tot = calcs.reduce((a, c) => { a.gross += c.pay.gross; a.ded += c.pay.deduction; a.net += c.pay.net; return a; }, { gross: 0, ded: 0, net: 0 });
    const missing = calcs.reduce((a, c) => a + c.stats.incomplete, 0);
    const rows = calcs.map(c => {
      const st = c.stats, e = c.emp;
      return `<tr><td>${esc(e.id)}</td><td><b>${esc(e.name)}</b> <small>${esc(e.position || '')}</small></td>
        <td>${c.hourly ? '시급' : '월급'}</td><td>${st.workDays}일</td><td>${fmtMin(st.workMin)}</td>
        <td class="${st.lateCount ? 'red' : ''}">${st.lateCount}회</td><td class="${st.absent ? 'red' : ''}">${st.absent}일</td>
        <td class="${st.ot ? 'red' : ''}">${hours(st.ot)}h</td><td>${hours(st.night)}h</td><td>${hours(st.hol)}h</td>
        <td class="money">${won(c.pay.gross)}</td><td class="money">${c.pay.deduction ? won(c.pay.deduction) : '-'}</td><td class="money"><b>${won(c.pay.net)}</b></td>
        <td class="actions"><button class="btn small" data-act="payDetail" data-id="${esc(e.id)}">상세</button>
        <button class="btn small" data-act="payAdj" data-id="${esc(e.id)}">수당·공제</button>
        <button class="btn small ghost" data-act="payXls" data-id="${esc(e.id)}">엑셀</button></td></tr>`;
    });
    const mul = P.effectiveMul(S.settings);
    return `<div class="bar"><h2>급여 · 월급명세서</h2>
        <div class="filters"><input type="month" value="${ym}" data-change="month" aria-label="월 선택">
        <button class="btn primary big" data-act="payXlsAll" ${calcs.length ? '' : 'disabled'}>월급명세서 엑셀 다운로드 (전체)</button></div></div>
      <p class="hint">적용 배수: 연장 ${mul.overtime}배 · 야간 +${mul.night}배 · 휴일 ${mul.holiday}배(8시간 초과 ${mul.holidayOver8}배)
        ${S.settings.under5 ? ' — <b>5인 미만 사업장</b>: 가산수당 미적용' : ''} · 주휴수당 ${S.settings.weeklyHolidayPay !== false ? '적용' : '미적용'}
        <button class="btn small ghost" data-act="tab" data-tab="settings">배수 변경</button></p>
      ${missing ? `<div class="banner warn">퇴근 미기록 ${missing}건은 급여에 포함되지 않았습니다. <button class="btn small" data-act="tab" data-tab="records">기록 수정하러 가기</button></div>` : ''}
      ${calcs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>직원번호</th><th>이름</th><th>형태</th><th>근무일</th><th>근무시간</th><th>지각</th><th>결근</th><th>연장</th><th>야간</th><th>휴일</th><th>지급합계</th><th>공제</th><th>실지급액</th><th></th></tr></thead>
        <tbody>${rows.join('')}</tbody><tfoot><tr><td colspan="10">합계 (${calcs.length}명)</td><td class="money">${won(tot.gross)}</td><td class="money">${won(tot.ded)}</td><td class="money"><b>${won(tot.net)}</b></td><td></td></tr></tfoot></table></div>`
        : '<div class="empty">이 달에 해당하는 직원이 없습니다.</div>'}
      <p class="hint">공제는 직원별 공제 방식(직원 관리)에 따라 4대보험 예상액 또는 3.3%가 자동 계산되며, [수당·공제]에서 실제 고지액으로 고치거나 소득세 등을 더할 수 있습니다. 시급제 직원의 주휴수당은 그 주의 일요일이 속한 달에, 주가 끝난 뒤 반영됩니다.</p>`;
  }

  function payDetail(id) {
    const e = empById(id);
    if (!e) return;
    const c = P.calcMonth(S, e, ui.month, today());
    const st = c.stats, p = c.pay;
    const line = (k, v, cls = '') => `<tr class="${cls}"><th>${k}</th><td class="money">${v}</td></tr>`;
    const items = c.hourly ? [
      line(`기본급 (${fmtMin(st.workMin)})`, won(p.base)),
      line(`연장근로수당 (${fmtMin(st.ot)} × ${c.mul.overtime - 1} 가산)`, won(p.overtime), st.ot ? 'red' : ''),
      line(`야간근로수당 (${fmtMin(st.night)} × ${c.mul.night})`, won(p.night)),
      line(`휴일근로수당 (${fmtMin(st.hol)})`, won(p.holiday)),
      line(`주휴수당 (${c.weeks.filter(w => w.eligible).length}주, ${fmtMin(c.juhyuMin)})`, won(p.juhyu)),
      line(`유급휴가 (${st.leaveDays}일)`, won(p.leave)),
    ] : [line('기본급 (월급)', won(p.base))];
    items.push(line(`기타수당${c.adj.extraNote ? ` (${esc(c.adj.extraNote)})` : ''}`, won(p.extra)));
    const weeks = c.hourly ? `<h4>주휴수당 판정</h4><table class="tbl small"><thead><tr><th>주</th><th>주 소정근로</th><th>개근</th><th>결과</th></tr></thead><tbody>
      ${c.weeks.map(w => `<tr><td>${w.start.slice(5)} ~ ${w.end.slice(5)}</td><td>${fmtMin(w.baseMin)}</td><td>${w.attendanceOK ? 'O' : '<span class="red">X</span>'}</td>
      <td>${w.eligible ? fmtMin(w.min) : !w.complete ? '주 진행 중' : w.baseMin < 900 ? '15시간 미만' : !w.attendanceOK ? '결근 있음' : '미적용'}</td></tr>`).join('')}</tbody></table>` : '';
    openModal(`${e.name} — ${ui.month} 급여 상세`, `
      <table class="tbl detail"><tbody>${items.join('')}
        ${line('지급 합계', `<b>${won(p.gross)}</b>`, 'sum')}
        ${c.ded.items.map(it => line(`${esc(it.name)}${it.overridden ? ' <span class="badge">고지액</span>' : ''}`, won(it.amount))).join('')}
        ${p.manualDeduction || !c.ded.items.length ? line(`기타 공제${c.adj.deductionNote ? ` (${esc(c.adj.deductionNote)})` : ''}`, won(p.manualDeduction)) : ''}
        ${line('공제 합계', won(p.deduction))}
        ${line('실 지급액', `<b>${won(p.net)}</b>`, 'sum')}</tbody></table>
      <p class="hint">근무 ${st.workDays}일 · 지각 ${st.lateCount}회 · 조퇴 ${st.earlyCount}회 · 결근 ${st.absent}일 · 퇴근 미기록 ${st.incomplete}건</p>
      ${weeks}`, { cancelText: '닫기', wide: true });
  }

  function payAdjForm(id) {
    const e = empById(id);
    if (!e) return;
    const key = `${id}|${ui.month}`, a = S.adjustments[key] || {};
    const c = P.calcMonth(S, e, ui.month, today());
    const ov = a.ins || {};
    const autoRows = c.ded.items.map(it => `<label>${esc(it.name)} <small>예상 ${won(it.auto)}</small>
        <input type="number" min="0" step="10" data-ins="${it.key}" value="${esc(ov[it.key] ?? '')}" placeholder="${it.auto} (자동)"></label>`).join('');
    const modeInfo = c.ded.mode === 'none'
      ? `<p class="hint">이 직원은 자동 공제를 쓰지 않습니다. [직원 관리 → 수정]에서 4대보험 또는 3.3%를 선택할 수 있습니다.</p>`
      : `<h4>${c.ded.mode === 'insurance' ? '4대보험 (예상액)' : '3.3% 원천징수'} <small>기준 금액 ${won(c.ded.base)}</small></h4>
        ${autoRows ? `<div class="grid2">${autoRows}</div><p class="hint">비워두면 자동 계산값을 씁니다. 고지서 금액과 다르면 그 금액을 입력하세요.</p>` : '<p class="hint">이 달 지급액이 없어 공제가 없습니다.</p>'}`;
    openModal(`${e.name} — ${ui.month} 수당·공제`, `
      <div class="grid2">
        <label>기타수당 (원)<input type="number" id="a_extra" step="1000" value="${esc(a.extraPay || '')}"></label>
        <label>수당 내용<input id="a_extraNote" value="${esc(a.extraNote || '')}" placeholder="예: 식대, 상여, 직책수당"></label>
      </div>
      ${modeInfo}
      <h4>기타 공제</h4>
      <div class="grid2">
        <label>기타 공제 (원)<input type="number" id="a_ded" step="10" value="${esc(a.deduction || '')}"></label>
        <label>공제 내용<input id="a_dedNote" value="${esc(a.deductionNote || '')}" placeholder="예: 근로소득세, 지방소득세, 가불금"></label>
      </div>
      <p class="hint">이 달 명세서에만 반영됩니다.</p>`, {
      wide: true,
      onOk: async w => {
        const extra = Math.round(Number(val(w, 'a_extra')) || 0), ded = Math.round(Number(val(w, 'a_ded')) || 0);
        if (ded < 0) fail('공제액은 0 이상이어야 합니다');
        const ins = {};
        w.querySelectorAll('[data-ins]').forEach(inp => {
          if (inp.value.trim() === '') return;
          const v = Math.round(Number(inp.value));
          if (!(v >= 0)) fail('공제 금액은 0 이상이어야 합니다');
          ins[inp.dataset.ins] = v;
        });
        const next = { extraPay: extra, extraNote: val(w, 'a_extraNote'), deduction: ded, deductionNote: val(w, 'a_dedNote') };
        if (Object.keys(ins).length) next.ins = ins;
        if (!extra && !ded && !next.extraNote && !next.deductionNote && !next.ins) delete S.adjustments[key];
        else S.adjustments[key] = next;
        const insTxt = Object.keys(ins).length ? ` / 고지액 ${Object.entries(ins).map(([k, v]) => `${k} ${num(v)}`).join(', ')}` : '';
        audit('수당·공제', `${e.name}(${id}) ${ui.month} 기타수당 ${num(extra)} / 기타 공제 ${num(ded)}${insTxt}`);
        await save(); render(); toast('저장했습니다');
      },
    });
  }

  // --- 엑셀 명세서 ---
  function summarySheet(calcs, ym) {
    const [y, m] = ym.split('-').map(Number);
    const head = ['직원번호', '이름', '직급', '급여형태', '근무일수', '근무시간(h)', '지각(회)', '결근(일)', '연장(h)', '야간(h)', '휴일(h)',
      '기본급', '연장수당', '야간수당', '휴일수당', '주휴수당', '유급휴가', '기타수당', '지급합계', '공제', '실지급액'];
    const rows = [
      [{ v: `${y}년 ${m}월 급여대장`, s: 'title' }],
      [{ v: `${bizName()}  |  출력일 ${today()}  |  빨간색: 지각·결근·연장근로`, s: 'note' }],
      [],
      head.map(v => ({ v, s: 'header' })),
    ];
    const sum = Array(10).fill(0);
    for (const c of calcs) {
      const st = c.stats, p = c.pay, e = c.emp;
      const money = [p.base, p.overtime, p.night, p.holiday, p.juhyu, p.leave, p.extra, p.gross, p.deduction, p.net];
      money.forEach((v, i) => { sum[i] += v; });
      rows.push([
        { v: e.id, s: 'center' }, { v: e.name, s: 'cell' }, { v: e.position || '', s: 'cell' }, { v: c.hourly ? '시급제' : '월급제', s: 'center' },
        { v: st.workDays, s: 'center' }, { v: hours(st.workMin), s: 'hours' },
        { v: st.lateCount, s: st.lateCount ? 'red' : 'center' }, { v: st.absent, s: st.absent ? 'red' : 'center' },
        { v: hours(st.ot), s: st.ot ? 'redHours' : 'hours' }, { v: hours(st.night), s: 'hours' }, { v: hours(st.hol), s: 'hours' },
        ...money.map((v, i) => ({ v, s: i === 7 || i === 9 ? 'total' : 'money' })),
      ]);
    }
    rows.push([{ v: '합계', s: 'label' }, ...Array(10).fill({ s: 'label' }), ...sum.map(v => ({ v, s: 'total' }))]);
    const r = rows.length;
    return {
      name: '급여대장', landscape: true,
      cols: [9, 9, 9, 8, 8, 10, 8, 8, 8, 8, 8, 12, 11, 11, 11, 11, 11, 11, 12, 11, 12],
      rows, merges: ['A1:U1', 'A2:U2', `A${r}:K${r}`], heights: { 0: 28, 3: 30 },
    };
  }

  function payslipSheet(c, ym) {
    const e = c.emp, st = c.stats, p = c.pay, s = P.schedOf(e);
    const [y, m] = ym.split('-').map(Number);
    const rows = [], merges = [], heights = {};
    const push = r => { rows.push(r); return rows.length; };
    const L = v => ({ v, s: 'label' }), C = v => ({ v, s: 'cell' }), H = v => ({ v, s: 'header' });
    const blank = st2 => ({ s: st2 });

    let r = push([{ v: `${y}년 ${m}월 급여명세서`, s: 'title' }]); merges.push(`A${r}:L${r}`); heights[r - 1] = 30;
    r = push([{ v: `${bizName()}  |  지급기간 ${c.mStart} ~ ${c.mEnd}  |  출력일 ${today()}`, s: 'note' }]); merges.push(`A${r}:L${r}`);
    push([]);
    r = push([L('직원번호'), C(e.id), blank('cell'), L('이름'), C(e.name), blank('cell'), L('직급'), C(e.position || '-'), blank('cell'), L('급여형태'), C(c.hourly ? '시급제' : '월급제'), blank('cell')]);
    merges.push(`B${r}:C${r}`, `E${r}:F${r}`, `H${r}:I${r}`, `K${r}:L${r}`);
    r = push([L(c.hourly ? '시급' : '월 기본급'), { v: c.hourly ? Number(e.hourlyWage) || 0 : Number(e.monthlySalary) || 0, s: 'money' }, blank('money'),
      L('입사일'), C(e.hireDate || '-'), blank('cell'), L('근무시간'), C(`${s.start}~${s.end}`), blank('cell'), L('근무요일'), C(daysLabel(s.days)), blank('cell')]);
    merges.push(`B${r}:C${r}`, `E${r}:F${r}`, `H${r}:I${r}`, `K${r}:L${r}`);
    push([]);

    r = push([H('지급 항목'), blank('header'), blank('header'), H('시간(h)'), H('금액(원)'), blank('header'), null, H('근태 요약'), blank('header'), blank('header'), H('내용'), blank('header')]);
    merges.push(`A${r}:C${r}`, `E${r}:F${r}`, `H${r}:J${r}`, `K${r}:L${r}`);
    const items = c.hourly ? [
      ['기본급 (실근무시간)', st.workMin, p.base, false],
      [`연장근로수당 (${c.mul.overtime}배)`, st.ot, p.overtime, st.ot > 0],
      [`야간근로수당 (+${c.mul.night}배)`, st.night, p.night, false],
      [`휴일근로수당 (${c.mul.holiday}배/${c.mul.holidayOver8}배)`, st.hol, p.holiday, false],
      ['주휴수당', c.juhyuMin, p.juhyu, false],
      ['유급휴가 (연차·월차)', st.leaveMin, p.leave, false],
    ] : [['기본급 (월급)', null, p.base, false]];
    items.push([`기타수당${c.adj.extraNote ? ` (${c.adj.extraNote})` : ''}`, null, p.extra, false]);
    const payRows = items.map(([name, min, amt, red]) => [
      C(name), blank('cell'), blank('cell'), { v: min == null ? '' : hours(min), s: red ? 'redHours' : 'hours' }, { v: amt, s: 'money' }, blank('money')]);
    payRows.push([L('지급 합계'), blank('label'), blank('label'), blank('label'), { v: p.gross, s: 'total' }, blank('total')]);
    for (const it of c.ded.items) {
      payRows.push([C(`${it.name}${it.overridden ? ' (고지액)' : ''}`), blank('cell'), blank('cell'), blank('cell'), { v: it.amount, s: 'money' }, blank('money')]);
    }
    if (p.manualDeduction || !c.ded.items.length) {
      payRows.push([C(`기타 공제${c.adj.deductionNote ? ` (${c.adj.deductionNote})` : ''}`), blank('cell'), blank('cell'), blank('cell'), { v: p.manualDeduction, s: 'money' }, blank('money')]);
    }
    payRows.push([L('공제 합계'), blank('label'), blank('label'), blank('label'), { v: p.deduction, s: 'total' }, blank('total')]);
    payRows.push([L('실 지급액'), blank('label'), blank('label'), blank('label'), { v: p.net, s: 'total' }, blank('total')]);
    const summary = [
      ['근무일수', `${st.workDays}일`, false],
      ['총 근무시간', fmtMin(st.workMin), false],
      ['지각', `${st.lateCount}회 (${fmtMin(st.lateMin)})`, st.lateCount > 0],
      ['조퇴', `${st.earlyCount}회 (${fmtMin(st.earlyMin)})`, st.earlyCount > 0],
      ['결근', `${st.absent}일`, st.absent > 0],
      ['연장근로', fmtMin(st.ot), st.ot > 0],
      ['야간근로', fmtMin(st.night), false],
      ['휴일근로', fmtMin(st.hol), false],
      ['유급휴가', `${st.leaveDays}일`, false],
      ['퇴근 미기록', `${st.incomplete}건`, st.incomplete > 0],
    ];
    const n = Math.max(payRows.length, summary.length);
    for (let i = 0; i < n; i++) {
      const left = payRows[i] || [null, null, null, null, null, null];
      const sm = summary[i];
      const right = sm ? [L(sm[0]), blank('label'), blank('label'), { v: sm[1], s: sm[2] ? 'red' : 'center' }, blank(sm[2] ? 'red' : 'center')] : [];
      r = push([...left, null, ...right]);
      if (payRows[i]) merges.push(`A${r}:C${r}`, `E${r}:F${r}`);
      if (sm) merges.push(`H${r}:J${r}`, `K${r}:L${r}`);
    }
    push([]);

    push([{ v: '일별 근태 내역', s: 'sub' }]);
    push(['날짜', '요일', '출근', '퇴근', '휴게(분)', '근무(h)', '지각(분)', '조퇴(분)', '연장(h)', '야간(h)', '휴일(h)', '비고'].map(H));
    for (const row of c.rows) {
      const d = row.day;
      if (d) {
        const lastRec = d.records[d.records.length - 1];
        const ot = d.dailyOT + d.weeklyOT;
        const notes = [];
        if (d.late) notes.push(`지각 ${d.late}분`);
        if (d.early) notes.push(`조퇴 ${d.early}분`);
        if (ot) notes.push(`연장 ${fmtMin(ot)}`);
        if (d.holiday) notes.push('휴일근무');
        if (d.incomplete) notes.push('퇴근 미기록');
        if (d.records.length > 1) notes.push(`${d.records.length}회 출퇴근`);
        if (d.edited) notes.push('수정됨');
        const redNote = d.late || d.early || ot || d.incomplete;
        push([
          { v: row.date, s: 'center' }, { v: WD[row.wd], s: 'center' },
          { v: hm(d.records[0].in), s: d.late ? 'red' : 'center' },
          { v: lastRec.out ? outLabel(lastRec) : '미기록', s: d.incomplete || d.early ? 'red' : 'center' },
          { v: d.incomplete && !d.work ? '' : d.brk, s: 'center' }, { v: d.incomplete && !d.work ? '' : hours(d.work), s: 'hours' },
          { v: d.late || '', s: d.late ? 'red' : 'center' }, { v: d.early || '', s: d.early ? 'red' : 'center' },
          { v: ot ? hours(ot) : '', s: ot ? 'redHours' : 'hours' },
          { v: d.night ? hours(d.night) : '', s: 'hours' }, { v: d.hol ? hours(d.hol) : '', s: 'hours' },
          { v: notes.join(', '), s: redNote ? 'redText' : 'cell' },
        ]);
      } else {
        const off = !row.scheduled && !row.leaves.length;
        const sty = off ? 'gray' : 'center';
        push([
          { v: row.date, s: sty }, { v: WD[row.wd], s: sty },
          ...Array(9).fill({ s: sty }),
          { v: row.status, s: row.status === '결근' ? 'red' : off ? 'gray' : 'cell' },
        ]);
      }
    }
    push([]);
    const notes = [
      `※ 적용 배수: 연장 ${c.mul.overtime}배, 야간 +${c.mul.night}배, 휴일 ${c.mul.holiday}배 (8시간 초과 ${c.mul.holidayOver8}배)${S.settings.under5 ? ' — 5인 미만 사업장: 가산수당 미적용' : ''}`,
      c.hourly ? `※ 주휴수당: ${c.weeks.filter(w => w.eligible).length}주 지급 (주 15시간 이상·개근 기준, 그 주 일요일이 속한 달에 반영)` : '※ 월급제: 출퇴근 기록만 관리하며 기본급은 설정된 월급으로 표시됩니다.',
      '※ 빨간색 표시: 지각 · 조퇴 · 연장근로 · 결근 · 퇴근 미기록',
      c.ded.mode === 'insurance' ? '※ 4대보험은 요율로 계산한 예상액입니다("고지액" 표시는 실제 고지 금액). 근로소득세는 기타 공제에 포함됩니다.'
        : c.ded.mode === 'tax33' ? '※ 3.3% 원천징수: 사업소득세 3% + 지방소득세 0.3% (10원 미만 절사)'
          : '※ 공제 항목은 관리자가 입력한 금액입니다.',
    ];
    for (const t of notes) { r = push([{ v: t, s: 'note' }]); merges.push(`A${r}:L${r}`); }
    return { name: `${e.name}(${e.id})`, cols: [11, 6, 9, 10, 9, 9, 9, 9, 9, 9, 9, 26], rows, merges, heights };
  }

  function exportPayslips(ym, emps) {
    if (!emps.length) { toast('대상 직원이 없습니다', 'err'); return; }
    const calcs = emps.map(e => P.calcMonth(S, e, ym, today()));
    const sheets = [];
    if (calcs.length > 1) sheets.push(summarySheet(calcs, ym));
    calcs.forEach(c => sheets.push(payslipSheet(c, ym)));
    const bytes = X.build(sheets);
    const safe = s => String(s).replace(/[\\/:*?"<>|]/g, '_');
    const fname = emps.length === 1 ? `월급명세서_${ym}_${safe(emps[0].name)}.xlsx` : `월급명세서_${ym}_전체.xlsx`;
    download(bytes, fname, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    audit('명세서 출력', `${ym} ${emps.length}명`);
    save().catch(() => {});
    toast('엑셀 파일을 저장했습니다');
  }

  // --- 설정 ---
  function tabSettings() {
    const st = S.settings, m = st.mul, ir = P.insRates(st);
    return `<h2>설정</h2>
      <section class="panel">
        <h3>사업장</h3>
        <label>사업장 이름<input id="s_biz" value="${esc(st.businessName)}" placeholder="예: OO카페 강남점"></label>
        <label>출퇴근 화면 시계<select id="s_clock">
          <option value="24" ${st.clockFormat !== '12' ? 'selected' : ''}>24시간제 (예: 15:30:00)</option>
          <option value="12" ${st.clockFormat === '12' ? 'selected' : ''}>12시간제 AM/PM (예: PM 3:30:00)</option></select>
          <small>출퇴근 화면에서 시계를 눌러도 바꿀 수 있습니다.</small></label>
        <label class="chk"><input type="checkbox" id="s_under5" ${st.under5 ? 'checked' : ''} data-change="under5">
          <span><b>상시 근로자 5인 미만 사업장</b><br><small>연장·야간·휴일 가산수당이 법적 의무가 아니므로 가산 없이(1배) 계산합니다. 주휴수당은 5인 미만도 의무입니다.</small></span></label>
      </section>
      <section class="panel">
        <h3>수당 배수 <small>(기본값: 법정 기준)</small></h3>
        <div class="grid4">
          <label>연장근로 (배)<input type="number" id="s_ot" step="0.1" min="1" value="${m.overtime}" ${st.under5 ? 'disabled' : ''}></label>
          <label>야간 가산 (+배)<input type="number" id="s_night" step="0.1" min="0" value="${m.night}" ${st.under5 ? 'disabled' : ''}></label>
          <label>휴일근로 8시간 이내 (배)<input type="number" id="s_hol" step="0.1" min="1" value="${m.holiday}" ${st.under5 ? 'disabled' : ''}></label>
          <label>휴일근로 8시간 초과 (배)<input type="number" id="s_hol8" step="0.1" min="1" value="${m.holidayOver8}" ${st.under5 ? 'disabled' : ''}></label>
        </div>
        <button class="btn small" data-act="setLegal">법정 기본값으로 되돌리기</button>
        <p class="hint">법정 기준: 연장(1일 8시간·주 40시간 초과) 1.5배, 야간(22시~06시) 0.5배 가산, 휴일 1.5배(8시간 초과 2배). 법정 기준보다 낮게 설정하면 법 위반이 될 수 있습니다.</p>
      </section>
      <section class="panel">
        <h3>근태 규칙</h3>
        <div class="grid2">
          <label>지각 유예시간 (분)<input type="number" id="s_grace" min="0" step="1" value="${st.lateGraceMin}"><small>예: 5분이면 09:05까지는 지각 아님</small></label>
          <label>연장근로 인정 단위 (분)<input type="number" id="s_otunit" min="0" step="5" value="${st.otUnitMin ?? 0}"><small>예: 10분이면 18:07 퇴근은 연장 0분, 18:25 퇴근은 연장 20분. 0이면 1분 단위(권장). 단위로 버리는 시간은 임금 체불로 문제될 수 있습니다</small></label>
          <label class="chk"><input type="checkbox" id="s_clip" ${st.clipEarly !== false ? 'checked' : ''}> <span>정해진 출근 시간 전에 일찍 온 시간은 근무로 치지 않음<br><small>예: 09:00 출근인데 08:50에 찍으면 09:00부터 계산</small></span></label>
          <label class="chk"><input type="checkbox" id="s_juhyu" ${st.weeklyHolidayPay !== false ? 'checked' : ''}> 시급제 주휴수당 자동 계산</label>
        </div>
        <label>공휴일 (한 줄에 하나, YYYY-MM-DD)
          <textarea id="s_hol_list" rows="4" placeholder="2026-12-25">${esc((st.holidays || []).join('\n'))}</textarea>
          <small>여기 입력한 날은 근무일이 아닌 날로 처리되어, 근무하면 휴일근로로 계산됩니다.</small></label>
      </section>
      <section class="panel">
        <h3>4대보험 요율 <small>(근로자 부담분, 2026년 기본값)</small></h3>
        <div class="grid4">
          <label>국민연금 (%)<input type="number" id="s_ins_pension" step="0.001" min="0" value="${ir.pension}"></label>
          <label>건강보험 (%)<input type="number" id="s_ins_health" step="0.001" min="0" value="${ir.health}"></label>
          <label>장기요양 (건강보험료의 %)<input type="number" id="s_ins_ltc" step="0.01" min="0" value="${ir.ltc}"></label>
          <label>고용보험 (%)<input type="number" id="s_ins_employ" step="0.01" min="0" value="${ir.employ}"></label>
          <label>국민연금 기준소득 하한 (원)<input type="number" id="s_ins_pmin" step="10000" min="0" value="${ir.pensionMin}"></label>
          <label>국민연금 기준소득 상한 (원)<input type="number" id="s_ins_pmax" step="10000" min="0" value="${ir.pensionMax}"></label>
        </div>
        <button class="btn small" data-act="setInsDefault">2026년 기본값으로 되돌리기</button>
        <p class="hint">요율은 매년 바뀝니다(국민연금 상·하한은 매년 7월). 바뀌면 여기서 고치세요. 계산 결과는 예상액이며, 실제 고지액과 다르면 [급여·명세서 → 수당·공제]에서 고쳐 쓸 수 있습니다.</p>
      </section>
      <div class="bar end"><button class="btn primary big" data-act="setSave">설정 저장</button></div>
      <section class="panel">
        <h3>관리자 비밀번호</h3>
        <button class="btn" data-act="pwChange">비밀번호 변경</button>
      </section>`;
  }

  async function saveSettings() {
    const g = id => document.getElementById(id);
    const under5 = g('s_under5').checked;
    const mul = { overtime: Number(g('s_ot').value), night: Number(g('s_night').value), holiday: Number(g('s_hol').value), holidayOver8: Number(g('s_hol8').value) };
    if (!(mul.overtime >= 1 && mul.night >= 0 && mul.holiday >= 1 && mul.holidayOver8 >= 1)) {
      toast('배수를 확인하세요 (연장·휴일은 1 이상, 야간은 0 이상)', 'err');
      return;
    }
    const holidays = [...new Set(g('s_hol_list').value.match(/\d{4}-\d{2}-\d{2}/g) || [])].sort();
    const insRates = {
      pension: Number(g('s_ins_pension').value), health: Number(g('s_ins_health').value), ltc: Number(g('s_ins_ltc').value),
      employ: Number(g('s_ins_employ').value), pensionMin: Number(g('s_ins_pmin').value), pensionMax: Number(g('s_ins_pmax').value),
    };
    if (Object.values(insRates).some(v => !(v >= 0)) || insRates.pension > 20 || insRates.health > 20 || insRates.employ > 20) {
      toast('4대보험 요율을 확인하세요', 'err');
      return;
    }
    const st = S.settings;
    const ch = [];
    if (st.under5 !== under5) ch.push(`5인 미만 ${under5 ? '적용' : '해제'}`);
    if (JSON.stringify(st.mul) !== JSON.stringify(mul)) ch.push(`배수 연장${mul.overtime}/야간${mul.night}/휴일${mul.holiday}/${mul.holidayOver8}`);
    Object.assign(st, {
      businessName: g('s_biz').value.trim(), clockFormat: g('s_clock').value === '12' ? '12' : '24', under5, mul,
      lateGraceMin: Math.max(0, Math.round(Number(g('s_grace').value) || 0)),
      otUnitMin: Math.max(0, Math.round(Number(g('s_otunit').value) || 0)),
      clipEarly: g('s_clip').checked,
      weeklyHolidayPay: g('s_juhyu').checked, holidays, insRates,
    });
    audit('설정 변경', ch.join(', ') || '일반 설정');
    await save(); render(); toast('설정을 저장했습니다');
  }

  function pwChange() {
    openModal('관리자 비밀번호 변경', `
      <label>현재 비밀번호<input type="password" id="p0" autocomplete="current-password"></label>
      <label>새 비밀번호 (4자 이상)<input type="password" id="p1" autocomplete="new-password"></label>
      <label>새 비밀번호 확인<input type="password" id="p2" autocomplete="new-password"></label>`, {
      okText: '변경',
      onOk: async w => {
        const st = S.settings;
        if (Sha256(st.adminSalt + ':' + w.querySelector('#p0').value) !== st.adminHash) fail('현재 비밀번호가 틀렸습니다');
        const a = w.querySelector('#p1').value;
        if (a.length < 4) fail('4자 이상 입력하세요');
        if (a !== w.querySelector('#p2').value) fail('새 비밀번호가 일치하지 않습니다');
        st.adminSalt = uid();
        st.adminHash = Sha256(st.adminSalt + ':' + a);
        audit('관리자', '비밀번호 변경');
        await save(); toast('비밀번호를 변경했습니다');
      },
    });
  }

  // --- 백업 ---
  function tabBackup() {
    const lb = S.settings.lastBackup;
    return `<h2>백업 · 복원</h2>
      <section class="panel">
        <p>모든 데이터(직원, 출퇴근 기록, 휴가, 설정)는 <b>이 PC의 이 브라우저 안에만</b> 저장됩니다.
        브라우저 데이터를 지우거나, PC나 브라우저를 바꾸면 사라질 수 있으니 <b>백업 파일을 USB나 클라우드에 따로 보관</b>하세요.</p>
        <p>마지막 백업: <b>${lb ? esc(lb.replace('T', ' ').slice(0, 16)) : '없음'}</b></p>
        <button class="btn primary big" data-act="backupDl">백업 파일 다운로드</button>
      </section>
      <section class="panel">
        <h3>백업 파일로 복원</h3>
        <p class="warn-text">복원하면 현재 데이터가 백업 파일의 내용으로 <b>모두 교체</b>됩니다.</p>
        <input type="file" accept=".json,application/json" data-change="restoreFile" aria-label="백업 파일 선택">
      </section>
      <section class="panel">
        <h3>저장 현황</h3>
        <p>직원 ${S.employees.length}명 · 출퇴근 기록 ${S.records.length}건 · 휴가 ${S.leaves.length}건 · 이력 ${S.audit.length}건</p>
      </section>`;
  }

  async function backupDownload() {
    const now = new Date();
    S.settings.lastBackup = P.toDT(now);
    audit('백업', '백업 파일 다운로드');
    await save();
    const payload = JSON.stringify({ app: 'geuntae', exportedAt: P.toDT(now), state: S }, null, 1);
    const stamp = P.toDT(now).replace(/[-:]/g, '').replace('T', '_');
    download(payload, `근퇴관리_백업_${stamp}.json`, 'application/json');
    render();
    toast('백업 파일을 저장했습니다');
  }

  function restoreFromFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let obj;
      try { obj = JSON.parse(reader.result); } catch { toast('백업 파일을 읽을 수 없습니다', 'err'); input.value = ''; return; }
      if (!obj || obj.app !== 'geuntae' || !obj.state || !Array.isArray(obj.state.employees)) { toast('근퇴관리 백업 파일이 아닙니다', 'err'); input.value = ''; return; }
      const s = obj.state;
      openModal('백업 복원', `<p>백업 일시: <b>${esc(String(obj.exportedAt || '').replace('T', ' '))}</b></p>
        <p>직원 ${s.employees.length}명 · 기록 ${(s.records || []).length}건 · 휴가 ${(s.leaves || []).length}건</p>
        <p class="warn-text">현재 데이터가 모두 이 내용으로 교체됩니다. 계속할까요?</p>`, {
        okText: '복원', danger: true,
        onOk: async () => {
          S = normalize(s);
          audit('복원', `${String(obj.exportedAt || '')} 백업에서 복원`);
          await save(); render(); toast('복원했습니다');
        },
      });
      input.value = '';
    };
    reader.readAsText(file);
  }

  // ---------- 이벤트 ----------
  const ACTIONS = {
    key: t => {
      const i = document.getElementById('empNo');
      const k = t.dataset.k;
      if (k === 'C') i.value = '';
      else if (k === 'B') i.value = i.value.slice(0, -1);
      else if (i.value.length < 12) i.value += k;
      focusEmpNo();
    },
    punch: t => punch(t.dataset.type),
    toAdmin: () => askAdmin(),
    clockFmt: async () => {
      S.settings.clockFormat = S.settings.clockFormat === '12' ? '24' : '12';
      const c = document.getElementById('clock');
      if (c) c.dispatchEvent(new Event('tick'));
      await save();
      focusEmpNo();
    },
    toKiosk: () => toKiosk(),
    tab: t => { tab = t.dataset.tab; render(); window.scrollTo(0, 0); },
    empAdd: () => empForm(null),
    empEdit: t => empForm(empById(t.dataset.id)),
    empDel: t => empDelete(t.dataset.id),
    recAdd: () => recordForm(null),
    recEdit: t => recordForm(S.records.find(r => r.id === t.dataset.id)),
    recDel: t => recordDelete(t.dataset.id),
    recXls: () => exportRecords(),
    recPrint: () => window.print(),
    leaveAdd: () => leaveForm(),
    leaveDel: async t => {
      const l = S.leaves.find(x => x.id === t.dataset.id);
      if (!l) return;
      openModal('휴가 삭제', `<p>${esc(empName(l.empId))} · ${l.date} ${esc(l.type)} 를 삭제할까요?</p>`, {
        okText: '삭제', danger: true,
        onOk: async () => {
          S.leaves = S.leaves.filter(x => x !== l);
          audit('휴가 삭제', `${empName(l.empId)}(${l.empId}) ${l.date} ${l.type}`);
          await save(); render();
        },
      });
    },
    grantHint: async t => {
      S.leaveGrants[`${t.dataset.id}|${ui.year}`] = Number(t.dataset.days);
      audit('휴가 부여', `${empName(t.dataset.id)}(${t.dataset.id}) ${ui.year}년 ${t.dataset.days}일 (법정 참고값)`);
      await save(); render();
    },
    payDetail: t => payDetail(t.dataset.id),
    payAdj: t => payAdjForm(t.dataset.id),
    payXls: t => exportPayslips(ui.month, [empById(t.dataset.id)].filter(Boolean)),
    payXlsAll: () => exportPayslips(ui.month, payrollEmps(ui.month)),
    setSave: () => saveSettings(),
    setLegal: () => {
      const m = P.LEGAL_MUL;
      document.getElementById('s_ot').value = m.overtime;
      document.getElementById('s_night').value = m.night;
      document.getElementById('s_hol').value = m.holiday;
      document.getElementById('s_hol8').value = m.holidayOver8;
      toast('법정 기본값을 채웠습니다. [설정 저장]을 눌러야 적용됩니다.');
    },
    setInsDefault: () => {
      const d = P.DEFAULT_INS;
      [['s_ins_pension', d.pension], ['s_ins_health', d.health], ['s_ins_ltc', d.ltc], ['s_ins_employ', d.employ], ['s_ins_pmin', d.pensionMin], ['s_ins_pmax', d.pensionMax]]
        .forEach(([id, v]) => { document.getElementById(id).value = v; });
      toast('2026년 기본값을 채웠습니다. [설정 저장]을 눌러야 적용됩니다.');
    },
    pwChange: () => pwChange(),
    backupDl: () => backupDownload(),
  };
  const CHANGES = {
    month: t => { if (t.value) { ui.month = t.value; render(); } },
    recScope: t => { ui.recScope = t.value === 'all' ? 'all' : 'month'; render(); },
    year: t => { ui.year = Number(t.value); render(); },
    grant: async t => {
      const key = `${t.dataset.id}|${ui.year}`;
      if (t.value === '') delete S.leaveGrants[key];
      else {
        const v = Number(t.value);
        if (!(v >= 0)) { toast('0 이상의 숫자를 입력하세요', 'err'); return; }
        S.leaveGrants[key] = v;
      }
      audit('휴가 부여', `${empName(t.dataset.id)}(${t.dataset.id}) ${ui.year}년 ${t.value || '미설정'}일`);
      await save(); render();
    },
    under5: t => {
      ['s_ot', 's_night', 's_hol', 's_hol8'].forEach(id => { document.getElementById(id).disabled = t.checked; });
    },
    restoreFile: t => restoreFromFile(t),
  };

  app.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || !app.contains(t)) return;
    const fn = ACTIONS[t.dataset.act];
    if (fn) fn(t, e);
  });
  // 검색창: 입력창은 그대로 두고 결과만 갱신 (한글 입력 중에도 끊기지 않음)
  app.addEventListener('input', e => {
    if (e.target.dataset && e.target.dataset.input === 'recQ') {
      ui.recQ = e.target.value;
      const box = document.getElementById('recResults');
      if (box) box.innerHTML = recResultsHtml();
      const pt = document.querySelector('.print-title');
      if (pt) pt.innerHTML = recPrintTitle();
    }
  });
  app.addEventListener('change', e => {
    const t = e.target.closest('[data-change]');
    if (t && CHANGES[t.dataset.change]) CHANGES[t.dataset.change](t, e);
  });
  document.addEventListener('keydown', e => {
    if (view === 'admin') { resetIdle(); return; }
    if (document.querySelector('.modal-bg')) return;
    const i = document.getElementById('empNo');
    if (!i) return;
    if (e.key === 'Enter' && document.activeElement === i) {
      kmsg('<b>출근</b> 또는 <b>퇴근</b> 버튼을 눌러주세요', 'warn');
    } else if (/^[0-9]$/.test(e.key) && document.activeElement !== i) {
      i.focus();
    }
  });
  document.addEventListener('pointerdown', () => { if (view === 'admin') resetIdle(); });

  // 다른 탭/창에서 저장하면 최신 데이터로 갱신 (덮어쓰기 방지)
  async function reloadFromStore() {
    pendingReload = false;
    S = normalize(await Store.get('state'));
    if (view === 'kiosk') {
      const i = document.getElementById('empNo');
      const v = i ? i.value : '';
      const brand = document.querySelector('.k-head .brand');
      if (brand) brand.textContent = bizName();
      if (i) i.value = v;
    } else render();
  }
  if (bc) {
    bc.onmessage = () => {
      if (document.querySelector('.modal-bg')) pendingReload = true;
      else reloadFromStore();
    };
  }

  // ---------- 시작 ----------
  async function init() {
    try {
      S = normalize(await Store.get('state'));
    } catch (e) {
      app.innerHTML = `<div class="fatal">데이터 저장소를 열 수 없습니다 (${esc(e.message)}).<br>시크릿/개인정보 보호 창이 아닌 일반 창에서 열어주세요.</div>`;
      return;
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    render();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  init();
})();
