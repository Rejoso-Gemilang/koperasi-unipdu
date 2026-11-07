/**
 * Rounds decimal stock quantities and prices on the stock records to whole
 * numbers (see scripts/lib/stockDecimalCleanup.js for the rules).
 *
 * Touches only the current stock records: `stocks` (Unimart) and `stocks_b2b`
 * (warehouse). Past sales, purchases and stock transactions are history and
 * are left exactly as they were saved.
 *
 * Usage (from the project root):
 *   Dry-run (reads only, writes a report):   node scripts/round_stock_decimals.js
 *   Apply, after reading the report:         EXECUTE=true node scripts/round_stock_decimals.js
 *   Undo an applied run from its backup:     RESTORE=scripts/backups/<file>.json node scripts/round_stock_decimals.js
 *
 * Options:
 *   ENV=testing      use stocks_testing / stocks_b2b_testing instead of production
 *   ROUND_STOCK=all  also round real fractional stock (0.5 -> 1). By default only
 *                    rounding noise (a tenth or less) is rounded; real fractions
 *                    are listed and left alone, because rounding them changes
 *                    how much stock there is.
 *
 * Applying writes a backup of every original value first, record by record,
 * and each record is rewritten inside a transaction that re-reads it, so a
 * sale that lands while this runs is never overwritten.
 */

const fs = require("fs");
const path = require("path");
const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  collection,
  getDocs,
  doc,
  runTransaction,
  writeBatch,
} = require("firebase/firestore");
const { planStockRecord, findNotes } = require("./lib/stockDecimalCleanup");

const firebaseConfig = {
  apiKey: "AIzaSyB_sA0peKgiDudDGks0RNlwq6cB0IOer1M",
  authDomain: "koperasi-unipdu.firebaseapp.com",
  projectId: "koperasi-unipdu",
  storageBucket: "koperasi-unipdu.firebasestorage.app",
  messagingSenderId: "10094241377",
  appId: "1:10094241377:web:d788174993244f0d33ec20",
  measurementId: "G-BCP472H8DE",
};

const EXECUTE = process.env.EXECUTE === "true";
const RESTORE = process.env.RESTORE || "";
const ENV = process.env.ENV === "testing" ? "testing" : "production";
const SUFFIX = ENV === "testing" ? "_testing" : "";
const ROUND_ALL_STOCK = process.env.ROUND_STOCK === "all";
// Infinity makes every fractional stock count a rounding candidate
const RULES = { stockTolerance: ROUND_ALL_STOCK ? Infinity : 0.1 };
const COLLECTIONS = ["stocks", "stocks_b2b"].map((name) => name + SUFFIX);

const BACKUP_DIR = path.join(__dirname, "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const save = (file, data) => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

const describeChange = (c) =>
  `${c.field}: ${c.from} -> ${c.to}${c.reason ? ` (${c.reason})` : ""}`;

async function restore(file) {
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`Restoring ${backup.records.length} records from ${file} (${backup.env})`);
  for (let i = 0; i < backup.records.length; i += 400) {
    const batch = writeBatch(db);
    for (const record of backup.records.slice(i, i + 400)) {
      batch.update(doc(db, record.collection, record.id), record.original);
    }
    await batch.commit();
  }
  console.log("Restored.");
}

async function run() {
  console.log(
    `${EXECUTE ? "APPLYING" : "Dry-run"} on ${ENV}: ${COLLECTIONS.join(", ")}\n`
  );

  const report = { env: ENV, mode: EXECUTE ? "execute" : "dry-run", at: new Date().toISOString(), collections: {} };
  const toApply = [];

  for (const name of COLLECTIONS) {
    const snapshot = await getDocs(collection(db, name));
    const section = { read: snapshot.size, changed: [], notes: [] };
    report.collections[name] = section;

    snapshot.forEach((snap) => {
      const data = snap.data();
      const plan = planStockRecord(data, RULES);
      if (plan) {
        section.changed.push({ id: snap.id, name: data.name, changes: plan.changes });
        toApply.push({ collection: name, id: snap.id });
      }
      for (const note of findNotes(data, RULES)) {
        section.notes.push({ id: snap.id, name: data.name, ...note });
      }
    });

    console.log(`== ${name}: ${section.read} records, ${section.changed.length} to change`);
    for (const item of section.changed) {
      console.log(`  ${item.name || item.id}`);
      for (const c of item.changes) console.log(`    ${describeChange(c)}`);
    }
    if (section.notes.length) {
      console.log(`  -- Not changed, worth a look (${section.notes.length}):`);
      for (const n of section.notes) console.log(`    ${n.name || n.id}: ${n.message}`);
    }
    console.log("");
  }

  const stockChanges = Object.values(report.collections)
    .flatMap((s) => s.changed)
    .flatMap((c) => c.changes)
    .filter((c) => c.field === "stock");
  console.log(
    `${toApply.length} records to change; ${stockChanges.length} of them change a stock QUANTITY (net ${
      stockChanges.reduce((sum, c) => sum + (c.to - c.from), 0)
    } units).`
  );

  const reportFile = path.join(BACKUP_DIR, `stock_decimals_report_${ENV}_${stamp}.json`);
  save(reportFile, report);
  console.log(`Report: ${reportFile}`);

  if (!EXECUTE) {
    console.log("\nDry-run only: nothing was written. Re-run with EXECUTE=true to apply.");
    return;
  }

  const backupFile = path.join(BACKUP_DIR, `stock_decimals_backup_${ENV}_${stamp}.json`);
  const backup = { env: ENV, at: report.at, records: [] };
  let written = 0;

  for (const target of toApply) {
    const ref = doc(db, target.collection, target.id);
    const done = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return null;
      const data = snap.data();
      const plan = planStockRecord(data, RULES); // re-planned from what is there now
      if (!plan) return null;

      const original = {};
      for (const field of Object.keys(plan.updates)) original[field] = data[field] ?? null;
      transaction.update(ref, plan.updates);
      return { collection: target.collection, id: target.id, original };
    });

    if (done) {
      backup.records.push(done);
      save(backupFile, backup); // kept up to date, so a crash still leaves an undo
      written += 1;
    }
  }

  console.log(`\nApplied to ${written} records. Backup (to undo): ${backupFile}`);

  // Check the result
  let remaining = 0;
  for (const name of COLLECTIONS) {
    const snapshot = await getDocs(collection(db, name));
    snapshot.forEach((snap) => {
      const data = snap.data();
      if (planStockRecord(data, RULES)) remaining += 1;
      remaining += findNotes(data, RULES).filter((n) => n.kind === "fractional-stock").length;
    });
  }
  console.log(remaining === 0 ? "Check: every record is now whole." : `Check: ${remaining} stock counts still have a real fraction (listed above, left as they were).`);
}

(RESTORE ? restore(RESTORE) : run())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\nFailed: ${error.code || ""} ${error.message}`);
    if (String(error.code).includes("permission")) {
      console.error("Firestore refused the request. These scripts use the public web key with no sign-in, so this needs rules that allow it or a run with admin credentials.");
    }
    process.exit(1);
  });
