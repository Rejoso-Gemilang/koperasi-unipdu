// in index.js of your Firebase Functions project

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require('cors')({origin: true});
// Import escpos libraries conditionally to avoid errors in Cloud Functions environment
let escpos, network;
try {
  escpos = require('escpos');
  // Try to use network printer instead of USB since we're in a serverless environment
  network = require('escpos-network');
  escpos.Network = network;
} catch (error) {
  console.log('ESCPOS library not available or error loading:', error.message);
}

admin.initializeApp();

// Import nominalTabungan functions
const { 
  incrementNominalTabungan, 
  manualIncrementNominalTabungan,
  initializeNominalTabungan,
  rollbackTabunganLog
} = require('./incrementNominalTabungan');
const {
  payrollLoanBridge,
  recordManualLoanInstallment,
} = require('./payrollLoanFunctions');

// Function that runs every day at 23:50 Jakarta time (UTC+7)
exports.createDailyStockSnapshot = functions.pubsub
  .schedule("50 23 * * *")
  .timeZone("Asia/Jakarta")
  .onRun(async (context) => {
    try {
      // Get the current date in YYYY-MM-DD format in Jakarta timezone
      const today = new Date();
      const jakartaOffset = 7 * 60; // Jakarta is UTC+7
      const jakartaTime = new Date(today.getTime() + jakartaOffset * 60000);

      const year = jakartaTime.getUTCFullYear();
      const month = String(jakartaTime.getUTCMonth() + 1).padStart(2, "0");
      const day = String(jakartaTime.getUTCDate()).padStart(2, "0");
      const dateString = `${year}-${month}-${day}`;

      // Get all stocks
      const stocksSnapshot = await admin.firestore().collection("stocks").get();

      // Convert to array of stock data
      const stocks = [];
      stocksSnapshot.forEach((doc) => {
        const stockData = doc.data();
        stockData.id = doc.id; // Include the document ID
        stocks.push(stockData);
      });

      // Save the snapshot to the stockSnapshots collection
      await admin.firestore().collection("stockSnapshots").doc(dateString).set({
        stocks,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        snapshotDate: dateString,
      });

      console.log(
        `Created stock snapshot for ${dateString} with ${stocks.length} items`
      );
      return null;
    } catch (error) {
      console.error("Error creating stock snapshot:", error);
      return null;
    }
  });

// Helper function to format number with thousand separator
function formatNumber(number) {
  const val = Number(number);
  if (isNaN(val)) {
    return "0";
  }
  return val.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Create a thermal printer function
exports.printReceipt = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).send({error: 'Method Not Allowed'});
      }
      
      const receiptData = req.body;
      
      if (!receiptData) {
        return res.status(400).send({error: 'No receipt data provided'});
      }
      
      // Check if escpos library is available
      if (!escpos || !network) {
        console.warn('ESCPOS library not available, using fallback');
        return res.status(200).send({
          message: 'Printer library not available, using browser printing',
          usingFallback: true
        });
      }
      
      // Check for printer IP in request
      const printerIP = req.body.printerIP || req.query.printerIP;
      const printerPort = req.body.printerPort || req.query.printerPort || 9100; // Default to 9100

      if (!printerIP) {
        console.warn('No printer IP provided, using fallback');
        return res.status(200).send({
          message: 'No printer IP provided, using browser printing',
          usingFallback: true
        });
      }
      
      try {
        // Create a network printer device
        const device = new escpos.Network(printerIP, printerPort);
        
        // Use Promise to handle the asynchronous device.open
        const printPromise = new Promise((resolve, reject) => {
          try {
            // Connect to the printer
            device.open(function(err) {
              if (err) {
                console.error(`Error connecting to network printer at ${printerIP}:${printerPort}`, err);
                return reject(err);
              }
              
              const printer = new escpos.Printer(device);
              
              // Print receipt with much larger text
              printer
                .font('a')
                .align('ct')
                .style('b')
                .size(1, 2) // Much larger header (double width, triple height)
                .text(receiptData.header.storeName)
                .size(0, 1) // Normal width, double height
                .style('normal')
                .text(receiptData.header.storeAddress)
                .text(receiptData.header.storeCity)
                .style('b')
                .size(1, 1) // Double size for subtitle
                .text(receiptData.header.title)
                .text('')
                .size(0, 0) // Reset size
                .align('lt')
                .text(`No: ${receiptData.info.transactionId}`)
                .align('rt')
                .text(`${receiptData.info.dateTime}`);

              const mName = receiptData.info?.memberName || receiptData.memberName || receiptData.member?.name;
              const mNo = receiptData.info?.nomorAnggota || receiptData.nomorAnggota || receiptData.member?.nomorAnggota;
              if (mName) {
                printer
                  .align('lt')
                  .text(`Anggota: ${mName}${mNo ? ` (${mNo})` : ''}`);
              }

              printer
                .drawLine()
                .text('');
              
              // Print table headers - with larger columns for Item and Total, no Harga column
              printer
                .align('lt')
                .style('b')
                .size(0, 1) // Larger text for headers (normal width, double height)
                .tableCustom([
                  { text: 'Item', width: 0.6, align: 'LEFT' },
                  { text: 'Qty', width: 0.1, align: 'CENTER' },
                  { text: 'Total', width: 0.3, align: 'RIGHT' }
                ])
                .size(0, 0) // Reset to normal size
                .style('normal');
              
              // Print items - without units and price, just quantity and total
              receiptData.items.forEach(item => {
                printer.tableCustom([
                  { text: item.name, width: 0.6, align: 'LEFT' },
                  { text: item.quantity.toString(), width: 0.1, align: 'CENTER' },
                  { text: formatNumber(item.subtotal), width: 0.3, align: 'RIGHT' }
                ]);
              });
              
              // Print summary with larger text and right margin
              printer
                .drawLine()
                .align('rt')
                .style('b')
                .size(1, 1) // Double size for totals
                .text(`TOTAL: ${formatNumber(receiptData.summary.total)}  `) // Added space padding
                .text(`TUNAI: ${formatNumber(receiptData.summary.amountPaid)}  `)
                .text(`KEMBALI: ${formatNumber(receiptData.summary.change)}  `)
                .text('') // Extra line for bottom spacing
                .text('') // Extra line for bottom spacing
                .cut()
                .close();
              
              resolve();
            });
          } catch (innerError) {
            reject(innerError);
          }
        });
        
        await printPromise;
        
        // Send success response
        return res.status(200).send({
          success: true, 
          message: 'Receipt printed successfully'
        });
        
      } catch (printerError) {
        console.error('Error connecting to printer:', printerError);
        // Return 200 so client doesn't show error, but use fallback
        return res.status(200).send({
          message: 'Failed to print to thermal printer, using browser printing', 
          details: printerError.message,
          usingFallback: true
        });
      }
    } catch (error) {
      console.error('Error processing print request:', error);
      // Return 200 so client doesn't show error, but use fallback
      return res.status(200).send({
        message: 'Error processing request, using browser printing', 
        details: error.message,
        usingFallback: true
      });
    }
  });
});

// Export nominalTabungan functions
exports.incrementNominalTabungan = incrementNominalTabungan;
exports.manualIncrementNominalTabungan = manualIncrementNominalTabungan;
exports.initializeNominalTabungan = initializeNominalTabungan;
exports.rollbackTabunganLog = rollbackTabunganLog;
exports.allocateMemberNumber = require('./payrollLoanFunctions').allocateMemberNumber;
exports.triggerLegacySavings = require('./payrollLoanFunctions').triggerLegacySavings;
exports.payrollLoanBridge = payrollLoanBridge;
exports.recordManualLoanInstallment = recordManualLoanInstallment;
