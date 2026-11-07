import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import WarehouseExitModal from "./WarehouseExitModal";

const WHOLE_MESSAGE = "Jumlah harus bilangan bulat (tanpa desimal)";

const PRODUCT = {
  id: "b1",
  itemId: "900",
  name: "Beras Premium",
  base_unit: "kg",
  stock: 100,
  price: 7000,
  cost_price: 5000,
};

const renderModal = () => {
  const onSave = jest.fn(() => Promise.resolve());
  render(
    <WarehouseExitModal
      isOpen
      onClose={jest.fn()}
      onSave={onSave}
      products={{ b1: PRODUCT }}
      currentUser={{ email: "gudang@unipdu.ac.id" }}
    />
  );
  return { onSave };
};

const quantityBoxes = () => screen.getAllByPlaceholderText("Jumlah");

const pickProduct = async () => {
  const search = screen.getAllByPlaceholderText("Cari produk...")[0];
  fireEvent.focus(search);
  fireEvent.change(search, { target: { value: "Beras" } });
  fireEvent.mouseDown(await screen.findByText("Beras Premium"));
};

describe("Keluar Gudang quantities are whole numbers", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test("refuses a comma or dot and says why, instead of reading 1,5 as 15", () => {
    renderModal();
    const [quantity] = quantityBoxes();

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
    renderModal();
    const [quantity] = quantityBoxes();

    fireEvent.change(quantity, { target: { value: "0,5" } });

    expect(quantity).toHaveValue("");
    expect(screen.getByText(WHOLE_MESSAGE)).toBeInTheDocument();
  });

  test("the quantity box asks for a number pad and no longer suggests 1.5", () => {
    renderModal();

    expect(screen.queryByPlaceholderText(/1\.5/)).not.toBeInTheDocument();
    quantityBoxes().forEach((box) => expect(box).toHaveAttribute("inputmode", "numeric"));
  });

  test("works out the subtotal in whole rupiah", async () => {
    renderModal();
    await pickProduct();

    fireEvent.change(quantityBoxes()[0], { target: { value: "3" } });

    expect(screen.getByDisplayValue("Rp 21.000")).toBeInTheDocument();
  });

  test("a decimal quantity left in a saved draft blocks saving", () => {
    localStorage.setItem(
      "b2b_exit_draft_rows",
      JSON.stringify([
        {
          id: 1,
          product: PRODUCT,
          quantity: "2.5",
          unit: "kg",
          hargaKulak: "5.000",
          unitPrice: "7.000",
          subtotal: "17.500",
        },
      ])
    );
    localStorage.setItem("b2b_exit_draft_customer_name", "Asrama Putra");
    localStorage.setItem("b2b_exit_draft_business_type", "Asrama");
    const { onSave } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Create Record" }));

    expect(screen.getByText(WHOLE_MESSAGE)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("a whole quantity can be saved", () => {
    localStorage.setItem(
      "b2b_exit_draft_rows",
      JSON.stringify([
        {
          id: 1,
          product: PRODUCT,
          quantity: "3",
          unit: "kg",
          hargaKulak: "5.000",
          unitPrice: "7.000",
          subtotal: "21.000",
        },
      ])
    );
    localStorage.setItem("b2b_exit_draft_customer_name", "Asrama Putra");
    localStorage.setItem("b2b_exit_draft_business_type", "Asrama");
    const { onSave } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Create Record" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ quantity: 3, unitPrice: 7000, subtotal: 21000 })],
        total: 21000,
      }),
      expect.any(Array)
    );
  });
});
