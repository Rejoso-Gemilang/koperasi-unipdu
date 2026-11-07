import React, { useEffect, useRef, useState } from "react";
import { FaShoppingCart, FaMoneyBillWave } from "react-icons/fa";
import "../styles/StockModal.css";
import {
  WHOLE_NUMBER_MESSAGE,
  hasDecimalSeparator,
  keepDigits,
  parseWholeNumber,
} from "../utils/stockTransactionUtils";

// Helper functions
function formatRupiah(value) {
  if (!value) return "";
  const numeric = value.toString().replace(/\D/g, "");
  if (!numeric) return "";
  return numeric.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseRupiah(value) {
  if (!value) return 0;
  const numeric = value.toString().replace(/\D/g, "");
  return parseInt(numeric, 10) || 0;
}

// Constants for category lists
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
const SMALLEST_UNITS = ["pcs", "gram", "ons", "kg", "kardus", "karton", "pack"];
const BULK_UNITS = ["box", "sak", "pack", "bal", "lusin", "rim"];

function StockModal({
  dialogOpen,
  dialogType,
  selectedProductId,
  products,
  onClose,
  onSave,
  tempState: externalTempState,
  setTempState: externalSetTempState,
  convertToSmallestUnit,
}) {
  // Local state for form values


  const [localState, setLocalState] = useState({
    tempName: externalTempState.tempName || "",
    tempItemId: externalTempState.tempItemId || "",
    tempKategori: externalTempState.tempKategori || "",
    tempSubKategori: externalTempState.tempSubKategori || "",
    tempTipeStock: externalTempState.tempTipeStock || "",
    tempNamaPemasok: externalTempState.tempNamaPemasok || "",
    tempBaseUnit: externalTempState.tempBaseUnit || "",
    tempBulkUnitName: externalTempState.tempBulkUnitName || "",
    tempPricePerUnit: { ...(externalTempState.tempPricePerUnit || {}) },
    tempAmount: externalTempState.tempAmount || "",
    tempSatuan: externalTempState.tempSatuan || "",
    tempCost: externalTempState.tempCost || "",
    tempBulkUnitConversion: externalTempState.tempBulkUnitConversion || "",
    tempDocId: externalTempState.tempDocId || "",
    originalSmallestUnit: externalTempState.originalSmallestUnit || "",
    tempLastPurchasePrice: externalTempState.tempLastPurchasePrice || "",
  });

  // Sync external state with local state when props change
  useEffect(() => {
    setLocalState({
      tempName: externalTempState.tempName || "",
      tempItemId: externalTempState.tempItemId || "",
      tempKategori: externalTempState.tempKategori || "",
      tempSubKategori: externalTempState.tempSubKategori || "",
      tempTipeStock: externalTempState.tempTipeStock || "",
      tempNamaPemasok: externalTempState.tempNamaPemasok || "",
      tempBaseUnit: externalTempState.tempBaseUnit || "",
      tempBulkUnitName: externalTempState.tempBulkUnitName || "",
      tempPricePerUnit: { ...(externalTempState.tempPricePerUnit || {}) },
      tempAmount: externalTempState.tempAmount || "",
      tempSatuan: externalTempState.tempSatuan || "",
      tempCost: externalTempState.tempCost || "",
      tempBulkUnitConversion: externalTempState.tempBulkUnitConversion || "",
      tempDocId: externalTempState.tempDocId || "",
      originalSmallestUnit: externalTempState.originalSmallestUnit || "",
      tempLastPurchasePrice: externalTempState.tempLastPurchasePrice || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogType, selectedProductId]);

  // Update parent state whenever local state changes (debounced)
  useEffect(() => {
    const handler = setTimeout(() => {
      externalSetTempState(localState);
    }, 100);

    return () => {
      clearTimeout(handler);
    };
  }, [localState, externalSetTempState]);
  const [formErrors, setFormErrors] = useState({});


  // Validate form before save
  const validateForm = (type) => {
    const errors = {};

    if (type === "addNew" || type === "edit") {
      if (!localState.tempName.trim())
        errors.tempName = "Nama barang wajib diisi";
      if (!localState.tempKategori)
        errors.tempKategori = "Kategori wajib dipilih";
      if (!localState.tempTipeStock)
        errors.tempTipeStock = "Tipe stock wajib dipilih";
      if (!localState.tempBaseUnit)
        errors.tempBaseUnit = "Unit terkecil wajib dipilih";

      // Validate bulk unit conversion if bulk unit is selected
      if (localState.tempBulkUnitName && !localState.tempBulkUnitConversion) {
        errors.tempBulkUnitConversion = "Konversi Satuan Besar wajib diisi";
      }

      // Validate prices for all active units
      const activeUnits = [localState.tempBaseUnit, localState.tempBulkUnitName].filter(Boolean);
      for (const u of activeUnits) {
        if (!localState.tempPricePerUnit[u] || !localState.tempPricePerUnit[u].toString().trim()) {
          errors[`price_${u}`] = `Harga jual untuk satuan ${u} wajib diisi`;
        }
      }
    }

    if (type === "tambah" || type === "tetapkan") {
      if (localState.tempAmount === "" || localState.tempAmount == null)
        errors.tempAmount = "Jumlah wajib diisi";
      else if (Number.isNaN(parseWholeNumber(localState.tempAmount)))
        errors.tempAmount = WHOLE_NUMBER_MESSAGE;
      if (!localState.tempSatuan) errors.tempSatuan = "Satuan wajib dipilih";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const firstFieldRef = useRef(null);

  // Focus on the first field when the modal opens
  useEffect(() => {
    if (dialogOpen && firstFieldRef.current) {
      setTimeout(() => {
        if (firstFieldRef.current) {
          firstFieldRef.current.focus();
        }
      }, 100);
    }
  }, [dialogOpen, dialogType]);

  // Close modal when Escape key is pressed
  useEffect(() => {
    function handleEsc(e) {
      if (dialogOpen && e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [dialogOpen, onClose]);

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

  // Handle cost change with Rupiah formatting
  function handleCostChange(e) {
    const numericValue = e.target.value.replace(/\D/g, "");
    setLocalState((prev) => ({
      ...prev,
      tempCost: formatRupiah(numericValue),
    }));
  }

  // Handle bulk unit conversion change
  function handleBulkUnitConversionChange(e) {
    const numeric = e.target.value.replace(/\D/g, "");
    setLocalState((prev) => ({
      ...prev,
      tempBulkUnitConversion: numeric,
    }));
  }

  // Handle base unit name change
  function handleBaseUnitChange(e) {
    const newUnit = e.target.value;
    setLocalState((prev) => {
      const oldUnit = prev.tempBaseUnit;
      const newPricePerUnit = { ...prev.tempPricePerUnit };
      if (oldUnit && newPricePerUnit[oldUnit] !== undefined) {
        newPricePerUnit[newUnit] = newPricePerUnit[oldUnit];
        if (oldUnit !== newUnit) {
          delete newPricePerUnit[oldUnit];
        }
      }
      return {
        ...prev,
        tempBaseUnit: newUnit,
        tempPricePerUnit: newPricePerUnit,
      };
    });
  }

  // Handle bulk unit name change
  function handleBulkUnitNameChange(e) {
    const newUnit = e.target.value;
    setLocalState((prev) => {
      const oldUnit = prev.tempBulkUnitName;
      const baseUnit = prev.tempBaseUnit;
      const newPricePerUnit = { ...prev.tempPricePerUnit };
      
      if (oldUnit && oldUnit !== baseUnit) {
        if (newUnit) {
          newPricePerUnit[newUnit] = prev.tempPricePerUnit[oldUnit] || "";
        }
        delete newPricePerUnit[oldUnit];
      }
      
      return {
        ...prev,
        tempBulkUnitName: newUnit,
        tempBulkUnitConversion: newUnit ? prev.tempBulkUnitConversion : "",
        tempPricePerUnit: newPricePerUnit,
      };
    });
  }
  function handlePriceChange(unit, val) {
    try {
      // Allow only numeric input first
      const numericValue = val.replace(/\D/g, "");

      // Format the number
      const formatted = numericValue ? formatRupiah(numericValue) : "";

      // Update the local state
      setLocalState((prev) => {
        const newPricePerUnit = {
          ...prev.tempPricePerUnit,
          [unit]: formatted,
        };

        return {
          ...prev,
          tempPricePerUnit: newPricePerUnit,
        };
      });
    } catch (error) {
      console.error(`Error updating price for ${unit}:`, error);
    }
  }

  // Handler for kategori change
  function handleKategoriChange(e) {
    const kategori = e.target.value;
    let subKategori = localState.tempSubKategori;

    // Auto-set subKategori if it's not a special kategori
    if (
      kategori !== "Makanan" &&
      kategori !== "Minuman" &&
      kategori !== "Kesehatan" &&
      kategori !== "Perawatan Diri" &&
      kategori !== "ATK" &&
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

  // Delete Confirmation Dialog
  if (dialogType === "delete" && selectedProductId) {
    return (
      <div className="stockmodal-overlay">
        <div className="stockmodal-content">
          <h2>Delete Stock</h2>
          <div className="stockmodal-body">
            <p>Yakin mau delete {products[selectedProductId]?.name}?</p>
          </div>
          <div className="stockmodal-buttons">
            <button onClick={onClose}>No</button>
            <button onClick={() => onSave("delete")}>Yes</button>
          </div>
        </div>
      </div>
    );
  }

  // Add New Stock Modal
  if (dialogType === "addNew") {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col">
          <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">Tambah Barang Baru</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl font-semibold leading-none">&times;</button>
          </div>
          <div className="p-6 overflow-y-auto flex-grow space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Barang</label>
                <input
                  ref={firstFieldRef}
                  type="text"
                  value={localState.tempName}
                  onChange={(e) =>
                    setLocalState((prev) => ({
                      ...prev,
                      tempName: e.target.value,
                    }))
                  }
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempName ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
                />
                {formErrors.tempName && (
                  <span className="text-xs text-red-600 mt-1 block">{formErrors.tempName}</span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Doc ID (opsional)</label>
                <input
                  type="text"
                  value={localState.tempDocId}
                  onChange={(e) =>
                    setLocalState((prev) => ({
                      ...prev,
                      tempDocId: e.target.value,
                    }))
                  }
                  className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kategori</label>
                <select
                  value={localState.tempKategori}
                  onChange={handleKategoriChange}
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempKategori ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
                >
                  <option value="">-- Pilih Kategori --</option>
                  {KATEGORI_CHOICES.map((kat) => (
                    <option key={kat} value={kat}>
                      {kat}
                    </option>
                  ))}
                </select>
                {formErrors.tempKategori && (
                  <span className="text-xs text-red-600 mt-1 block">{formErrors.tempKategori}</span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sub Kategori</label>
                {localState.tempKategori === "Makanan" ||
                localState.tempKategori === "Minuman" ||
                localState.tempKategori === "Perawatan Diri" ||
                localState.tempKategori === "ATK" ||
                localState.tempKategori === "Kesehatan" ? (
                  <select
                    value={localState.tempSubKategori}
                    onChange={(e) =>
                      setLocalState((prev) => ({
                        ...prev,
                        tempSubKategori: e.target.value,
                      }))
                    }
                    className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm"
                  >
                    <option value="">-- Pilih SubKategori --</option>
                    {subKategoriChoices.map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={localState.tempSubKategori}
                    readOnly
                    className="w-full p-2 border border-gray-200 bg-gray-50 rounded text-gray-500 text-sm outline-none cursor-not-allowed"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sumber Pasokan</label>
                <select
                  value={localState.tempTipeStock}
                  onChange={(e) =>
                    setLocalState((prev) => ({
                      ...prev,
                      tempTipeStock: e.target.value,
                    }))
                  }
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempTipeStock ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
                >
                  <option value="">-- Pilih Tipe --</option>
                  {TIPE_STOCK_CHOICES.map((tipe) => (
                    <option key={tipe} value={tipe}>
                      {tipe}
                    </option>
                  ))}
                </select>
                {formErrors.tempTipeStock && (
                  <span className="text-xs text-red-600 mt-1 block">{formErrors.tempTipeStock}</span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Pemasok</label>
                <select
                  value={localState.tempNamaPemasok}
                  onChange={(e) =>
                    setLocalState((prev) => ({
                      ...prev,
                      tempNamaPemasok: e.target.value,
                    }))
                  }
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempNamaPemasok ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
                >
                  <option value="">-- Pilih Nama Pemasok --</option>
                  {NAMA_PEMASOK_CHOICES.map((tipe) => (
                    <option key={tipe} value={tipe}>
                      {tipe}
                    </option>
                  ))}
                </select>
                {formErrors.tempNamaPemasok && (
                  <span className="text-xs text-red-600 mt-1 block">{formErrors.tempNamaPemasok}</span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Satuan Dasar (Wajib)</label>
                <select
                  value={localState.tempBaseUnit}
                  onChange={handleBaseUnitChange}
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempBaseUnit ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
                  required
                >
                  <option value="">-- Pilih Satuan Dasar --</option>
                  {SMALLEST_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
                {formErrors.tempBaseUnit && (
                  <span className="text-xs text-red-600 mt-1 block">{formErrors.tempBaseUnit}</span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Satuan Besar (Opsional)</label>
                <select
                  value={localState.tempBulkUnitName}
                  onChange={handleBulkUnitNameChange}
                  className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm"
                >
                  <option value="">-- Tanpa Satuan Besar --</option>
                  {BULK_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>

              {localState.tempBulkUnitName && (
                <div className="md:col-span-2 bg-yellow-50 p-4 rounded-xl border border-yellow-200">
                  <label className="block text-sm font-semibold text-yellow-950 mb-1">Konversi Satuan Besar</label>
                  <div className="flex items-center text-sm text-gray-700 gap-1.5 mt-1">
                    <span>1 {localState.tempBulkUnitName} = </span>
                    <input
                      type="number"
                      value={localState.tempBulkUnitConversion}
                      onChange={handleBulkUnitConversionChange}
                      placeholder="e.g. 10"
                      min="1"
                      className={`w-24 p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm text-center bg-white ${
                        formErrors.tempBulkUnitConversion ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                      }`}
                      required
                    />
                    <span className="font-semibold text-gray-900">{localState.tempBaseUnit || 'Satuan Dasar'}</span>
                  </div>
                  {formErrors.tempBulkUnitConversion && (
                    <span className="text-xs text-red-600 mt-1 block">{formErrors.tempBulkUnitConversion}</span>
                  )}
                </div>
              )}

              {/* Harga Jual per Satuan */}
              <div className="md:col-span-2 bg-green-50 p-4 rounded-xl border border-green-200 mt-2">
                <label className="flex items-center gap-2 text-sm font-bold text-green-900 mb-3">
                  <FaMoneyBillWave className="text-green-600" />
                  Harga Jual per Satuan
                </label>
                <div className="grid grid-cols-2 gap-4">
                   {[localState.tempBaseUnit, localState.tempBulkUnitName].filter(Boolean).map((u) => {
                    const isBulk = u === localState.tempBulkUnitName;
                    let labelSuffix = "";
                    if (isBulk && localState.tempBulkUnitConversion) {
                      const bulkVal = parseRupiah(localState.tempPricePerUnit[u]);
                      const conversion = parseInt(localState.tempBulkUnitConversion, 10);
                      if (bulkVal > 0 && conversion > 1) {
                        const perUnitPrice = Math.round(bulkVal / conversion);
                        labelSuffix = ` (Rp ${formatRupiah(perUnitPrice)}/${localState.tempBaseUnit || "pcs"})`;
                      }
                    }
                    return (
                      <div key={u} className="flex flex-col">
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                          {u}{labelSuffix}
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-gray-400 text-sm">Rp</span>
                          <input
                            type="text"
                            value={localState.tempPricePerUnit[u] || ""}
                            onChange={(e) => handlePriceChange(u, e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder="e.g. 10.000"
                            inputMode="numeric"
                            className="w-full pl-9 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm bg-white font-medium text-gray-900"
                          />
                        </div>
                        {formErrors[`price_${u}`] && (
                          <span className="text-xs text-red-600 mt-1 block">{formErrors[`price_${u}`]}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Harga Beli */}
              <div className="md:col-span-2 bg-blue-50 p-4 rounded-xl border border-blue-200 mt-2">
                <label className="flex items-center gap-2 text-sm font-bold text-blue-900 mb-3">
                  <FaShoppingCart className="text-blue-600" />
                  Harga Beli per Satuan Dasar ({localState.tempBaseUnit || "pcs"})
                </label>
                <div className="relative max-w-xs">
                  <span className="absolute left-3 top-2 text-gray-400 text-sm">Rp</span>
                  <input
                    type="text"
                    value={localState.tempLastPurchasePrice || ""}
                    onChange={(e) => {
                      const formatted = formatRupiah(e.target.value);
                      setLocalState((prev) => ({
                        ...prev,
                        tempLastPurchasePrice: formatted,
                      }));
                    }}
                    onFocus={(e) => e.target.select()}
                    placeholder="e.g. 8.000"
                    inputMode="numeric"
                    className="w-full pl-9 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm bg-white font-medium text-gray-900"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-xl">
            <button
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              onClick={onClose}
            >
              Batal
            </button>
            <button
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition"
              onClick={() => {
                if (validateForm("addNew")) {
                  onSave("addNew");
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

  // Edit Stock Modal
  if (
    dialogType === "edit" &&
    selectedProductId &&
    products[selectedProductId]
  ) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col">
          <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">Edit Stock</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl font-semibold leading-none">&times;</button>
          </div>
          <div className="p-6 overflow-y-auto flex-grow space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Barang</label>
                <input
                  ref={firstFieldRef}
                  type="text"
                  value={localState.tempName}
                  onChange={(e) =>
                    setLocalState((prev) => ({
                      ...prev,
                      tempName: e.target.value,
                    }))
                  }
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempName ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
                />
                {formErrors.tempName && (
                  <span className="text-xs text-red-600 mt-1 block">{formErrors.tempName}</span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item ID (Barcode)</label>
                <input
                  type="text"
                  value={localState.tempItemId}
                  onChange={(e) =>
                    setLocalState((prev) => ({
                      ...prev,
                      tempItemId: e.target.value,
                    }))
                  }
                  placeholder="Enter barcode ID"
                  className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kategori</label>
                <select
                  value={localState.tempKategori}
                  onChange={handleKategoriChange}
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempKategori ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
                >
                  <option value="">-- Pilih Kategori --</option>
                  {KATEGORI_CHOICES.map((kat) => (
                    <option key={kat} value={kat}>
                      {kat}
                    </option>
                  ))}
                </select>
                {formErrors.tempKategori && (
                  <span className="text-xs text-red-600 mt-1 block">{formErrors.tempKategori}</span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sub Kategori</label>
                {subKategoriChoices.length > 0 ? (
                  <select
                    value={localState.tempSubKategori}
                    onChange={(e) =>
                      setLocalState((prev) => ({
                        ...prev,
                        tempSubKategori: e.target.value,
                      }))
                    }
                    className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm"
                  >
                    <option value="">-- Pilih SubKategori --</option>
                    {subKategoriChoices.map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={localState.tempSubKategori}
                    readOnly
                    className="w-full p-2 border border-gray-200 bg-gray-50 rounded text-gray-500 text-sm outline-none cursor-not-allowed"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sumber Pasokan</label>
                <select
                  value={localState.tempTipeStock}
                  onChange={(e) =>
                    setLocalState((prev) => ({
                      ...prev,
                      tempTipeStock: e.target.value,
                    }))
                  }
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempTipeStock ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
                >
                  <option value="">-- Pilih Tipe --</option>
                  {TIPE_STOCK_CHOICES.map((tipe) => (
                    <option key={tipe} value={tipe}>
                      {tipe}
                    </option>
                  ))}
                </select>
                {formErrors.tempTipeStock && (
                  <span className="text-xs text-red-600 mt-1 block">{formErrors.tempTipeStock}</span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Pemasok</label>
                <select
                  value={localState.tempNamaPemasok}
                  onChange={(e) =>
                    setLocalState((prev) => ({
                      ...prev,
                      tempNamaPemasok: e.target.value,
                    }))
                  }
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempNamaPemasok ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
                >
                  <option value="">-- Pilih Nama Pemasok --</option>
                  {NAMA_PEMASOK_CHOICES.map((tipe) => (
                    <option key={tipe} value={tipe}>
                      {tipe}
                    </option>
                  ))}
                </select>
                {formErrors.tempNamaPemasok && (
                  <span className="text-xs text-red-600 mt-1 block">{formErrors.tempNamaPemasok}</span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Satuan Dasar (Wajib)</label>
                <select
                  value={localState.tempBaseUnit}
                  onChange={handleBaseUnitChange}
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempBaseUnit ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
                  required
                >
                  <option value="">-- Pilih Satuan Dasar --</option>
                  {SMALLEST_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
                {formErrors.tempBaseUnit && (
                  <span className="text-xs text-red-600 mt-1 block">{formErrors.tempBaseUnit}</span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Satuan Besar (Opsional)</label>
                <select
                  value={localState.tempBulkUnitName}
                  onChange={handleBulkUnitNameChange}
                  className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm"
                >
                  <option value="">-- Tanpa Satuan Besar --</option>
                  {BULK_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>

              {localState.tempBulkUnitName && (
                <div className="md:col-span-2 bg-yellow-50 p-4 rounded-xl border border-yellow-200">
                  <label className="block text-sm font-semibold text-yellow-950 mb-1">Konversi Satuan Besar</label>
                  <div className="flex items-center text-sm text-gray-700 gap-1.5 mt-1">
                    <span>1 {localState.tempBulkUnitName} = </span>
                    <input
                      type="number"
                      value={localState.tempBulkUnitConversion}
                      onChange={handleBulkUnitConversionChange}
                      placeholder="e.g. 10"
                      min="1"
                      className={`w-24 p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm text-center bg-white ${
                        formErrors.tempBulkUnitConversion ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                      }`}
                      required
                    />
                    <span className="font-semibold text-gray-900">{localState.tempBaseUnit || 'Satuan Dasar'}</span>
                  </div>
                  {formErrors.tempBulkUnitConversion && (
                    <span className="text-xs text-red-600 mt-1 block">{formErrors.tempBulkUnitConversion}</span>
                  )}
                </div>
              )}

              {/* Harga Jual per Satuan */}
              <div className="md:col-span-2 bg-green-50 p-4 rounded-xl border border-green-200 mt-2">
                <label className="flex items-center gap-2 text-sm font-bold text-green-900 mb-3">
                  <FaMoneyBillWave className="text-green-600" />
                  Harga Jual per Satuan
                </label>
                <div className="grid grid-cols-2 gap-4">
                   {[localState.tempBaseUnit, localState.tempBulkUnitName].filter(Boolean).map((u) => {
                    const isBulk = u === localState.tempBulkUnitName;
                    let labelSuffix = "";
                    if (isBulk && localState.tempBulkUnitConversion) {
                      const bulkVal = parseRupiah(localState.tempPricePerUnit[u]);
                      const conversion = parseInt(localState.tempBulkUnitConversion, 10);
                      if (bulkVal > 0 && conversion > 1) {
                        const perUnitPrice = Math.round(bulkVal / conversion);
                        labelSuffix = ` (Rp ${formatRupiah(perUnitPrice)}/${localState.tempBaseUnit || "pcs"})`;
                      }
                    }
                    return (
                      <div key={u} className="flex flex-col">
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                          {u}{labelSuffix}
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-2 text-gray-400 text-sm">Rp</span>
                          <input
                            type="text"
                            value={localState.tempPricePerUnit[u] || ""}
                            onChange={(e) => handlePriceChange(u, e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder="e.g. 10.000"
                            inputMode="numeric"
                            className="w-full pl-9 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm bg-white font-medium text-gray-900"
                          />
                        </div>
                        {formErrors[`price_${u}`] && (
                          <span className="text-xs text-red-600 mt-1 block">{formErrors[`price_${u}`]}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Harga Beli */}
              <div className="md:col-span-2 bg-blue-50 p-4 rounded-xl border border-blue-200 mt-2">
                <label className="flex items-center gap-2 text-sm font-bold text-blue-900 mb-3">
                  <FaShoppingCart className="text-blue-600" />
                  Harga Beli per Satuan Dasar ({localState.tempBaseUnit || "pcs"})
                </label>
                <div className="relative max-w-xs">
                  <span className="absolute left-3 top-2 text-gray-400 text-sm">Rp</span>
                  <input
                    type="text"
                    value={localState.tempLastPurchasePrice || ""}
                    onChange={(e) => {
                      const formatted = formatRupiah(e.target.value);
                      setLocalState((prev) => ({
                        ...prev,
                        tempLastPurchasePrice: formatted,
                      }));
                    }}
                    onFocus={(e) => e.target.select()}
                    placeholder="e.g. 8.000"
                    inputMode="numeric"
                    className="w-full pl-9 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm bg-white font-medium text-gray-900"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-between items-center px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-xl">
            <button
              className="px-4 py-2 bg-red-50 border border-red-200 hover:bg-red-100 text-red-600 rounded-lg text-sm font-semibold transition"
              onClick={() => {
                const prod = products[selectedProductId];
                if (window.confirm(`Apakah Anda yakin ingin menghapus produk "${prod?.name}" dari sistem?`)) {
                  onSave("delete");
                }
              }}
            >
              Hapus Produk
            </button>
            <div className="flex gap-3">
              <button
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                onClick={onClose}
              >
                Batal
              </button>
              <button
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition"
                onClick={() => {
                  if (validateForm("edit")) {
                    onSave("edit");
                  }
                }}
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Tambah Stock Modal
  if (
    dialogType === "tambah" &&
    selectedProductId &&
    products[selectedProductId]
  ) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col">
          <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">Tambah Stok</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl font-semibold leading-none">&times;</button>
          </div>
          <div className="p-6 overflow-y-auto flex-grow space-y-4">
            {(() => {
              const prod = products[selectedProductId];
              const conv = prod.bulk_unit_conversion || prod.piecesPerBox;
              const name = prod.bulk_unit_name || (prod.satuan ? prod.satuan.find(u => u !== (prod.base_unit || prod.smallestUnit)) : "");
              if (name && conv) {
                return (
                  <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200 text-sm text-yellow-950 font-medium text-center">
                    1 {name} = {conv} {prod.base_unit || prod.smallestUnit}
                  </div>
                );
              }
              return null;
            })()}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Jumlah</label>
              <div className="flex gap-2">
                <input
                  ref={firstFieldRef}
                  type="text"
                  inputMode="numeric"
                  value={localState.tempAmount}
                  onChange={handleAmountChange}
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempAmount ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
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
                  className="w-28 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm bg-white text-gray-900 font-medium"
                >
                  {(() => {
                    const prod = products[selectedProductId];
                    const base = prod.base_unit || prod.smallestUnit || "";
                    const bulk = prod.bulk_unit_name || (prod.satuan ? prod.satuan.find(u => u !== base) : "");
                    const options = prod.satuan || [base, bulk].filter(Boolean);
                    return options.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ));
                  })()}
                </select>
              </div>
              {formErrors.tempAmount && (
                <span className="text-xs text-red-600 mt-1 block">{formErrors.tempAmount}</span>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Harga Kulak (Rp)</label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-gray-400 text-sm">Rp</span>
                <input
                  type="text"
                  value={localState.tempCost}
                  onChange={handleCostChange}
                  className="w-full pl-9 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm font-medium text-gray-900"
                  placeholder="e.g. 100.000"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-200">
            <button
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              onClick={onClose}
            >
              Batal
            </button>
            <button
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition"
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

  // Tetapkan Stock Modal
  if (
    dialogType === "tetapkan" &&
    selectedProductId &&
    products[selectedProductId]
  ) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col">
          <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">Tetapkan Stok</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl font-semibold leading-none">&times;</button>
          </div>
          <div className="p-6 overflow-y-auto flex-grow space-y-4">
            {(() => {
              const prod = products[selectedProductId];
              const conv = prod.bulk_unit_conversion || prod.piecesPerBox;
              const name = prod.bulk_unit_name || (prod.satuan ? prod.satuan.find(u => u !== (prod.base_unit || prod.smallestUnit)) : "");
              if (name && conv) {
                return (
                  <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200 text-sm text-yellow-950 font-medium text-center">
                    1 {name} = {conv} {prod.base_unit || prod.smallestUnit}
                  </div>
                );
              }
              return null;
            })()}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Jumlah</label>
              <div className="flex gap-2">
                <input
                  ref={firstFieldRef}
                  type="text"
                  inputMode="numeric"
                  value={localState.tempAmount}
                  onChange={handleAmountChange}
                  className={`w-full p-2 border rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm ${
                    formErrors.tempAmount ? "border-red-500 ring-1 ring-red-500" : "border-gray-300"
                  }`}
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
                  className="w-28 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm bg-white text-gray-900 font-medium"
                >
                  {(() => {
                    const prod = products[selectedProductId];
                    const base = prod.base_unit || prod.smallestUnit || "";
                    const bulk = prod.bulk_unit_name || (prod.satuan ? prod.satuan.find(u => u !== base) : "");
                    const options = prod.satuan || [base, bulk].filter(Boolean);
                    return options.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ));
                  })()}
                </select>
              </div>
              {formErrors.tempAmount && (
                <span className="text-xs text-red-600 mt-1 block">{formErrors.tempAmount}</span>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-200">
            <button
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              onClick={onClose}
            >
              Batal
            </button>
            <button
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition"
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

  // Return null if dialogType is not recognized or dialog should be closed
  return null;
}

export default StockModal;
