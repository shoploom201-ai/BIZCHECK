/* 근태 분석 · 급여 계산 (브라우저/Node 공용, 순수 함수)
 *
 * 시간 문자열은 모두 로컬 시간 'YYYY-MM-DDTHH:MM' / 날짜는 'YYYY-MM-DD'.
 * 법정 기준(근로기준법):
 *  - 연장근로: 1일 8시간 또는 1주 40시간 초과분, 통상임금의 1.5배
 *  - 야간근로: 22:00~06:00, 통상임금의 0.5배 가산
 *  - 휴일근로: 8시간 이내 1.5배, 8시간 초과분 2.0배
 *  - 주휴수당: 1주 소정근로 15시간 이상 + 개근 시 (주 근로시간/40 × 8시간)분
 *  - 5인 미만 사업장: 연장·야간·휴일 가산 적용 제외 (주휴수당은 적용)
 */
(function (root) {
  'use strict';

  const LEGAL_MUL = Object.freeze({ overtime: 1.5, night: 0.5, holiday: 1.5, holidayOver8: 2.0 });
  const MIN_WAGE = { 2024: 9860, 2025: 10030, 2026: 10320 };
  const DAY = 480;   // 1일 법정 근로 (분)
  const WEEK = 2400; // 1주 법정 근로 (분)

  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toDT = d => `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  function parseDate(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
  function parseDT(s) {
    const [d, t = '00:00'] = String(s).split('T');
    const dt = parseDate(d);
    const [h, mi] = t.split(':').map(Number);
    dt.setHours(h, mi || 0, 0, 0);
    return dt;
  }
  function addDays(k, n) { const d = parseDate(k); d.setDate(d.getDate() + n); return dateKey(d); }
  const weekday = k => parseDate(k).getDay(); // 0=일
  const hmToMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  const diffMin = (a, b) => Math.round((b - a) / 60000);
  const mondayOf = k => { const w = weekday(k); return addDays(k, w === 0 ? -6 : 1 - w); };
  const lastDayOfMonth = ym => { const [y, m] = ym.split('-').map(Number); return dateKey(new Date(y, m, 0)); };
  // 연장근로 인정 단위(분)로 내림. 0 또는 미설정이면 1분 단위
  function floorUnit(min, settings) {
    const u = Math.max(0, Math.round(Number(settings && settings.otUnitMin) || 0));
    return u > 1 ? Math.floor(min / u) * u : min;
  }
  const minWage = year => MIN_WAGE[year] || MIN_WAGE[Math.max(...Object.keys(MIN_WAGE).map(Number))];

  function defaultSchedule() {
    return { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', breakMode: 'auto', breakMin: 60, weeklyHoliday: 0 };
  }
  function schedOf(emp) { return Object.assign(defaultSchedule(), (emp && emp.schedule) || {}); }

  function effectiveMul(settings) {
    if (settings && settings.under5) return { overtime: 1, night: 0, holiday: 1, holidayOver8: 1 };
    return Object.assign({}, LEGAL_MUL, (settings && settings.mul) || {});
  }

  /** 체류시간(분)에 대한 휴게시간(분). 자동: 체류 4시간 이상 30분, 8시간 이상 1시간
   *  (지각으로 체류시간이 줄었을 때 휴게가 덜 빠져 연장이 생기는 일을 막기 위해 체류시간 기준) */
  function breakFor(span, emp) {
    const s = schedOf(emp);
    if (s.breakMode === 'fixed') {
      const b = Math.max(0, Number(s.breakMin) || 0);
      return span >= 240 ? Math.min(b, span) : 0;
    }
    return span >= DAY ? 60 : span >= 240 ? 30 : 0;
  }

  /** 스케줄상 1일 소정근로(분) — 유급휴가·주휴 계산 기준 */
  function scheduledDailyMin(emp) {
    const s = schedOf(emp);
    let span = hmToMin(s.end) - hmToMin(s.start);
    if (span <= 0) span += 1440;
    return Math.max(0, span - breakFor(span, emp));
  }

  function isHolidayDate(settings, k) { return ((settings && settings.holidays) || []).includes(k); }
  function isScheduledDay(emp, k, settings) {
    if (isHolidayDate(settings, k)) return false;
    return schedOf(emp).days.map(Number).includes(weekday(k));
  }
  /** 주휴일(요일). 근무요일과 겹치면 근무하지 않는 첫 요일(일→토→월…)로 대체. 7일 모두 근무면 -1 */
  function weeklyHolidayOf(emp) {
    const s = schedOf(emp);
    const days = s.days.map(Number);
    const w = Number(s.weeklyHoliday);
    if (Number.isInteger(w) && w >= 0 && w <= 6 && !days.includes(w)) return w;
    const alt = [0, 6, 1, 2, 3, 4, 5].find(d => !days.includes(d));
    return alt === undefined ? -1 : alt;
  }
  /** 휴일근로 대상일: 주휴일 또는 설정된 공휴일. (근무요일이 아닌 그 밖의 날 = 무급 휴무일 → 연장근로로 계산) */
  function isHolidayWork(emp, k, settings) {
    return isHolidayDate(settings, k) || weekday(k) === weeklyHolidayOf(emp);
  }
  function isEmployed(emp, k) {
    if (emp.hireDate && k < emp.hireDate) return false;
    if (emp.leaveDate && k > emp.leaveDate) return false;
    return true;
  }

  /** a~b 구간 중 22:00~06:00에 해당하는 분 */
  function nightMinutes(a, b) {
    let total = 0;
    for (let k = addDays(dateKey(a), -1); parseDate(k) <= b; k = addDays(k, 1)) {
      const ws = parseDate(k); ws.setHours(22, 0, 0, 0);
      const we = parseDate(addDays(k, 1)); we.setHours(6, 0, 0, 0);
      const s = Math.max(a, ws), e = Math.min(b, we);
      if (e > s) total += (e - s) / 60000;
    }
    return Math.round(total);
  }

  /** 한 건의 출퇴근 기록 분석.
   *  settings.clipEarly(기본 true): 근무일에 스케줄 시작 전 일찍 출근한 시간은 근무로 인정하지 않음 */
  function recordWork(rec, emp, settings) {
    if (!rec.out) return { span: 0, brk: 0, work: 0, night: 0 };
    let a = parseDT(rec.in);
    const b = parseDT(rec.out);
    if (!(settings && settings.clipEarly === false) && isScheduledDay(emp, rec.date, settings)) {
      const st = parseDate(rec.date); st.setMinutes(hmToMin(schedOf(emp).start));
      if (a < st) a = st > b ? b : st;
    }
    const span = Math.max(0, diffMin(a, b));
    const brk = breakFor(span, emp);
    const work = span - brk;
    return { span, brk, work, night: Math.min(nightMinutes(a, b), work) };
  }

  /** 직원의 날짜별 근태 분석 (from~to 포함). 같은 날 여러 번 출퇴근 시 합산 */
  function analyzeDays(records, emp, settings, fromK, toK) {
    const byDate = {};
    for (const r of records) {
      if (r.empId !== emp.id || r.date < fromK || r.date > toK) continue;
      (byDate[r.date] = byDate[r.date] || []).push(r);
    }
    const s = schedOf(emp);
    const grace = Math.max(0, Number(settings && settings.lateGraceMin) || 0);
    const out = {};
    for (const k of Object.keys(byDate)) {
      const rs = byDate[k].slice().sort((x, y) => (x.in < y.in ? -1 : 1));
      let span = 0, brk = 0, night = 0;
      for (const r of rs) {
        const w = recordWork(r, emp, settings);
        span += w.span; brk += w.brk; night += w.night;
      }
      const work = span - brk;
      const holiday = !isScheduledDay(emp, k, settings);
      const incomplete = rs.some(r => !r.out);
      let late = 0, early = 0;
      if (!holiday) {
        const st = parseDate(k); st.setMinutes(hmToMin(s.start));
        const l = diffMin(st, parseDT(rs[0].in));
        late = l > grace ? l : 0;
        if (!incomplete && work > 0) {
          let endM = hmToMin(s.end);
          if (endM <= hmToMin(s.start)) endM += 1440;
          const se = parseDate(k); se.setMinutes(endM);
          const e = diffMin(parseDT(rs[rs.length - 1].out), se);
          early = e > 0 ? e : 0;
        }
      }
      out[k] = {
        date: k, records: rs, span, brk, work, night, holiday, incomplete, late, early,
        dailyOT: holiday ? 0 : floorUnit(Math.max(0, work - DAY), settings),
        weeklyOT: 0,
        hol: holiday ? work : 0,
        holOver8: holiday ? Math.max(0, work - DAY) : 0,
        edited: rs.some(r => r.edited || r.manual),
      };
    }
    return out;
  }

  /** 월 단위 근태·급여 계산 */
  function calcMonth(state, emp, ym, todayK) {
    const settings = state.settings || {};
    const mul = effectiveMul(settings);
    const mStart = `${ym}-01`, mEnd = lastDayOfMonth(ym);
    const from = mondayOf(mStart), to = addDays(mondayOf(mEnd), 6);
    const days = analyzeDays(state.records || [], emp, settings, from, to);
    const daily = scheduledDailyMin(emp);
    const hourly = emp.payType !== 'monthly';

    const leaveBy = {};
    for (const l of state.leaves || []) {
      if (l.empId !== emp.id || l.date < from || l.date > to) continue;
      (leaveBy[l.date] = leaveBy[l.date] || []).push(l);
    }
    const leaveDaysOn = k => (leaveBy[k] || []).reduce((a, l) => a + (Number(l.days) || 0), 0);

    // 주 단위: 주 40시간 초과 연장 + 주휴수당
    // 주휴수당은 실제 근무시간이 아니라 '주 소정근로시간'(스케줄) 기준. 지각은 개근을 깨지 않음, 결근만 깸
    const weeks = [];
    for (let wk = from; wk <= to; wk = addDays(wk, 7)) {
      let cum = 0, schedMin = 0, attendanceOK = true;
      for (let i = 0; i < 7; i++) {
        const k = addDays(wk, i), d = days[k];
        if (d && !d.holiday) {
          const reg = Math.min(d.work, DAY);
          d.weeklyOT = floorUnit(Math.max(0, cum + reg - WEEK) - Math.max(0, cum - WEEK), settings);
          cum += reg;
        }
        const lv = leaveDaysOn(k);
        if (isScheduledDay(emp, k, settings) && isEmployed(emp, k)) {
          schedMin += daily;
          if (!(d && d.work > 0) && lv <= 0) attendanceOK = false;
        }
      }
      const sunday = addDays(wk, 6);
      if (sunday < mStart || sunday > mEnd) continue; // 주휴는 그 주의 일요일이 속한 달에 지급
      const base = Math.min(WEEK, schedMin);
      const complete = sunday < todayK;
      const eligible = hourly && settings.weeklyHolidayPay !== false && complete && attendanceOK && base >= 900;
      weeks.push({
        start: wk, end: sunday, baseMin: base, attendanceOK, complete, eligible,
        min: eligible ? Math.round(Math.min(DAY, (base / WEEK) * DAY)) : 0,
      });
    }

    // 일별 행 + 집계
    const rows = [];
    const st = { workDays: 0, workMin: 0, night: 0, ot: 0, hol: 0, holOver8: 0, lateCount: 0, lateMin: 0,
      earlyCount: 0, earlyMin: 0, absent: 0, leaveDays: 0, leaveMin: 0, incomplete: 0 };
    for (let k = mStart; k <= mEnd; k = addDays(k, 1)) {
      const d = days[k] || null;
      const leaves = leaveBy[k] || [];
      const scheduled = isScheduledDay(emp, k, settings);
      const employed = isEmployed(emp, k);
      let status = '';
      if (d) {
        status = d.incomplete ? '퇴근 미기록' : d.holiday ? '휴일근무' : '근무';
        st.workDays++;
        st.workMin += d.work; st.night += d.night; st.ot += d.dailyOT + d.weeklyOT;
        st.hol += d.hol; st.holOver8 += d.holOver8;
        if (d.late) { st.lateCount++; st.lateMin += d.late; }
        if (d.early) { st.earlyCount++; st.earlyMin += d.early; }
        if (d.incomplete && k < todayK) st.incomplete++; // 오늘 근무중인 건은 미기록으로 세지 않음
      } else if (leaves.length) {
        status = leaves.map(l => l.type).join(', ');
      } else if (scheduled && employed && k < todayK) {
        status = '결근'; st.absent++;
      } else if (!scheduled) {
        status = isHolidayDate(settings, k) ? '공휴일' : '휴무';
      }
      const lv = leaves.reduce((a, l) => a + (Number(l.days) || 0), 0);
      st.leaveDays += lv; st.leaveMin += lv * daily;
      rows.push({ date: k, wd: weekday(k), day: d, leaves, scheduled, status });
    }

    const juhyuMin = weeks.reduce((a, w) => a + w.min, 0);
    const pay = { base: 0, overtime: 0, night: 0, holiday: 0, juhyu: 0, leave: 0, extra: 0, gross: 0, deduction: 0, net: 0 };
    if (hourly) {
      const pm = (Number(emp.hourlyWage) || 0) / 60;
      pay.base = Math.round(st.workMin * pm);
      pay.overtime = Math.round(st.ot * pm * (mul.overtime - 1));
      pay.night = Math.round(st.night * pm * mul.night);
      pay.holiday = Math.round(((st.hol - st.holOver8) * (mul.holiday - 1) + st.holOver8 * (mul.holidayOver8 - 1)) * pm);
      pay.juhyu = Math.round(juhyuMin * pm);
      pay.leave = Math.round(st.leaveMin * pm);
    } else {
      pay.base = Math.round(Number(emp.monthlySalary) || 0);
    }
    const adj = (state.adjustments || {})[`${emp.id}|${ym}`] || {};
    pay.extra = Math.round(Number(adj.extraPay) || 0);
    pay.gross = pay.base + pay.overtime + pay.night + pay.holiday + pay.juhyu + pay.leave + pay.extra;
    const ded = calcDeductions(emp, pay.gross, settings, adj.ins);
    pay.autoDeduction = ded.total;
    pay.manualDeduction = Math.round(Number(adj.deduction) || 0);
    pay.deduction = pay.autoDeduction + pay.manualDeduction;
    pay.net = pay.gross - pay.deduction;

    return { emp, ym, mStart, mEnd, rows, stats: st, weeks, juhyuMin, pay, ded, mul, adj, hourly };
  }

  /* ---------- 공제 (직원별: 없음 / 4대보험 예상액 / 3.3%) ----------
   * 4대보험 근로자 부담 요율 2026년 기준. 매년 [설정]에서 바꿀 수 있습니다.
   *  - 국민연금 9.5%의 절반 4.75% (기준소득월액 상·하한 적용, 2025.7~2026.6: 40만~637만원)
   *  - 건강보험 7.19%의 절반 3.595%
   *  - 장기요양 = 건강보험료 × 13.14% (0.9448% ÷ 7.19%)
   *  - 고용보험(실업급여) 0.9%
   * 실제 고지액은 신고한 보수월액·정산에 따라 다를 수 있으므로 "예상액"이며 달마다 고쳐 쓸 수 있습니다.
   */
  const DEFAULT_INS = Object.freeze({ pension: 4.75, health: 3.595, ltc: 13.14, employ: 0.9, pensionMin: 400000, pensionMax: 6370000 });
  const floor10 = n => Math.floor(Math.max(0, n) / 10) * 10;

  function insRates(settings) {
    const r = Object.assign({}, DEFAULT_INS, (settings && settings.insRates) || {});
    for (const k of Object.keys(DEFAULT_INS)) r[k] = Math.max(0, Number(r[k]) || 0);
    return r;
  }

  /** gross: 그 달 지급합계, override: { 항목key: 금액 } (그 달 실제 고지액으로 덮어쓰기) */
  function calcDeductions(emp, gross, settings, override) {
    const mode = emp.deductMode === 'insurance' || emp.deductMode === 'tax33' ? emp.deductMode : 'none';
    const items = [];
    let base = 0;
    if (mode === 'tax33') {
      base = Math.max(0, gross);
      const it = floor10(base * 0.03);
      items.push({ key: 'incomeTax', name: '사업소득세 (3%)', auto: it });
      items.push({ key: 'localTax', name: '지방소득세 (0.3%)', auto: floor10(it * 0.1) });
    } else if (mode === 'insurance') {
      const r = insRates(settings);
      const declared = Number(emp.insBase) || 0;
      base = declared > 0 ? declared : Math.max(0, gross - Math.max(0, Number(emp.taxFree) || 0));
      if (base > 0) {
        if (!emp.noPension) {
          const pb = Math.min(Math.max(base, r.pensionMin), r.pensionMax || Infinity);
          items.push({ key: 'pension', name: `국민연금 (${r.pension}%)`, auto: floor10(pb * r.pension / 100) });
        }
        const h = floor10(base * r.health / 100);
        items.push({ key: 'health', name: `건강보험 (${r.health}%)`, auto: h });
        items.push({ key: 'ltc', name: `장기요양 (건강보험료의 ${r.ltc}%)`, auto: floor10(h * r.ltc / 100) });
        if (!emp.noEmploy) items.push({ key: 'employ', name: `고용보험 (${r.employ}%)`, auto: floor10(base * r.employ / 100) });
      }
    }
    const ov = override || {};
    for (const it of items) {
      const v = ov[it.key];
      it.overridden = v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
      // 장기요양은 건강보험료에 비례 → 건강보험을 고지액으로 고치면 그 금액 기준으로 다시 계산
      if (it.key === 'ltc') {
        const h = items.find(x => x.key === 'health');
        if (h) it.auto = floor10(h.amount * insRates(settings).ltc / 100);
      }
      it.amount = it.overridden ? Math.max(0, Math.round(Number(v))) : it.auto;
    }
    return { mode, base, items, total: items.reduce((a, it) => a + it.amount, 0) };
  }

  /** 연차(월차) 법정 참고 일수 — 해당 연도 말 기준 */
  function legalLeaveHint(emp, year, settings) {
    if (settings && settings.under5) return { days: null, text: '5인 미만: 법정 의무 없음' };
    if (!emp.hireDate) return { days: null, text: '입사일 미입력' };
    const h = parseDate(emp.hireDate);
    const ref = new Date(year, 11, 31);
    let months = (ref.getFullYear() - h.getFullYear()) * 12 + (ref.getMonth() - h.getMonth());
    if (ref.getDate() < h.getDate()) months--;
    if (months < 0) return { days: 0, text: '입사 전' };
    if (months < 12) return { days: Math.min(11, months), text: `1년 미만: 개근 월마다 1일 (최대 ${Math.min(11, months)}일)` };
    const years = Math.floor(months / 12);
    const days = Math.min(25, 15 + Math.floor((years - 1) / 2));
    return { days, text: `근속 ${years}년: ${days}일` };
  }

  const api = {
    LEGAL_MUL, MIN_WAGE, minWage, pad, dateKey, toDT, parseDate, parseDT, addDays, weekday, hmToMin, diffMin,
    mondayOf, lastDayOfMonth, defaultSchedule, schedOf, effectiveMul, breakFor, scheduledDailyMin,
    isScheduledDay, isEmployed, nightMinutes, recordWork, floorUnit, analyzeDays, calcMonth, legalLeaveHint,
    DEFAULT_INS, insRates, calcDeductions,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Payroll = api;
})(typeof window !== 'undefined' ? window : globalThis);
