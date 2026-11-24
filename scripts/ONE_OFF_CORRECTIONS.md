# One-off corrections of past POS sales

Runbook for AI agents (and people) who fix a past sale that was rung up wrong, by writing a one-off script against production Firestore.

The reference implementation is `scripts/fix_voucher_tx_20261124.js` (a voucher sale whose basket was wrong, fixed in place, with the cash-flow closings refreshed). Copy its structure, not its numbers.

Read the whole file before touching production data.

---

## 1. Hard rules

1. **This writes to production.** The scripts use the Firebase client SDK against project `koperasi-unipdu` with the same public web config as the existing scripts. They do not sign in. Production collection names have no suffix. `src/firebase.js` adds `_testing` only when `isProduction` is false.
2. **Get explicit approval before `EXECUTE=true`.** In chat, confirm the transaction ID, the corrected basket (item, unit, quantity), the price per unit you will use, the payment split (voucher, cash, QRIS), and whether the fix is in place (the default) or a re-ring. A dry-run output is not approval.
3. **Dry-run first, every time.** Show the dry-run plan to the user before applying.
4. **Correct in place by default.** Keep the transaction ID and the sale time. Never change `createdAt`, `timestamp` or `timestampInMillisEpoch` on an existing document, because Penjualan rows and stock history are built from them. Do not use the app's delete button (`deleteAndRevertTransaction`) for a correction unless the user asks for a re-ring. Re-ringing gives a new ID and the current time.
5. **Stop and ask the user, do not script around it, when any of these hold:**
   - The sale's month has `cashflowSettings/{YYYY-MM}.closingFinal === true`. Changing it changes a closed month and the next month's opening.
   - Another sale used the same voucher after this one (`transactionDetail where voucherId == X`). Their `voucherBalanceBefore/After` chain would need recalculating. The template does not handle this.
   - The voucher is single-use (`isOneTimeUse !== false`) or has `type` `cashbackCampaign`. Its redemption rules differ.
   - The corrected total is not fully covered by the voucher. The template aborts on this. The cash/QRIS split is the user's decision.
   - The member earned campaign points (IN_PROGRESS vouchers with `userPoints`). Points are based on the payable amount, and the app does not re-run accrual when a sale is edited.
   - The stock is not enough for the new quantity, or a line would need a discrepancy flag.
   - The sale is on a day with a submitted Laporan Harian (`dailyFinancialReports/{date}` with `submittedBy` or `submittedAt`, per `isReportSubmitted` in `src/utils/cashflowUtils.js`). Its sales and Selisih will change. Tell the user first.
6. **Leave the user's own files alone.** Do not edit or delete `scripts/fix_voucher_tx_20261117.js` or other untracked scripts. Do not commit anything unless asked. Backups in `scripts/backups/` are gitignored. Keep them that way.

---

## 2. Facts about the data (checked in the code)

Only `src/components/Transaksi.js` is the live sale screen (it is exported from `src/components/index.js`). `src/components/TransaksiRefactored.js` is not imported anywhere. Its sale path, `processTransaction` in `src/services/transactionService.js`, writes no voucher or kredit fields. Do not copy its shape for member or voucher sales.

The complete list of what a sale touches is the inverse in `src/services/transactionRevertService.js`. Use it as a checklist.

### transactionDetail/{saleId}

- `items[]`: `{ itemId, itemName, quantity, unit, price, subtotal }`. `itemId` is the stock document ID. `unit` is what was typed at the till (`pcs`, `pack`, `rim`, ...).
- `total`: basket total **before** the voucher.
- Voucher fields (set only when a voucher was used): `voucherId`, `voucherName`, `voucherGroupId`, `voucherDiscount`, `voucherBalanceBefore`, `voucherBalanceAfter`, `discountedTotal`.
- `kreditAmount`: the voucher portion, `min(voucher balance before, total)`.
- `discountedTotal`: what is payable after the voucher. It should equal `cashAmount + qrisAmount`.
- `cashAmount`, `qrisAmount`, `paymentMethod` (`cash`, `qris`, `kredit`, ...), `isPaidViaQris`, `amountPaid`, `change`, `userPoints`.
- Member fields: `isMember`, `userId`, `nomorAnggota`, `memberName`. `createdBy` is the cashier's email.
- Time fields: `createdAt`, `timestamp`, `timestampInMillisEpoch` (sale time), `updatedAt`.

### stockTransactions (one document per sale line)

- `transactionId`, `itemId`, `itemName`, `kategori`, `subKategori`, `isDeleted: false`, `transactionType: "penjualan"`, `transactionVia: "pointOfSales"`, `isStockDiscrepant`.
- `quantity` and `unit` are in the **smallest unit** (`pcs`, from the stock's `smallestUnit`). `originalQuantity` and `originalUnit` are what was typed.
- `price` is per typed unit. `costPrice` is the unit cost rounded to a whole rupiah per smallest unit. `lineCost` and `stockWorth` are whole rupiah.
- The payment fields (`kreditAmount`, `cashAmount`, `qrisAmount`, `paymentMethod`, `isPaidViaQris`) are copied onto **every** line of the sale. When the payment split changes, update all lines.
- Member fields and time fields are copied from the sale.

### stocks/{itemId}

- `stock` (smallest units), `stockValue` (rupiah), `lastPurchasePrice`, `pricePerUnit` (unit → price), `satuan` (allowed units), `smallestUnit`, `base_unit`, `bulk_unit_name`, `bulk_unit_conversion` (falls back to `piecesPerBox`), `name`, `kategori`, `subKategori`, `updatedAt`.
- The sale screen writes through `updateDoc` from `useFirestore()`, which is `updateDoc_` in `src/context/FirestoreContext.js`. It stamps `updatedAt` on every write. If a stock document's `updatedAt` equals the sale time, nothing else has moved that stock since the sale. Its current values are then the sale-time state.

### Quantities, prices, costs

- **Quantity:** if the typed unit equals `bulk_unit_name`, smallest units = `quantity × bulk_unit_conversion`. Other units go through `convertToSmallestUnit` and `CONVERSION_TABLE` in `src/utils/transaksiUtils.js`.
- **Price:** `getPriceAndSubtotal` in `src/utils/transaksiUtils.js`. For a non-base unit, price = `pricePerUnit[unit]` and subtotal = price × quantity. The base unit can switch to a bulk price when quantity ≥ conversion. Check that before you use a base-unit price.
- **Unit cost:** `getUnitCost` in `src/utils/profitUtils.js`. It is `stockValue / stock` when both are > 0, otherwise `lastPurchasePrice`. A sale removes `unitCost × quantity` from `stockValue`, so the average does not change on a sale.
- **Rounding:** `roundRupiah` is `Math.round`. The POS rounds stock value and line cost separately, so a 1-rupiah gap between them is normal.

### Vouchers

- Multi-use (`isOneTimeUse === false`): `amountSpent` accumulates. `sisaSaldo = value − amountSpent`. `isClaimed = sisaSaldo <= 0`. `lastRedemptionTransactionId` should be the sale.
- Discount: `min(balance before, total)`. Balance before the sale = `value − amountSpent before the sale` (`buildVoucherRedemption` in `src/utils/voucherBalance.js`).
- Redeeming a voucher does not touch the voucher group.

### Cash-flow ledger (Laporan Arus Kas)

- The Finance page computes the ledger live: `cashflowService.fetchMonthData(month)` then `buildCashflowRows(data)` (`src/components/Finance.js`, `src/utils/cashflowUtils.js`). Sales are read live from `transactionDetail`, split by `getPaymentBreakdown`: kredit = `kreditAmount`, qris = `qrisAmount`, cash = `cashAmount`, or payable − qris if missing. **Correcting a sale changes the live Laporan Arus Kas with no further write.**
- Stored values go stale and need a refresh:
  - `cashflowSettings/{YYYY-MM}`: `closingCash`, `closingQris`, `closingKredit`, `closingFinal`, `closingSyncedAt`.
  - `dailyFinancialReports/{YYYY-MM-DD}`: `closing*`, and for a submitted report also `systemSales*`, `transactionCount` and the `discrepancy` fields.
- Refresh with `cashflowService.updateDailyReportSales(dateKey, true)`. It is the call the app's delete-and-revert makes after removing a sale. For a submitted report it recomputes the sales and the discrepancy. Then it calls `syncClosingsFrom([dateKey])`, which re-syncs **every month from the sale's month to the current month, closed or not**, and writes their closings. A correction in a closed month therefore changes its closing. That is why rule 5 asks.
- A refresh can also pick up other sales that the stored closing had not yet included. Say so to the user.

### Stock snapshots

- `createDailyStockSnapshot` in `functions/index.js` writes `stockSnapshots/{date}` at 23:50 Jakarta time from the live `stocks`. Past snapshots are never rewritten, so a correction to an earlier sale will not appear in the snapshots of later days. Tell the user. A snapshot not yet written (the current day's, before 23:50) will include the correction.

---

## 3. Running the app's cash-flow code from Node

`cashflowService.js` cannot be imported by Node directly. It uses extensionless ESM imports, and `src/firebase.js` calls browser-only Analytics. The method used for 24 Nov 2026 works. It uses scratch files only, never committed.

1. Create a scratch folder outside the repo, and `ln -s <repo>/node_modules node_modules` inside it.
2. Copy `src/services/cashflowService.js` to `cashflowService.mjs` and `src/utils/cashflowUtils.js` to `cashflowUtils.mjs`. In the copy, change the three import specifiers: `"../firebase"` → `"./firebase_shim.mjs"`, `"../utils/cashflowUtils"` → `"./cashflowUtils.mjs"`. Confirm with `grep`.
3. Write `firebase_shim.mjs`. It calls `initializeApp` with the same config as the existing scripts and `getFirestore`. It exports `db`, `getEnvironmentCollectionPath`, `getEnvironmentCollection` and `getEnvironmentDoc`, using the same rule as `src/firebase.js`: names in `users`, `settings` and `stockSnapshots` are never suffixed, and other names get `_testing` only when `isProduction` is false.
4. Write small `.mjs` entry scripts in the scratch folder and run them with `node`.
   - Read-only ledger: `cashflowService.fetchMonthData(month, true)`, then `buildCashflowRows(data)`. Take this snapshot **before** and **after** the change.
   - Refresh: `cashflowService.updateDailyReportSales(dateKey, true)`.

---

## 4. Procedure

1. **Get the facts from the user.** Transaction ID, or member + date + time. The corrected basket with units and quantities. The price per unit if it is not the standard POS price. The payment split. In place, or re-ring.
2. **Find the sale (read-only).** Query `transactionDetail` by day, using `createdAt >= new Date(y, m-1, d)` and `< the next day`. This is the same query as `fetchTransactionsForDate`. Match `memberName`, `nomorAnggota`, `total`, and the time in the ID (`YYYYMMDD-HHMMSS-XXX`, local time). List every sale that day and confirm there is exactly one match.
3. **Gather everything the sale touches (read-only).**
   - The transaction.
   - `stockTransactions where transactionId == id`. Expect one document per line.
   - Each stock document, and its `updatedAt` compared with the sale time.
   - The voucher document, and `transactionDetail where voucherId == X`.
   - `cashflowSettings/{month}` (with `closingFinal`).
   - `dailyFinancialReports/{date}` (is it submitted?).
4. **Check the stop conditions** in section 1, rule 5. If any applies, ask the user.
5. **Compute the corrected values** with the rules in section 2. For every document, write down before → after. Include the sale's profit (`total − Σ lineCost`) and the voucher's remaining balance.
6. **Confirm in chat.** Show the table of changes, the new total, the payment split, the profit change and the cash-flow effect. Wait for an explicit yes.
7. **Write the script** from the template in section 5. Run the dry-run with `node scripts/<name>.js` and show the output.
8. **Apply** with `EXECUTE=true node scripts/<name>.js`. The script saves the backup first, writes everything in one transaction, and reads the result back.
9. **Refresh the cash flow** for the sale's date with `updateDailyReportSales` (section 3). Only after step 8 succeeds.
10. **Verify.**
    - Read every changed document again.
    - The stored `cashflowSettings` closing for the month must equal the live ledger.
    - Closings for days before the sale must be unchanged. Compare with the snapshot from before step 8.
    - The day's sales summary must show the new kredit, cash and QRIS.
11. **Report to the user.** Before and after numbers, the backup path, the undo command, what you did not verify in the app's screens, and your assumptions. Ask before committing.

---

## 5. Script template

Copy `scripts/fix_voucher_tx_20261124.js`, and keep these conventions:

- **Header comment:** the problem, the corrected values, the impacted data, the cash-flow note and the usage (dry-run, `EXECUTE=true`, `RESTORE=`).
- **Setup:** `initializeApp` with the same config as the existing scripts. Dry-run by default. Apply only when `EXECUTE === "true"`.
- **Preconditions:** `expectFields` on every document you read, using the values you checked. Compare item lines field by field, never as JSON, because key order differs. Abort on any mismatch.
- **Recompute, do not hardcode:** derive totals, discounts, stock and costs from the rules in section 2.
- **`planUpdate` helper:** write only the fields that change, save their originals, and stamp `updatedAt: serverTimestamp()`.
- **New stock lines:** generate the document ID before the transaction. Copy the time fields, `createdBy` and the member fields from an existing line of the same sale. Record `kind: "create"`.
- **Transaction shape:** read everything first, then write, inside one `runTransaction`. Queries cannot run inside a Firestore transaction, so run them first and pass the IDs in.
- **Backup:** save it inside the transaction callback, before the first write. Include the stored cash-flow closings you are about to refresh, so an undo covers them.
- **Backup format:** `{ at, transactionId, records: [{ kind: "update" | "create", collection, id, original }] }`. `original` maps field → old value. `null` means the field did not exist. Timestamps are stored as `{ __timestamp: ISO }`.
- **RESTORE:** a batch `update`, with `null` → `deleteField()`. `create` records are batch-deleted. Revive Timestamps with `Timestamp.fromDate`.

---

## 6. Pitfalls already hit

- **zsh expands unquoted globs.** Quote them: `grep --include='*.js'`.
- **Run scripts from the repo root.** A scratch script that needs `firebase` needs `NODE_PATH=<repo>/node_modules`.
- **Do not import `src/firebase.js` into Node.** It calls browser Analytics. Use the shim from section 3.
- **Floating-point rounding.** `Math.round(41928.5)` and a value just below .5 can round differently. Compute with the same expression the app uses (`stockValue / stock * quantity`), not your own arithmetic.
- **Firestore client transactions reject queries.** Do reads before writes.
- **Stored closings may already be stale before your change.** The refresh also brings in other sales from those days. Say so.
- **Negative ledger balances may already exist.** QRIS was negative for November 2026 before the 24 Nov fix. Report them. Do not fix them as part of a correction.
- **No sign-in and no rules file in the repo.** The scripts write without signing in, which means the live Firestore rules allow unauthenticated writes. The rules are not in this repository, so check them before using a new kind of write.

---

## 7. Precedents

- `scripts/fix_voucher_tx_20261124.js`: a basket correction on a voucher sale, with a new stock line and a cash-flow refresh. **Use as the template.**
- `scripts/fix_voucher_tx_20261117.js`: a unit correction on a voucher sale. Untracked, and belongs to the user. Do not modify.
- `scripts/fix_nota_20261104_units.js`: a purchase-nota unit correction. Committed.
- `scripts/fix_cost_basis_three_items.js`: a cost-basis correction for three items. Committed.
