// src/utils/transaksiUtils.js

import {
  getVoucherAmountSpent,
  getVoucherFaceValue,
  getVoucherRemainingBalance,
} from "./voucherBalance";

const CONVERSION_TABLE = {
  kwintal: 100000,
  ton: 1000000,
  kg: 1000,
  ons: 100,
  gram: 1,
  pcs: 1,
  kardus: 1,
  karton: 1,
  pack: 1,
};

export const convertToSmallestUnit = (quantity, unit, product) => {
  const baseUnit = product.base_unit || product.smallestUnit;
  const bulkUnitName = product.bulk_unit_name || "box";
  const bulkUnitConversion = product.bulk_unit_conversion || product.piecesPerBox;

  if (unit === bulkUnitName) {
    if (!bulkUnitConversion) {
      throw new Error("Pieces per box or bulk conversion not defined");
    }
    return quantity * bulkUnitConversion;
  }

  const quantityInGrams = quantity * CONVERSION_TABLE[unit];

  if (
    baseUnit === "pcs" ||
    baseUnit === "kardus" ||
    baseUnit === "karton" ||
    baseUnit === "pack"
  )
    return quantityInGrams;
  if (baseUnit === "gram") return quantityInGrams;
  if (baseUnit === "ons") return quantityInGrams / 100;
  if (baseUnit === "kg") return quantityInGrams / 1000;

  return quantityInGrams;
};

export const convertFromSmallestUnit = (
  quantityInSmallest,
  targetUnit,
  product
) => {
  const baseUnit = product.base_unit || product.smallestUnit;
  const bulkUnitName = product.bulk_unit_name || "box";
  const bulkUnitConversion = product.bulk_unit_conversion || product.piecesPerBox;

  if (targetUnit === bulkUnitName) {
    if (!bulkUnitConversion) {
      throw new Error("Pieces per box or bulk conversion not defined for this product");
    }
    return quantityInSmallest / bulkUnitConversion;
  }

  if (!baseUnit || !CONVERSION_TABLE[baseUnit]) {
    throw new Error(`Unknown base unit: ${baseUnit}`);
  }

  let quantityInGrams;
  if (baseUnit === "gram") {
    quantityInGrams = quantityInSmallest;
  } else if (baseUnit === "ons") {
    quantityInGrams = quantityInSmallest * 100;
  } else if (baseUnit === "kg") {
    quantityInGrams = quantityInSmallest * 1000;
  } else if (
    baseUnit === "pcs" ||
    baseUnit === "kardus" ||
    baseUnit === "karton" ||
    baseUnit === "pack"
  ) {
    quantityInGrams = quantityInSmallest;
  } else {
    throw new Error(`Unsupported base unit: ${baseUnit}`);
  }

  return quantityInGrams / CONVERSION_TABLE[targetUnit];
};

export const formatCurrency = (number) => {
  const val = Number(number);
  if (isNaN(val)) {
    return "Rp. 0";
  }
  return "Rp. " + val.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

export const formatNumber = (number) => {
  const val = Number(number);
  if (isNaN(val)) {
    return "0";
  }
  return val.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// Price and subtotal for a quantity of a product in the unit it is sold by.
// Selling the base unit at or above a full bulk unit uses the bulk price
// spread over the bulk unit; otherwise the unit's own price applies. A
// subtotal is rounded once, from the exact amount, to the nearest rupiah, and
// the unit price shown with it is rounded too, so no decimals are saved.
export const getPriceAndSubtotal = (product, quantity, selectedUnit) => {
  if (!product) {
    return { price: 0, subtotal: 0 };
  }

  const baseUnit = product.base_unit || product.smallestUnit || "pcs";
  const bulkUnit = product.bulk_unit_name || "";
  const conversion = product.bulk_unit_conversion || product.piecesPerBox || 1;
  const bulkPrice = bulkUnit ? product.pricePerUnit?.[bulkUnit] || 0 : 0;

  if (
    selectedUnit === baseUnit &&
    bulkUnit &&
    bulkPrice > 0 &&
    conversion > 1 &&
    quantity >= conversion
  ) {
    return {
      price: Math.round(bulkPrice / conversion),
      subtotal: Math.round((quantity * bulkPrice) / conversion),
    };
  }

  const standardPrice = product.pricePerUnit?.[selectedUnit] || 0;
  return {
    price: Math.round(standardPrice),
    subtotal: Math.round(standardPrice * quantity),
  };
};

export const getInitialQuantity = (satuan) => {
  switch (satuan.toLowerCase()) {
    case "liter":
    case "kg":
    case "pcs":
    case "box":
      return 1;
    case "gram":
      return 100;
    default:
      return 1;
  }
};

// Quantities are whole numbers, so every step is a whole number too.
export const getIncrement = (satuan) => {
  switch (satuan.toLowerCase()) {
    case "gram":
      return 100;
    default:
      return 1;
  }
};

export const getBarcodeIncrement = (unit) => {
  switch (unit.toLowerCase()) {
    case "gram":
      return 100;
    case "kg":
    case "ons":
    case "kwintal":
    case "tons":
    case "box":
    case "pcs":
    default:
      return 1;
  }
};

export { CONVERSION_TABLE };

// Voucher validation function
export const validateVoucher = (voucher) => {
  const makeResult = (isValid, message, extra = {}) => ({
    isValid,
    valid: isValid,
    message,
    reason: message,
    ...extra,
  });

  if (!voucher) {
    return makeResult(false, "Voucher tidak ditemukan");
  }

  const now = new Date();
  const activeDate = voucher.activeDate?.toDate
    ? voucher.activeDate.toDate()
    : new Date(voucher.activeDate);
  const expireDate = voucher.expireDate?.toDate
    ? voucher.expireDate.toDate()
    : new Date(voucher.expireDate);

  // Check date validity
  if (now < activeDate) {
    return makeResult(false, "Voucher belum aktif");
  }
  if (now > expireDate) {
    return makeResult(false, "Voucher sudah kedaluwarsa");
  }

  // Handle campaign vouchers (cashbackCampaign type)
  if (voucher.type === "cashbackCampaign") {
    // Campaign voucher must have status "CLAIMED" to be usable
    if (voucher.status === "IN_PROGRESS") {
      return makeResult(
        false,
        "Voucher belum bisa digunakan - target belanja belum tercapai"
      );
    }
    if (voucher.status === "REDEEMED") {
      return makeResult(false, "Voucher sudah pernah digunakan");
    }
    if (voucher.isClaimed === true) {
      return makeResult(false, "Voucher sudah pernah digunakan");
    }
    // Status "CLAIMED" means it's ready to use
    if (voucher.status !== "CLAIMED") {
      return makeResult(false, "Voucher tidak valid");
    }
    // For CLAIMED campaign vouchers, isActive should be true
    if (!voucher.isActive) {
      return makeResult(false, "Voucher sudah tidak aktif");
    }
    return makeResult(true, "", { isCampaignVoucher: true });
  }

  // Handle regular vouchers
  if (!voucher.isActive) {
    return makeResult(false, "Voucher sudah tidak aktif");
  }

  // Multi-use vouchers: check remaining balance instead of isClaimed
  if (voucher.isOneTimeUse === false) {
    const amountSpent = getVoucherAmountSpent(voucher);
    const totalVal = getVoucherFaceValue(voucher);
    const remaining = getVoucherRemainingBalance(voucher);
    if (remaining <= 0 || amountSpent >= totalVal) {
      return makeResult(false, "Saldo voucher sudah habis");
    }
    return makeResult(true, "", {
      isCampaignVoucher: false,
      amountSpent,
      remaining,
    });
  }

  // One-time use vouchers
  if (voucher.isClaimed) {
    return makeResult(false, "Voucher sudah pernah digunakan");
  }

  return makeResult(true, "", { isCampaignVoucher: false });
};
