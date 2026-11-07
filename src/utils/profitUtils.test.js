import {
  calculateSaleProfit,
  getSaleCost,
  getUnitCost,
  roundRupiah,
} from "./profitUtils";

describe("roundRupiah", () => {
  test.each([
    [3333.33, 3333],
    [6666.67, 6667],
    [10.5, 11],
    [10.49, 10],
    [7, 7],
    [-0.4, 0],
    ["8332.5", 8333],
  ])("rounds %p to the nearest whole rupiah, %p", (value, expected) => {
    expect(roundRupiah(value)).toBe(expected);
  });

  test.each([null, undefined, "", "abc", NaN, Infinity])(
    "turns %p into 0",
    (value) => {
      expect(roundRupiah(value)).toBe(0);
    }
  );
});

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

describe("lineCost", () => {
  test("is the cost of the line, whatever the rounded unit cost times the quantity says", () => {
    // 500 g at 16.5 per gram: costPrice is saved as 17, which would say 8500
    const sale = { quantity: 500, costPrice: 17, lineCost: 8250 };

    expect(getSaleCost(sale, {}, 500)).toBe(8250);
  });

  test("is used even when the stock record was short and stockWorth is 0", () => {
    expect(
      getSaleCost({ quantity: 7, costPrice: 7033, lineCost: 49231, stockWorth: 0 }, {}, 7)
    ).toBe(49231);
  });

  test("a sale saved before lineCost existed is costed as before", () => {
    expect(getSaleCost({ quantity: 7, costPrice: 7032, stockWorth: 0 }, {}, 7)).toBe(49224);
  });

  test.each([null, undefined, Number.NaN, -1])(
    "an unusable lineCost (%s) falls back to the unit cost",
    (lineCost) => {
      expect(getSaleCost({ quantity: 2, costPrice: 1000, lineCost }, {}, 2)).toBe(2000);
    }
  );
});

