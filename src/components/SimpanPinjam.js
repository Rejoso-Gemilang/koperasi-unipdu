// src/components/SimpanPinjam.js
import React, { useState, useEffect, useMemo } from "react";
import LoanDetailModal from "./LoanDetailModal";
import RejectionModal from "./RejectionModal";
import RevisionModal from "./RevisionModal";
import PaymentProofModal from "./PaymentProofModal";
import RestrukturisasiReviewModal from "./RestrukturisasiReviewModal";
import InstallmentPeriodModal from "./InstallmentPeriodModal";
import useSimpanPinjam from "./hooks/useSimpanPinjam";
import "../styles/SimpanPinjamStyles.css";

/**
 * Calculate fee based on loan amount
 */
function calculateFee(jumlahPinjaman) {
  if (jumlahPinjaman > 8000000) return 500000;
  if (jumlahPinjaman > 6000000) return 400000;
  if (jumlahPinjaman > 4000000) return 300000;
  if (jumlahPinjaman > 2000000) return 200000;
  if (jumlahPinjaman >= 1000000) return 100000;
  return 0;
}

/**
 * Format currency in Indonesian Rupiah
 */
function formatCurrency(amount) {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

const SimpanPinjam = () => {
  const {
    loans,
    filteredLoans,
    loading,
    error,
    success,
    selectedLoan,
    setSelectedLoan,
    revisionAmount,
    setRevisionAmount,
    rejectionReason,
    setRejectionReason,
    revisionTenor,
    setRevisionTenor,
    nameFilter,
    setNameFilter,
    statusFilter,
    setStatusFilter,
    startDateFilter,
    setStartDateFilter,
    endDateFilter,
    setEndDateFilter,
    userRole,
    viewingLoan,
    setViewingLoan,
    handleApprove,
    handleReject,
    handleRejectDirect,
    handleRevise,
    handleReviseDirect,
    handleProgressInstallment,
    handleUploadPaymentProof,
    handleExportToExcel,
    handleUpdateBankDetails,
    handleUpdateUserData,
    fetchLoanById,
    migrateLoansWithNewFields,
    formatDate,
    calculateEndDate,
    isLoanOverdue,
    getStatusBadgeClass,
  } = useSimpanPinjam();

  // State for multi-select status filter
  const [selectedStatuses, setSelectedStatuses] = useState([
    "Menunggu Persetujuan BAK",
    "Menunggu Persetujuan Wakil Rektor 2",
    "Direvisi BAK",
    "Menunggu Transfer BAK",
    "Disetujui dan Aktif",
    "Menunggu Persetujuan Restrukturisasi",
  ]);

  // State for payment proof modal
  const [paymentProofLoan, setPaymentProofLoan] = useState(null);
  const [installmentLoan, setInstallmentLoan] = useState(null);
  const [installmentSubmitting, setInstallmentSubmitting] = useState(false);

  // State for restructuring review modal
  const [reviewingRestruktur, setReviewingRestruktur] = useState(null);

  // State to track if filter is pending
  const [filterPending, setFilterPending] = useState(false);

  // Track if this is the first render
  const [isFirstRender, setIsFirstRender] = useState(true);

  // State for summary section collapsed/expanded
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);

  // Calculate fee summary and money in circulation
  const loanSummary = useMemo(() => {
    if (!loans || loans.length === 0) {
      return {
        feeGroups: [],
        totalFee: 0,
        moneyInCirculation: 0,
        activeLoansCount: 0,
        completedLoansCount: 0,
      };
    }

    // Filter loans with status 'Disetujui dan Aktif' or 'Lunas'
    const relevantLoans = loans.filter(
      (loan) => loan.status === "Disetujui dan Aktif" || loan.status === "Lunas"
    );

    // Define fee groups
    const feeGroupDefinitions = [
      { min: 1000000, max: 2000000, fee: 100000, label: "Rp 1-2 Juta" },
      { min: 2000001, max: 4000000, fee: 200000, label: "Rp 2-4 Juta" },
      { min: 4000001, max: 6000000, fee: 300000, label: "Rp 4-6 Juta" },
      { min: 6000001, max: 8000000, fee: 400000, label: "Rp 6-8 Juta" },
      { min: 8000001, max: 10000000, fee: 500000, label: "Rp 8-10 Juta" },
    ];

    // Initialize fee groups
    const feeGroups = feeGroupDefinitions.map((def) => ({
      ...def,
      count: 0,
      totalFee: 0,
    }));

    let totalFee = 0;
    let moneyInCirculation = 0;
    let totalLoaned = 0; // Total principal loaned (after fee)
    let totalPaid = 0; // Total installments paid
    let activeLoansCount = 0;
    let completedLoansCount = 0;

    relevantLoans.forEach((loan) => {
      const jumlahPinjaman = loan.jumlahPinjaman || 0;
      const fee = calculateFee(jumlahPinjaman);
      const tenor = loan.tenor || 1;
      const jumlahMenyicil = loan.jumlahMenyicil || 0;
      const principalAfterFee = jumlahPinjaman - fee;
      const monthlyPayment = principalAfterFee / tenor;
      const amountPaid = monthlyPayment * jumlahMenyicil;

      // Count by status
      if (loan.status === "Disetujui dan Aktif") {
        activeLoansCount++;
      } else if (loan.status === "Lunas") {
        completedLoansCount++;
      }

      // Add to fee groups
      const groupIndex = feeGroups.findIndex(
        (g) => jumlahPinjaman >= g.min && jumlahPinjaman <= g.max
      );
      if (groupIndex !== -1) {
        feeGroups[groupIndex].count++;
        feeGroups[groupIndex].totalFee += fee;
        totalFee += fee;
      }

      // Calculate totals for all relevant loans (Disetujui dan Aktif OR Lunas)
      totalLoaned += principalAfterFee;
      totalPaid += amountPaid;

      // Calculate money in circulation (only for active loans)
      if (loan.status === "Disetujui dan Aktif") {
        const outstanding = principalAfterFee - amountPaid;
        moneyInCirculation += outstanding;
      }
    });

    return {
      feeGroups: feeGroups.filter((g) => g.count > 0), // Only show groups with loans
      totalFee,
      moneyInCirculation,
      totalLoaned,
      totalPaid,
      activeLoansCount,
      completedLoansCount,
    };
  }, [loans]);

  // Effect to filter loans based on selected statuses with debounce
  useEffect(() => {
    // Apply filter immediately on first render, debounce for subsequent changes
    if (isFirstRender) {
      if (selectedStatuses.length > 0) {
        setStatusFilter(selectedStatuses.join(","));
      } else {
        setStatusFilter("");
      }
      setIsFirstRender(false);
      return;
    }

    // Set pending state to show user that filter will be applied
    setFilterPending(true);

    // Debounce the filter application by 3s
    const debounceTimer = setTimeout(() => {
      // Convert array of selected statuses to a comma-separated string for the filter
      if (selectedStatuses.length > 0) {
        setStatusFilter(selectedStatuses.join(","));
      } else {
        setStatusFilter("");
      }
      setFilterPending(false);
    }, 3000);

    // Cleanup timer on unmount or when selectedStatuses changes
    return () => {
      clearTimeout(debounceTimer);
    };
  }, [selectedStatuses, setStatusFilter, isFirstRender]);

  // Handle checkbox change for status filters
  const handleStatusFilterChange = (status) => {
    if (selectedStatuses.includes(status)) {
      setSelectedStatuses(selectedStatuses.filter((s) => s !== status));
    } else {
      setSelectedStatuses([...selectedStatuses, status]);
    }
  };

  // Select all status filters
  const handleSelectAllStatuses = () => {
    setSelectedStatuses([
      "Menunggu Persetujuan BAK",
      "Menunggu Persetujuan Wakil Rektor 2",
      "Direvisi BAK",
      "Menunggu Transfer BAK",
      "Disetujui dan Aktif",
      "Menunggu Persetujuan Restrukturisasi",
      "Lunas",
      "Ditolak BAK",
      "Ditolak Wakil Rektor 2",
      "Revisi Ditolak Anggota",
      "Direstrukturisasi",
    ]);
  };

  // Clear all status filters
  const handleClearAllStatuses = () => {
    setSelectedStatuses([]);
  };

  if (loading) {
    return (
      <div className="simpan-pinjam-container">
        <h2>Manajemen Pinjaman</h2>
        <div className="loading">Memuat data...</div>
      </div>
    );
  }

  return (
    <div className="simpan-pinjam-container">
      <div className="header-with-actions">
        <h2>Manajemen Pinjaman</h2>
        <button
          className="export-excel-btn"
          onClick={handleExportToExcel}
          title="Ekspor ke Excel"
        >
          <span className="export-icon">📊</span> Ekspor Excel
        </button>
        {/* TEMPORARY: Remove after running migration once */}
        <button
          className="export-excel-btn"
          onClick={migrateLoansWithNewFields}
          title="Migrasi biayaAdmin & sisaHutang"
          style={{ marginLeft: 8, backgroundColor: '#fef3c7', color: '#92400e' }}
        >
          Migrasi Data
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {/* Filter Section */}
      <div className="filter-section">
        <div className="filter-row">
          <div className="filter-group">
            <label>Cari Nama:</label>
            <input
              type="text"
              placeholder="Cari nama peminjam..."
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              className="filter-input"
            />
          </div>

          <div className="filter-group date-filter-group">
            <label>Tanggal:</label>
            <div className="date-inputs">
              <input
                type="date"
                value={startDateFilter}
                onChange={(e) => setStartDateFilter(e.target.value)}
                className="filter-input date-input"
                placeholder="Dari"
              />
              <span className="date-separator">-</span>
              <input
                type="date"
                value={endDateFilter}
                onChange={(e) => setEndDateFilter(e.target.value)}
                className="filter-input date-input"
                placeholder="Sampai"
              />
            </div>
          </div>
        </div>

        {/* Status Filter Checkboxes */}
        <div className="status-filter-section">
          <div className="status-filter-header">
            <label>Status:</label>
            <div className="status-filter-actions">
              {filterPending && (
                <span className="filter-pending-indicator">
                  ⏳ Memproses filter...
                </span>
              )}
              <button
                className="filter-action-btn"
                onClick={handleSelectAllStatuses}
              >
                Pilih Semua
              </button>
              <button
                className="filter-action-btn"
                onClick={handleClearAllStatuses}
              >
                Hapus Semua
              </button>
            </div>
          </div>
          <div className="status-filter-chips">
            <label
              className={`chip ${
                selectedStatuses.includes("Menunggu Persetujuan BAK")
                  ? "active"
                  : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes("Menunggu Persetujuan BAK")}
                onChange={() =>
                  handleStatusFilterChange("Menunggu Persetujuan BAK")
                }
              />
              Menunggu Persetujuan BAK
            </label>
            <label
              className={`chip ${
                selectedStatuses.includes("Menunggu Persetujuan Wakil Rektor 2")
                  ? "active"
                  : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes(
                  "Menunggu Persetujuan Wakil Rektor 2"
                )}
                onChange={() =>
                  handleStatusFilterChange(
                    "Menunggu Persetujuan Wakil Rektor 2"
                  )
                }
              />
              Menunggu Persetujuan Wakil Rektor 2
            </label>
            <label
              className={`chip ${
                selectedStatuses.includes("Menunggu Transfer BAK")
                  ? "active"
                  : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes("Menunggu Transfer BAK")}
                onChange={() =>
                  handleStatusFilterChange("Menunggu Transfer BAK")
                }
              />
              Menunggu Transfer BAK
            </label>
            <label
              className={`chip ${
                selectedStatuses.includes("Disetujui dan Aktif") ? "active" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes("Disetujui dan Aktif")}
                onChange={() => handleStatusFilterChange("Disetujui dan Aktif")}
              />
              Disetujui dan Aktif
            </label>
            <label
              className={`chip ${
                selectedStatuses.includes("Direvisi BAK") ? "active" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes("Direvisi BAK")}
                onChange={() => handleStatusFilterChange("Direvisi BAK")}
              />
              Direvisi BAK
            </label>
            <label
              className={`chip ${
                selectedStatuses.includes("Lunas") ? "active" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes("Lunas")}
                onChange={() => handleStatusFilterChange("Lunas")}
              />
              Lunas
            </label>
            <label
              className={`chip ${
                selectedStatuses.includes("Ditolak BAK") ? "active" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes("Ditolak BAK")}
                onChange={() => handleStatusFilterChange("Ditolak BAK")}
              />
              Ditolak BAK
            </label>
            <label
              className={`chip ${
                selectedStatuses.includes("Ditolak Wakil Rektor 2")
                  ? "active"
                  : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes("Ditolak Wakil Rektor 2")}
                onChange={() =>
                  handleStatusFilterChange("Ditolak Wakil Rektor 2")
                }
              />
              Ditolak Wakil Rektor 2
            </label>
            <label
              className={`chip ${
                selectedStatuses.includes("Revisi Ditolak Anggota")
                  ? "active"
                  : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes("Revisi Ditolak Anggota")}
                onChange={() =>
                  handleStatusFilterChange("Revisi Ditolak Anggota")
                }
              />
              Revisi Ditolak Anggota
            </label>
            <label
              className={`chip ${
                selectedStatuses.includes("Menunggu Persetujuan Restrukturisasi")
                  ? "active"
                  : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes("Menunggu Persetujuan Restrukturisasi")}
                onChange={() =>
                  handleStatusFilterChange("Menunggu Persetujuan Restrukturisasi")
                }
              />
              Menunggu Restrukturisasi
            </label>
            <label
              className={`chip ${
                selectedStatuses.includes("Direstrukturisasi")
                  ? "active"
                  : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedStatuses.includes("Direstrukturisasi")}
                onChange={() =>
                  handleStatusFilterChange("Direstrukturisasi")
                }
              />
              Direstrukturisasi
            </label>
          </div>
        </div>

        <button
          className="filter-reset-btn"
          onClick={() => {
            setNameFilter("");
            setSelectedStatuses([
              "Menunggu Persetujuan BAK",
              "Menunggu Persetujuan Wakil Rektor 2",
              "Direvisi BAK",
              "Menunggu Transfer BAK",
              "Disetujui dan Aktif",
            ]);
            setStartDateFilter("");
            setEndDateFilter("");
          }}
        >
          Reset Filter
        </button>
      </div>

      {/* Loan Summary Section - Collapsible */}
      {(loanSummary.activeLoansCount > 0 ||
        loanSummary.completedLoansCount > 0) && (
        <div
          className={`loan-summary-section ${
            isSummaryExpanded ? "expanded" : ""
          }`}
        >
          <div
            className="loan-summary-header"
            onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
          >
            <span className="loan-summary-title">Ringkasan</span>
            <div className="loan-summary-preview">
              <span className="preview-item">
                <span className="preview-label">
                  Pendapatan dari biaya admin:
                </span>
                <span className="preview-value">
                  {formatCurrency(loanSummary.totalFee)}
                </span>
                {loanSummary.moneyInCirculation > 0 && (
                  <span className="preview-percentage">
                    +
                    {(
                      (loanSummary.totalFee / loanSummary.moneyInCirculation) *
                      100
                    ).toFixed(1)}
                    %
                  </span>
                )}
              </span>
              <span className="preview-divider">|</span>
              <span className="preview-item">
                <span className="preview-label">Uang beredar:</span>
                <span className="preview-value">
                  {formatCurrency(loanSummary.moneyInCirculation)}
                </span>
              </span>
            </div>
            <span
              className={`summary-chevron ${
                isSummaryExpanded ? "expanded" : ""
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M4 6L8 10L12 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>

          {isSummaryExpanded && (
            <div className="loan-summary-body">
              <div className="loan-summary-grid">
                <div className="summary-card summary-card-fee">
                  <div className="summary-card-header">
                    <span className="summary-title">Total Fee Terkumpul</span>
                    <span className="summary-value">
                      {formatCurrency(loanSummary.totalFee)}
                    </span>
                  </div>
                  <div className="summary-meta">
                    {loanSummary.activeLoansCount +
                      loanSummary.completedLoansCount}{" "}
                    pinjaman ({loanSummary.activeLoansCount} aktif,{" "}
                    {loanSummary.completedLoansCount} lunas)
                  </div>
                  {loanSummary.feeGroups.length > 0 && (
                    <div className="fee-breakdown">
                      {loanSummary.feeGroups.map((group, idx) => (
                        <div key={idx} className="fee-group-item">
                          <span className="fee-group-label">{group.label}</span>
                          <span className="fee-group-count">
                            {group.count}x
                          </span>
                          <span className="fee-group-total">
                            {formatCurrency(group.totalFee)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="summary-card summary-card-circulation">
                  <div className="summary-card-header">
                    <span className="summary-title">Uang Beredar</span>
                    <span className="summary-value">
                      {formatCurrency(loanSummary.moneyInCirculation)}
                    </span>
                  </div>
                  <div className="summary-meta">
                    Dari {loanSummary.activeLoansCount} pinjaman aktif
                  </div>
                  <div className="circulation-breakdown">
                    <div className="circulation-item">
                      <span className="circulation-label">
                        Total dipinjamkan
                      </span>
                      <span className="circulation-value">
                        {formatCurrency(loanSummary.totalLoaned)}
                      </span>
                    </div>
                    <div className="circulation-item">
                      <span className="circulation-label">
                        Total sudah dicicil
                      </span>
                      <span className="circulation-value circulation-value-paid">
                        - {formatCurrency(loanSummary.totalPaid)}
                      </span>
                    </div>
                    <div className="circulation-item circulation-item-result">
                      <span className="circulation-label">Sisa beredar</span>
                      <span className="circulation-value">
                        {formatCurrency(loanSummary.moneyInCirculation)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {filteredLoans.length === 0 ? (
        <div className="no-data">Tidak ada data pinjaman</div>
      ) : (
        <div className="table-container">
          <table className="loans-table">
            <thead>
              <tr>
                <th className="th-no">No</th>
                <th>Nama</th>
                <th>Jumlah</th>
                <th>Biaya Admin</th>
                <th>Sisa Pinjaman</th>
                <th>Pembayaran</th>
                <th>Tenor</th>
                <th>Tanggal Pengajuan</th>
                <th>Tanggal Selesai</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredLoans.map((loan, index) => {
                const isOverdue =
                  loan.status === "Disetujui dan Aktif" &&
                  isLoanOverdue(loan.tanggalDisetujui, loan.tenor);

                // Determine if the current user can take actions based on role and loan status
                const canApproveBAK =
                  userRole === "BAK" &&
                  loan.status === "Menunggu Persetujuan BAK";

                const canApproveWR1 =
                  userRole === "Wakil Rektor 2" &&
                  loan.status === "Menunggu Persetujuan Wakil Rektor 2";

                const canUploadProof =
                  userRole === "BAK" && loan.status === "Menunggu Transfer BAK";

                const canProgressInstallment =
                  (loan.status === "Disetujui dan Aktif" ||
                    loan.status === "Menunggu Persetujuan Restrukturisasi") &&
                  (loan.jumlahMenyicil || 0) < (loan.tenor || 0);
                const willPayOff =
                  canProgressInstallment &&
                  (loan.jumlahMenyicil || 0) + 1 >= (loan.tenor || 0);

                const isDirector = userRole === "Direktur" || userRole === "Director";

                return (
                  <tr
                    key={loan.id}
                    onClick={() => setViewingLoan(loan)}
                    className={`clickable-row ${
                      isOverdue ? "overdue-row" : ""
                    }`}
                  >
                    <td className="td-no">{index + 1}</td>
                    <td>{loan.userData?.namaLengkap || "N/A"}</td>
                    <td>
                      Rp {loan.jumlahPinjaman?.toLocaleString("id-ID") || "0"}
                    </td>
                    <td>
                      Rp {(loan.biayaAdmin ?? calculateFee(loan.jumlahPinjaman || 0)).toLocaleString("id-ID")}
                    </td>
                    <td>
                      {loan.sisaHutang != null
                        ? `Rp ${loan.sisaHutang.toLocaleString("id-ID")}`
                        : "-"}
                    </td>
                    <td>
                      {loan.status === "Disetujui dan Aktif" ||
                      loan.status === "Menunggu Persetujuan Restrukturisasi" ||
                      loan.status === "Lunas" ||
                      loan.status === "Direstrukturisasi"
                        ? `${loan.jumlahMenyicil || 0}/${loan.tenor}`
                        : "-"}
                    </td>
                    <td>{loan.tenor} bulan</td>
                    <td>{formatDate(loan.tanggalPengajuan)}</td>
                    <td className={isOverdue ? "overdue-text" : ""}>
                      {loan.tanggalDisetujui
                        ? calculateEndDate(loan.tanggalDisetujui, loan.tenor)
                        : "-"}
                    </td>
                    <td>
                      <span className={getStatusBadgeClass(loan.status)}>
                        {loan.status}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="table-actions">
                        {/* Restructuring Review — replaces individual buttons for restructured loans */}
                        {loan.restructuredFromLoanId &&
                          (loan.status === "Menunggu Persetujuan BAK" ||
                            loan.status === "Menunggu Persetujuan Wakil Rektor 2") && (
                            <button
                              className="revise-btn"
                              onClick={() => setReviewingRestruktur(loan)}
                              title="Tinjau Restrukturisasi"
                            >
                              📋 Tinjau
                            </button>
                          )}

                        {/* BAK Approval Button (non-restructuring only) */}
                        {!loan.restructuredFromLoanId &&
                          (canApproveBAK || isDirector) &&
                          loan.status === "Menunggu Persetujuan BAK" && (
                            <button
                              className="approve-btn"
                              onClick={() =>
                                handleApprove(loan.id, loan.status)
                              }
                              title="Setujui"
                            >
                              ✓ Setujui
                            </button>
                          )}

                        {/* WR1 Approval Button (non-restructuring only) */}
                        {!loan.restructuredFromLoanId &&
                          (canApproveWR1 || isDirector) &&
                          loan.status ===
                            "Menunggu Persetujuan Wakil Rektor 2" && (
                            <button
                              className="approve-btn"
                              onClick={() =>
                                handleApprove(loan.id, loan.status)
                              }
                              title="Setujui"
                            >
                              ✓ Setujui
                            </button>
                          )}

                        {/* Rejection Button (non-restructuring only) */}
                        {!loan.restructuredFromLoanId &&
                          (canApproveBAK || canApproveWR1 || isDirector) &&
                          (loan.status === "Menunggu Persetujuan BAK" ||
                            loan.status ===
                              "Menunggu Persetujuan Wakil Rektor 2") && (
                            <button
                              className="reject-btn"
                              onClick={() =>
                                setSelectedLoan({ ...loan, action: "reject" })
                              }
                              title="Tolak"
                            >
                              ✕ Tolak
                            </button>
                          )}

                        {/* Rejection while waiting for transfer — before any money has
                            moved. Matches the decline Super Admin has in SAKU. Covers
                            restructuring too: handleReject reverts the old loan. */}
                        {(userRole === "BAK" || isDirector) &&
                          loan.status === "Menunggu Transfer BAK" && (
                            <button
                              className="reject-btn"
                              onClick={() =>
                                setSelectedLoan({ ...loan, action: "reject" })
                              }
                              title="Tolak"
                            >
                              ✕ Tolak
                            </button>
                          )}

                        {/* Revision Button (non-restructuring only) */}
                        {!loan.restructuredFromLoanId &&
                          (userRole === "BAK" || isDirector) &&
                          loan.status === "Menunggu Persetujuan BAK" && (
                            <button
                              className="revise-btn"
                              onClick={() =>
                                setSelectedLoan({ ...loan, action: "revise" })
                              }
                              title="Revisi Jumlah"
                            >
                              ⚙ Revisi
                            </button>
                          )}

                        {/* Upload Payment Proof Button */}
                        {canUploadProof && (
                          <button
                            className="upload-btn"
                            onClick={() => setPaymentProofLoan(loan)}
                            title="Upload Bukti Transfer"
                          >
                            📤 Upload
                          </button>
                        )}

                        {/* Period-aware installment button */}
                        {canProgressInstallment && (
                          <button
                            className="payment-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              setInstallmentLoan(loan);
                            }}
                            title={willPayOff ? "Catat cicilan terakhir dan lunaskan" : "Catat cicilan"}
                          >
                            {willPayOff ? "✔ Cicil & Lunaskan" : "💰 Cicil"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Rejection Modal */}
      {selectedLoan && selectedLoan.action === "reject" && (
        <RejectionModal
          loan={selectedLoan}
          onClose={() => setSelectedLoan(null)}
          onReject={handleReject}
          rejectionReason={rejectionReason}
          setRejectionReason={setRejectionReason}
        />
      )}

      {/* Revision Modal */}
      {selectedLoan &&
        selectedLoan.action === "revise" &&
        (userRole === "BAK" || userRole === "Direktur" || userRole === "Director") && (
          <RevisionModal
            loan={selectedLoan}
            onClose={() => setSelectedLoan(null)}
            onRevise={handleRevise}
            revisionAmount={revisionAmount}
            setRevisionAmount={setRevisionAmount}
            revisionTenor={revisionTenor}
            setRevisionTenor={setRevisionTenor}
          />
        )}

      {/* Loan Detail Modal */}
      {viewingLoan && (
        <LoanDetailModal
          loan={viewingLoan}
          onClose={() => setViewingLoan(null)}
          onProgressInstallment={(loan) => setInstallmentLoan(loan)}
          onUpdateBankDetails={handleUpdateBankDetails}
          onUpdateUserData={handleUpdateUserData}
          onViewLoan={async (loanId) => {
            const targetLoan = await fetchLoanById(loanId);
            if (targetLoan) {
              setViewingLoan(targetLoan);
            } else {
              alert(`Pinjaman #${loanId.substring(0, 8)} tidak ditemukan`);
            }
          }}
          userRole={userRole}
        />
      )}

      {installmentLoan && (
        <InstallmentPeriodModal
          loan={installmentLoan}
          submitting={installmentSubmitting}
          onClose={() => {
            if (!installmentSubmitting) setInstallmentLoan(null);
          }}
          onSubmit={async (payrollPeriod) => {
            setInstallmentSubmitting(true);
            try {
              await handleProgressInstallment(installmentLoan.id, payrollPeriod);
              setInstallmentLoan(null);
            } catch (installmentError) {
              console.error("Period-aware installment failed:", installmentError);
            } finally {
              setInstallmentSubmitting(false);
            }
          }}
        />
      )}

      {/* Payment Proof Upload Modal */}
      {paymentProofLoan && (
        <PaymentProofModal
          loan={paymentProofLoan}
          onClose={() => setPaymentProofLoan(null)}
          onUploadProof={handleUploadPaymentProof}
        />
      )}

      {/* Restructuring Review Modal */}
      {reviewingRestruktur && (
        <RestrukturisasiReviewModal
          loan={reviewingRestruktur}
          onClose={() => setReviewingRestruktur(null)}
          onApprove={handleApprove}
          onReject={(loanId, reason) => handleRejectDirect(loanId, reason)}
          onRevise={(loanId, amount, tenor) => handleReviseDirect(loanId, amount, tenor)}
          userRole={userRole}
        />
      )}
    </div>
  );
};

export default SimpanPinjam;
