import {
  getIncrement,
  getPriceAndSubtotal,
  validateVoucher,
} from "./transaksiUtils";

describe("validateVoucher", () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const nextYear = new Date(Date.now() + 365 * 86400000).toISOString();
  const lastYear = new Date(Date.now() - 365 * 86400000).toISOString();

  test("returns valid true and isValid true for active unclaimed voucher", () => {
    const voucher = {
      activeDate: yesterday,
      expireDate: nextYear,
      isActive: true,
      isClaimed: false,
      value: 50000,
    };
    const res = validateVoucher(voucher);
    expect(res.valid).toBe(true);
    expect(res.isValid).toBe(true);
  });

  test("returns valid false and message when voucher expired", () => {
    const voucher = {
      activeDate: lastYear,
      expireDate: yesterday,
      isActive: true,
      isClaimed: false,
      value: 50000,
    };
    const res = validateVoucher(voucher);
    expect(res.valid).toBe(false);
    expect(res.isValid).toBe(false);
    expect(res.reason).toBe("Voucher sudah kedaluwarsa");
    expect(res.message).toBe("Voucher sudah kedaluwarsa");
  });

  test("returns valid false when single-use voucher is claimed", () => {
    const voucher = {
      activeDate: yesterday,
      expireDate: nextYear,
      isActive: true,
      isClaimed: true,
      isOneTimeUse: true,
      value: 50000,
    };
    const res = validateVoucher(voucher);
    expect(res.valid).toBe(false);
    expect(res.isValid).toBe(false);
    expect(res.reason).toBe("Voucher sudah pernah digunakan");
  });

  test("rejects a campaign voucher left CLAIMED but already marked used", () => {
    const voucher = {
      type: "cashbackCampaign",
      status: "CLAIMED",
      isClaimed: true,
      isActive: true,
      activeDate: new Date(Date.now() - 60_000),
      expireDate: new Date(Date.now() + 60_000),
    };

    const res = validateVoucher(voucher);

    expect(res.isValid).toBe(false);
    expect(res.message).toBe("Voucher sudah pernah digunakan");
  });
});

describe("POS quantities are whole numbers", () => {
  test.each(["kg", "liter", "gram", "pcs", "box", "KG"])(
    "every step for %s is a whole number",
    (unit) => {
      expect(Number.isInteger(getIncrement(unit))).toBe(true);
      expect(getIncrement(unit)).toBeGreaterThan(0);
    }
  );
});

describe("getPriceAndSubtotal", () => {
  const product = {
    base_unit: "pcs",
    bulk_unit_name: "dus",
    bulk_unit_conversion: 12,
    pricePerUnit: { pcs: 6000, dus: 65000 },
  };

  test("uses the unit's own price", () => {
    expect(getPriceAndSubtotal(product, 5, "pcs")).toEqual({ price: 6000, subtotal: 30000 });
    expect(getPriceAndSubtotal(product, 2, "dus")).toEqual({ price: 65000, subtotal: 130000 });
  });

  test("spreads the bulk price over the pieces once a full bulk unit is bought", () => {
    // 65000 / 12 = 5416.67 per pcs
    expect(getPriceAndSubtotal(product, 12, "pcs")).toEqual({ price: 5417, subtotal: 65000 });
  });

  test("rounds the subtotal once from the exact amount, not from the rounded unit price", () => {
    // 13 x 5416.67 = 70416.67; 13 x the rounded 5417 would be 70421
    expect(getPriceAndSubtotal(product, 13, "pcs")).toEqual({ price: 5417, subtotal: 70417 });
    expect(getPriceAndSubtotal(product, 25, "pcs").subtotal).toBe(135417);
  });

  test("never returns a decimal", () => {
    for (let quantity = 1; quantity <= 60; quantity += 1) {
      const { price, subtotal } = getPriceAndSubtotal(product, quantity, "pcs");
      expect(Number.isInteger(price)).toBe(true);
      expect(Number.isInteger(subtotal)).toBe(true);
    }
  });

  test("rounds a price that was saved with a decimal part", () => {
    expect(
      getPriceAndSubtotal({ base_unit: "pcs", pricePerUnit: { pcs: 1500.5 } }, 3, "pcs")
    ).toEqual({ price: 1501, subtotal: 4502 });
  });

  test("is 0 for a product that is not there or has no price", () => {
    expect(getPriceAndSubtotal(undefined, 3, "pcs")).toEqual({ price: 0, subtotal: 0 });
    expect(getPriceAndSubtotal({ base_unit: "pcs" }, 3, "pcs")).toEqual({ price: 0, subtotal: 0 });
  });
});
