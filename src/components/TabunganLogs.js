import React, { useState, useEffect } from "react";
import { db, functions, getEnvironmentCollectionPath } from "../firebase";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  getDocs,
  orderBy,
  query,
  doc,
  deleteDoc,
  updateDoc,
  where,
  serverTimestamp,
  getDoc,
} from "firebase/firestore";
import { useEnvironment } from "../context/EnvironmentContext";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import "../styles/TabunganLogs.css";

const TabunganLogs = () => {
  const { isProduction } = useEnvironment();
  const tlPath = getEnvironmentCollectionPath("tabunganLogs", isProduction);
  const tlpuPath = getEnvironmentCollectionPath("tabunganLogsPerUser", isProduction);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showTriggerModal, setShowTriggerModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [resetConfirmationText, setResetConfirmationText] = useState("");
  const [progressModal, setProgressModal] = useState({
    isVisible: false,
    type: "", // "trigger", "rollback", or "reset"
    progress: 0,
    total: 0,
    currentUser: "",
    status: "",
  });

  useEffect(() => {
    fetchTabunganLogs();
  }, []);

  const fetchTabunganLogs = async () => {
    try {
      setLoading(true);
      const logsQuery = query(
        collection(db, tlPath),
        orderBy("timestamp", "desc")
      );
      const querySnapshot = await getDocs(logsQuery);

      const logsData = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setLogs(logsData);
      setError(null);
    } catch (err) {
      console.error("Error fetching tabungan logs:", err);
      setError("Gagal memuat data log tabungan");
    } finally {
      setLoading(false);
    }
  };

  const formatIndonesianDate = (dateString) => {
    const [year, month, day] = dateString.split("-");
    const monthNames = [
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

    return `${parseInt(day)} ${monthNames[parseInt(month) - 1]} ${year}`;
  };

  const manualTriggerIncrement = async () => {
    setProgressModal({ isVisible: true, type: "trigger", progress: 0, total: 1, currentUser: "Memproses anggota...", status: "Memproses..." });
    try {
      const result = await httpsCallable(functions, "triggerLegacySavings", { timeout: 300000 })();
      setProgressModal(previous => ({ ...previous, progress: 1, status: `${result.data.processedCount} anggota diproses; ${result.data.skippedCount} mengikuti payroll.` }));
      await fetchTabunganLogs();
    } catch (error) {
      setProgressModal(previous => ({ ...previous, status: error.message || "Tabungan belum dapat diproses." }));
    }
  };

  const handleTriggerConfirm = () => {
    if (confirmationText === "Saya mengerti") {
      setShowTriggerModal(false);
      setConfirmationText("");
      manualTriggerIncrement();
    } else {
      alert('Harap ketik "Saya mengerti" dengan tepat untuk melanjutkan.');
    }
  };

  const resetAllNominalTabungan = async () => {
    try {
      setProgressModal({
        isVisible: true,
        type: "reset",
        progress: 0,
        total: 0,
        currentUser: "Mengambil data anggota...",
        status: "Memproses...",
      });

      // Get all members with nominalTabungan field
      const usersQuery = query(
        collection(db, "users"),
        where("role", "==", "Member")
      );
      const querySnapshot = await getDocs(usersQuery);

      if (querySnapshot.empty) {
        setProgressModal((prev) => ({ ...prev, isVisible: false }));
        alert("Tidak ada anggota yang ditemukan");
        return;
      }

      // Filter members who have nominalTabungan field
      const membersWithTabungan = querySnapshot.docs.filter(
        (doc) => doc.data().nominalTabungan !== undefined
      );

      if (membersWithTabungan.length === 0) {
        setProgressModal((prev) => ({ ...prev, isVisible: false }));
        alert("Tidak ada anggota dengan nominalTabungan yang perlu direset");
        return;
      }

      const totalMembers = membersWithTabungan.length;
      let processedCount = 0;
      let errorCount = 0;

      setProgressModal((prev) => ({
        ...prev,
        total: totalMembers,
        currentUser: "Memulai reset nominalTabungan...",
        status: "Memproses...",
      }));

      // Process each member
      for (const userDoc of membersWithTabungan) {
        try {
          const userData = userDoc.data();
          const userId = userDoc.id;

          setProgressModal((prev) => ({
            ...prev,
            progress: processedCount + 1,
            currentUser: userData.nama || `User ${userId}`,
            status: "Menghapus nominalTabungan...",
          }));

          // Remove nominalTabungan field completely
          const userRef = doc(db, "users", userId);
          const updateData = {
            updatedAt: serverTimestamp(),
          };

          // Use Firebase's FieldValue.delete() to remove the field
          const { deleteField } = await import("firebase/firestore");
          updateData.nominalTabungan = deleteField();

          await updateDoc(userRef, updateData);

          processedCount++;

          // Small delay to show progress
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (userError) {
          console.error(`Error resetting user ${userDoc.id}:`, userError);
          errorCount++;
        }
      }

      setProgressModal({
        isVisible: true,
        type: "reset",
        progress: totalMembers,
        total: totalMembers,
        currentUser: "Selesai!",
        status: `Berhasil reset ${processedCount} anggota, ${errorCount} error`,
      });

      // Auto close after 2 seconds
      setTimeout(() => {
        setProgressModal((prev) => ({ ...prev, isVisible: false }));
      }, 2000);
    } catch (error) {
      console.error("Error in reset nominalTabungan:", error);
      setProgressModal((prev) => ({
        ...prev,
        status: `Error: ${error.message}`,
        currentUser: "Gagal reset",
      }));

      setTimeout(() => {
        setProgressModal((prev) => ({ ...prev, isVisible: false }));
      }, 3000);
    }
  };

  const handleResetConfirm = () => {
    if (resetConfirmationText === "Saya mengerti") {
      setShowResetModal(false);
      setResetConfirmationText("");
      resetAllNominalTabungan();
    } else {
      alert('Harap ketik "Saya mengerti" dengan tepat untuk melanjutkan.');
    }
  };

  const generatePDF = async (log) => {
    try {
      // Create jsPDF instance
      const doc = new jsPDF();

      // Set font
      doc.setFont("helvetica");

      // Title
      doc.setFontSize(16);
      doc.setFont(undefined, "bold");
      doc.text("Laporan Log Tabungan Bulanan", 20, 20);

      // Date and summary info
      doc.setFontSize(12);
      doc.setFont(undefined, "normal");
      doc.text(`Tanggal: ${formatIndonesianDate(log.date)}`, 20, 35);
      doc.text(`Total Anggota Diproses: ${log.processedCount}`, 20, 45);
      // doc.text(`Total Error: ${log.errorCount}`, 20, 55);
      // doc.text(`Tipe: ${log.type}`, 20, 65);

      // Table headers
      const headers = [
        [
          "No",
          "Nama",
          "Nominal Increment",
          "Tipe Pembayaran",
          "Saldo Sebelum",
          "Saldo Sesudah",
        ],
      ];

      // Table data
      const tableData = log.entries.map((entry, index) => [
        index + 1,
        entry.nama || "-",
        // entry.nomorWhatsapp || '-',
        new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
          minimumFractionDigits: 0,
        }).format(entry.nominalIncrement),
        entry.tipePembayaran,
        new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
          minimumFractionDigits: 0,
        }).format(entry.previousBalance),
        new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
          minimumFractionDigits: 0,
        }).format(entry.newBalance),
      ]);

      // Add table using autoTable function
      autoTable(doc, {
        head: headers,
        body: tableData,
        startY: 60,
        styles: {
          fontSize: 8,
          cellPadding: 3,
        },
        headStyles: {
          fillColor: [41, 128, 185],
          textColor: 255,
          fontStyle: "bold",
        },
        columnStyles: {
          0: { halign: "center", cellWidth: 15 },
          1: { cellWidth: 35 },
          2: { cellWidth: 25 },
          3: { halign: "right", cellWidth: 30 },
          4: { cellWidth: 35 },
          5: { halign: "right", cellWidth: 30 },
          6: { halign: "right", cellWidth: 30 },
        },
      });

      // Total summary at the bottom
      // Calculate final Y position based on number of entries
      const estimatedTableHeight = log.entries.length * 8 + 40; // Rough estimation
      const finalY = 75 + estimatedTableHeight + 10;
      doc.setFont(undefined, "bold");
      doc.text("Total Increment:", 20, finalY);
      const totalIncrement = log.entries.reduce(
        (sum, entry) => sum + entry.nominalIncrement,
        0
      );
      doc.text(
        new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
          minimumFractionDigits: 0,
        }).format(totalIncrement),
        60,
        finalY
      );

      // Open PDF in new tab
      const pdfBlob = doc.output("blob");
      const url = URL.createObjectURL(pdfBlob);
      window.open(url, "_blank");
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Gagal membuat PDF. Silakan coba lagi.");
    }
  };

  const handleRollback = async (log) => {
    if (log.source === "internal_bak_payroll") return;
    const confirmRollback = window.confirm(
      `Apakah Anda yakin ingin melakukan rollback untuk log tanggal ${formatIndonesianDate(
        log.date
      )}?\n\n` +
        `Ini akan mengurangi nominalTabungan dari ${log.processedCount} anggota dan menghapus log ini secara permanen.`
    );

    if (!confirmRollback) return;

    try {
      const entries = log.entries || [];

      if (entries.length === 0) {
        alert("Tidak ada data untuk di-rollback");
        return;
      }

      setProgressModal({
        isVisible: true,
        type: "rollback",
        progress: 0,
        total: entries.length,
        currentUser: "Memulai rollback...",
        status: "Memproses...",
      });

      let rollbackCount = 0;
      let errorCount = 0;

      // Process each entry for rollback
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        try {
          setProgressModal((prev) => ({
            ...prev,
            progress: i + 1,
            currentUser: entry.nama || `User ${entry.userId}`,
            status: "Mengembalikan saldo...",
          }));

          const userRef = doc(db, "users", entry.userId);
          const userDoc = await getDoc(userRef);

          if (userDoc.exists()) {
            const userData = userDoc.data();
            const currentNominalTabungan = userData.nominalTabungan || 0;
            const newNominalTabungan = Math.max(
              0,
              currentNominalTabungan - entry.nominalIncrement
            );

            await updateDoc(userRef, {
              nominalTabungan: newNominalTabungan,
              updatedAt: serverTimestamp(),
            });

            rollbackCount++;
          } else {
            console.warn(`User ${entry.userId} not found for rollback`);
            errorCount++;
          }

          // Small delay to show progress
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (entryError) {
          console.error(
            `Error rolling back entry for user ${entry.userId}:`,
            entryError
          );
          errorCount++;
        }
      }

      // Delete related tabunganLogsPerUser documents
      setProgressModal((prev) => ({
        ...prev,
        currentUser: "Menghapus data terkait...",
        status: "Membersihkan tabunganLogsPerUser...",
      }));

      const tabunganLogsPerUserQuery = query(
        collection(db, tlpuPath),
        where("tabunganLogId", "==", log.id)
      );
      const tabunganLogsPerUserSnapshot = await getDocs(
        tabunganLogsPerUserQuery
      );

      if (!tabunganLogsPerUserSnapshot.empty) {
        // Delete all related tabunganLogsPerUser documents
        const deletePromises = tabunganLogsPerUserSnapshot.docs.map(
          (docSnapshot) => deleteDoc(docSnapshot.ref)
        );
        await Promise.all(deletePromises);
        console.log(
          `Deleted ${tabunganLogsPerUserSnapshot.docs.length} tabunganLogsPerUser documents`
        );
      }

      // Delete the log document
      setProgressModal((prev) => ({
        ...prev,
        currentUser: "Menghapus log utama...",
        status: "Menyelesaikan...",
      }));

      await deleteDoc(doc(db, tlPath, log.id));

      setProgressModal({
        isVisible: true,
        type: "rollback",
        progress: entries.length,
        total: entries.length,
        currentUser: "Selesai!",
        status: `Berhasil rollback ${rollbackCount} anggota, ${errorCount} error`,
      });

      // Auto close after 2 seconds
      setTimeout(() => {
        setProgressModal((prev) => ({ ...prev, isVisible: false }));
        fetchTabunganLogs(); // Refresh logs
      }, 2000);
    } catch (error) {
      console.error("Error during rollback:", error);
      setProgressModal((prev) => ({
        ...prev,
        status: `Error: ${error.message}`,
        currentUser: "Gagal rollback",
      }));

      setTimeout(() => {
        setProgressModal((prev) => ({ ...prev, isVisible: false }));
      }, 3000);
    }
  };

  if (loading) {
    return (
      <div className="tabungan-logs">
        <h2>Log Tabungan Bulanan</h2>
        <div className="loading">Memuat data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tabungan-logs">
        <h2>Log Tabungan Bulanan</h2>
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="tabungan-logs">
      <div className="header-section">
        <h2>Log Tabungan Bulanan</h2>
        <div className="header-buttons">
          <button
            className="trigger-button"
            onClick={() => setShowTriggerModal(true)}
            disabled={loading}
          >
            Trigger Manual
          </button>
          {/* TEMPORARY RESET BUTTON - WILL BE COMMENTED OUT LATER */}
          {/* <button
            className="reset-button"
            onClick={() => setShowResetModal(true)}
            disabled={loading}
          >
            Reset All Tabungan
          </button> */}
          <button
            className="refresh-button"
            onClick={fetchTabunganLogs}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="empty-state">
          <p>Belum ada log tabungan bulanan.</p>
        </div>
      ) : (
        <div className="logs-container">
          {logs.map((log) => (
            <div key={log.id} className="log-item">
              <div className="log-header">
                <div className="log-date">{formatIndonesianDate(log.date)}</div>
                <div className="log-stats">
                  <span className="stat-item">
                    <strong>{log.processedCount}</strong> anggota diproses
                  </span>
                  {log.errorCount > 0 && (
                    <span className="stat-item error">
                      <strong>{log.errorCount}</strong> error
                    </span>
                  )}
                </div>
              </div>

              <div className="log-details">
                <div className="detail-item">
                  <span className="detail-label">Tipe:</span>
                  <span className="detail-value">{log.type}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Total Entries:</span>
                  <span className="detail-value">
                    {log.entries?.length || 0}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Timestamp:</span>
                  <span className="detail-value">{log.timestampEpoch}</span>
                </div>
              </div>

              <div className="log-actions">
                <button className="pdf-button" onClick={() => generatePDF(log)}>
                  Unduh PDF
                </button>
                <button
                  className="rollback-button"
                  disabled={log.source === "internal_bak_payroll"}
                  title={log.source === "internal_bak_payroll" ? "Koreksi melalui payroll" : undefined}
                  onClick={() => handleRollback(log)}
                >
                  Rollback
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Trigger Confirmation Modal */}
      {showTriggerModal && (
        <div className="modal-overlay">
          <div className="modal-content trigger-modal">
            <div className="modal-header">
              <h3>Trigger Manual Tabungan Bulanan</h3>
              <button
                className="modal-close"
                onClick={() => {
                  setShowTriggerModal(false);
                  setConfirmationText("");
                }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="warning-section">
                <div className="warning-icon">⚠️</div>
                <div className="warning-text">
                  <h4>PERINGATAN!</h4>
                  <p>
                    Tindakan ini akan memproses semua anggota aktif dan
                    menambahkan nominal tabungan mereka. Pastikan Anda
                    benar-benar ingin melakukan ini.
                  </p>
                  <ul>
                    <li>
                      Hanya anggota dengan status "approved" dan paymentStatus
                      "Payroll Deduction" yang akan diproses
                    </li>
                    <li>
                      Anggota baru akan mendapat iuran pokok + iuran wajib
                    </li>
                    <li>Anggota existing akan mendapat iuran wajib saja</li>
                    <li>
                      Anggota dengan paymentStatus "Yayasan Subsidy" tidak akan
                      diproses
                    </li>
                    <li>Log akan dibuat secara otomatis</li>
                  </ul>
                </div>
              </div>

              <div className="confirmation-section">
                <label htmlFor="confirmText">
                  Ketik <strong>"Saya mengerti"</strong> untuk melanjutkan:
                </label>
                <input
                  id="confirmText"
                  type="text"
                  value={confirmationText}
                  onChange={(e) => setConfirmationText(e.target.value)}
                  placeholder="Saya mengerti"
                  className="confirmation-input"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="cancel-button"
                onClick={() => {
                  setShowTriggerModal(false);
                  setConfirmationText("");
                }}
              >
                Batal
              </button>
              <button
                className="confirm-button"
                onClick={handleTriggerConfirm}
                disabled={confirmationText !== "Saya mengerti"}
              >
                Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <div className="modal-overlay">
          <div className="modal-content trigger-modal">
            <div className="modal-header">
              <h3>Reset Semua Nominal Tabungan</h3>
              <button
                className="modal-close"
                onClick={() => {
                  setShowResetModal(false);
                  setResetConfirmationText("");
                }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="warning-section">
                <div className="warning-icon">⚠️</div>
                <div className="warning-text">
                  <h4>PERINGATAN EKSTREM!</h4>
                  <p>
                    Tindakan ini akan MENGHAPUS SELURUH nominal tabungan dari
                    SEMUA anggota. Tindakan ini TIDAK DAPAT DIKEMBALIKAN.
                    Pastikan Anda benar-benar yakin!
                  </p>
                  <ul>
                    <li>Semua field nominalTabungan akan dihapus permanen</li>
                    <li>Data tidak dapat dikembalikan setelah tindakan ini</li>
                    <li>
                      Digunakan hanya untuk reset sistem secara menyeluruh
                    </li>
                    <li>GUNAKAN DENGAN SANGAT HATI-HATI!</li>
                  </ul>
                </div>
              </div>

              <div className="confirmation-section">
                <label htmlFor="resetConfirmText">
                  Ketik <strong>"Saya mengerti"</strong> untuk melanjutkan:
                </label>
                <input
                  id="resetConfirmText"
                  type="text"
                  value={resetConfirmationText}
                  onChange={(e) => setResetConfirmationText(e.target.value)}
                  placeholder="Saya mengerti"
                  className="confirmation-input"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="cancel-button"
                onClick={() => {
                  setShowResetModal(false);
                  setResetConfirmationText("");
                }}
              >
                Batal
              </button>
              <button
                className="confirm-button reset-confirm"
                onClick={handleResetConfirm}
                disabled={resetConfirmationText !== "Saya mengerti"}
              >
                RESET SEMUA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress Modal */}
      {progressModal.isVisible && (
        <div className="modal-overlay">
          <div className="modal-content progress-modal">
            <div className="modal-header">
              <h3>
                {progressModal.type === "trigger"
                  ? "Memproses Tabungan Bulanan"
                  : progressModal.type === "reset"
                  ? "Reset Nominal Tabungan"
                  : "Rollback Tabungan"}
              </h3>
            </div>
            <div className="modal-body">
              <div className="progress-info">
                <div className="progress-stats">
                  <span className="progress-count">
                    {progressModal.progress} / {progressModal.total}
                  </span>
                  <span className="progress-percentage">
                    {progressModal.total > 0
                      ? Math.round(
                          (progressModal.progress / progressModal.total) * 100
                        )
                      : 0}
                    %
                  </span>
                </div>

                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${
                        progressModal.total > 0
                          ? (progressModal.progress / progressModal.total) * 100
                          : 0
                      }%`,
                    }}
                  ></div>
                </div>

                <div className="progress-details">
                  <div className="current-user">
                    <strong>Sedang memproses:</strong>{" "}
                    {progressModal.currentUser}
                  </div>
                  <div className="progress-status">
                    <strong>Status:</strong> {progressModal.status}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TabunganLogs;
