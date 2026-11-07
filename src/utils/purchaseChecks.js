// src/utils/purchaseChecks.js
//
// Checks on a purchase (Pembelian Grosir) before it is saved.

/**
 * Lines whose cost per smallest unit is above what the item sells for.
 *
 * That is almost always the wrong unit: "28 pcs" typed for 28 packs of 100
 * made an Rp 500 amplop cost Rp 13.000, and the next sale of a pack booked a
 * Rp 1.300.000 cost against Rp 15.000 of sales. A shop can still buy below
 * cost on purpose, so this only asks; it never stops a purchase.
 *
 * Each line is { name, unit, sellPrice, subtotal, quantityInSmallestUnit }:
 * the price is per smallest unit, the subtotal is for the whole line.
 */
export const findCostAboveSellingPrice = (lines) =>
  lines
    .filter(
      (line) =>
        line.sellPrice > 0 &&
        line.subtotal > 0 &&
        line.quantityInSmallestUnit > 0 &&
        line.subtotal / line.quantityInSmallestUnit > line.sellPrice
    )
    .map((line) => ({
      name: line.name,
      unit: line.unit,
      sellPrice: line.sellPrice,
      costPrice: Math.round(line.subtotal / line.quantityInSmallestUnit),
    }));
