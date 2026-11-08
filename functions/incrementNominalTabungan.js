/**
 * Firebase Cloud Function: Increment Nominal Tabungan
 *
 * This function runs automatically on the 5th of each month to increment
 * the nominalTabungan for approved members with Payroll Deduction payment status.
 *
 * Rules:
 * - Only processes members with paymentStatus: "Payroll Deduction"
 * - Excludes members with paymentStatus: "Yayasan Subsidy" or other statuses
 * - First time: increment by iuranPokok + iuranWajib
 * - Subsequent times: increment by iuranWajib only
 * - Creates detailed logs in tabunganLogs collection
 *
 * Schedule: Runs on the 5th of each month at 00:00 UTC+7 (17:00 UTC)
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const { incrementLegacySavings } = require('./legacySavings');

// Keep the deployed schedule and HTTP name. Policy is rechecked transactionally.
exports.incrementNominalTabungan = functions.region("asia-southeast1")
  .pubsub.schedule("0 17 4 * *").timeZone("Asia/Jakarta")
  .onRun(() => incrementLegacySavings());
exports.manualIncrementNominalTabungan = functions.region("asia-southeast1").https.onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  try { res.status(200).json(await incrementLegacySavings()); }
  catch (error) { console.error("Legacy savings increment failed", error); res.status(500).json({ error: "Tabungan belum dapat diproses." }); }
});

// Initialize nominalTabungan for existing members (one-time setup)
exports.initializeNominalTabungan = functions
  .region("asia-southeast1")
  .https.onRequest(async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      console.log("Initializing nominalTabungan for existing members...");

      // Get all users with role "Member" who don't have nominalTabungan field
      const usersQuery = await db
        .collection("users")
        .where("role", "==", "Member")
        .get();

      const batch = db.batch();
      let initializedCount = 0;

      for (const userDoc of usersQuery.docs) {
        const userData = userDoc.data();

        // Only initialize if nominalTabungan doesn't exist
        if (userData.nominalTabungan === undefined) {
          const userRef = db.collection("users").doc(userDoc.id);
          batch.update(userRef, {
            nominalTabungan: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          initializedCount++;
        }
      }

      await batch.commit();

      console.log(
        `Initialized nominalTabungan for ${initializedCount} members`
      );

      res.status(200).json({
        success: true,
        message: `Initialized nominalTabungan for ${initializedCount} members`,
      });
    } catch (error) {
      console.error("Initialization failed:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

// Rollback function to reverse tabungan log entries
exports.rollbackTabunganLog = functions
  .region("asia-southeast1")
  .https.onRequest(async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      const { logDocumentId } = req.body;

      if (!logDocumentId) {
        return res.status(400).json({
          success: false,
          error: "Log document ID is required",
        });
      }

      console.log(`Starting rollback for log: ${logDocumentId}`);

      // Get the log document
      const logDoc = await db
        .collection("tabunganLogs")
        .doc(logDocumentId)
        .get();

      if (!logDoc.exists) {
        return res.status(404).json({
          success: false,
          error: "Log document not found",
        });
      }

      const logData = logDoc.data();
      if (logData.source === "internal_bak_payroll") return res.status(409).json({ error: "Iuran payroll hanya dapat dikoreksi melalui payroll." });
      const entries = logData.entries || [];

      if (entries.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No entries found in log document",
        });
      }

      const batch = db.batch();
      let rollbackCount = 0;
      let errorCount = 0;

      // Process each entry to rollback
      for (const entry of entries) {
        try {
          const userRef = db.collection("users").doc(entry.userId);
          const userDoc = await userRef.get();

          if (userDoc.exists) {
            const userData = userDoc.data();
            const currentNominalTabungan = userData.nominalTabungan || 0;
            const newNominalTabungan = Math.max(
              0,
              currentNominalTabungan - entry.nominalIncrement
            );

            batch.update(userRef, {
              nominalTabungan: newNominalTabungan,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            rollbackCount++;
            console.log(
              `Rollback for user ${entry.userId}: ${currentNominalTabungan} -> ${newNominalTabungan}`
            );
          } else {
            console.warn(`User ${entry.userId} not found for rollback`);
            errorCount++;
          }
        } catch (entryError) {
          console.error(
            `Error rolling back entry for user ${entry.userId}:`,
            entryError
          );
          errorCount++;
        }
      }

      // Commit the rollback batch
      await batch.commit();

      // Delete related tabunganLogsPerUser documents
      const tabunganLogsPerUserQuery = await db
        .collection("tabunganLogsPerUser")
        .where("tabunganLogId", "==", logDocumentId)
        .get();

      if (!tabunganLogsPerUserQuery.empty) {
        const deletePerUserBatch = db.batch();
        tabunganLogsPerUserQuery.docs.forEach((doc) => {
          deletePerUserBatch.delete(doc.ref);
        });
        await deletePerUserBatch.commit();
        console.log(`Deleted ${tabunganLogsPerUserQuery.docs.length} tabunganLogsPerUser documents`);
      }

      // Delete the log document
      await db.collection("tabunganLogs").doc(logDocumentId).delete();

      console.log(
        `Rollback completed: ${rollbackCount} users processed, ${errorCount} errors`
      );

      res.status(200).json({
        success: true,
        message: `Rollback completed successfully`,
        rollbackCount: rollbackCount,
        errorCount: errorCount,
      });
    } catch (error) {
      console.error("Rollback failed:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
