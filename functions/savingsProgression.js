const { LoanProgressionError } = require('./loanProgression');

function contributionAmount(value, fallback) {
  const amount = Number(value) || fallback;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 10_000_000) {
    throw new LoanProgressionError('INVALID_SAVINGS_AMOUNT', 'Iuran Koperasi tidak valid.');
  }
  return amount;
}

function savingsPlan(member, period) {
  if (!member?.payrollSavings) return null;
  const policy = member.payrollSavings;
  if (!/^\d{4}-\d{2}$/.test(policy.startPeriod || '') ||
      !/^\d{4}-\d{2}$/.test(policy.initialPeriod || '') || typeof policy.initialPaid !== 'boolean') {
    throw new LoanProgressionError('INVALID_SAVINGS_POLICY', 'Pengaturan iuran payroll belum lengkap.');
  }
  const approved = (member.membershipStatus ?? member.status) === 'approved';
  const eligible = approved && member.paymentStatus === 'Payroll Deduction' && period >= policy.startPeriod;
  if (eligible && !policy.initialPaid && period > policy.initialPeriod) {
    throw new LoanProgressionError('INITIAL_CONTRIBUTION_PENDING', 'Selesaikan iuran pokok pada payroll pertama sebelum memproses bulan berikutnya.');
  }
  const initial = eligible && !policy.initialPaid && period === policy.initialPeriod
    ? contributionAmount(member.iuranPokok, 250_000) : 0;
  const monthly = eligible ? contributionAmount(member.iuranWajib, 25_000) : 0;
  return {
    memberId: member.id, uid: member.uid || member.id,
    membershipStatus: member.membershipStatus ?? member.status ?? null,
    paymentStatus: member.paymentStatus ?? null,
    startPeriod: policy.startPeriod, initialPeriod: policy.initialPeriod, initialPaid: policy.initialPaid,
    iuranPokok: contributionAmount(member.iuranPokok, 250_000),
    iuranWajib: contributionAmount(member.iuranWajib, 25_000), initial, monthly, total: initial + monthly,
  };
}

function assertSavingsPlan(submitted, current) {
  if (JSON.stringify(submitted ?? null) !== JSON.stringify(current ?? null)) {
    throw new LoanProgressionError('SAVINGS_PLAN_STALE', 'Keanggotaan atau iuran Koperasi berubah. Refresh dan simpan ulang draf payroll.');
  }
}

module.exports = { savingsPlan, assertSavingsPlan };
