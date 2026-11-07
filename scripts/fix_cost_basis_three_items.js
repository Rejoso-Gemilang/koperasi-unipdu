/**
 * One-off correction of the cost basis of three items whose cost per piece was
 * above their selling price, so every sale of them showed a loss.
 *
 *   gerry salut sweet cheese  (sells Rp 1.000)
 *     8 Oct: "10 pcs for Rp 85.000" typed in the old Tetapkan dialog = Rp 8.500
 *     each, a stray zero. Rp 8.500 for the 10 is Rp 850 each.
 *   garuda pilus sapi panggang  (sells Rp 500)
 *     8 Oct: the old Tetapkan dialog added Rp 8.000 twice (10 pcs, then "set to
 *     20"), valuing the stock at Rp 800 each. The item's own last purchase price
 *     is 8.000 / 20 = Rp 400, so the stock is valued at that.
 *   Cokelat Telur  (sells Rp 2.000)
 *     The only purchase is 60 pcs for Rp 160.000 (Rp 2.667 each), but Harga Beli
 *     was later set to Rp 1.667 = 100.000 / 60, which says the purchase was
 *     Rp 100.000. The stock is valued at Rp 1.667. (The least certain of the three.)
 *
 * Only the stock records and the recent sales that show a loss because of it are
 * changed. Older sales and purchase records are left as they were typed.
 *
 * Usage (from the project root):
 *   Dry-run (reads only):   node scripts/fix_cost_basis_three_items.js
 *   Apply:                  EXECUTE=true node scripts/fix_cost_basis_three_items.js
 *   Undo:                   RESTORE=scripts/backups/<file>.json node scripts/fix_cost_basis_three_items.js
 *
 * Written in ONE transaction after every current value is checked; if anything
 * changed since it was read (a sale, a stock correction), nothing is written.
 */

const fs = require("fs");
const path = require("path");
const { initializeApp } = require("firebase/app");
const { getFirestore, doc, runTransaction, writeBatch } = require("firebase/firestore");

const db = getFirestore(
  initializeApp({
    apiKey: "AIzaSyB_sA0peKgiDudDGks0RNlwq6cB0IOer1M",
    authDomain: "koperasi-unipdu.firebaseapp.com",
    projectId: "koperasi-unipdu",
  })
);

const EXECUTE = process.env.EXECUTE === "true";
const RESTORE = process.env.RESTORE || "";
const BACKUP_DIR = path.join(__dirname, "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

// A sale line costed at the right unit cost: costPrice, the whole line's cost
// (lineCost, which the history page prefers) and the value taken off the stock.
const costedAt = (cost) => ({ costPrice: cost, stockWorth: cost, lineCost: cost });

const OPERATIONS = [
  // --- gerry salut sweet cheese: Rp 850 each, not Rp 8.500
  {
    label: "gerry salut sweet cheese (stock)",
    collection: "stocks",
    id: "gerry_salut_sweet_cheese_8992775305034",
    expect: { stock: 0, stockValue: 0, lastPurchasePrice: 8500 },
    set: { lastPurchasePrice: 850 },
  },
  {
    label: "gerry salut, sale 31 Oct",
    collection: "stockTransactions",
    id: "xKoWDcgFCTRDPVc3IS76",
    expect: { costPrice: 8500, stockWorth: 8500, quantity: 1, price: 1000 },
    set: costedAt(850),
  },
  {
    label: "gerry salut, sale 2 Nov (recorded stock was short)",
    collection: "stockTransactions",
    id: "dJKyLTVfy8NoUtsR0zVu",
    expect: { costPrice: 8500, stockWorth: 0, quantity: 1, price: 1000, isStockDiscrepant: true },
    // stockWorth stays 0: that is what was taken off the stock when it was short
    set: { costPrice: 850, lineCost: 850 },
  },

  // --- garuda pilus sapi panggang: Rp 400 each, not Rp 800
  {
    label: "garuda pilus (stock)",
    collection: "stocks",
    id: "garuda_pilus_sapi_panggang_8992775201473",
    expect: { stock: 18, stockValue: 14400, lastPurchasePrice: 400 },
    set: { stockValue: 7200 }, // 18 x 400
  },
  {
    label: "garuda pilus, sale 17 Oct",
    collection: "stockTransactions",
    id: "Vmg8ECVUwMAbSUNptXvo",
    expect: { costPrice: 800, stockWorth: 800, quantity: 1, price: 500 },
    set: costedAt(400),
  },
  {
    label: "garuda pilus, sale 29 Oct",
    collection: "stockTransactions",
    id: "8N30WpZfm9g2B1i6bBB6",
    expect: { costPrice: 800, stockWorth: 800, quantity: 1, price: 500 },
    set: costedAt(400),
  },

  // --- Cokelat Telur: Rp 1.667 each (Harga Beli), not Rp 2.667
  {
    label: "Cokelat Telur (stock)",
    collection: "stocks",
    id: "Tayo_Coklat_20250710103334",
    expect: { stock: 41, stockValue: 109333, lastPurchasePrice: 1667 },
    set: { stockValue: 68347 }, // 41 x 1667
  },
];

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const save = (file, data) => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

async function restore(file) {
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`Restoring ${backup.records.length} records from ${file}`);
  const batch = writeBatch(db);
  for (const record of backup.records) {
    batch.update(doc(db, record.collection, record.id), record.original);
  }
  await batch.commit();
  console.log("Restored.");
}

// Reads and checks everything; returns what would be written
async function plan(transaction) {
  const snaps = [];
  for (const op of OPERATIONS) {
    const ref = doc(db, op.collection, op.id);
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error(`${op.collection}/${op.id} not found`);
    snaps.push({ op, ref, data: snap.data() });
  }

  return snaps.map(({ op, ref, data }) => {
    for (const [field, value] of Object.entries(op.expect)) {
      if (!sameValue(data[field], value)) {
        throw new Error(
          `${op.label}: ${field} is ${JSON.stringify(data[field])}, expected ${JSON.stringify(value)}. Changed since it was read, nothing was written.`
        );
      }
    }
    const original = {};
    for (const field of Object.keys(op.set)) original[field] = data[field] ?? null;
    return { op, ref, original, updates: op.set };
  });
}

async function run() {
  console.log(`${EXECUTE ? "APPLYING" : "Dry-run"}: cost basis of three items\n`);

  const planned = await runTransaction(db, plan);
  for (const { op, original, updates } of planned) {
    console.log(`${op.label}  [${op.collection}/${op.id}]`);
    for (const field of Object.keys(updates)) {
      console.log(`    ${field}: ${JSON.stringify(original[field])} -> ${JSON.stringify(updates[field])}`);
    }
  }
  console.log(`\n${planned.length} records to change.`);

  if (!EXECUTE) {
    console.log("\nDry-run only: nothing was written. Re-run with EXECUTE=true to apply.");
    return;
  }

  const backupFile = path.join(BACKUP_DIR, `cost_basis_three_items_backup_${stamp}.json`);
  await runTransaction(db, async (transaction) => {
    const records = await plan(transaction);
    save(backupFile, {
      at: new Date().toISOString(),
      records: records.map(({ op, original }) => ({ collection: op.collection, id: op.id, original })),
    });
    for (const { ref, updates } of records) transaction.update(ref, updates);
  });
  console.log(`\nApplied. Backup (to undo): ${backupFile}`);
}

(RESTORE ? restore(RESTORE) : run())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\nFailed: ${error.message}`);
    process.exit(1);
  });
