const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const { bridgeSignature } = require("./loanProgression");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Run this test through the Firebase Firestore emulator.");
}

const projectId = process.env.GCLOUD_PROJECT || "demo-koperasi";
const secret = process.env.INTERNAL_PAYROLL_HMAC_SECRET;
if (!secret) throw new Error("INTERNAL_PAYROLL_HMAC_SECRET is required.");

admin.initializeApp({ projectId });
const db = admin.firestore();
const functionBase = `http://127.0.0.1:5001/${projectId}/us-central1`;

function activeLoan({ id, userId, name, principal, tenor, paid, balance }) {
  const activatedAt = admin.firestore.Timestamp.fromDate(new Date("2026-01-01T00:00:00.000Z"));
  return {
    id,
    userId,
    status: "Disetujui dan Aktif",
    jumlahPinjaman: principal,
    tenor,
    jumlahMenyicil: paid,
    sisaHutang: balance,
    tanggalDisetujui: activatedAt,
    userData: { namaLengkap: name },
    history: [{ status: "Disetujui dan Aktif", timestamp: activatedAt }],
  };
}

async function bridge(payload) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(`${functionBase}/payrollLoanBridge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-payroll-timestamp": timestamp,
      "x-payroll-signature": bridgeSignature(secret, timestamp, body),
    },
    body,
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

function requestPayload({ action, operationId, employee, expectedDeduction, plan }) {
  return {
    schemaVersion: 1,
    action,
    payrollPeriod: "2026-07",
    operationId,
    slipId: operationId.replace(/^payroll_/, ""),
    employee,
    expectedDeduction,
    ...(plan ? { plan } : {}),
    actor: { uid: "finance-1", name: "Finance" },
  };
}

async function createManualActor() {
  const response = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `finance-${Date.now()}@example.test`,
        password: "integration-test-password",
        returnSecureToken: true,
      }),
    },
  );
  const identity = await response.json();
  assert.equal(response.status, 200, JSON.stringify(identity));
  await db.collection("users").doc(identity.localId).set({
    uid: identity.localId,
    nama: "Koperasi Finance",
    role: "BAK",
  });
  return identity;
}

async function callManualInstallment({ identity, loanId }) {
  const response = await fetch(`${functionBase}/recordManualLoanInstallment`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${identity.idToken}`,
    },
    body: JSON.stringify({ data: { loanId, payrollPeriod: "2026-07", isProduction: true } }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

async function main() {
  const loanA = activeLoan({
    id: "loan-final",
    userId: "borrower-one",
    name: "Integration Employee",
    principal: 3_900_000,
    tenor: 12,
    paid: 11,
    balance: 325_000,
  });
  const loanB = activeLoan({
    id: "loan-active",
    userId: "borrower-one",
    name: "Integration Employee",
    principal: 1_200_000,
    tenor: 12,
    paid: 2,
    balance: 1_000_000,
  });
  await Promise.all([
    db.collection("simpanPinjam").doc(loanA.id).set(loanA),
    db.collection("simpanPinjam").doc(loanB.id).set(loanB),
  ]);

  const employee = {
    id: "employee-one",
    name: "Integration Employee",
    koperasiAuthUid: "borrower-one",
  };
  const base = { operationId: "payroll_2026_07_employee_one", employee, expectedDeduction: 425_000 };
  const plan = await bridge(requestPayload({ action: "preview", ...base }));
  const applyPayload = requestPayload({ action: "apply", ...base, plan });
  const concurrent = await Promise.all([bridge(applyPayload), bridge(applyPayload)]);
  const outcomes = concurrent.flatMap((receipt) => receipt.loans.map((loan) => loan.outcome));
  assert(outcomes.includes("paid_off"));
  assert(outcomes.includes("advanced"));
  assert.equal(outcomes.filter((outcome) => outcome === "already_applied").length, 2);

  const [finalSnapshot, activeSnapshot] = await Promise.all([
    db.collection("simpanPinjam").doc(loanA.id).get(),
    db.collection("simpanPinjam").doc(loanB.id).get(),
  ]);
  assert.equal(finalSnapshot.data().jumlahMenyicil, 12);
  assert.equal(finalSnapshot.data().sisaHutang, 0);
  assert.equal(finalSnapshot.data().status, "Lunas");
  assert.equal(activeSnapshot.data().jumlahMenyicil, 3);

  const manualLoan = activeLoan({
    id: "loan-manual-race",
    userId: "borrower-two",
    name: "Manual Race Employee",
    principal: 1_200_000,
    tenor: 12,
    paid: 2,
    balance: 1_000_000,
  });
  await db.collection("simpanPinjam").doc(manualLoan.id).set(manualLoan);
  const manualEmployee = {
    id: "employee-two",
    name: "Manual Race Employee",
    koperasiAuthUid: "borrower-two",
  };
  const manualBase = {
    operationId: "payroll_2026_07_employee_two",
    employee: manualEmployee,
    expectedDeduction: 100_000,
  };
  const manualPlan = await bridge(requestPayload({ action: "preview", ...manualBase }));
  const identity = await createManualActor();
  await Promise.all([
    bridge(requestPayload({ action: "apply", ...manualBase, plan: manualPlan })),
    callManualInstallment({ identity, loanId: manualLoan.id }),
  ]);

  const racedSnapshot = await db.collection("simpanPinjam").doc(manualLoan.id).get();
  const racedData = racedSnapshot.data();
  assert.equal(racedData.jumlahMenyicil, 3);
  assert.equal(
    racedData.history.filter(
      (entry) => entry.status === "Pembayaran Cicilan" && entry.payrollPeriod === "2026-07",
    ).length,
    1,
  );
  assert.equal(
    (await db.collection("payrollInstallmentProgressions").doc("2026-07__loan-manual-race").get()).exists,
    true,
  );

  const savingsMember = db.doc('users/savings-member');
  await savingsMember.set({ uid: 'savings-uid', nama: 'Savings Employee', email: 'savings@example.test',
    role: 'Member', membershipStatus: 'approved', paymentStatus: 'Payroll Deduction', nominalTabungan: 0,
    iuranPokok: 250000, iuranWajib: 25000,
    payrollSavings: { startPeriod: '2026-11', initialPeriod: '2026-11', initialPaid: false } });
  const combinedLoan = activeLoan({ id: 'savings-loan', userId: 'savings-uid', name: 'Savings Employee', principal: 600000, tenor: 6, paid: 0, balance: 600000 });
  await db.doc('simpanPinjam/savings-loan').set(combinedLoan);
  const savingsBase = { schemaVersion: 2, payrollPeriod: '2026-11', operationId: 'payroll_savings_employee',
    slipId: '2026_11_savings_employee', expectedDeduction: 100000,
    employee: { id: 'savings-employee', name: 'Savings Employee', koperasiAuthUid: 'savings-uid', koperasiUserId: 'savings-member' },
    actor: { uid: 'finance-1', name: 'Finance', role: 'finance_verifier' } };
  const savingsPlan = await bridge({ ...savingsBase, action: 'preview' });
  assert.equal(savingsPlan.savings.initial, 250000);
  assert.equal(savingsPlan.savings.monthly, 25000);
  await bridge({ ...savingsBase, action: 'validate', plan: savingsPlan });
  assert.equal((await savingsMember.get()).data().nominalTabungan, 0, 'validation never credits savings');
  assert.equal((await db.doc('simpanPinjam/savings-loan').get()).data().jumlahMenyicil, 0, 'validation never progresses loans');
  // A non-payroll balance change does not invalidate or overwrite the contribution.
  await savingsMember.update({ nominalTabungan: 100000 });
  const concurrentSavings = await Promise.all([
    bridge({ ...savingsBase, action: 'apply', plan: savingsPlan }),
    bridge({ ...savingsBase, action: 'apply', plan: savingsPlan }),
  ]);
  assert.equal(concurrentSavings.filter(receipt => receipt.savings.outcome === 'credited').length, 1);
  assert.equal(concurrentSavings.filter(receipt => receipt.savings.outcome === 'already_applied').length, 1);
  assert.equal((await savingsMember.get()).data().nominalTabungan, 375000);
  assert.equal((await db.doc('simpanPinjam/savings-loan').get()).data().jumlahMenyicil, 1, 'combined loan progresses once');
  assert.equal((await savingsMember.get()).data().payrollSavings.initialPaid, true);
  assert.equal((await db.collection('tabunganLogsPerUser').where('userId', '==', 'savings-member').get()).size, 1);
  assert.equal((await bridge({ ...savingsBase, action: 'preview' })).savings.initial, 250000, 'lost completion response retains frozen first contribution');
  const decemberBase = { ...savingsBase, payrollPeriod: '2026-12', operationId: 'payroll_dec_savings_employee', slipId: '2026_12_savings_employee' };
  const decemberPlan = await bridge({ ...decemberBase, action: 'preview' });
  assert.equal(decemberPlan.savings.initial, 0);
  assert.equal(decemberPlan.savings.monthly, 25000);
  await bridge({ ...decemberBase, action: 'apply', plan: decemberPlan });
  assert.equal((await savingsMember.get()).data().nominalTabungan, 400000);
  const subsidy = db.doc('users/subsidy-member');
  await subsidy.set({ uid: 'subsidy-uid', nama: 'Subsidy', membershipStatus: 'approved', paymentStatus: 'Yayasan Subsidy',
    nominalTabungan: 0, payrollSavings: { startPeriod: '2026-11', initialPeriod: '2026-11', initialPaid: false } });
  const subsidyBase = { ...savingsBase, expectedDeduction: 0, operationId: 'payroll_subsidy_employee', slipId: '2026_11_subsidy_employee',
    employee: { id: 'subsidy', name: 'Subsidy', koperasiAuthUid: 'subsidy-uid', koperasiUserId: 'subsidy-member' } };
  const subsidyPlan = await bridge({ ...subsidyBase, action: 'preview' });
  assert.equal(subsidyPlan.savings.total, 0);
  await bridge({ ...subsidyBase, action: 'apply', plan: subsidyPlan });
  assert.equal((await subsidy.get()).data().nominalTabungan, 0);

  const pendingMember = db.doc('users/stale-member');
  await pendingMember.set({ uid: 'stale-uid', nama: 'Stale', role: 'Member', membershipStatus: 'approved', paymentStatus: 'Payroll Deduction', nominalTabungan: 0,
    payrollSavings: { startPeriod: '2026-11', initialPeriod: '2026-11', initialPaid: false } });
  await db.doc('simpanPinjam/stale-savings-loan').set(activeLoan({ id: 'stale-savings-loan', userId: 'stale-uid', name: 'Stale', principal: 1200000, tenor: 12, paid: 0, balance: 1200000 }));
  const staleBase = { ...savingsBase, operationId: 'payroll_stale_employee', slipId: '2026_11_stale_employee',
    employee: { id: 'stale', name: 'Stale', koperasiAuthUid: 'stale-uid', koperasiUserId: 'stale-member' } };
  const stalePlan = await bridge({ ...staleBase, action: 'preview' });
  await pendingMember.update({ iuranWajib: 50000 });
  async function rejectsBridge(payload, expectedCode) {
    const body = JSON.stringify(payload), timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(`${functionBase}/payrollLoanBridge`, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-payroll-timestamp': timestamp, 'x-payroll-signature': bridgeSignature(secret, timestamp, body) }, body });
    const result = await response.json();
    assert.equal(response.status, 409, JSON.stringify(result)); assert.equal(result.error.code, expectedCode);
  }
  await rejectsBridge({ ...staleBase, action: 'apply', plan: stalePlan }, 'SAVINGS_PLAN_STALE');
  assert.equal((await db.doc('simpanPinjam/stale-savings-loan').get()).data().jumlahMenyicil, 0, 'invalid savings policy cannot partially progress a loan');
  await rejectsBridge({ ...savingsBase, action: 'apply', slipId: 'another_slip', plan: savingsPlan }, 'SAVINGS_MARKER_CONFLICT');
  await rejectsBridge({ ...savingsBase, schemaVersion: 1, action: 'preview' }, 'SAVINGS_V2_REQUIRED');
  const { incrementLegacySavings } = require('./legacySavings');
  await db.doc('users/legacy-member').set({ uid: 'legacy', role: 'Member', membershipStatus: 'approved', paymentStatus: 'Payroll Deduction', nominalTabungan: 300000 });
  await incrementLegacySavings();
  assert.equal((await db.doc('users/legacy-member').get()).data().nominalTabungan, 325000);
  assert.equal((await savingsMember.get()).data().nominalTabungan, 400000, 'legacy increment skips payroll-managed members');
  assert.equal((await pendingMember.get()).data().nominalTabungan, 0);
  const numberRequest = () => fetch(`${functionBase}/allocateMemberNumber`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${identity.idToken}` }, body: JSON.stringify({ data: {} }) });
  const numbers = await Promise.all([numberRequest(), numberRequest()]);
  for (const response of numbers) assert.equal(response.status, 200);
  const allocated = await Promise.all(numbers.map(response => response.json()));
  assert.notEqual(allocated[0].result.nomorAnggota, allocated[1].result.nomorAnggota, 'shared allocator serializes concurrent requests');
  const rollback = await fetch(`http://127.0.0.1:5001/${projectId}/asia-southeast1/rollbackTabunganLog`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ logDocumentId: 'payroll_2026-11__savings-member' }) });
  assert.equal(rollback.status, 409);
  assert.equal((await savingsMember.get()).data().nominalTabungan, 400000);

  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/testKoperasiSavingsSagaEmulator.ts'], {
    cwd: path.resolve(__dirname, '../../Internal-BAK'), stdio: 'inherit',
    env: { ...process.env, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-saku-savings',
      KOPERASI_PAYROLL_BRIDGE_URL: `${functionBase}/payrollLoanBridge`, KOPERASI_PAYROLL_HMAC_SECRET: secret },
  });
  process.stdout.write("Payroll loan and savings emulator integration passed: atomic credit, retries, concurrency, balance drift, first fee, recurring fee, subsidy, stale plans, duplicate slips and legacy exclusion.\n");
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
