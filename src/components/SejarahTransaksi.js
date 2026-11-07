import React, { useState, useEffect, useCallback } from "react";
import ReactDatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import * as XLSX from "xlsx";
import "../styles/SejarahTransaksiNew.css";
import { useFirestore } from "../context/FirestoreContext";
import { useEnvironment } from "../context/EnvironmentContext";
import { useAuth } from "../context/AuthContext";
import {
  formatCurrency,
  formatDateShort,
  groupTransactionsByDay,
  groupTransactionsByItem,
  sortItems,
  filterItemsBySearch,
  getInitialDateRange,
} from "../services/transactionHistoryService";
import { getSaleCost } from "../utils/profitUtils";
import { printReceipt } from "../services/PrinterService";
import { canUserDeleteTransaction } from "../services/transactionRevertService";
import DeleteTransactionModal from "./DeleteTransactionModal";
import DayBreakdownDialog from "./DayBreakdownDialog";
import ItemDetailDialog from "./ItemDetailDialog";

// Tab configuration - clean, no emojis
const TABS = [
  { id: "Transactions", label: "Per Transaksi" },
  { id: "Items", label: "Per Item" },
];

const createStockLookup = (stocks) =>
  (stocks || []).reduce((lookup, stock) => {
    lookup[stock.id] = stock;
    if (stock.itemId) lookup[stock.itemId] = stock;
    return lookup;
  }, {});

// A loss is shown, in red, rather than hidden, so the line causing a negative
// day total can be found.
const lossClass = (amount) => (Math.round(amount) < 0 ? " st-loss" : "");

const SejarahTransaksi = () => {
  const { queryCollection, query, where, orderBy } = useFirestore();
  const { isProduction, environment } = useEnvironment();
  const { currentUser, userRole } = useAuth();

  const showProfit = userRole === "Wakil Rektor 2";
  const isAdmin = userRole === "Admin" || userRole === "admin";
  const canDelete = canUserDeleteTransaction(userRole);

  // Tab selection
  const [selectedTab, setSelectedTab] = useState("Transactions");
  const [expandedTransactions, setExpandedTransactions] = useState({});
  const [expandedDates, setExpandedDates] = useState({});
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState(null);

  const toggleTransaction = (txId) => {
    setExpandedTransactions((prev) => ({
      ...prev,
      [txId]: !prev[txId],
    }));
  };

  const toggleDate = (dateKey) => {
    setExpandedDates((prev) => ({
      ...prev,
      [dateKey]: !prev[dateKey],
    }));
  };

  // Date range
  const initialRange = getInitialDateRange(7);
  const [dateRange, setDateRange] = useState(initialRange);
  const [tempStart, setTempStart] = useState(initialRange.start);
  const [tempEnd, setTempEnd] = useState(initialRange.end);

  // Data states
  const [dailyData, setDailyData] = useState([]);
  const [itemsData, setItemsData] = useState([]);
  const [filteredItemsData, setFilteredItemsData] = useState([]);
  const [stockTransactions, setStockTransactions] = useState([]);
  const [stockDataById, setStockDataById] = useState({});

  // UI states
  const [loading, setLoading] = useState(false);
  const [daysLoaded, setDaysLoaded] = useState(7);
  const [allDataLoaded, setAllDataLoaded] = useState(false);
  const [itemSearchTerm, setItemSearchTerm] = useState("");
  const [itemSortConfig, setItemSortConfig] = useState({
    key: "revenue",
    direction: "desc",
  });
  const [snackbar, setSnackbar] = useState({ open: false, message: "" });

  // Dialog states
  const [dayDialogOpen, setDayDialogOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [itemTransactions, setItemTransactions] = useState([]);

  const findMatchingStockTransaction = (tx, item) => {
    if (!item?.itemId) return null;

    const linkedTransaction = tx.id
      ? stockTransactions.find(
          (stockTx) =>
            stockTx.transactionId === tx.id && stockTx.itemId === item.itemId
        )
      : null;
    if (linkedTransaction) return linkedTransaction;

    const txSeconds = tx.timestamp?.seconds;
    return stockTransactions.find((stockTx) => {
      const stockTxSeconds =
        stockTx.timestampInMillisEpoch?.seconds || stockTx.timestamp?.seconds;
      return (
        stockTxSeconds &&
        txSeconds &&
        Math.abs(stockTxSeconds - txSeconds) <= 2 &&
        stockTx.itemId === item.itemId
      );
    });
  };

  const getItemCost = (tx, item) => {
    const matchingStockTx = findMatchingStockTransaction(tx, item);
    const saleRecord = matchingStockTx || item;
    const fallbackQuantity = matchingStockTx?.quantity ?? item.quantity ?? 0;

    return getSaleCost(
      saleRecord,
      stockDataById[item.itemId] || {},
      fallbackQuantity
    );
  };

  // Fetch daily transactions from transactionDetail collection
  const fetchDailyTransactions = useCallback(async () => {
    setLoading(true);
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(now.getDate() - daysLoaded);

    try {
      const actualPath = isProduction
        ? "transactionDetail"
        : "transactionDetail_testing";
      console.log(`Querying from collection: ${actualPath}`);

      const transactions = await queryCollection(
        "transactionDetail",
        (collectionRef) =>
          query(
            collectionRef,
            where("timestamp", ">=", cutoff),
            orderBy("timestamp", "desc")
          )
      );

      console.log(
        `Fetched ${transactions.length} transactions from ${environment} environment`
      );

      const grouped = groupTransactionsByDay(transactions);

      if (dailyData.length === grouped.length && daysLoaded > 14) {
        setAllDataLoaded(true);
        setSnackbar({ open: true, message: "Seluruh data sudah ditampilkan" });
      } else {
        setAllDataLoaded(false);
      }

      setDailyData(grouped);

      // Fetch stockTransactions for matching cost/profit if user is admin
      if (showProfit) {
        console.log("Fetching stock transactions for profit matching...");
        const [stockTxs, stocks] = await Promise.all([
          queryCollection(
            "stockTransactions",
            (collectionRef) =>
              query(
                collectionRef,
                where("transactionType", "==", "penjualan"),
                where("timestampInMillisEpoch", ">=", cutoff),
                orderBy("timestampInMillisEpoch", "desc")
              )
          ),
          queryCollection("stocks"),
        ]);
        console.log(`Fetched ${stockTxs.length} stock transactions for profit matching`);
        setStockTransactions(stockTxs);
        setStockDataById(createStockLookup(stocks));
      } else {
        setStockTransactions([]);
        setStockDataById({});
      }
    } catch (err) {
      console.error("Error fetching daily transactions:", err);
    } finally {
      setLoading(false);
    }
  }, [
    daysLoaded,
    isProduction,
    queryCollection,
    query,
    where,
    orderBy,
    environment,
    dailyData.length,
    showProfit,
  ]);

  // Fetch items transactions from stockTransactions collection
  const fetchItemsTransactions = useCallback(async () => {
    setLoading(true);
    const endDatePlusOne = new Date(dateRange.end);
    endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);

    try {
      const actualPath = isProduction
        ? "stockTransactions"
        : "stockTransactions_testing";
      console.log(`Querying penjualan from: ${actualPath}`);

      const transactionsQuery = queryCollection(
        "stockTransactions",
        (collectionRef) =>
          query(
            collectionRef,
            where("transactionType", "==", "penjualan"),
            where("timestampInMillisEpoch", ">=", dateRange.start),
            where("timestampInMillisEpoch", "<=", endDatePlusOne),
            orderBy("timestampInMillisEpoch", "desc")
          )
      );
      const [transactions, stocks] = await Promise.all([
        transactionsQuery,
        showProfit ? queryCollection("stocks") : Promise.resolve([]),
      ]);
      const stockLookup = createStockLookup(stocks);
      setStockDataById(stockLookup);

      const transactionsWithResolvedCost = showProfit
        ? transactions.map((tx) => ({
            ...tx,
            stockWorth: getSaleCost(
              tx,
              stockLookup[tx.itemId] || {},
              tx.quantity || 0
            ),
          }))
        : transactions;

      console.log(`Fetched ${transactions.length} penjualan transactions`);

      const grouped = groupTransactionsByItem(
        transactionsWithResolvedCost,
        stockLookup
      );
      const sorted = sortItems(
        grouped,
        itemSortConfig.key,
        itemSortConfig.direction
      );

      setItemsData(sorted);
      setFilteredItemsData(sorted);
    } catch (err) {
      console.error("Error fetching items transactions:", err);
    } finally {
      setLoading(false);
    }
  }, [
    dateRange,
    isProduction,
    queryCollection,
    query,
    where,
    orderBy,
    itemSortConfig,
    showProfit,
  ]);

  // Effects
  useEffect(() => {
    if (selectedTab === "Daily" || selectedTab === "Transactions") {
      fetchDailyTransactions();
    }
  }, [selectedTab, daysLoaded, isProduction]);

  useEffect(() => {
    if (selectedTab === "Items") {
      fetchItemsTransactions();
    }
  }, [selectedTab, dateRange, isProduction]);

  // Handlers
  const applyDateFilter = () => {
    if (!tempStart || !tempEnd) {
      alert("Please pick valid dates");
      return;
    }
    if (tempStart > tempEnd) {
      alert("Start date cannot exceed end date");
      return;
    }
    setDateRange({ start: tempStart, end: tempEnd });
  };

  const handleShowMore = () => {
    setDaysLoaded((prev) => prev + 14);
  };

  const handleItemSearch = (e) => {
    const term = e.target.value;
    setItemSearchTerm(term);
    setFilteredItemsData(filterItemsBySearch(itemsData, term));
  };

  const requestItemSort = (key) => {
    const direction =
      itemSortConfig.key === key && itemSortConfig.direction === "desc"
        ? "asc"
        : "desc";
    setItemSortConfig({ key, direction });
    setFilteredItemsData(sortItems(filteredItemsData, key, direction));
  };

  const openDayDialog = (dayGroup) => {
    setSelectedDay(dayGroup);
    setDayDialogOpen(true);
  };

  const closeDayDialog = () => {
    setDayDialogOpen(false);
    setSelectedDay(null);
  };

  const openItemDialog = (item) => {
    setSelectedItem(item);
    setItemTransactions(
      item.transactions.sort(
        (a, b) =>
          b.timestampInMillisEpoch.toDate() - a.timestampInMillisEpoch.toDate()
      )
    );
    setItemDialogOpen(true);
  };

  const closeItemDialog = () => {
    setItemDialogOpen(false);
    setSelectedItem(null);
    setItemTransactions([]);
  };

  // Reprint a previous receipt (admin only)
  const handleReprintReceipt = (tx) => {
    const txDate = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date(tx.timestamp);
    const dateTimeStr = txDate.toLocaleString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const mName = tx.memberName || tx.namaAnggota || tx.nama || null;
    const mNo = tx.nomorAnggota || null;

    const receiptData = {
      info: {
        transactionId: tx.id || "-",
        dateTime: dateTimeStr,
        memberName: mName,
        nomorAnggota: mNo,
      },
      memberName: mName,
      nomorAnggota: mNo,
      items: (tx.items || []).map((item) => ({
        name: item.itemName || item.name || "-",
        quantity: item.quantity || 0,
        unit: item.unit || "pcs",
        price: item.price || (item.quantity > 0 ? item.subtotal / item.quantity : 0),
        subtotal: item.subtotal || 0,
      })),
      summary: {
        total: tx.total || 0,
        amountPaid: tx.amountPaid || tx.tunai || tx.total || 0,
        change: tx.change || tx.kembali || 0,
        paymentMethod: tx.paymentMethod || (tx.isPaidViaQris ? "qris" : "cash"),
        qrisAmount: tx.qrisAmount !== undefined ? tx.qrisAmount : (tx.isPaidViaQris ? (tx.discountedTotal ?? tx.total) : 0),
        cashAmount: tx.cashAmount !== undefined ? tx.cashAmount : (!tx.isPaidViaQris ? (tx.discountedTotal ?? tx.total) : 0),
      },
      paymentMethod: tx.paymentMethod || (tx.isPaidViaQris ? "qris" : "cash"),
      qrisAmount: tx.qrisAmount !== undefined ? tx.qrisAmount : (tx.isPaidViaQris ? (tx.discountedTotal ?? tx.total) : 0),
      cashAmount: tx.cashAmount !== undefined ? tx.cashAmount : (!tx.isPaidViaQris ? (tx.discountedTotal ?? tx.total) : 0),
      appliedVoucher: tx.voucherId
        ? {
            name: tx.voucherName || tx.voucherId,
            isOneTimeUse: true,
          }
        : null,
    };

    printReceipt(receiptData);
  };

  const handleDeleteSuccess = (result) => {
    const deletedId = result.transactionId;
    setSnackbar({
      open: true,
      message: `Transaksi ${deletedId} berhasil dihapus dan seluruh data telah dikembalikan seperti semula.`,
    });

    // Update local dailyData immediately
    setDailyData((prevDays) =>
      prevDays
        .map((day) => {
          const updatedTxs = (day.transactions || []).filter(
            (t) => t.id !== deletedId
          );
          const newTotal = updatedTxs.reduce(
            (sum, t) => sum + (Number(t.total) || 0),
            0
          );
          return {
            ...day,
            transactions: updatedTxs,
            total: newTotal,
            count: updatedTxs.length,
          };
        })
        .filter((day) => day.transactions.length > 0)
    );

    // Refresh transactions
    fetchDailyTransactions();
    if (selectedTab === "Items") {
      fetchItemsTransactions();
    }
  };

  // Export to XLSX
  const handleExportXLSX = () => {
    const exportData = [];
    exportData.push(["Sejarah Transaksi Export"]);
    exportData.push([
      "Date Range:",
      `${formatDateShort(dateRange.start)} - ${formatDateShort(dateRange.end)}`,
    ]);
    exportData.push(["View:", selectedTab]);
    exportData.push([]);

    if (selectedTab === "Daily") {
      filteredDailyData.forEach((day) => {
        exportData.push(["Date", day.formattedDate, "Total", day.total]);
        exportData.push(["Item Name", "Quantity", "Unit", "Subtotal"]);
        day.breakdown.forEach((item) => {
          exportData.push([
            item.itemName,
            item.quantity,
            item.unit,
            item.subtotal,
          ]);
        });
        exportData.push([]);
      });
    } else if (selectedTab === "Items") {
      exportData.push([
        "Item Name",
        "Category",
        "Subcategory",
        "Quantity",
        "Unit",
        "Revenue",
        "Cost",
        "Profit",
      ]);
      filteredItemsData.forEach((item) => {
        exportData.push([
          item.itemName || "N/A",
          item.kategori || "N/A",
          item.subKategori || "N/A",
          Math.round(item.quantity),
          item.unit || "N/A",
          Math.round(item.revenue),
          Math.round(item.stockWorth),
          Math.round(item.profitMargin),
        ]);
      });
    } else if (selectedTab === "Transactions") {
      const headers = [
        "ID Transaksi",
        "Tanggal",
        "Waktu",
        "Tipe Pembeli",
        "Nama Pembeli",
        "Nomor Anggota",
        "Voucher",
        "Diskon",
        "Total",
      ];
      if (showProfit) {
        headers.push("Modal", "Keuntungan");
      }
      headers.push("Items");
      exportData.push(headers);

      filteredDailyData.forEach((day) => {
        day.transactions?.forEach((tx) => {
          const txDate = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date(tx.timestamp);
          const timeStr = txDate.toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
          });
          const buyerType = tx.isMember ? "Anggota" : tx.voucherId ? "Voucher Only" : "Non-Anggota";
          const itemsStr = tx.items
            ?.map((item) => `${item.itemName} (${item.quantity} ${item.unit})`)
            .join(", ");

          let txTotalCost = 0;
          if (showProfit) {
            tx.items?.forEach((item) => {
              txTotalCost += getItemCost(tx, item);
            });
          }
          const txTotalProfit = tx.total - txTotalCost;

          const row = [
            tx.id || "-",
            day.formattedDate,
            timeStr,
            buyerType,
            tx.memberName || "-",
            tx.nomorAnggota || "-",
            tx.voucherName || "-",
            tx.voucherDiscount || 0,
            tx.total || 0,
          ];
          if (showProfit) {
            row.push(txTotalCost, txTotalProfit);
          }
          row.push(itemsStr || "-");
          exportData.push(row);
        });
      });
    }

    const ws = XLSX.utils.aoa_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transaksi");
    XLSX.writeFile(wb, `SejarahTransaksi_${selectedTab}.xlsx`);
  };

  // Filter data by date range
  const filteredDailyData = dailyData.filter(
    (day) => day.date >= dateRange.start && day.date <= dateRange.end
  );

  // Calculate summary stats for items
  const itemSummary = (() => {
    if (selectedTab !== "Items" || filteredItemsData.length === 0) {
      return { totalUnique: 0, totalVolume: 0, totalRevenue: 0, totalProfit: 0, avgMargin: 0 };
    }
    const totalUnique = filteredItemsData.length;
    const totalVolume = filteredItemsData.reduce((acc, item) => acc + (item.quantity || 0), 0);
    const totalRevenue = filteredItemsData.reduce((acc, item) => acc + (item.revenue || 0), 0);
    const totalProfit = filteredItemsData.reduce((acc, item) => acc + (item.profitMargin || 0), 0);
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    return { totalUnique, totalVolume, totalRevenue, totalProfit, avgMargin };
  })();

  return (
    <div className="st-container">
      <h1>Sejarah Transaksi</h1>

      {/* Tab Selector */}
      <div className="st-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`st-tab ${selectedTab === tab.id ? "active" : ""}`}
            onClick={() => setSelectedTab(tab.id)}
          >
            <span className="st-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Controls Bar */}
      {(selectedTab === "Daily" || selectedTab === "Items" || selectedTab === "Transactions") && (
        <div className="st-controls">
          <span className="st-controls-label">Rentang Tanggal:</span>
          <div className="st-date-filter">
            <ReactDatePicker
              selected={tempStart}
              onChange={(date) => setTempStart(date)}
              selectsStart
              startDate={tempStart}
              endDate={tempEnd}
              dateFormat="dd/MM/yyyy"
              placeholderText="Start"
            />
            <ReactDatePicker
              selected={tempEnd}
              onChange={(date) => setTempEnd(date)}
              selectsEnd
              startDate={tempStart}
              endDate={tempEnd}
              minDate={tempStart}
              dateFormat="dd/MM/yyyy"
              placeholderText="End"
            />
            <button className="st-btn st-btn-primary" onClick={applyDateFilter}>
              Filter
            </button>
          </div>
          <button className="st-btn st-btn-export" onClick={handleExportXLSX}>
            Export ke Excel
          </button>
        </div>
      )}

      {/* Daily View */}
      {selectedTab === "Daily" && (
        <>
          {loading ? (
            <div className="st-loading">
              <p>Memuat data...</p>
            </div>
          ) : filteredDailyData.length === 0 ? (
            <div className="st-empty">
              Tidak ada transaksi dalam periode ini.
            </div>
          ) : (
            <div className="st-daily-list">
              {filteredDailyData.map((dayGroup) => (
                <div
                  key={dayGroup.key}
                  className="st-day-card"
                  onClick={() => openDayDialog(dayGroup)}
                >
                  <span className="st-day-date">{dayGroup.formattedDate}</span>
                  <span className="st-day-total">
                    {formatCurrency(dayGroup.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={handleShowMore}
            disabled={allDataLoaded}
            className="st-show-more"
          >
            {allDataLoaded ? "Semua Data Ditampilkan" : "Tampilkan Lebih"}
          </button>
        </>
      )}

      {/* Items View */}
      {selectedTab === "Items" && (
        <>
          <div className="st-search">
            <input
              type="text"
              placeholder="Cari item berdasarkan nama, ID, kategori..."
              value={itemSearchTerm}
              onChange={handleItemSearch}
            />
            <span className="st-search-count">
              {filteredItemsData.length} item
            </span>
          </div>

          {!loading && filteredItemsData.length > 0 && (
            <div className="st-summary-cards">
              <div className="st-summary-card">
                <span className="st-summary-card-label">Volume Penjualan</span>
                <span className="st-summary-card-value">
                  {Math.round(itemSummary.totalVolume)} Unit
                </span>
                <span className="st-summary-card-sublabel">
                  Dari {itemSummary.totalUnique} jenis item
                </span>
              </div>
              <div className="st-summary-card">
                <span className="st-summary-card-label">Total Pendapatan</span>
                <span className="st-summary-card-value">
                  {formatCurrency(itemSummary.totalRevenue)}
                </span>
                <span className="st-summary-card-sublabel">
                  Kotor (omset)
                </span>
              </div>
              {showProfit && (
                <>
                  <div className="st-summary-card">
                    <span className="st-summary-card-label">Total Keuntungan</span>
                    <span className={`st-summary-card-value st-profit-value${lossClass(itemSummary.totalProfit)}`}>
                      {formatCurrency(itemSummary.totalProfit)}
                    </span>
                    <span className="st-summary-card-sublabel">
                      Bersih (margin)
                    </span>
                  </div>
                  <div className="st-summary-card">
                    <span className="st-summary-card-label">Rata-rata Margin</span>
                    <span className="st-summary-card-value">
                      {itemSummary.avgMargin.toFixed(1)}%
                    </span>
                    <span className="st-summary-card-sublabel">
                      Profitabilitas
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {loading ? (
            <div className="st-loading">
              <p>Memuat data item...</p>
            </div>
          ) : filteredItemsData.length === 0 ? (
            <div className="st-empty">
              Tidak ada transaksi dalam periode ini.
            </div>
          ) : (
            <div className="st-table-container">
              <table className="st-table">
                <thead>
                  <tr>
                    <th
                      className={`sortable ${
                        itemSortConfig.key === "itemName"
                          ? `sorted-${itemSortConfig.direction}`
                          : ""
                      }`}
                      onClick={() => requestItemSort("itemName")}
                    >
                      Nama Item
                    </th>
                    <th
                      className={`sortable ${
                        itemSortConfig.key === "kategori"
                          ? `sorted-${itemSortConfig.direction}`
                          : ""
                      }`}
                      onClick={() => requestItemSort("kategori")}
                    >
                      Kategori
                    </th>
                    <th
                      className={`sortable center ${
                        itemSortConfig.key === "quantity"
                          ? `sorted-${itemSortConfig.direction}`
                          : ""
                      }`}
                      onClick={() => requestItemSort("quantity")}
                    >
                      Qty
                    </th>
                    <th className="center">Unit</th>
                    <th
                      className={`sortable right ${
                        itemSortConfig.key === "revenue"
                          ? `sorted-${itemSortConfig.direction}`
                          : ""
                      }`}
                      onClick={() => requestItemSort("revenue")}
                    >
                      Pendapatan
                    </th>
                    {showProfit && (
                      <>
                        <th
                          className={`sortable right ${
                            itemSortConfig.key === "stockWorth"
                              ? `sorted-${itemSortConfig.direction}`
                              : ""
                          }`}
                          onClick={() => requestItemSort("stockWorth")}
                        >
                          Modal
                        </th>
                        <th
                          className={`sortable right ${
                            itemSortConfig.key === "profitMargin"
                              ? `sorted-${itemSortConfig.direction}`
                              : ""
                          }`}
                          onClick={() => requestItemSort("profitMargin")}
                        >
                          Profit
                        </th>
                      </>
                    )}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItemsData.map((item, index) => {
                    const categoryClass = item.kategori
                      ? `st-cat-${item.kategori.toLowerCase().replace(/\s+/g, "-")}`
                      : "st-cat-default";

                    return (
                      <tr
                        key={`item-${index}`}
                        onClick={() => openItemDialog(item)}
                      >
                        <td>
                          <span className="st-item-title">{item.itemName || "N/A"}</span>
                        </td>
                        <td>
                          <span className={`st-category-badge ${categoryClass}`}>
                            {item.kategori || "N/A"}
                          </span>
                        </td>
                        <td className="center">
                          <span className="st-qty-value">{Math.round(item.quantity)}</span>
                        </td>
                        <td className="center">
                          <span className="st-qty-unit">{item.unit || "N/A"}</span>
                        </td>
                        <td className="right">{formatCurrency(item.revenue)}</td>
                        {showProfit && (
                          <>
                            <td className="right">
                              {formatCurrency(item.stockWorth)}
                            </td>
                            <td className="right">
                              <span className={`st-profit-value${lossClass(item.profitMargin)}`}>
                                {formatCurrency(item.profitMargin)}
                              </span>
                            </td>
                          </>
                        )}
                        <td className="right">
                          <div className="st-item-chevron">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                              <path
                                d="M6 12L10 8L6 4"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Transactions (Per Transaksi) View */}
      {selectedTab === "Transactions" && (
        <>
          {loading ? (
            <div className="st-loading">
              <p>Memuat data transaksi...</p>
            </div>
          ) : filteredDailyData.length === 0 ? (
            <div className="st-empty">
              Tidak ada transaksi dalam periode ini.
            </div>
          ) : (
            <div className="st-transactions-list">
              {filteredDailyData.map((dayGroup, dayGroupIdx) => {
                const isDateExpanded = !!expandedDates[dayGroup.key];

                // Calculate daily profit
                let dayTotalProfit = 0;
                if (showProfit && dayGroup.transactions) {
                  dayGroup.transactions.forEach((tx) => {
                    let txProfit = 0;
                    tx.items?.forEach((item) => {
                      const cost = getItemCost(tx, item);
                      txProfit += (item.subtotal - cost);
                    });
                    dayTotalProfit += txProfit;
                  });
                }

                return (
                  <div key={dayGroup.key} className="st-day-section">
                    <div
                      className="st-day-section-header"
                      onClick={() => toggleDate(dayGroup.key)}
                    >
                      <div className="st-day-section-left">
                        <span className={`st-day-section-chevron ${isDateExpanded ? "expanded" : ""}`}>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path
                              d="M4 6L8 10L12 6"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                        <span className="st-day-section-date">{dayGroup.formattedDate}</span>
                      </div>
                      <span className="st-day-section-total">
                        Total: {formatCurrency(dayGroup.total)}
                        {showProfit && (
                          <span className={`st-day-section-profit${lossClass(dayTotalProfit)}`}>
                            {" | Untung: "}{formatCurrency(dayTotalProfit)}
                          </span>
                        )}
                      </span>
                    </div>
                    {isDateExpanded && (
                      <div className="st-day-transactions">
                        {dayGroup.transactions?.map((tx, txIdx) => {
                          const txId = tx.id || `tx-${dayGroup.key}-${txIdx}`;
                          const isExpanded = !!expandedTransactions[txId];
                          const txDate = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date(tx.timestamp);
                          const timeStr = txDate.toLocaleTimeString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit",
                          });

                          // Calculate profit if admin
                          let txTotalProfit = 0;
                          const txItemsWithProfit = tx.items?.map((item) => {
                            const cost = showProfit ? getItemCost(tx, item) : 0;
                            const profit = item.subtotal - cost;
                            txTotalProfit += profit;
                            return { ...item, cost, profit };
                          });

                          return (
                            <div key={txId} className={`st-tx-card ${isExpanded ? "expanded" : ""}`}>
                              <div
                                className="st-tx-header"
                                onClick={() => toggleTransaction(txId)}
                              >
                                <div className="st-tx-left">
                              <span className="st-tx-time">{timeStr}</span>
                                  <div className="st-tx-buyer-info">
                                    <span className="st-tx-buyer-name">
                                      {tx.memberName || "Non-Anggota"}
                                    </span>
                                    {tx.isMember && (
                                      <span className="st-tx-badge st-tx-badge-member">
                                        Anggota ({tx.nomorAnggota})
                                      </span>
                                    )}
                                    {tx.paymentMethod === "split" ? (
                                      <span className="st-tx-badge st-tx-badge-voucher" title={`QRIS: ${formatCurrency(tx.qrisAmount || 0)} | Cash: ${formatCurrency(tx.cashAmount || 0)}`}>
                                        💳 Split
                                      </span>
                                    ) : (tx.isPaidViaQris || tx.paymentMethod === "qris") ? (
                                      <span className="st-tx-badge st-tx-badge-voucher">
                                        📱 QRIS
                                      </span>
                                    ) : tx.paymentMethod === "kredit" ? (
                                      <span className="st-tx-badge st-tx-badge-voucher">
                                        🎫 Kredit
                                      </span>
                                    ) : (
                                      <span className="st-tx-badge st-tx-badge-member">
                                        💵 Cash
                                      </span>
                                    )}
                                    {tx.voucherId && (
                                      <span className="st-tx-badge st-tx-badge-voucher" title={tx.voucherName}>
                                        🎫 Voucher
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="st-tx-right">
                                  {showProfit && Math.round(txTotalProfit) !== 0 && (
                                    <span className={`st-tx-header-profit${lossClass(txTotalProfit)}`}>
                                      Untung: {formatCurrency(txTotalProfit)}
                                    </span>
                                  )}
                                  <span className="st-tx-total">{formatCurrency(tx.total)}</span>
                                  <span className={`st-tx-chevron ${isExpanded ? "expanded" : ""}`}>
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                      <path
                                        d="M4 6L8 10L12 6"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </span>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="st-tx-details">
                                  <div className="st-tx-items-list">
                                    {txItemsWithProfit?.map((item, itemIdx) => (
                                      <div key={itemIdx} className="st-tx-item-row">
                                        <span className="st-tx-item-name">
                                          {item.itemName}
                                          {showProfit && Math.round(item.profit) !== 0 && (
                                            <span className={`st-tx-item-profit-badge${lossClass(item.profit)}`}>
                                              (Untung: {formatCurrency(item.profit)})
                                            </span>
                                          )}
                                        </span>
                                        <span className="st-tx-item-qty">
                                          {item.quantity} {item.unit}
                                        </span>
                                        <span className="st-tx-item-subtotal">
                                          {formatCurrency(item.subtotal)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                  {tx.voucherId && (
                                    <div className="st-tx-voucher-row">
                                      <span className="st-tx-voucher-label">
                                        Voucher: {tx.voucherName}
                                      </span>
                                      <span className="st-tx-voucher-discount">
                                        -{formatCurrency(tx.voucherDiscount)}
                                      </span>
                                    </div>
                                  )}
                                  {(isAdmin || canDelete) && (
                                    <div className="st-tx-actions-row">
                                      {isAdmin && (
                                        <button
                                          className="st-btn-reprint"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleReprintReceipt(tx);
                                          }}
                                        >
                                          🖨️ Cetak Ulang Struk
                                        </button>
                                      )}
                                      {canDelete && (
                                        <button
                                          className="st-btn-delete-tx"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setTransactionToDelete(tx);
                                            setDeleteModalOpen(true);
                                          }}
                                        >
                                          🗑️ Hapus Transaksi
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button
            onClick={handleShowMore}
            disabled={allDataLoaded}
            className="st-show-more"
          >
            {allDataLoaded ? "Semua Data Ditampilkan" : "Tampilkan Lebih"}
          </button>
        </>
      )}

      {/* Day Breakdown Dialog - includes Per Item and Per Pembeli views */}
      <DayBreakdownDialog
        isOpen={dayDialogOpen}
        onClose={closeDayDialog}
        dayData={selectedDay}
      />

      {/* Item Detail Dialog */}
      <ItemDetailDialog
        isOpen={itemDialogOpen}
        onClose={closeItemDialog}
        item={selectedItem}
        transactions={itemTransactions}
        showProfit={showProfit}
      />

      {/* Delete Transaction Modal */}
      <DeleteTransactionModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setTransactionToDelete(null);
        }}
        transaction={transactionToDelete}
        onSuccess={handleDeleteSuccess}
        currentUser={currentUser}
        userRole={userRole}
        isProduction={isProduction}
      />

      {/* Snackbar */}
      {snackbar.open && (
        <div className="st-snackbar">
          {snackbar.message}
          <button onClick={() => setSnackbar({ ...snackbar, open: false })}>
            ×
          </button>
        </div>
      )}
    </div>
  );
};

export default SejarahTransaksi;
