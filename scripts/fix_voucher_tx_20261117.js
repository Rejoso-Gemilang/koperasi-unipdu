/**
 * One-off correction of voucher transaction 20261117-112915-4NX
 * (Customer: Lulus Oktavia Kartikasari, S.Pd., Member: 25084, Voucher: ATK November 2026 (1jt))
 *
 * Problem:
 * Cashier accidentally entered "Amplop Paperline 95x152 Mm" as 1 pcs (Rp 500)
 * instead of 1 pack (Rp 15.000 = 100 pcs).
 *
 * Impacted data:
 * 1. transactionDetail/20261117-112915-4NX:
 *    - Item line: unit "pcs" -> "pack", price 500 -> 15.000, subtotal 500 -> 15.000
 *    - total: 202.500 -> 217.000 (+14.500)
 *    - voucherDiscount: 202.500 -> 217.000 (+14.500)
 *    - kreditAmount: 202.500 -> 217.000 (+14.500)
 *    - voucherBalanceAfter: 797.500 -> 783.000 (-14.500)
 * 2. stocks/Amplop_Paperline_Pack_20260518093205:
 *    - Previously deducted 1 pcs (Rp 130). Should have deducted 1 pack = 100 pcs (Rp 13.000).
 *    - Additional deduction: 99 pcs (stock: 2499 -> 2400)
 *    - Additional stockValue deduction: 99 * 130 = Rp 12.870 (stockValue: 324.870 -> 312.000)
 * 3. stockTransactions/hYdYB0mm55ywA6KMd1gn (Amplop sale line):
 *    - originalUnit: "pcs" -> "pack"
 *    - quantity: 1 -> 100 pcs
 *    - price: 500 -> 15.000
 *    - lineCost: 130 -> 13.000
 *    - stockWorth: 130 -> 13.000
 *    - kreditAmount: 202.500 -> 217.000
 * 4. stockTransactions (other 4 lines in the same transaction):
 *    - kreditAmount: 202.500 -> 217.000
 * 5. vouchers/JVKmfxCep6QwNXGtixnE:
 *    - amountSpent: 202.500 -> 217.000 (+14.500)
 *    - sisaSaldo: 797.500 -> 783.000 (-14.500)
 *
 * Usage (from project root):
 *   Dry-run (reads only):   node scripts/fix_voucher_tx_20261117.js
 *   Apply:                  EXECUTE=true node scripts/fix_voucher_tx_20261117.js
 *   Undo:                   RESTORE=scripts/backups/<file>.json node scripts/fix_voucher_tx_20261117.js
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
  getDocs,
  runTransaction,
  writeBatch,
  serverTimestamp,
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

const TX_ID = "20261117-112915-4NX";
const ITEM_ID = "Amplop_Paperline_Pack_20260518093205";
const VOUCHER_ID = "JVKmfxCep6QwNXGtixnE";

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

const save = (file, data) => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

async function restore(file) {
  const filePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file not found: ${filePath}`);
  }
  const backup = JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(`Restoring ${backup.records.length} records from ${filePath}...`);
  const batch = writeBatch(db);
  for (const record of backup.records) {
    batch.update(doc(db, record.collection, record.id), record.original);
  }
  await batch.commit();
  console.log("Successfully restored all records from backup.");
}

async function run() {
  console.log("================================================================================");
  console.log(`${EXECUTE ? ">>> APPLYING CHANGES" : ">>> DRY RUN (READ ONLY)"} for transaction: ${TX_ID}`);
  console.log("================================================================================\n");

  // 1. Fetch all stock transactions belonging to this sale
  const stQuery = query(
    collection(db, "stockTransactions"),
    where("transactionId", "==", TX_ID)
  );
  const stSnap = await getDocs(stQuery);
  if (stSnap.empty) {
    throw new Error(`No stockTransactions found for transactionId ${TX_ID}`);
  }

  const stockTxDocs = stSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const amplopStockTx = stockTxDocs.find((d) => d.data.itemId === ITEM_ID);
  if (!amplopStockTx) {
    throw new Error(`Stock transaction for item ${ITEM_ID} not found in transaction ${TX_ID}`);
  }

  // Define target documents and their mutation plans with pre-condition expectations
  const targets = [
    // --- 1. Transaction Detail ---
    {
      collection: "transactionDetail",
      id: TX_ID,
      plan: (d) => {
        expectFields(`transactionDetail/${TX_ID}`, d, {
          total: 202500,
          voucherDiscount: 202500,
          kreditAmount: 202500,
          voucherBalanceBefore: 1000000,
          voucherBalanceAfter: 797500,
        });

        const items = (d.items || []).map((item) => {
          if (item.itemId === ITEM_ID) {
            expectFields(`item ${item.itemName}`, item, {
              unit: "pcs",
              quantity: 1,
              price: 500,
              subtotal: 500,
            });
            return {
              ...item,
              unit: "pack",
              quantity: 1,
              price: 15000,
              subtotal: 15000,
            };
          }
          return item;
        });

        return {
          items,
          total: 217000,
          voucherDiscount: 217000,
          kreditAmount: 217000,
          voucherBalanceAfter: 783000,
          updatedAt: serverTimestamp(),
        };
      },
    },

    // --- 2. Stock Record ---
    {
      collection: "stocks",
      id: ITEM_ID,
      plan: (d) => {
        expectFields(`stocks/${ITEM_ID}`, d, {
          stock: 2499,
          stockValue: 324870,
          lastPurchasePrice: 130,
        });
        // Deduct 99 more pieces (1 pack = 100 pcs, 1 was already deducted)
        // 2499 - 99 = 2400 pcs
        // stockValue: 324870 - (99 * 130) = 312000
        return {
          stock: 2400,
          stockValue: 312000,
          updatedAt: serverTimestamp(),
        };
      },
    },

    // --- 3. Amplop Stock Transaction Line ---
    {
      collection: "stockTransactions",
      id: amplopStockTx.id,
      plan: (d) => {
        expectFields(`stockTransactions/${amplopStockTx.id}`, d, {
          itemId: ITEM_ID,
          quantity: 1,
          unit: "pcs",
          originalQuantity: 1,
          originalUnit: "pcs",
          price: 500,
          costPrice: 130,
          lineCost: 130,
          stockWorth: 130,
          kreditAmount: 202500,
        });
        return {
          originalUnit: "pack",
          quantity: 100, // 1 pack = 100 smallest units (pcs)
          price: 15000,
          lineCost: 13000,
          stockWorth: 13000,
          kreditAmount: 217000,
          updatedAt: serverTimestamp(),
        };
      },
    },

    // --- 4. Other 4 Stock Transaction Lines (kreditAmount sync) ---
    ...stockTxDocs
      .filter((d) => d.id !== amplopStockTx.id)
      .map((stDoc) => ({
        collection: "stockTransactions",
        id: stDoc.id,
        plan: (d) => {
          expectFields(`stockTransactions/${stDoc.id}`, d, {
            kreditAmount: 202500,
          });
          return {
            kreditAmount: 217000,
            updatedAt: serverTimestamp(),
          };
        },
      })),

    // --- 5. Customer Voucher Record ---
    {
      collection: "vouchers",
      id: VOUCHER_ID,
      plan: (d) => {
        expectFields(`vouchers/${VOUCHER_ID}`, d, {
          value: 1000000,
          amountSpent: 202500,
          sisaSaldo: 797500,
          isClaimed: false,
          lastRedemptionTransactionId: TX_ID,
        });
        return {
          amountSpent: 217000,
          sisaSaldo: 783000,
          updatedAt: serverTimestamp(),
        };
      },
    },
  ];

  // Helper to read and prepare plans inside or outside a transaction
  const executePlan = async (transaction) => {
    const snaps = [];
    for (const t of targets) {
      const ref = doc(db, t.collection, t.id);
      const snap = await transaction.get(ref);
      if (!snap.exists()) {
        throw new Error(`Document ${t.collection}/${t.id} does not exist`);
      }
      snaps.push({ t, ref, data: snap.data() });
    }

    const records = [];
    const report = [];

    for (const { t, ref, data } of snaps) {
      const updates = t.plan(data);
      const original = {};
      const shown = [];

      for (const [field, val] of Object.entries(updates)) {
        if (field === "updatedAt") continue;
        if (sameValue(data[field], val)) continue;

        original[field] = data[field] !== undefined ? data[field] : null;

        if (field === "items") {
          const oldLine = data.items.find((i) => i.itemId === ITEM_ID);
          const newLine = val.find((i) => i.itemId === ITEM_ID);
          shown.push(
            `items: [${oldLine.itemName}] ${oldLine.quantity} ${oldLine.unit} @ Rp ${oldLine.price} (subtotal Rp ${oldLine.subtotal}) -> ${newLine.quantity} ${newLine.unit} @ Rp ${newLine.price} (subtotal Rp ${newLine.subtotal})`
          );
        } else {
          shown.push(`${field}: ${JSON.stringify(data[field])} -> ${JSON.stringify(val)}`);
        }
      }

      records.push({ collection: t.collection, id: t.id, original, updates, ref });
      report.push({ where: `${t.collection}/${t.id}`, shown });
    }

    return { records, report };
  };

  // Run planning read in transaction to verify expectations
  const planned = await runTransaction(db, executePlan);

  console.log("Planned modifications:\n");
  for (const r of planned.report) {
    console.log(`  ${r.where}`);
    for (const line of r.shown) {
      console.log(`    - ${line}`);
    }
  }

  console.log(`\nTotal documents to update: ${planned.records.length}`);

  if (!EXECUTE) {
    console.log("\n--------------------------------------------------------------------------------");
    console.log("DRY RUN COMPLETE: No data was modified.");
    console.log("To apply these changes, run:");
    console.log("  EXECUTE=true node scripts/fix_voucher_tx_20261117.js");
    console.log("--------------------------------------------------------------------------------\n");
    return;
  }

  // EXECUTE mode: atomic update in Firestore transaction + backup
  const backupFile = path.join(BACKUP_DIR, `fix_voucher_tx_${TX_ID}_${stamp}.json`);

  await runTransaction(db, async (transaction) => {
    const { records } = await executePlan(transaction);

    // Save pre-modification state
    save(backupFile, {
      at: new Date().toISOString(),
      transactionId: TX_ID,
      records: records.map(({ collection: c, id, original }) => ({
        collection: c,
        id,
        original,
      })),
    });

    for (const r of records) {
      transaction.update(r.ref, r.updates);
    }
  });

  console.log("\n================================================================================");
  console.log("SUCCESS: All updates committed atomically!");
  console.log(`Backup created at: ${backupFile}`);
  console.log("To undo, run:");
  console.log(`  RESTORE=${backupFile} node scripts/fix_voucher_tx_20261117.js`);
  console.log("================================================================================\n");
}

(RESTORE ? restore(RESTORE) : run())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  });
