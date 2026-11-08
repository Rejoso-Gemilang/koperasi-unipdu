const test = require('node:test');
const assert = require('node:assert/strict');
const { savingsPlan, assertSavingsPlan } = require('./savingsProgression');
const { hashPlan } = require('./loanProgression');
const member = { id: 'member', uid: 'uid', membershipStatus: 'approved', paymentStatus: 'Payroll Deduction',
  payrollSavings: { startPeriod: '2026-11', initialPeriod: '2026-11', initialPaid: false } };
test('first credit is 275000 and existing settled registrations contribute 25000', () => {
  assert.equal(savingsPlan(member, '2026-11').total, 275000);
  assert.equal(savingsPlan({ ...member, nominalTabungan: 999999 }, '2026-11').total, 275000);
  const settled = { ...member, payrollSavings: { ...member.payrollSavings, initialPaid: true } };
  assert.equal(savingsPlan(settled, '2026-12').total, 25000);
  assert.throws(() => savingsPlan(member, '2026-12'), /Selesaikan iuran pokok/);
});
test('policy and eligibility changes invalidate the frozen savings plan', () => {
  const plan = savingsPlan(member, '2026-11');
  assert.equal(savingsPlan({ ...member, paymentStatus: 'Yayasan Subsidy' }, '2026-11').total, 0);
  assert.equal(savingsPlan(member, '2026-10').total, 0);
  assert.equal(savingsPlan({ id: 'legacy' }, '2026-11'), null);
  assert.throws(() => assertSavingsPlan(plan, savingsPlan({ ...member, iuranWajib: 50000 }, '2026-11')), /berubah/);
  const base = { schemaVersion: 2, payrollPeriod: '2026-11', loans: [], expectedDeduction: 0, savings: plan };
  assert.notEqual(hashPlan(base), hashPlan({ ...base, savings: { ...plan, initial: 0 } }));
});
