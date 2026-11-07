import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Transaksi from "./Transaksi";

const WHOLE_MESSAGE = "Jumlah harus bilangan bulat (tanpa desimal)";

jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({ currentUser: { email: "kasir@unipdu.ac.id" } }),
}));

jest.mock("../context/EnvironmentContext", () => ({
  useEnvironment: () => ({ isProduction: false }),
}));

const mockQueryCollection = jest.fn();
jest.mock("../context/FirestoreContext", () => ({
  useFirestore: () => ({
    createDoc: jest.fn(),
    readDoc: jest.fn(),
    updateDoc: jest.fn(),
    serverTimestamp: jest.fn(),
    queryCollection: mockQueryCollection,
  }),
}));

jest.mock("../services/voucherService", () => ({
  voucherService: { getActiveCashbackCampaigns: jest.fn(async () => []) },
}));
jest.mock("../services/PrinterService", () => ({ printReceipt: jest.fn() }));
jest.mock("./PaymentModal", () => () => null);
jest.mock("./cashflow/LaporanHarianModal", () => () => null);
jest.mock("./cashflow/CatatPengeluaranModal", () => () => null);

const GULA = {
  id: "gula",
  itemId: "123",
  name: "Gula Pasir",
  base_unit: "kg",
  smallestUnit: "kg",
  satuan: ["kg"],
  pricePerUnit: { kg: 15000 },
  stock: 50,
  stockValue: 500000,
};

// Scans the barcode, which puts the product in the cart
const addGula = async () => {
  render(<Transaksi />);
  await waitFor(() => expect(mockQueryCollection).toHaveBeenCalled());
  const search = screen.getByPlaceholderText("Enter Product ID or Name");
  // Product data arrives asynchronously
  await waitFor(() => {
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.change(search, { target: { value: "123" } });
    expect(document.querySelector(".quantity-input")).not.toBeNull();
  });
  return document.querySelector(".quantity-input");
};

describe("POS cart quantities are whole numbers", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    mockQueryCollection.mockImplementation(async (name) =>
      name === "stocks" ? [GULA] : []
    );
  });

  afterEach(() => jest.restoreAllMocks());

  test("the box asks for a number pad", async () => {
    const quantity = await addGula();

    expect(quantity).toHaveAttribute("inputmode", "numeric");
    expect(quantity).toHaveValue("1");
  });

  test("refuses a comma or dot and says why, instead of reading 0,5 as 5", async () => {
    const quantity = await addGula();

    fireEvent.change(quantity, { target: { value: "2,5" } });

    expect(quantity).toHaveValue("1");
    expect(await screen.findByText(WHOLE_MESSAGE)).toBeInTheDocument();

    fireEvent.change(quantity, { target: { value: "2.5" } });
    expect(quantity).toHaveValue("1");
  });

  test("takes a whole number and prices it in whole rupiah", async () => {
    const quantity = await addGula();

    fireEvent.change(quantity, { target: { value: "7" } });
    fireEvent.blur(quantity);

    expect(quantity).toHaveValue("7");
    expect(screen.getAllByText(/105\.000/).length).toBeGreaterThan(0);
  });

  test("the + and - buttons step by one whole unit, even for kg", async () => {
    const quantity = await addGula();
    const [minus, plus] = document.querySelectorAll(".quantity-btn");

    fireEvent.click(plus);
    expect(quantity).toHaveValue("2");
    fireEvent.click(plus);
    expect(quantity).toHaveValue("3");
    fireEvent.click(minus);
    expect(quantity).toHaveValue("2");
  });

  test("clearing the box and pressing + does not turn the quantity into NaN", async () => {
    const quantity = await addGula();
    const plus = document.querySelectorAll(".quantity-btn")[1];

    fireEvent.change(quantity, { target: { value: "" } });
    fireEvent.click(plus);

    expect(quantity).toHaveValue("2");
  });

  test("letters are dropped from the box", async () => {
    const quantity = await addGula();

    fireEvent.change(quantity, { target: { value: "4a" } });

    expect(quantity).toHaveValue("4");
  });
});
