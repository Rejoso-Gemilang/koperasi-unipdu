/**
 * Transaction History Service
 * Handles all Firestore queries and data processing for transaction history views
 */

import { getSaleCost } from "../utils/profitUtils";

// Unit conversion constants for weight-based items
export const UNIT_CONVERSION = {
  ton: 1000,
  kwintal: 100,
  ons: 0.1,
  gram: 0.001,
};

/**
 * Convert quantity to kg based on unit
 */
export function convertToKg(qty, unit) {
  const conversionRate = UNIT_CONVERSION[unit] || 1;
  return qty * conversionRate;
}

/**
 * Get display quantity with proper unit handling
 */
export function getDisplayQty(tx) {
  if (tx.originalUnit && tx.originalUnit !== tx.unit) {
    return `${tx.originalQuantity} ${tx.originalUnit} (${tx.quantity} ${tx.unit || ""})`;
  }

  // Convert weight units to kg
  if (UNIT_CONVERSION[tx.unit]) {
    const q = convertToKg(tx.quantity, tx.unit);
    return `${q} kg`;
  }

  // For pcs and other non-weight units
  return `${tx.originalQuantity} ${tx.originalUnit || tx.unit || ""}`;
}

/**
 * Format number as Indonesian currency
 */
export function formatCurrency(value) {
  if (!value) return "Rp 0";
  const numeric = Math.round(Number(value)) || 0;
  const sign = numeric < 0 ? "-" : "";
  return sign + "Rp " + Math.abs(numeric).toLocaleString("id-ID");
}

/**
 * Format date in DD/MM/YYYY format
 */
export function formatDateDDMMYYYY(ts) {
  if (!ts) return "";
  const dateObj = ts.toDate ? ts.toDate() : new Date(ts);
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const yyyy = dateObj.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Format date for display (e.g., "02 Feb 2025")
 */
export function formatDateShort(date) {
  return new Date(date).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Format date with weekday
 */
export function formatDateWithWeekday(date) {
  return new Date(date).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Get date key in YYYY-MM-DD format
 */
export function getDateKey(dateObj) {
  return (
    dateObj.getFullYear() +
    "-" +
    (dateObj.getMonth() + 1).toString().padStart(2, "0") +
    "-" +
    dateObj.getDate().toString().padStart(2, "0")
  );
}

/**
 * Group transactions by day
 */
export function groupTransactionsByDay(transactions) {
  const grouped = {};
  
  transactions.forEach((tx) => {
    if (!tx.timestamp || !tx.timestamp.toDate) return;
    const dateObj = tx.timestamp.toDate();
    const key = getDateKey(dateObj);
    
    if (!grouped[key]) {
      grouped[key] = {
        date: dateObj,
        transactions: [],
      };
    }
    grouped[key].transactions.push(tx);
  });

  return Object.keys(grouped).map((key) => {
    const group = grouped[key];
    const total = group.transactions.reduce(
      (sum, tx) => sum + (tx.total || 0),
      0
    );

    // Create breakdown per item
    const breakdownMap = {};
    group.transactions.forEach((tx) => {
      if (Array.isArray(tx.items)) {
        tx.items.forEach((item) => {
          const breakdownKey = item.itemName + "_" + item.unit;
          if (!breakdownMap[breakdownKey]) {
            breakdownMap[breakdownKey] = {
              itemName: item.itemName,
              unit: item.unit,
              quantity: 0,
              subtotal: 0,
            };
          }
          breakdownMap[breakdownKey].quantity += item.quantity;
          breakdownMap[breakdownKey].subtotal += item.subtotal;
        });
      }
    });

    return {
      key,
      date: group.date,
      formattedDate: formatDateWithWeekday(group.date),
      total,
      breakdown: Object.values(breakdownMap),
      transactions: group.transactions,
    };
  }).sort((a, b) => b.date - a.date);
}

/**
 * Group transactions by member for a specific day
 */
export function groupTransactionsByMember(transactions) {
  const grouped = {};

  transactions.forEach((tx) => {
    if (!tx.timestamp || !tx.timestamp.toDate) return;
    
    const nomorAnggota = tx.nomorAnggota || "guest";
    const memberName = tx.memberName || "Tamu";
    const dateObj = tx.timestamp.toDate();
    const dateKey = getDateKey(dateObj);
    const groupKey = `${dateKey}_${nomorAnggota}`;

    if (!grouped[groupKey]) {
      grouped[groupKey] = {
        nomorAnggota,
        memberName,
        date: dateObj,
        dateKey,
        formattedDate: formatDateWithWeekday(dateObj),
        transactions: [],
        total: 0,
      };
    }
    
    grouped[groupKey].transactions.push(tx);
    grouped[groupKey].total += tx.total || 0;
  });

  return Object.values(grouped).sort((a, b) => {
    // First sort by date (newest first)
    if (b.date.getTime() !== a.date.getTime()) {
      return b.date - a.date;
    }
    // Then by total (highest first)
    return b.total - a.total;
  });
}

/**
 * Group penjualan transactions by item
 */
export function groupTransactionsByItem(transactions, stockById = {}) {
  const groupedByItem = {};

  transactions.forEach((tx) => {
    if (!tx.timestampInMillisEpoch || !tx.timestampInMillisEpoch.toDate) return;

    const itemKey = tx.itemId || tx.itemName;

    if (!groupedByItem[itemKey]) {
      groupedByItem[itemKey] = {
        itemName: tx.itemName,
        unit: tx.unit,
        kategori: tx.kategori || "Unknown",
        subKategori: tx.subKategori || "Unknown",
        quantity: 0,
        revenue: 0,
        stockWorth: 0,
        profitMargin: 0,
        transactionCount: 0,
        transactions: [],
      };
    }

    groupedByItem[itemKey].transactions.push(tx);
    const txQuantity = tx.quantity || 0;
    const txPrice = tx.price || 0;
    const txStockWorth = getSaleCost(
      tx,
      stockById[itemKey] || stockById[tx.itemId] || {},
      txQuantity
    );

    groupedByItem[itemKey].quantity += txQuantity;
    groupedByItem[itemKey].revenue += txQuantity * txPrice;
    groupedByItem[itemKey].stockWorth += txStockWorth;
    groupedByItem[itemKey].transactionCount++;
  });

  // Calculate profit margin
  Object.values(groupedByItem).forEach((item) => {
    item.profitMargin = item.revenue - item.stockWorth;
  });

  return Object.values(groupedByItem);
}

/**
 * Sort items by a given key and direction
 */
export function sortItems(items, key, direction) {
  return [...items].sort((a, b) => {
    let aValue = a[key];
    let bValue = b[key];

    if (typeof aValue === "string" && typeof bValue === "string") {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (aValue === undefined || aValue === null) aValue = 0;
    if (bValue === undefined || bValue === null) bValue = 0;

    if (direction === "asc") {
      return aValue > bValue ? 1 : -1;
    }
    return aValue < bValue ? 1 : -1;
  });
}

/**
 * Filter items by search term
 */
export function filterItemsBySearch(items, searchTerm) {
  if (!searchTerm.trim()) return items;
  
  const term = searchTerm.toLowerCase();
  return items.filter((item) =>
    (item.itemName && item.itemName.toLowerCase().includes(term)) ||
    (item.itemId && item.itemId.toLowerCase().includes(term)) ||
    (item.kategori && item.kategori.toLowerCase().includes(term)) ||
    (item.subKategori && item.subKategori.toLowerCase().includes(term))
  );
}

/**
 * Get initial date range (last N days)
 */
export function getInitialDateRange(days = 7) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  return { start, end };
}

/**
 * Get this month's date range
 */
export function getThisMonthDateRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

/**
 * Search stock items by term
 */
export function searchStockItems(stockList, searchTerm, useScanner = false) {
  if (!searchTerm.trim()) return [];
  
  if (useScanner) {
    return stockList.filter(
      (st) => st.itemId && st.itemId.toString() === searchTerm.trim()
    );
  }

  const lower = searchTerm.toLowerCase();
  const words = lower.split(/\s+/);
  return stockList.filter((st) => {
    if (!st.itemName) return false;
    const nm = st.itemName.toLowerCase();
    return words.every((w) => nm.includes(w));
  });
}

/**
 * Generates a PREFIX-YYYYMMDD-COUNTER formatted transaction ID
 */
export async function generateIncrementalId(queryCollection, query, where, collectionName, prefix) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}${mm}${dd}`;

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let count = 0;
  try {
    if (collectionName === "stockTransactions") {
      const results = await queryCollection(collectionName, (collectionRef) =>
        query(
          collectionRef,
          where("timestampInMillisEpoch", ">=", startOfDay),
          where("timestampInMillisEpoch", "<=", endOfDay)
        )
      );
      if (results && results.length > 0) {
        const matchPrefix = `${prefix}-${dateStr}-`;
        const matched = results.filter(r => r.id && r.id.startsWith(matchPrefix));
        count = matched.length;
      }
    } else if (collectionName === "notaBelanja" || collectionName === "notaBelanja_b2b") {
      const results = await queryCollection(collectionName);
      const matched = results.filter(nota => {
        if (!nota.createdAt) return false;
        const date = nota.createdAt.toDate ? nota.createdAt.toDate() : new Date(nota.createdAt);
        if (date < startOfDay || date > endOfDay) return false;

        const matchPrefix = `${prefix}-${dateStr}-`;
        const id = nota.bulkPurchaseId || "";
        return id.startsWith(matchPrefix);
      });
      count = matched.length;
    }
  } catch (err) {
    console.error("Error counting transactions for incremental ID:", err);
  }

  const nextNum = String(count + 1).padStart(3, "0");
  return `${prefix}-${dateStr}-${nextNum}`;
}
