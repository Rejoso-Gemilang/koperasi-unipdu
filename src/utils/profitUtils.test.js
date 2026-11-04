import {
  calculateSaleProfit,
  getSaleCost,
  getUnitCost,
} from "./profitUtils";

describe("profit calculations", () => {
  test("falls back to the displayed purchase price when stock is empty", () => {
    expect(
      getUnitCost({ stock: 0, stockValue: 0, lastPurchasePrice: 2000 })
    ).toBe(2000);
  });

  test("uses a valid weighted stock value when available", () => {
    expect(
      getUnitCost({ stock: 10, stockValue: 20000, lastPurchasePrice: 2500 })
    ).toBe(2000);
  });

  test("resolves a legacy sale with an invalid stored cost", () => {
    const cost = getSaleCost(
      { quantity: 2, stockWorth: Number.NaN },
      { stock: 0, stockValue: 0, lastPurchasePrice: 2000 },
      2
    );

    expect(cost).toBe(4000);
    expect(calculateSaleProfit(6000, cost)).toBe(2000);
  });

  test("preserves an explicit zero-cost snapshot", () => {
    expect(
      getSaleCost(
        { quantity: 2, costPrice: 0, stockWorth: 0 },
        { lastPurchasePrice: 2000 },
        2
      )
    ).toBe(0);
  });

  test.each([0, 14064])(
    "costs all sold units when a stock discrepancy deducted inventory worth %s",
    (stockWorth) => {
      const sale = {
        quantity: 7,
        costPrice: 7032,
        stockWorth,
        isStockDiscrepant: true,
      };

      expect(getSaleCost(sale, { lastPurchasePrice: 7033 }, 7)).toBe(49224);
      // Display calculations must preserve the inventory deduction for reverts.
      expect(sale.stockWorth).toBe(stockWorth);
    }
  );

  test("uses a costPerUnit snapshot and the supplied quantity", () => {
    expect(
      getSaleCost({ costPerUnit: 7032, stockWorth: 0 }, {}, 7)
    ).toBe(49224);
  });

  test("preserves a legacy positive cost when no unit cost was saved", () => {
    expect(
      getSaleCost(
        { quantity: 7, stockWorth: 49000 },
        { lastPurchasePrice: 7033 },
        7
      )
    ).toBe(49000);
  });

  test.each([null, undefined, Number.NaN])(
    "does not treat an invalid cost snapshot (%s) as an explicit zero cost",
    (costPrice) => {
      expect(
        getSaleCost(
          { quantity: 7, costPrice, stockWorth: 0 },
          { lastPurchasePrice: 7033 },
          7
        )
      ).toBe(49231);
    }
  );
});
