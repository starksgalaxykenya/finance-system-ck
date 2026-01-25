// script.js - Main JavaScript for CarKenya Financial Manager

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCuUKCxYx0jYKqWOQaN82K5zFGlQsKQsK0",
  authDomain: "ck-manager-1abdc.firebaseapp.com",
  projectId: "ck-manager-1abdc",
  storageBucket: "ck-manager-1abdc.firebasestorage.app",
  messagingSenderId: "890017473158",
  appId: "1:890017473158:web:528e1eebc4b67bd54ca707",
  measurementId: "G-7Z71W1NSX4"
};

// Global Variables
let currentUser = null;
let isFirebaseInitialized = false;
let isBankPinVerified = false;
let bankLedger = [];
let processedTransactions = new Set();
let bankBalances = {};
let lastTransactionSync = {};
let openingBalanceTimestamps = {};

// Firebase Initialization
function initializeFirebase() {
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        isFirebaseInitialized = true;
        console.log("Firebase initialized successfully");
        
        // Check for existing auth state
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                currentUser = user;
                updateUIForLoggedInUser();
                initializeBankSystem();
            }
        });
    } catch (error) {
        console.error("Firebase initialization error:", error);
        showToast("Firebase initialization failed. Using local data.", "error");
    }
}

// Initialize Bank System
async function initializeBankSystem() {
    if (!currentUser || !isFirebaseInitialized) return;
    
    showLoading("Loading bank data...");
    
    try {
        // Load processed transactions first
        await loadProcessedTransactions();
        
        // Load bank details and transactions
        await Promise.all([
            loadBankDetails(),
            loadReceiptPayments(),
            loadBankLedger()
        ]);
        
        // Calculate current balances
        calculateAllBankBalances();
        
        // Update UI
        updateBankCards();
        updateTransferDropdowns();
        
        hideLoading();
        showToast("Bank system initialized successfully", "success");
    } catch (error) {
        console.error("Error initializing bank system:", error);
        hideLoading();
        showToast("Failed to load bank data", "error");
    }
}

// Load processed transactions from Firebase
async function loadProcessedTransactions() {
    try {
        const db = firebase.firestore();
        const snapshot = await db.collection('processedTransactions')
            .doc(currentUser.uid)
            .get();
        
        if (snapshot.exists) {
            const data = snapshot.data();
            processedTransactions = new Set(data.transactionIds || []);
            openingBalanceTimestamps = data.openingBalanceTimestamps || {};
        }
    } catch (error) {
        console.error("Error loading processed transactions:", error);
    }
}

// Save processed transactions to Firebase
async function saveProcessedTransactions() {
    try {
        const db = firebase.firestore();
        await db.collection('processedTransactions')
            .doc(currentUser.uid)
            .set({
                transactionIds: Array.from(processedTransactions),
                openingBalanceTimestamps: openingBalanceTimestamps,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
    } catch (error) {
        console.error("Error saving processed transactions:", error);
    }
}

// Load bank details from Firebase
async function loadBankDetails() {
    try {
        const db = firebase.firestore();
        const snapshot = await db.collection('bankDetails').get();
        
        const banks = [];
        snapshot.forEach(doc => {
            const bank = doc.data();
            banks.push({
                id: doc.id,
                name: bank.name,
                currency: bank.currency || 'KES',
                openingBalance: bank.openingBalance || 0,
                lastUpdated: bank.lastUpdated?.toDate() || new Date()
            });
        });
        
        return banks;
    } catch (error) {
        console.error("Error loading bank details:", error);
        return [];
    }
}

// Parse bank name from payment method
function parseBankName(paymentMethod) {
    if (!paymentMethod) return '';
    
    // Remove prefixes and suffixes
    let cleanName = paymentMethod
        .replace(/^Bank:\s*/i, '')
        .replace(/\s*\(USD\)/i, '')
        .replace(/\s*\(KES\)/i, '')
        .replace(/\s*-\s*.*$/i, '') // Remove branch names
        .trim();
    
    return cleanName;
}

// Load receipt payments and process transactions
async function loadReceiptPayments() {
    try {
        const db = firebase.firestore();
        const snapshot = await db.collection('receipt_payments')
            .orderBy('createdAt', 'desc')
            .get();
        
        const newTransactions = [];
        
        snapshot.forEach(doc => {
            const transaction = doc.data();
            const transactionId = doc.id;
            
            // Skip if already processed
            if (processedTransactions.has(transactionId)) {
                return;
            }
            
            // Parse bank name
            const bankName = parseBankName(transaction.paymentMethod);
            if (!bankName) return;
            
            // Determine amount based on currency
            let amount = 0;
            if (transaction.currency === 'USD') {
                amount = parseFloat(transaction.amountUSD) || 0;
            } else if (transaction.currency === 'KSH') {
                amount = parseFloat(transaction.amountKSH) || 0;
            }
            
            // Skip if no amount
            if (amount === 0) return;
            
            // Parse date
            let transactionDate = new Date();
            if (transaction.createdAt) {
                // Handle different date formats
                if (typeof transaction.createdAt === 'string') {
                    transactionDate = new Date(transaction.createdAt);
                } else if (transaction.createdAt.toDate) {
                    transactionDate = transaction.createdAt.toDate();
                }
            }
            
            newTransactions.push({
                id: transactionId,
                bankName: bankName,
                amount: amount,
                currency: transaction.currency || 'KES',
                date: transactionDate,
                type: 'receipt', // Mark as receipt transaction
                description: transaction.description || 'Receipt Payment',
                reference: transaction.reference || ''
            });
            
            // Mark as processed
            processedTransactions.add(transactionId);
        });
        
        // Save newly processed transactions
        if (newTransactions.length > 0) {
            await saveProcessedTransactions();
        }
        
        return newTransactions;
    } catch (error) {
        console.error("Error loading receipt payments:", error);
        return [];
    }
}

// Load bank ledger entries
async function loadBankLedger() {
    try {
        const db = firebase.firestore();
        const snapshot = await db.collection('bankLedger')
            .where('userId', '==', currentUser.uid)
            .orderBy('timestamp', 'desc')
            .get();
        
        bankLedger = [];
        snapshot.forEach(doc => {
            const entry = doc.data();
            entry.id = doc.id;
            entry.timestamp = entry.timestamp?.toDate();
            bankLedger.push(entry);
        });
        
        return bankLedger;
    } catch (error) {
        console.error("Error loading bank ledger:", error);
        return [];
    }
}

// Add ledger entry
async function addLedgerEntry(entry) {
    try {
        const db = firebase.firestore();
        const docRef = await db.collection('bankLedger').add({
            ...entry,
            userId: currentUser.uid,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            userEmail: currentUser.email
        });
        
        // Add to local ledger
        entry.id = docRef.id;
        bankLedger.unshift(entry);
        
        return docRef.id;
    } catch (error) {
        console.error("Error adding ledger entry:", error);
        throw error;
    }
}

// Calculate bank balances from ledger
function calculateAllBankBalances() {
    const balances = {};
    
    // Get all banks from ledger and details
    bankLedger.forEach(entry => {
        if (!balances[entry.bankName]) {
            balances[entry.bankName] = {
                openingBalance: 0,
                totalCredits: 0,
                totalDebits: 0,
                currentBalance: 0,
                currency: entry.currency || 'KES'
            };
        }
    });
    
    // Apply opening balances
    Object.keys(openingBalanceTimestamps).forEach(bankName => {
        if (balances[bankName]) {
            balances[bankName].openingBalance = openingBalanceTimestamps[bankName].balance;
        }
    });
    
    // Process ledger entries
    bankLedger.forEach(entry => {
        if (!balances[entry.bankName]) return;
        
        const bankOpeningTime = openingBalanceTimestamps[entry.bankName]?.timestamp;
        
        // Skip transactions before opening balance if exists
        if (bankOpeningTime && entry.timestamp < bankOpeningTime) {
            return;
        }
        
        if (entry.type === 'credit' || entry.type === 'receipt') {
            balances[entry.bankName].totalCredits += entry.amount;
        } else if (entry.type === 'debit') {
            balances[entry.bankName].totalDebits += entry.amount;
        } else if (entry.type === 'transfer_out') {
            balances[entry.bankName].totalDebits += entry.amount;
            if (entry.fee && entry.feeBearer === 'sending') {
                balances[entry.bankName].totalDebits += entry.fee;
            }
        } else if (entry.type === 'transfer_in') {
            balances[entry.bankName].totalCredits += entry.amount;
            if (entry.fee && entry.feeBearer === 'receiving') {
                balances[entry.bankName].totalDebits += entry.fee;
            }
        }
    });
    
    // Calculate current balances
    Object.keys(balances).forEach(bankName => {
        balances[bankName].currentBalance = 
            balances[bankName].openingBalance +
            balances[bankName].totalCredits -
            balances[bankName].totalDebits;
    });
    
    bankBalances = balances;
    return balances;
}

// Update bank cards in UI
function updateBankCards() {
    const container = document.getElementById('bank-details-cards');
    if (!container) return;
    
    container.innerHTML = '';
    
    const banks = Object.keys(bankBalances);
    
    if (banks.length === 0) {
        document.getElementById('no-banks-message').classList.remove('hidden');
        document.getElementById('bank-cards-loading').classList.add('hidden');
        return;
    }
    
    document.getElementById('no-banks-message').classList.add('hidden');
    document.getElementById('bank-cards-loading').classList.add('hidden');
    
    banks.forEach(bankName => {
        const balance = bankBalances[bankName];
        const card = createBankCard(bankName, balance);
        container.appendChild(card);
    });
    
    // Update stats
    document.getElementById('stats-active-banks').textContent = banks.length;
    
    // Calculate total funds
    let totalKES = 0;
    let totalUSD = 0;
    
    banks.forEach(bankName => {
        const balance = bankBalances[bankName];
        if (balance.currency === 'KES') {
            totalKES += balance.currentBalance;
        } else if (balance.currency === 'USD') {
            totalUSD += balance.currentBalance;
        }
    });
    
    document.getElementById('stats-total-kes').textContent = formatNumber(totalKES.toFixed(2));
    document.getElementById('stats-total-usd').textContent = '$' + formatNumber(totalUSD.toFixed(2));
    
    // Update transaction count
    document.getElementById('transactions-count').textContent = processedTransactions.size + ' transactions';
    
    // Update last sync time
    const now = new Date();
    document.getElementById('last-sync-time').textContent = now.toLocaleTimeString();
    
    // Update Firebase connection status
    const statusEl = document.getElementById('firebase-connection-status');
    const statusDot = statusEl.querySelector('.inline-block');
    if (currentUser) {
        statusEl.innerHTML = '<span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>Connected as ' + currentUser.email;
    }
}

// Create individual bank card
// Create individual bank card
function createBankCard(bankName, balance) {
    const card = document.createElement('div');
    card.className = 'bg-white dark:bg-gray-800 rounded-xl shadow-card p-6 border border-gray-200 dark:border-gray-700 hover:shadow-card-hover transition-all bank-card';
    
    // Determine card color based on balance
    const balanceClass = balance.currentBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
    const currencySymbol = balance.currency === 'USD' ? '$' : 'KSH ';
    
    card.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <div>
                <h4 class="text-lg font-bold text-gray-800 dark:text-white">${bankName}</h4>
                <p class="text-sm text-gray-500 dark:text-gray-400">${balance.currency} Account</p>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-semibold ${balance.currency === 'USD' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'}">
                ${balance.currency}
            </span>
        </div>
        
        <div class="mb-6">
            <div class="text-3xl font-bold ${balanceClass} mb-2">
                ${currencySymbol}${formatNumber(balance.currentBalance.toFixed(2))}
            </div>
            <p class="text-sm text-gray-600 dark:text-gray-400">Current Balance</p>
        </div>
        
        <div class="grid grid-cols-2 gap-4 text-sm mb-6">
            <div>
                <div class="text-gray-500 dark:text-gray-400">Opening Balance</div>
                <div class="font-medium dark:text-white">
                    ${currencySymbol}${formatNumber(balance.openingBalance.toFixed(2))}
                    ${openingBalanceTimestamps[bankName] ? 
                        `<span class="text-xs text-green-500 ml-1" title="Opening balance set"><i class="fas fa-check-circle"></i></span>` : 
                        `<span class="text-xs text-yellow-500 ml-1" title="No opening balance set"><i class="fas fa-exclamation-circle"></i></span>`
                    }
                </div>
            </div>
            <div>
                <div class="text-gray-500 dark:text-gray-400">Total Credits</div>
                <div class="font-medium text-green-600 dark:text-green-400">${currencySymbol}${formatNumber(balance.totalCredits.toFixed(2))}</div>
            </div>
            <div>
                <div class="text-gray-500 dark:text-gray-400">Total Debits</div>
                <div class="font-medium text-red-600 dark:text-red-400">${currencySymbol}${formatNumber(balance.totalDebits.toFixed(2))}</div>
            </div>
            <div>
                <div class="text-gray-500 dark:text-gray-400">Transactions</div>
                <div class="font-medium dark:text-white">
                    ${bankLedger.filter(entry => entry.bankName === bankName).length} entries
                </div>
            </div>
        </div>
        
        <div class="flex space-x-2">
            <button onclick="openWithdrawalModal('${bankName}')" 
                    class="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2 px-3 rounded-lg transition-all">
                <i class="fas fa-money-check-alt mr-1"></i> Withdraw
            </button>
            <button onclick="openOpeningBalanceModal('${bankName}')" 
                    class="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-3 rounded-lg transition-all">
                <i class="fas fa-balance-scale mr-1"></i> Set Opening Balance
            </button>
        </div>
        
        ${openingBalanceTimestamps[bankName] ? `
            <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div class="text-xs text-gray-500 dark:text-gray-400">
                    <div class="flex items-center mb-1">
                        <i class="fas fa-calendar-alt mr-1"></i>
                        <span>Opening balance set on: ${new Date(openingBalanceTimestamps[bankName].timestamp).toLocaleDateString()}</span>
                    </div>
                    ${openingBalanceTimestamps[bankName].notes ? `
                        <div class="flex items-center">
                            <i class="fas fa-sticky-note mr-1"></i>
                            <span class="truncate" title="${openingBalanceTimestamps[bankName].notes}">${openingBalanceTimestamps[bankName].notes}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        ` : ''}
    `;
    
    return card;
}

// Update transfer dropdowns with bank options
function updateTransferDropdowns() {
    const banks = Object.keys(bankBalances);
    const dropdowns = [
        'transfer-from-bank',
        'transfer-to-bank',
        'withdrawal-bank',
        'repayment-bank-select',
        'transaction-bank-id',
        'loan-bank-account'
    ];
    
    dropdowns.forEach(dropdownId => {
        const select = document.getElementById(dropdownId);
        if (!select) return;
        
        // Clear existing options except first
        while (select.options.length > 1) {
            select.remove(1);
        }
        
        // Add bank options
        banks.forEach(bankName => {
            const balance = bankBalances[bankName];
            const option = document.createElement('option');
            option.value = bankName;
            option.textContent = `${bankName} (${balance.currency} ${formatNumber(balance.currentBalance.toFixed(2))})`;
            select.appendChild(option);
        });
    });
    
    // Update bank balance displays
    updateBalanceDisplays();
}

// Update balance displays for dropdowns
function updateBalanceDisplays() {
    const banks = Object.keys(bankBalances);
    
    banks.forEach(bankName => {
        const balance = bankBalances[bankName];
        const currencySymbol = balance.currency === 'USD' ? '$' : 'KSH ';
        
        // Update from bank balance
        const fromBankSelect = document.getElementById('transfer-from-bank');
        if (fromBankSelect && fromBankSelect.value === bankName) {
            document.getElementById('from-bank-balance').innerHTML = `
                Available: <span class="font-semibold dark:text-white">${currencySymbol}${formatNumber(balance.currentBalance.toFixed(2))}</span>
            `;
        }
        
        // Update to bank balance
        const toBankSelect = document.getElementById('transfer-to-bank');
        if (toBankSelect && toBankSelect.value === bankName) {
            document.getElementById('to-bank-balance').innerHTML = `
                Current: <span class="font-semibold dark:text-white">${currencySymbol}${formatNumber(balance.currentBalance.toFixed(2))}</span>
            `;
        }
        
        // Update withdrawal bank balance
        const withdrawalBankSelect = document.getElementById('withdrawal-bank');
        if (withdrawalBankSelect && withdrawalBankSelect.value === bankName) {
            document.getElementById('withdrawal-bank-balance').innerHTML = `
                Available: <span class="font-semibold dark:text-white">${currencySymbol}${formatNumber(balance.currentBalance.toFixed(2))}</span>
            `;
        }
    });
}

// Bank Withdrawal Function
async function processBankWithdrawal(formData) {
    try {
        const { bankName, amount, category, description, payee, date, reference } = formData;
        
        if (!bankName || !amount || amount <= 0) {
            throw new Error("Invalid withdrawal details");
        }
        
        const balance = bankBalances[bankName];
        if (!balance) {
            throw new Error("Bank not found");
        }
        
        if (amount > balance.currentBalance) {
            throw new Error("Insufficient funds");
        }
        
        showLoading("Processing withdrawal...");
        
        // Add to ledger
        const ledgerEntry = {
            bankName: bankName,
            amount: parseFloat(amount),
            currency: balance.currency,
            type: 'debit',
            category: category,
            description: description,
            payee: payee,
            reference: reference,
            date: new Date(date),
            transactionType: 'withdrawal'
        };
        
        await addLedgerEntry(ledgerEntry);
        
        // Update balances
        calculateAllBankBalances();
        updateBankCards();
        updateTransferDropdowns();
        
        hideLoading();
        closeBankWithdrawalModal();
        showToast(`Withdrawal of ${balance.currency} ${formatNumber(amount)} processed successfully`, "success");
        
        // Save processed transactions
        await saveProcessedTransactions();
        
    } catch (error) {
        hideLoading();
        showToast(`Withdrawal failed: ${error.message}`, "error");
    }
}

// Inter-bank Transfer Function
async function processBankTransfer(formData) {
    try {
        const { fromBank, toBank, amount, fee, feeBearer, reason } = formData;
        
        if (!fromBank || !toBank || !amount || amount <= 0) {
            throw new Error("Invalid transfer details");
        }
        
        if (fromBank === toBank) {
            throw new Error("Cannot transfer to the same account");
        }
        
        const fromBalance = bankBalances[fromBank];
        const toBalance = bankBalances[toBank];
        
        if (!fromBalance || !toBalance) {
            throw new Error("One or both banks not found");
        }
        
        // Calculate total debit including fee
        let totalDebit = parseFloat(amount);
        if (feeBearer === 'sending' && fee > 0) {
            totalDebit += parseFloat(fee);
        }
        
        if (totalDebit > fromBalance.currentBalance) {
            throw new Error("Insufficient funds for transfer including fees");
        }
        
        showLoading("Processing transfer...");
        
        // Add outgoing ledger entry
        const outEntry = {
            bankName: fromBank,
            amount: parseFloat(amount),
            currency: fromBalance.currency,
            type: 'transfer_out',
            fee: parseFloat(fee) || 0,
            feeBearer: feeBearer,
            toBank: toBank,
            description: reason,
            reference: `TRX-${Date.now()}`,
            date: new Date()
        };
        
        await addLedgerEntry(outEntry);
        
        // Add incoming ledger entry
        const inEntry = {
            bankName: toBank,
            amount: parseFloat(amount),
            currency: toBalance.currency,
            type: 'transfer_in',
            fee: parseFloat(fee) || 0,
            feeBearer: feeBearer,
            fromBank: fromBank,
            description: reason,
            reference: `TRX-${Date.now()}`,
            date: new Date()
        };
        
        await addLedgerEntry(inEntry);
        
        // Update balances
        calculateAllBankBalances();
        updateBankCards();
        updateTransferDropdowns();
        
        // Add to transfer history
        addTransferToHistory({
            from: fromBank,
            to: toBank,
            amount: amount,
            fee: fee,
            feeBearer: feeBearer,
            reason: reason,
            date: new Date(),
            status: 'completed'
        });
        
        hideLoading();
        closeTransferConfirm();
        showToast(`Transfer of ${fromBalance.currency} ${formatNumber(amount)} completed successfully`, "success");
        
        // Save processed transactions
        await saveProcessedTransactions();
        
    } catch (error) {
        hideLoading();
        showToast(`Transfer failed: ${error.message}`, "error");
    }
}

// Update Opening Balance
async function updateOpeningBalance(bankName, newBalance, confirmation) {
    try {
        if (!confirmation) {
            throw new Error("Confirmation required to update opening balance");
        }
        
        showLoading("Updating opening balance...");
        
        // Record opening balance timestamp
        openingBalanceTimestamps[bankName] = {
            balance: parseFloat(newBalance),
            timestamp: new Date(),
            updatedBy: currentUser.email,
            updatedAt: new Date().toISOString()
        };
        
        // Save to Firebase
        await saveProcessedTransactions();
        
        // Recalculate balances
        calculateAllBankBalances();
        updateBankCards();
        updateTransferDropdowns();
        
        hideLoading();
        showToast(`Opening balance for ${bankName} updated successfully`, "success");
        
    } catch (error) {
        hideLoading();
        showToast(`Failed to update opening balance: ${error.message}`, "error");
    }
}

// Add transfer to history display
function addTransferToHistory(transfer) {
    const historyContainer = document.getElementById('transfer-history');
    if (!historyContainer) return;
    
    // Remove placeholder if exists
    const placeholder = historyContainer.querySelector('tr td[colspan]');
    if (placeholder) {
        placeholder.parentElement.remove();
    }
    
    const row = document.createElement('tr');
    const fromBalance = bankBalances[transfer.from];
    const currencySymbol = fromBalance?.currency === 'USD' ? '$' : 'KSH ';
    const dateStr = transfer.date.toLocaleDateString();
    
    row.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">${dateStr}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">${transfer.from}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">${transfer.to}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300 font-semibold">
            ${currencySymbol}${formatNumber(transfer.amount)}
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
            <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                ${transfer.status}
            </span>
        </td>
    `;
    
    historyContainer.prepend(row);
    
    // Update today's transfers count
    const today = new Date().toDateString();
    const todayTransfers = Array.from(document.querySelectorAll('#transfer-history tr')).filter(row => {
        const dateCell = row.querySelector('td:first-child');
        return dateCell && new Date(dateCell.textContent).toDateString() === today;
    }).length;
    
    document.getElementById('stats-today-transfers').textContent = todayTransfers;
}

// Format number with commas
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// UI Helper Functions
function showLoading(message = "Loading...") {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');
    if (overlay) {
        text.textContent = message;
        overlay.classList.remove('hidden');
    }
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

function showToast(message, type = "info") {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast bg-${type === 'error' ? 'red' : type === 'success' ? 'green' : 'blue'}-500 text-white p-4 rounded-lg shadow-lg`;
    toast.innerHTML = `
        <div class="flex items-center">
            <i class="fas fa-${type === 'error' ? 'exclamation-triangle' : type === 'success' ? 'check-circle' : 'info-circle'} mr-3"></i>
            <span>${message}</span>
        </div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            container.removeChild(toast);
        }, 300);
    }, 5000);
}

// Modal Functions
function openWithdrawalModal(bankName) {
    if (!isBankPinVerified) {
        showToast("Please enter your PIN first", "error");
        return;
    }
    
    const modal = document.getElementById('bank-withdrawal-modal');
    const bankSelect = document.getElementById('withdrawal-bank');
    
    if (bankSelect && bankName) {
        bankSelect.value = bankName;
        updateBalanceDisplays();
    }
    
    modal.classList.remove('hidden');
}

function closeBankWithdrawalModal() {
    const modal = document.getElementById('bank-withdrawal-modal');
    modal.classList.add('hidden');
    document.getElementById('bank-withdrawal-form').reset();
}

function openUpdateBalanceModal(bankName) {
    const balance = bankBalances[bankName];
    if (!balance) return;
    
    const newBalance = prompt(
        `Update opening balance for ${bankName}\nCurrent: ${balance.currency === 'USD' ? '$' : 'KSH '}${formatNumber(balance.openingBalance.toFixed(2))}\n\nEnter new opening balance:`,
        balance.openingBalance
    );
    
    if (newBalance !== null) {
        const numBalance = parseFloat(newBalance);
        if (!isNaN(numBalance)) {
            const confirmed = confirm(
                `Are you sure you want to update the opening balance for ${bankName}?\n\n` +
                `Old: ${formatNumber(balance.openingBalance.toFixed(2))}\n` +
                `New: ${formatNumber(numBalance.toFixed(2))}\n\n` +
                `NOTE: This will reset transaction history from this point.`
            );
            
            if (confirmed) {
                updateOpeningBalance(bankName, numBalance, true);
            }
        } else {
            showToast("Invalid balance amount", "error");
        }
    }
}

function showTransferConfirmation(details) {
    const modal = document.getElementById('transfer-confirm-modal');
    const fromBalance = bankBalances[details.fromBank];
    
    if (!fromBalance) return;
    
    // Calculate totals
    const totalDebit = parseFloat(details.amount) + 
        (details.feeBearer === 'sending' ? parseFloat(details.fee || 0) : 0);
    
    // Update modal content
    document.getElementById('confirm-transfer-from').textContent = details.fromBank;
    document.getElementById('confirm-transfer-to').textContent = details.toBank;
    document.getElementById('confirm-transfer-amount').textContent = 
        `${fromBalance.currency === 'USD' ? '$' : 'KSH '}${formatNumber(details.amount)}`;
    document.getElementById('confirm-transfer-fee').textContent = 
        `${fromBalance.currency === 'USD' ? '$' : 'KSH '}${formatNumber(details.fee || 0)}`;
    document.getElementById('confirm-transfer-fee-bearer').textContent = 
        details.feeBearer === 'sending' ? 'Sending Bank' : 'Receiving Bank';
    document.getElementById('confirm-transfer-total').textContent = 
        `${fromBalance.currency === 'USD' ? '$' : 'KSH '}${formatNumber(totalDebit.toFixed(2))}`;
    document.getElementById('confirm-transfer-reason').textContent = details.reason;
    
    modal.classList.remove('hidden');
}

function closeTransferConfirm() {
    const modal = document.getElementById('transfer-confirm-modal');
    modal.classList.add('hidden');
    document.getElementById('transfer-pin').value = '';
}

function executeBankTransfer() {
    const pin = document.getElementById('transfer-pin').value;
    
    // In a real system, you would verify the PIN here
    // For now, we'll just check if it's 4 digits
    if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
        showToast("Please enter a valid 4-digit PIN", "error");
        return;
    }
    
    // Get transfer details from the form
    const fromBank = document.getElementById('transfer-from-bank').value;
    const toBank = document.getElementById('transfer-to-bank').value;
    const amount = document.getElementById('transfer-amount').value;
    const fee = document.getElementById('transfer-fee-input').value || 0;
    const feeBearer = document.getElementById('fee-bearer').value;
    const reason = document.getElementById('transfer-reason').value;
    
    processBankTransfer({
        fromBank,
        toBank,
        amount,
        fee,
        feeBearer,
        reason
    });
}

// Bank PIN Verification
function checkBankAccessCode() {
    const pin = document.getElementById('bank-access-code').value;
    
    // In a real system, you would verify against stored PIN
    // For now, we'll accept any 4-digit PIN
    if (pin && pin.length === 4 && /^\d+$/.test(pin)) {
        isBankPinVerified = true;
        document.getElementById('bank-access-gate').classList.add('hidden');
        document.getElementById('bank-management-content').classList.remove('hidden');
        showToast("Bank management unlocked", "success");
        
        // Initialize bank system if not already
        if (currentUser) {
            initializeBankSystem();
        }
    } else {
        showToast("Please enter a valid 4-digit PIN", "error");
    }
}

// Refresh bank data
async function refreshBankData() {
    if (!currentUser) {
        showToast("Please login to Firebase first", "error");
        return;
    }
    
    showLoading("Refreshing bank data...");
    
    try {
        // Force reload of all data
        await loadReceiptPayments();
        await loadBankLedger();
        calculateAllBankBalances();
        updateBankCards();
        updateTransferDropdowns();
        
        hideLoading();
        showToast("Bank data refreshed successfully", "success");
    } catch (error) {
        hideLoading();
        showToast("Failed to refresh bank data", "error");
    }
}

// Update UI for logged in user
function updateUIForLoggedInUser() {
    const userInfo = document.getElementById('firebase-user-info');
    const loginBtn = document.getElementById('firebase-login-btn');
    const userEmail = document.getElementById('user-email');
    
    if (currentUser) {
        if (userInfo) userInfo.classList.remove('hidden');
        if (loginBtn) {
            loginBtn.textContent = "Connected";
            loginBtn.innerHTML = '<i class="fas fa-cloud mr-2"></i>Connected';
        }
        if (userEmail) userEmail.textContent = currentUser.email;
        
        // Update connection status
        const statusEl = document.getElementById('firebase-connection-status');
        if (statusEl) {
            statusEl.innerHTML = '<span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>Connected as ' + currentUser.email;
        }
    }
}

// Firebase Login
async function firebaseLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    if (!email || !password) {
        showToast("Please enter email and password", "error");
        return;
    }
    
    showLoading("Logging in...");
    
    try {
        const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
        currentUser = userCredential.user;
        showToast("Login successful!", "success");
        toggleFirebaseLogin();
        
        // Initialize bank system
        initializeBankSystem();
    } catch (error) {
        showToast(`Login failed: ${error.message}`, "error");
    } finally {
        hideLoading();
    }
}

function toggleFirebaseLogin() {
    const modal = document.getElementById('login-modal');
    modal.classList.toggle('hidden');
}

// Open opening balance modal
function openOpeningBalanceModal(bankName) {
    const balance = bankBalances[bankName];
    if (!balance) return;
    
    const modal = document.getElementById('opening-balance-modal');
    const detailsContainer = document.getElementById('opening-balance-details');
    
    const currencySymbol = balance.currency === 'USD' ? '$' : 'KSH ';
    const currentDate = new Date().toISOString().split('T')[0];
    
    detailsContainer.innerHTML = `
        <div class="space-y-2">
            <div class="flex justify-between">
                <span class="text-gray-600 dark:text-gray-400">Bank:</span>
                <span class="font-semibold dark:text-white">${bankName}</span>
            </div>
            <div class="flex justify-between">
                <span class="text-gray-600 dark:text-gray-400">Currency:</span>
                <span class="font-semibold ${balance.currency === 'USD' ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'}">
                    ${balance.currency}
                </span>
            </div>
            <div class="flex justify-between">
                <span class="text-gray-600 dark:text-gray-400">Current Opening Balance:</span>
                <span class="font-semibold">${currencySymbol}${formatNumber(balance.openingBalance.toFixed(2))}</span>
            </div>
            <div class="flex justify-between">
                <span class="text-gray-600 dark:text-gray-400">Current Balance:</span>
                <span class="font-semibold ${balance.currentBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
                    ${currencySymbol}${formatNumber(balance.currentBalance.toFixed(2))}
                </span>
            </div>
        </div>
    `;
    
    document.getElementById('opening-currency-symbol').textContent = currencySymbol;
    document.getElementById('opening-balance-date').value = currentDate;
    document.getElementById('opening-balance-amount').value = balance.openingBalance || '';
    
    modal.dataset.bankName = bankName;
    modal.classList.remove('hidden');
}

// Close opening balance modal
function closeOpeningBalanceModal() {
    const modal = document.getElementById('opening-balance-modal');
    modal.classList.add('hidden');
    document.getElementById('opening-balance-form').reset();
    delete modal.dataset.bankName;
}

// Process opening balance submission
async function processOpeningBalance(formData) {
    try {
        const { bankName, amount, date, notes } = formData;
        
        if (!bankName || !amount || !date) {
            throw new Error("Please fill in all required fields");
        }
        
        const balance = parseFloat(amount);
        if (isNaN(balance) || balance < 0) {
            throw new Error("Please enter a valid balance amount");
        }
        
        showLoading("Setting opening balance...");
        
        // Record opening balance timestamp
        openingBalanceTimestamps[bankName] = {
            balance: balance,
            timestamp: new Date(date),
            updatedBy: currentUser?.email || 'Anonymous',
            updatedAt: new Date().toISOString(),
            notes: notes || ''
        };
        
        // Save to Firebase
        await saveProcessedTransactions();
        
        // Recalculate balances
        calculateAllBankBalances();
        updateBankCards();
        updateTransferDropdowns();
        
        hideLoading();
        closeOpeningBalanceModal();
        showToast(`Opening balance for ${bankName} set successfully`, "success");
        
    } catch (error) {
        hideLoading();
        showToast(`Failed to set opening balance: ${error.message}`, "error");
    }
}

// Add a function to show all banks summary
function showAllBanksSummary() {
    const banks = Object.keys(bankBalances);
    if (banks.length === 0) {
        alert('No banks loaded. Please connect to Firebase and refresh data.');
        return;
    }
    
    let summary = `=== ALL BANKS SUMMARY ===\n\n`;
    let totalKES = 0;
    let totalUSD = 0;
    
    banks.sort().forEach(bankName => {
        const balance = bankBalances[bankName];
        const currencySymbol = balance.currency === 'USD' ? '$' : 'KSH ';
        
        summary += `${bankName} (${balance.currency}):\n`;
        summary += `  Current Balance: ${currencySymbol}${formatNumber(balance.currentBalance.toFixed(2))}\n`;
        summary += `  Opening Balance: ${currencySymbol}${formatNumber(balance.openingBalance.toFixed(2))}\n`;
        summary += `  Total Credits: ${currencySymbol}${formatNumber(balance.totalCredits.toFixed(2))}\n`;
        summary += `  Total Debits: ${currencySymbol}${formatNumber(balance.totalDebits.toFixed(2))}\n`;
        
        if (openingBalanceTimestamps[bankName]) {
            summary += `  Opening Set: ${new Date(openingBalanceTimestamps[bankName].timestamp).toLocaleDateString()}\n`;
        } else {
            summary += `  Opening Set: Not configured\n`;
        }
        
        summary += `\n`;
        
        if (balance.currency === 'KES') {
            totalKES += balance.currentBalance;
        } else if (balance.currency === 'USD') {
            totalUSD += balance.currentBalance;
        }
    });
    
    summary += `=== TOTALS ===\n`;
    summary += `Total KSH Funds: KSH ${formatNumber(totalKES.toFixed(2))}\n`;
    summary += `Total USD Funds: $${formatNumber(totalUSD.toFixed(2))}\n`;
    summary += `Total Banks: ${banks.length}\n`;
    summary += `Total Transactions Processed: ${processedTransactions.size}\n`;
    
    // Create a modal to show the summary
    const summaryModal = document.createElement('div');
    summaryModal.className = 'fixed inset-0 z-[99999] flex items-center justify-center';
    summaryModal.innerHTML = `
        <div class="modal-backdrop fixed inset-0"></div>
        <div class="modal-container flex items-center justify-center">
            <div class="modal-content bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl mx-auto p-6 relative z-[99999]">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-gray-800 dark:text-white flex items-center">
                        <i class="fas fa-university mr-3"></i>All Banks Summary
                    </h2>
                    <button onclick="this.closest('.fixed').remove()"
                            class="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 text-2xl">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="mb-6">
                    <div class="grid grid-cols-2 gap-4 mb-6">
                        <div class="bg-green-50 dark:bg-green-900 p-4 rounded-lg">
                            <div class="text-sm text-gray-600 dark:text-gray-400">Total KSH Funds</div>
                            <div class="text-2xl font-bold text-green-600 dark:text-green-400">KSH ${formatNumber(totalKES.toFixed(2))}</div>
                        </div>
                        <div class="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg">
                            <div class="text-sm text-gray-600 dark:text-gray-400">Total USD Funds</div>
                            <div class="text-2xl font-bold text-blue-600 dark:text-blue-400">$${formatNumber(totalUSD.toFixed(2))}</div>
                        </div>
                    </div>
                </div>
                
                <div class="max-h-96 overflow-y-auto">
                    <pre class="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">${summary}</pre>
                </div>
                
                <div class="mt-6 flex justify-end space-x-4">
                    <button onclick="this.closest('.fixed').remove()"
                            class="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-semibold py-2 px-6 rounded-lg transition-all">
                        Close
                    </button>
                    <button onclick="printSummary()"
                            class="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-6 rounded-lg transition-all flex items-center">
                        <i class="fas fa-print mr-2"></i>Print Summary
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(summaryModal);
}

// Add print function
function printSummary() {
    window.print();
}

// Event Listeners and Modal Functions
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Firebase
    initializeFirebase();
    
    // Bank Transfer Form Submission
    const transferForm = document.getElementById('bank-transfer-form');
    if (transferForm) {
        transferForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const fromBank = document.getElementById('transfer-from-bank').value;
            const toBank = document.getElementById('transfer-to-bank').value;
            const amount = document.getElementById('transfer-amount').value;
            const fee = document.getElementById('transfer-fee-input').value || 0;
            const feeBearer = document.getElementById('fee-bearer').value;
            const reason = document.getElementById('transfer-reason').value;
            
            // Show confirmation modal
            showTransferConfirmation({
                fromBank,
                toBank,
                amount,
                fee,
                feeBearer,
                reason
            });
        });
    }
    
    // Bank Withdrawal Form Submission
    const withdrawalForm = document.getElementById('bank-withdrawal-form');
    if (withdrawalForm) {
        withdrawalForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const bankName = document.getElementById('withdrawal-bank').value;
            const amount = document.getElementById('withdrawal-amount').value;
            const category = document.getElementById('withdrawal-category').value;
            const description = document.getElementById('withdrawal-description').value;
            const payee = document.getElementById('withdrawal-payee').value;
            const date = document.getElementById('withdrawal-date').value;
            const reference = document.getElementById('withdrawal-reference').value;
            
            processBankWithdrawal({
                bankName,
                amount,
                category,
                description,
                payee,
                date,
                reference
            });
        });
    }
    
    // Opening Balance Form Submission
    const openingBalanceForm = document.getElementById('opening-balance-form');
    if (openingBalanceForm) {
        openingBalanceForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const modal = document.getElementById('opening-balance-modal');
            const bankName = modal.dataset.bankName;
            const amount = document.getElementById('opening-balance-amount').value;
            const date = document.getElementById('opening-balance-date').value;
            const notes = document.getElementById('opening-balance-notes').value;
            const confirmed = document.getElementById('confirm-opening-balance').checked;
            
            if (!confirmed) {
                alert('Please confirm that the opening balance is accurate');
                return;
            }
            
            if (typeof processOpeningBalance === 'function') {
                processOpeningBalance({
                    bankName,
                    amount,
                    date,
                    notes
                });
            }
        });
    }
    
    // Update balance dropdown change listeners
    const fromBankSelect = document.getElementById('transfer-from-bank');
    const toBankSelect = document.getElementById('transfer-to-bank');
    
    if (fromBankSelect) {
        fromBankSelect.addEventListener('change', updateBalanceDisplays);
    }
    if (toBankSelect) {
        toBankSelect.addEventListener('change', updateBalanceDisplays);
    }
    
    // Set current date for all date inputs
    const today = new Date().toISOString().split('T')[0];
    const dateInputs = document.querySelectorAll('input[type="date"]');
    dateInputs.forEach(input => {
        if (!input.value) {
            input.value = today;
        }
    });
    
    // Initialize tab functionality
    const bankTab = document.querySelector('[onclick*="bank-management"]');
    if (bankTab) {
        bankTab.classList.add('active');
    }
    
    const bankContent = document.getElementById('bank-management');
    if (bankContent) {
        bankContent.classList.add('active');
    }
});

// Remove the duplicate initialization
// if (document.readyState === 'loading') {
//     document.addEventListener('DOMContentLoaded', initializeFirebase);
// } else {
//     initializeFirebase();
// }
