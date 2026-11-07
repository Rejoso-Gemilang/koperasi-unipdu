import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Stocks from "./Stocks";

const mockCreateDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockQueryCollection = jest.fn();

jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({ currentUser: { email: "admin@unipdu.ac.id" }, userRole: "Admin" }),
}));

jest.mock("../context/FirestoreContext", () => ({
  useFirestore: () => ({
    createDoc: mockCreateDoc,
    readDoc: jest.fn(),
    updateDoc: mockUpdateDoc,
    deleteDoc: jest.fn(),
    queryCollection: mockQueryCollection,
    query: jest.fn(),
    where: jest.fn(),
  }),
}));

jest.mock("../context/EnvironmentContext", () => ({
  useEnvironment: () => ({ isProduction: false, environment: "testing" }),
}));

jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));
jest.mock("jspdf-autotable", () => ({}));
jest.mock("xlsx", () => ({}));

jest.mock("../firebase", () => ({
  db: {},
  uploadFile: jest.fn(),
  getEnvironmentCollection: jest.fn(),
  getEnvironmentDoc: jest.fn(),
}));

const stockItem = (overrides) => ({
  id: "p1",
  itemId: "p1",
  name: "Gula",
  stock: 2,
  stockValue: 20000,
  pricePerUnit: { kg: 15000, gram: 15 },
  ...overrides,
});

// The modal hands what was typed to the stock screen after a short debounce.
const save = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  fireEvent.click(screen.getByText("Simpan"));
};

const openDialog = async (menuItem, product) => {
  mockQueryCollection.mockImplementation(async (name) =>
    name === "stocks" ? [product] : []
  );
  render(<Stocks />);
  fireEvent.click(await screen.findByTitle("Aksi"));
  fireEvent.click(screen.getByText(menuItem));
  return screen.findByPlaceholderText("Jumlah");
};

const WHOLE_MESSAGE = "Jumlah harus bilangan bulat (tanpa desimal)";

describe("stock quantities are whole numbers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test("Tambah refuses a comma, so half a kilo is never saved as five", async () => {
    const amount = await openDialog(
      "Tambah",
      stockItem({ base_unit: "kg", smallestUnit: "kg", satuan: ["kg"] })
    );

    fireEvent.change(amount, { target: { value: "0" } });
    fireEvent.change(amount, { target: { value: "0," } });

    expect(amount).toHaveValue("0");
    expect(screen.getByText(WHOLE_MESSAGE)).toBeInTheDocument();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockCreateDoc).not.toHaveBeenCalled();
  });

  test("Tambah saves a whole quantity", async () => {
    const amount = await openDialog(
      "Tambah",
      stockItem({ base_unit: "kg", smallestUnit: "kg", satuan: ["kg"] })
    );

    fireEvent.change(amount, { target: { value: "5" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. 100.000"), {
      target: { value: "10000" },
    });
    await save();

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
    expect(mockUpdateDoc).toHaveBeenCalledWith("stocks", "p1", {
      stock: 7,
      stockValue: 30000,
      lastPurchasePrice: 2000,
    });
    expect(mockCreateDoc).toHaveBeenCalledWith(
      "stockTransactions",
      expect.objectContaining({ quantity: 5, originalQuantity: 5 }),
      expect.any(String)
    );
  });

  test("Tambah by the box stays whole", async () => {
    const amount = await openDialog(
      "Tambah",
      stockItem({
        stock: 0,
        stockValue: 0,
        base_unit: "pcs",
        smallestUnit: "pcs",
        bulk_unit_name: "dus",
        bulk_unit_conversion: 12,
        satuan: ["pcs", "dus"],
        pricePerUnit: { pcs: 5000, dus: 60000 },
      })
    );
    fireEvent.change(screen.getAllByRole("combobox").pop(), {
      target: { value: "dus" },
    });

    fireEvent.change(amount, { target: { value: "3" } });
    await save();

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
    expect(mockUpdateDoc.mock.calls[0][2].stock).toBe(36);
  });

  test("Tetapkan refuses a decimal quantity", async () => {
    const amount = await openDialog(
      "Tetapkan",
      stockItem({ base_unit: "kg", smallestUnit: "kg", satuan: ["kg"] })
    );

    fireEvent.change(amount, { target: { value: "2" } });
    fireEvent.change(amount, { target: { value: "2,5" } });

    expect(amount).toHaveValue("2");
    expect(screen.getByText(WHOLE_MESSAGE)).toBeInTheDocument();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  test("Tetapkan sets a whole quantity", async () => {
    const amount = await openDialog(
      "Tetapkan",
      stockItem({ base_unit: "kg", smallestUnit: "kg", satuan: ["kg"] })
    );

    fireEvent.change(amount, { target: { value: "4" } });
    await save();

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
    expect(mockUpdateDoc).toHaveBeenCalledWith("stocks", "p1", {
      stock: 4,
      stockValue: 40000,
    });
  });
});
