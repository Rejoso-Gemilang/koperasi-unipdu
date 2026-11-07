import React, { useState, useEffect, useRef, useMemo } from "react";
import ReactDOM from "react-dom";
import { FaTimes, FaPlus, FaTrash, FaUpload, FaFileAlt } from "react-icons/fa";
import { uploadFile } from "../firebase";
import "../styles/BulkPurchaseModal.css";
import { convertToSmallestUnit } from "../utils/transaksiUtils";
import { roundRupiah } from "../utils/profitUtils";
import { findCostAboveSellingPrice } from "../utils/purchaseChecks";
import {
  WHOLE_NUMBER_MESSAGE,
  hasDecimalSeparator,
  keepDigits,
  parseWholeNumber,
} from "../utils/stockTransactionUtils";
import { useFirestore } from "../context/FirestoreContext";
import { generateIncrementalId } from "../services/transactionHistoryService";
import { ACCOUNTS, ACCOUNT_LABELS, fmtAmount, normalizeAccount } from "../utils/cashflowUtils";
import { AccountPills } from "./cashflow/CashflowModals";
import Dropdown from "./common/Dropdown";

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

// Function to compress image files
function compressImage(file, quality = 0.7) {
  return new Promise((resolve) => {
    // If it's not an image, return the original file
    if (!file.type.startsWith("image/")) {
      resolve(file);
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;

      ctx.drawImage(img, 0, 0);

      canvas.toBlob(
        (blob) => {
          // Create a new File object with the compressed blob
          const compressedFile = new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        },
        file.type,
        quality
      );
    };

    img.src = URL.createObjectURL(file);
  });
}

const BulkPurchaseModal = ({
  isOpen,
  onClose,
  onSave,
  products,
  currentUser,
  collectionPrefix = "",
  transactionCollection = "stockTransactions",
  isWarehouse = false,
  isEditMode = false,
  initialData = null,
}) => {
  const rowsKey = isWarehouse ? "b2b_purchase_draft_rows" : "retail_purchase_draft_rows";
  const supplierKey = isWarehouse ? "b2b_purchase_draft_supplier" : "retail_purchase_draft_supplier";
  const uploadedNotaKey = isWarehouse ? "b2b_purchase_draft_uploaded_nota" : "retail_purchase_draft_uploaded_nota";
  const accountKey = isWarehouse ? "b2b_purchase_draft_account" : "retail_purchase_draft_account";

  // Unimart purchases are paid from a cashflow account and land in Finance as
  // an expense. Warehouse (B2B) purchases and edits don't touch that ledger.
  const tracksExpense = !isWarehouse && !isEditMode;

  const { queryCollection, query, where } = useFirestore();

  const [rows, setRows] = useState(() => {
    try {
      const saved = localStorage.getItem(rowsKey);
      return saved ? JSON.parse(saved) : [
        { id: 1, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
        { id: 2, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
        { id: 3, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
      ];
    } catch (e) {
      console.error("Error reading draft rows from localStorage:", e);
      return [
        { id: 1, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
        { id: 2, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
        { id: 3, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
      ];
    }
  });

  const [nextId, setNextId] = useState(() => {
    try {
      const saved = localStorage.getItem(rowsKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        const maxId = parsed.reduce((max, r) => Math.max(max, parseInt(r.id, 10) || 0), 0);
        return maxId > 0 ? maxId + 1 : 4;
      }
    } catch (e) {}
    return 4;
  });

  const [searchTerms, setSearchTerms] = useState(() => {
    try {
      const saved = localStorage.getItem(rowsKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        const terms = {};
        parsed.forEach(r => {
          if (r.product) {
            terms[r.id] = r.product.name;
          }
        });
        return terms;
      }
    } catch (e) {}
    return {};
  });

  const [showDropdowns, setShowDropdowns] = useState({});
  const [filteredProducts, setFilteredProducts] = useState({});
  const [highlightedIndex, setHighlightedIndex] = useState({});
  const [errors, setErrors] = useState({});

  const [uploadedNota, setUploadedNota] = useState(() => {
    try {
      const saved = localStorage.getItem(uploadedNotaKey);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const [uploadingNota, setUploadingNota] = useState(false);

  const [supplierName, setSupplierName] = useState(() => {
    try {
      return localStorage.getItem(supplierKey) || "";
    } catch (e) {
      return "";
    }
  });

  const [paymentAccount, setPaymentAccount] = useState(() => {
    try {
      return normalizeAccount(localStorage.getItem(accountKey));
    } catch (e) {
      return "cash";
    }
  });


  const [isSubmitting, setIsSubmitting] = useState(false);

  const dropdownRefs = useRef({});

  // Convert products object to array for searching
  const productsArray = useMemo(() => Object.values(products || {}), [products]);

  // Handle product search
  const handleProductSearch = (rowId, searchTerm) => {
    setSearchTerms((prev) => ({ ...prev, [rowId]: searchTerm }));
    setHighlightedIndex((prev) => ({ ...prev, [rowId]: 0 }));

    if (!searchTerm.trim()) {
      setFilteredProducts((prev) => ({ ...prev, [rowId]: [] }));
      return;
    }

    const filtered = productsArray.filter(
      (product) =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (product.itemId && product.itemId.toString().includes(searchTerm))
    );

    setFilteredProducts((prev) => ({ ...prev, [rowId]: filtered }));
  };

  // Handle product selection
  const handleProductSelect = (rowId, product) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              product,
              unit: product.base_unit || product.smallestUnit,
              searchTerm: product.name,
            }
          : row
      )
    );

    setSearchTerms((prev) => ({ ...prev, [rowId]: product.name }));
    setShowDropdowns((prev) => ({ ...prev, [rowId]: false }));
  };

  // Handle unit change
  const handleUnitChange = (rowId, value) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id === rowId) {
          const product = row.product;
          if (!product) return { ...row, unit: value };

          const conversion = product.bulk_unit_conversion || product.piecesPerBox || 1;
          const currentQty = parseFloat(row.quantity) || 0;
          const currentCost = parseRupiah(row.hargaSatuan) || 0;

          const baseUnit = product.base_unit || product.smallestUnit;
          const bulkUnitName = product.bulk_unit_name;

          let newQty = row.quantity;
          let newCost = row.hargaSatuan;

          if (bulkUnitName) {
            if (value === baseUnit && row.unit === bulkUnitName) {
              // Bulk -> Base: Multiply Qty, Divide Cost
              newQty = currentQty > 0 ? (currentQty * conversion).toString() : "";
              newCost = currentCost > 0 ? formatRupiah(roundRupiah(currentCost / conversion).toString()) : "";
            } else if (value === bulkUnitName && row.unit === baseUnit) {
              // Base -> Bulk: Floor/Truncate Qty, Multiply Cost
              newQty = currentQty > 0 ? Math.floor(currentQty / conversion).toString() : "";
              newCost = currentCost > 0 ? formatRupiah(roundRupiah(currentCost * conversion).toString()) : "";
            }
          }

          const q = parseFloat(newQty) || 0;
          const c = parseRupiah(newCost) || 0;
          const newSubtotal = roundRupiah(q * c);

          return {
            ...row,
            unit: value,
            quantity: newQty,
            hargaSatuan: newCost,
            subtotal: newSubtotal > 0 ? formatRupiah(newSubtotal.toString()) : "",
          };
        }
        return row;
      })
    );
  };

  // Handle quantity change. Quantities are whole numbers: a comma or dot is
  // refused with a message rather than dropped, so "1,5" can't become 15.
  const handleQuantityChange = (rowId, value) => {
    const errorKey = `quantity_${rowId}`;
    if (hasDecimalSeparator(value)) {
      setErrors((prev) => ({ ...prev, [errorKey]: WHOLE_NUMBER_MESSAGE }));
      return;
    }
    setErrors((prev) => {
      if (!prev[errorKey]) return prev;
      const { [errorKey]: _cleared, ...rest } = prev;
      return rest;
    });

    const cleanValue = keepDigits(value);

    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, quantity: cleanValue } : row
      )
    );

    // Auto-calculate based on existing harga satuan or subtotal
    const row = rows.find((r) => r.id === rowId);
    if (row && cleanValue && parseInt(cleanValue, 10) > 0) {
      const quantity = parseInt(cleanValue, 10);

      // If harga satuan exists, calculate subtotal
      if (row.hargaSatuan && parseRupiah(row.hargaSatuan) > 0) {
        const hargaSatuan = parseRupiah(row.hargaSatuan);
        const newSubtotal = roundRupiah(quantity * hargaSatuan);
        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? {
                  ...r,
                  quantity: cleanValue,
                  subtotal: formatRupiah(newSubtotal.toString()),
                }
              : r
          )
        );
      }
      // If subtotal exists but no harga satuan, calculate harga satuan
      else if (row.subtotal && parseRupiah(row.subtotal) > 0) {
        const subtotal = parseRupiah(row.subtotal);
        const newHargaSatuan = roundRupiah(subtotal / quantity);
        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? {
                  ...r,
                  quantity: cleanValue,
                  hargaSatuan: formatRupiah(newHargaSatuan.toString()),
                }
              : r
          )
        );
      }
    }
  };

  // Handle harga satuan change
  const handleHargaSatuanChange = (rowId, value) => {
    const formattedValue = formatRupiah(value);
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, hargaSatuan: formattedValue } : row
      )
    );

    // Auto-calculate subtotal if quantity exists
    const row = rows.find((r) => r.id === rowId);
    if (
      row &&
      row.quantity &&
      parseFloat(row.quantity) > 0 &&
      parseRupiah(formattedValue) > 0
    ) {
      const quantity = parseFloat(row.quantity);
      const hargaSatuan = parseRupiah(formattedValue);
      const newSubtotal = roundRupiah(quantity * hargaSatuan);

      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                hargaSatuan: formattedValue,
                subtotal: formatRupiah(newSubtotal.toString()),
              }
            : r
        )
      );
    }
  };

  // Handle subtotal change
  const handleSubtotalChange = (rowId, value) => {
    const formattedValue = formatRupiah(value);
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, subtotal: formattedValue } : row
      )
    );

    // Auto-calculate harga satuan if quantity exists
    const row = rows.find((r) => r.id === rowId);
    if (
      row &&
      row.quantity &&
      parseFloat(row.quantity) > 0 &&
      parseRupiah(formattedValue) > 0
    ) {
      const quantity = parseFloat(row.quantity);
      const subtotal = parseRupiah(formattedValue);
      const newHargaSatuan = roundRupiah(subtotal / quantity);

      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                subtotal: formattedValue,
                hargaSatuan: formatRupiah(newHargaSatuan.toString()),
              }
            : r
        )
      );
    }
  };

  // Add new row
  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: nextId,
        product: null,
        quantity: "",
        unit: "",
        hargaSatuan: "",
        subtotal: "",
      },
    ]);
    setNextId((prev) => prev + 1);
  };

  // Remove row
  const removeRow = (rowId) => {
    if (rows.length > 1) {
      setRows((prev) => prev.filter((row) => row.id !== rowId));
      setSearchTerms((prev) => {
        const newTerms = { ...prev };
        delete newTerms[rowId];
        return newTerms;
      });
      setShowDropdowns((prev) => {
        const newDropdowns = { ...prev };
        delete newDropdowns[rowId];
        return newDropdowns;
      });
      setFilteredProducts((prev) => {
        const newFiltered = { ...prev };
        delete newFiltered[rowId];
        return newFiltered;
      });
    }
  };

  // Toggle dropdown
  const toggleDropdown = (rowId) => {
    setShowDropdowns((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  };

  // Handle keyboard navigation
  const handleKeyDown = (rowId, e) => {
    const products = filteredProducts[rowId] || [];
    const currentIndex = highlightedIndex[rowId] || 0;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const newIndex = Math.min(currentIndex + 1, products.length - 1);
      setHighlightedIndex((prev) => ({ ...prev, [rowId]: newIndex }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const newIndex = Math.max(currentIndex - 1, 0);
      setHighlightedIndex((prev) => ({ ...prev, [rowId]: newIndex }));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (products.length > 0 && showDropdowns[rowId]) {
        const selectedProduct = products[currentIndex];
        if (selectedProduct) {
          handleProductSelect(rowId, selectedProduct);
        }
      }
    } else if (e.key === "Escape") {
      // Close the list only, never the modal around it.
      e.stopPropagation();
      setShowDropdowns((prev) => ({ ...prev, [rowId]: false }));
    } else if (e.key === "Tab") {
      setShowDropdowns((prev) => ({ ...prev, [rowId]: false }));
    }
  };

  // Handle nota upload
  const handleNotaUpload = async (file) => {
    if (!file) return;

    setUploadingNota(true);
    try {
      // Compress the file if it's an image
      const compressedFile = await compressImage(file, 0.7);

      const timestamp = getTimestampString();
      const folderPath = isWarehouse ? "warehouse" : "unimart";
      const fileName = `${timestamp}_${compressedFile.name}`;
      const filePath = `${folderPath}/notaBelanja/${fileName}`;

      const downloadURL = await uploadFile(compressedFile, filePath);

      // Store uploaded file info without saving to database yet
      setUploadedNota({
        fileName: compressedFile.name,
        downloadURL: downloadURL,
        originalFile: compressedFile,
        timestamp: timestamp,
      });
    } catch (error) {
      console.error("Error uploading nota:", error);
      alert("Gagal mengunggah nota: " + error.message);
    } finally {
      setUploadingNota(false);
    }
  };

  // Validate form
  const validateForm = () => {
    const newErrors = {};

    rows.forEach((row) => {
      if (!row.product) {
        newErrors[`product_${row.id}`] = "Produk harus dipilih";
      }
      if (!row.quantity) {
        newErrors[`quantity_${row.id}`] = "Jumlah harus diisi";
      } else if (Number.isNaN(parseWholeNumber(row.quantity))) {
        // Also catches a decimal quantity left in a saved draft or an old purchase
        newErrors[`quantity_${row.id}`] = WHOLE_NUMBER_MESSAGE;
      } else if (parseWholeNumber(row.quantity) === 0) {
        newErrors[`quantity_${row.id}`] = "Jumlah harus diisi";
      } else if (row.product && row.unit) {
        let smallestUnitQuantity;
        try {
          smallestUnitQuantity = convertToSmallestUnit(
            parseWholeNumber(row.quantity),
            row.unit,
            row.product
          );
        } catch (e) {
          smallestUnitQuantity = null;
        }
        if (smallestUnitQuantity !== null && !Number.isInteger(smallestUnitQuantity)) {
          newErrors[`quantity_${row.id}`] = WHOLE_NUMBER_MESSAGE;
        }
      }
      if (!row.hargaSatuan || parseRupiah(row.hargaSatuan) === 0) {
        newErrors[`hargaSatuan_${row.id}`] = "Harga satuan harus diisi";
      }
      if (!row.subtotal || parseRupiah(row.subtotal) === 0) {
        newErrors[`subtotal_${row.id}`] = "Subtotal harus diisi";
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Build the items array from current rows
  const buildItemsPayload = (validRows) => {
    return validRows.map((row) => ({
      itemId: row.product.itemId || row.product.id,
      itemName: row.product.name,
      price: parseRupiah(row.hargaSatuan),
      quantity: parseWholeNumber(row.quantity),
      subtotal: parseRupiah(row.subtotal),
      unit: row.unit,
    }));
  };

  // Handle submit
  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!validateForm()) {
      return;
    }

    // A cost per piece above the selling price is nearly always the wrong
    // unit (pcs typed for packs). Ask once before saving; buying below cost on
    // purpose is still possible.
    const costAboveSellingPrice = findCostAboveSellingPrice(
      rows
        .filter((row) => row.product && row.quantity && row.subtotal && row.unit)
        .map((row) => {
          let quantityInSmallestUnit = 0;
          try {
            quantityInSmallestUnit = convertToSmallestUnit(
              parseFloat(row.quantity),
              row.unit,
              row.product
            );
          } catch (e) {
            // A product with no usable conversion is left to the save itself
          }
          const base = row.product.base_unit || row.product.smallestUnit;
          return {
            name: row.product.name,
            unit: base,
            // Retail items price per unit; warehouse items have one base price
            sellPrice: row.product.pricePerUnit?.[base] ?? row.product.price ?? 0,
            subtotal: parseRupiah(row.subtotal),
            quantityInSmallestUnit,
          };
        })
    );
    if (costAboveSellingPrice.length > 0) {
      const lines = costAboveSellingPrice
        .map(
          (line) =>
            `• ${line.name}: beli Rp ${fmtAmount(line.costPrice)} per ${line.unit}, jual Rp ${fmtAmount(line.sellPrice)} per ${line.unit}`
        )
        .join("\n");
      const proceed = window.confirm(
        `Harga beli lebih tinggi dari harga jual:\n${lines}\n\nCek satuannya (mis. pack, bukan pcs). Tetap simpan?`
      );
      if (!proceed) return;
    }

    setIsSubmitting(true);
    let expenseWarning = "";
    try {
      const validRows = rows.filter(
        (row) => row.product && row.quantity && row.subtotal
      );

      const items = buildItemsPayload(validRows);

      if (isEditMode) {
        // In edit mode, pass all data to the parent for full reversal + re-application
        await onSave("editBulkPurchase", {
          items,
          validRows,
          supplierName: supplierName.trim(),
          uploadedNota,
          currentUser,
        });
      } else {
        // Create mode: process each row individually
        const collectionNameForNota = isWarehouse ? "notaBelanja_b2b" : "notaBelanja";
        const bulkPurchaseId = await generateIncrementalId(
          queryCollection,
          query,
          where,
          collectionNameForNota,
          "BP"
        );

        for (const row of validRows) {
          const quantity = parseWholeNumber(row.quantity);
          const subtotal = parseRupiah(row.subtotal);
          const quantityInSmallestUnit = convertToSmallestUnit(quantity, row.unit, row.product);

          const transactionDoc = {
            itemId: row.product.itemId || row.product.id,
            itemName: row.product.name,
            kategori: row.product.kategori || "",
            subKategori: row.product.subKategori || "",
            unit: row.product.base_unit || row.product.smallestUnit || "pcs",
            cost: subtotal,
            quantity: quantityInSmallestUnit,
            originalQuantity: quantity,
            originalUnit: row.unit,
            piecesPerBox: row.product.bulk_unit_conversion || row.product.piecesPerBox || null,
            transactionType: "pengadaan",
            transactionVia: "bulkPurchase",
            isDeleted: false,
            createdBy: currentUser ? currentUser.email : "unknown",
            bulkPurchaseId: bulkPurchaseId,
            items: items,
          };

          const txId = `${bulkPurchaseId}_${row.product.id}`;
          await onSave("createTransaction", transactionDoc, txId);

          const newStock = (row.product.stock || 0) + quantityInSmallestUnit;
          const newStockValue = (row.product.stockValue || 0) + subtotal;

          await onSave("updateStock", {
            id: row.product.id,
            stock: newStock,
            stockValue: newStockValue,
            lastPurchasePrice: roundRupiah(subtotal / quantityInSmallestUnit),
          });
        }

        const now = new Date();
        const yyyy = String(now.getFullYear());
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");

        const notaDoc = {
          fileName: uploadedNota ? uploadedNota.fileName : null,
          downloadURL: uploadedNota ? uploadedNota.downloadURL : null,
          supplierName: supplierName.trim() || "Lainnya",
          bulkPurchaseId: bulkPurchaseId,
          items: items,
          uploadedBy: {
            uid: currentUser?.uid || "unknown",
            email: currentUser?.email || "unknown",
          },
          createdAt: new Date().toISOString(),
          process: {
            notaDibuat: {
              completed: true,
              completedAt: new Date(),
            },
            transferBAK: {
              completed: false,
            },
          },
          status: "nota_dibuat",
        };

        const collectionName = isWarehouse ? "notaBelanja_b2b" : "notaBelanja";
        const docId = `${yyyy}-${mm}-${dd}_${uploadedNota ? uploadedNota.timestamp : Date.now()}`;

        await onSave("createNotaBelanja", notaDoc, docId, collectionName);

        if (tracksExpense) {
          const supplier = supplierName.trim();
          const total = items.reduce((sum, item) => sum + item.subtotal, 0);
          try {
            await onSave("createExpense", {
              amount: total,
              category: supplier ? `Pembelian Grosir - ${supplier}` : "Pembelian Grosir",
              sourceAccount: paymentAccount,
              bulkPurchaseId,
            });
          } catch (expenseError) {
            // The purchase is already saved. Failing the whole submit would
            // keep the items in the table and a retry would add the stock
            // twice, so only warn that the expense needs a manual entry.
            console.error("Error recording purchase expense:", expenseError);
            expenseWarning =
              `Pembelian tersimpan, tetapi pengeluaran Rp ${fmtAmount(total)} ` +
              `(${ACCOUNT_LABELS[paymentAccount]}) gagal dicatat di Finance. ` +
              `Mohon catat manual di halaman Finance.`;
          }
        }
      }

      if (!isEditMode) {
        localStorage.removeItem(rowsKey);
        localStorage.removeItem(supplierKey);
        localStorage.removeItem(uploadedNotaKey);
        localStorage.removeItem(accountKey);

        setRows([
          { id: 1, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
          { id: 2, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
          { id: 3, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
        ]);
        setNextId(4);
        setSearchTerms({});
        setShowDropdowns({});
        setFilteredProducts({});
        setErrors({});
        setUploadedNota(null);
        setUploadingNota(false);
        setSupplierName("");
        setPaymentAccount("cash");
        onClose();
        if (expenseWarning) {
          // Let the modal close before the blocking alert appears.
          setTimeout(() => alert(expenseWarning), 50);
        }
      } else {
        handleClose();
      }
    } catch (error) {
      console.error("Error processing bulk purchase:", error);
      alert("Gagal memproses pembelian grosir: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle close
  const handleClose = () => {
    if (isEditMode) {
      setRows([
        { id: 1, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
        { id: 2, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
        { id: 3, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
      ]);
      setNextId(4);
      setSearchTerms({});
      setShowDropdowns({});
      setFilteredProducts({});
      setErrors({});
      setUploadedNota(null);
      setUploadingNota(false);
      setSupplierName("");
      setIsSubmitting(false);
    }
    onClose();
  };

  // Handle click outside dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      Object.keys(dropdownRefs.current).forEach((rowId) => {
        if (
          dropdownRefs.current[rowId] &&
          !dropdownRefs.current[rowId].contains(event.target)
        ) {
          setShowDropdowns((prev) => ({ ...prev, [rowId]: false }));
        }
      });
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Pre-fill form data in edit mode or load draft in create mode
  useEffect(() => {
    if (!isOpen) return;

    if (isEditMode && initialData) {
      setSupplierName(initialData.supplierName || "");



      // Filter product items (exclude admin fee)
      const productItems = (initialData.items || []).filter(
        (item) => item.itemId !== "admin_fee"
      );

      const productsArr = Object.values(products || {});
      const populatedRows = productItems.map((item, index) => {
        const product =
          productsArr.find(
            (p) => (p.itemId || p.id) === item.itemId
          ) || null;
        return {
          id: index + 1,
          product,
          quantity: item.quantity.toString(),
          unit: item.unit,
          hargaSatuan: formatRupiah(Math.abs(item.price).toString()),
          subtotal: formatRupiah(Math.abs(item.subtotal).toString()),
        };
      });

      setRows(populatedRows.length > 0 ? populatedRows : [
        { id: 1, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
      ]);
      setNextId((populatedRows.length || 0) + 1);

      const terms = {};
      populatedRows.forEach((row) => {
        terms[row.id] = row.product ? row.product.name : "";
      });
      setSearchTerms(terms);

      // Pre-set nota info so submit button is enabled without re-upload
      if (initialData.downloadURL) {
        setUploadedNota({
          fileName: initialData.fileName || "Nota sebelumnya",
          downloadURL: initialData.downloadURL,
          originalFile: null,
          timestamp: null,
          isExisting: true,
        });
      }
    } else if (!isEditMode) {
      // Load draft from localStorage on open
      try {
        const savedRows = localStorage.getItem(rowsKey);
        if (savedRows) {
          const parsedRows = JSON.parse(savedRows);
          setRows(parsedRows);
          const maxId = parsedRows.reduce((max, r) => Math.max(max, parseInt(r.id, 10) || 0), 0);
          setNextId(maxId > 0 ? maxId + 1 : 4);

          const terms = {};
          parsedRows.forEach((r) => {
            if (r.product) terms[r.id] = r.product.name;
          });
          setSearchTerms(terms);
        } else {
          setRows([
            { id: 1, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
            { id: 2, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
            { id: 3, product: null, quantity: "", unit: "", hargaSatuan: "", subtotal: "" },
          ]);
          setNextId(4);
          setSearchTerms({});
        }

        setSupplierName(localStorage.getItem(supplierKey) || "");
        setPaymentAccount(normalizeAccount(localStorage.getItem(accountKey)));

        const savedNota = localStorage.getItem(uploadedNotaKey);
        setUploadedNota(savedNota ? JSON.parse(savedNota) : null);
      } catch (e) {
        console.error("Error loading draft from localStorage:", e);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Save draft details to localStorage on state changes
  useEffect(() => {
    if (!isEditMode && isOpen) {
      localStorage.setItem(rowsKey, JSON.stringify(rows));
    }
  }, [rows, rowsKey, isEditMode, isOpen]);

  useEffect(() => {
    if (!isEditMode && isOpen) {
      localStorage.setItem(supplierKey, supplierName);
    }
  }, [supplierName, supplierKey, isEditMode, isOpen]);

  useEffect(() => {
    if (tracksExpense && isOpen) {
      localStorage.setItem(accountKey, paymentAccount);
    }
  }, [paymentAccount, accountKey, tracksExpense, isOpen]);



  useEffect(() => {
    if (!isEditMode && isOpen) {
      if (uploadedNota) {
        localStorage.setItem(uploadedNotaKey, JSON.stringify(uploadedNota));
      } else {
        localStorage.removeItem(uploadedNotaKey);
      }
    }
  }, [uploadedNota, uploadedNotaKey, isEditMode, isOpen]);

  // Sync draft items with latest firebase database products
  useEffect(() => {
    if (isEditMode || !isOpen || !products || Object.keys(products).length === 0) return;

    setRows((prevRows) => {
      let changed = false;
      const updated = prevRows.map((row) => {
        if (!row.product) return row;

        const latestProduct = productsArray.find(
          (p) => (p.itemId && p.itemId === row.product.itemId) || p.id === row.product.id
        );

        if (!latestProduct) {
          // Product deleted from database
          changed = true;
          return {
            id: row.id,
            product: null,
            quantity: "",
            unit: "",
            hargaSatuan: "",
            subtotal: "",
          };
        }

        // Check if key product properties or reference changed
        const isProductChanged =
          row.product !== latestProduct ||
          row.product.name !== latestProduct.name ||
          (row.product.base_unit || row.product.smallestUnit) !== (latestProduct.base_unit || latestProduct.smallestUnit) ||
          row.product.bulk_unit_name !== latestProduct.bulk_unit_name ||
          row.product.bulk_unit_conversion !== latestProduct.bulk_unit_conversion;

        if (isProductChanged) {
          changed = true;

          // Reconcile units
          let newUnit = row.unit;
          const oldBulkUnitName = row.product.bulk_unit_name;
          const oldBaseUnit = row.product.base_unit || row.product.smallestUnit;

          const newBulkUnitName = latestProduct.bulk_unit_name;
          const newBaseUnit = latestProduct.base_unit || latestProduct.smallestUnit;

          if (row.unit === oldBulkUnitName) {
            newUnit = newBulkUnitName || newBaseUnit;
          } else if (row.unit === oldBaseUnit) {
            newUnit = newBaseUnit;
          } else {
            newUnit = newBulkUnitName || newBaseUnit;
          }

          return {
            ...row,
            product: latestProduct,
            unit: newUnit,
          };
        }

        return row;
      });

      return changed ? updated : prevRows;
    });
  }, [products, isEditMode, isOpen, productsArray]);

  // Calculate total
  const calculateTotal = () => {
    return rows.reduce((total, row) => {
      if (row.subtotal && parseRupiah(row.subtotal) > 0) {
        return total + parseRupiah(row.subtotal);
      }
      return total;
    }, 0);
  };

  // The product list appears once there is something to show: matches, or a
  // "not found" message for a typed search. Never an empty box.
  const isProductListOpen = (rowId) => {
    const results = filteredProducts[rowId];
    return (
      !!showDropdowns[rowId] &&
      Array.isArray(results) &&
      (results.length > 0 || (searchTerms[rowId] || "").trim() !== "")
    );
  };

  if (!isOpen) return null;

  return (
    <div className="bulk-modal-overlay">
      <div
        className="bulk-modal-content"
        style={{
          overflow: "visible",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="bulk-modal-header">
          <h2>{isEditMode ? "Edit Nota Belanja" : "Pembelian Grosir"}</h2>
          <button className="bulk-modal-close" onClick={handleClose}>
            <FaTimes />
          </button>
        </div>

        <div
          className="bulk-modal-body"
          style={{ overflow: "auto", flex: 1, padding: "20px" }}
        >
          {/* Nota Upload Section */}
          <div
            className={`nota-upload-section${tracksExpense ? " nota-upload-section-split" : ""}`}
          >
            <div className="nota-upload-main">
              <div className="nota-upload-header">
                <h3>
                  Upload Nota dari Supplier <span className="required">*</span>
                </h3>
                <p>
                  Upload nota pembelian dari supplier. Nama supplier dapat diisi
                  setelah upload.
                </p>
              </div>

              {/* Supplier Name Input */}
              <div className="supplier-input-container">
                <label className="supplier-label">
                  Nama Supplier{" "}
                  {uploadedNota && <span className="required">*</span>}
                </label>
                <input
                  type="text"
                  className="supplier-input"
                  placeholder="Masukkan nama supplier..."
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                />
                {uploadedNota && !supplierName.trim() && (
                  <div className="supplier-warning">
                    Nama supplier diperlukan untuk menyimpan nota yang sudah
                    diupload
                  </div>
                )}
              </div>

              <div className="nota-upload-container">
                {uploadedNota ? (
                  <div className="nota-uploaded">
                    <FaFileAlt className="nota-file-icon" />
                    <div className="nota-file-info">
                      <span className="nota-file-name">
                        {uploadedNota.fileName}
                      </span>
                      <span className="nota-upload-status">
                        ✅ File berhasil diupload
                      </span>
                      {supplierName.trim() && (
                        <span className="nota-supplier-name">
                          Supplier: {supplierName.trim()}
                        </span>
                      )}
                    </div>
                    <div className="nota-actions">
                      <button
                        className="nota-view-btn"
                        onClick={() =>
                          window.open(uploadedNota.downloadURL, "_blank")
                        }
                      >
                        Lihat File
                      </button>
                      <button
                        className="nota-remove-btn"
                        onClick={() => setUploadedNota(null)}
                        title="Hapus file"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="nota-upload-btn">
                    {uploadingNota ? (
                      <>
                        <div className="loading-spinner"></div>
                        Mengunggah...
                      </>
                    ) : (
                      <>
                        <FaUpload />
                        Upload Nota Supplier
                      </>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        if (e.target.files[0]) {
                          handleNotaUpload(e.target.files[0]);
                        }
                      }}
                      disabled={uploadingNota}
                    />
                  </label>
                )}
              </div>
            </div>
            {tracksExpense && (
              <div className="bulk-payment-account">
                <h3 className="bulk-payment-title">Dibayar dari</h3>
                <AccountPills
                  accounts={ACCOUNTS}
                  value={paymentAccount}
                  onChange={setPaymentAccount}
                  disabled={isSubmitting}
                  vertical
                />
              </div>
            )}
          </div>

          <div className="bulk-table-container" style={{ overflow: "visible" }}>
            <table className="bulk-table">
              <thead>
                <tr>
                  <th>Nama Barang</th>
                  <th>Jumlah</th>
                  <th>Satuan</th>
                  <th>Harga Satuan</th>
                  <th>Subtotal</th>
                  <th width="50"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`bulk-row ${
                      errors[`product_${row.id}`] ||
                      errors[`quantity_${row.id}`] ||
                      errors[`hargaSatuan_${row.id}`] ||
                      errors[`subtotal_${row.id}`]
                        ? "bulk-row-error"
                        : ""
                    }`}
                  >
                    <td style={{ position: "relative", overflow: "visible" }}>
                      <div
                        className="bulk-dropdown-container"
                        ref={(el) => (dropdownRefs.current[row.id] = el)}
                      >
                        <input
                          type="text"
                          role="combobox"
                          aria-label="Cari produk"
                          aria-autocomplete="list"
                          aria-expanded={isProductListOpen(row.id)}
                          aria-controls={
                            isProductListOpen(row.id)
                              ? `bulk-product-list-${row.id}`
                              : undefined
                          }
                          className="bulk-input"
                          placeholder="Cari produk..."
                          value={searchTerms[row.id] || ""}
                          onChange={(e) =>
                            handleProductSearch(row.id, e.target.value)
                          }
                          onFocus={() => toggleDropdown(row.id)}
                          onKeyDown={(e) => handleKeyDown(row.id, e)}
                        />
                        {isProductListOpen(row.id) &&
                          (() => {
                            const rect =
                              dropdownRefs.current[
                                row.id
                              ]?.getBoundingClientRect();
                            const results = filteredProducts[row.id];
                            return ReactDOM.createPortal(
                              <div
                                id={`bulk-product-list-${row.id}`}
                                role="listbox"
                                aria-label="Hasil pencarian produk"
                                className="fixed z-[1100] max-h-60 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
                                style={{
                                  top: rect ? rect.bottom + 4 : 0,
                                  left: rect ? rect.left : 0,
                                  width: rect ? rect.width : 200,
                                  minWidth: 200,
                                }}
                              >
                                {results.slice(0, 5).map((product, index) => {
                                  const isHighlighted =
                                    index === (highlightedIndex[row.id] || 0);
                                  return (
                                    <div
                                      key={product.id || index}
                                      role="option"
                                      aria-selected={isHighlighted}
                                      className={`cursor-pointer px-4 py-2.5 text-sm ${
                                        isHighlighted
                                          ? "bg-[#fff8f8] text-[#e66a6a]"
                                          : "text-gray-700"
                                      }`}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleProductSelect(row.id, product);
                                      }}
                                      onMouseEnter={() => {
                                        setHighlightedIndex((prev) => ({
                                          ...prev,
                                          [row.id]: index,
                                        }));
                                      }}
                                    >
                                      {product.name}
                                    </div>
                                  );
                                })}
                                {results.length === 0 && (
                                  <div className="px-4 py-2.5 text-sm italic text-gray-400">
                                    Tidak ada produk ditemukan
                                  </div>
                                )}
                              </div>,
                              document.body
                            );
                          })()}
                        {errors[`product_${row.id}`] && (
                          <div className="bulk-error-text">
                            {errors[`product_${row.id}`]}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="bulk-input"
                        inputMode="numeric"
                        placeholder="Jumlah"
                        value={row.quantity}
                        onChange={(e) =>
                          handleQuantityChange(row.id, e.target.value)
                        }
                      />
                      {errors[`quantity_${row.id}`] && (
                        <div className="bulk-error-text">
                          {errors[`quantity_${row.id}`]}
                        </div>
                      )}
                    </td>
                    <td>
                      <Dropdown
                        ariaLabel="Satuan"
                        value={row.unit}
                        options={(row.product && Array.isArray(row.product.satuan)
                          ? row.product.satuan
                          : []
                        ).map((satuan) => ({ value: satuan, label: satuan }))}
                        onChange={(unit) => handleUnitChange(row.id, unit)}
                        placeholder="-"
                        triggerClassName="bulk-input"
                      />
                    </td>
                    <td>
                      <div className="bulk-money-field">
                        <span className="bulk-money-prefix">Rp</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label="Harga satuan"
                          className="bulk-input"
                          placeholder="0"
                          value={row.hargaSatuan}
                          onChange={(e) =>
                            handleHargaSatuanChange(row.id, e.target.value)
                          }
                        />
                      </div>
                      {errors[`hargaSatuan_${row.id}`] && (
                        <div className="bulk-error-text">
                          {errors[`hargaSatuan_${row.id}`]}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="bulk-money-field">
                        <span className="bulk-money-prefix">Rp</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label="Subtotal"
                          className="bulk-input"
                          placeholder="0"
                          value={row.subtotal}
                          onChange={(e) =>
                            handleSubtotalChange(row.id, e.target.value)
                          }
                        />
                      </div>
                      {errors[`subtotal_${row.id}`] && (
                        <div className="bulk-error-text">
                          {errors[`subtotal_${row.id}`]}
                        </div>
                      )}
                    </td>
                    <td>
                      {rows.length > 1 && (
                        <button
                          className="bulk-remove-btn"
                          onClick={() => removeRow(row.id)}
                        >
                          <FaTrash />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bulk-actions">
            <button className="bulk-add-btn" onClick={addRow}>
              <FaPlus /> Tambah Barang
            </button>
          </div>

          {/* Total Section */}
          <div className="bulk-summary-section">
            <div className="total-calculation">
              <div className="total-row final-total">
                <span>
                  <strong>Total:</strong>
                </span>
                <span>
                  <strong>
                    Rp {formatRupiah(calculateTotal().toString())}
                  </strong>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="bulk-modal-footer">
          <button className="bulk-cancel-btn" onClick={handleClose}>
            Batal
          </button>
          <div
            className="submit-button-wrapper"
            style={{ position: "relative", display: "inline-block" }}
          >
            <button
              className="bulk-submit-btn"
              onClick={handleSubmit}
              disabled={(!isEditMode && !uploadedNota) || isSubmitting}
              style={{
                opacity: (!isEditMode && !uploadedNota) || isSubmitting ? 0.5 : 1,
                cursor: (!isEditMode && !uploadedNota) || isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {isSubmitting ? "Menyimpan..." : isEditMode ? "Simpan Perubahan" : "Simpan"}
            </button>
            {!isEditMode && !uploadedNota && !isSubmitting && (
              <div
                className="submit-tooltip"
                style={{
                  visibility: "hidden",
                  position: "absolute",
                  bottom: "100%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  marginBottom: "8px",
                  padding: "8px 12px",
                  backgroundColor: "#333",
                  color: "white",
                  borderRadius: "4px",
                  fontSize: "14px",
                  whiteSpace: "nowrap",
                  zIndex: 1000,
                  pointerEvents: "none",
                }}
              >
                Mohon unggah nota Supplier terlebih dahulu
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 0,
                    height: 0,
                    borderLeft: "6px solid transparent",
                    borderRight: "6px solid transparent",
                    borderTop: "6px solid #333",
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BulkPurchaseModal;
