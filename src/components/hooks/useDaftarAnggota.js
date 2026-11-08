// src/components/hooks/useDaftarAnggota.js
import { useState, useEffect, useMemo } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  getDoc,
  orderBy,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db, getEnvironmentCollection, auth } from "../../firebase";
import { createUserWithEmailAndPassword, getAuth, connectAuthEmulator, signOut } from "firebase/auth";
import { initializeApp, deleteApp } from "firebase/app";
import { getNextMemberNumber } from "../../utils/memberNumberUtils";

async function createMemberIdentity(email, password) {
  const isolatedApp = initializeApp(auth.app.options, `member-registration-${Date.now()}-${Math.random()}`);
  const isolatedAuth = getAuth(isolatedApp);
  if (auth.emulatorConfig) {
    const { protocol, host, port } = auth.emulatorConfig;
    connectAuthEmulator(isolatedAuth, `${protocol}://${host}:${port}`, { disableWarnings: true });
  }
  try { return await createUserWithEmailAndPassword(isolatedAuth, email, password); }
  finally { try { await signOut(isolatedAuth); } finally { await deleteApp(isolatedApp); } }
}

const NUMERIC_SORT_KEYS = new Set(["nominalTabungan"]);

const useDaftarAnggota = (isProduction = true) => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editMemberData, setEditMemberData] = useState(null);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [isImporting, setIsImporting] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [selectAllChecked, setSelectAllChecked] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  const [newMemberData, setNewMemberData] = useState({
    nama: "",
    email: "",
    password: "",
    nik: "",
    nomorWhatsapp: "",
    kantor: "Unipdu",
    satuanKerja: "",
    iuranPokok: 250000,
    iuranPokokFormatted: "250.000",
    iuranWajib: 25000,
    iuranWajibFormatted: "25.000",
    paymentStatus: "Payroll Deduction",
    bankDetails: {
      bank: "",
      nomorRekening: ""
    }
  });

  const statusOptions = [
    { value: "all", label: "Semua Status" },
    { value: "approved", label: "Approved" },
    { value: "Pending", label: "Pending" },
    { value: "inactive", label: "Non Aktif" },
    { value: "rejected", label: "Ditolak" },
  ];

  const satuanKerjaOptions = [
    "BAA",
    "BAK",
    "BAKM",
    "BU",
    "FAI",
    "FBBP",
    "FIK",
    "HUMAS",
    "LPPM",
    "PASCA",
    "PERPUS",
    "PJM",
    "PMB",
    "PSA",
    "PSB",
    "PSQ",
    "PSW",
    "PUSKOMNET",
    "REKTORAT",
    "SAINTEK",
    "SDM",
  ];

  // Format WhatsApp number to international format (+628...)
  const formatWhatsAppNumber = (number) => {
    if (!number) return "";
    
    // Remove all non-digit characters
    let cleaned = String(number).replace(/\D/g, "");
    
    // Handle different formats
    if (cleaned.startsWith("62")) {
      return "+" + cleaned;
    } else if (cleaned.startsWith("8")) {
      return "+62" + cleaned;
    } else if (cleaned.startsWith("08")) {
      return "+62" + cleaned.substring(1); // Remove leading 0
    } else {
      // If it's already in the right format or any other format
      return String(number);
    }
  };

  // Format currency with thousand separators
  const formatCurrencyInput = (value) => {
    if (!value) return "";
    
    // Convert to string and remove non-digits
    const numericValue = value.toString().replace(/\D/g, "");
    
    // Format with thousand separators
    return new Intl.NumberFormat("id-ID").format(numericValue);
  };

  // Parse formatted currency back to number
  const parseCurrencyValue = (formattedValue) => {
    if (!formattedValue) return 0;
    return parseInt(formattedValue.replace(/\D/g, ""), 10);
  };

  // Handle input changes for new member form
  const handleAddInputChange = (e) => {
    const { name, value } = e.target;
    
    // Special handling for NIK (max 16 digits)
    if (name === "nik") {
      const numericValue = value.replace(/\D/g, "");
      if (numericValue.length <= 16) {
        setNewMemberData((prev) => ({
          ...prev,
          [name]: numericValue,
        }));
      }
      return; // Early return after handling NIK
    }
    
    // Handle WhatsApp formatting
    if (name === "nomorWhatsapp") {
      setNewMemberData((prev) => ({
        ...prev,
        [name]: value,
      }));
      return; // Early return, we'll format on save
    }
    
    // Handle currency formatting for iuranPokok and iuranWajib
    if (name === "iuranPokok" || name === "iuranWajib") {
      // Remove thousand separators and non-numeric characters for processing
      const numericValue = value.replace(/\D/g, "");
      
      // Store the numeric value but display formatted
      setNewMemberData((prev) => ({
        ...prev,
        [name]: numericValue,
        [`${name}Formatted`]: formatCurrencyInput(numericValue),
      }));
      return; // Early return after handling currency
    }
    
    // Handle nested properties (like bankDetails.bank)
    if (name.includes(".")) {
      const [parent, child] = name.split(".");
      setNewMemberData((prev) => ({
        ...prev,
        [parent]: {
          ...prev[parent],
          [child]: value
        }
      }));
      return; // Early return after handling nested property
    }
    
    // Default handling for other fields
    setNewMemberData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // Title case function for nama field
  const titleCase = (str) => {
    return str
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Create new member with Firebase Auth and Firestore
  const createNewMember = async () => {
    if (
      !newMemberData.email ||
      !newMemberData.password ||
      !newMemberData.nama
    ) {
      alert("Email, password, dan nama wajib diisi!");
      return;
    }

    setActionLoading(true);
    try {
      // Format nama to title case
      const formattedNama = titleCase(newMemberData.nama);

      // Generate timestamp
      const timestamp = Date.now();

      // Create document ID: nama_timestamp (replace spaces with underscores in nama)
      const docId = `${formattedNama.replace(/\s+/g, "_")}_${timestamp}`;

      // Create user in Firebase Auth without signing in
      const userCredential = await createMemberIdentity(
        newMemberData.email,
        newMemberData.password
      );

      // Format the WhatsApp number before saving
      const formattedWhatsApp = formatWhatsAppNumber(newMemberData.nomorWhatsapp);
      
      // Generate a member number for the new user
      const nomorAnggota = await getNextMemberNumber();
      
      // Create user document in Firestore
      await setDoc(doc(db, "users", docId), {
        nama: formattedNama,
        email: newMemberData.email.toLowerCase(),
        nik: newMemberData.nik,
        nomorWhatsapp: formattedWhatsApp,
        kantor: newMemberData.kantor,
        satuanKerja: newMemberData.satuanKerja,
        iuranPokok: Number(newMemberData.iuranPokok),
        iuranWajib: Number(newMemberData.iuranWajib),
        membershipStatus: "approved",
        status: "approved",
        role: "Member",
        uid: userCredential.user.uid,
        createdAt: serverTimestamp(),
        registrationDate: new Date().toISOString(),
        timestamp: timestamp,
        paymentStatus: newMemberData.paymentStatus,
        nomorAnggota, // Add the member number
        // Add bank details if they exist
        bankDetails: {
          bank: newMemberData.bankDetails?.bank || "",
          nomorRekening: newMemberData.bankDetails?.nomorRekening || ""
        }
      });

      // Show success message
      alert("Anggota baru berhasil ditambahkan!");

      // Refresh member list
      fetchMembers();

      // Reset form and close modal
      setNewMemberData({
        nama: "",
        email: "",
        password: "",
        nik: "",
        nomorWhatsapp: "",
        kantor: "Unipdu",
        satuanKerja: "",
        iuranPokok: 250000,
        iuranPokokFormatted: "250.000",
        iuranWajib: 25000,
        iuranWajibFormatted: "25.000",
        paymentStatus: "Payroll Deduction",
        bankDetails: {
          bank: "",
          nomorRekening: ""
        }
      });
      setShowAddModal(false);
    } catch (error) {
      console.error("Error creating new member:", error);
      alert(`Gagal menambahkan anggota: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Create a single member from import data
  const createMemberFromImport = async (rowData, index, totalRows) => {
    try {
      // Format nama to title case
      const formattedNama = titleCase(rowData.nama);

      // Generate timestamp
      const timestamp = Date.now();

      // Create document ID: nama_timestamp (replace spaces with underscores in nama)
      const docId = `${formattedNama.replace(/\s+/g, "_")}_${timestamp}`;

      // Create user in Firebase Auth - using NIK as password
      const userCredential = await createMemberIdentity(
        rowData.email,
        rowData.nik.toString() // Ensure it's a string
      );

      // Format the WhatsApp number
      const formattedWhatsApp = formatWhatsAppNumber(rowData.nomorWhatsapp);
      
      // Generate member number for bulk-imported members
      const nomorAnggota = await getNextMemberNumber();
      
      // Create user document in Firestore
      await setDoc(doc(db, "users", docId), {
        nama: formattedNama,
        email: rowData.email.toLowerCase(),
        nik: rowData.nik,
        nomorWhatsapp: formattedWhatsApp,
        kantor: rowData.kantor,
        satuanKerja: rowData.satuanKerja || "",
        iuranPokok: 250000, // Default values
        iuranWajib: 25000,   // Default values
        membershipStatus: "approved",
        status: "approved",
        role: "Member",
        uid: userCredential.user.uid,
        createdAt: serverTimestamp(),
        registrationDate: new Date().toISOString(),
        timestamp: timestamp,
        paymentStatus: rowData.metodePembayaran || "Payroll Deduction",
        nomorAnggota, // Add the member number
      });

      return true;
    } catch (error) {
      console.error(`Error creating member at row ${index + 1}:`, error);
      throw error;
    }
  };

  // Import members in bulk
  const importMembers = async (membersList) => {
    setIsImporting(true);
    setImportProgress({ current: 0, total: membersList.length });
    
    try {
      let successCount = 0;
      let failCount = 0;
      let errorDetails = [];
      
      // First check for duplicate NIKs and emails with existing members
      const existingMembers = await fetchAllMembers();
      const existingNIKs = new Set(existingMembers.map(member => member.nik));
      const existingEmails = new Set(existingMembers.map(member => member.email?.toLowerCase()));
      
      // Identify any NIKs in the import list that already exist
      const duplicateNIKs = membersList.filter(member => 
        existingNIKs.has(member.nik)
      ).map(member => ({
        nik: member.nik,
        nama: member.nama,
        email: member.email
      }));
      
      // Identify any emails in the import list that already exist
      const duplicateEmails = membersList.filter(member => 
        member.email && existingEmails.has(member.email.toLowerCase())
      ).map(member => ({
        nik: member.nik,
        nama: member.nama,
        email: member.email
      }));
      
      // If there are duplicates, show error message and return
      if (duplicateNIKs.length > 0 || duplicateEmails.length > 0) {
        let errorMessage = "";
        let details = "";
        
        if (duplicateNIKs.length > 0) {
          errorMessage += `Ditemukan ${duplicateNIKs.length} anggota dengan NIK yang sudah terdaftar dalam sistem.\n`;
          details += "NIK duplikat:\n";
          details += duplicateNIKs.map(dup => 
            `NIK: ${dup.nik}, Nama: ${dup.nama}, Email: ${dup.email}`
          ).join('\n');
        }
        
        if (duplicateEmails.length > 0) {
          if (errorMessage) errorMessage += "\n\n";
          errorMessage += `Ditemukan ${duplicateEmails.length} anggota dengan Email yang sudah terdaftar dalam sistem.\n`;
          details += "\n\nEmail duplikat:\n";
          details += duplicateEmails.map(dup => 
            `Email: ${dup.email}, Nama: ${dup.nama}, NIK: ${dup.nik}`
          ).join('\n');
        }
        
        errorMessage += "\nSilakan periksa data Anda dan coba lagi.";
        
        alert(`${errorMessage}\n\nDetail:\n${details}`);
        
        setIsImporting(false);
        setShowImportModal(false);
        return;
      }
      
      // Process members one by one
      for (let i = 0; i < membersList.length; i++) {
        try {
          await createMemberFromImport(membersList[i], i, membersList.length);
          successCount++;
        } catch (error) {
          failCount++;
          // Record detailed error
          errorDetails.push({
            row: i + 2, // +2 for header row and 0-indexing
            nama: membersList[i].nama,
            nik: membersList[i].nik,
            error: error.message
          });
          // Continue with the next member even if one fails
        }
        
        // Update progress
        setImportProgress({ current: i + 1, total: membersList.length });
      }
      
      // After all processing is done
      if (failCount > 0) {
        const errorSummary = errorDetails.map(err => 
          `Baris ${err.row}: ${err.nama} (NIK: ${err.nik}) - ${err.error}`
        ).join('\n');
        
        alert(`Import selesai: ${successCount} anggota berhasil ditambahkan, ${failCount} gagal.\n\nDetail error:\n${errorSummary}`);
      } else {
        alert(`Import selesai: ${successCount} anggota berhasil ditambahkan.`);
      }
      
      // Refresh member list
      fetchMembers();
      
    } catch (error) {
      console.error("Error during bulk import:", error);
      alert("Terjadi kesalahan saat import: " + error.message);
    } finally {
      setIsImporting(false);
      setShowImportModal(false);
    }
  };
  
  // Fetch all members for checking duplicates
  const fetchAllMembers = async () => {
    try {
      const q = query(collection(db, "users"), where("role", "==", "Member"));
      const querySnapshot = await getDocs(q);
      
      const membersData = [];
      querySnapshot.forEach((doc) => {
        membersData.push(doc.data());
      });
      
      return membersData;
    } catch (error) {
      console.error("Error fetching all members:", error);
      throw error;
    }
  };

  const fetchMembers = async () => {
    setLoading(true);
    try {
      // Get all members, not just pending ones
      const q = query(collection(db, "users"), where("role", "==", "Member"));

      const querySnapshot = await getDocs(q);
      const membersData = [];

      querySnapshot.forEach((doc) => {
        // Convert Firestore timestamp to Date if it exists
        const data = doc.data();
        if (data.createdAt && data.createdAt.toDate) {
          data.createdAt = data.createdAt.toDate();
        }

        membersData.push({
          id: doc.id,
          ...data,
        });
      });

      // Sort by creation date (newest first)
      membersData.sort((a, b) => {
        return b.createdAt - a.createdAt;
      });

      setMembers(membersData);
    } catch (error) {
      console.error("Error fetching members:", error);
      setError("Gagal memuat data anggota. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [isProduction]);

  const handleViewMember = (member) => {
    setSelectedMember(member);
    setShowViewModal(true);
  };

  const handleEditMember = (member) => {
    setSelectedMember(member);
    setEditMemberData({
      ...member,
      // Make a copy to prevent modifying the original
    });
    setShowEditModal(true);
  };

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    
    // Handle nested properties (like bankDetails.bank)
    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setEditMemberData((prev) => ({
        ...prev,
        [parent]: {
          ...prev[parent] || {},
          [child]: value
        }
      }));
    } else {
      // Handle regular properties
      setEditMemberData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const saveEditedMember = async () => {
    if (!editMemberData) return;

    setActionLoading(true);
    try {
      // Update user in Firestore
      const userRef = doc(db, "users", selectedMember.id);
      
      // Prepare update data
      const updateData = {
        nama: editMemberData.nama,
        kantor: editMemberData.kantor,
        satuanKerja: editMemberData.satuanKerja || "",
        nomorWhatsapp: editMemberData.nomorWhatsapp,
        membershipStatus: editMemberData.membershipStatus,
        paymentStatus: editMemberData.paymentStatus,
        iuranPokok: Number(editMemberData.iuranPokok) || 0,
        iuranWajib: Number(editMemberData.iuranWajib) || 0,
      };

      // The role select is only rendered for Wakil Rektor 2 (see
      // EditMemberModal's canEditRole gate); for everyone else this just
      // resends the member's existing, unchanged role.
      if (editMemberData.role) {
        updateData.role = editMemberData.role;
      }
      
      // Add bankDetails if they exist
      if (editMemberData.bankDetails) {
        updateData.bankDetails = {
          bank: editMemberData.bankDetails.bank || "",
          nomorRekening: editMemberData.bankDetails.nomorRekening || ""
        };
      }
      
      await updateDoc(userRef, updateData);

      // Update local state
      setMembers((prev) =>
        prev.map((member) =>
          member.id === selectedMember.id
            ? { ...member, ...editMemberData }
            : member
        )
      );

      // Show success message
      alert("Data anggota berhasil diperbarui");

      // Close modal
      setShowEditModal(false);
    } catch (error) {
      console.error("Error updating member:", error);
      alert("Gagal memperbarui data anggota. Silakan coba lagi.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveReject = async (action) => {
    if (!selectedMember) return;

    setActionLoading(true);
    try {
      // Update user membership status in Firestore
      const userRef = doc(db, "users", selectedMember.id);
      const newStatus = action === "approve" ? "approved" : "rejected";

      // If approving the member, generate and assign a member number
      if (action === "approve") {
        // Check if the member already has a member number
        if (!selectedMember.nomorAnggota) {
          // Generate a new member number
          const nomorAnggota = await getNextMemberNumber();
          
          // Update with membership status and the new member number
          await updateDoc(userRef, {
            membershipStatus: newStatus,
            status: newStatus,
            nomorAnggota
          });
          
          // Update local state with the new member number
          setMembers((prev) =>
            prev.map((member) =>
              member.id === selectedMember.id
                ? { ...member, membershipStatus: newStatus, status: newStatus, nomorAnggota }
                : member
            )
          );
          
          // Update the selected member for the modal display
          setSelectedMember({
            ...selectedMember,
            membershipStatus: newStatus,
            status: newStatus,
            nomorAnggota
          });
        } else {
          // If member already has a number, just update the status
          await updateDoc(userRef, {
            membershipStatus: newStatus,
            status: newStatus
          });
          
          // Update local state
          setMembers((prev) =>
            prev.map((member) =>
              member.id === selectedMember.id
                ? { ...member, membershipStatus: newStatus, status: newStatus }
                : member
            )
          );
          
          // Update the selected member for the modal display
          setSelectedMember({
            ...selectedMember,
            membershipStatus: newStatus,
            status: newStatus
          });
        }
      } else {
        // For rejection, just update the status
        await updateDoc(userRef, {
          membershipStatus: newStatus,
          status: newStatus
        });
        
        // Update local state
        setMembers((prev) =>
          prev.map((member) =>
            member.id === selectedMember.id
              ? { ...member, membershipStatus: newStatus, status: newStatus }
              : member
          )
        );
        
        // Update the selected member for the modal display
        setSelectedMember({
          ...selectedMember,
          membershipStatus: newStatus,
          status: newStatus
        });
      }

      // Show success message
      const successMessage =
        action === "approve"
          ? "Anggota berhasil disetujui"
          : "Anggota berhasil ditolak";
      
      alert(successMessage);

    } catch (error) {
      console.error(
        `Error ${action === "approve" ? "approving" : "rejecting"} member:`,
        error
      );
      alert(
        `Gagal ${
          action === "approve" ? "menyetujui" : "menolak"
        } anggota. Silakan coba lagi.`
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Generate WhatsApp message with approval or rejection
  const getWhatsAppUrl = (phoneNumber, isApproved) => {
    // Clean the phone number (remove any non-digit characters)
    const cleanNumber = phoneNumber.replace(/\D/g, "");
    
    // Add country code if not present
    const formattedNumber = cleanNumber.startsWith("62")
      ? cleanNumber
      : cleanNumber.startsWith("0")
      ? `62${cleanNumber.substring(1)}`
      : `62${cleanNumber}`;

    const message = isApproved
      ? "Pendaftaran Anda sebagai anggota Koperasi Unipdu telah disetujui. Terima kasih telah bergabung dengan kami."
      : "Mohon maaf, pendaftaran Anda sebagai anggota Koperasi Unipdu belum dapat disetujui. Silakan hubungi admin untuk informasi lebih lanjut.";

    return `https://wa.me/${formattedNumber}?text=${encodeURIComponent(
      message
    )}`;
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  // Format date object to readable string
  const formatDate = (dateString) => {
    try {
      const date = dateString ? new Date(dateString) : null;
      return date ? date.toLocaleDateString("id-ID") : "-";
    } catch (error) {
      console.error("Error formatting date:", error);
      return "-";
    }
  };

  // Filter members based on search term and status filter
  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      const matchesSearch =
        member.nama?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.nomorWhatsapp?.includes(searchTerm) ||
        member.kantor?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.satuanKerja?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.email?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus =
        statusFilter === "all" || member.membershipStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [members, searchTerm, statusFilter]);

  // Toggle sort direction for a given column, or start sorting by it ascending
  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  };

  // Sort filtered members based on the current sort configuration
  const sortedMembers = useMemo(() => {
    if (!sortConfig.key) return filteredMembers;

    const { key, direction } = sortConfig;
    const modifier = direction === "asc" ? 1 : -1;

    const getValue = (member) => {
      if (key === "nominalTabungan") {
        return member.membershipStatus === "approved"
          ? Number(member.nominalTabungan) || 0
          : -1;
      }
      return member[key];
    };

    return [...filteredMembers].sort((a, b) => {
      const valueA = getValue(a);
      const valueB = getValue(b);

      if (NUMERIC_SORT_KEYS.has(key)) {
        return ((valueA || 0) - (valueB || 0)) * modifier;
      }

      const strA = (valueA ?? "").toString().toLowerCase();
      const strB = (valueB ?? "").toString().toLowerCase();

      if (strA < strB) return -1 * modifier;
      if (strA > strB) return 1 * modifier;
      return 0;
    });
  }, [filteredMembers, sortConfig]);

  // Toggle selection of a member
  const toggleMemberSelection = (memberId) => {
    setSelectedMembers(prev => {
      if (prev.includes(memberId)) {
        return prev.filter(id => id !== memberId);
      } else {
        return [...prev, memberId];
      }
    });
  };
  
  // Toggle select all members
  const toggleSelectAll = () => {
    if (selectAllChecked) {
      setSelectedMembers([]);
    } else {
      setSelectedMembers(filteredMembers.map(member => member.id));
    }
    setSelectAllChecked(!selectAllChecked);
  };
  
  // Handle bulk delete of selected members
  const bulkDeleteMembers = async () => {
    if (selectedMembers.length === 0) {
      alert("Pilih minimal satu anggota untuk dihapus.");
      return;
    }
    
    const confirmDelete = window.confirm(
      `Anda yakin ingin menghapus ${selectedMembers.length} anggota yang dipilih? Tindakan ini tidak dapat dibatalkan.`
    );
    
    if (!confirmDelete) return;
    
    setActionLoading(true);
    let successCount = 0;
    let failCount = 0;
    let errorDetails = [];
    
    try {
      // Process deletion one by one to handle errors gracefully
      for (const memberId of selectedMembers) {
        try {
          const member = members.find(m => m.id === memberId);
          if (!member) continue;
          
          // Delete user document from Firestore
          await deleteDoc(doc(db, "users", memberId));
          
          // Note: We cannot delete the Auth user because we don't have admin privileges here
          // This would typically be handled by a Firebase Function or admin SDK
          
          successCount++;
        } catch (error) {
          failCount++;
          errorDetails.push({
            id: memberId,
            nama: members.find(m => m.id === memberId)?.nama || 'Unknown',
            error: error.message
          });
        }
      }
      
      // Update the local state to remove deleted members
      setMembers(prev => prev.filter(member => !selectedMembers.includes(member.id)));
      setSelectedMembers([]);
      setSelectAllChecked(false);
      
      // Show results
      if (failCount > 0) {
        const errorSummary = errorDetails.map(err => 
          `${err.nama} - ${err.error}`
        ).join('\n');
        
        alert(`${successCount} anggota berhasil dihapus. ${failCount} anggota gagal dihapus.\n\nDetail error:\n${errorSummary}`);
      } else {
        alert(`${successCount} anggota berhasil dihapus.`);
      }
      
      setShowDeleteModal(false);
    } catch (error) {
      console.error("Error deleting members:", error);
      alert(`Terjadi kesalahan: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return {
    // State
    members,
    loading,
    error,
    selectedMember,
    showViewModal,
    showEditModal,
    showAddModal,
    showImportModal,
    showDeleteModal,
    actionLoading,
    searchTerm,
    statusFilter,
    editMemberData,
    newMemberData,
    filteredMembers,
    sortedMembers,
    sortConfig,
    statusOptions,
    satuanKerjaOptions,
    importProgress,
    isImporting,
    selectedMembers,
    selectAllChecked,

    // Functions
    handleSort,
    setSearchTerm,
    setStatusFilter,
    setShowAddModal,
    setShowViewModal,
    setShowEditModal,
    setShowImportModal,
    setShowDeleteModal,
    handleViewMember,
    handleEditMember,
    handleAddInputChange,
    handleEditInputChange,
    createNewMember,
    saveEditedMember,
    handleApproveReject,
    getWhatsAppUrl,
    formatCurrency,
    formatDate,
    formatCurrencyInput,
    importMembers,
    toggleMemberSelection,
    toggleSelectAll,
    bulkDeleteMembers,
    fetchMembers,
    setMembers
  };
};

export default useDaftarAnggota;