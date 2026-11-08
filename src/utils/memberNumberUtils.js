import {
  collection,
  query,
  orderBy,
  getDocs,
  writeBatch,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { db, functions } from "../firebase";
import { httpsCallable } from "firebase/functions";

/**
 * One-time function to update all users with a unique nomorAnggota
 * @returns {Promise<{success: boolean, message: string, updatedCount: number}>}
 */
export const updateAllUsersWithMemberNumbers = async () => {
  try {
    // Get all users ordered by registration timestamp
    const usersRef = collection(db, "users");
    const q = query(usersRef, orderBy("registrationDate", "asc"));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return { success: false, message: "No users found", updatedCount: 0 };
    }

    const currentYear = new Date().getFullYear().toString().slice(-2); // Get last 2 digits of current year
    let nomorUrut = 1;

    // Use batched writes for efficiency and atomicity
    const batchSize = 500; // Firestore allows max 500 operations per batch
    let batch = writeBatch(db);
    let batchCount = 0;
    let updatedCount = 0;

    for (const userDoc of querySnapshot.docs) {
      // Skip if user already has a nomorAnggota
      if (userDoc.data().nomorAnggota) {
        // continue;
      }

      // Format: YYNNNNN (YY=year, NNNNN=sequence number with padding)
      const nomorAnggota = `${currentYear}${nomorUrut
        .toString()
        .padStart(3, "0")}`;

      // Update the user document with the new nomorAnggota
      const userRef = doc(db, "users", userDoc.id);
      batch.update(userRef, { nomorAnggota });

      nomorUrut++;
      batchCount++;
      updatedCount++;

      // Commit batch when it reaches the limit and create a new one
      if (batchCount === batchSize) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }

    // Commit any remaining operations
    if (batchCount > 0) {
      await batch.commit();
    }

    return {
      success: true,
      message: `Successfully updated ${updatedCount} users with member numbers`,
      updatedCount,
    };
  } catch (error) {
    console.error("Error updating users with member numbers:", error);
    return {
      success: false,
      message: `Error updating users: ${error.message}`,
      updatedCount: 0,
    };
  }
};

/**
 * Get the next available member number
 * @returns {Promise<string>} The next available member number in format YYNNNNN
 */
export const getNextMemberNumber = async () => {
  const result = await httpsCallable(functions, "allocateMemberNumber")();
  return result.data.nomorAnggota;
};

/**
 * Update a single user with a member number
 * @param {string} userId - The user document ID
 * @returns {Promise<{success: boolean, message: string, nomorAnggota: string|null}>}
 */
export const assignMemberNumberToUser = async (userId) => {
  try {
    // Check if user already has a member number
    const userRef = doc(db, "users", userId);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      return { success: false, message: "User not found", nomorAnggota: null };
    }

    if (userDoc.data().nomorAnggota) {
      return {
        success: true,
        message: "User already has a member number",
        nomorAnggota: userDoc.data().nomorAnggota,
      };
    }

    // Generate next member number
    const nomorAnggota = await getNextMemberNumber();

    // Update the user document
    await updateDoc(userRef, { nomorAnggota });

    return {
      success: true,
      message: "Member number assigned successfully",
      nomorAnggota,
    };
  } catch (error) {
    console.error("Error assigning member number:", error);
    return {
      success: false,
      message: `Error assigning member number: ${error.message}`,
      nomorAnggota: null,
    };
  }
};
