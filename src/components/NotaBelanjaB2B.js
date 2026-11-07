import React, { useState, useEffect } from "react";
import {
  FaFileInvoice,
  FaUpload,
  FaEye,
  FaCheck,
  FaClock,
  FaChevronDown,
  FaChevronUp,
  FaEdit,
  FaStickyNote,
} from "react-icons/fa";
import { v4 as uuidv4 } from "uuid";
import "../styles/NotaBelanjaB2B.css";
import { useAuth } from "../context/AuthContext";
import { useFirestore } from "../context/FirestoreContext";
import { uploadFile } from "../firebase";
import BulkPurchaseModal from "./BulkPurchaseModal";
import { convertToSmallestUnit } from "../utils/transaksiUtils";

// Helper function for currency formatting
function formatRupiah(value) {
  if (!value) return "0";
  const numeric = value.toString().replace(/\D/g, "");
  if (!numeric) return "0";
  return numeric.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Helper function to format date in Indonesian
function formatIndonesianDate(dateString) {
  if (!dateString) return "N/A";

  const date =
    typeof dateString === "string"
      ? new Date(dateString)
      : dateString.toDate?.();
  if (!date || isNaN(date.getTime())) return "N/A";

  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];

  const dayName = days[date.getDay()];
  const day = String(date.getDate()).padStart(2, "0");
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  return `${dayName}, ${day} ${month} ${year}`;
}

// Helper to parse rupiah strings to numbers
function parseRupiah(value) {
  if (!value) return 0;
  const numeric = value.toString().replace(/\D/g, "");
  return parseInt(numeric, 10) || 0;
}

const NotaBelanjaB2B = () => {
  const { currentUser, userRole } = useAuth();
  const { queryCollection, updateDoc, createDoc } = useFirestore();

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState({});
  const [expandedRecords, setExpandedRecords] = useState({});
  const [snackbar, setSnackbar] = useState({ open: false, message: "" });
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 10;

  // Edit state
  const [products, setProducts] = useState({});
  const [editingRecord, setEditingRecord] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Migration state
  const [isMigrating, setIsMigrating] = useState(false);

  // Catatan state: tracks the input text per record
  const [catatanInputs, setCatatanInputs] = useState({});
  const [savingCatatan, setSavingCatatan] = useState({});
  const MAX_CATATAN = 5;

  // Check permissions
  const canUploadBuktiTransfer = userRole === "BAK";
  const canEdit = userRole === "Director" || userRole === "Wakil Rektor 2";
  const canRunMigration = userRole === "superAdmin" || userRole === "Director";

  // Fetch nota belanja records
  const fetchRecords = async () => {
    try {
      const recordsData = await queryCollection("notaBelanja_b2b");
      // Sort by createdAt descending (newest first)
      const sortedRecords = recordsData.sort((a, b) => {
        const dateA =
          typeof a.createdAt === "string"
            ? new Date(a.createdAt)
            : a.createdAt?.toDate?.() || new Date(0);
        const dateB =
          typeof b.createdAt === "string"
            ? new Date(b.createdAt)
            : b.createdAt?.toDate?.() || new Date(0);
        return dateB - dateA;
      });
      setRecords(sortedRecords);
    } catch (error) {
      console.error("Error fetching records:", error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate total from items array
  const calculateTotal = (items) => {
    if (!items || !Array.isArray(items)) return 0;
    return items.reduce((total, item) => {
      return total + (item.subtotal || 0);
    }, 0);
  };

  // Get status display
  const getStatusDisplay = (record) => {
    const { process } = record;

    if (process?.transferBAK?.completed) {
      return {
        text: "Selesai",
        color: "#28a745",
        bgColor: "#d4edda",
        textColor: "#155724",
        icon: <FaCheck />,
      };
    } else {
      return {
        text: "Nota dibuat",
        color: "#ffc107",
        bgColor: "#fff3cd",
        textColor: "#856404",
        icon: <FaClock />,
      };
    }
  };

  // File upload handler
  const handleFileUpload = async (recordId, file) => {
    const uploadKey = `${recordId}_bukti_transfer`;

    try {
      setUploadingFiles((prev) => ({ ...prev, [uploadKey]: true }));

      // Generate file path
      const timestamp = Date.now();
      const fileExtension = file.name.split(".").pop();
      const fileName = `${recordId}_bukti_transfer_${timestamp}.${fileExtension}`;
      const filePath = `nota_belanja_b2b/bukti_transfer/${fileName}`;

      // Upload file to Firebase Storage
      const downloadURL = await uploadFile(file, filePath);

      // Update process status
      const updateData = {
        "process.transferBAK": {
          completed: true,
          completedAt: new Date(),
          fileName: file.name,
          originalFileName: file.name,
          storagePath: filePath,
          downloadURL: downloadURL,
          uploadedBy: {
            email: currentUser?.email || "unknown",
            uid: currentUser?.uid || "unknown",
          },
        },
        status: "completed",
      };

      await updateDoc("notaBelanja_b2b", recordId, updateData);
      await fetchRecords();

      setSnackbar({
        open: true,
        message: "Bukti transfer berhasil diupload!",
      });

      setTimeout(() => {
        setSnackbar({ open: false, message: "" });
      }, 3000);
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Error uploading file: " + error.message);
    } finally {
      setUploadingFiles((prev) => {
        const newState = { ...prev };
        delete newState[uploadKey];
        return newState;
      });
    }
  };

  // Handle viewing files
  const handleViewFile = (fileInfo) => {
    if (fileInfo?.downloadURL) {
      window.open(fileInfo.downloadURL, "_blank");
    } else {
      alert("File not available");
    }
  };

  // Handle viewing nota document
  const handleViewNota = (record) => {
    if (record.downloadURL) {
      window.open(record.downloadURL, "_blank");
    } else {
      alert("Nota document not available");
    }
  };

  // Toggle record expansion
  const toggleExpanded = (recordId) => {
    setExpandedRecords((prev) => ({
      ...prev,
      [recordId]: !prev[recordId],
    }));
  };

  // Fetch products for the edit modal product picker
  const fetchProducts = async () => {
    try {
      const stocksData = await queryCollection("stocks_b2b");
      const productsMap = {};
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
          productsMap[item.id] = {
            ...item,
            name: capitalizedName || item.name,
            satuan: item.satuan || [],
          };
        }
      });
      setProducts(productsMap);
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  };

  // Handle the full edit flow when BulkPurchaseModal submits in edit mode
  const handleEditSave = async (action, data) => {
    if (action !== "editBulkPurchase") return;

    const record = editingRecord;
    const { items, validRows, supplierName: newSupplierName, uploadedNota } = data;

    try {
      // Step 1: Fetch old stock transactions linked to this nota
      const allStockTxns = await queryCollection("stockTransactions_b2b");
      const oldStockTxns = allStockTxns.filter(
        (t) => t.bulkPurchaseId === record.bulkPurchaseId && !t.isDeleted
      );

      // Step 2: Fetch fresh product data
      const freshStocksData = await queryCollection("stocks_b2b");
      const freshProductsMap = {};
      freshStocksData.forEach((item) => {
        if (!item.isDeleted) freshProductsMap[item.id] = item;
      });

      // Step 3: Reverse old stock transactions (pengadaan added stock, so we subtract)
      for (const txn of oldStockTxns) {
        const productId =
          freshProductsMap[txn.itemId] != null
            ? txn.itemId
            : Object.keys(freshProductsMap).find(
                (key) => freshProductsMap[key].itemId === txn.itemId
              );

        if (productId) {
          const product = freshProductsMap[productId];
          // Purchases saved before quantities were whole can carry a decimal part
          const restoredStock = Math.round(product.stock - txn.quantity);
          const restoredValue = (product.stockValue || 0) - (txn.cost || 0);

          await updateDoc("stocks_b2b", productId, {
            stock: restoredStock,
            stockValue: Math.max(0, restoredValue),
          });

          freshProductsMap[productId] = {
            ...product,
            stock: restoredStock,
            stockValue: Math.max(0, restoredValue),
          };
        }

        // Mark old transaction as deleted
        await updateDoc("stockTransactions_b2b", txn.id, { isDeleted: true });
      }

      // Step 4: Apply new stock transactions
      const newBulkPurchaseId = uuidv4();

      for (const row of validRows) {
        const quantity = parseFloat(row.quantity);
        const subtotal = parseRupiah(row.subtotal);
        const product = freshProductsMap[row.product.id] || row.product;
        const quantityInSmallestUnit = convertToSmallestUnit(quantity, row.unit, product);

        const transactionDoc = {
          itemId: row.product.itemId || row.product.id,
          itemName: row.product.name,
          kategori: row.product.kategori || "",
          subKategori: row.product.subKategori || "",
          unit: product.base_unit || product.smallestUnit || "pcs",
          cost: subtotal,
          quantity: quantityInSmallestUnit,
          originalQuantity: quantity,
          originalUnit: row.unit,
          piecesPerBox: product.bulk_unit_conversion || product.piecesPerBox || null,
          transactionType: "pengadaan",
          transactionVia: "bulkPurchase",
          isDeleted: false,
          createdBy: currentUser ? currentUser.email : "unknown",
          bulkPurchaseId: newBulkPurchaseId,
          items: items,
        };

        const txId = uuidv4();
        await createDoc("stockTransactions_b2b", transactionDoc, txId);

        const newStock = (product.stock || 0) + quantityInSmallestUnit;
        const newStockValue = (product.stockValue || 0) + subtotal;

        await updateDoc("stocks_b2b", row.product.id, {
          stock: newStock,
          stockValue: newStockValue,
        });

        freshProductsMap[row.product.id] = {
          ...product,
          stock: newStock,
          stockValue: newStockValue,
        };
      }

      // Step 5: Update the notaBelanja_b2b document
      const notaUpdateData = {
        items: items,
        supplierName: newSupplierName,
        bulkPurchaseId: newBulkPurchaseId,
      };

      // If a new nota file was uploaded, update the file info
      if (uploadedNota && !uploadedNota.isExisting) {
        notaUpdateData.fileName = uploadedNota.fileName;
        notaUpdateData.downloadURL = uploadedNota.downloadURL;
      }

      await updateDoc("notaBelanja_b2b", record.id, notaUpdateData);

      // Refresh data
      await fetchRecords();
      await fetchProducts();
      setEditingRecord(null);

      setSnackbar({ open: true, message: "Nota belanja berhasil diperbarui!" });
      setTimeout(() => setSnackbar({ open: false, message: "" }), 3000);
    } catch (error) {
      console.error("Error updating nota belanja:", error);
      throw error;
    }
  };

  // Add a catatan to a nota belanja record
  const handleAddCatatan = async (recordId) => {
    const text = (catatanInputs[recordId] || "").trim();
    if (!text) return;

    setSavingCatatan((prev) => ({ ...prev, [recordId]: true }));
    try {
      const record = records.find((r) => r.id === recordId);
      const existingCatatan = record?.catatan || [];

      if (existingCatatan.length >= MAX_CATATAN) {
        alert(`Maksimal ${MAX_CATATAN} catatan per nota belanja.`);
        return;
      }

      const newEntry = `${text} (${currentUser?.email || "unknown"})`;
      const updatedCatatan = [...existingCatatan, newEntry];

      await updateDoc("notaBelanja_b2b", recordId, {
        catatan: updatedCatatan,
      });

      // Clear input and refresh
      setCatatanInputs((prev) => ({ ...prev, [recordId]: "" }));
      await fetchRecords();

      setSnackbar({ open: true, message: "Catatan berhasil ditambahkan!" });
      setTimeout(() => setSnackbar({ open: false, message: "" }), 3000);
    } catch (error) {
      console.error("Error adding catatan:", error);
      alert("Error menambahkan catatan: " + error.message);
    } finally {
      setSavingCatatan((prev) => ({ ...prev, [recordId]: false }));
    }
  };

  // Migration: backfill bulkPurchaseId on existing records
  const runMigration = async () => {
    if (isMigrating) return;
    if (!window.confirm(
      "Ini akan menambahkan bulkPurchaseId ke semua nota belanja dan transaksi yang belum memilikinya. Lanjutkan?"
    )) return;

    setIsMigrating(true);
    try {
      const allNotas = await queryCollection("notaBelanja_b2b");
      const notasWithoutId = allNotas.filter((n) => !n.bulkPurchaseId);

      const allTxns = await queryCollection("stockTransactions_b2b");
      const txnsWithoutId = allTxns.filter(
        (t) =>
          t.transactionVia === "bulkPurchase" &&
          !t.isDeleted &&
          !t.bulkPurchaseId
      );

      let matchedNotas = 0;
      let matchedTxns = 0;
      let unmatchedNotas = 0;

      for (const nota of notasWithoutId) {
        const notaItemsKey = JSON.stringify(
          (nota.items || []).map((i) => ({
            itemId: i.itemId,
            quantity: i.quantity,
            subtotal: i.subtotal,
          }))
        );

        // Find transactions with matching items array
        const matchingTxns = txnsWithoutId.filter((txn) => {
          const txnItemsKey = JSON.stringify(
            (txn.items || []).map((i) => ({
              itemId: i.itemId,
              quantity: i.quantity,
              subtotal: i.subtotal,
            }))
          );
          return txnItemsKey === notaItemsKey;
        });

        if (matchingTxns.length > 0) {
          const newBulkPurchaseId = uuidv4();

          await updateDoc("notaBelanja_b2b", nota.id, {
            bulkPurchaseId: newBulkPurchaseId,
          });
          matchedNotas++;

          for (const txn of matchingTxns) {
            await updateDoc("stockTransactions_b2b", txn.id, {
              bulkPurchaseId: newBulkPurchaseId,
            });
            matchedTxns++;
            // Remove from pool so they don't match another nota
            const idx = txnsWithoutId.indexOf(txn);
            if (idx > -1) txnsWithoutId.splice(idx, 1);
          }
        } else {
          // No matching transactions found -- assign ID to nota only
          const newBulkPurchaseId = uuidv4();
          await updateDoc("notaBelanja_b2b", nota.id, {
            bulkPurchaseId: newBulkPurchaseId,
          });
          unmatchedNotas++;
        }
      }

      await fetchRecords();

      const message = `Migrasi selesai! ${matchedNotas} nota berhasil ditautkan dengan ${matchedTxns} transaksi.` +
        (unmatchedNotas > 0
          ? ` ${unmatchedNotas} nota tidak ditemukan transaksinya (tetap diberi ID).`
          : "");

      setSnackbar({ open: true, message });
      setTimeout(() => setSnackbar({ open: false, message: "" }), 5000);
    } catch (error) {
      console.error("Error running migration:", error);
      alert("Error saat migrasi: " + error.message);
    } finally {
      setIsMigrating(false);
    }
  };

  useEffect(() => {
    fetchRecords();
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Calculate pagination
  const indexOfLastRecord = currentPage * recordsPerPage;
  const indexOfFirstRecord = indexOfLastRecord - recordsPerPage;
  const currentRecords = records.slice(indexOfFirstRecord, indexOfLastRecord);
  const totalPages = Math.ceil(records.length / recordsPerPage);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loading) {
    return <div className="nota-belanja-b2b-loading">Memuat...</div>;
  }

  return (
    <div className="nota-belanja-b2b-container">
      <div className="nota-belanja-b2b-header">
        <h1>Nota Belanja B2B</h1>
        {canRunMigration && records.some((r) => !r.bulkPurchaseId) && (
          <button
            className="migration-btn"
            onClick={runMigration}
            disabled={isMigrating}
            style={{
              opacity: isMigrating ? 0.5 : 1,
              cursor: isMigrating ? "not-allowed" : "pointer",
            }}
          >
            {isMigrating ? "Migrasi berjalan..." : "Migrasi Data (Backfill ID)"}
          </button>
        )}
      </div>

      <div className="nota-belanja-b2b-records">
        {records.length === 0 ? (
          <div className="nota-belanja-b2b-empty">
            <p>Tidak ada nota belanja B2B ditemukan.</p>
          </div>
        ) : (
          <>
            {currentRecords.map((record) => {
              const statusDisplay = getStatusDisplay(record);
              const total = calculateTotal(record.items);
              const isExpanded = expandedRecords[record.id];

              return (
                <div key={record.id} className="nota-belanja-b2b-record-tile">
                  <div className="record-header">
                    <div className="record-main-info">
                      <div className="record-title-row">
                        <h3 className="supplier-name">
                          {record.supplierName || "Unknown Supplier"}
                        </h3>
                      </div>
                      <div className="record-metadata">
                        <span className="record-date">
                          {formatIndonesianDate(record.createdAt)}
                        </span>
                        <span className="record-id">ID: {record.id}</span>
                      </div>
                    </div>
                    <div className="record-right-side">
                      <span
                        className="status-tag"
                        style={{
                          backgroundColor: statusDisplay.bgColor,
                          color: statusDisplay.textColor,
                          border: `1px solid ${statusDisplay.color}`,
                        }}
                      >
                        {statusDisplay.icon}
                        {statusDisplay.text}
                      </span>
                      <div className="total-price-badge">
                        Rp {formatRupiah(total.toString())}
                      </div>
                    </div>
                  </div>

                  <div className="action-row">
                    {/* View Nota Button */}
                    <button
                      className="action-btn completed"
                      onClick={() => handleViewNota(record)}
                    >
                      <FaFileInvoice /> Lihat Nota
                    </button>

                    {/* Bukti Transfer Button */}
                    {uploadingFiles[`${record.id}_bukti_transfer`] ? (
                      <button className="action-btn loading" disabled>
                        <div className="loading-spinner"></div> Mengunggah...
                      </button>
                    ) : record.process?.transferBAK?.completed ? (
                      <button
                        className="action-btn completed"
                        onClick={() =>
                          handleViewFile(record.process.transferBAK)
                        }
                      >
                        <FaEye /> Bukti Transfer
                      </button>
                    ) : canUploadBuktiTransfer ? (
                      <label className="action-btn active">
                        <FaUpload /> Upload Bukti Transfer
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            if (e.target.files[0]) {
                              handleFileUpload(record.id, e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                    ) : (
                      <button className="action-btn disabled" disabled>
                        <FaUpload /> Upload Bukti Transfer
                      </button>
                    )}

                    {/* Edit Button */}
                    {canEdit && record.bulkPurchaseId && !record.process?.transferBAK?.completed ? (
                      <button
                        className="action-btn edit-btn"
                        onClick={() => {
                          setEditingRecord(record);
                          setShowEditModal(true);
                        }}
                      >
                        <FaEdit /> Edit
                      </button>
                    ) : (
                      <div className="action-btn-tooltip-wrapper">
                        <button className="action-btn disabled" disabled>
                          <FaEdit /> Edit
                        </button>
                        <span className="action-btn-tooltip">
                          {!canEdit
                            ? "Hanya Director/Wakil Rektor 2 yang bisa mengedit"
                            : !record.bulkPurchaseId
                            ? "Nota ini dibuat sebelum fitur edit. Jalankan migrasi data terlebih dahulu."
                            : "Nota yang sudah ditransfer tidak bisa diedit"}
                        </span>
                      </div>
                    )}

                    {/* Toggle Details Button */}
                    <button
                      className="action-btn toggle"
                      onClick={() => toggleExpanded(record.id)}
                    >
                      {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
                      {isExpanded ? "Sembunyikan" : "Detail"} Items
                    </button>
                  </div>

                  {/* Expanded Items Details */}
                  {isExpanded && (
                    <div className="items-detail">
                      <h4>Detail Items:</h4>
                      <div className="items-list">
                        {record.items && record.items.length > 0 ? (
                          record.items.map((item, index) => (
                            <div key={index} className="item-row">
                              <div className="item-info">
                                <span className="item-name">
                                  {item.itemName}
                                </span>
                                <span className="item-quantity">
                                  {item.quantity} {item.unit}
                                </span>
                              </div>
                              <div className="item-price">
                                <span className="unit-price">
                                  @Rp{" "}
                                  {formatRupiah((item.price || 0).toString())}
                                </span>
                                <span className="subtotal">
                                  Rp{" "}
                                  {formatRupiah(
                                    (item.subtotal || 0).toString(),
                                  )}
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p>Tidak ada items tersedia</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Catatan Section */}
                  <div className="catatan-section">
                    {record.catatan && record.catatan.length > 0 && (
                      <div className="catatan-list">
                        {record.catatan.map((note, idx) => (
                          <div key={idx} className="catatan-entry">
                            <FaStickyNote className="catatan-icon" />
                            <span className="catatan-text">
                              Catatan: {note}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {(!record.catatan || record.catatan.length < MAX_CATATAN) && (
                      <div className="catatan-input-row">
                        <input
                          type="text"
                          className="catatan-input"
                          placeholder="Tulis catatan..."
                          value={catatanInputs[record.id] || ""}
                          onChange={(e) =>
                            setCatatanInputs((prev) => ({
                              ...prev,
                              [record.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !savingCatatan[record.id]) {
                              handleAddCatatan(record.id);
                            }
                          }}
                          disabled={savingCatatan[record.id]}
                        />
                        <button
                          className="catatan-submit-btn"
                          onClick={() => handleAddCatatan(record.id)}
                          disabled={
                            savingCatatan[record.id] ||
                            !(catatanInputs[record.id] || "").trim()
                          }
                        >
                          {savingCatatan[record.id]
                            ? "Menyimpan..."
                            : "Tambah Catatan"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="nota-belanja-b2b-pagination">
                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  style={{
                    opacity: currentPage === 1 ? 0.5 : 1,
                    cursor: currentPage === 1 ? "not-allowed" : "pointer",
                  }}
                >
                  &laquo; Previous
                </button>

                <div className="pagination-numbers">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (pageNum) => {
                      if (
                        pageNum === 1 ||
                        pageNum === totalPages ||
                        (pageNum >= currentPage - 1 &&
                          pageNum <= currentPage + 1)
                      ) {
                        return (
                          <button
                            key={pageNum}
                            className={`pagination-number ${
                              pageNum === currentPage ? "active" : ""
                            }`}
                            onClick={() => handlePageChange(pageNum)}
                          >
                            {pageNum}
                          </button>
                        );
                      } else if (
                        pageNum === currentPage - 2 ||
                        pageNum === currentPage + 2
                      ) {
                        return (
                          <span key={pageNum} className="pagination-ellipsis">
                            ...
                          </span>
                        );
                      }
                      return null;
                    },
                  )}
                </div>

                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  style={{
                    opacity: currentPage === totalPages ? 0.5 : 1,
                    cursor:
                      currentPage === totalPages ? "not-allowed" : "pointer",
                  }}
                >
                  Next &raquo;
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Edit Modal */}
      <BulkPurchaseModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingRecord(null);
        }}
        onSave={handleEditSave}
        products={products}
        currentUser={currentUser}
        isWarehouse={true}
        isEditMode={true}
        initialData={editingRecord}
      />

      {/* Snackbar */}
      {snackbar.open && (
        <div className="nota-belanja-b2b-snackbar">{snackbar.message}</div>
      )}
    </div>
  );
};

export default NotaBelanjaB2B;
