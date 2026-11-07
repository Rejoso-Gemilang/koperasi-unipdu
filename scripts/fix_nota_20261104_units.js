/**
 * One-off correction of two lines of the 4 Nov 2026 purchase BP-20261104-001
 * (nota "ATK RA", photo WhatsApp Image 2026-11-04 at 14.09.15.jpeg) that were
 * entered with the wrong unit, and of what they caused.
 *
 *   Nota: "x28 Biji Amplop PPL T. Polos  13.000  364.000"
 *     entered as 28 pcs; one "biji" is a pack of 100, so it is 28 pack = 2800 pcs
 *     (13.000 per pcs made one pack cost Rp 1.300.000 on its 5 Nov sale).
 *   Nota: "x1 Lusin Clip no.111  3.500"
 *     entered as 1 pcs; a lusin is a dozen, so it is 12 pcs.
 *
 * Usage (from the project root):
 *   Dry-run (reads only):   node scripts/fix_nota_20261104_units.js
 *   Apply:                  EXECUTE=true node scripts/fix_nota_20261104_units.js
 *   Undo:                   RESTORE=scripts/backups/<file>.json node scripts/fix_nota_20261104_units.js
 *
 * Everything is written in ONE transaction, and every value this changes is
 * checked first. If anything has changed since it was read (a sale, a stock
 * correction), nothing is written.
 */

const fs = require("fs");
const path = require("path");
const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  collection,
  doc,
  getDocs,
  query,
  where,
  runTransaction,
  writeBatch,
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

const BULK_PURCHASE_ID = "BP-20261104-001";
const NOTA_ID = "2026-11-04_20261104141001";
const SALE_ID = "hR0z26Oc6ZIsb80XOVIO"; // 5 Nov, 1 pack to Luluk Mahfiyah, S.P.

const AMPLOP = "Amplop_Paperline_Pack_20260518093205";
const CLIP = "Binder_Clip_9922357666160";

// The nota item lines, as they are and as they should be.
const ITEM_FIXES = {
  "8991389247037": {
    name: "Amplop Paperline 95x152 Mm",
    from: { unit: "pcs", quantity: 28, price: 13000, subtotal: 364000 },
    to: { unit: "pack", quantity: 28, price: 13000, subtotal: 364000 },
  },
  "9922357666160": {
    name: "Binder Clip 25mm",
    from: { unit: "pcs", quantity: 1, price: 3500, subtotal: 3500 },
    // 12 pcs for 3500 is 291.67 each; the purchase screen rounds the unit price
    to: { unit: "pcs", quantity: 12, price: 292, subtotal: 3500 },
  },
};

// Stock records. After the correction: the amplop is 28 pack bought and
// 1 pack sold (2800 - 100 pcs, 364000 - 13000); the clip is 1 dozen bought
// where 1 pcs was added.
const STOCK_FIXES = {
  [AMPLOP]: {
    expect: { stock: 0, stockValue: 0, lastPurchasePrice: 13000 },
    set: { stock: 2700, stockValue: 351000, lastPurchasePrice: 130 },
  },
  [CLIP]: {
    expect: { stock: 1, stockValue: 3500, lastPurchasePrice: 3500 },
    set: { stock: 12, lastPurchasePrice: 292 },
  },
};

// The purchase's own stock transaction per line
const PURCHASE_TX_FIXES = {
  [`${BULK_PURCHASE_ID}_${AMPLOP}`]: {
    expect: { quantity: 28, originalQuantity: 28, originalUnit: "pcs", cost: 364000 },
    set: { quantity: 2800, originalUnit: "pack" },
  },
  [`${BULK_PURCHASE_ID}_${CLIP}`]: {
    expect: { quantity: 1, originalQuantity: 1, originalUnit: "pcs", cost: 3500 },
    set: { quantity: 12, originalQuantity: 12 },
  },
};

// The 5 Nov sale: costed at the cost of a pack (130 per pcs), not 13.000 per pcs
const SALE_FIX = {
  expect: { costPrice: 13000, stockWorth: 364000, quantity: 100, isStockDiscrepant: true },
  set: { costPrice: 130, stockWorth: 13000, lineCost: 13000, isStockDiscrepant: false },
};

const save = (file, data) => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function expectFields(label, data, expected) {
  for (const [field, value] of Object.entries(expected)) {
    if (!sameValue(data[field], value)) {
      throw new Error(
        `${label}: ${field} is ${JSON.stringify(data[field])}, expected ${JSON.stringify(value)}. Changed since it was read, nothing was written.`
      );
    }
  }
}

// Corrects the matching lines of an items array; throws if a line isn't as expected
function fixItems(label, items) {
  const fixed = items.map((item) => {
    const fix = ITEM_FIXES[item.itemId];
    if (!fix) return item;
    for (const [field, value] of Object.entries(fix.from)) {
      if (!sameValue(item[field], value)) {
        throw new Error(
          `${label}: item ${fix.name} ${field} is ${JSON.stringify(item[field])}, expected ${JSON.stringify(value)}`
        );
      }
    }
    return { ...item, ...fix.to };
  });
  return fixed;
}

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

async function run() {
  console.log(`${EXECUTE ? "APPLYING" : "Dry-run"}: ${BULK_PURCHASE_ID}\n`);

  // Which stock transactions belong to the purchase (each carries the nota's items)
  const purchaseDocs = await getDocs(
    query(collection(db, "stockTransactions"), where("bulkPurchaseId", "==", BULK_PURCHASE_ID))
  );
  const purchaseIds = purchaseDocs.docs.map((d) => d.id);
  for (const id of Object.keys(PURCHASE_TX_FIXES)) {
    if (!purchaseIds.includes(id)) throw new Error(`purchase stock transaction ${id} not found`);
  }

  const targets = [
    { collection: "notaBelanja", id: NOTA_ID, plan: (d) => ({ items: fixItems("nota", d.items) }) },
    ...purchaseIds.map((id) => ({
      collection: "stockTransactions",
      id,
      plan: (d) => {
        const fix = PURCHASE_TX_FIXES[id];
        if (fix) expectFields(id, d, fix.expect);
        return { ...(fix ? fix.set : {}), items: fixItems(id, d.items || []) };
      },
    })),
    {
      collection: "stockTransactions",
      id: SALE_ID,
      plan: (d) => (expectFields("sale", d, SALE_FIX.expect), { ...SALE_FIX.set }),
    },
    ...Object.entries(STOCK_FIXES).map(([id, fix]) => ({
      collection: "stocks",
      id,
      plan: (d) => (expectFields(`stocks/${id}`, d, fix.expect), { ...fix.set }),
    })),
  ];

  const execute = async (transaction) => {
    // Firestore wants every read before any write
    const snaps = [];
    for (const t of targets) {
      const ref = doc(db, t.collection, t.id);
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error(`${t.collection}/${t.id} not found`);
      snaps.push({ t, ref, data: snap.data() });
    }

    const records = [];
    const report = [];
    for (const { t, ref, data } of snaps) {
      const updates = t.plan(data);
      const original = {};
      const shown = [];
      for (const field of Object.keys(updates)) {
        if (sameValue(data[field], updates[field])) {
          delete updates[field];
          continue;
        }
        original[field] = data[field] ?? null;
        shown.push(
          field === "items"
            ? "items (corrected lines)"
            : `${field}: ${JSON.stringify(data[field])} -> ${JSON.stringify(updates[field])}`
        );
      }
      if (Object.keys(updates).length === 0) continue;
      records.push({ collection: t.collection, id: t.id, original, updates, ref });
      report.push({ where: `${t.collection}/${t.id}`, shown });
    }
    return { records, report };
  };

  // Plan from a read; nothing is written
  const planned = await runTransaction(db, execute);
  for (const r of planned.report) {
    console.log(r.where);
    for (const line of r.shown) console.log(`    ${line}`);
  }
  console.log(`\n${planned.records.length} records to change.`);

  if (!EXECUTE) {
    console.log("\nDry-run only: nothing was written. Re-run with EXECUTE=true to apply.");
    return;
  }

  const backupFile = path.join(BACKUP_DIR, `nota_20261104_units_backup_${stamp}.json`);
  await runTransaction(db, async (transaction) => {
    const { records } = await execute(transaction);
    save(backupFile, {
      at: new Date().toISOString(),
      records: records.map(({ collection: c, id, original }) => ({ collection: c, id, original })),
    });
    for (const r of records) transaction.update(r.ref, r.updates);
  });
  console.log(`\nApplied. Backup (to undo): ${backupFile}`);
}

(RESTORE ? restore(RESTORE) : run())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\nFailed: ${error.message}`);
    process.exit(1);
  });
