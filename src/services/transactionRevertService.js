// src/services/transactionRevertService.js
import {
  deleteDoc,
  deleteField,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getEnvironmentCollection, getEnvironmentDoc } from "../firebase";
import { getVoucherFaceValue } from "../utils/voucherBalance";
import { convertToSmallestUnit } from "../utils/transaksiUtils";
import { getUnitCost, roundRupiah, toFiniteNumber } from "../utils/profitUtils";
import { getLocalDateKey } from "../utils/cashflowUtils";
import { cashflowService } from "./cashflowService";

/**
 * Checks if the user role is authorized to delete a transaction.
 * Cashier and Wakil Rektor 2 are explicitly authorized, as well as Admin and Director.
 */
export const canUserDeleteTransaction = (userRole) => {
  if (!userRole) return false;
  const normalized = userRole.toString().trim().toLowerCase();
  return (
    normalized === "cashier" ||
    normalized === "wakil rektor 2" ||
    normalized === "admin" ||
    normalized === "director" ||
    normalized === "direktur"
  );
};

/**
 * Deletes a transaction and completely reverts all associated data
 * as if the transaction never happened:
 *  1. Restores stock counts and stockValues in `stocks`
 *  2. Removes related `stockTransactions` records
 *  3. Reverts voucher usage / balance / status in `vouchers` (if applied)
 *  4. Reverts user campaign points (if member earned points)
 *  5. Re-reconciles daily sales and discrepancy in `dailyReports` (if report exists)
 *  6. Creates an audit trail log in `deletedTransactions`
 *  7. Deletes the transaction from `transactionDetail`
 */
export const deleteAndRevertTransaction = async ({
  transactionId,
  currentUser,
  userRole,
  isProduction = true,
  reason = "Pembatalan transaksi duplikat / salah input",
}) => {
  if (!canUserDeleteTransaction(userRole)) {
    throw new Error("Anda tidak memiliki izin untuk menghapus transaksi.");
  }

  if (!transactionId) {
    throw new Error("ID transaksi tidak valid.");
  }

  // 1. Fetch transaction document
  const txRef = getEnvironmentDoc(
    "transactionDetail",
    transactionId,
    isProduction
  );
  const txSnap = await getDoc(txRef);
  if (!txSnap.exists()) {
    throw new Error("Transaksi tidak ditemukan di sistem.");
  }
  const txData = txSnap.data();

  // 2. Find and revert stock transactions
  const stockTxRef = getEnvironmentCollection("stockTransactions", isProduction);
  const stockTxQuery = query(
    stockTxRef,
    where("transactionId", "==", transactionId)
  );
  const stockTxSnap = await getDocs(stockTxQuery);

  const restoredItemsLog = [];

  if (!stockTxSnap.empty) {
    // Group stock transactions by itemId to handle multiple rows of same product
    const groupedByItem = new Map();
    for (const d of stockTxSnap.docs) {
      const sTx = d.data();
      const itemId = sTx.itemId;
      if (!itemId) continue;

      const prev = groupedByItem.get(itemId) || {
        itemId,
        itemName: sTx.itemName || "Item",
        quantity: 0,
        unit: sTx.unit || "pcs",
        stockWorth: 0,
        docIds: [],
      };
      prev.quantity += Number(sTx.quantity) || 0;
      prev.stockWorth += Number(sTx.stockWorth) || 0;
      prev.docIds.push(d.id);
      groupedByItem.set(itemId, prev);
    }

    // Revert stock in `stocks` collection and delete stockTransactions docs
    for (const [itemId, info] of groupedByItem.entries()) {
      const stockDocRef = getEnvironmentDoc("stocks", itemId, isProduction);
      const stockDocSnap = await getDoc(stockDocRef);
      if (stockDocSnap.exists()) {
        const currentStockData = stockDocSnap.data();
        const currentQty = toFiniteNumber(currentStockData.stock) ?? 0;
        const currentVal = Math.max(
          0,
          toFiniteNumber(currentStockData.stockValue) ?? 0
        );

        // Sales saved before quantities were whole can carry a decimal part
        const newQty = Math.round(currentQty + info.quantity);
        const newVal = roundRupiah(currentVal + info.stockWorth);

        await updateDoc(stockDocRef, {
          stock: newQty,
          stockValue: newVal,
          updatedAt: serverTimestamp(),
        });

        restoredItemsLog.push({
          itemId,
          itemName: info.itemName,
          restoredQuantity: info.quantity,
          unit: info.unit,
          restoredStockValue: info.stockWorth,
          newTotalStock: newQty,
        });
      }

      // Delete stockTransactions documents
      for (const sTxDocId of info.docIds) {
        await deleteDoc(
          getEnvironmentDoc("stockTransactions", sTxDocId, isProduction)
        );
      }
    }
  } else if (Array.isArray(txData.items) && txData.items.length > 0) {
    // Fallback: If stockTransactions records were not created or already missing,
    // restore stock based on transaction items list.
    for (const item of txData.items) {
      if (!item.itemId) continue;
      const stockDocRef = getEnvironmentDoc("stocks", item.itemId, isProduction);
      const stockDocSnap = await getDoc(stockDocRef);
      if (stockDocSnap.exists()) {
        const stockData = stockDocSnap.data();
        const convertedQty = convertToSmallestUnit(
          item.quantity,
          item.unit,
          stockData
        );
        const unitCost = getUnitCost(stockData);
        const itemStockWorth = roundRupiah(unitCost * convertedQty);

        const currentQty = toFiniteNumber(stockData.stock) ?? 0;
        const currentVal = Math.max(
          0,
          toFiniteNumber(stockData.stockValue) ?? 0
        );

        const newQty = Math.round(currentQty + convertedQty);
        const newVal = roundRupiah(currentVal + itemStockWorth);

        await updateDoc(stockDocRef, {
          stock: newQty,
          stockValue: newVal,
          updatedAt: serverTimestamp(),
        });

        restoredItemsLog.push({
          itemId: item.itemId,
          itemName: item.itemName,
          restoredQuantity: convertedQty,
          unit: stockData.smallestUnit || item.unit,
          restoredStockValue: itemStockWorth,
          newTotalStock: newQty,
        });
      }
    }
  }

  // 3. Revert voucher usage (if a voucher was used)
  let revertedVoucherLog = null;
  if (txData.voucherId) {
    const voucherRef = getEnvironmentDoc(
      "vouchers",
      txData.voucherId,
      isProduction
    );
    const voucherSnap = await getDoc(voucherRef);
    if (voucherSnap.exists()) {
      const vData = voucherSnap.data();
      const voucherUpdates = {
        updatedAt: serverTimestamp(),
      };

      if (vData.type === "cashbackCampaign") {
        voucherUpdates.status = "CLAIMED";
        voucherUpdates.isClaimed = false;
        voucherUpdates.isActive = true;
        voucherUpdates.redeemedAt = deleteField();
      } else if (vData.isOneTimeUse === false) {
        // Multi-use balance voucher
        const discount = Number(txData.voucherDiscount) || 0;
        const faceValue = getVoucherFaceValue(vData);
        const currentSpent = Number(vData.amountSpent) || 0;
        const newAmountSpent = Math.max(0, currentSpent - discount);
        const newSisaSaldo = Math.min(faceValue, faceValue - newAmountSpent);

        voucherUpdates.amountSpent = newAmountSpent;
        voucherUpdates.sisaSaldo = newSisaSaldo;
        voucherUpdates.isClaimed = newSisaSaldo <= 0;
      } else {
        // Standard single-use voucher
        voucherUpdates.isClaimed = false;
        voucherUpdates.isActive = true;
        voucherUpdates.claimDate = deleteField();
      }

      if (vData.lastRedemptionTransactionId === transactionId) {
        voucherUpdates.lastRedemptionTransactionId = deleteField();
      }

      await updateDoc(voucherRef, voucherUpdates);

      revertedVoucherLog = {
        voucherId: txData.voucherId,
        voucherName: txData.voucherName || vData.voucherName,
        voucherDiscount: txData.voucherDiscount,
      };
    }
  }

  // 4. Revert Campaign Points (if member earned points)
  if (txData.userId) {
    try {
      const vouchersRef = getEnvironmentCollection("vouchers", isProduction);
      const pointsQuery = query(
        vouchersRef,
        where("userId", "==", txData.userId),
        where("status", "==", "IN_PROGRESS")
      );
      const pointsSnap = await getDocs(pointsQuery);
      const pointsToDeduct =
        Number(txData.userPoints) || Number(txData.total) || 0;

      if (pointsToDeduct > 0 && !pointsSnap.empty) {
        for (const vDoc of pointsSnap.docs) {
          const currentPoints = Number(vDoc.data().userPoints) || 0;
          const newPoints = Math.max(0, currentPoints - pointsToDeduct);
          await updateDoc(vDoc.ref, {
            userPoints: newPoints,
            lastUpdatedAt: serverTimestamp(),
          });
        }
      }
    } catch (campaignErr) {
      console.warn("Could not revert campaign points for user:", campaignErr);
    }
  }

  // 5. Save audit log into deletedTransactions
  try {
    const deletedTxRef = getEnvironmentDoc(
      "deletedTransactions",
      transactionId,
      isProduction
    );
    await setDoc(deletedTxRef, {
      transactionId,
      originalData: txData,
      deletedBy: currentUser?.email || "unknown",
      deletedByRole: userRole || "unknown",
      deletedAt: serverTimestamp(),
      reason,
      restoredItems: restoredItemsLog,
      revertedVoucher: revertedVoucherLog,
    });
  } catch (auditErr) {
    console.warn("Could not write deletedTransactions audit log:", auditErr);
  }

  // 6. Delete the transaction document from transactionDetail
  await deleteDoc(txRef);

  // 7. Update Daily Report & Cashflow if report exists for that date
  try {
    const rawDate = txData.timestamp || txData.createdAt;
    const txDate = rawDate?.toDate ? rawDate.toDate() : new Date(rawDate);
    const dateKey = getLocalDateKey(txDate);
    await cashflowService.updateDailyReportSales(dateKey, isProduction);
  } catch (cashflowErr) {
    console.warn("Could not update daily report:", cashflowErr);
  }

  return {
    success: true,
    transactionId,
    restoredItems: restoredItemsLog,
    revertedVoucher: revertedVoucherLog,
  };
};
