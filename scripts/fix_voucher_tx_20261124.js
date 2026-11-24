/**
 * One-off correction of voucher transaction 20261124-091357-QTM
 * (Customer: Nur Feri Setiono, S.AB., Member: 25087, Voucher: ATK November 2026 (500rb))
 *
 * Problem:
 * The cashier rang up the wrong basket.
 *   Entered:  2 rim Kertas Hvs Sidu A4 210x297mm, 2 pcs Sahdu Gelas           (Rp 102.000)
 *   Checked out: 2 rim Kertas Hvs Sidu A4 210x297mm,
 *                2 pack Sahdu Gelas (1 pack = 40 pcs, Rp 25.000 per pack),
 *                1 rim Kertas Hvs Sidu F4 216x330mm (1 rim = 500 pcs, Rp 55.000 per rim)
 *                                                                              (Rp 205.000)
 *
 * The voucher balance before the sale was Rp 500.000, so the corrected total is still
 * fully covered by the voucher: kredit goes from Rp 102.000 to Rp 205.000, cash/QRIS stay 0.
 *
 * Impacted data:
 * 1. transactionDetail/20261124-091357-QTM:
 *    - items: Sahdu Gelas 2 pcs @ 1.000 -> 2 pack @ 25.000 (subtotal 2.000 -> 50.000)
 *             new line Kertas Hvs Sidu F4 216x330mm 1 rim @ 55.000
 *    - total, voucherDiscount, kreditAmount: 102.000 -> 205.000
 *    - voucherBalanceAfter: 398.000 -> 295.000 (voucherBalanceBefore stays 500.000)
 * 2. stocks/Sahdu_Gelas_20260813114339: 78 more pcs deducted (stock 824 -> 746,
 *    stockValue 422.313 -> 382.337 at the average cost the POS used for this sale)
 * 3. stocks/HVS_Sidu_F4_216x330_mm_20260624103903: 500 pcs deducted (stock 6.000 -> 5.500,
 *    stockValue 503.142 -> 461.214)
 * 4. stockTransactions for this sale:
 *    - Sahdu Gelas line: quantity 2 -> 80 pcs (originalUnit pcs -> pack, originalQuantity 2),
 *      price 1.000 -> 25.000, lineCost/stockWorth 1.025 -> 41.001
 *    - new line for Kertas Hvs Sidu F4 (500 pcs, lineCost/stockWorth 41.929, same time as the sale)
 *    - kreditAmount 102.000 -> 205.000 on every line of the sale
 * 5. vouchers/DmG2dIeQyus4a7aVZEAf: amountSpent 102.000 -> 205.000, sisaSaldo 398.000 -> 295.000
 *
 * Cashflow: the Laporan Arus Kas reads sales live from transactionDetail, so the Kredit
 * sales of 24 Nov rise by Rp 103.000. The stored November closings (cashflowSettings/2026-11
 * and the November daily reports) are refreshed afterwards by the app's own
 * cashflowService.updateDailyReportSales("2026-11-24"), the call the app makes after a sale
 * changes. Those closing fields are saved in this backup too, so an undo restores them.
 *
 * Usage (from project root):
 *   Dry-run (reads only):   node scripts/fix_voucher_tx_20261124.js
 *   Apply:                  EXECUTE=true node scripts/fix_voucher_tx_20261124.js
 *   Undo:                   RESTORE=scripts/backups/<file>.json node scripts/fix_voucher_tx_20261124.js
 */

const fs = require("fs");
const path = require("path");
const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  doc,
  collection,
  query,
  where,
  getDoc,
  getDocs,
  runTransaction,
  writeBatch,
  serverTimestamp,
  deleteField,
  Timestamp,
} = require("firebase/firestore");

const app = initializeApp({
  apiKey: "AIzaSyB_sA0peKgiDudDGks0RNlwq6cB0IOer1M",
  authDomain: "koperasi-unipdu.firebaseapp.com",
  projectId: "koperasi-unipdu",
});
const db = getFirestore(app);

const EXECUTE = process.env.EXECUTE === "true";
const RESTORE = process.env.RESTORE || "";
const BACKUP_DIR = path.join(__dirname, "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const TX_ID = "20261124-091357-QTM";
const VOUCHER_ID = "DmG2dIeQyus4a7aVZEAf";
const A4_ID = "(Satuan)_Hvs_Sidu_A4_210x297mm_20260702225653";
const SAHDU_ID = "Sahdu_Gelas_20260813114339";
const F4_ID = "HVS_Sidu_F4_216x330_mm_20260624103903";
const MONTH = "2026-11";

const SETTINGS_CLOSING_FIELDS = ["closingCash", "closingQris", "closingKredit", "closingFinal", "closingSyncedAt"];
const REPORT_CLOSING_FIELDS = ["closingCash", "closingQris", "closingKredit"];

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Same rule as roundRupiah in src/utils/profitUtils.js
const roundRupiah = (value) => Math.round(Number(value)) || 0;
// Same rule as getUnitCost in src/utils/profitUtils.js: average cost, else last purchase price
const getUnitCost = (stock) => {
  if (stock.stock > 0 && stock.stockValue > 0) return stock.stockValue / stock.stock;
  if (stock.lastPurchasePrice > 0) return stock.lastPurchasePrice;
  return 0;
};
const idr = (n) => (typeof n === "number" ? n.toLocaleString("id-ID") : String(n));
const fmtValue = (v) =>
  Array.isArray(v)
    ? v.map((i) => `${i.itemName} ${i.quantity} ${i.unit} @ ${idr(i.price)} = ${idr(i.subtotal)}`).join(" + ")
    : typeof v === "number"
    ? idr(v)
    : JSON.stringify(v);

// Timestamps are saved in the backup as {__timestamp} and revived on restore; null means "field did not exist".
const serialize = (v) =>
  v === undefined ? null : v instanceof Timestamp ? { __timestamp: v.toDate().toISOString() } : v;
const revive = (v) =>
  v === null
    ? deleteField()
    : v && typeof v === "object" && "__timestamp" in v
    ? Timestamp.fromDate(new Date(v.__timestamp))
    : v;
const pickFields = (data, fields) => Object.fromEntries(fields.map((f) => [f, serialize(data?.[f])]));

const save = (file, data) => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

function expectFields(label, data, expected) {
  for (const [field, value] of Object.entries(expected)) {
    if (!sameValue(data[field], value)) {
      throw new Error(
        `${label}: ${field} is ${JSON.stringify(data[field])}, expected ${JSON.stringify(
          value
        )}. Aborting to avoid corrupting concurrent changes.`
      );
    }
  }
}

async function restore(file) {
  const filePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file not found: ${filePath}`);
  }
  const backup = JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(`Restoring ${backup.records.length} records from ${filePath}...`);
  const batch = writeBatch(db);
  for (const record of backup.records) {
    const ref = doc(db, record.collection, record.id);
    if (record.kind === "create") {
      batch.delete(ref);
      continue;
    }
    const data = {};
    for (const [field, value] of Object.entries(record.original)) {
      data[field] = revive(value);
    }
    batch.update(ref, data);
  }
  await batch.commit();
  console.log("Successfully restored all records from backup.");
}

// Adds an update to the plan only for fields that actually change.
function planUpdate(plan, collectionName, id, current, changes) {
  const updates = {};
  const original = {};
  const shown = [];
  for (const [field, next] of Object.entries(changes)) {
    const was = current[field];
    if (sameValue(was, next)) continue;
    updates[field] = next;
    original[field] = serialize(was);
    shown.push(`${field}: ${fmtValue(was)} -> ${fmtValue(next)}`);
  }
  if (shown.length === 0) return;
  updates.updatedAt = serverTimestamp();
  plan.writes.push({ kind: "update", ref: doc(db, collectionName, id), updates });
  plan.backupRecords.push({ kind: "update", collection: collectionName, id, original });
  plan.report.push({ where: `${collectionName}/${id}`, shown });
}

// Reads every document the correction depends on and works out the corrected values.
// `get` is getDoc for the dry run, transaction.get inside the apply transaction.
async function planCorrection(get, lineIds) {
  const read = async (ref) => {
    const snap = await get(ref);
    if (!snap.exists()) throw new Error(`Document ${ref.path} does not exist`);
    return snap.data();
  };

  const tx = await read(doc(db, "transactionDetail", TX_ID));
  const voucher = await read(doc(db, "vouchers", VOUCHER_ID));
  const sahdu = await read(doc(db, "stocks", SAHDU_ID));
  const f4 = await read(doc(db, "stocks", F4_ID));
  const a4Line = await read(doc(db, "stockTransactions", lineIds.a4));
  const sahduLine = await read(doc(db, "stockTransactions", lineIds.sahdu));

  // --- Preconditions: every value the new numbers are built from must still be what was checked ---
  expectFields(`transactionDetail/${TX_ID}`, tx, {
    total: 102000,
    voucherDiscount: 102000,
    kreditAmount: 102000,
    discountedTotal: 0,
    voucherId: VOUCHER_ID,
    paymentMethod: "kredit",
    cashAmount: 0,
    qrisAmount: 0,
    voucherBalanceBefore: 500000,
    voucherBalanceAfter: 398000,
  });
  if (!Array.isArray(tx.items) || tx.items.length !== 2) {
    throw new Error(`transactionDetail/${TX_ID}: expected 2 item lines, found ${tx.items?.length}`);
  }
  expectFields("items[0] Kertas Hvs Sidu A4", tx.items[0], {
    itemId: A4_ID,
    quantity: 2,
    unit: "rim",
    price: 50000,
    subtotal: 100000,
  });
  expectFields("items[1] Sahdu Gelas", tx.items[1], {
    itemId: SAHDU_ID,
    itemName: "Sahdu Gelas",
    quantity: 2,
    unit: "pcs",
    price: 1000,
    subtotal: 2000,
  });
  expectFields(`vouchers/${VOUCHER_ID}`, voucher, {
    value: 500000,
    isOneTimeUse: false,
    amountSpent: 102000,
    sisaSaldo: 398000,
    isClaimed: false,
    lastRedemptionTransactionId: TX_ID,
  });
  expectFields(`stocks/${SAHDU_ID}`, sahdu, {
    stock: 824,
    stockValue: 422313,
    base_unit: "pcs",
    smallestUnit: "pcs",
    bulk_unit_name: "pack",
    bulk_unit_conversion: 40,
  });
  expectFields(`stocks/${F4_ID}`, f4, {
    name: "Kertas Hvs Sidu F4 216x330mm",
    kategori: "ATK",
    subKategori: "Kertas",
    stock: 6000,
    stockValue: 503142,
    base_unit: "pcs",
    smallestUnit: "pcs",
    bulk_unit_name: "rim",
    bulk_unit_conversion: 500,
  });
  expectFields(`stockTransactions/${lineIds.sahdu}`, sahduLine, {
    transactionId: TX_ID,
    itemId: SAHDU_ID,
    quantity: 2,
    unit: "pcs",
    originalQuantity: 2,
    originalUnit: "pcs",
    price: 1000,
    costPrice: 513,
    lineCost: 1025,
    stockWorth: 1025,
    kreditAmount: 102000,
  });
  expectFields(`stockTransactions/${lineIds.a4}`, a4Line, {
    transactionId: TX_ID,
    itemId: A4_ID,
    quantity: 1000,
    unit: "pcs",
    price: 50000,
    lineCost: 80000,
    stockWorth: 80000,
    kreditAmount: 102000,
  });
  if (sahdu.pricePerUnit?.pack !== 25000 || f4.pricePerUnit?.rim !== 55000) {
    throw new Error("Pack or rim price has changed since it was checked. Aborting.");
  }

  // --- New basket, priced the way the POS prices a bulk unit (getPriceAndSubtotal) ---
  const a4Subtotal = tx.items[0].subtotal; // unchanged: 2 rim @ 50.000
  const sahduPcs = 2 * sahdu.bulk_unit_conversion; // 80 pcs
  const sahduPrice = Math.round(sahdu.pricePerUnit.pack); // 25.000
  const sahduSubtotal = Math.round(sahduPrice * 2); // 50.000
  const f4Pcs = 1 * f4.bulk_unit_conversion; // 500 pcs
  const f4Price = Math.round(f4.pricePerUnit.rim); // 55.000
  const f4Subtotal = Math.round(f4Price * 1); // 55.000
  const newTotal = a4Subtotal + sahduSubtotal + f4Subtotal; // 205.000

  // Voucher rule from Transaksi.js: discount = min(balance before, total); payable = total - discount
  const newDiscount = Math.min(tx.voucherBalanceBefore, newTotal);
  const payable = newTotal - newDiscount;
  if (payable !== 0) {
    throw new Error(
      `Corrected total ${idr(newTotal)} is not fully covered by the voucher (balance ${idr(
        tx.voucherBalanceBefore
      )}). The cash/QRIS split has to be decided by hand.`
    );
  }

  // Voucher rule from buildVoucherRedemption (multi-use voucher). This sale was the only redemption.
  const faceValue = voucher.value;
  const amountSpentBefore = voucher.amountSpent - tx.voucherDiscount; // 0
  if (faceValue - amountSpentBefore !== tx.voucherBalanceBefore) {
    throw new Error("Voucher balance before the sale does not match the transaction. Aborting.");
  }
  const newAmountSpent = amountSpentBefore + newDiscount; // 205.000
  const newVoucherSisa = Math.max(0, faceValue - newAmountSpent); // 295.000
  const newVoucherBalanceAfter = faceValue - newAmountSpent; // 295.000

  // Stock. The Sahdu Gelas and A4 stock docs were last written by this sale, so their
  // current average is the average the POS used at 09:13:57. Averages do not move on a sale.
  const sahduUnitCost = getUnitCost(sahdu);
  const sahduOldPcs = sahduLine.quantity; // 2
  const sahduExtraPcs = sahduPcs - sahduOldPcs; // 78 more pcs leave the shelf
  if (sahdu.stock < sahduExtraPcs) throw new Error("Not enough Sahdu Gelas stock for the correction");
  const sahduNewStock = sahdu.stock - sahduExtraPcs; // 746
  const sahduNewValue = roundRupiah(Math.max(0, sahdu.stockValue - sahduUnitCost * sahduExtraPcs)); // 382.337
  const sahduLineCost = roundRupiah(sahduUnitCost * sahduPcs); // 41.001
  const sahduCostPrice = roundRupiah(sahduUnitCost); // 513, unchanged

  // F4 is a new line in this sale. Its stock has not moved since 18 Oct, so its current average is the one used.
  const f4UnitCost = getUnitCost(f4);
  if (f4.stock < f4Pcs) throw new Error("Not enough F4 stock for the correction");
  const f4NewStock = f4.stock - f4Pcs; // 5.500
  const f4NewValue = roundRupiah(Math.max(0, f4.stockValue - f4UnitCost * f4Pcs)); // 461.214
  const f4LineCost = roundRupiah(f4UnitCost * f4Pcs); // 41.929
  const f4CostPrice = roundRupiah(f4UnitCost); // 84

  const plan = { writes: [], backupRecords: [], report: [] };

  // 1. The sale itself
  const newItems = [
    tx.items[0],
    { ...tx.items[1], unit: "pack", quantity: 2, price: sahduPrice, subtotal: sahduSubtotal },
    { itemId: F4_ID, itemName: f4.name, quantity: 1, unit: "rim", price: f4Price, subtotal: f4Subtotal },
  ];
  planUpdate(plan, "transactionDetail", TX_ID, tx, {
    items: newItems,
    total: newTotal,
    voucherDiscount: newDiscount,
    kreditAmount: newDiscount,
    discountedTotal: payable,
    voucherBalanceAfter: newVoucherBalanceAfter,
  });

  // 2. The voucher
  planUpdate(plan, "vouchers", VOUCHER_ID, voucher, {
    amountSpent: newAmountSpent,
    sisaSaldo: newVoucherSisa,
    isClaimed: newVoucherSisa <= 0,
  });

  // 3. Stock
  planUpdate(plan, "stocks", SAHDU_ID, sahdu, { stock: sahduNewStock, stockValue: sahduNewValue });
  planUpdate(plan, "stocks", F4_ID, f4, { stock: f4NewStock, stockValue: f4NewValue });

  // 4. Stock lines of this sale
  planUpdate(plan, "stockTransactions", lineIds.sahdu, sahduLine, {
    quantity: sahduPcs,
    originalQuantity: 2,
    originalUnit: "pack",
    price: sahduPrice,
    costPrice: sahduCostPrice,
    lineCost: sahduLineCost,
    stockWorth: sahduLineCost,
    kreditAmount: newDiscount,
  });
  planUpdate(plan, "stockTransactions", lineIds.a4, a4Line, { kreditAmount: newDiscount });

  // New F4 line, with the same fields and time as the other lines of this sale
  const newLine = {
    transactionId: TX_ID,
    itemId: F4_ID,
    itemName: f4.name,
    kategori: f4.kategori,
    subKategori: f4.subKategori,
    price: f4Price,
    quantity: f4Pcs,
    unit: f4.smallestUnit,
    originalQuantity: 1,
    originalUnit: "rim",
    isDeleted: false,
    timestampInMillisEpoch: a4Line.timestampInMillisEpoch,
    timestamp: a4Line.timestamp,
    createdAt: a4Line.createdAt,
    transactionType: "penjualan",
    transactionVia: "pointOfSales",
    costPrice: f4CostPrice,
    lineCost: f4LineCost,
    stockWorth: f4LineCost,
    isStockDiscrepant: false,
    createdBy: a4Line.createdBy,
    userId: a4Line.userId,
    nomorAnggota: a4Line.nomorAnggota,
    memberName: a4Line.memberName,
    isMember: a4Line.isMember,
    paymentMethod: a4Line.paymentMethod,
    isPaidViaQris: a4Line.isPaidViaQris,
    cashAmount: a4Line.cashAmount,
    qrisAmount: a4Line.qrisAmount,
    kreditAmount: newDiscount,
    updatedAt: serverTimestamp(),
  };
  plan.writes.push({ kind: "create", ref: doc(db, "stockTransactions", lineIds.f4New), data: newLine });
  plan.backupRecords.push({ kind: "create", collection: "stockTransactions", id: lineIds.f4New });
  plan.report.push({
    where: `stockTransactions/${lineIds.f4New} (new line)`,
    shown: [
      `itemName: ${newLine.itemName}, quantity: ${newLine.quantity} ${newLine.unit} (1 rim)`,
      `price: ${idr(newLine.price)}, costPrice: ${idr(newLine.costPrice)}, lineCost/stockWorth: ${idr(newLine.lineCost)}`,
      `kreditAmount: ${idr(newLine.kreditAmount)}`,
    ],
  });

  // Profit of the sale, as the POS shows it (total - cost of goods)
  const oldCost = a4Line.lineCost + sahduLine.lineCost;
  const newCost = a4Line.lineCost + sahduLineCost + f4LineCost;
  const summary = [
    `Sale total: ${idr(tx.total)} -> ${idr(newTotal)} (kredit ${idr(tx.kreditAmount)} -> ${idr(newDiscount)}, cash/QRIS 0)`,
    `Profit of this sale (total - cost): ${idr(tx.total - oldCost)} -> ${idr(newTotal - newCost)}`,
    `Voucher ${voucher.voucherName || VOUCHER_ID} remaining: ${idr(faceValue - voucher.amountSpent)} -> ${idr(faceValue - newAmountSpent)}`,
  ];

  return { ...plan, summary };
}

// Stored closings that the re-sync rewrites. Saved before any change so an undo covers them.
async function readClosingRecords() {
  const records = [];
  const settings = await getDoc(doc(db, "cashflowSettings", MONTH));
  records.push(
    settings.exists()
      ? { kind: "update", collection: "cashflowSettings", id: MONTH, original: pickFields(settings.data(), SETTINGS_CLOSING_FIELDS) }
      : { kind: "create", collection: "cashflowSettings", id: MONTH }
  );
  const reports = await getDocs(
    query(
      collection(db, "dailyFinancialReports"),
      where("date", ">=", `${MONTH}-01`),
      where("date", "<=", `${MONTH}-31`)
    )
  );
  for (const report of reports.docs) {
    records.push({
      kind: "update",
      collection: "dailyFinancialReports",
      id: report.id,
      original: pickFields(report.data(), REPORT_CLOSING_FIELDS),
    });
  }
  return { records, settings: settings.exists() ? settings.data() : null, reportCount: reports.size };
}

function printPlan(plan) {
  console.log("Planned modifications:\n");
  for (const r of plan.report) {
    console.log(`  ${r.where}`);
    for (const line of r.shown) console.log(`    - ${line}`);
  }
  console.log("\nEffects:");
  for (const line of plan.summary) console.log(`  - ${line}`);
  console.log(`\nTotal documents to write: ${plan.writes.length} (plus the cashflow re-sync afterwards)`);
}

async function run() {
  console.log("================================================================================");
  console.log(`${EXECUTE ? ">>> APPLYING CHANGES" : ">>> DRY RUN (READ ONLY)"} for transaction: ${TX_ID}`);
  console.log("================================================================================\n");

  // 1. The two existing stock lines of this sale (queries cannot run inside a transaction)
  const stSnap = await getDocs(
    query(collection(db, "stockTransactions"), where("transactionId", "==", TX_ID))
  );
  const lineByItem = new Map(stSnap.docs.map((d) => [d.data().itemId, d.id]));
  if (stSnap.size !== 2 || !lineByItem.has(A4_ID) || !lineByItem.has(SAHDU_ID)) {
    throw new Error(
      `Expected the 2 stock lines (A4 and Sahdu Gelas) for ${TX_ID}, found ${stSnap.size}`
    );
  }
  const lineIds = {
    a4: lineByItem.get(A4_ID),
    sahdu: lineByItem.get(SAHDU_ID),
    f4New: doc(collection(db, "stockTransactions")).id, // id for the new F4 line
  };

  const closings = await readClosingRecords();
  console.log(
    `Stored ${MONTH} closings (re-synced after apply): ${
      closings.settings
        ? `cash ${idr(closings.settings.closingCash)}, qris ${idr(closings.settings.closingQris)}, kredit ${idr(closings.settings.closingKredit)} (final=${closings.settings.closingFinal})`
        : "no settings document"
    }; ${closings.reportCount} November daily reports\n`
  );

  if (!EXECUTE) {
    const plan = await planCorrection((ref) => getDoc(ref), lineIds);
    printPlan(plan);
    console.log("\n--------------------------------------------------------------------------------");
    console.log("DRY RUN COMPLETE: No data was modified.");
    console.log("To apply these changes, run:");
    console.log("  EXECUTE=true node scripts/fix_voucher_tx_20261124.js");
    console.log("--------------------------------------------------------------------------------\n");
    return;
  }

  // 2. Apply: plan and writes in one Firestore transaction, backup saved before the first write
  const backupFile = path.join(BACKUP_DIR, `fix_voucher_tx_${TX_ID}_${stamp}.json`);
  let applied = null;
  await runTransaction(db, async (transaction) => {
    const plan = await planCorrection((ref) => transaction.get(ref), lineIds);
    save(backupFile, {
      at: new Date().toISOString(),
      transactionId: TX_ID,
      records: [...plan.backupRecords, ...closings.records],
    });
    for (const w of plan.writes) {
      if (w.kind === "create") transaction.set(w.ref, w.data);
      else transaction.update(w.ref, w.updates);
    }
    applied = plan;
  });
  printPlan(applied);

  // 3. Read back what was written
  const tx = (await getDoc(doc(db, "transactionDetail", TX_ID))).data();
  console.log("\nAfter:");
  console.log(`  transactionDetail: total ${idr(tx.total)}, voucherDiscount ${idr(tx.voucherDiscount)}, kreditAmount ${idr(tx.kreditAmount)}, discountedTotal ${idr(tx.discountedTotal)}, voucherBalanceAfter ${idr(tx.voucherBalanceAfter)}`);
  console.log(`  items: ${tx.items.map((i) => `${i.itemName} ${i.quantity} ${i.unit} x ${idr(i.price)} = ${idr(i.subtotal)}`).join(" | ")}`);
  const v = (await getDoc(doc(db, "vouchers", VOUCHER_ID))).data();
  console.log(`  voucher: amountSpent ${idr(v.amountSpent)}, sisaSaldo ${idr(v.sisaSaldo)}, isClaimed ${v.isClaimed}`);
  for (const id of [SAHDU_ID, F4_ID]) {
    const s = (await getDoc(doc(db, "stocks", id))).data();
    console.log(`  stocks/${id}: stock ${idr(s.stock)}, stockValue ${idr(s.stockValue)}`);
  }

  console.log("\n================================================================================");
  console.log("SUCCESS: All updates committed atomically!");
  console.log(`Backup created at: ${backupFile}`);
  console.log("Next: refresh the stored November closings (cashflowSettings/2026-11 and the daily reports).");
  console.log("To undo, run:");
  console.log(`  RESTORE=${backupFile} node scripts/fix_voucher_tx_20261124.js`);
  console.log("================================================================================\n");
}

(RESTORE ? restore(RESTORE) : run())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  });
