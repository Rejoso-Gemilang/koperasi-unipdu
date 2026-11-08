const admin = require('firebase-admin');

/** Re-read the policy in the same transaction as the increment. Migration wins
 * even when a monthly job obtained its candidate list before the cutover. */
async function incrementLegacySavings() {
  const db = admin.firestore();
  const candidates = await db.collection('users').where('role', '==', 'Member')
    .where('membershipStatus', '==', 'approved').where('paymentStatus', '==', 'Payroll Deduction').get();
  const now = admin.firestore.Timestamp.now();
  const logId = `${new Date().toISOString().slice(0, 10)}_tabunganBulanan_${now.seconds}_${now.nanoseconds}`;
  const entries = [];
  for (const candidate of candidates.docs) {
    const entry = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(candidate.ref);
      const user = snapshot.data();
      if (!user || user.payrollSavings || user.role !== 'Member' || user.membershipStatus !== 'approved' || user.paymentStatus !== 'Payroll Deduction') return null;
      const balance = Number(user.nominalTabungan || 0);
      const initial = balance === 0 ? Number(user.iuranPokok || 250000) : 0;
      const monthly = Number(user.iuranWajib || 25000);
      const amount = initial + monthly;
      const logRef = db.collection('tabunganLogsPerUser').doc();
      transaction.update(candidate.ref, { nominalTabungan: balance + amount, lastPaymentDate: now,
        lastPaymentAmount: amount, lastPaymentType: initial ? 'first_payment' : 'monthly_payment', updatedAt: now });
      transaction.create(logRef, { userId: candidate.id, userEmail: user.email || '', userName: user.nama || '',
        paymentDate: now, amount, paymentType: initial ? 'first_payment' : 'monthly_payment',
        previousBalance: balance, newBalance: balance + amount, iuranPokok: initial, iuranWajib: monthly,
        tabunganLogId: logId, createdAt: now });
      return { userId: candidate.id, nama: user.nama || '', nomorWhatsapp: user.nomorWhatsapp || '',
        nominalIncrement: amount, tipePembayaran: initial ? 'iuran pokok + iuran wajib' : 'iuran wajib',
        previousBalance: balance, newBalance: balance + amount, tabunganLogsPerUserId: logRef.id, timestamp: now };
    });
    if (entry) entries.push(entry);
  }
  if (entries.length) await db.collection('tabunganLogs').doc(logId).create({ type: 'tabunganBulanan',
    date: new Date().toISOString().slice(0, 10), timestamp: now, timestampEpoch: now.seconds,
    processedCount: entries.length, errorCount: 0, entries, createdAt: now });
  return { success: true, processedCount: entries.length, skippedCount: candidates.size - entries.length, logDocumentId: entries.length ? logId : null };
}
module.exports = { incrementLegacySavings };
