import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import StockModal from "./StockModal";

const products = {
  p1: {
    name: "Kertas",
    base_unit: "pcs",
    bulk_unit_name: "pack",
    bulk_unit_conversion: 100,
    satuan: ["pcs", "pack"],
    stock: 10,
    stockValue: 5000,
  },
};

const renderModal = (dialogType, tempState = {}) => {
  const onSave = jest.fn();
  render(
    <StockModal
      dialogOpen
      dialogType={dialogType}
      selectedProductId="p1"
      products={products}
      onClose={jest.fn()}
      onSave={onSave}
      tempState={{ tempAmount: "", tempSatuan: "pcs", tempCost: "", ...tempState }}
      setTempState={jest.fn()}
      convertToSmallestUnit={jest.fn()}
    />
  );
  return { onSave };
};

describe("StockModal", () => {
  test("Tetapkan Stok only asks for the quantity", () => {
    renderModal("tetapkan");

    expect(screen.getByText("Tetapkan Stok")).toBeInTheDocument();
    expect(screen.getByText("Jumlah")).toBeInTheDocument();
    expect(screen.queryByText(/Harga Pembelian/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("e.g. 100.000")).not.toBeInTheDocument();
  });

  test("Tetapkan Stok saves without a price", () => {
    const { onSave } = renderModal("tetapkan", { tempAmount: "5" });

    fireEvent.click(screen.getByText("Simpan"));

    expect(onSave).toHaveBeenCalledWith("tetapkan");
  });

  test("Tetapkan Stok still requires a quantity", () => {
    const { onSave } = renderModal("tetapkan");

    fireEvent.click(screen.getByText("Simpan"));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Jumlah wajib diisi")).toBeInTheDocument();
  });

  test("Tambah Stok keeps its purchase price field", () => {
    renderModal("tambah");

    expect(screen.getByText("Total Harga Kulak (Rp)")).toBeInTheDocument();
  });

  test.each(["tambah", "tetapkan"])(
    "%s refuses a decimal quantity and says why",
    (dialogType) => {
      renderModal(dialogType, { tempAmount: "0" });
      const input = screen.getByPlaceholderText("Jumlah");

      // The comma is refused instead of being dropped (which would make "0,5" into 5)
      fireEvent.change(input, { target: { value: "0," } });
      expect(input).toHaveValue("0");
      expect(
        screen.getByText("Jumlah harus bilangan bulat (tanpa desimal)")
      ).toBeInTheDocument();

      fireEvent.change(input, { target: { value: "0.5" } });
      expect(input).toHaveValue("0");
    }
  );

  test("a pasted quantity with a decimal part is refused as a whole", () => {
    renderModal("tambah", { tempAmount: "7" });
    const input = screen.getByPlaceholderText("Jumlah");

    fireEvent.change(input, { target: { value: "1.500" } });

    expect(input).toHaveValue("7");
  });

  test("the message goes away once a whole number is typed", () => {
    renderModal("tambah", { tempAmount: "0" });
    const input = screen.getByPlaceholderText("Jumlah");

    fireEvent.change(input, { target: { value: "0," } });
    fireEvent.change(input, { target: { value: "5" } });

    expect(input).toHaveValue("5");
    expect(
      screen.queryByText("Jumlah harus bilangan bulat (tanpa desimal)")
    ).not.toBeInTheDocument();
  });

  test("the quantity field drops letters", () => {
    renderModal("tambah");
    const input = screen.getByPlaceholderText("Jumlah");

    fireEvent.change(input, { target: { value: "1a2" } });

    expect(input).toHaveValue("12");
  });

  test("a decimal quantity left over from a saved form cannot be saved", () => {
    const { onSave } = renderModal("tambah", { tempAmount: "2,5" });

    fireEvent.click(screen.getByText("Simpan"));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText("Jumlah harus bilangan bulat (tanpa desimal)")
    ).toBeInTheDocument();
  });

  test("a whole quantity can be saved", () => {
    const { onSave } = renderModal("tambah", { tempAmount: "5" });

    fireEvent.click(screen.getByText("Simpan"));

    expect(onSave).toHaveBeenCalledWith("tambah");
  });
});
