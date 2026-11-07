import React, { useState, useEffect, useRef } from "react";
import {
  FaEllipsisV,
  FaCalendarAlt,
  FaTag,
  FaSortUp,
  FaSortDown,
  FaSort,
  FaPercentage,
  FaCheckCircle,
} from "react-icons/fa";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import "../styles/Stocks.css";
import { useAuth } from "../context/AuthContext";
import { useFirestore } from "../context/FirestoreContext";
import { useEnvironment } from "../context/EnvironmentContext";
import { generateIncrementalId } from "../services/transactionHistoryService";
import {
  STOCK_CORRECTION_VIA,
  WHOLE_NUMBER_MESSAGE,
  parseWholeNumber,
  planStockCorrection,
  summarizeMonthlyStock,
} from "../utils/stockTransactionUtils";
import { cashflowService } from "../services/cashflowService";
import { getLocalDateKey } from "../utils/cashflowUtils";
import StockModal from "./StockModal";
import BulkPurchaseModal from "./BulkPurchaseModal";

// Helper function for currency formatting
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
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

// Constants
const initialProductData = {};

const VIEW_PRESETS = {
  default: {
    label: "Default",
    columns: ["name", "kategori", "subKategori", "smallestUnit", "stock", "averageKulak", "pricePerUnit", "profitMargin", "potentialProfit", "stockValue"]
  },
  keuntungan: {
    label: "Keuntungan",
    columns: ["name", "stock", "smallestUnit", "averageKulak", "pricePerUnit", "profitMargin", "potentialProfit"]
  },
  kategorik: {
    label: "Kategorik",
    columns: ["name", "kategori", "subKategori"]
  },
  logistik: {
    label: "Stok & Logistik",
    columns: ["name", "smallestUnit", "stock", "stockValue"]
  }
};

// Summary Card Component (styled like SDRG's StatCard)
const SummaryCard = ({ title, value, color }) => (
  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between min-h-[140px]">
    <div>
      <h3 className="text-gray-500 font-bold uppercase tracking-wider text-xs mb-4 text-center">{title}</h3>
      <p className={`text-3xl font-bold text-center ${color}`}>
        Rp {formatRupiah(Math.round(value))}
      </p>
    </div>
  </div>
);

// Main Stocks Component
export default function Stocks() {
  const { currentUser, userRole } = useAuth();
  const canSeeProfit = userRole === "Wakil Rektor 2";
  const { createDoc, readDoc, updateDoc, deleteDoc, queryCollection, query, where } =
    useFirestore();
  const { isProduction } = useEnvironment();

  // State variables
  const [summaryData, setSummaryData] = useState({
    monthlyPurchase: 0,
    monthlySales: 0,
    currentStockWorth: 0,
  });

  const [originalSmallestUnit, setOriginalSmallestUnit] = useState("");
  const [products, setProducts] = useState(initialProductData);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [filteredProducts, setFilteredProducts] = useState(
    Object.values(products)
  );
  const [selectedItems, setSelectedItems] = useState({});
  const [showDropdown, setShowDropdown] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [snackbar, setSnackbar] = useState({ open: false, message: "" });

  const [showMargin, setShowMargin] = useState(false);

  const [selectedViewPreset, setSelectedViewPreset] = useState("default");

  const isColumnVisible = (colKey) => {
    if (colKey === "profitMargin" || colKey === "potentialProfit") {
      return canSeeProfit && showMargin && VIEW_PRESETS[selectedViewPreset].columns.includes(colKey);
    }
    return VIEW_PRESETS[selectedViewPreset].columns.includes(colKey);
  };

  const handleViewPresetChange = (presetKey) => {
    setSelectedViewPreset(presetKey);
    if (presetKey === "keuntungan") {
      setShowMargin(true);
    }
  };

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


  // Bulk purchase modal state
  const [showBulkPurchaseModal, setShowBulkPurchaseModal] = useState(false);

  // Form related states
  const [tempAmount, setTempAmount] = useState("");
  const [tempSatuan, setTempSatuan] = useState("");
  const [tempCost, setTempCost] = useState("");
  const [tempName, setTempName] = useState("");
  const [tempBaseUnit, setTempBaseUnit] = useState("");
  const [tempBulkUnitName, setTempBulkUnitName] = useState("");
  const [tempPricePerUnit, setTempPricePerUnit] = useState({});
  const [tempKategori, setTempKategori] = useState("");
  const [tempSubKategori, setTempSubKategori] = useState("");
  const [tempTipeStock, setTempTipeStock] = useState("");
  const [tempNamaPemasok, setTempNamaPemasok] = useState("");
  const [tempBulkUnitConversion, setTempBulkUnitConversion] = useState("");
  const [tempDocId, setTempDocId] = useState("");
  const [tempItemId, setTempItemId] = useState("");
  const [tempLastPurchasePrice, setTempLastPurchasePrice] = useState("");

  // Refs
  const dropdownRef = useRef(null);
  const firstFieldRef = useRef(null);

  // ***** UTILITY FUNCTIONS *****

  function convertToSmallestUnit(quantity, unit, product) {
    const baseUnit = product.base_unit || product.smallestUnit;
    const bulkUnitName = product.bulk_unit_name || "box";
    const bulkUnitConversion = product.bulk_unit_conversion || product.piecesPerBox;

    if (quantity == null || !unit || !baseUnit) {
      throw new Error("Missing required parameters for conversion");
    }

    // Handle bulk unit conversion first
    if (unit === bulkUnitName) {
      if (!bulkUnitConversion) {
        throw new Error("Pieces per box or bulk conversion not defined for this product");
      }
      return quantity * bulkUnitConversion;
    }

    // For weight-based conversions
    const weightConversions = {
      ton: 1000000, // 1 ton = 1,000,000 grams
      kwintal: 100000, // 1 kwintal = 100,000 grams
      kg: 1000, // 1 kg = 1,000 grams
      ons: 100, // 1 ons = 100 grams
      gram: 1, // base unit
      pcs: 1, // for piece-based items
      kardus: 1,
      karton: 1,
      pack: 1,
    };

    // If the unit or product's smallest unit isn't in our conversion table
    if (!weightConversions[unit] || !weightConversions[baseUnit]) {
      throw new Error("Invalid unit for conversion");
    }

    // Convert to grams first, then to target unit
    const valueInGrams = quantity * weightConversions[unit];
    const result = valueInGrams / weightConversions[baseUnit];

    return result;
  }

  function computeNilaiFormatted(prod) {
    const baseUnit = prod.base_unit || prod.smallestUnit;
    if (!baseUnit || !prod.pricePerUnit[baseUnit]) return "0";
    return formatRupiah(Math.round(prod.stockValue));
  }

  function computeAverageKulakPrice(prod) {
    if (prod.lastPurchasePrice && prod.lastPurchasePrice > 0) {
      return formatRupiah(Math.round(prod.lastPurchasePrice));
    }
    if (!prod.stock || prod.stock === 0 || !prod.stockValue) return "0";
    const avgKulakPrice = Math.round(prod.stockValue / prod.stock);
    return formatRupiah(avgKulakPrice);
  }

  function computeHargaFormatted(prod) {
    const baseUnit = prod.base_unit || prod.smallestUnit;
    if (!baseUnit || !prod.pricePerUnit[baseUnit]) return "0";
    const p =
      typeof prod.pricePerUnit[baseUnit] === "number"
        ? prod.pricePerUnit[baseUnit]
        : parseRupiah(prod.pricePerUnit[baseUnit]);
    return formatRupiah(p);
  }

  function computeMarginDetails(prod) {
    const baseUnit = prod.base_unit || prod.smallestUnit;
    if (!baseUnit) return { value: 0, percent: 0, formatted: "Rp 0 (0%)", isNegative: false, isPositive: false };

    const hargaJual = prod.pricePerUnit && prod.pricePerUnit[baseUnit]
      ? (typeof prod.pricePerUnit[baseUnit] === "number"
        ? prod.pricePerUnit[baseUnit]
        : parseRupiah(prod.pricePerUnit[baseUnit]))
      : 0;

    const hargaBeli = prod.lastPurchasePrice && prod.lastPurchasePrice > 0
      ? Math.round(prod.lastPurchasePrice)
      : (prod.stock && prod.stockValue
        ? Math.round(prod.stockValue / prod.stock)
        : 0);

    const value = hargaJual - hargaBeli;
    const percent = hargaJual > 0 ? ((value / hargaJual) * 100) : 0;

    return {
      value,
      percent,
      formatted: `Rp ${formatRupiah(Math.abs(value))} (${percent.toFixed(2)}%)`,
      isNegative: value < 0,
      isPositive: value > 0
    };
  }

  function computePotentialProfitDetails(prod) {
    const margin = computeMarginDetails(prod);
    const stock = prod.stock || 0;
    const value = margin.value * stock;
    return {
      value,
      formatted: `Rp ${formatRupiah(Math.abs(value))}`,
      isNegative: value < 0,
      isPositive: value > 0
    };
  }

  // ***** EVENT HANDLERS *****

  function handleActionClick(e, productId) {
    e.stopPropagation();
    if (showDropdown === productId) {
      setShowDropdown(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.right - 192,
      });
      setShowDropdown(productId);
    }
  }
  function openDialog(type, productId) {
    if (type !== "addNew" && !products[productId]) {
      alert("Product not found!");
      return;
    }
    setDialogType(type);
    setSelectedProductId(productId);
    if (type === "tambah" || type === "tetapkan") {
      const prod = productId ? products[productId] : null;
      setTempAmount("");
      setTempSatuan(prod?.base_unit || prod?.smallestUnit || prod?.satuan?.[0] || "");
      setTempCost("");
      setTempBulkUnitConversion(
        prod?.bulk_unit_conversion || prod?.piecesPerBox
          ? String(prod.bulk_unit_conversion || prod.piecesPerBox)
          : ""
      );
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
      let initialLastPurchasePrice = "";
      if (prod.lastPurchasePrice && typeof prod.lastPurchasePrice === "number" && !isNaN(prod.lastPurchasePrice) && prod.lastPurchasePrice > 0) {
        initialLastPurchasePrice = formatRupiah(Math.round(prod.lastPurchasePrice));
      } else if (prod.stock && prod.stock > 0 && prod.stockValue && !isNaN(prod.stockValue)) {
        initialLastPurchasePrice = formatRupiah(Math.round(prod.stockValue / prod.stock));
      }
      setTempLastPurchasePrice(initialLastPurchasePrice);

      const baseUnit = prod.base_unit || prod.smallestUnit || (prod.satuan || [])[0] || "";
      setOriginalSmallestUnit(baseUnit);
      setTempBaseUnit(baseUnit);

      const bulkUnitName = prod.bulk_unit_name || ((prod.satuan || []).find((u) => u !== baseUnit) || "");
      setTempBulkUnitName(bulkUnitName);

      setTempBulkUnitConversion(
        prod.bulk_unit_conversion || prod.piecesPerBox
          ? String(prod.bulk_unit_conversion || prod.piecesPerBox)
          : ""
      );

      setTempPricePerUnit(
        Object.keys(prod.pricePerUnit || {}).reduce((acc, key) => {
          acc[key] = formatRupiah(prod.pricePerUnit[key]);
          return acc;
        }, {})
      );
    } else if (type === "addNew") {
      setTempName("");
      setTempBaseUnit("");
      setTempBulkUnitName("");
      setTempPricePerUnit({});
      setTempAmount("");
      setTempSatuan("");
      setTempCost("");
      setTempKategori("");
      setTempSubKategori("");
      setTempTipeStock("");
      setTempBulkUnitConversion("");
      setTempDocId("");
      setTempLastPurchasePrice("");
    }
    setDialogOpen(true);
    setShowDropdown(null);
  }

  function closeDialog() {
    setTempName("");
    setTempKategori("");
    setTempSubKategori("");
    setTempTipeStock("");
    setTempBaseUnit("");
    setTempBulkUnitName("");
    setTempPricePerUnit({});
    setTempAmount("");
    setTempSatuan("");
    setTempCost("");
    setTempBulkUnitConversion("");
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

  const handleSelectAll = (e) => {
    const isChecked = e.target.checked;

    if (isChecked) {
      // Select all filtered products
      const newSelectedItems = {};
      filteredProducts.forEach((prod) => {
        newSelectedItems[prod.id] = true;
      });
      setSelectedItems(newSelectedItems);
    } else {
      // Deselect all
      setSelectedItems({});
    }
  };

  const toggleItemSelection = (productId) => {
    setSelectedItems((prev) => ({
      ...prev,
      [productId]: !prev[productId],
    }));
  };

  const handleSelectAllMarked = () => {
    const markedProducts = filteredProducts.filter((prod) => prod.isMarked);

    if (markedProducts.length === 0) {
      setSnackbar({
        open: true,
        message: "Tidak ada barang ditandai di daftar saat ini",
      });
      setTimeout(() => setSnackbar((o) => ({ ...o, open: false })), 3000);
      return;
    }

    setSelectedItems((prev) => {
      const newSelected = { ...prev };
      markedProducts.forEach((prod) => {
        newSelected[prod.id] = true;
      });
      return newSelected;
    });

    setSnackbar({
      open: true,
      message: `Berhasil memilih ${markedProducts.length} barang ditandai`,
    });
    setTimeout(() => setSnackbar((o) => ({ ...o, open: false })), 3000);
  };



  // Function to handle click on sortable column headers
  const requestSort = (key) => {
    let direction = "asc";

    if (sortConfig.key === key) {
      direction = sortConfig.direction === "asc" ? "desc" : "asc";
    }

    setSortConfig({ key, direction });
    sortProductsBy(filteredProducts, key, direction);
  };

  // ***** DATA-FETCHING & DATA-PROCESSING FUNCTIONS *****

  const fetchSummaryData = async () => {
    try {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // Fetch transactions
      const transactions = await queryCollection("stockTransactions");

      // Fetch stocks
      const stocks = await queryCollection("stocks");

      let currentStockWorth = 0;

      // Calculate stock worth
      stocks.forEach((item) => {
        currentStockWorth += item.stockValue || 0;
      });

      // Purchases and sales. Tetapkan Stok corrections are neither, so they
      // are left out.
      const { monthlyPurchase, monthlySales } = summarizeMonthlyStock(
        transactions,
        firstDay,
        lastDay
      );

      setSummaryData({
        monthlyPurchase,
        monthlySales,
        currentStockWorth,
      });

      console.log(
        `Fetching summary data from ${isProduction ? "production" : "testing"
        } environment`
      );
    } catch (error) {
      console.error("Error fetching summary data:", error);
    }
  };

  async function fetchAllStocks() {
    try {
      // Use the queryCollection function to get stocks with environment awareness
      const stocksData = await queryCollection("stocks");
      const freshData = {};

      stocksData.forEach((item) => {
        if (!item.isDeleted) {
          // Exclude deleted products
          // Capitalize product name properly
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
            name: capitalizedName || item.name, // Use capitalized name or fallback to original
            satuan: item.satuan || [], // Ensure satuan defaults to array
          };
        }
      });

      setProducts(freshData);
      const productsArray = Object.values(freshData);

      // Sort by name initially
      sortProductsBy(productsArray, "name", "asc");

      // Log the collection path to verify it's using the correct environment
      console.log(
        `Fetching stocks from ${isProduction ? "production" : "testing"
        } environment`
      );
    } catch (error) {
      console.error("Error fetching stocks:", error);
    }
  }

  // Function to handle sorting logic
  const sortProductsBy = (productsArray, key, direction) => {
    let sortedProducts = [...productsArray];

    sortedProducts.sort((a, b) => {
      let aValue, bValue;

      // Special handling for derived fields
      if (key === "profitMargin") {
        aValue = computeMarginDetails(a).percent;
        bValue = computeMarginDetails(b).percent;
      } else if (key === "potentialProfit") {
        aValue = computePotentialProfitDetails(a).value;
        bValue = computePotentialProfitDetails(b).value;
      } else if (key === "pricePerUnit") {
        // Sort by price in the base/smallest unit
        const aBaseUnit = a.base_unit || a.smallestUnit;
        const bBaseUnit = b.base_unit || b.smallestUnit;
        aValue =
          a.pricePerUnit && a.pricePerUnit[aBaseUnit]
            ? a.pricePerUnit[aBaseUnit]
            : 0;
        bValue =
          b.pricePerUnit && b.pricePerUnit[bBaseUnit]
            ? b.pricePerUnit[bBaseUnit]
            : 0;
      } else if (key === "averageKulak") {
        // Sort by average kulak price
        aValue =
          a.stock && a.stock > 0 && a.stockValue
            ? Math.round(a.stockValue / a.stock)
            : 0;
        bValue =
          b.stock && b.stock > 0 && b.stockValue
            ? Math.round(b.stockValue / b.stock)
            : 0;
      } else {
        // Standard property sorting
        if (key === "smallestUnit") {
          aValue = a.base_unit || a.smallestUnit;
          bValue = b.base_unit || b.smallestUnit;
        } else {
          aValue = a[key];
          bValue = b[key];
        }
      }

      // Handle string comparison case-insensitive
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

  // ***** EXPORT FUNCTIONS *****

  const exportToExcel = () => {
    // Get current date for the filename
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const formattedDate = `${day}-${month}-${year}`;

    // Add metadata with the date at the top of the sheet
    const metadata = [
      { A: `Data Stock Tanggal: ${formattedDate}` },
      { A: "" }, // Empty row as separator
    ];
    const data = filteredProducts.map((p) => ({
      Nama: p.name,
      Kategori: p.kategori,
      SubKategori: p.subKategori,
      "Sumber Pasokan": p.tipeStock,
      "Jumlah Stock": p.stock,
      Satuan: p.base_unit || p.smallestUnit,
      "Harga Jual": `Rp ${computeHargaFormatted(p)}/${p.base_unit || p.smallestUnit}`,
      "Harga Kulak (avg)": `Rp ${computeAverageKulakPrice(p)}/${p.base_unit || p.smallestUnit}`,
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

  // Function to check if a snapshot exists for a specific date
  const checkSnapshotExists = async (date) => {
    try {
      // Use the environment-aware getDocRef function
      const snapshotDoc = await readDoc("stockSnapshots", date);

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

  // Function to export snapshot data to Excel
  const exportSnapshotToExcel = () => {
    if (!snapshotData || !selectedDate) return;

    // Format the date for display (yyyy-mm-dd to dd-mm-yyyy)
    const [year, month, day] = selectedDate.split("-");
    const formattedDate = `${day}-${month}-${year}`;

    // Add metadata with the date at the top of the sheet
    const metadata = [
      { A: `Data Stock Snapshot Tanggal: ${formattedDate}` },
      { A: "" }, // Empty row as separator
    ];

    // Create the data for the Excel sheet
    const stockItems = snapshotData.stocks || [];

    const data = stockItems.map((p) => ({
      Nama: p.name,
      Kategori: p.kategori || "",
      SubKategori: p.subKategori || "",
      Tipe: p.tipeStock || "",
      Stock: `${p.stock || 0} ${p.smallestUnit || ""}`,
      Satuan: p.smallestUnit || "",
      "Harga Jual":
        p.pricePerUnit && p.smallestUnit && p.pricePerUnit[p.smallestUnit]
          ? `Rp ${formatRupiah(p.pricePerUnit[p.smallestUnit])}/${p.smallestUnit
          }`
          : "Rp 0",
      "Harga Kulak (avg)":
        p.stock && p.stock > 0 && p.stockValue
          ? `Rp ${formatRupiah(Math.round(p.stockValue / p.stock))}/${p.smallestUnit
          }`
          : "Rp 0",
      "Nilai Total Stock": p.stockValue
        ? `Rp ${formatRupiah(Math.round(p.stockValue))}`
        : "Rp 0",
    }));

    // Create the worksheet
    const worksheet = XLSX.utils.json_to_sheet([]);

    // Add date metadata at the top
    XLSX.utils.sheet_add_json(worksheet, metadata, {
      skipHeader: true,
      origin: "A1",
    });

    // Add the product data starting from row 3
    XLSX.utils.sheet_add_json(worksheet, data, {
      origin: "A3",
      skipHeader: false,
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Stock Snapshot");
    XLSX.writeFile(workbook, `stock_snapshot_${formattedDate}.xlsx`);

    // Close the dialog
    setSnapshotDialogOpen(false);
  };

  const generatePriceTags = async (productsToUse) => {
    // Ensure jsPDF is loaded
    if (typeof jsPDF === "undefined") {
      console.error("jsPDF library is not loaded.");
      return;
    }

    // Load logo image
    let logoImg = null;
    try {
      logoImg = await loadImage("/Kop URG Logo (Latest).png");
    } catch (e) {
      console.error("Failed to load Kop URG Logo image:", e);
    }

    // --- Configuration ---
    const doc = new jsPDF("portrait", "mm", "a4"); // Use jsPDF constructor
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10; // Page margin in mm
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;

    // Layout: Adjust columns and rows for rectangular tags and more density
    const columns = 3; // Fewer columns for wider tags
    const rows = 8; // More rows per page
    const horizontalSpacing = 5; // Horizontal space between tags in mm
    const verticalSpacing = 5; // Vertical space between tags in mm

    // Calculate tag dimensions considering spacing
    const totalHorizontalSpacing = (columns - 1) * horizontalSpacing;
    const totalVerticalSpacing = (rows - 1) * verticalSpacing;
    const priceTagWidth = (usableWidth - totalHorizontalSpacing) / columns;
    const priceTagHeight = (usableHeight - totalVerticalSpacing) / rows;

    // Styling
    const currency = "Rp";
    const priceFontSize = 16; // Font size for the price number
    const currencyFontSize = 10; // Font size for "Rp"
    const nameFontSize = 8; // Font size for the product name
    const tagPadding = 3; // Internal padding within the tag in mm
    const blackColor = "#000000"; // Black color for text
    const uniMartPinkColor = "#f77b7b"; // Specific pink color rgb(247, 123, 123)

    // Stripe configuration
    const stripeHeight = 0.6; // Approximate 3px in mm
    const stripeSpacing = 0.25; // Approximate 1px in mm

    // UniMart Text configuration
    const uniMartText = "UniMart";
    const uniMartFontSize = 9; // Increased font size from 6 to 9
    const uniMartPadding = 1.5; // Increased padding for larger text
    const uniMartBottomMargin = 1; // Space between UniMart box and stripes

    // --- PDF Generation ---

    // Add title (optional, can be removed if not needed)
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(blackColor); // Set title color to black
    doc.text("Price Tags", pageWidth / 2, margin / 2 + 2, { align: "center" });

    // Start position for the first tag
    let currentX = margin;
    let currentY = margin;
    let itemCount = 0;
    const itemsPerPage = columns * rows;

    // Iterate through products
    productsToUse.forEach((product, index) => {
      // Add a new page if the current one is full
      if (itemCount > 0 && itemCount % itemsPerPage === 0) {
        doc.addPage();
        currentX = margin; // Reset X position for new page
        currentY = margin; // Reset Y position for new page
      }

      // --- Calculate Tag Content ---
      // Get price value (handle potential missing price)
      const priceValue =
        product.pricePerUnit && product.pricePerUnit[product.base_unit || product.smallestUnit]
          ? formatRupiah(product.pricePerUnit[product.base_unit || product.smallestUnit])
          : "0";
      const productName = product.name ? product.name.toUpperCase() : "N/A";

      // --- Draw Tag Border ---
      doc.setDrawColor(150, 150, 150); // Light gray border
      doc.setLineWidth(0.2);
      doc.rect(currentX, currentY, priceTagWidth, priceTagHeight, "S"); // 'S' for stroke

      // --- Add Price ---
      // Set text color to black for price elements
      doc.setTextColor(blackColor); // << CHANGED: Set text color to black

      // Currency ("Rp") - Left aligned
      doc.setFontSize(currencyFontSize);
      doc.setFont("helvetica", "normal");
      // Simple vertical centering without getLineHeightRatio
      const currencyYAdjust = currencyFontSize * 0.35; // Simplified adjustment factor
      doc.text(
        currency,
        currentX + tagPadding,
        currentY + tagPadding + currencyYAdjust
      );

      // Price Value - Right aligned
      doc.setFontSize(priceFontSize);
      doc.setFont("helvetica", "bold");
      const priceValueWidth = doc.getTextWidth(priceValue);
      const priceYAdjust = priceFontSize * 0.35; // Simplified adjustment factor
      doc.text(
        priceValue,
        currentX + priceTagWidth - tagPadding - priceValueWidth,
        currentY + tagPadding + priceYAdjust
      );

      // --- Add Product Name ---
      doc.setTextColor(blackColor); // << CHANGED: Set text color to black
      doc.setFontSize(nameFontSize);
      doc.setFont("helvetica", "normal");
      // Position below the baseline of the price line
      const nameYPos = currentY + tagPadding + priceYAdjust + 5; // Add space below price
      const maxNameWidth = priceTagWidth - tagPadding * 2;

      // Handle potential text wrapping for long names
      const nameLines = doc.splitTextToSize(productName, maxNameWidth);
      const maxLines = 2; // Limit name to a maximum of 2 lines
      const linesToDisplay = nameLines.slice(0, maxLines);

      doc.text(linesToDisplay, currentX + tagPadding, nameYPos);

      // --- Calculate Stripe Start Position ---
      const totalStripeHeight = 3 * stripeHeight + 2 * stripeSpacing;
      const stripeStartY =
        currentY + priceTagHeight - totalStripeHeight - tagPadding; // Align bottom of stripes with bottom padding

      // --- Add UniMart Text with Background (Draw *before* stripes but position above them) ---
      doc.setFontSize(uniMartFontSize);
      doc.setFont("helvetica", "bold"); // Changed from italic to bold
      const uniMartWidth = doc.getTextWidth(uniMartText);
      const uniMartLineHeight = uniMartFontSize * 0.35; // Simplified height factor

      // Background calculations
      const uniMartBgWidth = uniMartWidth + 2 * uniMartPadding;
      const uniMartBgHeight = uniMartLineHeight + 2 * uniMartPadding;
      const uniMartBgX = currentX + priceTagWidth - tagPadding - uniMartBgWidth; // Align right edge
      const uniMartBgY = stripeStartY - uniMartBottomMargin - uniMartBgHeight; // Position above stripes

      // Text calculations
      const uniMartTextX = uniMartBgX + uniMartPadding;
      const uniMartTextY = uniMartBgY + uniMartPadding + uniMartLineHeight; // Align text baseline within background

      // Draw white background for the UniMart text box
      doc.setFillColor(255, 255, 255); // White color
      doc.rect(uniMartBgX, uniMartBgY, uniMartBgWidth, uniMartBgHeight, "F"); // 'F' for fill

      // Draw 'UniMart' text with the specified pink color
      doc.setTextColor(uniMartPinkColor); // << CHANGED: Set text color to UniMart pink
      doc.text(uniMartText, uniMartTextX, uniMartTextY);

      // --- Add Logo (Draw next to the UniMart text) ---
      if (logoImg) {
        const logoHeight = uniMartBgHeight; // Same height as UniMart text background
        const logoAspectRatio = logoImg.naturalWidth / logoImg.naturalHeight;
        const logoWidth = logoHeight * logoAspectRatio;

        const logoX = currentX + tagPadding;
        const logoY = stripeStartY - uniMartBottomMargin - logoHeight;

        doc.addImage(logoImg, "PNG", logoX, logoY, logoWidth, logoHeight);
      }

      // --- Add Bottom Stripes with varying opacity (Draw *after* UniMart text) ---

      // Bottom stripe (100% opacity) - third/bottom stripe
      doc.setFillColor(uniMartPinkColor); // Full opacity pink
      doc.rect(
        currentX + tagPadding,
        stripeStartY + 2 * (stripeHeight + stripeSpacing),
        priceTagWidth - tagPadding * 2,
        stripeHeight,
        "F"
      );

      // Middle stripe (75% opacity) - second/middle stripe
      // Convert RGB string to RGB values for opacity manipulation
      const pinkRGB = [247, 123, 123]; // Extracted from the color #f77b7b
      // Create color with 75% opacity
      doc.setFillColor(pinkRGB[0], pinkRGB[1], pinkRGB[2]);
      // The second parameter is the opacity/alpha (0.75 = 75%)
      doc.setGState(new doc.GState({ opacity: 0.75 }));
      doc.rect(
        currentX + tagPadding,
        stripeStartY + stripeHeight + stripeSpacing,
        priceTagWidth - tagPadding * 2,
        stripeHeight,
        "F"
      );

      // Top stripe (50% opacity) - first/top stripe
      // Create color with 50% opacity
      doc.setFillColor(pinkRGB[0], pinkRGB[1], pinkRGB[2]);
      doc.setGState(new doc.GState({ opacity: 0.5 }));
      doc.rect(
        currentX + tagPadding,
        stripeStartY,
        priceTagWidth - tagPadding * 2,
        stripeHeight,
        "F"
      );

      // Reset opacity to 100% for subsequent elements
      doc.setGState(new doc.GState({ opacity: 1.0 }));

      // --- Update Position for Next Tag ---
      currentX += priceTagWidth + horizontalSpacing;
      itemCount++;

      // Move to the next row if the current row is full
      if (itemCount % columns === 0) {
        currentX = margin; // Reset X to the left margin
        currentY += priceTagHeight + verticalSpacing; // Move Y down to the next row
      }
    });

    // --- Finalize and Save ---
    try {
      doc.save("price_tags_redesigned.pdf");
      // Show success message
      showSuccessMessage(
        `Price tags generated for ${productsToUse.length} products.`
      );
    } catch (error) {
      console.error("Error saving PDF:", error);
    }
  };

  // ***** SAVE/SUBMIT FUNCTIONS *****

  async function handleSave(type) {
    // Use the passed type parameter or fallback to dialogType
    const currentDialogType = type || dialogType;

    const costValue = parseRupiah(tempCost);

    const createBaseTransactionDoc = (prod) => ({
      itemId: prod.itemId,
      itemName: prod.name,
      kategori: prod.kategori,
      subKategori: prod.subKategori,
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
        !tempBaseUnit ||
        (tempKategori === "Makanan" ||
          tempKategori === "Minuman" ||
          tempKategori === "Obat-Obatan"
          ? !tempSubKategori
          : false)
      ) {
        alert("All mandatory fields must be filled!");
        return;
      }
      if (tempBulkUnitName && !tempBulkUnitConversion) {
        alert("Konversi Satuan Besar wajib diisi!");
        return;
      }
      let docBase = tempDocId.trim();
      if (!docBase) {
        docBase = getTimestampString();
      }
      const finalDocId = `${tempName}_${docBase}`.replace(/\s+/g, "_");
      const newDoc = {
        itemId: docBase,
        name: tempName.trim(),
        kategori: tempKategori,
        subKategori: tempSubKategori || tempKategori,
        tipeStock: tempTipeStock,
        namaPemasok: tempNamaPemasok,
        lastPurchasePrice: Math.round(parseRupiah(tempLastPurchasePrice)),
        // Renamed fields:
        base_unit: tempBaseUnit,
        bulk_unit_name: tempBulkUnitName || null,
        bulk_unit_conversion: tempBulkUnitName ? parseInt(tempBulkUnitConversion, 10) : null,
        // Legacy fallback fields:
        smallestUnit: tempBaseUnit,
        piecesPerBox: tempBulkUnitName ? parseInt(tempBulkUnitConversion, 10) : null,
        satuan: Array.from(
          new Set([tempBaseUnit, tempBulkUnitName].filter(Boolean))
        ),
        pricePerUnit: Object.keys(tempPricePerUnit).reduce((acc, key) => {
          acc[key] = Math.round(parseRupiah(tempPricePerUnit[key]));
          return acc;
        }, {}),
        stock: 0,
        stockValue: 0,
        isDeleted: false,
      };
      await createDoc("stocks", newDoc, finalDocId);
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

        // Convert to smallest unit
        const quantityInSmallestUnit = convertToSmallestUnit(
          rawAmount,
          tempSatuan,
          prod
        );
        if (!Number.isInteger(quantityInSmallestUnit)) {
          throw new Error(
            `Jumlah dalam ${prod.smallestUnit || "satuan terkecil"} harus bilangan bulat`
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

        // Update database
        const txId = await generateIncrementalId(
          queryCollection,
          query,
          where,
          "stockTransactions",
          "ADD"
        );
        await createDoc("stockTransactions", txDoc, txId);

        const newStock = (prod.stock || 0) + quantityInSmallestUnit;
        const lastPurchasePrice = quantityInSmallestUnit > 0 ? Math.round(costValue / quantityInSmallestUnit) : 0;
        await updateDoc("stocks", selectedProductId, {
          stock: newStock,
          stockValue: (prod.stockValue || 0) + costValue,
          lastPurchasePrice: lastPurchasePrice,
        });

        // Update local state
        setProducts((prev) => ({
          ...prev,
          [selectedProductId]: {
            ...prev[selectedProductId],
            stock: newStock,
            stockValue: (prev[selectedProductId].stockValue || 0) + costValue,
            lastPurchasePrice: lastPurchasePrice,
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
      // Allow 0 values but don't allow empty values
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

        // Convert to smallest unit
        const newStock = convertToSmallestUnit(
          originalQuantity,
          originalUnit,
          prod
        );
        if (!Number.isInteger(newStock)) {
          throw new Error(
            `Jumlah dalam ${prod.smallestUnit || "satuan terkecil"} harus bilangan bulat`
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

        // Updated transaction document with standardized fields
        const txDoc = {
          ...createBaseTransactionDoc(prod),
          transactionType,
          transactionVia: STOCK_CORRECTION_VIA,
          quantity,
          cost: 0,
          originalQuantity,
          originalUnit,
          unit: prod.smallestUnit,
        };

        const txId = await generateIncrementalId(
          queryCollection,
          query,
          where,
          "stockTransactions",
          "SET"
        );
        await createDoc("stockTransactions", txDoc, txId);

        await updateDoc("stocks", selectedProductId, {
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
        // Validate mandatory fields
        if (
          !tempName.trim() ||
          !tempKategori ||
          !tempTipeStock ||
          !tempBaseUnit
        ) {
          throw new Error("All mandatory fields must be filled!");
        }

        if (tempBulkUnitName && !tempBulkUnitConversion) {
          throw new Error("Konversi Satuan Besar wajib diisi!");
        }

        // Prepare updated product data
        const updatedProduct = {
          ...prod,
          name: tempName.trim(),
          itemId: tempItemId,
          kategori: tempKategori,
          subKategori: tempSubKategori,
          tipeStock: tempTipeStock,
          namaPemasok: tempNamaPemasok,
          lastPurchasePrice: Math.round(parseRupiah(tempLastPurchasePrice)),
          // Renamed fields:
          base_unit: tempBaseUnit,
          bulk_unit_name: tempBulkUnitName || null,
          bulk_unit_conversion: tempBulkUnitName ? parseInt(tempBulkUnitConversion, 10) : null,
          // Legacy fallback fields:
          smallestUnit: tempBaseUnit,
          piecesPerBox: tempBulkUnitName ? parseInt(tempBulkUnitConversion, 10) : null,
          satuan: Array.from(new Set([tempBaseUnit, tempBulkUnitName].filter(Boolean))),
          pricePerUnit: Object.keys(tempPricePerUnit).reduce((acc, unit) => {
            acc[unit] = Math.round(parseRupiah(tempPricePerUnit[unit]));
            return acc;
          }, {}),
        };

        // Convert stock if base unit changed
        if (tempBaseUnit !== originalSmallestUnit) {
          updatedProduct.stock = convertToSmallestUnit(
            prod.stock,
            originalSmallestUnit,
            updatedProduct
          );
        }

        // Update stock value based on new prices
        if (updatedProduct.pricePerUnit[tempBaseUnit]) {
          updatedProduct.stockValue = prod.stockValue;
        }

        // Update database
        await updateDoc("stocks", selectedProductId, updatedProduct);

        // Update local state
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

        // Log the deletion in stockTransactions
        const txId = await generateIncrementalId(
          queryCollection,
          query,
          where,
          "stockTransactions",
          "DEL"
        );
        await createDoc(
          "stockTransactions",
          {
            itemId: product.itemId || "",
            itemName: product.name,
            kategori: product.kategori || "",
            subKategori: product.subKategori || "",
            quantity: product.stock || 0,
            unit: product.smallestUnit || "",
            cost: product.stockValue || 0,
            price: 0,
            originalQuantity: product.stock || 0,
            originalUnit: product.smallestUnit || "",
            isDeleted: false,
            transactionType: "pengurangan",
            transactionVia: "stockDeletion",
            stockWorth: product.stockValue || 0,
            note: "Stock dihapus dari sistem",
            createdBy: currentUser ? currentUser.email : "unknown",
          },
          txId
        );

        // Delete the product from Firestore
        await deleteDoc("stocks", selectedProductId);

        // Update local state
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

  // Initial and environment change data fetching
  useEffect(() => {
    fetchAllStocks();
    fetchSummaryData();
    setSelectedItems({}); // Reset checkboxes when environment changes
  }, [isProduction]);

  // Apply sorting when search results change
  useEffect(() => {
    if (searchTerm.trim() === "" && selectedCategory === "") {
      sortProductsBy(
        Object.values(products),
        sortConfig.key,
        sortConfig.direction
      );
    } else {
      sortProductsBy(filteredProducts, sortConfig.key, sortConfig.direction);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, selectedCategory, products]);

  // Handle search term and category changes
  useEffect(() => {
    const input = searchTerm.trim();
    let list = Object.values(products);

    if (selectedCategory) {
      list = list.filter((p) => p.kategori === selectedCategory);
    }

    if (!input) {
      setFilteredProducts(list);
      sortProductsBy(list, sortConfig.key, sortConfig.direction);
      return;
    }

    const numericRegex = /^[0-9]+$/;
    if (numericRegex.test(input)) {
      const exactMatch = list.find(
        (p) => p.itemId && p.itemId.toString() === input
      );
      setFilteredProducts(exactMatch ? [exactMatch] : []);
    } else {
      const words = input.toLowerCase().split(/\s+/);
      const newList = list.filter((prod) => {
        const name = prod.name.toLowerCase();
        return words.every((w) => name.includes(w));
      });
      setFilteredProducts(newList);

      // Maintain current sort order with new filtered results
      sortProductsBy(newList, sortConfig.key, sortConfig.direction);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, selectedCategory, products]);

  // Handle click outside dropdown
  useEffect(() => {
    function handleClickOutside(e) {
      if (
        showDropdown &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target)
      ) {
        setShowDropdown(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDropdown]);

  // Handle escape key for dialog
  useEffect(() => {
    function handleEsc(e) {
      if (dialogOpen && e.key === "Escape") {
        closeDialog();
      }
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [dialogOpen]);

  // Focus first field when dialog opens
  useEffect(() => {
    if (dialogOpen && firstFieldRef.current) {
      setTimeout(() => {
        if (firstFieldRef.current) {
          firstFieldRef.current.focus();
        }
      }, 0);
    }
  }, [dialogOpen, dialogType]);



  // ***** COMPONENT RENDERING *****
  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Inventori Unimart</h1>
          <p className="text-sm text-gray-500 mt-1">Kelola produk dan nilai stok Unipdu Mart</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <button
              className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg shadow-sm hover:bg-gray-50 transition text-sm flex items-center gap-2"
              onClick={() => setShowDatePicker(!showDatePicker)}
            >
              <FaCalendarAlt /> Lihat Snapshot
            </button>
            {showDatePicker && (
              <div className="absolute right-0 mt-2 p-4 bg-white border border-gray-200 rounded-lg shadow-lg z-50 flex flex-col gap-2 min-w-[200px]">
                <input
                  type="date"
                  className="p-2 border border-gray-300 rounded-md text-sm outline-none"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
                <button
                  className="px-4 py-2 bg-primary hover:bg-red-700 text-white font-bold rounded-lg text-xs transition"
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
          {canSeeProfit && (
            <button
              className={`px-5 py-2.5 font-bold rounded-lg shadow-sm transition text-sm flex items-center gap-2 ${showMargin
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              onClick={() => setShowMargin(!showMargin)}
            >
              {showMargin ? <FaCheckCircle /> : <FaPercentage />} Kalkulasi Margin
            </button>
          )}
          <button
            className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg shadow-sm hover:bg-gray-50 transition text-sm flex items-center gap-2"
            onClick={() =>
              generatePriceTags(
                Object.values(selectedItems).some((item) => item)
                  ? filteredProducts.filter((p) => selectedItems[p.id])
                  : filteredProducts
              )
            }
          >
            <FaTag /> Generate Price Tags
          </button>

          <button
            className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg shadow-sm hover:bg-gray-50 transition text-sm flex items-center gap-2"
            onClick={handleSelectAllMarked}
          >
            <FaCheckCircle className="text-yellow-500" /> Pilih Semua Ditandai
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

      {/* Summary Cards Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <SummaryCard
          title="Belanja Bulan Ini"
          value={summaryData.monthlyPurchase}
          color="text-blue-600"
        />
        <SummaryCard
          title="Total Nilai Stok"
          value={summaryData.currentStockWorth}
          color="text-gray-900"
        />
      </div>

      {/* View Presets Segmented Controls */}
      <div className="flex flex-wrap gap-2 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {Object.entries(VIEW_PRESETS)
          .filter(([key]) => canSeeProfit || key !== "keuntungan")
          .map(([key, preset]) => (
          <button
            key={key}
            onClick={() => handleViewPresetChange(key)}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              selectedViewPreset === key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-905"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Search Bar & Category Filter */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-grow">
          <input
            type="text"
            placeholder="Cari produk atau ID..."
            className="w-full p-3 pl-10 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <svg className="w-5 h-5 absolute left-3 top-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none text-gray-600 bg-white min-w-[200px]"
        >
          <option value="">Semua Kategori</option>
          {Array.from(new Set(Object.values(products).map(p => p.kategori).filter(Boolean))).sort().map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 w-12 text-center">
                  <input
                    type="checkbox"
                    className="rounded text-primary focus:ring-primary"
                    onChange={handleSelectAll}
                    checked={
                      filteredProducts.length > 0 &&
                      filteredProducts.every((prod) => selectedItems[prod.id])
                    }
                  />
                </th>
                <th
                  onClick={() => requestSort("name")}
                  className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs cursor-pointer hover:bg-gray-100 transition select-none"
                >
                  <div className="flex items-center gap-1">
                    Nama Barang
                    {sortConfig.key === "name" ? (
                      sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />
                    ) : <FaSort className="text-gray-400" />}
                  </div>
                </th>
                {isColumnVisible("kategori") && (
                  <th
                    onClick={() => requestSort("kategori")}
                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs cursor-pointer hover:bg-gray-100 transition select-none"
                  >
                    <div className="flex items-center gap-1">
                      Kategori
                      {sortConfig.key === "kategori" ? (
                        sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />
                      ) : <FaSort className="text-gray-400" />}
                    </div>
                  </th>
                )}
                {isColumnVisible("subKategori") && (
                  <th
                    onClick={() => requestSort("subKategori")}
                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs cursor-pointer hover:bg-gray-100 transition select-none"
                  >
                    <div className="flex items-center gap-1">
                      Sub Kategori
                      {sortConfig.key === "subKategori" ? (
                        sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />
                      ) : <FaSort className="text-gray-400" />}
                    </div>
                  </th>
                )}
                {isColumnVisible("smallestUnit") && (
                  <th
                    onClick={() => requestSort("smallestUnit")}
                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs cursor-pointer hover:bg-gray-100 transition select-none"
                  >
                    <div className="flex items-center gap-1">
                      Satuan
                      {sortConfig.key === "smallestUnit" ? (
                        sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />
                      ) : <FaSort className="text-gray-400" />}
                    </div>
                  </th>
                )}
                {isColumnVisible("stock") && (
                  <th
                    onClick={() => requestSort("stock")}
                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      Jumlah Stock
                      {sortConfig.key === "stock" ? (
                        sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />
                      ) : <FaSort className="text-gray-400" />}
                    </div>
                  </th>
                )}
                {isColumnVisible("averageKulak") && (
                  <th
                    onClick={() => requestSort("averageKulak")}
                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      Harga Beli
                      {sortConfig.key === "averageKulak" ? (
                        sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />
                      ) : <FaSort className="text-gray-400" />}
                    </div>
                  </th>
                )}
                {isColumnVisible("pricePerUnit") && (
                  <th
                    onClick={() => requestSort("pricePerUnit")}
                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      Harga Jual
                      {sortConfig.key === "pricePerUnit" ? (
                        sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />
                      ) : <FaSort className="text-gray-400" />}
                    </div>
                  </th>
                )}
                {isColumnVisible("profitMargin") && (
                  <th
                    onClick={() => requestSort("profitMargin")}
                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      Margin Keuntungan
                      {sortConfig.key === "profitMargin" ? (
                        sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />
                      ) : <FaSort className="text-gray-400" />}
                    </div>
                  </th>
                )}
                {isColumnVisible("potentialProfit") && (
                  <th
                    onClick={() => requestSort("potentialProfit")}
                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      Potensi Keuntungan
                      {sortConfig.key === "potentialProfit" ? (
                        sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />
                      ) : <FaSort className="text-gray-400" />}
                    </div>
                  </th>
                )}
                {isColumnVisible("stockValue") && (
                  <th
                    onClick={() => requestSort("stockValue")}
                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      Total Nilai
                      {sortConfig.key === "stockValue" ? (
                        sortConfig.direction === "asc" ? <FaSortUp /> : <FaSortDown />
                      ) : <FaSort className="text-gray-400" />}
                    </div>
                  </th>
                )}
                <th className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-center w-16">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredProducts.map((prod) => (
                <tr
                  key={prod.id}
                  className={`${prod.isMarked
                    ? "bg-yellow-50 hover:bg-yellow-100/80"
                    : "hover:bg-gray-50"
                    } transition-colors`}
                >
                  <td className="px-6 py-4 text-center">
                    <input
                      type="checkbox"
                      className="rounded text-primary focus:ring-primary"
                      checked={!!selectedItems[prod.id]}
                      onChange={() => toggleItemSelection(prod.id)}
                    />
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900">{prod.name}</td>
                  {isColumnVisible("kategori") && (
                    <td className="px-6 py-4 text-gray-600">{prod.kategori || "-"}</td>
                  )}
                  {isColumnVisible("subKategori") && (
                    <td className="px-6 py-4 text-gray-600">{prod.subKategori || "-"}</td>
                  )}
                  {isColumnVisible("smallestUnit") && (
                    <td className="px-6 py-4">{prod.base_unit || prod.smallestUnit}</td>
                  )}
                  {isColumnVisible("stock") && (
                    <td className="px-6 py-4 text-right font-bold text-gray-900">
                      {prod.stock}
                    </td>
                  )}
                  {isColumnVisible("averageKulak") && (
                    <td className="px-6 py-4 text-right text-gray-600">
                      Rp {computeAverageKulakPrice(prod)}
                    </td>
                  )}
                  {isColumnVisible("pricePerUnit") && (
                    <td className="px-6 py-4 text-right text-gray-600">
                      Rp {computeHargaFormatted(prod)}
                    </td>
                  )}
                  {isColumnVisible("profitMargin") && (() => {
                    const margin = computeMarginDetails(prod);
                    return (
                      <td className={`px-6 py-4 text-right font-semibold ${margin.isNegative
                        ? "text-red-600"
                        : margin.isPositive
                          ? "text-green-600"
                          : "text-gray-600"
                        }`}>
                        {margin.isNegative ? "-" : ""}{margin.formatted}
                      </td>
                    );
                  })()}
                  {isColumnVisible("potentialProfit") && (() => {
                    const potProfit = computePotentialProfitDetails(prod);
                    return (
                      <td className={`px-6 py-4 text-right font-semibold ${potProfit.isNegative
                        ? "text-red-600"
                        : potProfit.isPositive
                          ? "text-green-600"
                          : "text-gray-600"
                        }`}>
                        {potProfit.isNegative ? "-" : ""}{potProfit.formatted}
                      </td>
                    );
                  })()}
                  {isColumnVisible("stockValue") && (
                    <td className="px-6 py-4 text-right font-medium text-gray-900">
                      Rp {computeNilaiFormatted(prod)}
                    </td>
                  )}
                  <td className="px-6 py-4 text-center">
                    <button
                      onClick={(e) => handleActionClick(e, prod.id)}
                      className="p-2 rounded-lg hover:bg-gray-100 transition text-gray-500 hover:text-gray-700"
                      title="Aksi"
                    >
                      <FaEllipsisV />
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-lg shadow-xl p-6">
            {snapshotExists ? (
              <>
                <h2 className="text-lg font-bold text-gray-900 mb-4">Stock Snapshot</h2>
                <p className="text-sm text-gray-600 mb-6">
                  Download snapshot stock tanggal{" "}
                  {selectedDate.split("-").reverse().join("-")}?
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                    onClick={() => setSnapshotDialogOpen(false)}
                  >
                    No
                  </button>
                  <button
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    onClick={exportSnapshotToExcel}
                  >
                    Yes
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-gray-900 mb-4">Stock Snapshot</h2>
                <p className="text-sm text-gray-600 mb-6">
                  Tidak ada stockSnapshot untuk tanggal{" "}
                  {selectedDate.split("-").reverse().join("-")}
                </p>
                <div className="flex justify-end">
                  <button
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
                    onClick={() => setSnapshotDialogOpen(false)}
                  >
                    Okay
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Stock Modal Component */}
      {dialogOpen && (
        <StockModal
          dialogOpen={dialogOpen}
          dialogType={dialogType}
          selectedProductId={selectedProductId}
          products={products}
          onClose={closeDialog}
          onSave={handleSave}
          convertToSmallestUnit={convertToSmallestUnit}
          tempState={{
            tempName,
            tempItemId,
            tempKategori,
            tempSubKategori,
            tempTipeStock,
            tempNamaPemasok,
            tempBaseUnit,
            tempBulkUnitName,
            tempPricePerUnit,
            tempAmount,
            tempSatuan,
            tempCost,
            tempBulkUnitConversion,
            tempDocId,
            originalSmallestUnit,
            tempLastPurchasePrice,
          }}
          setTempState={(newState) => {
            if ("tempName" in newState) setTempName(newState.tempName);
            if ("tempItemId" in newState) setTempItemId(newState.tempItemId);
            if ("tempKategori" in newState) setTempKategori(newState.tempKategori);
            if ("tempSubKategori" in newState) setTempSubKategori(newState.tempSubKategori);
            if ("tempTipeStock" in newState) setTempTipeStock(newState.tempTipeStock);
            if ("tempNamaPemasok" in newState) setTempNamaPemasok(newState.tempNamaPemasok);
            if ("tempBaseUnit" in newState) setTempBaseUnit(newState.tempBaseUnit);
            if ("tempBulkUnitName" in newState) setTempBulkUnitName(newState.tempBulkUnitName);
            if ("tempPricePerUnit" in newState) setTempPricePerUnit(newState.tempPricePerUnit);
            if ("tempAmount" in newState) setTempAmount(newState.tempAmount);
            if ("tempSatuan" in newState) setTempSatuan(newState.tempSatuan);
            if ("tempCost" in newState) setTempCost(newState.tempCost);
            if ("tempBulkUnitConversion" in newState) setTempBulkUnitConversion(newState.tempBulkUnitConversion);
            if ("tempDocId" in newState) setTempDocId(newState.tempDocId);
            if ("tempLastPurchasePrice" in newState) setTempLastPurchasePrice(newState.tempLastPurchasePrice);
          }}
        />
      )}

      {/* Snackbar for notifications */}
      {snackbar.open && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg z-50 text-sm">
          {snackbar.message}
        </div>
      )}


      {/* Bulk Purchase Modal */}
      <BulkPurchaseModal
        isOpen={showBulkPurchaseModal}
        onClose={() => setShowBulkPurchaseModal(false)}
        onSave={async (action, data, id, collectionName) => {
          if (action === "createTransaction") {
            await createDoc("stockTransactions", data, id);
          } else if (action === "updateStock") {
            await updateDoc("stocks", data.id, {
              stock: data.stock,
              stockValue: data.stockValue,
              lastPurchasePrice: data.lastPurchasePrice,
            });
            // Update local state
            setProducts((prev) => ({
              ...prev,
              [data.id]: {
                ...prev[data.id],
                stock: data.stock,
                stockValue: data.stockValue,
                lastPurchasePrice: data.lastPurchasePrice,
              },
            }));
          } else if (action === "createNotaBelanja") {
            await createDoc(collectionName || "notaBelanja", data, id);
          } else if (action === "createExpense") {
            // Every Pembelian Grosir shows up in the Finance ledger as an expense.
            await cashflowService.addExpense(
              {
                amount: data.amount,
                category: data.category,
                sourceAccount: data.sourceAccount,
                dateKey: getLocalDateKey(),
                addedFrom: "bulkPurchase",
                createdBy: currentUser?.email || "unknown",
                bulkPurchaseId: data.bulkPurchaseId,
              },
              isProduction
            );
          }
        }}
        products={products}
        currentUser={currentUser}
        collectionPrefix="stocks"
        transactionCollection="stockTransactions"
        isWarehouse={false}
      />

      {/* Dropdown menu rendered outside the table to avoid overflow clipping */}
      {showDropdown && (
        <div
          className="fixed w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
          style={{ top: menuPos.top, left: menuPos.left }}
          onClick={(e) => e.stopPropagation()}
          ref={dropdownRef}
        >
          <button
            onClick={() => {
              const p = products[showDropdown];
              setShowDropdown(null);
              openDialog("tambah", p.id);
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            Tambah
          </button>
          <button
            onClick={() => {
              const p = products[showDropdown];
              setShowDropdown(null);
              openDialog("tetapkan", p.id);
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            Tetapkan
          </button>
          <button
            onClick={() => {
              const p = products[showDropdown];
              setShowDropdown(null);
              openDialog("edit", p.id);
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            Edit Barang
          </button>
          <button
            onClick={async () => {
              const p = products[showDropdown];
              setShowDropdown(null);
              try {
                const nextMarked = !p.isMarked;
                await updateDoc("stocks", p.id, {
                  isMarked: nextMarked,
                });
                setProducts((prev) => ({
                  ...prev,
                  [p.id]: {
                    ...prev[p.id],
                    isMarked: nextMarked,
                  },
                }));
              } catch (error) {
                alert("Gagal memperbarui status tanda: " + error.message);
              }
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 font-medium"
          >
            {products[showDropdown]?.isMarked ? "Hapus Tanda" : "Tandai"}
          </button>
        </div>
      )}
    </div>
  );
}
