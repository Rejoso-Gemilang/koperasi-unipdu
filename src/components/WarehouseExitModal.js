import React, { useState, useEffect, useRef, useMemo } from "react";
import ReactDOM from "react-dom";
import { FaTimes, FaPlus, FaTrash } from "react-icons/fa";
import "../styles/WarehouseExitModal.css";
import { roundRupiah } from "../utils/profitUtils";
import {
  WHOLE_NUMBER_MESSAGE,
  hasDecimalSeparator,
  keepDigits,
  parseWholeNumber,
} from "../utils/stockTransactionUtils";

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

const WarehouseExitModal = ({
  isOpen,
  onClose,
  onSave,
  products,
  currentUser,
  isEditMode = false,
  initialData = null,
}) => {
  const defaultRows = [
    { id: 1, product: null, quantity: "", unit: "", hargaKulak: "", unitPrice: "", subtotal: "" },
    { id: 2, product: null, quantity: "", unit: "", hargaKulak: "", unitPrice: "", subtotal: "" },
    { id: 3, product: null, quantity: "", unit: "", hargaKulak: "", unitPrice: "", subtotal: "" },
  ];

  const rowsKey = "b2b_exit_draft_rows";
  const customerNameKey = "b2b_exit_draft_customer_name";
  const businessTypeKey = "b2b_exit_draft_business_type";

  const [rows, setRows] = useState(() => {
    try {
      const saved = localStorage.getItem(rowsKey);
      return saved ? JSON.parse(saved) : defaultRows;
    } catch (e) {
      console.error("Error reading draft rows from localStorage:", e);
      return defaultRows;
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

  // Customer details
  const [customerName, setCustomerName] = useState(() => {
    try {
      return localStorage.getItem(customerNameKey) || "";
    } catch (e) {
      return "";
    }
  });

  const [businessType, setBusinessType] = useState(() => {
    try {
      return localStorage.getItem(businessTypeKey) || "";
    } catch (e) {
      return "";
    }
  });

  const dropdownRefs = useRef({});

  // Convert products object to array for searching
  const productsArray = useMemo(() => Object.values(products || {}), [products]);

  // Pre-populate form when opening in edit mode or load draft in create mode
  useEffect(() => {
    if (!isOpen) return;

    if (isEditMode && initialData) {
      setCustomerName(initialData.customerDetail?.customerName || "");
      setBusinessType(initialData.customerDetail?.businessType || "");

      if (initialData.items?.length > 0) {
        const populatedRows = initialData.items.map((item, index) => {
          const product =
            Object.values(products).find(
              (p) => (p.itemId || p.id) === item.itemId
            ) || null;
          return {
            id: index + 1,
            product,
            quantity: item.quantity.toString(),
            unit: item.unit,
            hargaKulak: formatRupiah((item.hargaKulak || 0).toString()),
            unitPrice: formatRupiah(item.unitPrice.toString()),
            subtotal: formatRupiah(item.subtotal.toString()),
          };
        });
        setRows(populatedRows);
        setNextId(initialData.items.length + 1);
        const terms = {};
        populatedRows.forEach((row, i) => {
          terms[row.id] = row.product
            ? row.product.name
            : initialData.items[i]?.itemName || "";
        });
        setSearchTerms(terms);
      }
    } else if (!isEditMode) {
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
          setRows(defaultRows);
          setNextId(4);
          setSearchTerms({});
        }

        setCustomerName(localStorage.getItem(customerNameKey) || "");
        setBusinessType(localStorage.getItem(businessTypeKey) || "");
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
      localStorage.setItem(customerNameKey, customerName);
    }
  }, [customerName, customerNameKey, isEditMode, isOpen]);

  useEffect(() => {
    if (!isEditMode && isOpen) {
      localStorage.setItem(businessTypeKey, businessType);
    }
  }, [businessType, businessTypeKey, isEditMode, isOpen]);

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
            hargaKulak: "",
            unitPrice: "",
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

  // Handle focus/click on search input to ensure dropdown displays correctly
  const handleInputFocus = (rowId) => {
    setShowDropdowns((prev) => ({ ...prev, [rowId]: true }));
    const currentTerm = searchTerms[rowId] || "";
    handleProductSearch(rowId, currentTerm);
  };

  // Handle product selection
  const handleProductSelect = (rowId, product) => {
    const unitPrice = product.price || 0;
    const formattedUnitPrice = formatRupiah(unitPrice.toString());

    const costPrice = product.cost_price || 0;
    const formattedHargaKulak = formatRupiah(costPrice.toString());

    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              product,
              unit: product.base_unit || product.smallestUnit || "pcs",
              hargaKulak: formattedHargaKulak,
              unitPrice: formattedUnitPrice,
              subtotal: "", // Will be calculated when quantity is entered
            }
          : row
      )
    );

    setSearchTerms((prev) => ({ ...prev, [rowId]: product.name }));
    setShowDropdowns((prev) => ({ ...prev, [rowId]: false }));
  };

  // Handle unit change
  const handleUnitChange = (rowId, newUnit) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id === rowId) {
          let updatedUnitPrice = row.unitPrice;
          let updatedSubtotal = row.subtotal;
          let updatedHargaKulak = row.hargaKulak;

          if (row.product) {
            const isBulk = row.product.bulk_unit_name && newUnit === row.product.bulk_unit_name;
            const conversion = isBulk ? (row.product.bulk_unit_conversion || 1) : 1;

            const unitPrice = roundRupiah((row.product.price || 0) * conversion);
            updatedUnitPrice = formatRupiah(unitPrice.toString());

            const costPrice = roundRupiah((row.product.cost_price || 0) * conversion);
            updatedHargaKulak = formatRupiah(costPrice.toString());

            if (row.quantity && parseFloat(row.quantity) > 0) {
              const subtotal = roundRupiah(parseFloat(row.quantity) * unitPrice);
              updatedSubtotal = formatRupiah(subtotal.toString());
            } else {
              updatedSubtotal = "";
            }
          }

          return {
            ...row,
            unit: newUnit,
            unitPrice: updatedUnitPrice,
            hargaKulak: updatedHargaKulak,
            subtotal: updatedSubtotal,
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

    const row = rows.find((r) => r.id === rowId);
    if (row && row.product && cleanValue && parseFloat(cleanValue) > 0) {
      const unitPrice = parseRupiah(row.unitPrice);
      const subtotal = roundRupiah(parseInt(cleanValue, 10) * unitPrice);
      const formattedSubtotal = formatRupiah(subtotal.toString());

      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                quantity: cleanValue,
                subtotal: formattedSubtotal,
              }
            : r
        )
      );
    } else {
      setRows((prev) =>
        prev.map((row) =>
          row.id === rowId
            ? { ...row, quantity: cleanValue, subtotal: "" }
            : row
        )
      );
    }
  };

  // Handle unit price change
  const handleUnitPriceChange = (rowId, value) => {
    const formattedValue = formatRupiah(value);
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, unitPrice: formattedValue } : row
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
      const unitPrice = parseRupiah(formattedValue);
      const subtotal = roundRupiah(quantity * unitPrice);

      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                unitPrice: formattedValue,
                subtotal: formatRupiah(subtotal.toString()),
              }
            : r
        )
      );
    }
  };

  // Handle harga kulak change
  const handleHargaKulakChange = (rowId, value) => {
    const formattedValue = formatRupiah(value);
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, hargaKulak: formattedValue } : row
      )
    );
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
        hargaKulak: "",
        unitPrice: "",
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
      setShowDropdowns((prev) => ({ ...prev, [rowId]: false }));
    }
  };

  // Validate form
  const validateForm = () => {
    const newErrors = {};

    // Validate customer details
    if (!customerName.trim()) {
      newErrors.customerName = "Nama customer harus diisi";
    }
    if (!businessType) {
      newErrors.businessType = "Jenis bisnis harus dipilih";
    }

    // Validate rows
    rows.forEach((row) => {
      if (!row.product) {
        newErrors[`product_${row.id}`] = "Produk harus dipilih";
      }
      if (!row.quantity) {
        newErrors[`quantity_${row.id}`] = "Jumlah harus diisi";
      } else if (Number.isNaN(parseWholeNumber(row.quantity))) {
        // Also catches a decimal quantity left in a saved draft or an old exit
        newErrors[`quantity_${row.id}`] = WHOLE_NUMBER_MESSAGE;
      } else if (parseWholeNumber(row.quantity) === 0) {
        newErrors[`quantity_${row.id}`] = "Jumlah harus diisi";
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      const validRows = rows.filter(
        (row) => row.product && row.quantity && row.subtotal
      );

      // Check stock availability first (skip in edit mode — parent handles stock reversal)
      if (!isEditMode) {
        const stockChecks = [];
        for (const row of validRows) {
          const quantity = parseWholeNumber(row.quantity);
          const availableStock = row.product.stock || 0;

          if (availableStock < quantity) {
            stockChecks.push({
              name: row.product.name,
              requested: quantity,
              available: availableStock,
            });
          }
        }

        if (stockChecks.length > 0) {
          const errorMessage = stockChecks
            .map(
              (item) =>
                `${item.name}: diminta ${item.requested}, tersedia ${item.available}`
            )
            .join("\n");
          alert(`Stok tidak mencukupi:\n${errorMessage}`);
          return;
        }
      }

      // Create transaction data
      const transactionData = {
        customerDetail: {
          customerName: customerName.trim(),
          businessType,
        },
        items: validRows.map((row) => ({
          itemId: row.product.itemId || row.product.id,
          itemName: row.product.name,
          quantity: parseWholeNumber(row.quantity),
          unit: row.unit,
          hargaKulak: parseRupiah(row.hargaKulak),
          unitPrice: parseRupiah(row.unitPrice),
          subtotal: parseRupiah(row.subtotal),
        })),
        total: validRows.reduce(
          (sum, row) => sum + parseRupiah(row.subtotal),
          0
        ),
        status: "menunggu PO",
        workflow: {
          notaTagihan: { completed: true, completedAt: new Date() },
          uploadPO: { completed: false },
          uploadBuktiPembayaran: { completed: false },
        },
        createdBy: currentUser ? currentUser.email : "unknown",
      };

      await onSave(transactionData, validRows);

      if (!isEditMode) {
        localStorage.removeItem(rowsKey);
        localStorage.removeItem(customerNameKey);
        localStorage.removeItem(businessTypeKey);

        setRows(defaultRows);
        setNextId(4);
        setSearchTerms({});
        setShowDropdowns({});
        setFilteredProducts({});
        setErrors({});
        setCustomerName("");
        setBusinessType("");
        onClose();
      } else {
        handleClose();
      }
    } catch (error) {
      console.error("Error processing warehouse exit:", error);
      alert("Error processing warehouse exit: " + error.message);
    }
  };

  // Handle close
  const handleClose = () => {
    if (isEditMode) {
      setRows(defaultRows);
      setNextId(4);
      setSearchTerms({});
      setShowDropdowns({});
      setFilteredProducts({});
      setErrors({});
      setCustomerName("");
      setBusinessType("");
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

  const calculateTotal = () => {
    return rows.reduce(
      (sum, row) => sum + parseRupiah(row.subtotal),
      0
    );
  };

  if (!isOpen) return null;

  return (
    <div className="warehouse-exit-modal-overlay">
      <div className="warehouse-exit-modal-content">
        <div className="warehouse-exit-modal-header">
          <h2>{isEditMode ? "Edit Catatan Keluar Gudang" : "Warehouse Exit - Create New Record"}</h2>
          <button className="warehouse-exit-modal-close" onClick={handleClose}>
            <FaTimes />
          </button>
        </div>

        <div className="warehouse-exit-modal-body">
          {/* Customer Details Section */}
          <div className="customer-details-section">
            <h3>Customer Details</h3>
            <div className="customer-details-form">
              <div className="form-group">
                <label>Customer Name *</label>
                <input
                  type="text"
                  className={`form-input ${errors.customerName ? "error" : ""}`}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter customer name"
                />
                {errors.customerName && (
                  <div className="error-text">{errors.customerName}</div>
                )}
              </div>
              <div className="form-group">
                <label>Business Type *</label>
                <select
                  className={`form-input ${errors.businessType ? "error" : ""}`}
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                >
                  <option value="">Select business type</option>
                  <option value="Asrama">Asrama</option>
                  <option value="MBG">MBG</option>
                </select>
                {errors.businessType && (
                  <div className="error-text">{errors.businessType}</div>
                )}
              </div>
            </div>
          </div>

          {/* Items Table Section */}
          <div className="warehouse-exit-table-container">
            <table className="warehouse-exit-table">
              <thead>
                <tr>
                  <th>Nama Barang</th>
                  <th>Jumlah</th>
                  <th>Satuan</th>
                  <th>Harga Kulak</th>
                  <th>Harga Satuan</th>
                  <th>Subtotal</th>
                  <th width="50"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`warehouse-exit-row ${
                      errors[`product_${row.id}`] ||
                      errors[`quantity_${row.id}`]
                        ? "warehouse-exit-row-error"
                        : ""
                    }`}
                  >
                    <td>
                      <div
                        className="warehouse-exit-dropdown-container"
                        ref={(el) => (dropdownRefs.current[row.id] = el)}
                      >
                        <input
                          type="text"
                          className="warehouse-exit-input"
                          placeholder="Cari produk..."
                          value={searchTerms[row.id] || ""}
                          onChange={(e) =>
                            handleProductSearch(row.id, e.target.value)
                          }
                          onFocus={() => handleInputFocus(row.id)}
                          onClick={() => handleInputFocus(row.id)}
                          onKeyDown={(e) => handleKeyDown(row.id, e)}
                        />
                        {showDropdowns[row.id] &&
                          (() => {
                            const rect =
                              dropdownRefs.current[
                                row.id
                              ]?.getBoundingClientRect();
                            const dropdown = (
                              <div
                                className="warehouse-exit-dropdown"
                                style={{
                                  position: "fixed",
                                  zIndex: 2147483647,
                                  backgroundColor: "white",
                                  border: "2px solid #4a90e2",
                                  borderRadius: "4px",
                                  boxShadow: "0 8px 16px rgba(0, 0, 0, 0.2)",
                                  maxHeight: "200px",
                                  overflowY: "auto",
                                  width: rect ? `${rect.width}px` : "200px",
                                  top: rect ? `${rect.bottom}px` : "0px",
                                  left: rect ? `${rect.left}px` : "0px",
                                  display: "block",
                                  visibility: "visible",
                                  minWidth: "200px",
                                }}
                              >
                                {filteredProducts[row.id]
                                  ?.slice(0, 5)
                                  .map((product, index) => {
                                    const isHighlighted =
                                      index === (highlightedIndex[row.id] || 0);
                                    return (
                                      <div
                                        key={index}
                                        className="warehouse-exit-dropdown-item"
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
                                        style={{
                                          padding: "12px",
                                          cursor: "pointer",
                                          borderBottom: "1px solid #f0f0f0",
                                          backgroundColor: isHighlighted
                                            ? "#e3f2fd"
                                            : "white",
                                          fontSize: "0.9rem",
                                        }}
                                      >
                                        {product.name}
                                      </div>
                                    );
                                  })}
                                {filteredProducts[row.id]?.length === 0 && (
                                  <div
                                    className="warehouse-exit-dropdown-item warehouse-exit-dropdown-empty"
                                    style={{
                                      padding: "12px",
                                      color: "#666",
                                      fontStyle: "italic",
                                      backgroundColor: "white",
                                    }}
                                  >
                                    Tidak ada produk ditemukan
                                  </div>
                                )}
                              </div>
                            );
                            return ReactDOM.createPortal(
                              dropdown,
                              document.body
                            );
                          })()}
                        {errors[`product_${row.id}`] && (
                          <div className="warehouse-exit-error-text">
                            {errors[`product_${row.id}`]}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="warehouse-exit-input"
                        inputMode="numeric"
                        placeholder="Jumlah"
                        value={row.quantity}
                        onChange={(e) =>
                          handleQuantityChange(row.id, e.target.value)
                        }
                      />
                      {errors[`quantity_${row.id}`] && (
                        <div className="warehouse-exit-error-text">
                          {errors[`quantity_${row.id}`]}
                        </div>
                      )}
                    </td>
                    <td>
                      <select
                        className="warehouse-exit-input"
                        value={row.unit}
                        onChange={(e) => handleUnitChange(row.id, e.target.value)}
                      >
                        <option value="">-- Satuan --</option>
                        {row.product ? (
                          [row.product.base_unit || row.product.smallestUnit].filter(Boolean).map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))
                        ) : (
                          row.unit && <option value={row.unit}>{row.unit}</option>
                        )}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="warehouse-exit-input"
                        placeholder="Harga kulak"
                        value={row.hargaKulak}
                        onChange={(e) =>
                          handleHargaKulakChange(row.id, e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="warehouse-exit-input"
                        placeholder="Harga satuan"
                        value={row.unitPrice}
                        onChange={(e) =>
                          handleUnitPriceChange(row.id, e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="warehouse-exit-input"
                        value={row.subtotal ? `Rp ${row.subtotal}` : ""}
                        readOnly
                      />
                    </td>
                    <td>
                      {rows.length > 1 && (
                        <button
                          className="warehouse-exit-remove-btn"
                          onClick={() => removeRow(row.id)}
                        >
                          <FaTrash />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="warehouse-exit-total-row">
                  <td colSpan="5" style={{ textAlign: "right", fontWeight: "bold", padding: "16px", fontSize: "1.05rem" }}>Total:</td>
                  <td style={{ fontWeight: "bold", padding: "16px", fontSize: "1.05rem", color: "#28a745" }}>
                    Rp {formatRupiah(calculateTotal())}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="warehouse-exit-actions">
            <button className="warehouse-exit-add-btn" onClick={addRow}>
              <FaPlus /> Tambah Barang
            </button>
          </div>
        </div>

        <div className="warehouse-exit-modal-footer">
          <button className="warehouse-exit-cancel-btn" onClick={handleClose}>
            Cancel
          </button>
          <button className="warehouse-exit-submit-btn" onClick={handleSubmit}>
            {isEditMode ? "Simpan Perubahan" : "Create Record"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WarehouseExitModal;
