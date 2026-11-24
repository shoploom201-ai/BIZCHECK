// 실행: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const P = require('../js/payroll.js');
const X = require('../js/xlsx-lite.js');
const sha256 = require('../js/sha256.js');

const emp = (o = {}) => Object.assign({
  id: '1001', name: '홍길동', payType: 'hourly', hourlyWage: 10000,
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', breakMode: 'auto' },
}, o);
const rec = (date, inT, outT, outDate = date) => ({ id: date + inT, empId: '1001', date, in: `${date}T${inT}`, out: outT ? `${outDate}T${outT}` : null });
const state = (records, extra = {}) => Object.assign({ settings: { mul: { ...P.LEGAL_MUL }, lateGraceMin: 0 }, records, leaves: [], adjustments: {} }, extra);

test('sha256 matches node crypto', () => {
  for (const s of ['', 'abc', '비밀번호1234', 'x'.repeat(200)]) {
    assert.equal(sha256(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('break deduction (auto)', () => {
  assert.equal(P.breakFor(540, emp()), 60); // 09~18
  assert.equal(P.breakFor(300, emp()), 30);
  assert.equal(P.breakFor(200, emp()), 0);
  assert.equal(P.scheduledDailyMin(emp()), 480);
});

test('night minutes across midnight', () => {
  assert.equal(P.nightMinutes(P.parseDT('2026-11-02T20:00'), P.parseDT('2026-11-03T02:00')), 240);
  assert.equal(P.nightMinutes(P.parseDT('2026-11-02T05:00'), P.parseDT('2026-11-02T07:00')), 60);
});

test('late, early leave, daily overtime', () => {
  // 2026-11-02 월요일
  const d = P.analyzeDays([rec('2026-11-02', '09:10', '20:00')], emp(), { lateGraceMin: 5 }, '2026-11-02', '2026-11-02')['2026-11-02'];
  assert.equal(d.late, 10);
  assert.equal(d.work, 650 - 60);
  assert.equal(d.dailyOT, 590 - 480);
  const d2 = P.analyzeDays([rec('2026-11-02', '09:03', '17:00')], emp(), { lateGraceMin: 5 }, '2026-11-02', '2026-11-02')['2026-11-02'];
  assert.equal(d2.late, 0); // 유예시간 이내
  assert.equal(d2.early, 60);
});

test('full month hourly pay with juhyu', () => {
  // 2026년 11월: 1일(일). 평일 21일
  const records = [];
  for (let k = '2026-11-01'; k <= '2026-11-30'; k = P.addDays(k, 1)) {
    if (P.isScheduledDay(emp(), k, {})) records.push(rec(k, '09:00', '18:00'));
  }
  const r = P.calcMonth(state(records), emp(), '2026-11', '2026-12-15');
  assert.equal(r.stats.workDays, 21);
  assert.equal(r.stats.workMin, 21 * 480);
  assert.equal(r.stats.ot, 0);
  assert.equal(r.pay.base, 21 * 8 * 10000);
  // 일요일이 11월인 주: 11/1(10/26주), 11/8, 15, 22, 29 → 10/26주는 10월 기록 없음(결근) → 4주 지급
  assert.equal(r.weeks.length, 5);
  assert.equal(r.weeks.filter(w => w.eligible).length, 4);
  assert.equal(r.pay.juhyu, 4 * 8 * 10000);
  assert.equal(r.stats.lateCount, 0);
});

test('weekly 40h overtime and holiday work', () => {
  const records = [
    rec('2026-11-02', '09:00', '18:00'), rec('2026-11-03', '09:00', '18:00'), rec('2026-11-04', '09:00', '18:00'),
    rec('2026-11-05', '09:00', '18:00'), rec('2026-11-06', '09:00', '18:00'),
    rec('2026-11-07', '09:00', '20:00'), // 토요일(휴일) 11h 체류 → 10h 근무: 8h 1.5배 + 2h 2.0배
  ];
  const r = P.calcMonth(state(records), emp(), '2026-11', '2026-12-01');
  assert.equal(r.stats.hol, 600);
  assert.equal(r.stats.holOver8, 120);
  assert.equal(r.stats.ot, 0); // 휴일근로는 연장과 별도
  assert.equal(r.pay.holiday, Math.round((480 * 0.5 + 120 * 1.0) * 10000 / 60));
});

test('weekly OT when daily < 8h but week > 40h', () => {
  const e = emp({ schedule: { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00', breakMode: 'fixed', breakMin: 0 } });
  const records = ['02', '03', '04', '05', '06', '07'].map(d => rec(`2026-11-${d}`, '09:00', '17:00'));
  const r = P.calcMonth(state(records), e, '2026-11', '2026-12-01');
  assert.equal(r.stats.workMin, 6 * 480);
  assert.equal(r.stats.ot, 480); // 48h - 40h
});

test('under 5 employees: no premiums', () => {
  const r = P.calcMonth(state([rec('2026-11-02', '09:00', '23:00')], { settings: { under5: true, mul: P.LEGAL_MUL } }), emp(), '2026-11', '2026-12-01');
  assert.ok(r.stats.ot > 0 && r.stats.night > 0);
  assert.equal(r.pay.overtime, 0);
  assert.equal(r.pay.night, 0);
});

test('custom multipliers & monthly salary & adjustments', () => {
  const s = state([rec('2026-11-02', '09:00', '20:00')], { settings: { mul: { overtime: 2, night: 0.5, holiday: 1.5, holidayOver8: 2 } } });
  const r = P.calcMonth(s, emp(), '2026-11', '2026-11-03');
  assert.equal(r.pay.overtime, Math.round(120 * (10000 / 60) * 1));
  const m = P.calcMonth(Object.assign(s, { adjustments: { '1001|2026-11': { extraPay: 50000, deduction: 30000 } } }),
    emp({ payType: 'monthly', monthlySalary: 2500000 }), '2026-11', '2026-11-03');
  assert.equal(m.pay.base, 2500000);
  assert.equal(m.pay.overtime, 0);
  assert.equal(m.pay.gross, 2550000);
  assert.equal(m.pay.net, 2520000);
});

test('paid leave counts for pay and attendance', () => {
  const records = ['03', '04', '05', '06'].map(d => rec(`2026-11-${d}`, '09:00', '18:00'));
  const s = state(records, { leaves: [{ empId: '1001', date: '2026-11-02', type: '연차', days: 1 }] });
  const r = P.calcMonth(s, emp(), '2026-11', '2026-11-10');
  assert.equal(r.pay.leave, 80000);
  const wk = r.weeks.find(w => w.start === '2026-11-02');
  assert.ok(wk.attendanceOK && wk.eligible);
});

test('early arrival clipped and OT unit flooring', () => {
  const s = { lateGraceMin: 0, otUnitMin: 10 };
  const d = P.analyzeDays([rec('2026-11-02', '08:50', '18:07')], emp(), s, '2026-11-02', '2026-11-02')['2026-11-02'];
  assert.equal(d.work, 487);    // 09:00~18:07 - 60
  assert.equal(d.dailyOT, 0);   // 7분 → 10분 단위 내림
  const d2 = P.analyzeDays([rec('2026-11-02', '08:50', '18:25')], emp(), s, '2026-11-02', '2026-11-02')['2026-11-02'];
  assert.equal(d2.dailyOT, 20);
  const d3 = P.analyzeDays([rec('2026-11-02', '08:50', '18:00')], emp(), { clipEarly: false }, '2026-11-02', '2026-11-02')['2026-11-02'];
  assert.equal(d3.work, 490);
  // 휴일(토)은 조기출근 보정 없음
  const d4 = P.analyzeDays([rec('2026-11-07', '07:00', '12:00')], emp(), s, '2026-11-07', '2026-11-07')['2026-11-07'];
  assert.equal(d4.work, 300 - 30);
});

test('regression: late arrival must not create overtime', () => {
  // 09:17 출근 ~ 18:02 퇴근: 지각했는데 휴게가 덜 빠져 연장이 생기면 안 됨
  const d = P.analyzeDays([rec('2026-11-04', '09:17', '18:02')], emp(), { otUnitMin: 10 }, '2026-11-04', '2026-11-04')['2026-11-04'];
  assert.equal(d.brk, 60);
  assert.equal(d.dailyOT, 0);
  assert.equal(d.late, 17);
});

test('regression: juhyu uses scheduled hours, lateness keeps full attendance', () => {
  const records = ['02', '03', '04', '05', '06'].map(d => rec(`2026-11-${d}`, d === '04' ? '09:40' : '09:00', '18:00'));
  const r = P.calcMonth(state(records), emp(), '2026-11', '2026-11-10');
  const wk = r.weeks.find(w => w.start === '2026-11-02');
  assert.ok(wk.eligible);
  assert.equal(wk.min, 480);
});

test('xlsx builds a valid zip', () => {
  const bytes = X.build([{ name: '시트:1', cols: [10, 10], rows: [[{ v: '제목', s: 'title' }], [1, { v: 2, s: 'red' }, 'a&b<c>']], merges: ['A1:B1'] }]);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
  assert.equal(X.colName(0), 'A'); assert.equal(X.colName(26), 'AA'); assert.equal(X.colName(27), 'AB');
});

test('deductions: 3.3% (10원 미만 절사)', () => {
  const d = P.calcDeductions(emp({ deductMode: 'tax33' }), 1000000, {});
  assert.deepEqual(d.items.map(i => i.amount), [30000, 3000]);
  assert.equal(d.total, 33000);
  const d2 = P.calcDeductions(emp({ deductMode: 'tax33' }), 1234567, {});
  assert.deepEqual(d2.items.map(i => i.amount), [37030, 3700]);
});

test('deductions: 4대보험 예상액 (비과세 제외, 상한, 제외 옵션, 덮어쓰기)', () => {
  const e = emp({ deductMode: 'insurance', taxFree: 200000 });
  const d = P.calcDeductions(e, 2156880, {});
  assert.equal(d.base, 1956880);
  assert.deepEqual(d.items.map(i => [i.key, i.amount]), [['pension', 92950], ['health', 70340], ['ltc', 9240], ['employ', 17610]]);
  assert.equal(d.total, 190140);
  // 국민연금 상한 (기준소득월액 637만원)
  const hi = P.calcDeductions(emp({ deductMode: 'insurance' }), 8000000, {});
  assert.equal(hi.items.find(i => i.key === 'pension').amount, 302570);
  // 60세 이상 등 국민연금 제외 / 고용보험 제외
  const ex = P.calcDeductions(emp({ deductMode: 'insurance', noPension: true, noEmploy: true }), 2000000, {});
  assert.deepEqual(ex.items.map(i => i.key), ['health', 'ltc']);
  // 신고 보수월액이 있으면 그 금액 기준
  const dec = P.calcDeductions(emp({ deductMode: 'insurance', insBase: 2000000 }), 3500000, {});
  assert.equal(dec.base, 2000000);
  // 실제 고지액으로 덮어쓰기
  const ov = P.calcDeductions(e, 2156880, {}, { health: 70000, pension: '' });
  assert.equal(ov.items.find(i => i.key === 'health').amount, 70000);
  assert.equal(ov.items.find(i => i.key === 'pension').amount, 92950);
  assert.equal(ov.items.find(i => i.key === 'ltc').amount, 9190); // 70000 × 13.14% → 10원 미만 절사
  assert.equal(ov.total, 92950 + 70000 + 9190 + 17610);
  // 요율 변경
  const r = P.calcDeductions(emp({ deductMode: 'insurance' }), 1000000, { insRates: { employ: 1 } });
  assert.equal(r.items.find(i => i.key === 'employ').amount, 10000);
  // 급여 0원이면 공제 없음, 공제 안 함(기본)
  assert.equal(P.calcDeductions(emp({ deductMode: 'insurance' }), 0, {}).total, 0);
  assert.equal(P.calcDeductions(emp(), 2000000, {}).total, 0);
});

test('calcMonth: 자동 공제 + 직접 입력 공제(소득세 등) 합산', () => {
  const e = emp({ payType: 'monthly', monthlySalary: 2000000, deductMode: 'tax33' });
  const s = state([], { adjustments: { '1001|2026-11': { deduction: 15000 } } });
  const r = P.calcMonth(s, e, '2026-11', '2026-11-30');
  assert.equal(r.pay.gross, 2000000);
  assert.equal(r.pay.autoDeduction, 66000);
  assert.equal(r.pay.manualDeduction, 15000);
  assert.equal(r.pay.deduction, 81000);
  assert.equal(r.pay.net, 1919000);
});
