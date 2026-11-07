import {
  STOCK_CORRECTION_VIA,
  getTransactionCost,
  isStockCorrection,
  hasDecimalSeparator,
  keepDigits,
  parseWholeNumber,
  planStockCorrection,
  summarizeMonthlyStock,
  withoutCorrectionCost,
} from "./stockTransactionUtils";

const day = (iso) => ({ toDate: () => new Date(iso) });
const FIRST = new Date("2026-10-01T00:00:00");
const LAST = new Date("2026-10-31T23:59:59");

describe("stock corrections carry no money", () => {
  const correction = { transactionVia: STOCK_CORRECTION_VIA, transactionType: "pengurangan", cost: 75000 };
  const purchase = { transactionVia: "bulkPurchase", transactionType: "pengadaan", cost: 120000 };

  test("recognises Tetapkan Stok records", () => {
    expect(STOCK_CORRECTION_VIA).toBe("stockSetTo");
    expect(isStockCorrection(correction)).toBe(true);
    expect(isStockCorrection(purchase)).toBe(false);
    expect(isStockCorrection(undefined)).toBe(false);
  });

  test("a correction is worth 0 even when it was saved with a cost", () => {
    expect(getTransactionCost(correction)).toBe(0);
  });

  test("other transactions keep their cost", () => {
    expect(getTransactionCost(purchase)).toBe(120000);
    expect(getTransactionCost({ cost: "5000" })).toBe(5000);
    expect(getTransactionCost({})).toBe(0);
    expect(getTransactionCost({ cost: "abc" })).toBe(0);
  });

  test("withoutCorrectionCost zeroes corrections and leaves everything else untouched", () => {
    expect(withoutCorrectionCost(correction)).toEqual({ ...correction, cost: 0 });
    expect(withoutCorrectionCost(correction)).not.toBe(correction);
    expect(withoutCorrectionCost(purchase)).toBe(purchase);
  });
});

describe("planStockCorrection", () => {
  const product = { stock: 10, stockValue: 5000 }; // Rp 500 per unit

  test("keeps the unit cost, so the value follows the new quantity", () => {
    expect(planStockCorrection(product, 40)).toMatchObject({ newValue: 20000, deltaStock: 30 });
    expect(planStockCorrection(product, 4)).toMatchObject({ newValue: 2000, deltaStock: -6 });
  });

  test("records the direction and size of the change, nothing about money", () => {
    expect(planStockCorrection(product, 25)).toEqual({
      deltaStock: 15,
      isUnchanged: false,
      newValue: 12500,
      transactionType: "pengadaan",
      quantity: 15,
    });
    expect(planStockCorrection(product, 3)).toMatchObject({
      transactionType: "pengurangan",
      quantity: 7,
    });
  });

  test("flags an unchanged quantity regardless of value drift", () => {
    expect(planStockCorrection({ stock: 10, stockValue: 9999 }, 10).isUnchanged).toBe(true);
  });

  test("falls back to the last purchase price when there is no stock value", () => {
    expect(planStockCorrection({ stock: 0, stockValue: 0, lastPurchasePrice: 300 }, 5).newValue).toBe(1500);
  });

  test("falls back to the warehouse cost price", () => {
    expect(planStockCorrection({ stock: 0, stockValue: 0, cost_price: 800 }, 5).newValue).toBe(4000);
  });

  test("a product with no cost information is valued at 0 rather than NaN", () => {
    expect(planStockCorrection({ stock: 0 }, 5).newValue).toBe(0);
    expect(planStockCorrection({}, 5).newValue).toBe(0);
  });

  test("setting stock to 0 empties the value", () => {
    expect(planStockCorrection(product, 0)).toMatchObject({ newValue: 0, transactionType: "pengurangan", quantity: 10 });
  });
});

describe("summarizeMonthlyStock", () => {
  const transactions = [
    { transactionType: "pengadaan", transactionVia: "bulkPurchase", cost: 100000, timestampInMillisEpoch: day("2026-10-05") },
    { transactionType: "pengadaan", transactionVia: "stockAddition", cost: 20000, timestampInMillisEpoch: day("2026-10-06") },
    { transactionType: "penjualan", price: 50000, timestampInMillisEpoch: day("2026-10-07") },
    { transactionType: "pengurangan", transactionVia: "stockDeletion", cost: 15000, timestampInMillisEpoch: day("2026-10-08") },
    // Tetapkan Stok, saved with a cost by an older version: must count for nothing
    { transactionType: "pengadaan", transactionVia: "stockSetTo", cost: 999000, timestampInMillisEpoch: day("2026-10-09") },
    { transactionType: "pengurangan", transactionVia: "stockSetTo", cost: 888000, timestampInMillisEpoch: day("2026-10-09") },
    // Outside the month
    { transactionType: "pengadaan", transactionVia: "bulkPurchase", cost: 777000, timestampInMillisEpoch: day("2026-09-30") },
    // No usable date
    { transactionType: "pengadaan", cost: 666000 },
  ];

  test("totals purchases, sales and missing stock without counting corrections", () => {
    expect(summarizeMonthlyStock(transactions, FIRST, LAST)).toEqual({
      monthlyPurchase: 120000,
      monthlySales: 50000,
      missingStock: 15000,
    });
  });

  test("handles an empty or missing list", () => {
    const empty = { monthlyPurchase: 0, monthlySales: 0, missingStock: 0 };
    expect(summarizeMonthlyStock([], FIRST, LAST)).toEqual(empty);
    expect(summarizeMonthlyStock(undefined, FIRST, LAST)).toEqual(empty);
  });
});

describe("whole-number stock quantities", () => {
  test.each([
    ["5", 5],
    ["0", 0],
    ["007", 7],
    [" 12 ", 12],
  ])("reads %p as %p", (typed, expected) => {
    expect(parseWholeNumber(typed)).toBe(expected);
  });

  test.each(["", ",", ".", "0,5", "0.5", "2,", "1.500", "-4", "abc", null, undefined])(
    "does not accept %p",
    (typed) => {
      expect(parseWholeNumber(typed)).toBeNaN();
    }
  );

  test.each([
    ["0,5", true],
    ["0.5", true],
    ["1.500", true],
    ["15", false],
    ["", false],
    [null, false],
  ])("a decimal separator in %p is %p", (typed, found) => {
    expect(hasDecimalSeparator(typed)).toBe(found);
  });

  test("keeps only the digits", () => {
    expect(keepDigits("1a2b")).toBe("12");
    expect(keepDigits("-4")).toBe("4");
    expect(keepDigits(null)).toBe("");
  });
});
