// src/utils/stockTransactionUtils.js
//
// Money rules for stock transactions.
//
// "Tetapkan Stok" (set stock) fixes a quantity that was entered wrongly in the
// past. It is not a purchase and not a loss, so it never carries money and is
// never counted in purchase or missing-stock totals.
import { getUnitCost, toFiniteNumber } from "./profitUtils";

// Stock quantities are whole numbers: no kg with a comma, no half pieces.
// A field that holds one refuses a decimal separator (a comma or a dot)
// instead of quietly dropping it, which would turn "0,5" into 5.
export const WHOLE_NUMBER_MESSAGE = "Jumlah harus bilangan bulat (tanpa desimal)";

export const hasDecimalSeparator = (typed) => /[.,]/.test(String(typed ?? ""));

// What a whole-number field keeps of what was typed or pasted.
export const keepDigits = (typed) => String(typed ?? "").replace(/\D/g, "");

// The number in a whole-number field, or NaN when it is empty, has a decimal
// part, or is not a number at all.
export const parseWholeNumber = (value) => {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? parseInt(text, 10) : NaN;
};

// transactionVia written by the Tetapkan Stok dialogs.
export const STOCK_CORRECTION_VIA = "stockSetTo";

export const isStockCorrection = (transaction) =>
  transaction?.transactionVia === STOCK_CORRECTION_VIA;

// Money a stock transaction represents. Corrections are always 0, including
// ones saved before this rule that still carry a cost.
export const getTransactionCost = (transaction) =>
  isStockCorrection(transaction) ? 0 : toFiniteNumber(transaction?.cost) ?? 0;

// Copy of the transaction with its money set to what getTransactionCost says,
// for screens that list and total stock transactions.
export const withoutCorrectionCost = (transaction) =>
  isStockCorrection(transaction) ? { ...transaction, cost: 0 } : transaction;

// What Tetapkan Stok does to a product. Only the quantity is edited: the unit
// cost stays what it is (weighted average, then last purchase price, then the
// warehouse cost_price), so the stored total value just follows the new
// quantity and unit-cost based profit stays correct. The value moves with the
// quantity, but it is not recorded as money spent or lost.
export const planStockCorrection = (product, newStock) => {
  const oldStock = toFiniteNumber(product?.stock) ?? 0;
  const unitCost = getUnitCost(product) || toFiniteNumber(product?.cost_price) || 0;
  const deltaStock = newStock - oldStock;

  return {
    deltaStock,
    isUnchanged: deltaStock === 0,
    newValue: Math.round(newStock * unitCost),
    // Direction of the quantity change only, not a purchase or a loss.
    transactionType: deltaStock >= 0 ? "pengadaan" : "pengurangan",
    quantity: Math.abs(deltaStock),
  };
};

// Purchase, sales and missing-stock totals for the month shown on the stock
// pages. Corrections count for none of them.
export const summarizeMonthlyStock = (transactions = [], firstDay, lastDay) => {
  const totals = { monthlyPurchase: 0, monthlySales: 0, missingStock: 0 };

  for (const item of transactions) {
    const txDate = item.timestampInMillisEpoch?.toDate?.();
    if (!txDate || txDate < firstDay || txDate > lastDay) continue;

    switch (item.transactionType) {
      case "pengadaan":
        totals.monthlyPurchase += getTransactionCost(item);
        break;
      case "penjualan":
        totals.monthlySales += item.price || 0;
        break;
      case "pengurangan":
        totals.missingStock += getTransactionCost(item);
        break;
      default:
        break;
    }
  }

  return totals;
};
