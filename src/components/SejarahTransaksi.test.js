import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import * as XLSX from "xlsx";
import SejarahTransaksi from "./SejarahTransaksi";

const mockQueryCollection = jest.fn();

jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({ userRole: "Wakil Rektor 2", currentUser: {} }),
}));
jest.mock("../context/EnvironmentContext", () => ({
  useEnvironment: () => ({ isProduction: true, environment: "production" }),
}));
jest.mock("../context/FirestoreContext", () => ({
  useFirestore: () => ({
    queryCollection: mockQueryCollection,
    query: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
  }),
}));
jest.mock("../services/PrinterService", () => ({ printReceipt: jest.fn() }));
jest.mock("../services/transactionRevertService", () => ({
  canUserDeleteTransaction: () => false,
}));
jest.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: jest.fn(),
    book_new: jest.fn(),
    book_append_sheet: jest.fn(),
  },
  writeFile: jest.fn(),
}));

describe("transaction history with a stock discrepancy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    const date = new Date();
    const timestamp = {
      seconds: Math.floor(date.getTime() / 1000),
      toDate: () => date,
    };
    const item = {
      itemId: "Sosis_Kanzler_Hot_8993200345717",
      itemName: "Sosis Kanzler Hot",
      quantity: 7,
      unit: "pcs",
      price: 8500,
      subtotal: 59500,
    };
    mockQueryCollection.mockImplementation(async (collection) => {
      if (collection === "transactionDetail") {
        return [{ id: "kanzler-sale", timestamp, items: [item], total: 59500 }];
      }
      if (collection === "stockTransactions") {
        return [{
          ...item,
          transactionId: "kanzler-sale",
          timestampInMillisEpoch: timestamp,
          transactionType: "penjualan",
          costPrice: 7032,
          stockWorth: 0,
          isStockDiscrepant: true,
        }];
      }
      if (collection === "stocks") {
        return [{
          id: item.itemId,
          stock: 4,
          stockValue: 28132,
          lastPurchasePrice: 7033,
        }];
      }
      return [];
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test("shows and exports the saved cost for every unit in Per Transaksi", async () => {
    render(<SejarahTransaksi />);

    const dayTotal = await screen.findByText(/Total: Rp 59.500/);
    expect(dayTotal).toHaveTextContent("Untung: Rp 10.276");
    fireEvent.click(dayTotal);
    fireEvent.click(screen.getByText("Non-Anggota"));
    expect(screen.getByText("(Untung: Rp 10.276)")).toBeInTheDocument();
    expect(screen.queryByText("(Untung: Rp 59.500)")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export ke Excel" }));
    const exportedRows = XLSX.utils.aoa_to_sheet.mock.calls[0][0];
    expect(exportedRows.find((row) => row[0] === "kanzler-sale").slice(8, 11))
      .toEqual([59500, 49224, 10276]);
  });

  test("keeps Per Item totals, transaction details and exports consistent", async () => {
    render(<SejarahTransaksi />);
    await screen.findByText(/Total: Rp 59.500/);
    fireEvent.click(screen.getByRole("button", { name: "Per Item" }));

    const itemName = await screen.findByText("Sosis Kanzler Hot");
    const row = itemName.closest("tr");
    expect(within(row).getByText("Rp 49.224")).toBeInTheDocument();
    expect(within(row).getByText("Rp 10.276")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export ke Excel" }));
    const exportedRows = XLSX.utils.aoa_to_sheet.mock.calls[0][0];
    expect(exportedRows.find((values) => values[0] === "Sosis Kanzler Hot").slice(5))
      .toEqual([59500, 49224, 10276]);

    fireEvent.click(row);
    const dialog = screen.getByRole("heading", { name: "Sosis Kanzler Hot" })
      .closest(".st-dialog");
    const detailRow = within(dialog).getByText("7 pcs").closest("tr");
    expect(within(detailRow).getByText("Rp 49.224")).toBeInTheDocument();
    expect(within(detailRow).getByText("Rp 10.276")).toBeInTheDocument();
  });
});
