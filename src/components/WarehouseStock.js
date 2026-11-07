import React, { useState, useEffect, useRef } from "react";
import {
  FaCalendarAlt,
} from "react-icons/fa";
import * as XLSX from "xlsx";
import "../styles/Stocks.css";
import { useAuth } from "../context/AuthContext";
import { useFirestore } from "../context/FirestoreContext";
import { generateIncrementalId } from "../services/transactionHistoryService";
import WarehouseStockModal from "./WarehouseStockModal";
import {
  STOCK_CORRECTION_VIA,
  WHOLE_NUMBER_MESSAGE,
  parseWholeNumber,
  planStockCorrection,
  summarizeMonthlyStock,
} from "../utils/stockTransactionUtils";
import StockDiscrepancyModal from "./StockDiscrepancies/StockDiscrepancyModal";
import BulkPurchaseModal from "./BulkPurchaseModal";

// Helper function for currency formatting
function formatRupiah(value) {
  if (value === undefined || value === null) return "";
  const numeric = value.toString().replace(/\D/g, "");
  if (!numeric) return "";
  return numeric.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseRupiah(value) {
  if (!value) return 0;
  const numeric = value.toString().replace(/\D/g, "");
  return parseInt(numeric, 10) || 0;
}

function getTimestampString() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
}

const initialProductData = {};

// Summary Card Component (styled like SDRG's StatCard)
const StatCard = ({ title, value, color }) => (
  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between min-h-[140px]">
    <div>
      <h3 className="text-gray-500 font-bold uppercase tracking-wider text-xs mb-4 text-center">{title}</h3>
      <p className={`text-3xl font-bold text-center ${color}`}>
        Rp {formatRupiah(Math.round(value))}
      </p>
    </div>
  </div>
);

// Main Warehouse Stock Component
export default function WarehouseStock() {
  const { currentUser } = useAuth();
  const { createDoc, readDoc, updateDoc, deleteDoc, queryCollection, query, where } =
    useFirestore();

  // State variables
  const [summaryData, setSummaryData] = useState({
    monthlyPurchase: 0,
    monthlySales: 0,
    missingStock: 0,
    currentStockWorth: 0,
  });

  const [originalBaseUnit, setOriginalBaseUnit] = useState("");
  const [products, setProducts] = useState(initialProductData);
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredProducts, setFilteredProducts] = useState(
    Object.values(products)
  );
  const [snackbar, setSnackbar] = useState({ open: false, message: "" });

  // Sorting states
  const [sortConfig, setSortConfig] = useState({
    key: "name",
    direction: "asc",
  });

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState("");
  const [selectedProductId, setSelectedProductId] = useState(null);

  // Date picker and snapshot related states
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
  const [snapshotExists, setSnapshotExists] = useState(false);
  const [snapshotData, setSnapshotData] = useState(null);

  // Stock discrepancy modal state
  const [showDiscrepancyModal, setShowDiscrepancyModal] = useState(false);

  const [showBulkPurchaseModal, setShowBulkPurchaseModal] = useState(() => {
    try {
      const saved = sessionStorage.getItem("show_bulk_purchase_modal");
      return saved === "true";
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    sessionStorage.setItem("show_bulk_purchase_modal", showBulkPurchaseModal);
  }, [showBulkPurchaseModal]);

  // Form related states (SDRG Schema compatible)
  const [tempName, setTempName] = useState("");
  const [tempItemId, setTempItemId] = useState("");
  const [tempKategori, setTempKategori] = useState("");
  const [tempSubKategori, setTempSubKategori] = useState("");
  const [tempTipeStock, setTempTipeStock] = useState("");
  const [tempNamaPemasok, setTempNamaPemasok] = useState("");
  const [base_unit, setBaseUnit] = useState("pcs");
  const [bulk_unit_name, setBulkUnitName] = useState("");
  const [bulk_unit_conversion, setBulkUnitConversion] = useState("");
  const [cost_price, setCostPrice] = useState("");
  const [price, setPrice] = useState("");

  const [tempAmount, setTempAmount] = useState("");
  const [tempSatuan, setTempSatuan] = useState("");
  const [tempCost, setTempCost] = useState("");
  const [tempDocId, setTempDocId] = useState("");

  // Three-dot action menu coordinates state
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  // Refs
  const firstFieldRef = useRef(null);

  // ***** UTILITY FUNCTIONS *****

  function convertToSmallestUnit(quantity, unit, product) {
    const baseUnit = product.base_unit || product.smallestUnit;
    if (quantity == null || !unit || !baseUnit) {
      throw new Error("Missing required parameters for conversion");
    }

    if (product.bulk_unit_name && unit === product.bulk_unit_name) {
      if (!product.bulk_unit_conversion) {
        throw new Error("Bulk unit conversion factor not defined for this product");
      }
      return quantity * product.bulk_unit_conversion;
    }

    if (unit === baseUnit) {
      return quantity;
    }

    // fallback weight conversions (for safety with legacy database records or other components)
    const weightConversions = {
      ton: 1000000,
      kwintal: 100000,
      kg: 1000,
      ons: 100,
      gram: 1,
      pcs: 1,
      kardus: 1,
      karton: 1,
      pack: 1,
    };

    if (!weightConversions[unit] || !weightConversions[baseUnit]) {
      throw new Error("Invalid unit for conversion");
    }

    const valueInGrams = quantity * weightConversions[unit];
    const result = valueInGrams / weightConversions[baseUnit];

    return result;
  }

  function computeNilaiFormatted(prod) {
    return formatRupiah(Math.round(prod.stockValue || 0));
  }

  function computeAverageKulakPrice(prod) {
    const c = prod.cost_price || 0;
    return formatRupiah(c);
  }

  function computeHargaFormatted(prod) {
    const p = prod.price || 0;
    return formatRupiah(p);
  }

  // ***** EVENT HANDLERS *****

  function openDialog(type, productId) {
    if (type !== "addNew" && !products[productId]) {
      alert("Product not found!");
      return;
    }
    setDialogOpen(true);
    setDialogType(type);
    setSelectedProductId(productId);
    setOpenMenuId(null); // Close three-dot menu

    if (type === "tambah" || type === "tetapkan") {
      const prod = productId ? products[productId] : null;
      setTempAmount("");
      setTempSatuan(prod?.base_unit || prod?.smallestUnit || "");
      setTempCost("");
      setTempKategori(prod?.kategori || "");
      setTempSubKategori(prod?.subKategori || "");
      setTempTipeStock(prod?.tipeStock || "");
      setTempDocId("");
    } else if (type === "edit" && productId) {
      const prod = products[productId];
      setTempName(prod.name);
      setTempItemId(prod.itemId || "");
      setTempKategori(prod.kategori || "");
      setTempSubKategori(prod.subKategori || "");
      setTempTipeStock(prod.tipeStock || "");
      setTempNamaPemasok(prod.namaPemasok || "");
      setOriginalBaseUnit(prod.base_unit || prod.smallestUnit || "");
      setBaseUnit(prod.base_unit || prod.smallestUnit || "pcs");
      setBulkUnitName(prod.bulk_unit_name || "");
      setBulkUnitConversion(prod.bulk_unit_conversion ? String(prod.bulk_unit_conversion) : "");
      setCostPrice(prod.cost_price ? formatRupiah(prod.cost_price) : "");
      setPrice(prod.price ? formatRupiah(prod.price) : "");
    } else if (type === "addNew") {
      setTempName("");
      setTempItemId("");
      setBaseUnit("pcs");
      setBulkUnitName("");
      setBulkUnitConversion("");
      setCostPrice("");
      setPrice("");
      setTempAmount("");
      setTempSatuan("");
      setTempCost("");
      setTempKategori("");
      setTempSubKategori("");
      setTempTipeStock("");
      setTempNamaPemasok("");
      setTempDocId("");
    }
  }

  function closeDialog() {
    setTempName("");
    setTempKategori("");
    setTempSubKategori("");
    setTempTipeStock("");
    setTempNamaPemasok("");
    setBaseUnit("pcs");
    setBulkUnitName("");
    setBulkUnitConversion("");
    setCostPrice("");
    setPrice("");
    setTempAmount("");
    setTempSatuan("");
    setTempCost("");
    setTempDocId("");
    setTempItemId("");

    setDialogOpen(false);
    setDialogType("");
    setSelectedProductId(null);
  }

  const showSuccessMessage = (message) => {
    setSnackbar({ open: true, message });
    setTimeout(() => setSnackbar((o) => ({ ...o, open: false })), 3000);
  };

  const requestSort = (key) => {
    let direction = "desc";
    if (sortConfig.key === key && sortConfig.direction === "desc") {
      direction = "asc";
    }
    setSortConfig({ key, direction });
    sortProductsBy(filteredProducts, key, direction);
  };

  const handleMenuToggle = (e, productId) => {
    e.stopPropagation();
    if (openMenuId === productId) {
      setOpenMenuId(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.right - 192,
      });
      setOpenMenuId(productId);
    }
  };

  // ***** DATA-FETCHING & DATA-PROCESSING FUNCTIONS *****

  const fetchSummaryData = async () => {
    try {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const transactions = await queryCollection("stockTransactions_b2b");
      const stocks = await queryCollection("stocks_b2b");

      let currentStockWorth = 0;

      stocks.forEach((item) => {
        currentStockWorth += item.stockValue || 0;
      });

      // Purchases, sales and missing stock. Tetapkan Stok corrections are none
      // of these, so they are left out.
      const { monthlyPurchase, monthlySales, missingStock } =
        summarizeMonthlyStock(transactions, firstDay, lastDay);

      setSummaryData({
        monthlyPurchase,
        monthlySales,
        missingStock,
        currentStockWorth,
      });
    } catch (error) {
      console.error("Error fetching summary data:", error);
    }
  };

  async function fetchAllStocks() {
    try {
      const stocksData = await queryCollection("stocks_b2b");
      const freshData = {};

      stocksData.forEach((item) => {
        if (!item.isDeleted) {
          let capitalizedName = "";
          if (item.name) {
            capitalizedName = item.name
              .split(" ")
              .map(
                (word) =>
                  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
              )
              .join(" ");
          }

          freshData[item.id] = {
            ...item,
            name: capitalizedName || item.name,
            satuan: item.satuan || [],
          };
        }
      });

      setProducts(freshData);
      const productsArray = Object.values(freshData);
      sortProductsBy(productsArray, "name", "asc");
    } catch (error) {
      console.error("Error fetching stocks:", error);
    }
  }

  const sortProductsBy = (productsArray, key, direction) => {
    let sortedProducts = [...productsArray];
    sortedProducts.sort((a, b) => {
      let aValue, bValue;

      if (key === "profitMargin") {
        const aMargin = (a.price || 0) - (a.cost_price || 0);
        const bMargin = (b.price || 0) - (b.cost_price || 0);
        aValue = aMargin;
        bValue = bMargin;
      } else if (key === "pricePerUnit") {
        aValue = a.price || 0;
        bValue = b.price || 0;
      } else if (key === "averageKulak") {
        aValue = a.cost_price || 0;
        bValue = b.cost_price || 0;
      } else if (key === "smallestUnit") {
        aValue = a.base_unit || "";
        bValue = b.base_unit || "";
      } else {
        aValue = a[key];
        bValue = b[key];
      }

      if (typeof aValue === "string" && typeof bValue === "string") {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) {
        return direction === "asc" ? -1 : 1;
      }
      if (aValue > bValue) {
        return direction === "asc" ? 1 : -1;
      }
      return 0;
    });

    setFilteredProducts(sortedProducts);
  };

  const exportToExcel = () => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const formattedDate = `${day}-${month}-${year}`;

    const metadata = [
      { A: `Data Stock Tanggal: ${formattedDate}` },
      { A: "" },
    ];

    const data = filteredProducts.map((p) => ({
      Nama: p.name,
      Kategori: p.kategori,
      SubKategori: p.subKategori,
      Tipe: p.tipeStock,
      Stock: `${p.stock} ${p.base_unit || ""}`,
      Satuan: p.base_unit || "",
      "Harga Jual": `Rp ${computeHargaFormatted(p)}/${p.base_unit || ""}`,
      "Harga Beli": `Rp ${computeAverageKulakPrice(p)}/${
        p.base_unit || ""
      }`,
      "Nilai Total Stock": `Rp ${computeNilaiFormatted(p)}`,
    }));

    const worksheet = XLSX.utils.json_to_sheet([]);
    XLSX.utils.sheet_add_json(worksheet, metadata, {
      skipHeader: true,
      origin: "A1",
    });
    XLSX.utils.sheet_add_json(worksheet, data, {
      origin: "A3",
      skipHeader: false,
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Stocks");
    XLSX.writeFile(workbook, `stock_data_${formattedDate}.xlsx`);
  };

  const checkSnapshotExists = async (date) => {
    try {
      const snapshotDoc = await readDoc("stockSnapshots_b2b", date);
      if (snapshotDoc) {
        setSnapshotExists(true);
        setSnapshotData(snapshotDoc);
      } else {
        setSnapshotExists(false);
        setSnapshotData(null);
      }
      setSnapshotDialogOpen(true);
    } catch (error) {
      console.error("Error checking snapshot:", error);
      setSnackbar({
        open: true,
        message: "Error checking snapshot: " + error.message,
      });
    }
  };

  const exportSnapshotToExcel = () => {
    if (!snapshotData || !selectedDate) return;

    const [year, month, day] = selectedDate.split("-");
    const formattedDate = `${day}-${month}-${year}`;

    const metadata = [
      { A: `Data Stock Snapshot Tanggal: ${formattedDate}` },
      { A: "" },
    ];

    const stockItems = snapshotData.stocks || [];

    const data = stockItems.map((p) => ({
      Nama: p.name,
      Kategori: p.kategori || "",
      SubKategori: p.subKategori || "",
      Tipe: p.tipeStock || "",
      Stock: `${p.stock || 0} ${p.base_unit || ""}`,
      Satuan: p.base_unit || "",
      "Harga Jual": p.price ? `Rp ${formatRupiah(p.price)}/${p.base_unit || ""}` : "Rp 0",
      "Harga Beli": p.cost_price ? `Rp ${formatRupiah(p.cost_price)}/${p.base_unit || ""}` : "Rp 0",
      "Nilai Total Stock": p.stockValue
        ? `Rp ${formatRupiah(Math.round(p.stockValue))}`
        : "Rp 0",
    }));

    const worksheet = XLSX.utils.json_to_sheet([]);
    XLSX.utils.sheet_add_json(worksheet, metadata, {
      skipHeader: true,
      origin: "A1",
    });
    XLSX.utils.sheet_add_json(worksheet, data, {
      origin: "A3",
      skipHeader: false,
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Stock Snapshot");
    XLSX.writeFile(workbook, `stock_snapshot_${formattedDate}.xlsx`);
    setSnapshotDialogOpen(false);
  };

  // ***** SAVE/SUBMIT FUNCTIONS *****

  async function handleSave(type) {
    const currentDialogType = type || dialogType;
    const costValue = parseRupiah(tempCost);

    const createBaseTransactionDoc = (prod) => ({
      itemId: prod.itemId || prod.id,
      itemName: prod.name,
      kategori: prod.kategori || "",
      subKategori: prod.subKategori || "",
      unit: tempSatuan,
      cost: costValue,
      isDeleted: false,
      createdBy: currentUser ? currentUser.email : "unknown",
    });

    if (currentDialogType === "addNew") {
      if (
        !tempName.trim() ||
        !tempKategori ||
        !tempTipeStock ||
        !base_unit ||
        !price
      ) {
        alert("All mandatory fields must be filled!");
        return;
      }
      if (bulk_unit_name || bulk_unit_conversion) {
        if (!bulk_unit_name || !bulk_unit_conversion) {
          alert("Both Bulk Unit Name and Conversion are required if either is provided!");
          return;
        }
      }
      let docBase = tempDocId.trim();
      if (!docBase) {
        docBase = getTimestampString();
      }
      const finalDocId = `${tempName}_${docBase}`.replace(/\s+/g, "_");
      
      const parsedCostPrice = parseRupiah(cost_price);
      const parsedPrice = parseRupiah(price);
      const parsedConversion = bulk_unit_conversion ? parseInt(bulk_unit_conversion, 10) : null;

      const newDoc = {
        itemId: docBase,
        name: tempName.trim(),
        kategori: tempKategori,
        subKategori: tempSubKategori || tempKategori,
        tipeStock: tempTipeStock,
        namaPemasok: tempNamaPemasok,
        base_unit: base_unit,
        bulk_unit_name: bulk_unit_name || null,
        bulk_unit_conversion: parsedConversion,
        cost_price: parsedCostPrice,
        price: parsedPrice,
        stock: 0,
        stockValue: 0,
        isDeleted: false,
      };

      await createDoc("stocks_b2b", newDoc, finalDocId);
      setProducts((prev) => {
        const clone = { ...prev };
        clone[finalDocId] = {
          id: finalDocId,
          ...newDoc,
        };
        return clone;
      });
      showSuccessMessage("Barang baru berhasil ditambahkan!");
      closeDialog();
    } else if (currentDialogType === "tambah" && selectedProductId) {
      if (!tempAmount || !tempSatuan) {
        alert("Please fill the amount and unit.");
        return;
      }
      const prod = products[selectedProductId];

      try {
        // Stock is counted in whole numbers; "0,5" is refused, not read as 5
        const rawAmount = parseWholeNumber(tempAmount);
        if (isNaN(rawAmount)) {
          throw new Error(WHOLE_NUMBER_MESSAGE);
        }

        const quantityInSmallestUnit = convertToSmallestUnit(
          rawAmount,
          tempSatuan,
          prod
        );
        if (!Number.isInteger(quantityInSmallestUnit)) {
          throw new Error(
            `Jumlah dalam ${prod.base_unit || prod.smallestUnit || "satuan terkecil"} harus bilangan bulat`
          );
        }

        const txDoc = {
          ...createBaseTransactionDoc(prod),
          transactionType: "pengadaan",
          transactionVia: "stockAddition",
          quantity: quantityInSmallestUnit,
          originalQuantity: rawAmount,
          originalUnit: tempSatuan,
        };

        const txId = await generateIncrementalId(
          queryCollection,
          query,
          where,
          "stockTransactions_b2b",
          "ADD"
        );
        await createDoc("stockTransactions_b2b", txDoc, txId);

        const newStock = (prod.stock || 0) + quantityInSmallestUnit;
        const newStockValue = (prod.stockValue || 0) + costValue;
        
        // Dynamically compute/update average cost_price
        const newCostPrice = newStock > 0 ? Math.round(newStockValue / newStock) : prod.cost_price;

        await updateDoc("stocks_b2b", selectedProductId, {
          stock: newStock,
          stockValue: newStockValue,
          cost_price: newCostPrice,
        });

        setProducts((prev) => ({
          ...prev,
          [selectedProductId]: {
            ...prev[selectedProductId],
            stock: newStock,
            stockValue: newStockValue,
            cost_price: newCostPrice,
          },
        }));

        showSuccessMessage("Stock updated (Tambah)!");
        closeDialog();
      } catch (error) {
        alert(error.message);
        return;
      }
    } else if (currentDialogType === "tetapkan" && selectedProductId) {
      const prod = products[selectedProductId];
      if (tempAmount === "" || !tempSatuan) {
        alert("Please fill amount and unit.");
        return;
      }

      try {
        // Stock is counted in whole numbers; "0,5" is refused, not read as 5
        const originalQuantity = parseWholeNumber(tempAmount);
        if (isNaN(originalQuantity)) {
          throw new Error(WHOLE_NUMBER_MESSAGE);
        }
        const originalUnit = tempSatuan;

        const newStock = convertToSmallestUnit(
          originalQuantity,
          originalUnit,
          prod
        );
        if (!Number.isInteger(newStock)) {
          throw new Error(
            `Jumlah dalam ${prod.base_unit || prod.smallestUnit || "satuan terkecil"} harus bilangan bulat`
          );
        }

        // Tetapkan fixes a miscounted quantity. It is not a purchase or a
        // loss, so no money is recorded; the stored value just follows the
        // quantity at the product's unchanged unit cost.
        const { isUnchanged, newValue, transactionType, quantity } =
          planStockCorrection(prod, newStock);

        if (isUnchanged) {
          alert("No change in stock; nothing to update.");
          return;
        }

        const txDoc = {
          ...createBaseTransactionDoc(prod),
          transactionType,
          transactionVia: STOCK_CORRECTION_VIA,
          quantity,
          cost: 0,
          originalQuantity,
          originalUnit,
          unit: prod.base_unit || prod.smallestUnit,
        };

        const txId = await generateIncrementalId(
          queryCollection,
          query,
          where,
          "stockTransactions_b2b",
          "SET"
        );
        await createDoc("stockTransactions_b2b", txDoc, txId);

        // cost_price is the unit cost and a quantity fix doesn't change it.
        await updateDoc("stocks_b2b", selectedProductId, {
          stock: newStock,
          stockValue: newValue,
        });

        setProducts((prev) => ({
          ...prev,
          [selectedProductId]: {
            ...prev[selectedProductId],
            stock: newStock,
            stockValue: newValue,
          },
        }));

        showSuccessMessage("Stock updated (Tetapkan)!");
        closeDialog();
      } catch (error) {
        alert(error.message);
      }
    } else if (currentDialogType === "edit" && selectedProductId) {
      const prod = products[selectedProductId];

      try {
        if (
          !tempName.trim() ||
          !tempKategori ||
          !tempTipeStock ||
          !base_unit ||
          !price
        ) {
          throw new Error("All mandatory fields must be filled!");
        }

        const parsedCostPrice = parseRupiah(cost_price);
        const parsedPrice = parseRupiah(price);
        const parsedConversion = bulk_unit_conversion ? parseInt(bulk_unit_conversion, 10) : null;

        const updatedProduct = {
          ...prod,
          name: tempName.trim(),
          itemId: tempItemId,
          kategori: tempKategori,
          subKategori: tempSubKategori,
          tipeStock: tempTipeStock,
          namaPemasok: tempNamaPemasok,
          base_unit: base_unit,
          bulk_unit_name: bulk_unit_name || null,
          bulk_unit_conversion: parsedConversion,
          cost_price: parsedCostPrice,
          price: parsedPrice,
        };

        if (base_unit !== originalBaseUnit) {
          updatedProduct.stock = convertToSmallestUnit(
            prod.stock,
            originalBaseUnit,
            updatedProduct
          );
        }

        await updateDoc("stocks_b2b", selectedProductId, updatedProduct);

        setProducts((prev) => ({
          ...prev,
          [selectedProductId]: updatedProduct,
        }));

        showSuccessMessage("Produk berhasil diperbarui!");
        closeDialog();
      } catch (error) {
        alert(error.message);
      }
    } else if (currentDialogType === "delete" && selectedProductId) {
      try {
        const product = products[selectedProductId];

        const txId = await generateIncrementalId(
          queryCollection,
          query,
          where,
          "stockTransactions_b2b",
          "DEL"
        );
        await createDoc(
          "stockTransactions_b2b",
          {
            itemId: product.itemId || "",
            itemName: product.name,
            kategori: product.kategori || "",
            subKategori: product.subKategori || "",
            quantity: product.stock || 0,
            unit: product.base_unit || product.smallestUnit || "",
            cost: product.stockValue || 0,
            price: 0,
            originalQuantity: product.stock || 0,
            originalUnit: product.base_unit || product.smallestUnit || "",
            isDeleted: false,
            transactionType: "pengurangan",
            transactionVia: "stockDeletion",
            stockWorth: product.stockValue || 0,
            note: "Stock dihapus dari sistem",
            createdBy: currentUser ? currentUser.email : "unknown",
          },
          txId
        );

        await deleteDoc("stocks_b2b", selectedProductId);

        setProducts((prev) => {
          const newProducts = { ...prev };
          delete newProducts[selectedProductId];
          return newProducts;
        });

        setFilteredProducts((prev) =>
          prev.filter((p) => p.id !== selectedProductId)
        );

        showSuccessMessage("Stock berhasil dihapus!");
        closeDialog();
      } catch (error) {
        alert("Error deleting stock: " + error.message);
      }
    }
  }

  // ***** LIFECYCLE EFFECTS *****

  useEffect(() => {
    fetchAllStocks();
    fetchSummaryData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (searchTerm.trim() === "") {
      sortProductsBy(
        Object.values(products),
        sortConfig.key,
        sortConfig.direction
      );
    } else {
      sortProductsBy(filteredProducts, sortConfig.key, sortConfig.direction);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, products]);

  useEffect(() => {
    const input = searchTerm.trim();
    if (!input) {
      setFilteredProducts(Object.values(products));
      return;
    }
    const numericRegex = /^[0-9]+$/;
    if (numericRegex.test(input)) {
      const exactMatch = Object.values(products).find(
        (p) => p.itemId && p.itemId.toString() === input
      );
      setFilteredProducts(exactMatch ? [exactMatch] : []);
    } else {
      const words = input.toLowerCase().split(/\s+/);
      const newList = Object.values(products).filter((prod) => {
        const name = prod.name.toLowerCase();
        return words.every((w) => name.includes(w));
      });
      setFilteredProducts(newList);
      sortProductsBy(newList, sortConfig.key, sortConfig.direction);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, products]);

  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [openMenuId]);

  useEffect(() => {
    function handleEsc(e) {
      if (dialogOpen && e.key === "Escape") {
        closeDialog();
      }
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [dialogOpen]);

  useEffect(() => {
    if (dialogOpen && firstFieldRef.current) {
      setTimeout(() => {
        if (firstFieldRef.current) {
          firstFieldRef.current.focus();
        }
      }, 0);
    }
  }, [dialogOpen, dialogType]);

  // Sort indicator component
  const SortIndicator = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) {
      return <span className="ml-1 text-gray-400">⇅</span>;
    }
    return (
      <span className="ml-1">
        {sortConfig.direction === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  // ***** COMPONENT RENDERING *****
  return (
    <div className="p-6">
      {/* Header and Title */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Kulakan Warehouse</h1>
          <p className="text-sm text-gray-500 mt-1">Kelola stok barang dan nilai gudang B2B</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <button
              className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg shadow-sm hover:bg-gray-50 transition flex items-center gap-2 text-sm"
              onClick={() => setShowDatePicker(!showDatePicker)}
            >
              <FaCalendarAlt /> Lihat Snapshot
            </button>
            {showDatePicker && (
              <div className="absolute right-0 mt-2 p-4 bg-white border border-gray-200 rounded-lg shadow-xl z-50 min-w-[240px]">
                <input
                  type="date"
                  className="w-full p-2 border border-gray-300 rounded mb-2 text-sm"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
                <button
                  className="w-full py-2 bg-gray-900 hover:bg-gray-800 text-white rounded text-xs font-bold"
                  onClick={() => {
                    if (selectedDate) {
                      checkSnapshotExists(selectedDate);
                      setShowDatePicker(false);
                    } else {
                      setSnackbar({
                        open: true,
                        message: "Pilih tanggal terlebih dahulu",
                      });
                    }
                  }}
                >
                  Cek Snapshot
                </button>
              </div>
            )}
          </div>
          <button
            className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg shadow-sm hover:bg-gray-50 transition text-sm"
            onClick={exportToExcel}
          >
            Export ke Excel
          </button>
          <button
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition text-sm"
            onClick={() => setShowBulkPurchaseModal(true)}
          >
            Pembelian Grosir
          </button>
          <button
            className="px-5 py-2.5 bg-primary hover:bg-red-700 text-white font-bold rounded-lg shadow-sm transition text-sm"
            onClick={() => openDialog("addNew", null)}
          >
            + Barang Baru
          </button>
        </div>
      </div>

      {/* Summary Cards (StatCards) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="Belanja Bulan Ini"
          value={summaryData.monthlyPurchase}
          color="text-blue-600"
        />
        <StatCard
          title="Stock Hilang"
          value={summaryData.missingStock}
          color="text-red-600"
        />
        <StatCard
          title="Stock Worth Saat Ini"
          value={summaryData.currentStockWorth}
          color="text-gray-900"
        />
      </div>

      {/* Search Bar container matching SDRG */}
      <div className="mb-6 relative">
        <input
          type="text"
          placeholder="Cari produk atau ID..."
          className="w-full p-3 pl-10 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <svg className="w-5 h-5 absolute left-3 top-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th
                  onClick={() => requestSort("name")}
                  className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs cursor-pointer hover:bg-gray-100 transition select-none"
                >
                  Nama Barang <SortIndicator columnKey="name" />
                </th>
                <th
                  onClick={() => requestSort("smallestUnit")}
                  className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs cursor-pointer hover:bg-gray-100 transition select-none"
                >
                  Satuan <SortIndicator columnKey="smallestUnit" />
                </th>
                <th
                  onClick={() => requestSort("stock")}
                  className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none"
                >
                  Jumlah Stock <SortIndicator columnKey="stock" />
                </th>
                <th
                  onClick={() => requestSort("averageKulak")}
                  className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none"
                >
                  Harga Beli <SortIndicator columnKey="averageKulak" />
                </th>
                <th
                  onClick={() => requestSort("pricePerUnit")}
                  className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none"
                >
                  Harga Jual <SortIndicator columnKey="pricePerUnit" />
                </th>
                <th className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-center w-16">
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.map((prod) => (
                <tr key={prod.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">{prod.name}</td>
                  <td className="px-6 py-4">{prod.base_unit || prod.smallestUnit}</td>
                  <td className="px-6 py-4 text-right font-bold text-gray-900">
                    {prod.stock}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-600">
                    Rp {computeAverageKulakPrice(prod)}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-600">
                    Rp {computeHargaFormatted(prod)}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button
                       onClick={(e) => handleMenuToggle(e, prod.id)}
                       className="p-2 rounded-lg hover:bg-gray-100 transition text-gray-500 hover:text-gray-700"
                       title="Aksi"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Snapshot Dialog */}
      {snapshotDialogOpen && (
        <div className="stock-modal-overlay">
          <div className="stock-modal-content stock-snapshot-dialog">
            {snapshotExists ? (
              <>
                <h2>Stock Snapshot</h2>
                <p>
                  Download snapshot stock tanggal{" "}
                  {selectedDate.split("-").reverse().join("-")}?
                </p>
                <div className="stock-dialog-buttons">
                  <button onClick={() => setSnapshotDialogOpen(false)}>
                    No
                  </button>
                  <button onClick={exportSnapshotToExcel}>Yes</button>
                </div>
              </>
            ) : (
              <>
                <h2>Stock Snapshot</h2>
                <p>
                  Tidak ada stockSnapshot untuk tanggal{" "}
                  {selectedDate.split("-").reverse().join("-")}
                </p>
                <div className="stock-dialog-buttons">
                  <button onClick={() => setSnapshotDialogOpen(false)}>
                    Okay
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dropdown menu rendered outside the table to avoid overflow clipping */}
      {openMenuId && (
        <div
          className="fixed w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
          style={{ top: menuPos.top, left: menuPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition"
            onClick={() => { openDialog("tambah", openMenuId); setOpenMenuId(null); }}
          >
            Tambah Stok
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition"
            onClick={() => { openDialog("tetapkan", openMenuId); setOpenMenuId(null); }}
          >
            Tetapkan Stok
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition"
            onClick={() => { openDialog("edit", openMenuId); setOpenMenuId(null); }}
          >
            Edit Barang
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
            onClick={() => { openDialog("delete", openMenuId); setOpenMenuId(null); }}
          >
            Hapus Barang
          </button>
        </div>
      )}

      {/* Stock Modal Component */}
      {dialogOpen && (
        <WarehouseStockModal
          dialogOpen={dialogOpen}
          dialogType={dialogType}
          selectedProductId={selectedProductId}
          products={products}
          onClose={closeDialog}
          onSave={handleSave}
          tempState={{
            tempName,
            tempItemId,
            tempKategori,
            tempSubKategori,
            tempTipeStock,
            tempNamaPemasok,
            base_unit,
            bulk_unit_name,
            bulk_unit_conversion,
            cost_price,
            price,
            tempAmount,
            tempSatuan,
            tempCost,
            tempDocId,
            originalBaseUnit,
          }}
          setTempState={(newState) => {
            if ("tempName" in newState) setTempName(newState.tempName);
            if ("tempItemId" in newState) setTempItemId(newState.tempItemId);
            if ("tempKategori" in newState)
              setTempKategori(newState.tempKategori);
            if ("tempSubKategori" in newState)
              setTempSubKategori(newState.tempSubKategori);
            if ("tempTipeStock" in newState)
              setTempTipeStock(newState.tempTipeStock);
            if ("tempNamaPemasok" in newState)
              setTempNamaPemasok(newState.tempNamaPemasok);
            if ("base_unit" in newState)
              setBaseUnit(newState.base_unit);
            if ("bulk_unit_name" in newState)
              setBulkUnitName(newState.bulk_unit_name);
            if ("bulk_unit_conversion" in newState)
              setBulkUnitConversion(newState.bulk_unit_conversion);
            if ("cost_price" in newState)
              setCostPrice(newState.cost_price);
            if ("price" in newState)
              setPrice(newState.price);
            if ("tempAmount" in newState) setTempAmount(newState.tempAmount);
            if ("tempSatuan" in newState) setTempSatuan(newState.tempSatuan);
            if ("tempCost" in newState) setTempCost(newState.tempCost);
            if ("tempDocId" in newState) setTempDocId(newState.tempDocId);
          }}
        />
      )}

      {/* Snackbar for notifications */}
      {snackbar.open && (
        <div className="stock-snackbar">{snackbar.message}</div>
      )}

      {/* Stock Discrepancy Modal */}
      <StockDiscrepancyModal
        isOpen={showDiscrepancyModal}
        onRequestClose={() => setShowDiscrepancyModal(false)}
      />

      {/* Bulk Purchase Modal */}
      <BulkPurchaseModal
        isOpen={showBulkPurchaseModal}
        onClose={() => setShowBulkPurchaseModal(false)}
        onSave={async (action, data, id, collectionName) => {
          if (action === "createTransaction") {
            await createDoc("stockTransactions_b2b", data, id);
          } else if (action === "updateStock") {
            const newCostPrice = data.stock > 0 ? Math.round(data.stockValue / data.stock) : (products[data.id]?.cost_price || 0);
            await updateDoc("stocks_b2b", data.id, {
              stock: data.stock,
              stockValue: data.stockValue,
              cost_price: newCostPrice,
            });
            setProducts((prev) => ({
              ...prev,
              [data.id]: {
                ...prev[data.id],
                stock: data.stock,
                stockValue: data.stockValue,
                cost_price: newCostPrice,
              },
            }));
          } else if (action === "createNotaBelanja") {
            await createDoc(collectionName || "notaBelanja_b2b", data, id);
          }
        }}
        products={products}
        currentUser={currentUser}
        collectionPrefix="stocks_b2b"
        transactionCollection="stockTransactions_b2b"
        isWarehouse={true}
      />
    </div>
  );
}
