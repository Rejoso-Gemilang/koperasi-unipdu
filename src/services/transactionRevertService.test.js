// src/services/transactionRevertService.test.js
import {
  canUserDeleteTransaction,
  deleteAndRevertTransaction,
} from "./transactionRevertService";
import {
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  setDoc,
  deleteField,
  serverTimestamp,
} from "firebase/firestore";
import { getEnvironmentDoc, getEnvironmentCollection } from "../firebase";
import { cashflowService } from "./cashflowService";

jest.mock("firebase/firestore", () => {
  const actual = jest.requireActual("firebase/firestore");
  return {
    ...actual,
    getDoc: jest.fn(),
    getDocs: jest.fn(),
    updateDoc: jest.fn(),
    deleteDoc: jest.fn(),
    setDoc: jest.fn(),
    deleteField: jest.fn(),
    serverTimestamp: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
  };
});

jest.mock("../firebase", () => ({
  db: {},
  getEnvironmentDoc: jest.fn(),
  getEnvironmentCollection: jest.fn(),
}));

jest.mock("./cashflowService", () => ({
  cashflowService: {
    updateDailyReportSales: jest.fn(),
  },
}));

describe("transactionRevertService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deleteField.mockReturnValue("__DELETE_FIELD__");
    serverTimestamp.mockReturnValue("__SERVER_TIMESTAMP__");
    getEnvironmentDoc.mockImplementation((col, id) => ({ collection: col, id }));
    getEnvironmentCollection.mockImplementation((col) => ({ collection: col }));
    cashflowService.updateDailyReportSales.mockResolvedValue({});
  });

  describe("canUserDeleteTransaction", () => {
    test("allows Cashier and Wakil Rektor 2", () => {
      expect(canUserDeleteTransaction("Cashier")).toBe(true);
      expect(canUserDeleteTransaction("cashier")).toBe(true);
      expect(canUserDeleteTransaction("Wakil Rektor 2")).toBe(true);
      expect(canUserDeleteTransaction("wakil rektor 2")).toBe(true);
    });

    test("allows Admin and Director", () => {
      expect(canUserDeleteTransaction("Admin")).toBe(true);
      expect(canUserDeleteTransaction("admin")).toBe(true);
      expect(canUserDeleteTransaction("Director")).toBe(true);
      expect(canUserDeleteTransaction("Direktur")).toBe(true);
    });

    test("rejects unauthorized roles", () => {
      expect(canUserDeleteTransaction("Member")).toBe(false);
      expect(canUserDeleteTransaction("BAK")).toBe(false);
      expect(canUserDeleteTransaction("Mitra")).toBe(false);
      expect(canUserDeleteTransaction(null)).toBe(false);
      expect(canUserDeleteTransaction(undefined)).toBe(false);
      expect(canUserDeleteTransaction("")).toBe(false);
    });
  });

  describe("deleteAndRevertTransaction", () => {
    test("throws if role is unauthorized", async () => {
      await expect(
        deleteAndRevertTransaction({
          transactionId: "tx-1",
          currentUser: { email: "member@unipdu.ac.id" },
          userRole: "Member",
        })
      ).rejects.toThrow("Anda tidak memiliki izin");
    });

    test("throws if transaction does not exist", async () => {
      getDoc.mockResolvedValueOnce({
        exists: () => false,
      });

      await expect(
        deleteAndRevertTransaction({
          transactionId: "non-existent-tx",
          currentUser: { email: "kasir@unipdu.ac.id" },
          userRole: "Cashier",
        })
      ).rejects.toThrow("Transaksi tidak ditemukan");
    });

    test("restores a stock value that was saved with a decimal part as whole rupiah", async () => {
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          id: "tx-002",
          total: 5000,
          paymentMethod: "cash",
          timestamp: { toDate: () => new Date("2026-10-05T09:50:00Z") },
        }),
      });
      getDocs.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: "stx-2",
            data: () => ({
              itemId: "item-2",
              itemName: "Gula",
              quantity: 1,
              stockWorth: 3333.33,
              unit: "pcs",
            }),
          },
        ],
      });
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ stock: 2, stockValue: 6666.5 }),
      });

      await deleteAndRevertTransaction({
        transactionId: "tx-002",
        currentUser: { email: "kasir@unipdu.ac.id" },
        userRole: "Cashier",
      });

      expect(updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ collection: "stocks", id: "item-2" }),
        expect.objectContaining({ stock: 3, stockValue: 10000 })
      );
    });

    test("restores stocks and removes stockTransactions for Cashier", async () => {
      const mockTx = {
        id: "tx-001",
        total: 100000,
        paymentMethod: "cash",
        timestamp: { toDate: () => new Date("2026-10-05T09:50:00Z") },
      };

      // 1. txSnap
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => mockTx,
      });

      // 2. stockTxSnap
      getDocs.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: "stx-1",
            data: () => ({
              itemId: "item-1",
              itemName: "Map Kertas",
              quantity: 10,
              stockWorth: 5000,
              unit: "pcs",
            }),
          },
        ],
      });

      // 3. stockDocSnap for item-1
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          stock: 40,
          stockValue: 20000,
        }),
      });

      const result = await deleteAndRevertTransaction({
        transactionId: "tx-001",
        currentUser: { email: "kasir@unipdu.ac.id" },
        userRole: "Cashier",
      });

      expect(result.success).toBe(true);

      // Verify stock was restored
      expect(updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ collection: "stocks", id: "item-1" }),
        expect.objectContaining({
          stock: 50,
          stockValue: 25000,
        })
      );

      // Verify stockTransaction was deleted
      expect(deleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ collection: "stockTransactions", id: "stx-1" })
      );

      // Verify audit log was written
      expect(setDoc).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: "deletedTransactions",
          id: "tx-001",
        }),
        expect.objectContaining({
          transactionId: "tx-001",
          deletedBy: "kasir@unipdu.ac.id",
          deletedByRole: "Cashier",
        })
      );

      // Verify transactionDetail was deleted
      expect(deleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: "transactionDetail",
          id: "tx-001",
        })
      );

      // Verify daily report sales updated
      expect(cashflowService.updateDailyReportSales).toHaveBeenCalledWith(
        expect.any(String),
        true
      );
    });

    test("reverts multi-use voucher balance and points for Wakil Rektor 2", async () => {
      const mockTx = {
        id: "tx-002",
        total: 188000,
        voucherId: "vouch-123",
        voucherDiscount: 188000,
        userId: "user-1",
        userPoints: 188000,
        timestamp: { toDate: () => new Date("2026-10-05T09:54:00Z") },
      };

      // 1. txSnap
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => mockTx,
      });

      // 2. stockTxSnap (empty to test fallback items or 0 items)
      getDocs.mockResolvedValueOnce({
        empty: true,
        docs: [],
      });

      // 3. voucherSnap
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          value: 1000000,
          amountSpent: 188000,
          sisaSaldo: 812000,
          isOneTimeUse: false,
          isClaimed: false,
          lastRedemptionTransactionId: "tx-002",
        }),
      });

      // 4. campaign points snapshot
      getDocs.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            ref: { id: "campaign-vouch-1" },
            data: () => ({
              userPoints: 300000,
            }),
          },
        ],
      });

      const result = await deleteAndRevertTransaction({
        transactionId: "tx-002",
        currentUser: { email: "warek2@unipdu.ac.id" },
        userRole: "Wakil Rektor 2",
      });

      expect(result.success).toBe(true);

      // Verify voucher balance was restored: amountSpent 0, sisaSaldo 1000000
      expect(updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ collection: "vouchers", id: "vouch-123" }),
        expect.objectContaining({
          amountSpent: 0,
          sisaSaldo: 1000000,
          isClaimed: false,
          lastRedemptionTransactionId: "__DELETE_FIELD__",
        })
      );

      // Verify campaign points were deducted: 300000 - 188000 = 112000
      expect(updateDoc).toHaveBeenCalledWith(
        { id: "campaign-vouch-1" },
        expect.objectContaining({
          userPoints: 112000,
        })
      );
    });
  });
});
