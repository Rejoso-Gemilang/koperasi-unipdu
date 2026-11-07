import React, { useEffect, useRef, useState } from "react";
import "../styles/StockModal.css";
import {
  WHOLE_NUMBER_MESSAGE,
  hasDecimalSeparator,
  keepDigits,
  parseWholeNumber,
} from "../utils/stockTransactionUtils";

// Helper functions for Rupiah currency formatting
function formatRupiah(value) {
  if (value === undefined || value === null) return "";
  const numeric = value.toString().replace(/\D/g, "");
  if (!numeric) return "";
  return numeric.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Category lists
const KATEGORI_CHOICES = [
  "Makanan",
  "Minuman",
  "Sembako",
  "ATK",
  "Perawatan Diri",
  "Kesehatan",
  "Lainnya",
];

const SUBKATEGORI_MAKANAN = [
  "Makanan Ringan",
  "Makanan Siap Saji",
  "Bumbu",
  "Makanan Manis",
  "Roti & Kue",
  "Lainnya",
];

const SUBKATEGORI_PERAWATAN_DIRI = [
  "Kebersihan Tubuh",
  "Perawatan Rambut",
  "Mulut & Gigi",
  "Kewanitaan",
  "Lainnya",
];

const SUBKATEGORI_MINUMAN = [
  "Susu",
  "Soda",
  "Jus/Sari Buah",
  "Air Mineral",
  "Teh",
  "Kopi",
  "Saset/Serbuk",
  "Lainnya",
];

const SUBKATEGORI_KESEHATAN = [
  "Obat-Obatan",
  "Suplemen",
  "Alat Kesehatan",
  "Antiseptik",
  "Lainnya",
];

const SUBKATEGORI_ATK = [
  "Pulpen",
  "Pensil",
  "Buku",
  "Stipo",
  "Penghapus",
  "Kertas",
  "Lainnya",
];

const SUBKATEGORI_SEMBAKO = [
  "Beras",
  "Minyak",
  "Gula",
  "Tepung",
  "Telur",
  "Lainnya",
];

const TIPE_STOCK_CHOICES = [
  "Produksi Sendiri",
  "Kulak",
  "Titipan",
  "Supplier/Sales",
  "Lainnya",
];

const NAMA_PEMASOK_CHOICES = [
  "Nabati",
  "Mayorca",
  "Pocari",
  "Fruitea (Sosro)",
  "Kulkul",
  "Yarno Mineral",
  "Nestle",
  "Gerry",
  "Lainnya",
];

const BASE_UNIT_CHOICES = [
  { value: "pcs", label: "Pcs (pcs)" },
  { value: "kg", label: "Kilogram (kg)" },
  { value: "g", label: "Gram (g)" },
  { value: "ltr", label: "Liter (ltr)" },
  { value: "sack", label: "Sak (sack)" },
];

function WarehouseStockModal({
  dialogOpen,
  dialogType,
  selectedProductId,
  products,
  onClose,
  onSave,
  tempState: externalTempState,
  setTempState: externalSetTempState,
}) {
  // Local state mapped to SDRG fields
  const [localState, setLocalState] = useState({
    tempName: externalTempState.tempName || "",
    tempItemId: externalTempState.tempItemId || "",
    tempKategori: externalTempState.tempKategori || "",
    tempSubKategori: externalTempState.tempSubKategori || "",
    tempTipeStock: externalTempState.tempTipeStock || "",
    tempNamaPemasok: externalTempState.tempNamaPemasok || "",
    base_unit: externalTempState.base_unit || "pcs",
    bulk_unit_name: externalTempState.bulk_unit_name || "",
    bulk_unit_conversion: externalTempState.bulk_unit_conversion || "",
    cost_price: externalTempState.cost_price || "",
    price: externalTempState.price || "",
    tempAmount: externalTempState.tempAmount || "",
    tempSatuan: externalTempState.tempSatuan || "",
    tempCost: externalTempState.tempCost || "",
    tempDocId: externalTempState.tempDocId || "",
  });

  // Sync external state to local state
  useEffect(() => {
    setLocalState({
      tempName: externalTempState.tempName || "",
      tempItemId: externalTempState.tempItemId || "",
      tempKategori: externalTempState.tempKategori || "",
      tempSubKategori: externalTempState.tempSubKategori || "",
      tempTipeStock: externalTempState.tempTipeStock || "",
      tempNamaPemasok: externalTempState.tempNamaPemasok || "",
      base_unit: externalTempState.base_unit || "pcs",
      bulk_unit_name: externalTempState.bulk_unit_name || "",
      bulk_unit_conversion: externalTempState.bulk_unit_conversion || "",
      cost_price: externalTempState.cost_price || "",
      price: externalTempState.price || "",
      tempAmount: externalTempState.tempAmount || "",
      tempSatuan: externalTempState.tempSatuan || "",
      tempCost: externalTempState.tempCost || "",
      tempDocId: externalTempState.tempDocId || "",
    });
  }, [externalTempState, dialogType, selectedProductId]);

  // Sync back to parent state on change
  useEffect(() => {
    const handler = setTimeout(() => {
      externalSetTempState(localState);
    }, 100);
    return () => clearTimeout(handler);
  }, [localState, externalSetTempState]);

  const [formErrors, setFormErrors] = useState({});

  const validateForm = (type) => {
    const errors = {};

    if (type === "addNew" || type === "edit") {
      if (!localState.tempName.trim()) {
        errors.tempName = "Nama barang wajib diisi";
      }
      if (!localState.tempKategori) {
        errors.tempKategori = "Kategori wajib dipilih";
      }
      if (!localState.tempTipeStock) {
        errors.tempTipeStock = "Tipe stock wajib dipilih";
      }
      if (!localState.base_unit) {
        errors.base_unit = "Satuan dasar wajib dipilih";
      }
      
      // If either bulk unit name or conversion is provided, validate both
      if (localState.bulk_unit_name || localState.bulk_unit_conversion) {
        if (!localState.bulk_unit_name) {
          errors.bulk_unit_name = "Nama satuan besar wajib diisi";
        }
        if (!localState.bulk_unit_conversion || parseFloat(localState.bulk_unit_conversion) <= 0) {
          errors.bulk_unit_conversion = "Konversi wajib diisi dan harus > 0";
        }
      }

      if (!localState.price) {
        errors.price = "Harga jual wajib diisi";
      }
    }

    if (type === "tambah" || type === "tetapkan") {
      if (localState.tempAmount === "" || localState.tempAmount == null) {
        errors.tempAmount = "Jumlah wajib diisi";
      } else if (Number.isNaN(parseWholeNumber(localState.tempAmount))) {
        errors.tempAmount = WHOLE_NUMBER_MESSAGE;
      }
      if (!localState.tempSatuan) {
        errors.tempSatuan = "Satuan wajib dipilih";
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const firstFieldRef = useRef(null);

  // Focus first input on open
  useEffect(() => {
    if (dialogOpen && firstFieldRef.current) {
      setTimeout(() => {
        if (firstFieldRef.current) {
          firstFieldRef.current.focus();
        }
      }, 100);
    }
  }, [dialogOpen, dialogType]);

  // Close on ESC
  useEffect(() => {
    function handleEsc(e) {
      if (dialogOpen && e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [dialogOpen, onClose]);

  // Handlers for inputs
  // Stock is counted in whole numbers. A comma or dot is refused with a
  // message rather than dropped, so "0,5" can't turn into 5 unnoticed.
  function handleAmountChange(e) {
    const typed = e.target.value;
    if (hasDecimalSeparator(typed)) {
      setFormErrors((prev) => ({ ...prev, tempAmount: WHOLE_NUMBER_MESSAGE }));
      return;
    }
    setFormErrors((prev) => ({ ...prev, tempAmount: undefined }));
    setLocalState((prev) => ({
      ...prev,
      tempAmount: keepDigits(typed),
    }));
  }

  function handleCostChange(e) {
    const numericValue = e.target.value.replace(/\D/g, "");
    setLocalState((prev) => ({
      ...prev,
      tempCost: formatRupiah(numericValue),
    }));
  }

  function handlePriceChange(field, value) {
    const numericValue = value.replace(/\D/g, "");
    setLocalState((prev) => ({
      ...prev,
      [field]: formatRupiah(numericValue),
    }));
  }

  function handleKategoriChange(e) {
    const kategori = e.target.value;
    let subKategori = localState.tempSubKategori;

    if (
      kategori !== "Makanan" &&
      kategori !== "Minuman" &&
      kategori !== "Kesehatan" &&
      kategori !== "ATK" &&
      kategori !== "Perawatan Diri" &&
      kategori !== "Sembako"
    ) {
      subKategori = kategori;
    } else {
      subKategori = "";
    }

    setLocalState((prev) => ({
      ...prev,
      tempKategori: kategori,
      tempSubKategori: subKategori,
    }));
  }

  // Get sub-kategori choices based on selected kategori
  let subKategoriChoices = [];
  if (localState.tempKategori === "Makanan") {
    subKategoriChoices = SUBKATEGORI_MAKANAN;
  } else if (localState.tempKategori === "Minuman") {
    subKategoriChoices = SUBKATEGORI_MINUMAN;
  } else if (localState.tempKategori === "Kesehatan") {
    subKategoriChoices = SUBKATEGORI_KESEHATAN;
  } else if (localState.tempKategori === "Perawatan Diri") {
    subKategoriChoices = SUBKATEGORI_PERAWATAN_DIRI;
  } else if (localState.tempKategori === "ATK") {
    subKategoriChoices = SUBKATEGORI_ATK;
  } else if (localState.tempKategori === "Sembako") {
    subKategoriChoices = SUBKATEGORI_SEMBAKO;
  }

  // Delete Confirmation
  if (dialogType === "delete" && selectedProductId) {
    return (
      <div className="stockmodal-overlay">
        <div className="stockmodal-content">
          <h2>Hapus Barang</h2>
          <div className="stockmodal-body">
            <p>Apakah Anda yakin ingin menghapus {products[selectedProductId]?.name}?</p>
          </div>
          <div className="stockmodal-buttons">
            <button onClick={onClose}>Batal</button>
            <button onClick={() => onSave("delete")}>Hapus</button>
          </div>
        </div>
      </div>
    );
  }

  // Add / Edit Modal Layouts
  if (dialogType === "addNew" || dialogType === "edit") {
    const isEdit = dialogType === "edit";
    return (
      <div className="stockmodal-overlay">
        <div className="stockmodal-content">
          <h2>{isEdit ? "Edit Barang Gudang" : "Tambah Barang Baru Gudang"}</h2>
          <div className="stockmodal-body">
            <div className="form-group">
              <label>Nama Barang</label>
              <input
                ref={firstFieldRef}
                type="text"
                value={localState.tempName}
                onChange={(e) =>
                  setLocalState((prev) => ({ ...prev, tempName: e.target.value }))
                }
                className={formErrors.tempName ? "error" : ""}
                placeholder="Contoh: Gula Pasir"
              />
              {formErrors.tempName && (
                <div className="error-message">{formErrors.tempName}</div>
              )}
            </div>

            <div className="form-group">
              <label>{isEdit ? "Item ID (Barcode)" : "Doc ID / Barcode ID (Opsional)"}</label>
              <input
                type="text"
                value={isEdit ? localState.tempItemId : localState.tempDocId}
                onChange={(e) =>
                  setLocalState((prev) => ({
                    ...prev,
                    [isEdit ? "tempItemId" : "tempDocId"]: e.target.value,
                  }))
                }
                placeholder="Masukkan Barcode / ID produk"
              />
            </div>

            <div className="form-group">
              <label>Kategori</label>
              <select
                value={localState.tempKategori}
                onChange={handleKategoriChange}
                className={formErrors.tempKategori ? "error" : ""}
              >
                <option value="">-- Pilih Kategori --</option>
                {KATEGORI_CHOICES.map((kat) => (
                  <option key={kat} value={kat}>
                    {kat}
                  </option>
                ))}
              </select>
              {formErrors.tempKategori && (
                <div className="error-message">{formErrors.tempKategori}</div>
              )}
            </div>

            {subKategoriChoices.length > 0 ? (
              <div className="form-group">
                <label>Sub Kategori</label>
                <select
                  value={localState.tempSubKategori}
                  onChange={(e) =>
                    setLocalState((prev) => ({
                      ...prev,
                      tempSubKategori: e.target.value,
                    }))
                  }
                >
                  <option value="">-- Pilih Sub Kategori --</option>
                  {subKategoriChoices.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="form-group">
                <label>Sub Kategori</label>
                <input
                  type="text"
                  value={localState.tempSubKategori}
                  readOnly
                  placeholder="Kategori Lainnya"
                />
              </div>
            )}

            <div className="form-group">
              <label>Sumber Pasokan</label>
              <select
                value={localState.tempTipeStock}
                onChange={(e) =>
                  setLocalState((prev) => ({
                    ...prev,
                    tempTipeStock: e.target.value,
                  }))
                }
                className={formErrors.tempTipeStock ? "error" : ""}
              >
                <option value="">-- Pilih Sumber Pemasok --</option>
                {TIPE_STOCK_CHOICES.map((tipe) => (
                  <option key={tipe} value={tipe}>
                    {tipe}
                  </option>
                ))}
              </select>
              {formErrors.tempTipeStock && (
                <div className="error-message">{formErrors.tempTipeStock}</div>
              )}
            </div>

            <div className="form-group">
              <label>Nama Pemasok</label>
              <select
                value={localState.tempNamaPemasok}
                onChange={(e) =>
                  setLocalState((prev) => ({
                    ...prev,
                    tempNamaPemasok: e.target.value,
                  }))
                }
              >
                <option value="">-- Pilih Nama Pemasok --</option>
                {NAMA_PEMASOK_CHOICES.map((tipe) => (
                  <option key={tipe} value={tipe}>
                    {tipe}
                  </option>
                ))}
              </select>
            </div>

            {/* Units fields */}
            <div className="form-group">
              <label>Satuan Dasar (Terkecil)</label>
              <select
                value={localState.base_unit}
                onChange={(e) =>
                  setLocalState((prev) => ({ ...prev, base_unit: e.target.value }))
                }
                className={formErrors.base_unit ? "error" : ""}
              >
                {BASE_UNIT_CHOICES.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label}
                  </option>
                ))}
              </select>
              {formErrors.base_unit && (
                <div className="error-message">{formErrors.base_unit}</div>
              )}
            </div>

            <div className="form-group">
              <label>Nama Satuan Besar (Opsional)</label>
              <input
                type="text"
                value={localState.bulk_unit_name}
                onChange={(e) =>
                  setLocalState((prev) => ({
                    ...prev,
                    bulk_unit_name: e.target.value,
                  }))
                }
                placeholder="Contoh: Sak, Box, Kardus"
                className={formErrors.bulk_unit_name ? "error" : ""}
              />
              {formErrors.bulk_unit_name && (
                <div className="error-message">{formErrors.bulk_unit_name}</div>
              )}
            </div>

            {(localState.bulk_unit_name || localState.bulk_unit_conversion) && (
              <div className="form-group">
                <label>Konversi Satuan Besar</label>
                <div className="input-group" style={{ alignItems: "center" }}>
                  <span style={{ marginRight: "8px", fontSize: "0.95rem", color: "#666" }}>
                    1 {localState.bulk_unit_name || "Satuan Besar"} =
                  </span>
                  <input
                    type="number"
                    style={{ width: "100px", flex: "none" }}
                    value={localState.bulk_unit_conversion}
                    onChange={(e) =>
                      setLocalState((prev) => ({
                        ...prev,
                        bulk_unit_conversion: e.target.value,
                      }))
                    }
                    placeholder="e.g. 50"
                    min="1"
                    className={formErrors.bulk_unit_conversion ? "error" : ""}
                  />
                  <span style={{ marginLeft: "8px", fontSize: "0.95rem", color: "#666" }}>
                    {localState.base_unit}
                  </span>
                </div>
                {formErrors.bulk_unit_conversion && (
                  <div className="error-message">{formErrors.bulk_unit_conversion}</div>
                )}
              </div>
            )}

            {/* Pricing fields */}
            <div className="form-group">
              <label>Harga Beli (Modal) per {localState.base_unit}</label>
              <div className="currency-input">
                <span className="currency-prefix">Rp</span>
                <input
                  type="text"
                  value={localState.cost_price}
                  onChange={(e) => handlePriceChange("cost_price", e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Harga Jual per {localState.base_unit}</label>
              <div className="currency-input">
                <span className="currency-prefix">Rp</span>
                <input
                  type="text"
                  value={localState.price}
                  onChange={(e) => handlePriceChange("price", e.target.value)}
                  placeholder="0"
                  className={formErrors.price ? "error" : ""}
                  inputMode="numeric"
                />
              </div>
              {formErrors.price && (
                <div className="error-message">{formErrors.price}</div>
              )}
            </div>
          </div>
          <div className="stockmodal-buttons">
            <button onClick={onClose}>Batal</button>
            <button
              onClick={() => {
                if (validateForm(isEdit ? "edit" : "addNew")) {
                  onSave(isEdit ? "edit" : "addNew");
                }
              }}
            >
              Simpan
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Tambah Stok Modal (restock)
  if (
    dialogType === "tambah" &&
    selectedProductId &&
    products[selectedProductId]
  ) {
    const prod = products[selectedProductId];
    const baseUnit = prod.base_unit || prod.smallestUnit || "pcs";
    const units = [baseUnit, prod.bulk_unit_name].filter(Boolean);

    return (
      <div className="stockmodal-overlay">
        <div className="stockmodal-content">
          <h2>Tambah Stok</h2>
          <div className="stockmodal-body">
            {prod.bulk_unit_name && prod.bulk_unit_conversion && (
              <p style={{ textAlign: "left", fontSize: "0.95rem", margin: "0 0 16px 0", color: "#666" }}>
                <b>Konversi:</b> 1 {prod.bulk_unit_name} = {prod.bulk_unit_conversion} {baseUnit}
              </p>
            )}
            <div className="form-group">
              <label>Jumlah dan Satuan</label>
              <div className="input-group">
                <input
                  ref={firstFieldRef}
                  type="text"
                  inputMode="numeric"
                  value={localState.tempAmount}
                  onChange={handleAmountChange}
                  className={`quantity-input ${formErrors.tempAmount ? "error" : ""}`}
                  placeholder="Jumlah"
                />
                <select
                  value={localState.tempSatuan}
                  onChange={(e) =>
                    setLocalState((prev) => ({
                      ...prev,
                      tempSatuan: e.target.value,
                    }))
                  }
                  className={`unit-select ${formErrors.tempSatuan ? "error" : ""}`}
                >
                  <option value="">-- Satuan --</option>
                  {units.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
              {formErrors.tempAmount && (
                <div className="error-message">{formErrors.tempAmount}</div>
              )}
              {formErrors.tempSatuan && (
                <div className="error-message">{formErrors.tempSatuan}</div>
              )}
            </div>
            <div className="form-group">
              <label>Total Harga Beli (Rp)</label>
              <div className="currency-input">
                <span className="currency-prefix">Rp</span>
                <input
                  type="text"
                  value={localState.tempCost}
                  onChange={handleCostChange}
                  placeholder="e.g. 100.000"
                />
              </div>
            </div>
          </div>
          <div className="stockmodal-buttons">
            <button onClick={onClose}>Batal</button>
            <button
              onClick={() => {
                if (validateForm("tambah")) {
                  onSave("tambah");
                }
              }}
            >
              Simpan
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Tetapkan Stok Modal (stock take / adjustment)
  if (
    dialogType === "tetapkan" &&
    selectedProductId &&
    products[selectedProductId]
  ) {
    const prod = products[selectedProductId];
    const baseUnit = prod.base_unit || prod.smallestUnit || "pcs";
    const units = [baseUnit, prod.bulk_unit_name].filter(Boolean);

    return (
      <div className="stockmodal-overlay">
        <div className="stockmodal-content">
          <h2>Tetapkan Stok</h2>
          <div className="stockmodal-body">
            {prod.bulk_unit_name && prod.bulk_unit_conversion && (
              <p style={{ textAlign: "left", fontSize: "0.95rem", margin: "0 0 16px 0", color: "#666" }}>
                <b>Konversi:</b> 1 {prod.bulk_unit_name} = {prod.bulk_unit_conversion} {baseUnit}
              </p>
            )}
            <div className="form-group">
              <label>Jumlah dan Satuan</label>
              <div className="input-group">
                <input
                  ref={firstFieldRef}
                  type="text"
                  inputMode="numeric"
                  value={localState.tempAmount}
                  onChange={handleAmountChange}
                  className={`quantity-input ${formErrors.tempAmount ? "error" : ""}`}
                  placeholder="Jumlah"
                />
                <select
                  value={localState.tempSatuan}
                  onChange={(e) =>
                    setLocalState((prev) => ({
                      ...prev,
                      tempSatuan: e.target.value,
                    }))
                  }
                  className={`unit-select ${formErrors.tempSatuan ? "error" : ""}`}
                >
                  <option value="">-- Satuan --</option>
                  {units.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
              {formErrors.tempAmount && (
                <div className="error-message">{formErrors.tempAmount}</div>
              )}
              {formErrors.tempSatuan && (
                <div className="error-message">{formErrors.tempSatuan}</div>
              )}
            </div>
          </div>
          <div className="stockmodal-buttons">
            <button onClick={onClose}>Batal</button>
            <button
              onClick={() => {
                if (validateForm("tetapkan")) {
                  onSave("tetapkan");
                }
              }}
            >
              Simpan
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default WarehouseStockModal;
