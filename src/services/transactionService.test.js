import { processTransaction } from "./transactionService";

jest.mock("./PrinterService", () => ({ printReceipt: jest.fn() }));

// Sells one product from a stock record and returns what was written.
const sell = async ({ quantity, stock }) => {
  const writes = { stockTransactions: [], stockUpdates: [] };
  const deps = {
    createDoc: jest.fn(async (collection, data) => {
      if (collection === "stockTransactions") writes.stockTransactions.push(data);
    }),
    readDoc: jest.fn(async () => ({ smallestUnit: "pcs", ...stock })),
    updateDoc: jest.fn(async (collection, id, data) => {
      writes.stockUpdates.push(data);
    }),
    serverTimestamp: jest.fn(() => "now"),
    currentUser: { email: "kasir@unipdu.ac.id" },
    setSnackbars: jest.fn(),
  };
  const product = {
    id: "p1",
    name: "Gula",
    quantity,
    satuan: "pcs",
    price: 5000,
    subtotal: 5000 * quantity,
  };
  await processTransaction([product], product.subtotal, product.subtotal, 0, deps);
  return writes;
};

describe("sale costs are saved as whole rupiah", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test("an average cost of 3333.33 is saved as 3333 and the stock value follows", async () => {
    // 10000 over 3 pcs is 3333.33 per pcs
    const { stockTransactions, stockUpdates } = await sell({
      quantity: 1,
      stock: { stock: 3, stockValue: 10000 },
    });

    expect(stockTransactions[0].costPrice).toBe(3333);
    expect(stockTransactions[0].stockWorth).toBe(3333);
    expect(stockUpdates[0]).toEqual({ stock: 2, stockValue: 6667 });
  });

  test("selling the last units leaves a stock value of exactly 0", async () => {
    const { stockUpdates } = await sell({
      quantity: 3,
      stock: { stock: 3, stockValue: 10000 },
    });

    expect(stockUpdates[0]).toEqual({ stock: 0, stockValue: 0 });
  });

  test("a sale beyond the recorded stock is costed in whole rupiah too", async () => {
    const { stockTransactions, stockUpdates } = await sell({
      quantity: 5,
      stock: { stock: 3, stockValue: 10000 },
    });

    expect(stockTransactions[0].costPrice).toBe(3333);
    expect(Number.isInteger(stockTransactions[0].stockWorth)).toBe(true);
    expect(stockUpdates[0]).toEqual({ stock: 0, stockValue: 0 });
  });

  test("the whole cost of the line is saved too, exact where the unit cost is rounded", async () => {
    // 1000 g costing 16500 is 16.5 per gram: costPrice saves as 17, lineCost as 8250 for 500 g
    const { stockTransactions } = await sell({
      quantity: 500,
      stock: { stock: 1000, stockValue: 16500 },
    });

    expect(stockTransactions[0].costPrice).toBe(17);
    expect(stockTransactions[0].lineCost).toBe(8250);
  });
});
