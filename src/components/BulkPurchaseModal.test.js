import React, { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import BulkPurchaseModal from "./BulkPurchaseModal";
import { uploadFile } from "../firebase";
import { generateIncrementalId } from "../services/transactionHistoryService";

jest.mock("../firebase", () => ({
  uploadFile: jest.fn(() => Promise.resolve("https://example.test/nota.pdf")),
}));

jest.mock("../context/FirestoreContext", () => ({
  useFirestore: () => ({
    queryCollection: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
  }),
}));

jest.mock("../services/transactionHistoryService", () => ({
  generateIncrementalId: jest.fn(() => Promise.resolve("BP-0001")),
}));

const PRODUCTS = {
  p1: {
    id: "p1",
    itemId: "111",
    name: "Kertas A4",
    base_unit: "pcs",
    bulk_unit_name: "pack",
    bulk_unit_conversion: 100,
    satuan: ["pcs", "pack"],
    stock: 10,
    stockValue: 5000,
  },
  p2: {
    id: "p2",
    itemId: "222",
    name: "Pulpen",
    base_unit: "pcs",
    satuan: ["pcs"],
    stock: 4,
    stockValue: 2000,
  },
};

// Mirrors how Stocks.js hosts the modal: always mounted, toggled via isOpen,
// and the onSave handler updates the products it passes back down.
const Host = ({ onSave, refreshProductsAfterSave = false, isWarehouse = false }) => {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState(PRODUCTS);

  return (
    <>
      <button onClick={() => setOpen(true)}>Buka Pembelian</button>
      <BulkPurchaseModal
        isOpen={open}
        onClose={() => setOpen(false)}
        products={products}
        currentUser={{ email: "kasir@unipdu.ac.id", uid: "u1" }}
        isWarehouse={isWarehouse}
        onSave={async (action, data, id, collectionName) => {
          await onSave(action, data, id, collectionName);
          if (action === "updateStock") {
            setProducts((prev) => ({
              ...prev,
              [data.id]: { ...prev[data.id], stock: data.stock, stockValue: data.stockValue },
            }));
          }
          if (action === "createNotaBelanja" && refreshProductsAfterSave) {
            // A realtime refresh handing back brand-new product objects
            setProducts((prev) =>
              Object.fromEntries(Object.entries(prev).map(([key, product]) => [key, { ...product }]))
            );
          }
        }}
      />
    </>
  );
};

const openModal = () => fireEvent.click(screen.getByText("Buka Pembelian"));

const fillFirstRow = async () => {
  const file = new File(["x"], "nota.pdf", { type: "application/pdf" });
  const fileInput = document.querySelector('input[type="file"]');
  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [file] } });
  });
  await screen.findByText(/File berhasil diupload/);

  fireEvent.change(screen.getByPlaceholderText("Masukkan nama supplier..."), {
    target: { value: "Toko Maju" },
  });

  // Only the first row is used, so drop the two blank rows.
  fireEvent.click(document.querySelectorAll(".bulk-remove-btn")[2]);
  fireEvent.click(document.querySelectorAll(".bulk-remove-btn")[1]);

  const search = screen.getByPlaceholderText("Cari produk...");
  fireEvent.focus(search);
  fireEvent.change(search, { target: { value: "Kertas" } });
  fireEvent.mouseDown(await screen.findByText("Kertas A4"));

  fireEvent.change(screen.getByPlaceholderText("Jumlah"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Harga satuan"), { target: { value: "1000" } });
};

describe("BulkPurchaseModal (create mode)", () => {
  beforeEach(() => {
    localStorage.clear();
    uploadFile.mockResolvedValue("https://example.test/nota.pdf");
    generateIncrementalId.mockResolvedValue("BP-0001");
    jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("starts the next purchase from an empty table after a successful submit", async () => {
    const onSave = jest.fn(() => Promise.resolve());
    render(<Host onSave={onSave} />);

    openModal();
    await fillFirstRow();
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(screen.queryByText("Pembelian Grosir")).not.toBeInTheDocument());
    expect(onSave).toHaveBeenCalledWith("createNotaBelanja", expect.anything(), expect.anything(), "notaBelanja");

    openModal();

    expect(screen.getAllByPlaceholderText("Cari produk...")).toHaveLength(3);
    screen.getAllByPlaceholderText("Cari produk...").forEach((input) => expect(input).toHaveValue(""));
    screen.getAllByPlaceholderText("Jumlah").forEach((input) => expect(input).toHaveValue(""));
    screen.getAllByLabelText("Harga satuan").forEach((input) => expect(input).toHaveValue(""));
    expect(screen.getByPlaceholderText("Masukkan nama supplier...")).toHaveValue("");
    expect(screen.queryByText(/File berhasil diupload/)).not.toBeInTheDocument();
    expect(screen.getByText("Rp 0")).toBeInTheDocument();
  });

  test("stays empty with slow writes and a products refresh landing as the submit finishes", async () => {
    const slow = () => new Promise((resolve) => setTimeout(resolve, 30));
    render(<Host onSave={jest.fn(slow)} refreshProductsAfterSave />);

    openModal();
    await fillFirstRow();
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(screen.queryByText("Pembelian Grosir")).not.toBeInTheDocument());
    // Let any late effects or refreshes settle before reopening
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    openModal();

    screen.getAllByPlaceholderText("Cari produk...").forEach((input) => expect(input).toHaveValue(""));
    screen.getAllByPlaceholderText("Jumlah").forEach((input) => expect(input).toHaveValue(""));
    expect(screen.getByText("Rp 0")).toBeInTheDocument();
  });

  test("leaves no draft behind in localStorage after a successful submit", async () => {
    render(<Host onSave={jest.fn(() => Promise.resolve())} />);

    openModal();
    await fillFirstRow();
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(screen.queryByText("Pembelian Grosir")).not.toBeInTheDocument());

    const draftRows = localStorage.getItem("retail_purchase_draft_rows");
    const rows = draftRows ? JSON.parse(draftRows) : [];
    expect(rows.every((row) => !row.product && !row.quantity)).toBe(true);
    expect(localStorage.getItem("retail_purchase_draft_supplier") || "").toBe("");
    expect(localStorage.getItem("retail_purchase_draft_uploaded_nota")).toBeNull();
  });

  test("keeps the draft when saving fails so nothing is lost", async () => {
    const onSave = jest.fn((action) =>
      action === "createNotaBelanja" ? Promise.reject(new Error("offline")) : Promise.resolve()
    );
    render(<Host onSave={onSave} />);

    openModal();
    await fillFirstRow();
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(screen.getByText("Pembelian Grosir")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Cari produk...")).toHaveValue("Kertas A4");
  });
});

describe("BulkPurchaseModal payment account", () => {
  beforeEach(() => {
    localStorage.clear();
    uploadFile.mockResolvedValue("https://example.test/nota.pdf");
    generateIncrementalId.mockResolvedValue("BP-0001");
    jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const submitPurchase = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(screen.queryByText("Pembelian Grosir")).not.toBeInTheDocument());
  };

  test("offers Cash, QRIS and Kredit with Cash selected by default", () => {
    render(<Host onSave={jest.fn(() => Promise.resolve())} />);
    openModal();

    expect(screen.getByText("Dibayar dari")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cash" })).toHaveClass("text-white");
    expect(screen.getByRole("button", { name: "QRIS" })).not.toHaveClass("text-white");
    expect(screen.getByRole("button", { name: "Kredit" })).not.toHaveClass("text-white");
  });

  test("puts supplier and upload on the left half and the account picker on the right", () => {
    render(<Host onSave={jest.fn(() => Promise.resolve())} />);
    openModal();

    const section = document.querySelector(".nota-upload-section");
    expect(section).toHaveClass("nota-upload-section-split");

    const [left, right] = section.children;
    expect(left).toHaveClass("nota-upload-main");
    expect(left).toContainElement(screen.getByPlaceholderText("Masukkan nama supplier..."));
    expect(left).toContainElement(screen.getByText("Upload Nota Supplier"));
    expect(right).toHaveClass("bulk-payment-account");
    expect(right).toContainElement(screen.getByText("Dibayar dari"));
    expect(right).toContainElement(screen.getByRole("button", { name: "Kredit" }));
  });

  test("stacks the account options vertically without extra explanatory text", () => {
    render(<Host onSave={jest.fn(() => Promise.resolve())} />);
    openModal();

    const pills = screen.getByRole("button", { name: "Cash" }).parentElement;
    expect(pills).toHaveClass("flex-col");
    expect(pills.children).toHaveLength(3);
    expect(screen.queryByText(/tercatat sebagai pengeluaran/)).not.toBeInTheDocument();
  });

  test("keeps the nota section a single column for warehouse purchases", () => {
    render(<Host onSave={jest.fn(() => Promise.resolve())} isWarehouse />);
    openModal();

    const section = document.querySelector(".nota-upload-section");
    expect(section).not.toHaveClass("nota-upload-section-split");
    expect(section.querySelector(".bulk-payment-account")).toBeNull();
    expect(screen.getByPlaceholderText("Masukkan nama supplier...")).toBeInTheDocument();
  });

  test("records the purchase total as an expense from the chosen account", async () => {
    const onSave = jest.fn(() => Promise.resolve());
    render(<Host onSave={onSave} />);

    openModal();
    await fillFirstRow();
    fireEvent.click(screen.getByRole("button", { name: "QRIS" }));
    await submitPurchase();

    expect(onSave).toHaveBeenCalledWith("createExpense", {
      amount: 2000,
      category: "Pembelian Grosir - Toko Maju",
      sourceAccount: "qris",
      bulkPurchaseId: "BP-0001",
    }, undefined, undefined);
    // The expense is written last, once the purchase itself is saved.
    expect(onSave.mock.calls.map(([action]) => action).pop()).toBe("createExpense");
  });

  test("can pay from Kredit", async () => {
    const onSave = jest.fn(() => Promise.resolve());
    render(<Host onSave={onSave} />);

    openModal();
    await fillFirstRow();
    fireEvent.click(screen.getByRole("button", { name: "Kredit" }));
    await submitPurchase();

    expect(onSave).toHaveBeenCalledWith(
      "createExpense",
      expect.objectContaining({ sourceAccount: "kredit" }),
      undefined,
      undefined
    );
  });

  test("goes back to Cash for the next purchase", async () => {
    render(<Host onSave={jest.fn(() => Promise.resolve())} />);

    openModal();
    await fillFirstRow();
    fireEvent.click(screen.getByRole("button", { name: "Kredit" }));
    await submitPurchase();

    expect(localStorage.getItem("retail_purchase_draft_account")).toBeNull();
    openModal();
    expect(screen.getByRole("button", { name: "Cash" })).toHaveClass("text-white");
    expect(screen.getByRole("button", { name: "Kredit" })).not.toHaveClass("text-white");
  });

  test("remembers the chosen account across a reload while the draft is open", () => {
    const { unmount } = render(<Host onSave={jest.fn(() => Promise.resolve())} />);
    openModal();
    fireEvent.click(screen.getByRole("button", { name: "QRIS" }));
    unmount();

    render(<Host onSave={jest.fn(() => Promise.resolve())} />);
    openModal();

    expect(screen.getByRole("button", { name: "QRIS" })).toHaveClass("text-white");
  });

  test("still completes the purchase and warns when only the expense fails", async () => {
    const onSave = jest.fn((action) =>
      action === "createExpense" ? Promise.reject(new Error("offline")) : Promise.resolve()
    );
    render(<Host onSave={onSave} />);

    openModal();
    await fillFirstRow();
    await submitPurchase();

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("gagal dicatat di Finance")));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("Rp 2.000"));

    openModal();
    screen.getAllByPlaceholderText("Cari produk...").forEach((input) => expect(input).toHaveValue(""));
  });

  test("does not touch Finance for warehouse purchases", async () => {
    const onSave = jest.fn(() => Promise.resolve());
    render(<Host onSave={onSave} isWarehouse />);

    openModal();
    expect(screen.queryByText("Dibayar dari")).not.toBeInTheDocument();

    await fillFirstRow();
    await submitPurchase();

    expect(onSave).toHaveBeenCalledWith("createNotaBelanja", expect.anything(), expect.anything(), "notaBelanja_b2b");
    expect(onSave.mock.calls.map(([action]) => action)).not.toContain("createExpense");
  });
});

describe("BulkPurchaseModal follows the UI guide", () => {
  beforeEach(() => {
    localStorage.clear();
    uploadFile.mockResolvedValue("https://example.test/nota.pdf");
    generateIncrementalId.mockResolvedValue("BP-0001");
    jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const searchFirstRow = (term) => {
    const search = screen.getAllByPlaceholderText("Cari produk...")[0];
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: term } });
    return search;
  };

  const pickFirstProduct = async () => {
    searchFirstRow("Kertas");
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Kertas A4" }));
  };

  test("uses no native select or datalist, in create or warehouse mode", () => {
    const { unmount } = render(<Host onSave={jest.fn(() => Promise.resolve())} />);
    openModal();
    expect(document.querySelector("select, datalist")).toBeNull();
    unmount();

    render(<Host onSave={jest.fn(() => Promise.resolve())} isWarehouse />);
    openModal();
    expect(document.querySelector("select, datalist")).toBeNull();
  });

  describe("unit dropdown", () => {
    test("is disabled and shows a dash until a product is chosen", () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();

      const [unit] = screen.getAllByRole("button", { name: "Satuan" });
      expect(unit).toBeDisabled();
      expect(unit).toHaveTextContent("-");
    });

    test("lists the product's units and switches between them", async () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();
      await pickFirstProduct();

      const [unit] = screen.getAllByRole("button", { name: "Satuan" });
      expect(unit).toBeEnabled();
      expect(unit).toHaveTextContent("pcs");

      fireEvent.click(unit);
      expect(
        screen.getAllByRole("option").filter((o) => ["pcs", "pack"].includes(o.textContent)).length
      ).toBe(2);
      fireEvent.click(screen.getByRole("option", { name: "pack" }));

      expect(unit).toHaveTextContent("pack");
    });

    test("still converts quantity and price when the unit changes", async () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();
      await pickFirstProduct();

      fireEvent.change(screen.getAllByPlaceholderText("Jumlah")[0], { target: { value: "200" } });
      fireEvent.change(screen.getAllByLabelText("Harga satuan")[0], { target: { value: "10" } });
      expect(screen.getAllByLabelText("Subtotal")[0]).toHaveValue("2.000");

      // 1 pack = 100 pcs: 200 pcs at Rp 10 becomes 2 packs at Rp 1.000
      fireEvent.click(screen.getAllByRole("button", { name: "Satuan" })[0]);
      fireEvent.click(screen.getByRole("option", { name: "pack" }));

      expect(screen.getAllByPlaceholderText("Jumlah")[0]).toHaveValue("2");
      expect(screen.getAllByLabelText("Harga satuan")[0]).toHaveValue("1.000");
      expect(screen.getAllByLabelText("Subtotal")[0]).toHaveValue("2.000");
    });

    test("opens above the modal so it is not clipped by it", async () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();
      await pickFirstProduct();

      fireEvent.click(screen.getAllByRole("button", { name: "Satuan" })[0]);

      // The modal overlay is z-index 1000; the list renders in a portal above it.
      const list = screen.getByRole("listbox", { name: "Satuan" });
      expect(document.body).toContainElement(list);
      expect(list).toHaveClass("z-[1100]");
    });
  });

  describe("money inputs", () => {
    test("every price and subtotal box has a fixed Rp prefix", () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();

      // 3 rows x (Harga satuan + Subtotal)
      expect(screen.getAllByText("Rp")).toHaveLength(6);
      screen.getAllByLabelText("Harga satuan").forEach((input) => {
        expect(input.previousElementSibling).toHaveTextContent("Rp");
      });
      screen.getAllByLabelText("Subtotal").forEach((input) => {
        expect(input.previousElementSibling).toHaveTextContent("Rp");
      });
    });

    test("adds a prefix for rows added later too", () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();

      fireEvent.click(screen.getByRole("button", { name: /Tambah Barang/ }));

      expect(screen.getAllByText("Rp")).toHaveLength(8);
    });

    test("uses a numeric keypad, a bare 0 placeholder and thousands separators", () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();

      const [price] = screen.getAllByLabelText("Harga satuan");
      expect(price).toHaveAttribute("inputmode", "numeric");
      expect(price).toHaveAttribute("placeholder", "0");

      fireEvent.change(price, { target: { value: "1500000" } });
      expect(price).toHaveValue("1.500.000");
    });

    test("does not give the quantity box an Rp prefix", () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();

      const [quantity] = screen.getAllByPlaceholderText("Jumlah");
      expect(quantity.parentElement).not.toHaveTextContent("Rp");
    });
  });

  describe("product search list", () => {
    test("shows nothing until there is something to show", () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();

      fireEvent.focus(screen.getAllByPlaceholderText("Cari produk...")[0]);

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    test("matches the app theme instead of the old blue box", () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();
      searchFirstRow("Kertas");

      const list = screen.getByRole("listbox", { name: "Hasil pencarian produk" });
      expect(list).toHaveClass("fixed", "z-[1100]", "rounded-xl", "border-gray-200", "shadow-lg");
      expect(list.style.border).toBe("");

      const option = within(list).getByRole("option", { name: "Kertas A4" });
      expect(option).toHaveClass("bg-[#fff8f8]", "text-[#e66a6a]");
      expect(option).toHaveAttribute("aria-selected", "true");
    });

    test("says so when nothing matches", () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();
      searchFirstRow("zzz");

      expect(screen.getByText("Tidak ada produk ditemukan")).toBeInTheDocument();
    });

    test("is announced as a combobox tied to its list", () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();
      const search = searchFirstRow("Kertas");

      expect(search).toHaveAttribute("role", "combobox");
      expect(search).toHaveAttribute("aria-expanded", "true");
      expect(search).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    });

    test("Escape closes the list without reaching anything behind the modal", () => {
      const onDocumentKeyDown = jest.fn();
      document.addEventListener("keydown", onDocumentKeyDown);
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();
      const search = searchFirstRow("Kertas");

      fireEvent.keyDown(search, { key: "Escape" });

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(onDocumentKeyDown).not.toHaveBeenCalled();
      document.removeEventListener("keydown", onDocumentKeyDown);
    });

    test("Tab closes the list and the arrow keys plus Enter still pick a product", () => {
      render(<Host onSave={jest.fn(() => Promise.resolve())} />);
      openModal();
      const search = searchFirstRow("e"); // matches Kertas A4 and Pulpen

      fireEvent.keyDown(search, { key: "ArrowDown" });
      fireEvent.keyDown(search, { key: "Enter" });
      expect(search).toHaveValue("Pulpen");

      const second = searchFirstRow("Kertas");
      fireEvent.keyDown(second, { key: "Tab" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  test("uses Indonesian button labels", () => {
    render(<Host onSave={jest.fn(() => Promise.resolve())} />);
    openModal();

    expect(screen.getByRole("button", { name: "Simpan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Batal" })).toBeInTheDocument();
    expect(screen.queryByText("Submit")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });
});

describe("BulkPurchaseModal whole numbers", () => {
  const WHOLE_MESSAGE = "Jumlah harus bilangan bulat (tanpa desimal)";

  beforeEach(() => {
    localStorage.clear();
    jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("refuses a decimal quantity and says why instead of reading 1,5 as 15", () => {
    render(<Host onSave={jest.fn(() => Promise.resolve())} />);
    openModal();
    const [quantity] = screen.getAllByPlaceholderText("Jumlah");

    fireEvent.change(quantity, { target: { value: "2" } });
    fireEvent.change(quantity, { target: { value: "2,5" } });
    expect(quantity).toHaveValue("2");
    expect(screen.getByText(WHOLE_MESSAGE)).toBeInTheDocument();

    fireEvent.change(quantity, { target: { value: "2.5" } });
    expect(quantity).toHaveValue("2");

    fireEvent.change(quantity, { target: { value: "3" } });
    expect(quantity).toHaveValue("3");
    expect(screen.queryByText(WHOLE_MESSAGE)).not.toBeInTheDocument();
  });

  test("a quantity cannot start with a decimal separator either", () => {
    render(<Host onSave={jest.fn(() => Promise.resolve())} />);
    openModal();
    const [quantity] = screen.getAllByPlaceholderText("Jumlah");

    fireEvent.change(quantity, { target: { value: "0,5" } });

    expect(quantity).toHaveValue("");
    expect(screen.getByText(WHOLE_MESSAGE)).toBeInTheDocument();
  });

  test.each([
    ["10000", "3.333"], // 3333.33 rounds down
    ["20000", "6.667"], // 6666.67 rounds up
    ["10001", "3.334"],
  ])("a total of %s over 3 gives a whole unit price of %s", (total, unitPrice) => {
    render(<Host onSave={jest.fn(() => Promise.resolve())} />);
    openModal();

    fireEvent.change(screen.getAllByPlaceholderText("Jumlah")[0], { target: { value: "3" } });
    fireEvent.change(screen.getAllByLabelText("Subtotal")[0], { target: { value: total } });

    expect(screen.getAllByLabelText("Harga satuan")[0]).toHaveValue(unitPrice);
  });

  test("a unit price already worked out from the total is rounded again when the quantity changes", () => {
    render(<Host onSave={jest.fn(() => Promise.resolve())} />);
    openModal();
    const [quantity] = screen.getAllByPlaceholderText("Jumlah");

    fireEvent.change(quantity, { target: { value: "3" } });
    fireEvent.change(screen.getAllByLabelText("Subtotal")[0], { target: { value: "10000" } });
    expect(screen.getAllByLabelText("Harga satuan")[0]).toHaveValue("3.333");

    // 7 x 3.333 is a whole rupiah amount, with no decimal part to misread
    fireEvent.change(quantity, { target: { value: "7" } });
    expect(screen.getAllByLabelText("Subtotal")[0]).toHaveValue("23.331");
  });

  test("a decimal quantity left in a saved draft blocks saving", () => {
    localStorage.setItem(
      "retail_purchase_draft_rows",
      JSON.stringify([
        { id: 1, product: PRODUCTS.p1, quantity: "2.5", unit: "pcs", hargaSatuan: "1.000", subtotal: "2.500" },
      ])
    );
    // Saving needs an uploaded nota, which a saved draft keeps as well
    localStorage.setItem(
      "retail_purchase_draft_uploaded_nota",
      JSON.stringify({ fileName: "nota.pdf", downloadURL: "https://example.test/nota.pdf" })
    );
    const onSave = jest.fn(() => Promise.resolve());
    render(<Host onSave={onSave} />);
    openModal();

    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));

    expect(screen.getByText(WHOLE_MESSAGE)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("saves a whole quantity as a whole purchase", async () => {
    uploadFile.mockResolvedValue("https://example.test/nota.pdf");
    generateIncrementalId.mockResolvedValue("BP-0001");
    const onSave = jest.fn(() => Promise.resolve());
    render(<Host onSave={onSave} />);
    openModal();
    await fillFirstRow();

    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() =>
      expect(onSave.mock.calls.some(([action]) => action === "updateStock")).toBe(true)
    );
    const [, stockUpdate] = onSave.mock.calls.find(([action]) => action === "updateStock");
    expect(stockUpdate).toEqual({ id: "p1", stock: 12, stockValue: 7000, lastPurchasePrice: 1000 });
  });
});
