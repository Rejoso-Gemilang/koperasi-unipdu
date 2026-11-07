import { findCostAboveSellingPrice } from "./purchaseChecks";

describe("findCostAboveSellingPrice", () => {
  test("flags the amplop bought as 28 pcs instead of 28 packs", () => {
    // 364.000 for 28 pcs is Rp 13.000 each, for an amplop that sells at Rp 500
    expect(
      findCostAboveSellingPrice([
        { name: "Amplop Paperline 95x152 Mm", unit: "pcs", sellPrice: 500, subtotal: 364000, quantityInSmallestUnit: 28 },
      ])
    ).toEqual([{ name: "Amplop Paperline 95x152 Mm", unit: "pcs", sellPrice: 500, costPrice: 13000 }]);
  });

  test("the same purchase in packs is fine: 28 packs is 2800 pcs at Rp 130 each", () => {
    expect(
      findCostAboveSellingPrice([
        { name: "Amplop Paperline 95x152 Mm", unit: "pcs", sellPrice: 500, subtotal: 364000, quantityInSmallestUnit: 2800 },
      ])
    ).toEqual([]);
  });

  test("flags the dozen of clips bought as 1 pcs, and only that line", () => {
    const flagged = findCostAboveSellingPrice([
      { name: "Binder Clip 25mm", unit: "pcs", sellPrice: 500, subtotal: 3500, quantityInSmallestUnit: 1 },
      { name: "Map Kertas", unit: "pcs", sellPrice: 600, subtotal: 20000, quantityInSmallestUnit: 50 },
    ]);

    expect(flagged.map((line) => line.name)).toEqual(["Binder Clip 25mm"]);
    expect(flagged[0].costPrice).toBe(3500);
  });

  test("buying at exactly the selling price is not flagged", () => {
    expect(
      findCostAboveSellingPrice([
        { name: "Pulpen", unit: "pcs", sellPrice: 2000, subtotal: 20000, quantityInSmallestUnit: 10 },
      ])
    ).toEqual([]);
  });

  test.each([
    ["no selling price set", { sellPrice: 0 }],
    ["a missing selling price", { sellPrice: undefined }],
    ["no quantity", { quantityInSmallestUnit: 0 }],
    ["a conversion that failed", { quantityInSmallestUnit: NaN }],
    ["no subtotal", { subtotal: 0 }],
  ])("has nothing to compare with when there is %s", (_, override) => {
    expect(
      findCostAboveSellingPrice([
        { name: "X", unit: "pcs", sellPrice: 500, subtotal: 364000, quantityInSmallestUnit: 28, ...override },
      ])
    ).toEqual([]);
  });
});
