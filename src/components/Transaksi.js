// src/components/Transaksi.js
import React, { useState, useEffect, useRef } from "react";
import "../styles/Transaksi.css";
import { useAuth } from "../context/AuthContext";
import { useFirestore } from "../context/FirestoreContext";
import { useEnvironment } from "../context/EnvironmentContext";
import { printReceipt as printerServicePrint } from "../services/PrinterService";
import { voucherService } from "../services/voucherService";
import PaymentModal from "./PaymentModal";
import LaporanHarianModal from "./cashflow/LaporanHarianModal";
import CatatPengeluaranModal from "./cashflow/CatatPengeluaranModal";
import {
  convertToSmallestUnit,
  convertFromSmallestUnit,
  formatCurrency,
  getInitialQuantity,
  getIncrement,
  getPriceAndSubtotal,
  CONVERSION_TABLE,
} from "../utils/transaksiUtils";
import { getUnitCost, roundRupiah, toFiniteNumber } from "../utils/profitUtils";
import {
  WHOLE_NUMBER_MESSAGE,
  hasDecimalSeparator,
  keepDigits,
  parseWholeNumber,
} from "../utils/stockTransactionUtils";

// Utility function to set local print server URL (can be called from settings)
export const setLocalPrintServer = (url = "http://localhost:9001") => {
  localStorage.setItem("localPrintServerUrl", url);
  console.log(`Local print server URL saved: ${url}`);
};

// Import the necessary escpos modules at the top of the file
// import escpos from 'escpos';
// import USB from 'escpos-usb';
// escpos.USB = USB;

// Function to print receipt - note that setSnackbar is passed as a parameter
// The printer service is imported at the top of the file



// Enhanced receipt printing function with voucher support
const printReceiptWithVoucher = async (receiptData, setSnackbarFn) => {
  try {
    const {
      transactionId,
      items,
      total,
      amountPaid,
      change,
      appliedVoucher,
      memberData,
      memberName,
      nomorAnggota,
    } = receiptData;

    const effectiveMemberName =
      memberName || memberData?.nama || appliedVoucher?.memberName || null;
    const effectiveNomorAnggota =
      nomorAnggota ||
      memberData?.nomorAnggota ||
      appliedVoucher?.nomorAnggota ||
      null;

    // Get current date and time
    const now = new Date();
    const dateTimeStr = now.toLocaleTimeString("id-ID").replace(/\./g, ":");

    // Create receipt data model with voucher support
    const receiptItems = items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.satuan,
      price: item.price,
      subtotal: item.subtotal,
    }));

    // Add voucher as an item if applied
    if (appliedVoucher) {
      const actualDiscount = Math.min(appliedVoucher.value, total);
      receiptItems.push({
        name: appliedVoucher.name,
        quantity: 1,
        unit: "",
        price: -actualDiscount,
        subtotal: -actualDiscount,
      });
    }

    const receiptDataModel = {
      header: {
        storeName: "UniMart • Unipdu Mart",
        storeAddress: "Kompleks Pondok Pesantren Darul Ulum",
        storeCity: "Jombang, Jawa Timur",
        title: "Struk Pembelian",
      },
      info: {
        transactionId: transactionId,
        dateTime: dateTimeStr,
        memberName: effectiveMemberName,
        nomorAnggota: effectiveNomorAnggota,
      },
      memberName: effectiveMemberName,
      nomorAnggota: effectiveNomorAnggota,
      member: {
        name: effectiveMemberName,
        nomorAnggota: effectiveNomorAnggota,
      },
      items: receiptItems,
      summary: {
        total: appliedVoucher
          ? Math.max(0, total - appliedVoucher.value)
          : total,
        amountPaid: parseInt(amountPaid.replace(/\D/g, ""), 10) || 0,
        change: change,
      },
      appliedVoucher: appliedVoucher,
      paymentMethod: receiptData.paymentMethod,
      qrisAmount: receiptData.qrisAmount,
      cashAmount: receiptData.cashAmount,
    };

    // Use the PrinterService to handle printing logic
    console.log("Attempting to print receipt with voucher...");

    const success = await printerServicePrint(receiptDataModel);

    if (!success) {
      console.warn("All printing methods failed");
      if (typeof setSnackbarFn === "function") {
        setSnackbarFn({
          open: true,
          message: "Gagal mencetak struk. Periksa koneksi printer.",
          severity: "warning",
        });
      }
    }
  } catch (error) {
    console.error("Error printing receipt:", error);
    if (typeof setSnackbarFn === "function") {
      setSnackbarFn({
        open: true,
        message: `Error mencetak struk: ${error.message}`,
        severity: "error",
      });
    }
  }
};

const Transaksi = () => {
  const { currentUser } = useAuth();
  const {
    createDoc,
    readDoc,
    updateDoc,
    serverTimestamp,
    queryCollection,
  } = useFirestore();
  const { isProduction } = useEnvironment();
  const [quantityInputs, setQuantityInputs] = useState({});
  const [productId, setProductId] = useState("");
  const [enterKeyHoldTimer, setEnterKeyHoldTimer] = useState(null);
  const [enterKeyDownTime, setEnterKeyDownTime] = useState(null);

  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [useScanner, setUseScanner] = useState(true);
  const [suggestions, setSuggestions] = useState([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [currentSatuanIndex, setCurrentSatuanIndex] = useState(0);
  const [currentQuantity, setCurrentQuantity] = useState(1);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const [productData, setProductData] = useState({});
  const [snackbars, setSnackbars] = useState([]);

  // Modal state
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  // Active cashback campaigns
  const [activeCampaigns, setActiveCampaigns] = useState([]);

  // Cashflow: quick expenses and the end-of-day report
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showDailyReport, setShowDailyReport] = useState(false);

  const handleEnterKeyDown = (e) => {
    if (e.key === "Enter") {
      setEnterKeyDownTime(Date.now());
      setEnterKeyHoldTimer(
        setTimeout(() => {
          openModal();
        }, 1000)
      );
    }
  };

  const getBarcodeIncrement = (unit) => {
    // Use the unit in lowercase for consistency.
    switch (unit.toLowerCase()) {
      case "gram":
        return 100;
      // For kg, ons, kwintal, tons, box, and pcs, simply increment by 1.
      case "kg":
      case "ons":
      case "kwintal":
      case "tons":
      case "box":
      case "pcs":
      default:
        return 1;
    }
  };

  useEffect(() => {
    const fetchProducts = async () => {
      // Use environment-aware queryCollection function
      const stocksData = await queryCollection("stocks");
      const products = {};

      stocksData.forEach((data) => {
        // Data already has id from queryCollection
        products[data.id] = data;
      });

      console.log(
        `Fetched products from ${
          isProduction ? "production" : "testing"
        } environment:`,
        products
      );
      setProductData(products);
    };
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProduction]);

  // Fetch active cashback campaigns
  useEffect(() => {
    const fetchActiveCampaigns = async () => {
      try {
        const campaigns = await voucherService.getActiveCashbackCampaigns(
          isProduction
        );
        setActiveCampaigns(campaigns);
        console.log("Active cashback campaigns:", campaigns);
      } catch (error) {
        console.error("Error fetching active campaigns:", error);
      }
    };
    fetchActiveCampaigns();
  }, [isProduction]);

  useEffect(() => {
    // If nothing typed, clear suggestions
    if (!productId.trim()) {
      setSuggestions([]);
      setActiveSuggestionIndex(-1);
      return;
    }

    if (useScanner) {
      const trimmed = productId.trim();
      const found = Object.values(productData).filter(
        (p) => p.itemId === trimmed
      );
      setSuggestions(found);
      setActiveSuggestionIndex(found.length > 0 ? 0 : -1);

      if (found.length === 1) {
        const product = found[0];
        // Use the first unit from the product’s units array and the initial quantity.
        addProductToCart(
          product.id,
          product.satuan[0],
          getInitialQuantity(product.satuan[0])
        );
        setProductId("");
      }
    } else {
      // PARTIAL match on product.name if not using the scanner
      const input = productId.toLowerCase().trim();
      const words = input.split(/\s+/);
      const newSuggestions = Object.values(productData).filter((p) => {
        const name = (p.name || "").toLowerCase();
        return words.every((w) => name.includes(w));
      });
      setSuggestions(newSuggestions);
      setActiveSuggestionIndex(newSuggestions.length > 0 ? 0 : -1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, useScanner, productData]);

  useEffect(() => {
    if (activeSuggestionIndex >= 0 && suggestions.length > 0) {
      const product = suggestions[activeSuggestionIndex];
      const satuan = product.satuan[0];
      setCurrentSatuanIndex(0);
      setCurrentQuantity(getInitialQuantity(satuan));
    }
  }, [activeSuggestionIndex, suggestions]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setSuggestions([]);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (enterKeyHoldTimer) {
        clearTimeout(enterKeyHoldTimer);
      }
    };
  }, [enterKeyHoldTimer]);

  const handleKeyDown = (e) => {
    if (useScanner) {
      if (e.key === "Enter") addProduct();
      return;
    }

    if (suggestions.length > 0) {
      const activeProduct = suggestions[activeSuggestionIndex];
      const isActiveDisabled =
        activeProduct && products.some((p) => p.id === activeProduct.id);

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveSuggestionIndex((prev) =>
            Math.min(prev + 1, suggestions.length - 1)
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveSuggestionIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Shift":
        case "]":
          if (e.key === "Shift" && e.location !== 2) break;
          e.preventDefault();
          if (activeProduct) {
            setCurrentSatuanIndex((prev) =>
              Math.min(prev + 1, activeProduct.satuan.length - 1)
            );
          }
          break;
        case "[":
          e.preventDefault();
          if (activeProduct) {
            setCurrentSatuanIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (activeProduct && !isActiveDisabled) {
            const increment = getIncrement(
              activeProduct.satuan[currentSatuanIndex]
            );
            setCurrentQuantity((prev) => prev + increment);
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (activeProduct && !isActiveDisabled) {
            const decrement = getIncrement(
              activeProduct.satuan[currentSatuanIndex]
            );
            setCurrentQuantity((prev) => Math.max(prev - decrement, 0));
          }
          break;
        case "Enter":
          e.preventDefault();
          if (activeProduct && !isActiveDisabled) {
            addProductToCart(
              activeProduct.id,
              activeProduct.satuan[currentSatuanIndex],
              currentQuantity
            );
            setProductId("");
            setSuggestions([]);
            inputRef.current?.focus();
          }
          break;
        case "Escape":
          e.preventDefault();
          setProductId("");
          setSuggestions([]);
          break;
        default:
          break;
      }
    } else if (e.key === "Enter") {
      addProduct();
    }
  };

  const getDynamicPriceAndSubtotal = (productId, qty, selectedUnit) =>
    getPriceAndSubtotal(productData[productId], qty, selectedUnit);

  // Quantities are whole numbers. A comma or dot is refused with a message
  // rather than dropped, so "0,5" can't turn into 5 at the till.
  const refuseDecimalQuantity = () =>
    setSnackbars((prev) => [
      ...prev,
      { id: Date.now(), message: WHOLE_NUMBER_MESSAGE, severity: "warning" },
    ]);

  // The quantity of a cart line as the cashier sees it: what is typed in the
  // box if that is a whole number, otherwise the line's own quantity.
  const getCartQuantity = (product) => {
    const typed = parseWholeNumber(quantityInputs[product.id]);
    return Number.isNaN(typed) ? product.quantity : typed;
  };

  const addProductToCart = (id, satuan, quantity) => {
    const product = productData[id];
    if (!product) {
      setSnackbars((prev) => [
        ...prev,
        {
          id: Date.now(),
          message: "Product not found!",
          severity: "error",
        },
      ]);
      return;
    }

    // Check if the product is already in the cart.
    const existingProduct = products.find((p) => p.id === id);

    if (existingProduct) {
      // Barcode scanner mode: use special logic.
      if (useScanner) {
        // Check if the unit (satuan) from the cart matches the new unit.
        if (existingProduct.satuan !== satuan) {
          // If they differ, show the error message.
          setSnackbars((prev) => [
            ...prev,
            {
              id: Date.now(),
              message: `Beda satuan (${existingProduct.satuan} dan ${satuan})`,
              severity: "error",
            },
          ]);
          return;
        }
        // If the unit is the same, determine the proper increment.
        const increment = getBarcodeIncrement(satuan);

        // Check if there's a manually entered quantity in quantityInputs
        const displayedQuantity = getCartQuantity(existingProduct);

        // Use the displayed quantity for increment
        const newQuantity = displayedQuantity + increment;

        // Update both the product and the quantityInputs
        updateQuantity(existingProduct.id, newQuantity);
        setQuantityInputs((prev) => ({
          ...prev,
          [existingProduct.id]: newQuantity.toString(),
        }));
      } else {
        // Normal (non-scanner) mode: use the existing conversion logic.
        const convertedQty = convertToSmallestUnit(quantity, satuan, product);
        const existingConverted = convertToSmallestUnit(
          existingProduct.quantity,
          existingProduct.satuan,
          product
        );
        const totalConverted = existingConverted + convertedQty;

        const newQuantity = convertFromSmallestUnit(totalConverted, satuan, product);
        if (!Number.isInteger(newQuantity)) {
          refuseDecimalQuantity();
          return;
        }
        updateQuantity(id, newQuantity);
      }
    } else {
      // If the product is not already in the cart, add it as a new entry.
      const { price, subtotal } = getDynamicPriceAndSubtotal(id, quantity, satuan);
      const newProduct = {
        no: products.length + 1,
        id,
        name: product.name,
        quantity,
        satuan,
        price,
        subtotal,
        satuanOptions: product.satuan,
        pricePerUnit: product.pricePerUnit,
        smallestUnit: product.smallestUnit,
        piecesPerBox: product.piecesPerBox,
        base_unit: product.base_unit || product.smallestUnit,
        bulk_unit_name: product.bulk_unit_name || "",
        bulk_unit_conversion: product.bulk_unit_conversion || product.piecesPerBox,
      };
      setProducts([...products, newProduct]);
      setTotal(total + subtotal);
    }
    // Clear the input field.
    setProductId("");
  };

  const addProduct = () => {
    const product = productData[productId];
    if (!product) {
      alert("Product not found!");
      setProductId("");
      return;
    }
    addProductToCart(
      productId,
      product.satuan[0],
      getInitialQuantity(product.satuan[0])
    );
  };

  // ... (keep existing updateQuantity, updateSatuan, recalculateTotal,
  // removeProduct, and payment functions)

  const updateQuantity = (id, quantity) => {
    const updatedProducts = products
      .map((p) => {
        if (p.id === id) {
          const { price, subtotal } = getDynamicPriceAndSubtotal(id, quantity, p.satuan);
          return { ...p, quantity, price, subtotal };
        }
        return p;
      })
      .filter((p) => p.quantity > 0);

    setProducts(updatedProducts);

    // Also update the displayed quantity input to match the actual quantity
    setQuantityInputs((prev) => {
      const updatedInputs = { ...prev };
      // If the product was removed (quantity <= 0), remove it from inputs too
      if (!updatedProducts.some((p) => p.id === id)) {
        delete updatedInputs[id];
      } else {
        updatedInputs[id] = quantity.toString();
      }
      return updatedInputs;
    });

    recalculateTotal(updatedProducts);
  };

  const updateSatuan = (id, newSatuan) => {
    const updatedProducts = products.map((p) => {
      if (p.id === id) {
        const { price, subtotal } = getDynamicPriceAndSubtotal(id, p.quantity, newSatuan);
        return {
          ...p,
          satuan: newSatuan,
          price,
          subtotal,
        };
      }
      return p;
    });

    setProducts(updatedProducts);
    recalculateTotal(updatedProducts);
  };

  const handlePaymentComplete = async (paymentData) => {
    // Prevent double submission
    if (processingRef.current) {
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);

    const {
      amountPaid,
      change,
      totalNumeric,
      appliedVoucher,
      originalTotal,
      memberData,
      userPoints,
      paymentMethod,
      cashAmount,
      qrisAmount,
      kreditAmount,
    } = paymentData;

    // How the sale lands in the cashflow accounts: the voucher portion is
    // Kredit, the rest was paid in Cash and/or QRIS.
    const paymentFields = {
      paymentMethod,
      isPaidViaQris: paymentMethod === "qris",
      cashAmount,
      qrisAmount,
      kreditAmount,
    };

    // Define which mass units need conversion to kg.
    const massUnits = ["gram", "ons", "kg", "kwintal", "ton"];

    try {
      // --- 1. Check for stock discrepancies and track them ---
      let hasStockDiscrepancy = false;
      const stockDiscrepancies = [];

      for (const product of products) {
        // Use environment-aware document reference
        const stockData = await readDoc("stocks", product.id);

        if (!stockData) {
          throw new Error(`Product ${product.id} not found in stock`);
        }

        // Handle invalid stock values
        const currentStock =
          stockData.stock === null || stockData.stock === undefined
            ? 0
            : stockData.stock;

        // Convert transaction quantity to the smallest unit
        let convertedQty = convertToSmallestUnit(
          product.quantity,
          product.satuan,
          stockData
        );

        // Stock is counted in whole numbers; nothing has been saved yet, so a
        // line that doesn't convert to one stops the whole sale here.
        if (!Number.isInteger(convertedQty)) {
          throw new Error(
            `${product.name}: jumlah dalam ${stockData.smallestUnit || "satuan terkecil"} harus bilangan bulat`
          );
        }

        // Check if there's a stock discrepancy
        if (currentStock < convertedQty) {
          hasStockDiscrepancy = true;
          stockDiscrepancies.push({
            id: product.id,
            name: product.name,
            requestedQty: convertedQty,
            availableStock: currentStock,
          });
        }
      }

      // --- 2. Save the transaction detail ---
      // For each product item, if its unit is a mass unit, convert its quantity to kg.
      const transactionItems = products.map((p) => {
        let savedQuantity = p.quantity;
        let savedUnit = p.satuan;
        if (massUnits.includes(p.satuan.toLowerCase())) {
          // Multiply by the conversion factor (which gives grams) then divide by 1000 to get kg.
          savedQuantity =
            (p.quantity * CONVERSION_TABLE[p.satuan.toLowerCase()]) /
            CONVERSION_TABLE["kg"];
          savedUnit = "kg";
        }
        return {
          itemId: p.id,
          itemName: p.name,
          quantity: savedQuantity,
          unit: savedUnit,
          price: p.price,
          subtotal: p.subtotal,
        };
      });

      // Create a unique transaction ID based on time precisely to the second
      const now = new Date();
      const YYYY = now.getFullYear();
      const MM = String(now.getMonth() + 1).padStart(2, "0");
      const DD = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      const randomSuffix = Math.random().toString(36).substr(2, 3).toUpperCase();
      const transactionId = `${YYYY}${MM}${DD}-${hh}${mm}${ss}-${randomSuffix}`;

      // Create transaction with environment awareness and voucher support
      const transactionData = {
        id: transactionId,
        items: transactionItems,
        total: originalTotal || total,
        isMember: !!memberData, // true if member data exists
        createdBy: currentUser ? currentUser.email : "unknown",
        // Member tracking fields
        userId: memberData?.id || null,
        nomorAnggota: memberData?.nomorAnggota || null,
        memberName: memberData?.nama || null,
        // Points tracking - amount paid excluding voucher discount
        userPoints: userPoints || totalNumeric,
        ...paymentFields,
        amountPaid: amountPaid || 0,
        change: change || 0,
      };

      // Add voucher information if applied
      let voucherDiscount = 0;
      if (appliedVoucher) {
        voucherDiscount = Math.min(
          appliedVoucher.value,
          originalTotal || total
        );
        transactionData.voucherId = appliedVoucher.id;
        transactionData.voucherName = appliedVoucher.name;
        transactionData.voucherDiscount = voucherDiscount;
        transactionData.discountedTotal = totalNumeric;
      }

      if (appliedVoucher) {
        await voucherService.commitTransactionWithVoucher(
          {
            voucherId: appliedVoucher.id,
            voucherDiscount,
            transactionId,
            transactionData,
          },
          isProduction
        );
      } else {
        await createDoc("transactionDetail", transactionData, transactionId);
      }

      // --- 2. Process stock updates and stockTransactions ---
      for (const product of products) {
        // Use environment-aware document reference
        const stockData = await readDoc("stocks", product.id);

        if (!stockData) {
          throw new Error(`Product ${product.id} not found in stock`);
        }

        const currentStock = toFiniteNumber(stockData.stock) ?? 0;
        const stockValue = Math.max(0, toFiniteNumber(stockData.stockValue) ?? 0);

        // Convert transaction quantity to the smallest unit using your helper.
        // Our updated function now correctly handles all unit conversions
        let convertedQty = convertToSmallestUnit(
          product.quantity,
          product.satuan,
          stockData
        );

        // Stock has already been verified in the first step, so we can proceed

        // Keep sale cost aligned with the stock screen. Fall back to the
        // recorded purchase price when stockValue/currentStock is unavailable.
        const stockWorthPerUnit = getUnitCost(stockData);
        const transactionStockWorth = stockWorthPerUnit * convertedQty;

        // Check if this item has a stock discrepancy
        const isDiscrepant = stockDiscrepancies.some(
          (item) => item.id === product.id
        );

        // Calculate the actual stock reduction amount (limited by available stock)
        const actualStockReduction = isDiscrepant
          ? Math.min(convertedQty, currentStock)
          : convertedQty;

        // Create a stock transaction with environment awareness and discrepancy flag
        await createDoc("stockTransactions", {
          transactionId,
          itemId: product.id,
          itemName: product.name,
          kategori: stockData.kategori,
          subKategori: stockData.subKategori,
          price: product.price,
          quantity: convertedQty, // The requested quantity remains the same
          unit: stockData.smallestUnit, // Use the actual smallest unit from the stock
          originalQuantity: product.quantity,
          originalUnit: product.satuan,
          isDeleted: false,
          timestampInMillisEpoch: serverTimestamp(),
          transactionType: "penjualan",
          transactionVia: "pointOfSales",
          costPrice: roundRupiah(stockWorthPerUnit),
          // Whole-rupiah cost of every unit sold, exact where costPrice is not
          lineCost: roundRupiah(stockWorthPerUnit * convertedQty),
          stockWorth: roundRupiah(
            isDiscrepant
              ? stockWorthPerUnit * actualStockReduction // Only count worth of actual stock used
              : transactionStockWorth
          ),
          isStockDiscrepant: isDiscrepant,
          createdBy: currentUser ? currentUser.email : "unknown",
          userId: memberData?.id || null,
          nomorAnggota: memberData?.nomorAnggota || null,
          memberName: memberData?.nama || null,
          isMember: !!memberData,
          ...paymentFields,
        });

        // Update stock, ensuring it doesn't go negative
        const newStock = isDiscrepant ? 0 : currentStock - convertedQty;
        const stockReduction = isDiscrepant ? currentStock : convertedQty;
        const newStockValue = roundRupiah(
          Math.max(0, stockValue - stockWorthPerUnit * stockReduction)
        );

        await updateDoc("stocks", product.id, {
          stock: newStock,
          stockValue: newStockValue,
        });
      }

      // Campaign points are a post-sale side effect. Running this here avoids
      // granting points when payment or transaction persistence fails.
      if (memberData && activeCampaigns.length > 0) {
        for (const campaign of activeCampaigns) {
          try {
            const result = await voucherService.updateUserCampaignPoints(
              campaign.voucherGroupId,
              memberData.id,
              memberData,
              campaign,
              userPoints || totalNumeric,
              isProduction
            );

            if (result.created || result.updated) break;
          } catch (campaignError) {
            console.error(
              `Error updating campaign ${campaign.voucherName}:`,
              campaignError
            );
          }
        }
      }

      // Create detailed message if there are stock discrepancies
      let message = "";
      if (hasStockDiscrepancy) {
        const discrepantItemNames = stockDiscrepancies
          .map((item) => item.name)
          .join(", ");
        message = `Transaksi Berhasil, namun perlu mengecek jumlah stock: ${discrepantItemNames}`;
      } else {
        message = "Transaction completed successfully!";
      }

      // Show success message with detailed information if needed
      const newSnackbar = {
        id: Date.now(),
        message: message,
        severity: hasStockDiscrepancy ? "warning" : "success",
      };

      setSnackbars((prev) => [...prev, newSnackbar]);

      // Print receipt with voucher information
      const receiptTotal = originalTotal || total;
      const effectiveMemberName =
        memberData?.nama || appliedVoucher?.memberName || null;
      const effectiveNomorAnggota =
        memberData?.nomorAnggota || appliedVoucher?.nomorAnggota || null;

      const receiptData = {
        transactionId,
        items: products,
        total: receiptTotal,
        amountPaid,
        change,
        appliedVoucher,
        memberData,
        memberName: effectiveMemberName,
        nomorAnggota: effectiveNomorAnggota,
        ...paymentFields,
      };

      await printReceiptWithVoucher(receiptData, (snackbarInfo) => {
        const newSnackbar = {
          id: Date.now() + 1, // Ensure unique ID
          message: snackbarInfo.message,
          severity: snackbarInfo.severity || "info",
        };
        setSnackbars((prev) => [...prev, newSnackbar]);
      });

      // If there were stock discrepancies, log them for reference
      if (hasStockDiscrepancy) {
        console.warn("Stock discrepancies detected:", stockDiscrepancies);
      }

      // Reset state
      setProducts([]);
      setTotal(0);

      // Close modal after a short delay to show success state
      setTimeout(() => {
        setIsProcessing(false);
        closeModal();
      }, 1000);
    } catch (error) {
      console.error("Payment error:", error);
      setSnackbars((prev) => [
        ...prev,
        {
          id: Date.now(),
          message: `Error: ${error.message}`,
          severity: "error",
        },
      ]);
      setIsProcessing(false);
    } finally {
      processingRef.current = false;
    }
  };

  const removeProduct = (id) => {
    const updatedProducts = products.filter((p) => p.id !== id);
    setProducts(updatedProducts);
    recalculateTotal(updatedProducts);
  };

  const recalculateTotal = (updatedProducts) => {
    const newTotal = updatedProducts.reduce(
      (acc, curr) => acc + curr.subtotal,
      0
    );
    setTotal(newTotal);
  };

  // Handle payment
  const openModal = () => {
    if (products.length === 0) {
      alert("No products in the cart!");
      return;
    }
    setModalIsOpen(true);
  };

  const closeModal = () => {
    setModalIsOpen(false);
  };

  const handleEnterKeyUp = (e) => {
    if (e.key === "Enter") {
      if (Date.now() - enterKeyDownTime < 1000) {
        clearTimeout(enterKeyHoldTimer);
        // Handle normal Enter key press
        if (suggestions.length > 0) {
          const product = suggestions[activeSuggestionIndex];
          if (product) {
            addProductToCart(
              product.id,
              product.satuan[currentSatuanIndex],
              currentQuantity
            );
            setProductId("");
            setSuggestions([]);
            inputRef.current?.focus();
          }
        } else {
          addProduct();
        }
      }
      setEnterKeyDownTime(null);
    }
  };

  return (
    <div className="transaksi-container">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="m-0">Transaksi - Point of Sales Unimart</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowExpenseModal(true)}
            className="px-4 py-2 rounded-lg border border-orange-200 bg-orange-50 text-sm font-semibold text-orange-700 hover:bg-orange-100 transition-colors"
          >
            Catat Pengeluaran
          </button>
          <button
            type="button"
            onClick={() => setShowDailyReport(true)}
            className="px-4 py-2 rounded-lg bg-amber-600 text-sm font-semibold text-white hover:bg-amber-700 transition-colors"
          >
            Laporan Harian
          </button>
        </div>
      </div>

      <CatatPengeluaranModal
        isOpen={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
      />

      <LaporanHarianModal
        isOpen={showDailyReport}
        onClose={() => setShowDailyReport(false)}
        onSaved={() =>
          setSnackbars((prev) => [
            ...prev,
            {
              id: Date.now(),
              message: "Laporan keuangan harian berhasil disimpan",
              severity: "success",
            },
          ])
        }
      />

      <div className="product-input" ref={containerRef}>
        <div className="scanner-toggle">
          <label>
            <input
              type="checkbox"
              checked={useScanner}
              onChange={(e) => setUseScanner(e.target.checked)}
            />
            Use Barcode Scanner
          </label>
        </div>
        <input
          ref={inputRef}
          type="text"
          placeholder="Enter Product ID or Name"
          value={productId}
          onChange={(e) =>
            setProductId(
              useScanner ? e.target.value.replace(/\D/g, "") : e.target.value
            )
          }
          onKeyDown={(e) => {
            handleKeyDown(e); // Your existing keydown handler
            handleEnterKeyDown(e); // New handler for Enter key hold
          }}
          onKeyUp={handleEnterKeyUp} // New handler for Enter key release
        />
        <button onClick={addProduct}>Add Product</button>

        {suggestions.length > 0 && (
          <div className="autocomplete-dropdown">
            {suggestions.map((product, index) => {
              // Check if the product is already in the cart
              const isDisabled = products.some((p) => p.id === product.id);
              return (
                <div
                  key={product.id}
                  className={`suggestion-item ${
                    index === activeSuggestionIndex ? "active" : ""
                  } ${isDisabled ? "disabled" : ""}`}
                  onMouseEnter={() => {
                    if (!isDisabled) {
                      setActiveSuggestionIndex(index);
                    }
                  }}
                  onClick={() => {
                    if (!isDisabled) {
                      addProductToCart(
                        product.id,
                        product.satuan[currentSatuanIndex],
                        currentQuantity
                      );
                      setProductId("");
                      setSuggestions([]);
                      inputRef.current?.focus();
                    }
                  }}
                >
                  <div className="suggestion-content">
                    <span className="product-name">
                      {product.name}
                      {isDisabled && (
                        <span className="already-selected">
                          (sudah dipilih)
                        </span>
                      )}
                    </span>
                    {index === activeSuggestionIndex && (
                      <div className="quantity-unit-display">
                        <div className="quantity-card">
                          {(() => {
                            const qty = Number(currentQuantity) || 0;
                            return qty.toFixed(qty % 1 === 0 ? 0 : 1);
                          })()}
                        </div>
                        <span className="unit">
                          × {product.satuan[currentSatuanIndex]}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ... (keep existing table and modal code) */}
      <table className="product-table">
        <thead>
          <tr>
            <th>No.</th>
            {/* <th>ID Product</th> */}
            <th>Nama Produk</th>
            <th>Jumlah</th>
            <th>Stock</th>
            {/* <th>Satuan</th> */}
            <th>Harga</th>
            <th>Subtotal</th>
            <th>Hapus</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product, index) => (
            <tr key={product.id}>
              <td>{index + 1}</td>
              <td>{product.name}</td>
              <td>
                <div className="quantity-container">
                  <button
                    className="quantity-btn"
                    onClick={() => {
                      const newQuantity = Math.max(0, getCartQuantity(product) - 1);
                      updateQuantity(product.id, newQuantity);
                      setQuantityInputs((prev) => ({
                        ...prev,
                        [product.id]: newQuantity.toString(),
                      }));
                    }}
                  >
                    &minus;
                  </button>
                  <input
                    type="text"
                    className="quantity-input"
                    inputMode="numeric"
                    value={
                      quantityInputs[product.id] !== undefined
                        ? quantityInputs[product.id]
                        : product.quantity
                    }
                    onChange={(e) => {
                      const rawValue = e.target.value;
                      if (hasDecimalSeparator(rawValue)) {
                        // Refused, not dropped: "0,5" must not become 5
                        refuseDecimalQuantity();
                        return;
                      }
                      setQuantityInputs((prev) => ({
                        ...prev,
                        [product.id]: keepDigits(rawValue),
                      }));
                    }}
                    onBlur={(e) => {
                      const rawValue = e.target.value.trim();
                      const numericValue = parseWholeNumber(rawValue);
                      if (
                        rawValue === "" ||
                        isNaN(numericValue) ||
                        numericValue === 0
                      ) {
                        // Remove product if input is empty or 0
                        removeProduct(product.id);
                      } else {
                        updateQuantity(product.id, numericValue);
                        // Normalize the displayed value
                        setQuantityInputs((prev) => ({
                          ...prev,
                          [product.id]: numericValue.toString(),
                        }));
                      }
                    }}
                  />
                  <button
                    className="quantity-btn"
                    onClick={() => {
                      const newQuantity = getCartQuantity(product) + 1;
                      updateQuantity(product.id, newQuantity);
                      setQuantityInputs((prev) => ({
                        ...prev,
                        [product.id]: newQuantity.toString(),
                      }));
                    }}
                  >
                    &#43;
                  </button>
                </div>
              </td>
              <td>
                {productData[product.id]
                  ? (() => {
                      // Convert current product quantity to the smallest unit
                      const productStockData = productData[product.id];
                      const currentStock = productStockData.stock || 0;

                      // Convert requested quantity to the smallest unit
                      const requestedQty = convertToSmallestUnit(
                        product.quantity,
                        product.satuan,
                        productStockData
                      );

                      // Convert stock back to the display unit and round to nearest integer
                      const stockInDisplayUnit = Math.round(
                        convertFromSmallestUnit(currentStock, product.satuan, productStockData)
                      );

                      // Check if quantity exceeds stock
                      const isLowStock = requestedQty > currentStock;

                      return (
                        <span className={isLowStock ? "low-stock" : ""}>
                          {stockInDisplayUnit} {product.satuan}
                        </span>
                      );
                    })()
                  : "Loading..."}
              </td>
              <td>
                <div className="unit-price-container" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span>{formatCurrency(product.price)} / </span>
                  {product.satuanOptions && product.satuanOptions.length > 1 ? (
                    <select
                      value={product.satuan}
                      onChange={(e) => updateSatuan(product.id, e.target.value)}
                      className="unit-select"
                      style={{
                        padding: '2px 8px 2px 4px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        fontSize: '0.85rem',
                        backgroundColor: '#fff',
                        cursor: 'pointer',
                        fontWeight: '500',
                        color: '#333',
                        outline: 'none'
                      }}
                    >
                      {product.satuanOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{product.satuan}</span>
                  )}
                </div>
              </td>
              <td>{formatCurrency(product.subtotal)}</td>
              <td>
                <button
                  className="delete-btn"
                  onClick={() => removeProduct(product.id)}
                >
                  Hapus
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Sticky Footer */}
      <div className="footer">
        <h2>Total: {formatCurrency(total)}</h2>
        <button onClick={openModal}>Bayar</button>
      </div>

      {/* Payment Modal with Voucher Support */}
      <PaymentModal
        isOpen={modalIsOpen}
        onClose={closeModal}
        total={total}
        onPaymentComplete={handlePaymentComplete}
        isProcessing={isProcessing}
        activeCampaigns={activeCampaigns}
        isProduction={isProduction}
      />

      {/* Render multiple stacked snackbars */}
      <div className="snackbar-container">
        {snackbars.map((snackbar) => (
          <div
            key={snackbar.id}
            className={`snackbar ${
              snackbar.severity === "warning"
                ? "snackbar-warning"
                : snackbar.severity === "error"
                ? "snackbar-error"
                : ""
            }`}
          >
            {snackbar.message}
            <button
              onClick={() =>
                setSnackbars((prev) =>
                  prev.filter((sb) => sb.id !== snackbar.id)
                )
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Transaksi;
