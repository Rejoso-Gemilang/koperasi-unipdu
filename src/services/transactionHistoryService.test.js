import {
  formatCurrency,
  groupTransactionsByItem,
} from "./transactionHistoryService";

describe("formatCurrency", () => {
  test.each([
    [313500, "Rp 313.500"],
    [-1222866, "-Rp 1.222.866"],
    [-0.4, "Rp 0"],
    [0, "Rp 0"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatCurrency(value)).toBe(expected);
  });
});

describe("transaction history profit totals", () => {
  test("costs every sold Kanzler Hot unit when recorded inventory was empty", () => {
    // Production sale on 2 November: seven units sold while recorded stock
    // was empty. stockWorth tracks the inventory reduction, not sale cost.
    const result = groupTransactionsByItem(
      [
        {
          itemId: "Sosis_Kanzler_Hot_8993200345717",
          itemName: "Sosis Kanzler Hot",
          unit: "pcs",
          quantity: 7,
          price: 8500,
          costPrice: 7032,
          stockWorth: 0,
          isStockDiscrepant: true,
          timestampInMillisEpoch: {
            toDate: () => new Date("2026-11-02T05:05:35.989Z"),
          },
        },
      ],
      {
        Sosis_Kanzler_Hot_8993200345717: {
          stock: 4,
          stockValue: 28132,
          lastPurchasePrice: 7033,
        },
      }
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        revenue: 59500,
        stockWorth: 49224,
        profitMargin: 10276,
      })
    );
  });

  test("uses the stock purchase price when a legacy sale has no usable cost", () => {
    const result = groupTransactionsByItem(
      [
        {
          itemId: "le-mineral-600ml",
          itemName: "Le Mineral 600ml",
          unit: "pcs",
          quantity: 2,
          price: 3000,
          stockWorth: Number.NaN,
          timestampInMillisEpoch: { toDate: () => new Date() },
        },
      ],
      {
        "le-mineral-600ml": {
          stock: 0,
          stockValue: 0,
          lastPurchasePrice: 2000,
        },
      }
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        revenue: 6000,
        stockWorth: 4000,
        profitMargin: 2000,
      })
    );
  });
});
