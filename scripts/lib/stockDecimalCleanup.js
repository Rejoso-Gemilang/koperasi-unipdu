/**
 * Rules for turning a stock record into whole numbers.
 *
 * Pure functions only (no Firestore), so the rules can be tested and the
 * script that applies them stays small. Used by scripts/round_stock_decimals.js.
 *
 * Whole numbers are the rule for stock quantities and prices. Rounding is to
 * the nearest whole number (.5 goes up), as for every other amount in the app.
 */

// A stock quantity is only rounded when the decimal part is this small: that is
// floating point noise from unit conversions (18.998, 114.975). A real
// fraction (0.5 kg) is not rounded, because rounding it to 1 would double the
// stock; it is reported instead so it can be recounted in a smaller unit.
const STOCK_NOISE_TOLERANCE = 0.1;

// Money fields on a stock record. pricePerUnit is a map of unit -> price.
const MONEY_FIELDS = ["stockValue", "lastPurchasePrice", "cost_price", "price"];

const isNumber = (value) => typeof value === "number";
const isWhole = (value) => Number.isInteger(value);
const roundWhole = (value) => Math.round(value) || 0; // never -0

/**
 * What to change on one stock record.
 *
 * Returns null when it is already whole, otherwise
 *   { updates, changes }
 * where updates is what to write and changes lists each field as
 * { field, from, to, reason? } for the report and the backup.
 */
function planStockRecord(data = {}, { stockTolerance = STOCK_NOISE_TOLERANCE } = {}) {
  const updates = {};
  const changes = [];

  const change = (field, from, to, reason) => {
    updates[field] = to;
    changes.push({ field, from, to, ...(reason ? { reason } : {}) });
  };

  // Stock quantity
  let newStock = data.stock;
  if (isNumber(data.stock) && Number.isFinite(data.stock) && !isWhole(data.stock)) {
    const rounded = roundWhole(data.stock);
    if (Math.abs(rounded - data.stock) <= stockTolerance) {
      newStock = rounded;
      change("stock", data.stock, newStock);
    }
  }

  // Money
  let newStockValue = data.stockValue;
  for (const field of MONEY_FIELDS) {
    const value = data[field];
    if (isNumber(value) && Number.isFinite(value) && !isWhole(value)) {
      const rounded = roundWhole(value);
      change(field, value, rounded);
      if (field === "stockValue") newStockValue = rounded;
    }
  }

  // Prices per unit
  if (data.pricePerUnit && typeof data.pricePerUnit === "object") {
    const prices = { ...data.pricePerUnit };
    let priceChanged = false;
    for (const [unit, value] of Object.entries(prices)) {
      if (isNumber(value) && Number.isFinite(value) && !isWhole(value)) {
        const rounded = roundWhole(value);
        changes.push({ field: `pricePerUnit.${unit}`, from: value, to: rounded });
        prices[unit] = rounded;
        priceChanged = true;
      }
    }
    if (priceChanged) updates.pricePerUnit = prices;
  }

  // A stock that rounded down to nothing holds no value. Left behind, the
  // value would be added to the next purchase and inflate its average cost.
  if (
    "stock" in updates &&
    newStock === 0 &&
    isNumber(newStockValue) &&
    newStockValue !== 0
  ) {
    change("stockValue", newStockValue, 0, "stock rounded to 0");
  }

  return changes.length > 0 ? { updates, changes } : null;
}

/**
 * Things worth knowing that this cleanup does not change: stock with no
 * quantity but a value (it inflates the next purchase's average cost), and
 * numbers that are not numbers.
 */
function findNotes(data = {}, { stockTolerance = STOCK_NOISE_TOLERANCE } = {}) {
  const notes = [];

  if (isNumber(data.stock) && Number.isFinite(data.stock) && !isWhole(data.stock)) {
    const rounded = roundWhole(data.stock);
    if (Math.abs(rounded - data.stock) > stockTolerance) {
      notes.push({
        kind: "fractional-stock",
        message: `stock is ${data.stock}; rounding would make it ${rounded}, which is a real change, not rounding noise`,
      });
    }
  }

  if (data.stock === 0 && isNumber(data.stockValue) && data.stockValue > 0) {
    notes.push({
      kind: "zero-stock-with-value",
      message: `stock is 0 but stockValue is ${data.stockValue}`,
    });
  }

  for (const field of ["stock", ...MONEY_FIELDS]) {
    if (field in data && data[field] !== null && data[field] !== undefined) {
      if (!isNumber(data[field]) || !Number.isFinite(data[field])) {
        notes.push({
          kind: "not-a-number",
          message: `${field} is ${JSON.stringify(data[field])}`,
        });
      }
    }
  }

  for (const field of ["bulk_unit_conversion", "piecesPerBox"]) {
    if (isNumber(data[field]) && !isWhole(data[field])) {
      notes.push({
        kind: "decimal-conversion",
        message: `${field} is ${data[field]}; a conversion can't be rounded safely`,
      });
    }
  }

  return notes;
}

module.exports = { MONEY_FIELDS, STOCK_NOISE_TOLERANCE, planStockRecord, findNotes };
