/* 가이드 페이지용 간단 계산기 (form.calc[data-calc]) */
(function () {
  'use strict';
  const MIN_WAGE = 10320; // 2026년
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const r2 = n => Math.round(n * 100) / 100;
  const num = (f, name) => Math.max(0, Number(f.querySelector(`[name=${name}]`).value) || 0);
  const row = (k, v, cls = '') => `<div class="row ${cls}"><span>${k}</span><span>${v}</span></div>`;
  const note = t => `<div class="row"><span style="color:#6b7486;font-size:14px">${t}</span></div>`;

  const date = (f, name) => {
    const v = f.querySelector(`[name=${name}]`).value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const DAY = 86400000;
  const days = (a, b) => Math.round((b - a) / DAY); // b - a (일)
  const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
  const floor10 = n => Math.floor(Math.max(0, n) / 10) * 10;

  const CALC = {
    // 인건비 비율
    laborRatio(f) {
      const sales = num(f, 'sales'), wage = num(f, 'wages');
      const ins = Math.round(wage * 0.1); // 사업주 4대보험 부담 대략 10%
      const sev = Math.round(wage / 12);  // 퇴직금 적립분
      const total = wage + (f.querySelector('[name=addIns]').checked ? ins + sev : 0);
      const ratio = sales > 0 ? total / sales * 100 : 0;
      return row('월 급여 합계', won(wage))
        + (f.querySelector('[name=addIns]').checked ? row('사업주 4대보험 (약 10%)', won(ins)) + row('퇴직금 적립분 (1/12)', won(sev)) : '')
        + row('실제 인건비', won(total))
        + row('인건비 비율 (인건비 ÷ 매출)', `<b>${ratio.toFixed(1)}%</b>`, 'total');
    },
    // 손익분기점
    breakEven(f) {
      const fixed = num(f, 'fixed'), cost = num(f, 'costRate') / 100, price = num(f, 'price');
      if (cost >= 1) return note('원가율(변동비율)은 100% 미만이어야 합니다.');
      const bep = fixed / (1 - cost);
      return row('월 고정비', won(fixed))
        + row('공헌이익률 (1 − 원가율)', `${((1 - cost) * 100).toFixed(1)}%`)
        + row('손익분기 월 매출', `<b>${won(bep)}</b>`, 'total')
        + row('하루 평균 (30일 영업 기준)', won(bep / 30))
        + (price > 0 ? row(`객단가 ${won(price)} 기준 하루 손님`, `${Math.ceil(bep / 30 / price).toLocaleString('ko-KR')}명`) : '');
    },
    // 연차휴가 일수 (근로기준법 제60조)
    annualLeave(f) {
      const hire = date(f, 'hire'), ref = date(f, 'ref');
      if (!hire || !ref) return note('입사일과 기준일을 입력하세요.');
      if (ref < hire) return note('기준일이 입사일보다 빠릅니다.');
      const ok80 = f.querySelector('[name=att80]').checked;
      let months = (ref.getFullYear() - hire.getFullYear()) * 12 + (ref.getMonth() - hire.getMonth());
      if (ref.getDate() < hire.getDate()) months--;
      const years = Math.floor(months / 12);
      if (years < 1) {
        return row('근속', `${months}개월`) + row('발생 연차 (1개월 개근마다 1일)', `<b>${Math.min(11, months)}일</b>`, 'total')
          + note('입사 1년 미만은 매달 개근하면 1일씩, 최대 11일 생깁니다.');
      }
      if (!ok80) return row('근속', `${years}년`) + row('올해 새로 생기는 연차', '<b>개근한 달 수만큼</b>', 'total') + note('직전 1년 출근율이 80% 미만이면, 그 1년 동안 개근한 달마다 1일씩만 생깁니다.');
      const d = Math.min(25, 15 + Math.floor((years - 1) / 2));
      return row('근속', `${years}년`) + row('올해 새로 생기는 연차', `<b>${d}일</b>`, 'total')
        + (years >= 3 ? note('3년 이상 근속하면 2년마다 1일씩 늘어나며 최대 25일입니다.') : note('1년 이상 근무하고 출근율이 80% 이상이면 15일입니다.'));
    },
    // 퇴직금 (근로자퇴직급여 보장법)
    severance(f) {
      const hire = date(f, 'hire'), last = date(f, 'last');
      if (!hire || !last) return note('입사일과 마지막 근무일을 입력하세요.');
      const quit = new Date(last.getTime() + DAY); // 퇴직일 = 마지막 근무일 다음 날
      const tenure = days(hire, quit);
      if (tenure < 365) return row('재직일수', `${tenure}일`) + row('퇴직금', '<b>0원</b>', 'total') + note('계속근로기간이 1년 미만이면 퇴직금이 발생하지 않습니다.');
      const p3 = days(addMonths(quit, -3), quit);
      const wage3 = num(f, 'wage3'), bonus = num(f, 'bonus'), leavePay = num(f, 'leavePay');
      const total3 = wage3 + bonus * 3 / 12 + leavePay * 3 / 12;
      const avg = total3 / p3;
      const sev = avg * 30 * tenure / 365;
      return row('재직일수', `${tenure.toLocaleString('ko-KR')}일`)
        + row(`최근 3개월 임금 (${p3}일, 상여·연차수당 3/12 포함)`, won(total3))
        + row('1일 평균임금', won(avg))
        + row('예상 퇴직금 (평균임금 × 30 × 재직일수/365)', `<b>${won(sev)}</b>`, 'total')
        + note('평균임금이 통상임금보다 적으면 통상임금으로 계산합니다. 세금(퇴직소득세)은 빼지 않은 금액입니다.');
    },
    // 해고예고수당 (근로기준법 제26조)
    dismissal(f) {
      const w = num(f, 'wage'), h = num(f, 'dayHours');
      const day = w * h;
      return row('1일 통상임금', `${won(day)} (시급 × ${h}시간)`)
        + row('해고예고수당 (30일분)', `<b>${won(day * 30)}</b>`, 'total')
        + note('30일 전에 예고했다면 지급하지 않아도 됩니다. 계속 근로 3개월 미만인 직원 등은 예외입니다.');
    },
    // 수습기간 최저임금 90%
    probation(f) {
      const h = num(f, 'hours');
      const base = Math.min(h, 40);
      const jh = base >= 15 ? Math.min(8, (base / 40) * 8) : 0;
      const monthH = Math.round((base + jh) * 4.345);
      const p = Math.round(MIN_WAGE * 0.9);
      const ok = f.querySelector('[name=eligible]').checked;
      if (!ok) return row('수습 중 최저 시급', `<b>${MIN_WAGE.toLocaleString('ko-KR')}원</b> (감액 불가)`, 'total') + note('1년 미만 계약이거나 단순노무직이면 수습기간에도 최저임금 100%를 줘야 합니다.');
      return row('2026년 최저시급', `${MIN_WAGE.toLocaleString('ko-KR')}원`)
        + row('수습 3개월 최저 시급 (90%)', `<b>${p.toLocaleString('ko-KR')}원</b>`, 'total')
        + row(`월 환산 (${monthH}시간)`, won(p * monthH));
    },
    // 최저임금 위반 확인 (월급 → 시간급)
    minwage(f) {
      const pay = num(f, 'pay'), excl = num(f, 'excl'), h = num(f, 'hours') || 209;
      const hourly = Math.max(0, pay - excl) / h;
      const ok = hourly >= MIN_WAGE;
      return row('최저임금 비교 대상 임금', won(Math.max(0, pay - excl)))
        + row(`시간급 환산 (÷ ${h}시간)`, `<b>${Math.floor(hourly).toLocaleString('ko-KR')}원</b>`, 'total')
        + row('2026년 최저시급', `${MIN_WAGE.toLocaleString('ko-KR')}원`)
        + note(ok ? '✅ 최저임금 이상입니다.' : `⚠ 최저임금보다 시간당 ${Math.ceil(MIN_WAGE - hourly).toLocaleString('ko-KR')}원 부족합니다. 월 ${won(MIN_WAGE * h - Math.max(0, pay - excl))} 이상 올려야 합니다.`);
    },
    // 4대보험 근로자 부담분 (2026년)
    insurance(f) {
      const pay = num(f, 'pay'), tf = num(f, 'taxFree');
      const base = Math.max(0, pay - tf);
      const pb = Math.min(Math.max(base, 400000), 6370000);
      const pen = f.querySelector('[name=pension]').checked ? floor10(pb * 0.0475) : 0;
      const hl = floor10(base * 0.03595);
      const ltc = floor10(hl * 0.1314);
      const emp = floor10(base * 0.009);
      return row('보험료 기준 금액 (비과세 제외)', won(base))
        + row('국민연금 4.75%', pen ? won(pen) : '제외')
        + row('건강보험 3.595%', won(hl))
        + row('장기요양 (건강보험료의 13.14%)', won(ltc))
        + row('고용보험 0.9%', won(emp))
        + row('근로자 부담 합계 (예상)', `<b>${won(pen + hl + ltc + emp)}</b>`, 'total')
        + note('사업주도 거의 같은 금액에 산재보험료와 고용안정 부담분을 더 냅니다. 실제 고지액은 신고한 보수월액 기준이라 다를 수 있습니다.');
    },
    overtime(f) {
      const w = num(f, 'wage'), ot = num(f, 'ot'), nt = num(f, 'night'), h8 = num(f, 'hol'), h8o = num(f, 'holOver');
      const u5 = f.querySelector('[name=under5]').checked;
      const m = u5 ? { ot: 1, n: 0, h: 1, h2: 1 } : { ot: 1.5, n: 0.5, h: 1.5, h2: 2 };
      const a = ot * w * m.ot, b = nt * w * m.n, c = h8 * w * m.h + h8o * w * m.h2;
      return row(`연장근로 ${ot}시간 × ${m.ot}배`, won(a))
        + row(`야간 가산 ${nt}시간 × ${m.n}배`, won(b))
        + row(`휴일근로 ${h8}시간 × ${m.h}배 + ${h8o}시간 × ${m.h2}배`, won(c))
        + row('합계', `<b>${won(a + b + c)}</b>`, 'total')
        + (u5 ? note('5인 미만 사업장: 가산 없이 시간만큼만 지급(법정 최소 기준)') : '');
    },
    juhyu(f) {
      const w = num(f, 'wage'), h = num(f, 'hours');
      if (h < 15) return row('주휴수당', '<b>0원</b>', 'total') + note('1주 소정근로시간이 15시간 미만이면 주휴수당이 발생하지 않습니다.');
      const jh = Math.min(8, (Math.min(h, 40) / 40) * 8);
      return row('주휴시간', `${r2(jh)}시간`)
        + row('1주 주휴수당', `<b>${won(jh * w)}</b>`, 'total')
        + row('한 달 환산 (× 4.345주)', won(jh * w * 4.345));
    },
    monthly(f) {
      const w = num(f, 'wage'), h = num(f, 'hours');
      const base = Math.min(h, 40);
      const jh = base >= 15 ? Math.min(8, (base / 40) * 8) : 0;
      const monthH = Math.round((base + jh) * 4.345);
      let out = row('월 유급 근로시간 (주휴 포함)', `${monthH}시간`)
        + row('예상 월 기본급', `<b>${won(monthH * w)}</b>`, 'total');
      if (h > 40) out += note('주 40시간을 넘는 시간은 연장근로로 별도 계산합니다.');
      if (w > 0 && w < MIN_WAGE) out += note(`⚠ 2026년 최저시급 ${MIN_WAGE.toLocaleString('ko-KR')}원보다 낮습니다.`);
      return out;
    },
  };

  document.querySelectorAll('form.calc[data-calc]').forEach(f => {
    const out = f.querySelector('output');
    const fn = CALC[f.dataset.calc];
    if (!out || !fn) return;
    const run = () => { out.innerHTML = fn(f); };
    f.addEventListener('input', run);
    f.addEventListener('change', run);
    f.addEventListener('submit', e => e.preventDefault());
    run();
  });
})();
