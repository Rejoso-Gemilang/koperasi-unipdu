const {
  planStockRecord,
  findNotes,
} = require("../../scripts/lib/stockDecimalCleanup");

describe("planStockRecord", () => {
  test("leaves a whole record alone", () => {
    expect(
      planStockRecord({
        stock: 10,
        stockValue: 28000,
        lastPurchasePrice: 2800,
        pricePerUnit: { pcs: 3500, dus: 40000 },
      })
    ).toBeNull();
  });

  test("rounds money to the nearest whole rupiah", () => {
    const plan = planStockRecord({
      stock: 3,
      stockValue: 10000.4,
      lastPurchasePrice: 3333.5,
      cost_price: 6666.67,
      price: 7000.49,
    });

    expect(plan.updates).toEqual({
      stockValue: 10000,
      lastPurchasePrice: 3334,
      cost_price: 6667,
      price: 7000,
    });
  });

  test("rounds rounding noise in a stock quantity", () => {
    expect(planStockRecord({ stock: 18.998, stockValue: 5000 }).updates).toEqual({ stock: 19 });
    expect(planStockRecord({ stock: 114.975, stockValue: 5000 }).updates).toEqual({ stock: 115 });
    expect(planStockRecord({ stock: 6.0000001, stockValue: 5000 }).updates).toEqual({ stock: 6 });
  });

  test("leaves a real fraction of stock alone, as rounding 0.5 to 1 doubles it", () => {
    expect(planStockRecord({ stock: 0.5, stockValue: 5000 })).toBeNull();
    expect(planStockRecord({ stock: 1.5, stockValue: 5000 })).toBeNull();
    expect(planStockRecord({ stock: 2.4, stockValue: 5000 })).toBeNull();
  });

  test("rounds every fraction when asked to", () => {
    const all = { stockTolerance: Infinity };
    expect(planStockRecord({ stock: 2.5, stockValue: 5000 }, all).updates).toEqual({ stock: 3 });
    expect(planStockRecord({ stock: 2.4, stockValue: 5000 }, all).updates).toEqual({ stock: 2 });
  });

  test("rounds prices per unit and writes the whole map back", () => {
    const plan = planStockRecord({
      stock: 4,
      stockValue: 4000,
      pricePerUnit: { pcs: 1500.5, dus: 18000 },
    });

    expect(plan.updates).toEqual({ pricePerUnit: { pcs: 1501, dus: 18000 } });
    expect(plan.changes).toEqual([{ field: "pricePerUnit.pcs", from: 1500.5, to: 1501 }]);
  });

  test("a stock that rounds down to nothing holds no value", () => {
    const plan = planStockRecord({ stock: 0.04, stockValue: 3000 });

    expect(plan.updates).toEqual({ stock: 0, stockValue: 0 });
    expect(plan.changes).toContainEqual({
      field: "stockValue",
      from: 3000,
      to: 0,
      reason: "stock rounded to 0",
    });
  });

  test("a stock that was already 0 keeps what it has (only reported)", () => {
    expect(planStockRecord({ stock: 0, stockValue: 3000 })).toBeNull();
  });

  test("never writes a negative zero", () => {
    const plan = planStockRecord({ stock: -0.02, stockValue: 0 });

    expect(Object.is(plan.updates.stock, 0)).toBe(true);
  });

  test("ignores fields that are missing, null or not numbers", () => {
    expect(
      planStockRecord({ stock: null, stockValue: "abc", price: undefined, pricePerUnit: { pcs: null } })
    ).toBeNull();
  });
});

describe("findNotes", () => {
  test("reports stock without a quantity that still holds a value", () => {
    expect(findNotes({ stock: 0, stockValue: 3000 })).toEqual([
      { kind: "zero-stock-with-value", message: "stock is 0 but stockValue is 3000" },
    ]);
  });

  test("reports a real fraction of stock, but not rounding noise", () => {
    expect(findNotes({ stock: 0.5 })).toEqual([
      {
        kind: "fractional-stock",
        message: "stock is 0.5; rounding would make it 1, which is a real change, not rounding noise",
      },
    ]);
    expect(findNotes({ stock: 18.998 })).toEqual([]);
    expect(findNotes({ stock: 0.5 }, { stockTolerance: Infinity })).toEqual([]);
  });

  test("reports numbers that are not numbers and decimal conversions", () => {
    const kinds = findNotes({
      stock: NaN,
      stockValue: "12",
      bulk_unit_conversion: 12.5,
    }).map((note) => note.kind);

    expect(kinds).toEqual(["not-a-number", "not-a-number", "decimal-conversion"]);
  });

  test("has nothing to say about a healthy record", () => {
    expect(findNotes({ stock: 5, stockValue: 5000, lastPurchasePrice: 1000 })).toEqual([]);
  });
});
