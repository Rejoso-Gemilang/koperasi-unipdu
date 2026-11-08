const crypto = require("node:crypto");

const ACTIVE_STATUS = "Disetujui dan Aktif";
const PAYMENT_STATUS = "Pembayaran Cicilan";
const PAID_STATUS = "Lunas";
const PENDING_RESTRUCTURING_STATUS = "Menunggu Persetujuan Restrukturisasi";
const MANUAL_ROLES = new Set(["BAK", "Director", "Direktur", "Wakil Rektor 2"]);

const TITLE_PATTERN = /^(KH\.?|Hj\.?|HJ\.?|H\.?|Ust\.?|Ustadz|Ustadzah|Gus|Nyai|Ning|Lora|Prof\.?|Dr\.?|DR\.?|Drs\.?|DRS\.?|Dra\.?|DRA\.?|Ir\.?|IR\.?)$/i;
const DEGREE_PATTERN = /^(S\.|M\.|A\.|SST|SE|SS|SH|ST|MA|MM|MBA|MSi|PhD|Ph\.D\.?|Ners\.?|Apt\.?|Lc\.?|LC\.?|Ns\.?|Dr\.?|DR\.?|M\.?Pd\.?I?|M\.?Tr\.?|Keb\.?|Kes\.?)$/i;

const MANUAL_OVERRIDES = {
  "Siti Rofiah": "Siti Rofi'ah, A. Md.",
  "Ririn Susilawati": "Ririn Susilowati, S.H.I, M.E.I",
  "Irva Arina Alawiyyah": "Irva Arina Alawiyah, SE",
  Sunan: "ALFIS SUNAN",
  "Aifi Rokhim": "AIFI ROHIM",
  "Binti Qaniah": "Binti Qoni'ah, SS, M. Hum",
  "Dina Eka Shofiana": "Dina Eka Sofiana, SE, M.A",
  "Dina Eka Shofiana ": "Dina Eka Sofiana, SE, M.A",
  "M Qomaruzzaman": "M. Qomaruzzaman, S. Sos",
  "Helmi Annuchasari": "Helmi Anuchasari, S.KM., M.KM",
  "Afsah Novita Sari": "Afsah Novitasari, S.Si, M.Pd,",
  "Anggria Maduratih": "Anggrea Maduratih, S.AB",
  "M Abdul Rokhim": "Mokhamad Abdul Rokhim",
  "Khoirul Anwar": "KHOIRUL A",
  "M Ali Nawawi": "M.Ali Nawawi, SE., MM",
  "M Fatoni": "FATHONI",
  "Maisarah ": "Maisaroh, M.Si",
  Maisarah: "Maisaroh, M.Si",
  "Muhamad Zaki ": "Muhammad Zaky, SE.M.Pd",
  "Muhamad Zaki": "Muhammad Zaky, SE.M.Pd",
  "Muhammad Fuady": "MUHAMAD FUADY",
  "Muhammad Miftakhul Syaikhuddin": "Muhammad Miftakhul Syakhuddin",
  "Muhammad Zulfikar Asumta ": "DR.dr.H.M. Zulfikar As'ad, MMR",
  "Muhammad Zulfikar Asumta": "DR.dr.H.M. Zulfikar As'ad, MMR",
  "Mukhamad Masrur": "M. Masrur, S. Kom.M. Kom.",
  "Nurul Lailiyah.s.ab.m.si": "Nurul Lailiyah",
  Sholihuddin: "Sholahuddin, S.Pdi",
  "Siti Asiah M. Pd": "Siti Asiah, M.Pd.",
  Suspahariati: "Hj. Suspa Hariati, S. Sos.",
  "Ahmad Mundzir": "Achmad Mundzir, S.HI",
  "Ahmad Zahro": "Prof. DR.H. Ahmad Zahro, MA.",
  "Dian Puspita Yani ": "Dian Puspitayani, SST.M.Kes.",
  "Dian Puspita Yani": "Dian Puspitayani, SST.M.Kes.",
  "Sabrina Dwi Prihartini": "Hj.Sabrina Dwi Prihatini, SKM., M.Kes",
  "Mujianto Solichin": "Dr. Mujianto Sholichin, M. PdI.",
  "Siti Roudhotul Jannah ": "Siti Roudhatul Jannah, SST.Keb. M. Tr. Keb.",
  "Siti Roudhotul Jannah": "Siti Roudhatul Jannah, SST.Keb. M. Tr. Keb.",
};

class LoanProgressionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "LoanProgressionError";
    this.code = code;
    this.details = details || null;
  }
}

function bridgeSignature(secret, timestamp, body) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

function isBridgeSignatureValid({ secret, timestamp, body, signature, nowSeconds, maxAgeSeconds = 300 }) {
  const numericTimestamp = Number(timestamp);
  if (
    !Number.isInteger(numericTimestamp) ||
    Math.abs(nowSeconds - numericTimestamp) > maxAgeSeconds ||
    !/^[a-f0-9]{64}$/i.test(signature || "")
  ) {
    return false;
  }
  const expected = bridgeSignature(secret, timestamp, body);
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

function isManualRoleAllowed(role) {
  return MANUAL_ROLES.has(role);
}

function normalizeName(fullName) {
  let name = String(fullName || "").trim();
  const commaIndex = name.indexOf(",");
  if (commaIndex > 0) name = name.substring(0, commaIndex).trim();

  const tokens = name.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && TITLE_PATTERN.test(tokens[0])) tokens.shift();
  while (tokens.length > 1 && DEGREE_PATTERN.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ").replace(/[.,]+$/g, "").toLowerCase().trim();
}

function timestampMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return typeof value.seconds === "number" ? value.seconds * 1000 : 0;
}

function latestHistoryEntry(loan) {
  const history = Array.isArray(loan.history) ? loan.history : [];
  return [...history].sort(
    (left, right) => timestampMillis(right.timestamp) - timestampMillis(left.timestamp),
  )[0];
}

function resolveLoanStatus(loan) {
  const latestStatus = latestHistoryEntry(loan)?.status;
  if (latestStatus === PAYMENT_STATUS) {
    if (loan.status === PAID_STATUS) return PAID_STATUS;
    if (loan.status === PENDING_RESTRUCTURING_STATUS) {
      return PENDING_RESTRUCTURING_STATUS;
    }
    return ACTIVE_STATUS;
  }
  return latestStatus || loan.status || "";
}

function isPayrollPayableStatus(status) {
  return status === ACTIVE_STATUS || status === PENDING_RESTRUCTURING_STATUS;
}

function monthlyInstallment(loan) {
  const principal = Number(loan.jumlahPinjaman) || 0;
  const tenor = Math.floor(Number(loan.tenor) || 0);
  return tenor > 0 ? Math.round(principal / tenor) : 0;
}

function activationPeriod(loan) {
  let millis = timestampMillis(loan.tanggalDisetujui);
  if (!millis) {
    const activeEntries = (Array.isArray(loan.history) ? loan.history : [])
      .filter((entry) => entry.status === ACTIVE_STATUS)
      .map((entry) => timestampMillis(entry.timestamp))
      .filter((value) => value > 0);
    if (activeEntries.length > 0) millis = Math.min(...activeEntries);
  }
  if (!millis) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(millis));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}`;
}

function isPayrollEligibleLoan(loan, payrollPeriod) {
  if (!isPayrollPayableStatus(resolveLoanStatus(loan))) return false;
  const tenor = Math.floor(Number(loan.tenor) || 0);
  const paid = Math.max(0, Math.floor(Number(loan.jumlahMenyicil) || 0));
  const balance = Math.max(0, Math.round(Number(loan.sisaHutang) || 0));
  if (tenor <= 0 || paid >= tenor || balance <= 0 || monthlyInstallment(loan) <= 0) {
    return false;
  }
  const activated = activationPeriod(loan);
  return !activated || activated <= payrollPeriod;
}

function matchesEmployeeName(loanName, employeeName) {
  if (!loanName || !employeeName) return false;
  if (normalizeName(loanName) === normalizeName(employeeName)) return true;
  const override = MANUAL_OVERRIDES[String(loanName).trim()];
  return Boolean(override) && normalizeName(override) === normalizeName(employeeName);
}

function buildPlanItem(loan) {
  const tenor = Math.max(0, Math.floor(Number(loan.tenor) || 0));
  const paidBefore = Math.max(0, Math.floor(Number(loan.jumlahMenyicil) || 0));
  const installmentAmount = monthlyInstallment(loan);
  const paidAfter = Math.min(tenor, paidBefore + 1);
  const balanceBefore = Math.max(0, Math.round(Number(loan.sisaHutang) || 0));
  const willPayOff = paidAfter >= tenor;
  const balanceAfter = willPayOff
    ? 0
    : Math.max(0, Math.round((Number(loan.jumlahPinjaman) || 0) - paidAfter * installmentAmount));
  return {
    loanId: loan.id,
    borrowerUserId: typeof loan.userId === "string" ? loan.userId : null,
    installmentAmount,
    paidBefore,
    paidAfter,
    tenor,
    balanceBefore,
    balanceAfter,
    willPayOff,
  };
}

function hashPlan(plan) {
  const payload = {
    schemaVersion: plan.schemaVersion,
    payrollPeriod: plan.payrollPeriod,
    matchType: plan.matchType,
    resolvedUserId: plan.resolvedUserId,
    expectedDeduction: plan.expectedDeduction,
    loans: plan.loans,
    ...(plan.schemaVersion === 2 ? { savings: plan.savings ?? null } : {}),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function resolveMatchedEligibleLoans({ loans, employee, payrollPeriod }) {
  if (!/^\d{4}-\d{2}$/.test(payrollPeriod || "")) {
    throw new LoanProgressionError("INVALID_PERIOD", "Periode payroll tidak valid.");
  }
  const eligible = loans.filter((loan) => loan.id && isPayrollEligibleLoan(loan, payrollPeriod));
  const authUid = typeof employee.koperasiAuthUid === "string"
    ? employee.koperasiAuthUid.trim()
    : "";
  let selected = authUid
    ? eligible.filter((loan) => loan.userId === authUid)
    : [];
  let matchType = selected.length > 0 ? "uid" : "none";
  let resolvedUserId = selected.length > 0 ? authUid : null;

  if (selected.length === 0) {
    const fallback = eligible.filter((loan) =>
      matchesEmployeeName(loan.userData?.namaLengkap, employee.name),
    );
    const borrowerGroups = new Map();
    for (const loan of fallback) {
      const borrowerKey = loan.userId || `missing-user:${loan.id}`;
      if (!borrowerGroups.has(borrowerKey)) borrowerGroups.set(borrowerKey, []);
      borrowerGroups.get(borrowerKey).push(loan);
    }
    if (borrowerGroups.size > 1) {
      throw new LoanProgressionError(
        "AMBIGUOUS_BORROWER",
        "Nama pegawai cocok dengan lebih dari satu akun peminjam Koperasi.",
        { borrowerUserIds: [...borrowerGroups.keys()] },
      );
    }
    if (borrowerGroups.size === 1) {
      const [borrowerKey, borrowerLoans] = [...borrowerGroups.entries()][0];
      selected = borrowerLoans;
      matchType = "name";
      resolvedUserId = borrowerKey.startsWith("missing-user:") ? null : borrowerKey;
    }
  }

  return { loans: selected, matchType, resolvedUserId };
}

function resolveInstallmentPlan({ loans, employee, payrollPeriod, expectedDeduction }) {
  if (!Number.isSafeInteger(expectedDeduction) || expectedDeduction < 0) {
    throw new LoanProgressionError("INVALID_DEDUCTION", "Potongan koperasi tidak valid.");
  }
  const matched = resolveMatchedEligibleLoans({ loans, employee, payrollPeriod });
  const plan = {
    schemaVersion: 1,
    payrollPeriod,
    matchType: matched.matchType,
    resolvedUserId: matched.resolvedUserId,
    expectedDeduction,
    loans: matched.loans.map(buildPlanItem).sort((a, b) => a.loanId.localeCompare(b.loanId)),
  };
  const actualDeduction = plan.loans.reduce(
    (total, loan) => total + loan.installmentAmount,
    0,
  );
  if (actualDeduction !== expectedDeduction) {
    throw new LoanProgressionError(
      "DEDUCTION_MISMATCH",
      `Potongan Pinjaman Kop. UNIPDU Rp${expectedDeduction.toLocaleString("id-ID")} tidak sama dengan cicilan aktif Rp${actualDeduction.toLocaleString("id-ID")}.`,
      { expectedDeduction, actualDeduction, loanIds: plan.loans.map((loan) => loan.loanId) },
    );
  }
  return { ...plan, planHash: hashPlan(plan) };
}

function progressLoanData({ loan, planItem, payrollPeriod, operationId, actor, timestamp }) {
  if (!isPayrollEligibleLoan(loan, payrollPeriod)) {
    throw new LoanProgressionError(
      "LOAN_NOT_ACTIVE",
      `Pinjaman ${planItem.loanId} tidak lagi aktif atau tidak memiliki sisa cicilan.`,
    );
  }
  const current = buildPlanItem({ id: planItem.loanId, ...loan });
  const stableFields = [
    "installmentAmount",
    "paidBefore",
    "paidAfter",
    "tenor",
    "balanceBefore",
    "balanceAfter",
    "willPayOff",
  ];
  if (stableFields.some((field) => current[field] !== planItem[field])) {
    throw new LoanProgressionError(
      "LOAN_STATE_CHANGED",
      `Data pinjaman ${planItem.loanId} berubah setelah draf payroll disimpan.`,
      { expected: planItem, current },
    );
  }

  const history = Array.isArray(loan.history) ? [...loan.history] : [];
  const updatedBy = actor.source === "internal_bak_payroll"
    ? `internal-bak:${actor.uid}`
    : actor.uid;
  history.push({
    status: PAYMENT_STATUS,
    timestamp,
    updatedBy,
    updatedByName: actor.name || null,
    notes: `${planItem.paidAfter}/${planItem.tenor} melalui payroll ${payrollPeriod}`,
    source: actor.source,
    payrollPeriod,
    operationId,
  });
  if (planItem.willPayOff) {
    history.push({
      status: PAID_STATUS,
      timestamp,
      updatedBy,
      updatedByName: actor.name || null,
      notes: `Pinjaman lunas melalui payroll ${payrollPeriod}`,
      source: actor.source,
      payrollPeriod,
      operationId,
    });
  }

  return {
    update: {
      jumlahMenyicil: planItem.paidAfter,
      sisaHutang: planItem.balanceAfter,
      status: planItem.willPayOff
        ? PAID_STATUS
        : resolveLoanStatus(loan) === PENDING_RESTRUCTURING_STATUS
          ? PENDING_RESTRUCTURING_STATUS
          : ACTIVE_STATUS,
      history,
      ...(planItem.willPayOff ? { tanggalPelunasan: timestamp } : {}),
    },
    receipt: {
      loanId: planItem.loanId,
      outcome: planItem.willPayOff ? "paid_off" : "advanced",
      installmentAmount: planItem.installmentAmount,
      paidBefore: planItem.paidBefore,
      paidAfter: planItem.paidAfter,
      tenor: planItem.tenor,
      balanceBefore: planItem.balanceBefore,
      balanceAfter: planItem.balanceAfter,
    },
  };
}

module.exports = {
  ACTIVE_STATUS,
  PAYMENT_STATUS,
  PAID_STATUS,
  PENDING_RESTRUCTURING_STATUS,
  LoanProgressionError,
  bridgeSignature,
  isBridgeSignatureValid,
  isManualRoleAllowed,
  normalizeName,
  resolveLoanStatus,
  isPayrollPayableStatus,
  monthlyInstallment,
  isPayrollEligibleLoan,
  resolveMatchedEligibleLoans,
  buildPlanItem,
  hashPlan,
  resolveInstallmentPlan,
  progressLoanData,
};
