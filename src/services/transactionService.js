// src/services/transactionService.js
import { convertToSmallestUnit, CONVERSION_TABLE } from '../utils/transaksiUtils';
import { getUnitCost, roundRupiah, toFiniteNumber } from '../utils/profitUtils';
import { printReceipt as printerServicePrint } from './PrinterService';

export const processTransaction = async (
  products, 
  total, 
  amountPaid, 
  change,
  {
    createDoc,
    readDoc,
    updateDoc,
    serverTimestamp,
    currentUser,
    setSnackbars
  }
) => {
  // Define which mass units need conversion to kg.
  const massUnits = ["gram", "ons", "kg", "kwintal", "ton"];

  try {
    // --- 1. Check for stock discrepancies and track them ---
    let hasStockDiscrepancy = false;
    const stockDiscrepancies = [];
    
    for (const product of products) {
      const stockData = await readDoc("stocks", product.id);

      if (!stockData) {
        throw new Error(`Product ${product.id} not found in stock`);
      }

      // Handle invalid stock values
      const currentStock = (stockData.stock === null || stockData.stock === undefined) ? 0 : stockData.stock;

      // Convert transaction quantity to the smallest unit
      let convertedQty = convertToSmallestUnit(
        product.quantity,
        product.satuan,
        {
          smallestUnit: stockData.smallestUnit,
          piecesPerBox: stockData.piecesPerBox,
        }
      );

      // Check if there's a stock discrepancy
      if (currentStock < convertedQty) {
        hasStockDiscrepancy = true;
        stockDiscrepancies.push({
          id: product.id,
          name: product.name,
          requestedQty: convertedQty,
          availableStock: currentStock
        });
      }
    }
    
    // --- 2. Save the transaction detail ---
    const transactionItems = products.map((p) => {
      let savedQuantity = p.quantity;
      let savedUnit = p.satuan;
      if (massUnits.includes(p.satuan.toLowerCase())) {
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
    
    // Create transaction with environment awareness
    await createDoc("transactionDetail", {
      id: transactionId,
      items: transactionItems,
      total,
      isMember: false,
      createdBy: currentUser ? currentUser.email : "unknown"
    }, transactionId);

    // --- 3. Process stock updates and stockTransactions ---
    for (const product of products) {
      const stockData = await readDoc("stocks", product.id);

      if (!stockData) {
        throw new Error(`Product ${product.id} not found in stock`);
      }

      const currentStock = toFiniteNumber(stockData.stock) ?? 0;
      const stockValue = Math.max(0, toFiniteNumber(stockData.stockValue) ?? 0);

      let convertedQty = convertToSmallestUnit(
        product.quantity,
        product.satuan,
        {
          smallestUnit: stockData.smallestUnit,
          piecesPerBox: stockData.piecesPerBox,
        }
      );

      // Use the same cost basis as the stock screen, with a safe fallback
      // when stockValue/currentStock cannot produce a valid average.
      const stockWorthPerUnit = getUnitCost(stockData);
      const transactionStockWorth = stockWorthPerUnit * convertedQty;

      // Check if this item has a stock discrepancy
      const isDiscrepant = stockDiscrepancies.some(item => item.id === product.id);
      
      // Calculate the actual stock reduction amount (limited by available stock)
      const actualStockReduction = isDiscrepant ? 
        Math.min(convertedQty, currentStock) : convertedQty;
        
      // Create a stock transaction with environment awareness and discrepancy flag
      await createDoc("stockTransactions", {
        transactionId,
        itemId: product.id,
        itemName: product.name,
        kategori: stockData.kategori,
        subKategori: stockData.subKategori,
        price: product.price,
        quantity: convertedQty,
        unit: stockData.smallestUnit,
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
        createdBy: currentUser ? currentUser.email : "unknown"
      });

      // Update stock, ensuring it doesn't go negative
      const newStock = isDiscrepant ? 0 : (currentStock - convertedQty);
      const stockReduction = isDiscrepant ? currentStock : convertedQty;
      const newStockValue = roundRupiah(
        Math.max(0, stockValue - stockWorthPerUnit * stockReduction)
      );
      
      await updateDoc("stocks", product.id, {
        stock: newStock,
        stockValue: newStockValue,
      });
    }

    // Create detailed message if there are stock discrepancies
    let message = "";
    if (hasStockDiscrepancy) {
      const discrepantItemNames = stockDiscrepancies.map(item => item.name).join(", ");
      message = `Transaksi Berhasil, namun perlu mengecek jumlah stock: ${discrepantItemNames}`;
    } else {
      message = "Transaction completed successfully!";
    }
    
    // Show success message with detailed information if needed
    const newSnackbar = {
      id: Date.now(),
      message: message,
      severity: hasStockDiscrepancy ? "warning" : "success"
    };
    
    setSnackbars(prev => [...prev, newSnackbar]);
    
    // Print receipt
    await printReceipt(transactionId, products, total, amountPaid, change, 
      (snackbarInfo) => {
        const newSnackbar = {
          id: Date.now() + 1,
          message: snackbarInfo.message,
          severity: snackbarInfo.severity || "info"
        };
        setSnackbars(prev => [...prev, newSnackbar]);
      });
    
    // If there were stock discrepancies, log them for reference
    if (hasStockDiscrepancy) {
      console.warn("Stock discrepancies detected:", stockDiscrepancies);
    }
    
    return { success: true, hasStockDiscrepancy, stockDiscrepancies };
    
  } catch (error) {
    console.error("Payment error:", error);
    setSnackbars(prev => [...prev, {
      id: Date.now(),
      message: `Error: ${error.message}`,
      severity: "error"
    }]);
    throw error;
  }
};

const printReceipt = async (transactionId, items, total, amountPaid, change, setSnackbarFn) => {
  try {
    // Get current date and time
    const now = new Date();
    const dateTimeStr = now.toLocaleTimeString('id-ID').replace(/\./g, ':');
    
    // Create receipt data model
    const receiptData = {
      header: {
        storeName: "UniMart • Unipdu Mart",
        storeAddress: "Kompleks Pondok Pesantren Darul Ulum",
        storeCity: "Jombang, Jawa Timur",
        title: "Struk Pembelian"
      },
      info: {
        transactionId: transactionId,
        dateTime: dateTimeStr
      },
      items: items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        unit: item.satuan,
        price: item.price,
        subtotal: item.subtotal
      })),
      summary: {
        total: total,
        amountPaid: parseInt(amountPaid.replace(/\D/g, ""), 10) || 0,
        change: change
      }
    };
    
    console.log("Attempting to print receipt...");
    
    const success = await printerServicePrint(receiptData);
    
    if (!success) {
      console.warn("All printing methods failed");
      if (typeof setSnackbarFn === 'function') {
        setSnackbarFn({ 
          open: true, 
          message: "Gagal mencetak struk. Periksa koneksi printer.",
          severity: "warning"
        });
      }
    }
  } catch (error) {
    console.error("Error printing receipt:", error);
    if (typeof setSnackbarFn === 'function') {
      setSnackbarFn({ 
        open: true, 
        message: `Error mencetak struk: ${error.message}`,
        severity: "error"
      });
    }
  }
};

// Utility function to set local print server URL (can be called from settings)
export const setLocalPrintServer = (url = 'http://localhost:9001') => {
  localStorage.setItem('localPrintServerUrl', url);
  console.log(`Local print server URL saved: ${url}`);
};
