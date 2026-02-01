// script.js - Enhanced Bank Ledger System with Complete Features

// 1. Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyCuUKCxYx0jYKqWOQaN82K5zFGlQsKQsK0",
    authDomain: "ck-manager-1abdc.firebasestorage.app",
    projectId: "ck-manager-1abdc",
    storageBucket: "ck-manager-1abdc.firebasestorage.app",
    messagingSenderId: "890017473158",
    appId: "1:890017473158:web:528e1eebc4b67bd54ca707",
    measurementId: "G-7Z71W1NSX4"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();

// Global State with enhanced tracking
let state = {
    user: null,
    banks: [],
    ledger: [],
    balances: {},
    stats: {
        totalKES: 0,
        totalUSD: 0,
        todayTransactions: 0,
        totalTransactions: 0
    },
    lastSyncTime: null,
    systemReady: false,
    isBankPinVerified: false,
    bankPin: '1234', // Default PIN
    processedTransactions: new Set(),
    openingBalanceTimestamps: {},
    bankDetails: [],
    expenseCategories: [], // From Excel
    customRecipients: [], // Custom recipients
    expenseSummary: {}, // Category -> total amount
    chartInstance: null // Chart.js instance
};

// Expense categories from Excel
const EXPENSE_CATEGORIES = [
    "Audit & Accountancy Fees",
    "Bank & Mpesa Charges",
    "Cleaning Expense",
    "Commissions and fees",
    "Computer Expenses",
    "Director's Fees",
    "fuel (companys car)",
    "fuel (clients Car)",
    "general and admin expense",
    "HOUSING LEVY",
    "Legal and professional fees",
    "Loan payments",
    "Management compensation",
    "Marketing Expense",
    "Meals and entertainment",
    "Motorvehicle Repairs",
    "NSSF",
    "Office expenses",
    "Other general and administrative expenses",
    "Parking Expenses",
    "PAYE",
    "Postage",
    "Printing & Stationary",
    "Purchase of fixed assets",
    "Rent or lease payments",
    "Repairs and Maintenance",
    "Salaries and Wages",
    "SHA",
    "Staff Wellfare",
    "Stationery and printing",
    "Supplies",
    "Telephone & Internet",
    "Transport Expense",
    "Travel expenses",
    "Vendor payments",
    "Water & Electricity Expense"
];

// Initialize expense categories
state.expenseCategories = EXPENSE_CATEGORIES;

// --- UTILITY FUNCTIONS ---

function showLoading(show, text = "Loading...") {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    
    if (overlay && loadingText) {
        loadingText.textContent = text;
        overlay.classList.toggle('hidden', !show);
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast bg-white border-l-4 ${type === 'success' ? 'border-green-500' : type === 'error' ? 'border-red-500' : 'border-blue-500'} shadow-lg rounded-lg p-4 mb-2`;
    toast.innerHTML = `
        <div class="flex items-center">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'} 
               ${type === 'success' ? 'text-green-500' : type === 'error' ? 'text-red-500' : 'text-blue-500'} mr-3"></i>
            <div>
                <p class="font-medium text-gray-800">${message}</p>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-auto text-gray-400 hover:text-gray-600">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    container.appendChild(toast);
    
    // Show animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

function formatNumber(num) {
    if (num === null || num === undefined) return '0.00';
    return parseFloat(num).toLocaleString('en-US', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    });
}

function formatCurrency(amount, currency = 'KES') {
    if (amount === null || amount === undefined) amount = 0;
    const symbol = currency === 'USD' ? '$' : 'KES ';
    return `${symbol}${formatNumber(amount)}`;
}

function updateSystemStatus(connected = false) {
    const statusEl = document.getElementById('firebase-connection-status');
    if (statusEl) {
        const dot = statusEl.querySelector('span');
        const text = connected ? 'Connected' : 'Not Connected';
        if (dot) {
            dot.className = `inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'} mr-2`;
            statusEl.innerHTML = `${dot.outerHTML} ${text}`;
        }
    }
    
    const healthEl = document.getElementById('system-health-status');
    if (healthEl) {
        if (connected && state.systemReady) {
            healthEl.className = 'bg-green-50 border border-green-200 rounded-lg p-4 mb-6';
            healthEl.innerHTML = `
                <div class="flex items-center">
                    <i class="fas fa-check-circle text-green-500 mr-3"></i>
                    <span class="font-medium text-green-800">System Ready</span>
                </div>
            `;
        } else {
            healthEl.className = 'bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6';
            healthEl.innerHTML = `
                <div class="flex items-center">
                    <i class="fas fa-exclamation-triangle text-yellow-500 mr-3"></i>
                    <span class="font-medium text-yellow-800">System Initializing</span>
                </div>
            `;
        }
    }
}

function updateLastSyncTime() {
    state.lastSyncTime = new Date();
    const syncTimeEl = document.getElementById('last-sync-time');
    if (syncTimeEl) {
        syncTimeEl.textContent = state.lastSyncTime.toLocaleTimeString();
    }
    
    const lastUpdatedEl = document.getElementById('last-updated');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = `Last updated: ${state.lastSyncTime.toLocaleTimeString()}`;
    }
}

function updateStatistics() {
    // Calculate statistics
    state.stats.totalKES = 0;
    state.stats.totalUSD = 0;
    state.stats.todayTransactions = 0;
    
    state.banks.forEach(bank => {
        const balance = state.balances[bank.id] || 0;
        if (bank.currency === 'USD') {
            state.stats.totalUSD += balance;
        } else {
            state.stats.totalKES += balance;
        }
    });
    
    // Count today's transactions
    const today = new Date().toDateString();
    state.stats.todayTransactions = state.ledger.filter(tx => {
        return new Date(tx.date).toDateString() === today;
    }).length;
    
    state.stats.totalTransactions = state.ledger.length;
    
    // Update UI
    const statsActiveBanks = document.getElementById('stats-active-banks');
    const statsTotalKes = document.getElementById('stats-total-kes');
    const statsTotalUsd = document.getElementById('stats-total-usd');
    const statsTodayTransactions = document.getElementById('stats-today-transactions');
    const transactionsCount = document.getElementById('transactions-count');
    
    if (statsActiveBanks) statsActiveBanks.textContent = state.banks.length;
    if (statsTotalKes) statsTotalKes.textContent = formatCurrency(state.stats.totalKES, 'KES');
    if (statsTotalUsd) statsTotalUsd.textContent = formatCurrency(state.stats.totalUSD, 'USD');
    if (statsTodayTransactions) statsTodayTransactions.textContent = state.stats.todayTransactions;
    if (transactionsCount) transactionsCount.textContent = `${state.processedTransactions.size} transactions`;
    
    // Update progress bars
    const maxBanks = Math.max(10, state.banks.length);
    const banksProgress = Math.min((state.banks.length / maxBanks) * 100, 100);
    const statsBanksProgress = document.getElementById('stats-banks-progress');
    if (statsBanksProgress) statsBanksProgress.style.width = `${banksProgress}%`;
    
    const maxTransactions = Math.max(100, state.stats.todayTransactions * 2);
    const transactionsProgress = Math.min((state.stats.todayTransactions / maxTransactions) * 100, 100);
    const statsTransactionsProgress = document.getElementById('stats-transactions-progress');
    if (statsTransactionsProgress) statsTransactionsProgress.style.width = `${transactionsProgress}%`;
}

// --- BANK PIN VERIFICATION ---

function checkBankAccessCode() {
    const pinInput = document.getElementById('bank-access-code');
    if (!pinInput) return;
    
    const pin = pinInput.value;
    
    // Verify PIN
    if (pin && pin.length === 4 && /^\d+$/.test(pin)) {
        if (pin === state.bankPin) {
            state.isBankPinVerified = true;
            
            // Hide the gate and show bank management content
            const gate = document.getElementById('bank-access-gate');
            const content = document.getElementById('bank-management-content');
            
            if (gate) {
                gate.style.display = 'none';
            }
            if (content) {
                content.classList.remove('hidden');
            }
            
            showToast("Bank management unlocked successfully!", "success");
            
            // Initialize bank system if user is logged in
            if (state.user) {
                initApp();
            }
        } else {
            showToast("Invalid PIN. Please try again.", "error");
            pinInput.value = '';
            pinInput.focus();
        }
    } else {
        showToast("Please enter a valid 4-digit PIN", "error");
        pinInput.value = '';
        pinInput.focus();
    }
}

// --- AUTHENTICATION ---

auth.onAuthStateChanged(user => {
    state.user = user;
    const loginModal = document.getElementById('login-modal');
    const authSection = document.getElementById('auth-section');
    const firebaseUserInfo = document.getElementById('firebase-user-info');
    const bankAccessGate = document.getElementById('bank-access-gate');
    
    if (user) {
        // Update UI
        const userEmail = document.getElementById('user-email');
        const loginBtn = document.getElementById('login-btn');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (userEmail) userEmail.textContent = user.email;
        if (loginBtn) loginBtn.classList.add('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
        if (firebaseUserInfo) firebaseUserInfo.classList.remove('hidden');
        
        if (loginModal) loginModal.classList.add('hidden');
        
        // Show PIN gate
        if (bankAccessGate) {
            bankAccessGate.style.display = 'flex';
        }
        
        // Hide bank management content until PIN is verified
        const content = document.getElementById('bank-management-content');
        if (content) {
            content.classList.add('hidden');
        }
        
        // Update system status
        updateSystemStatus(true);
        showToast(`Welcome back, ${user.email.split('@')[0]}!`, "success");
        
        // Load processed transactions
        loadProcessedTransactions().then(() => {
            // If PIN is already verified, initialize app
            if (state.isBankPinVerified) {
                initApp();
            }
        });
    } else {
        if (loginModal) loginModal.classList.remove('hidden');
        const loginBtn = document.getElementById('login-btn');
        const logoutBtn = document.getElementById('logout-btn');
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (logoutBtn) logoutBtn.classList.add('hidden');
        if (firebaseUserInfo) firebaseUserInfo.classList.add('hidden');
        
        // Hide PIN gate and bank management content
        if (bankAccessGate) {
            bankAccessGate.style.display = 'none';
        }
        const content = document.getElementById('bank-management-content');
        if (content) {
            content.classList.add('hidden');
        }
        
        // Update system status
        updateSystemStatus(false);
        
        // Reset PIN verification
        state.isBankPinVerified = false;
    }
});

function login() {
    const email = document.getElementById('l-email').value;
    const password = document.getElementById('l-password').value;
    const errorEl = document.getElementById('login-error');
    
    if (!email || !password) {
        errorEl.textContent = 'Please enter both email and password';
        errorEl.classList.remove('hidden');
        return;
    }
    
    showLoading(true, 'Signing in...');
    
    auth.signInWithEmailAndPassword(email, password)
        .then(() => {
            errorEl.classList.add('hidden');
            showToast('Login successful!', 'success');
        })
        .catch(error => {
            errorEl.textContent = error.message;
            errorEl.classList.remove('hidden');
            showToast('Login failed: ' + error.message, 'error');
        })
        .finally(() => {
            showLoading(false);
        });
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        showLoading(true, 'Logging out...');
        auth.signOut()
            .then(() => {
                state.isBankPinVerified = false;
                showToast('Logged out successfully', 'success');
            })
            .catch(error => {
                showToast('Logout error: ' + error.message, 'error');
            })
            .finally(() => {
                showLoading(false);
            });
    }
}

function toggleLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
        modal.classList.toggle('hidden');
    }
}

// --- PROCESSED TRANSACTIONS MANAGEMENT ---

async function loadProcessedTransactions() {
    try {
        if (!state.user) return;
        
        const procSnap = await db.collection('processedTransactions')
            .doc(state.user.uid)
            .get();
        
        if (procSnap.exists) {
            const data = procSnap.data();
            state.processedTransactions = new Set(data.transactionIds || []);
            state.openingBalanceTimestamps = data.openingBalanceTimestamps || {};
            console.log(`Loaded ${state.processedTransactions.size} processed transactions`);
        }
    } catch (error) {
        console.error("Error loading processed transactions:", error);
    }
}

async function saveProcessedTransactions() {
    try {
        if (!state.user) return;
        
        await db.collection('processedTransactions')
            .doc(state.user.uid)
            .set({
                transactionIds: Array.from(state.processedTransactions),
                openingBalanceTimestamps: state.openingBalanceTimestamps,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
    } catch (error) {
        console.error("Error saving processed transactions:", error);
    }
}

// --- EXPENSE CATEGORIES MANAGEMENT ---

function populateExpenseCategories() {
    const categorySelects = [
        'expense-category',
        'credit-category'
    ];
    
    categorySelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        
        select.innerHTML = '<option value="">Select Category</option>';
        state.expenseCategories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            select.appendChild(option);
        });
        
        // Add custom recipient option
        const customOption = document.createElement('option');
        customOption.value = "custom";
        customOption.textContent = "Custom Recipient";
        select.appendChild(customOption);
    });
}

// --- INITIALIZATION & DATA LOADING ---

async function initApp() {
    console.log("Initializing App...");
    showLoading(true, "Loading bank data...");
    
    try {
        // Update sync status
        const syncStatus = document.getElementById('sync-status-text');
        if (syncStatus) syncStatus.textContent = 'Loading bank data...';
        
        // Load data in parallel
        const [banksData, ledgerData] = await Promise.all([
            loadBanks(),
            loadLedger()
        ]);
        
        // Process receipt payments
        await processReceiptPayments();
        
        // Calculate balances
        calculateBalances();
        
        // Calculate expense summary
        calculateExpenseSummary();
        
        // Update UI
        renderDashboard();
        updateStatistics();
        updateLastSyncTime();
        
        // Populate expense categories
        populateExpenseCategories();
        
        // Update expense tab
        renderExpenseSummary();

        // Initialize reports if reports tab is active
if (document.getElementById('reports')) {
    const reportsTab = document.getElementById('reports');
    if (reportsTab.classList.contains('active')) {
        initializeReports();
    }
}

        
        // Mark system as ready
        state.systemReady = true;
        updateSystemStatus(true);
        
        showToast('System initialized successfully!', 'success');
    } catch (error) {
        console.error("Init failed", error);
        showToast('Failed to load data: ' + error.message, 'error');
    } finally {
        showLoading(false);
        
        // Update sync status
        const syncStatus = document.getElementById('sync-status-text');
        if (syncStatus) syncStatus.textContent = 'Data loaded successfully';
    }
}

async function loadBanks() {
    try {
        const snap = await db.collection('bankDetails').get();
        state.banks = snap.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data() 
        }));
        
        // Also store in separate array for compatibility
        state.bankDetails = state.banks.map(bank => ({
            id: bank.id,
            name: bank.name,
            currency: bank.currency || 'KES',
            openingBalance: bank.openingBalanceConfig?.amount || 0,
            lastUpdated: new Date()
        }));
        
        console.log(`Loaded ${state.banks.length} banks`);
        
        // Update bank selects in modals
        updateBankSelects();
        
        // Show/hide no banks message
        const noBanksMsg = document.getElementById('no-banks-message');
        const bankCardsLoading = document.getElementById('bank-cards-loading');
        if (noBanksMsg) noBanksMsg.classList.toggle('hidden', state.banks.length > 0);
        if (bankCardsLoading) bankCardsLoading.classList.toggle('hidden', state.banks.length > 0);
        
        return state.banks;
    } catch (error) {
        console.error("Failed to load banks:", error);
        throw error;
    }
}

async function loadLedger() {
    try {
        // Load all ledger entries ordered by date (newest first)
        const snap = await db.collection('bankLedger')
            .orderBy('date', 'desc')
            .limit(1000)
            .get();
        
        // Don't filter transactions here anymore
        // Store all transactions and let calculateBalances() handle the filtering
        state.ledger = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        console.log(`Loaded ${state.ledger.length} ledger entries`);
        renderLedgerTable();
        
        return state.ledger;
    } catch (error) {
        console.error("Failed to load ledger:", error);
        throw error;
    }
}

// --- RECEIPT PAYMENTS PROCESSING ---

async function processReceiptPayments() {
    try {
        const receiptsSnap = await db.collection('receipt_payments')
            .orderBy('createdAt', 'desc')
            .limit(200)
            .get();
        
        const batch = db.batch();
        let newCount = 0;
        let skippedCount = 0;
        
        for (const doc of receiptsSnap.docs) {
            const transactionId = doc.id;
            
            // Skip if already processed
            if (state.processedTransactions.has(transactionId)) {
                skippedCount++;
                continue;
            }
                    
            const data = doc.data();
            // Check for KSH amount first, then USD, then generic amount
            let amount = 0;
            
            // Try to extract currency from payment method or data
            const paymentMethod = data.paymentMethod || '';
            const isUSD = paymentMethod.toLowerCase().includes('usd') || 
                          (data.currency && data.currency.toUpperCase() === 'USD');
            
            if (isUSD) {
                amount = parseFloat(data.amountUSD || data.amount || 0);
            } else {
                // Default to KSH for everything else
                amount = parseFloat(data.amountKSH || data.amount || 0);
            }
            
            if (amount === 0 || isNaN(amount)) {
                skippedCount++;
                continue;
            }
                    
            // Parse bank name from payment method
            const bankName = parseBankName(data.paymentMethod);
            if (!bankName) {
                console.warn(`Could not parse bank name from: ${data.paymentMethod}`);
                skippedCount++;
                continue;
            }
                    
            // Find matching bank
            const targetBank = state.banks.find(bank => 
                bank.name.toLowerCase().includes(bankName.toLowerCase()) ||
                bankName.toLowerCase().includes(bank.name.toLowerCase())
            );
                    
            if (!targetBank) {
                console.warn(`No matching bank found for: ${bankName}`);
                skippedCount++;
                continue;
            }

            // IMPORTANT: Get the actual receipt date, not just created/processed date
            // Use paymentDate if available, otherwise createdAt
            const receiptDate = data.paymentDate || data.createdAt || new Date();
            const receiptDateTime = new Date(receiptDate).getTime();
            
            // Check opening balance cutoff for this bank
            const bankNameForOpening = targetBank.name;
            const openingConfig = state.openingBalanceTimestamps[bankNameForOpening] || 
                                 (targetBank.openingBalanceConfig ? {
                                     timestamp: targetBank.openingBalanceConfig.dateString,
                                     balance: targetBank.openingBalanceConfig.amount
                                 } : null);
            
            if (openingConfig && openingConfig.timestamp) {
                const cutoffDateTime = new Date(openingConfig.timestamp).getTime();
                
                // Skip if receipt is BEFORE opening balance cutoff date/time
                if (receiptDateTime < cutoffDateTime) {
                    console.log(`Skipping receipt ${doc.id} (${new Date(receiptDate)}) before opening balance cutoff (${new Date(cutoffDateTime)}) for bank ${bankNameForOpening}`);
                    // Still mark as processed so we don't try again
                    state.processedTransactions.add(transactionId);
                    await saveProcessedTransactions();
                    skippedCount++;
                    continue;
                }
            }
                    
            // Create ledger entry with proper date
            const ledgerRef = db.collection('bankLedger').doc();
            batch.set(ledgerRef, {
                date: receiptDate, // Use the actual receipt/payment date
                type: 'receipt',
                amount: amount,
                bankId: targetBank.id,
                bankName: targetBank.name,
                currency: isUSD ? 'USD' : (data.currency || targetBank.currency || 'KES'),
                description: `Receipt #${data.receiptNumber || 'N/A'} - ${data.description || data.customerName || ''}`,
                sourceDocId: doc.id,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                userId: state.user?.uid,
                userEmail: state.user?.email
            });
                    
            state.processedTransactions.add(transactionId);
            newCount++;
        }
        
        // Commit batch if we have new receipts
        if (newCount > 0) {
            await batch.commit();
            
            // Save processed transactions
            await saveProcessedTransactions();
            
            // Reload ledger to include new entries
            await loadLedger();
            
            console.log(`Processed ${newCount} new receipts, ${skippedCount} skipped`);
        }
        
        return { newCount, skippedCount };
    } catch (error) {
        console.error("Error processing receipt payments:", error);
        return { newCount: 0, skippedCount: 0 };
    }
}

function parseBankName(paymentMethod) {
    if (!paymentMethod) return '';
    
    // Remove common prefixes and suffixes
    return paymentMethod
        .replace(/^Bank:\s*/i, '')
        .replace(/\s*\(USD\)/i, '')
        .replace(/\s*\(KES\)/i, '')
        .replace(/\s*-\s*.*$/i, '')
        .trim();
}

// --- BANK SELECTS UPDATES ---

function updateBankSelects() {
    const selects = [
        't-from-enhanced', 't-to-enhanced', 
        'expense-bank', 'credit-bank',
        'w-bank'
    ];
    
    selects.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        
        select.innerHTML = '<option value="">Select Bank</option>';
        state.banks.forEach(bank => {
            const balance = state.balances[bank.id] || 0;
            const option = document.createElement('option');
            option.value = bank.id;
            option.textContent = `${bank.name} (${bank.currency} ${formatNumber(balance)})`;
            select.appendChild(option);
        });
        
        // Add event listeners for balance display
        if (id.includes('from') || id === 'expense-bank' || id === 'credit-bank' || id === 'w-bank') {
            select.addEventListener('change', function() {
                const balanceId = id === 't-from-enhanced' ? 't-from-balance-enhanced' :
                                 id === 'expense-bank' ? 'expense-bank-balance' :
                                 id === 'credit-bank' ? 'credit-bank-balance' :
                                 `${id}-balance`;
                updateBankBalanceDisplay(this.value, balanceId);
            });
        }
    });
}

function updateBankBalanceDisplay(bankId, elementId) {
    const balanceEl = document.getElementById(elementId);
    if (!balanceEl) return;
    
    const bank = state.banks.find(b => b.id === bankId);
    if (bank) {
        const balance = state.balances[bankId] || 0;
        balanceEl.textContent = `Available: ${formatCurrency(balance, bank.currency)}`;
        balanceEl.className = `text-sm ${balance >= 0 ? 'text-green-600' : 'text-red-600'} font-medium mt-1`;
    } else {
        balanceEl.textContent = '';
    }
}

// --- CORE CALCULATIONS ---

function calculateBalances() {
    // Reset balances
    state.balances = {};
    
    // Initialize each bank with 0 or opening balance
    state.banks.forEach(bank => {
        let cutoffDateTime = null;
        let startBalance = 0;
        
        // Check for opening balance configuration from timestamps
        if (state.openingBalanceTimestamps[bank.name]) {
            startBalance = state.openingBalanceTimestamps[bank.name].balance || 0;
            if (state.openingBalanceTimestamps[bank.name].timestamp) {
                cutoffDateTime = new Date(state.openingBalanceTimestamps[bank.name].timestamp).getTime();
            }
        }
        // Fallback to bankDetails openingBalanceConfig
        else if (bank.openingBalanceConfig && bank.openingBalanceConfig.amount) {
            startBalance = parseFloat(bank.openingBalanceConfig.amount) || 0;
            if (bank.openingBalanceConfig.dateString) {
                cutoffDateTime = new Date(bank.openingBalanceConfig.dateString).getTime();
            }
        }
        
        // Start with opening balance
        state.balances[bank.id] = startBalance;
        
        // Get all transactions for this bank
        const bankTransactions = state.ledger
            .filter(tx => tx.bankId === bank.id || tx.toBankId === bank.id)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        // Process each transaction
        bankTransactions.forEach(tx => {
            const txDateTime = new Date(tx.date).getTime();
            const amount = parseFloat(tx.amount) || 0;
            
            // Skip if transaction is BEFORE cutoff date/time (strictly less than)
            // Transactions AT or AFTER the cutoff date/time should be included
            if (cutoffDateTime && txDateTime < cutoffDateTime) {
                console.log(`Skipping transaction ${tx.id} at ${new Date(tx.date)} for bank ${bank.name} - before cutoff ${new Date(cutoffDateTime)}`);
                return;
            }
            
            // Process based on transaction type
            switch (tx.type) {
                case 'receipt':
                    if (tx.bankId === bank.id) {
                        state.balances[bank.id] += amount;
                    }
                    break;
                    
                case 'withdrawal':
                case 'expense':
                case 'credit':
                    if (tx.bankId === bank.id) {
                        state.balances[bank.id] -= amount;
                    }
                    break;
                    
                case 'transfer':
                    // Outgoing transfer
                    if (tx.bankId === bank.id) {
                        state.balances[bank.id] -= amount;
                        // Deduct transaction fee if sender bears it
                        if (tx.transactionFee && tx.transactionFeeBearer === 'sender' && tx.feeAmount) {
                            state.balances[bank.id] -= parseFloat(tx.feeAmount);
                        }
                    }
                    // Incoming transfer
                    if (tx.toBankId === bank.id) {
                        state.balances[bank.id] += amount;
                        // Deduct transaction fee if receiver bears it
                        if (tx.transactionFee && tx.transactionFeeBearer === 'receiver' && tx.feeAmount) {
                            state.balances[bank.id] -= parseFloat(tx.feeAmount);
                        }
                    }
                    break;
                    
                default:
                    console.warn('Unknown transaction type:', tx.type);
            }
        });
        
        console.log(`Final balance for ${bank.name}: ${state.balances[bank.id]} (opening: ${startBalance}, cutoff: ${cutoffDateTime ? new Date(cutoffDateTime) : 'none'})`);
    });
}

// --- EXPENSE SUMMARY CALCULATIONS ---

function calculateExpenseSummary() {
    // Reset expense summary
    state.expenseSummary = {};
    state.customRecipients = [];
    
    // Initialize all categories with zero
    state.expenseCategories.forEach(category => {
        state.expenseSummary[category] = 0;
    });
    
    // Process ledger for expenses
    state.ledger.forEach(tx => {
        if (tx.type === 'expense' || tx.type === 'credit') {
            const amount = parseFloat(tx.amount) || 0;
            
            // Check if it's a category expense or custom recipient
            if (tx.category && state.expenseSummary.hasOwnProperty(tx.category)) {
                state.expenseSummary[tx.category] += amount;
            } else if (tx.recipientName) {
                // Custom recipient
                const existingRecipient = state.customRecipients.find(r => r.name === tx.recipientName);
                if (existingRecipient) {
                    existingRecipient.total += amount;
                    existingRecipient.transactions++;
                } else {
                    state.customRecipients.push({
                        name: tx.recipientName,
                        total: amount,
                        transactions: 1,
                        type: tx.recipientType || 'custom'
                    });
                }
            }
        }
    });
}

// --- SYNC ENGINE ---

async function syncReceipts() {
    const btn = document.getElementById('sync-icon') || document.querySelector('[onclick="syncReceipts()"] i');
    const syncText = document.getElementById('sync-text') || document.querySelector('[onclick="syncReceipts()"] span');
    
    if (btn) btn.classList.add('fa-spin');
    if (syncText) syncText.textContent = "Processing...";
    
    showLoading(true, "Syncing receipts...");
    
    try {
        const result = await processReceiptPayments();
        
        if (result.newCount > 0) {
            // Recalculate balances
            calculateBalances();
            
            // Update UI
            renderDashboard();
            updateStatistics();
            
            showToast(`Successfully synced ${result.newCount} new receipts. ${result.skippedCount} skipped.`, 'success');
        } else {
            showToast("No new receipts found to sync.", 'info');
        }

    } catch (error) {
        console.error("Sync Error:", error);
        showToast("Sync Error: " + error.message, 'error');
    } finally {
        if (btn) btn.classList.remove('fa-spin');
        if (syncText) syncText.textContent = "Sync Receipts";
        showLoading(false);
    }
}

// --- TRANSFER WITH TRANSACTION FEES (NEW FEATURE) ---

document.getElementById('transfer-form-enhanced')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const fromId = document.getElementById('t-from-enhanced').value;
    const toId = document.getElementById('t-to-enhanced').value;
    const amount = parseFloat(document.getElementById('t-amount-enhanced').value);
    const desc = document.getElementById('t-desc-enhanced').value;
    const feeAmount = parseFloat(document.getElementById('t-fee-enhanced').value) || 0;
    const feeBearer = document.querySelector('input[name="fee-bearer"]:checked').value;
    
    // Validation
    if (!fromId || !toId) {
        showToast('Please select both source and destination banks', 'error');
        return;
    }
    
    if (fromId === toId) {
        showToast('Cannot transfer to the same bank account', 'error');
        return;
    }
    
    if (!amount || amount <= 0 || isNaN(amount)) {
        showToast('Please enter a valid amount', 'error');
        return;
    }
    
    const fromBank = state.banks.find(b => b.id === fromId);
    const toBank = state.banks.find(b => b.id === toId);
    
    if (!fromBank || !toBank) {
        showToast('Invalid bank selection', 'error');
        return;
    }
    
    // Check balance (including fee if sender bears it)
    const currentBalance = state.balances[fromId] || 0;
    const totalDeduction = amount + (feeBearer === 'sender' ? feeAmount : 0);
    
    if (currentBalance < totalDeduction) {
        showToast(`Insufficient funds. Available: ${formatCurrency(currentBalance, fromBank.currency)}`, 'error');
        return;
    }
    
    showLoading(true, 'Processing transfer...');
    
    try {
        const transferDate = new Date().toISOString();
        const reference = `TRX-${Date.now()}`;
        
        // Add main transfer ledger entry
        await db.collection('bankLedger').add({
            type: 'transfer',
            date: transferDate,
            amount: amount,
            bankId: fromId,
            bankName: fromBank.name,
            toBankId: toId,
            toBankName: toBank.name,
            currency: fromBank.currency,
            description: `Transfer: ${desc}`,
            reference: reference,
            transactionFee: feeAmount > 0,
            feeAmount: feeAmount,
            transactionFeeBearer: feeBearer,
            createdBy: state.user?.email || 'Unknown',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'completed',
            userId: 'global'
        });
        
        // Add transaction fee entry if applicable
        if (feeAmount > 0) {
            await db.collection('bankLedger').add({
                type: 'transfer_fee',
                date: transferDate,
                amount: feeAmount,
                bankId: feeBearer === 'sender' ? fromId : toId,
                bankName: feeBearer === 'sender' ? fromBank.name : toBank.name,
                currency: feeBearer === 'sender' ? fromBank.currency : toBank.currency,
                description: `Transaction fee for transfer ${reference}: ${desc}`,
                reference: `FEE-${reference}`,
                relatedTransferRef: reference,
                createdBy: state.user?.email || 'Unknown',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                status: 'completed',
                userId: 'global'
            });
        }
        
        closeModal('transfer-modal-enhanced');
        document.getElementById('transfer-form-enhanced').reset();
        
        // Refresh data
        await initApp();
        
        showToast(`Transfer of ${formatCurrency(amount, fromBank.currency)} completed with ${formatCurrency(feeAmount, fromBank.currency)} fee!`, 'success');
    } catch (error) {
        showToast('Transfer failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
});

// --- EXPENSE PAYMENT (NEW FEATURE) ---

document.getElementById('expense-payment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const bankId = document.getElementById('expense-bank').value;
    const category = document.getElementById('expense-category').value;
    const customRecipient = document.getElementById('expense-custom-recipient').value;
    const amount = parseFloat(document.getElementById('expense-amount').value);
    const desc = document.getElementById('expense-desc').value;
    const reference = document.getElementById('expense-reference').value;
    
    // Validation
    if (!bankId) {
        showToast('Please select a bank account', 'error');
        return;
    }
    
    if (!category && !customRecipient) {
        showToast('Please select a category or enter a custom recipient', 'error');
        return;
    }
    
    if (!amount || amount <= 0 || isNaN(amount)) {
        showToast('Please enter a valid amount', 'error');
        return;
    }
    
    const bank = state.banks.find(b => b.id === bankId);
    if (!bank) {
        showToast('Invalid bank selection', 'error');
        return;
    }
    
    // Check balance
    const currentBalance = state.balances[bankId] || 0;
    if (currentBalance < amount) {
        showToast(`Insufficient funds. Available: ${formatCurrency(currentBalance, bank.currency)}`, 'error');
        return;
    }
    
    showLoading(true, 'Recording expense...');
    
    try {
        const recipientName = customRecipient || category;
        const recipientType = customRecipient ? 'custom' : 'category';
        
        await db.collection('bankLedger').add({
            type: 'expense',
            date: new Date().toISOString(),
            amount: amount,
            bankId: bankId,
            bankName: bank.name,
            currency: bank.currency,
            category: category,
            recipientName: recipientName,
            recipientType: recipientType,
            description: desc,
            reference: reference,
            createdBy: state.user?.email || 'Unknown',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'completed',
            userId: 'global'
        });
        
        closeModal('expense-payment-modal');
        document.getElementById('expense-payment-form').reset();
        
        // Refresh data
        await initApp();
        
        showToast(`Expense of ${formatCurrency(amount, bank.currency)} recorded successfully!`, 'success');
    } catch (error) {
        showToast('Expense recording failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
});

// --- UI RENDERING ---
function renderDashboard() {
    const container = document.getElementById('bank-cards-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (state.banks.length === 0) {
        const noBanksMsg = document.getElementById('no-banks-message');
        if (noBanksMsg) noBanksMsg.classList.remove('hidden');
        return;
    }
    
    state.banks.forEach(bank => {
        const balance = state.balances[bank.id] || 0;
        const isUSD = bank.currency === 'USD';
        const colorClass = isUSD ? 'border-l-4 border-blue-500' : 'border-l-4 border-green-500';
        const iconClass = isUSD ? 'text-blue-500' : 'text-green-500';
        const balanceClass = balance >= 0 ? 'text-gray-900' : 'text-red-600';
        
        // Check if opening balance is set via timestamps
        const hasOpeningTimestamp = !!state.openingBalanceTimestamps[bank.name];
        const openingBalance = hasOpeningTimestamp ? 
            state.openingBalanceTimestamps[bank.name].balance : 
            (bank.openingBalanceConfig?.amount || 0);
        
        // Calculate credits and debits for this bank
        const bankTransactions = state.ledger.filter(tx => 
            tx.bankId === bank.id || tx.toBankId === bank.id
        );
        
        let totalCredits = 0;
        let totalDebits = 0;
        
        bankTransactions.forEach(tx => {
            const amount = parseFloat(tx.amount) || 0;
            if (tx.type === 'receipt' || (tx.type === 'transfer' && tx.toBankId === bank.id)) {
                totalCredits += amount;
            } else if (tx.type === 'withdrawal' || tx.type === 'expense' || tx.type === 'credit' || (tx.type === 'transfer' && tx.bankId === bank.id)) {
                totalDebits += amount;
            }
        });
        
        const card = document.createElement('div');
        card.className = `bg-white rounded-xl shadow-sm p-6 bank-card ${colorClass} hover:shadow-lg transition-all duration-300`;
        card.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h3 class="font-bold text-gray-800 text-lg">${bank.name}</h3>
                    <p class="text-xs text-gray-500 mt-1">${bank.accountNumber || 'Account not specified'}</p>
                </div>
                <div class="bg-gray-50 p-2 rounded-full">
                    <span class="font-bold text-sm ${iconClass}">${bank.currency}</span>
                </div>
            </div>
            
            <div class="mb-6">
                <div class="text-2xl font-bold ${balanceClass}">
                    ${isUSD ? '$' : 'KES'} ${formatNumber(balance)}
                </div>
                <p class="text-xs text-gray-500 mt-1">Current Balance</p>
            </div>
            
            <div class="grid grid-cols-2 gap-4 text-sm mb-6">
                <div>
                    <div class="text-gray-500">Opening Balance</div>
                    <div class="font-medium">
                        ${isUSD ? '$' : 'KES'} ${formatNumber(openingBalance)}
                        ${hasOpeningTimestamp ? 
                            `<span class="text-xs text-green-500 ml-1" title="Opening balance set"><i class="fas fa-check-circle"></i></span>` : 
                            `<span class="text-xs text-yellow-500 ml-1" title="No opening balance set"><i class="fas fa-exclamation-circle"></i></span>`
                        }
                    </div>
                </div>
                <div>
                    <div class="text-gray-500">Total Credits</div>
                    <div class="font-medium text-green-600">${isUSD ? '$' : 'KES'} ${formatNumber(totalCredits)}</div>
                </div>
                <div>
                    <div class="text-gray-500">Total Debits</div>
                    <div class="font-medium text-red-600">${isUSD ? '$' : 'KES'} ${formatNumber(totalDebits)}</div>
                </div>
                <div>
                    <div class="text-gray-500">Transactions</div>
                    <div class="font-medium">${bankTransactions.length} entries</div>
                </div>
            </div>
            
            <div class="flex space-x-2">
    <button onclick="showExpensePaymentModal('${bank.id}')" 
            class="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2 px-3 rounded-lg transition-all">
        <i class="fas fa-money-check-alt mr-1"></i> Expense
    </button>
    <button onclick="openOpeningModal('${bank.id}')" 
            class="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-3 rounded-lg transition-all">
        <i class="fas fa-balance-scale mr-1"></i> Opening Bal
    </button>
</div>
        `;
        container.appendChild(card);
    });
}

function renderLedgerTable() {
    const tbody = document.getElementById('ledger-body');
    const countSpan = document.getElementById('ledger-count');
    
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (state.ledger.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="px-6 py-8 text-center text-gray-500">
                    <i class="fas fa-exchange-alt text-3xl mb-3"></i>
                    <p>No transactions yet</p>
                    <p class="text-sm mt-2">Start by syncing receipts or making a transfer</p>
                </td>
            </tr>
        `;
        if (countSpan) countSpan.textContent = '0 Records';
        return;
    }
    
    // Show latest 100 transactions
    const transactionsToShow = state.ledger.slice(0, 100);
    
    transactionsToShow.forEach(tx => {
        const dateObj = new Date(tx.date);
        const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // Determine badge style
        let typeBadge = '';
        let amountClass = '';
        let sign = '';
        let recipientInfo = tx.bankName || '';
        
        switch(tx.type) {
            case 'receipt':
                typeBadge = '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Receipt</span>';
                amountClass = 'text-green-600';
                sign = '+';
                break;
            case 'withdrawal':
            case 'expense':
                typeBadge = '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Expense</span>';
                amountClass = 'text-red-600';
                sign = '-';
                recipientInfo = tx.recipientName || tx.category || tx.bankName;
                break;
            case 'credit':
                typeBadge = '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">Credit</span>';
                amountClass = 'text-blue-600';
                sign = '-';
                recipientInfo = tx.recipientName || tx.category || tx.bankName;
                break;
            case 'transfer':
                typeBadge = '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">Transfer</span>';
                amountClass = 'text-purple-600';
                sign = '↔';
                recipientInfo = `${tx.bankName} → ${tx.toBankName}`;
                if (tx.transactionFee) {
                    recipientInfo += ` (Fee: ${tx.feeAmount} ${tx.currency})`;
                }
                break;
            case 'transfer_fee':
                typeBadge = '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">Fee</span>';
                amountClass = 'text-yellow-600';
                sign = '-';
                break;
            default:
                typeBadge = '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">Other</span>';
                amountClass = 'text-gray-600';
                sign = '';
        }
        
        const row = `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 whitespace-nowrap text-gray-600 text-sm">${dateStr}</td>
                <td class="px-6 py-4 whitespace-nowrap">${typeBadge}</td>
                <td class="px-6 py-4 whitespace-nowrap text-gray-900 font-medium">
                    ${recipientInfo}
                </td>
                <td class="px-6 py-4 text-gray-500 max-w-xs truncate" title="${tx.description || ''}">${tx.description || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right font-bold ${amountClass}">
                    ${sign} ${formatNumber(tx.amount || 0)} 
                    <span class="text-xs text-gray-400 font-normal ml-1">${tx.currency || 'KES'}</span>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
    
    if (countSpan) {
        countSpan.textContent = `${state.ledger.length} Records`;
    }
}

// --- EXPENSE SUMMARY RENDERING ---

function renderExpenseSummary() {
    // Update total
    let totalExpenses = 0;
    Object.values(state.expenseSummary).forEach(amount => {
        totalExpenses += amount;
    });
    
    const expenseTotalEl = document.getElementById('expense-total');
    if (expenseTotalEl) {
        expenseTotalEl.textContent = `Total: KSH ${formatNumber(totalExpenses)}`;
    }
    
    // Render categories list
    const categoriesList = document.getElementById('categories-list');
    if (categoriesList) {
        categoriesList.innerHTML = '';
        
        // Sort categories by amount (descending)
        const sortedCategories = Object.entries(state.expenseSummary)
            .filter(([category, amount]) => amount > 0)
            .sort((a, b) => b[1] - a[1]);
        
        if (sortedCategories.length === 0) {
            categoriesList.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-chart-pie text-3xl mb-3"></i>
                    <p>No expenses recorded yet</p>
                    <p class="text-sm mt-2">Record expenses to see category breakdown</p>
                </div>
            `;
        } else {
            sortedCategories.forEach(([category, amount]) => {
                const percentage = totalExpenses > 0 ? (amount / totalExpenses * 100).toFixed(1) : 0;
                const categoryEl = document.createElement('div');
                categoryEl.className = 'bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors';
                categoryEl.innerHTML = `
                    <div class="flex justify-between items-center mb-2">
                        <span class="font-medium text-gray-800 truncate">${category}</span>
                        <span class="font-bold text-red-600">KSH ${formatNumber(amount)}</span>
                    </div>
                    <div class="flex items-center">
                        <div class="flex-1 bg-gray-200 rounded-full h-2 mr-3">
                            <div class="bg-red-500 h-2 rounded-full" style="width: ${percentage}%"></div>
                        </div>
                        <span class="text-xs text-gray-500">${percentage}%</span>
                    </div>
                `;
                categoriesList.appendChild(categoryEl);
            });
        }
    }
    
    // Render custom recipients
    const customRecipientsList = document.getElementById('custom-recipients-list');
    if (customRecipientsList) {
        customRecipientsList.innerHTML = '';
        
        if (state.customRecipients.length === 0) {
            customRecipientsList.innerHTML = `
                <div class="col-span-3 text-center py-4 text-gray-500">
                    <i class="fas fa-users text-2xl mb-2"></i>
                    <p class="text-sm">No custom recipients yet</p>
                </div>
            `;
        } else {
            // Sort custom recipients by total amount (descending)
            const sortedRecipients = [...state.customRecipients].sort((a, b) => b.total - a.total);
            
            sortedRecipients.forEach(recipient => {
                const recipientEl = document.createElement('div');
                recipientEl.className = 'bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow';
                recipientEl.innerHTML = `
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <h5 class="font-semibold text-gray-800">${recipient.name}</h5>
                            <span class="text-xs text-gray-500">${recipient.type}</span>
                        </div>
                        <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">${recipient.transactions} txns</span>
                    </div>
                    <div class="text-2xl font-bold text-red-600">KSH ${formatNumber(recipient.total)}</div>
                    <div class="text-xs text-gray-500 mt-1">Total payments</div>
                `;
                customRecipientsList.appendChild(recipientEl);
            });
        }
    }
    
    // Update chart
    updateExpenseChart();
}



function updateExpenseChart() {
    const ctx = document.getElementById('expenseChart');
    if (!ctx) return;
    
    // Destroy existing chart instance
    if (state.chartInstance) {
        state.chartInstance.destroy();
    }
    
    // Prepare chart data
    const categoriesWithExpenses = Object.entries(state.expenseSummary)
        .filter(([category, amount]) => amount > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // Top 10 categories
    
    if (categoriesWithExpenses.length === 0) {
        ctx.parentElement.innerHTML = `
            <div class="text-center text-gray-500">
                <i class="fas fa-chart-pie text-4xl mb-3"></i>
                <p>No expense data to display</p>
                <p class="text-sm">Record expenses to see visualizations</p>
            </div>
        `;
        return;
    }
    
    const labels = categoriesWithExpenses.map(([category]) => category);
    const data = categoriesWithExpenses.map(([, amount]) => amount);
    
    // Create new chart
    state.chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#EF4444', '#F97316', '#F59E0B', '#10B981', '#06B6D4',
                    '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280', '#84CC16'
                ],
                borderWidth: 2,
                borderColor: '#FFFFFF'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 12,
                        padding: 15,
                        font: {
                            size: 11
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${label}: KSH ${formatNumber(value)} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function refreshExpenseSummary() {
    calculateExpenseSummary();
    renderExpenseSummary();
    showToast('Expense summary refreshed', 'success');
}

// --- PDF EXPORT FUNCTIONALITY ---

async function exportLedgerToPDF() {
    showLoading(true, "Generating PDF...");
    
    try {
        // Create a temporary div for the PDF content
        const pdfContent = document.createElement('div');
        pdfContent.style.position = 'absolute';
        pdfContent.style.left = '-9999px';
        pdfContent.style.top = '-9999px';
        pdfContent.style.width = '210mm';
        pdfContent.style.backgroundColor = 'white';
        pdfContent.style.padding = '20px';
        pdfContent.style.fontFamily = 'Arial, sans-serif';
        
        // Get current date
        const now = new Date();
        const dateStr = now.toLocaleDateString();
        const timeStr = now.toLocaleTimeString();
        
        // Build PDF content
        pdfContent.innerHTML = `
            <div style="border-bottom: 2px solid #267921; padding-bottom: 15px; margin-bottom: 20px;">
                <h1 style="color: #267921; margin: 0; font-size: 24px;">CarKenya Bank Ledger Report</h1>
                <div style="color: #666; font-size: 14px; margin-top: 5px;">
                    Generated on ${dateStr} at ${timeStr} by ${state.user?.email || 'System'}
                </div>
                <div style="color: #666; font-size: 14px; margin-top: 5px;">
                    Total Banks: ${state.banks.length} | Total Transactions: ${state.ledger.length}
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h2 style="color: #333; font-size: 18px; margin-bottom: 10px;">Summary</h2>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px;">
                    <div style="background: #f5f5f5; padding: 10px; border-radius: 5px;">
                        <div style="font-size: 12px; color: #666;">Total KES</div>
                        <div style="font-weight: bold; color: #267921;">KES ${formatNumber(state.stats.totalKES)}</div>
                    </div>
                    <div style="background: #f5f5f5; padding: 10px; border-radius: 5px;">
                        <div style="font-size: 12px; color: #666;">Total USD</div>
                        <div style="font-weight: bold; color: #267921;">$${formatNumber(state.stats.totalUSD)}</div>
                    </div>
                    <div style="background: #f5f5f5; padding: 10px; border-radius: 5px;">
                        <div style="font-size: 12px; color: #666;">Today's Transactions</div>
                        <div style="font-weight: bold; color: #267921;">${state.stats.todayTransactions}</div>
                    </div>
                </div>
            </div>
            
            <h2 style="color: #333; font-size: 18px; margin-bottom: 10px;">Bank Balances</h2>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 12px;">
                <thead>
                    <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                        <th style="text-align: left; padding: 8px; border: 1px solid #dee2e6;">Bank Name</th>
                        <th style="text-align: left; padding: 8px; border: 1px solid #dee2e6;">Account Number</th>
                        <th style="text-align: left; padding: 8px; border: 1px solid #dee2e6;">Currency</th>
                        <th style="text-align: right; padding: 8px; border: 1px solid #dee2e6;">Balance</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.banks.map(bank => {
                        const balance = state.balances[bank.id] || 0;
                        return `
                            <tr style="border-bottom: 1px solid #dee2e6;">
                                <td style="padding: 8px; border: 1px solid #dee2e6;">${bank.name}</td>
                                <td style="padding: 8px; border: 1px solid #dee2e6;">${bank.accountNumber || 'N/A'}</td>
                                <td style="padding: 8px; border: 1px solid #dee2e6;">${bank.currency}</td>
                                <td style="text-align: right; padding: 8px; border: 1px solid #dee2e6; font-weight: bold; color: ${balance >= 0 ? '#267921' : '#dc3545'}">
                                    ${bank.currency === 'USD' ? '$' : 'KES'} ${formatNumber(balance)}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            
            <h2 style="color: #333; font-size: 18px; margin-bottom: 10px;">Recent Transactions (Last 50)</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                <thead>
                    <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                        <th style="text-align: left; padding: 6px; border: 1px solid #dee2e6;">Date</th>
                        <th style="text-align: left; padding: 6px; border: 1px solid #dee2e6;">Type</th>
                        <th style="text-align: left; padding: 6px; border: 1px solid #dee2e6;">Bank/Recipient</th>
                        <th style="text-align: left; padding: 6px; border: 1px solid #dee2e6;">Description</th>
                        <th style="text-align: right; padding: 6px; border: 1px solid #dee2e6;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.ledger.slice(0, 50).map(tx => {
                        const date = new Date(tx.date);
                        const dateStr = date.toLocaleDateString();
                        const timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                        const amount = parseFloat(tx.amount) || 0;
                        const sign = tx.type === 'receipt' ? '+' : '-';
                        const color = tx.type === 'receipt' ? '#267921' : '#dc3545';
                        
                        let typeBadge = '';
                        switch(tx.type) {
                            case 'receipt': typeBadge = 'Receipt'; break;
                            case 'expense': typeBadge = 'Expense'; break;
                            case 'credit': typeBadge = 'Credit'; break;
                            case 'transfer': typeBadge = 'Transfer'; break;
                            case 'withdrawal': typeBadge = 'Withdrawal'; break;
                            default: typeBadge = tx.type;
                        }
                        
                        return `
                            <tr style="border-bottom: 1px solid #dee2e6;">
                                <td style="padding: 6px; border: 1px solid #dee2e6;">${dateStr} ${timeStr}</td>
                                <td style="padding: 6px; border: 1px solid #dee2e6;">${typeBadge}</td>
                                <td style="padding: 6px; border: 1px solid #dee2e6;">${tx.bankName || ''}</td>
                                <td style="padding: 6px; border: 1px solid #dee2e6;">${tx.description || ''}</td>
                                <td style="text-align: right; padding: 6px; border: 1px solid #dee2e6; color: ${color}; font-weight: bold;">
                                    ${sign}${formatNumber(amount)} ${tx.currency || 'KES'}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #666; font-size: 12px;">
                <div>Report generated by CarKenya Financial Manager v2.0</div>
                <div>Total pages: 1</div>
            </div>
        `;
        
        document.body.appendChild(pdfContent);
        
        // Use html2pdf library (you need to include it in your HTML)
        if (typeof html2pdf !== 'undefined') {
            const element = pdfContent;
            const opt = {
                margin: 0.5,
                filename: `CarKenya-Ledger-Report-${dateStr.replace(/\//g, '-')}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
            };
            
            await html2pdf().set(opt).from(element).save();
        } else {
            // Fallback to print if html2pdf is not available
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <html>
                    <head>
                        <title>CarKenya Ledger Report</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            @media print { body { margin: 0; } }
                        </style>
                    </head>
                    <body>
                        ${pdfContent.innerHTML}
                    </body>
                </html>
            `);
            printWindow.document.close();
            printWindow.focus();
            printWindow.print();
            printWindow.close();
        }
        
        // Clean up
        document.body.removeChild(pdfContent);
        
        showToast('PDF exported successfully!', 'success');
    } catch (error) {
        console.error('PDF Export Error:', error);
        showToast('Failed to generate PDF: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// --- REPORTS FUNCTIONALITY ---

function initializeReports() {
    // Set default date filters
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const startDateInput = document.getElementById('report-start-date');
    const endDateInput = document.getElementById('report-end-date');
    
    if (startDateInput) {
        startDateInput.value = firstDay.toISOString().split('T')[0];
    }
    if (endDateInput) {
        endDateInput.value = now.toISOString().split('T')[0];
    }
    
    // Populate bank filter
    const bankFilter = document.getElementById('report-bank-filter');
    if (bankFilter) {
        bankFilter.innerHTML = '<option value="all">All Banks</option>';
        state.banks.forEach(bank => {
            const option = document.createElement('option');
            option.value = bank.id;
            option.textContent = bank.name;
            bankFilter.appendChild(option);
        });
    }
    
    // Add event listeners for filter changes
    const filterInputs = ['report-start-date', 'report-end-date', 'report-bank-filter', 'report-type-filter'];
    filterInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', generateFinancialReport);
        }
    });
    
    // Generate initial report
    generateFinancialReport();
}

function generateFinancialReport() {
    // Get filter values
    const startDate = document.getElementById('report-start-date')?.value;
    const endDate = document.getElementById('report-end-date')?.value;
    const bankId = document.getElementById('report-bank-filter')?.value;
    const typeFilter = document.getElementById('report-type-filter')?.value;
    
    // Filter transactions
    let filteredTransactions = state.ledger.filter(tx => {
        // Date filter
        if (startDate && endDate) {
            const txDate = new Date(tx.date).toISOString().split('T')[0];
            if (txDate < startDate || txDate > endDate) return false;
        }
        
        // Bank filter
        if (bankId && bankId !== 'all') {
            if (tx.bankId !== bankId && tx.toBankId !== bankId) return false;
        }
        
        // Type filter
        if (typeFilter && typeFilter !== 'all') {
            if (tx.type !== typeFilter) return false;
        }
        
        return true;
    });
    
    // Calculate totals
    let totalIncome = 0;
    let totalExpenses = 0;
    
    filteredTransactions.forEach(tx => {
        const amount = parseFloat(tx.amount) || 0;
        if (tx.type === 'receipt') {
            totalIncome += amount;
        } else if (['expense', 'credit', 'withdrawal'].includes(tx.type)) {
            totalExpenses += amount;
        } else if (tx.type === 'transfer') {
            if (tx.bankId === bankId) {
                totalExpenses += amount;
            } else if (tx.toBankId === bankId) {
                totalIncome += amount;
            }
        }
    });
    
    const netBalance = totalIncome - totalExpenses;
    
    // Update summary cards
    const incomeEl = document.getElementById('report-income');
    const expensesEl = document.getElementById('report-expenses');
    const netEl = document.getElementById('report-net');
    const transactionsEl = document.getElementById('report-transactions');
    
    if (incomeEl) incomeEl.textContent = `KES ${formatNumber(totalIncome)}`;
    if (expensesEl) expensesEl.textContent = `KES ${formatNumber(totalExpenses)}`;
    if (netEl) netEl.textContent = `KES ${formatNumber(netBalance)}`;
    if (transactionsEl) transactionsEl.textContent = filteredTransactions.length;
    
    // Render transactions table
    renderReportTransactions(filteredTransactions);
    
    // Generate charts only if we have chart containers
    const incomeExpenseCtx = document.getElementById('incomeExpenseChart');
    const bankBalanceCtx = document.getElementById('bankBalanceChart');
    
    if (incomeExpenseCtx && bankBalanceCtx) {
        generateReportCharts(filteredTransactions);
    }
}

function renderReportTransactions(transactions) {
    const tbody = document.getElementById('report-transactions-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (transactions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="px-6 py-8 text-center text-gray-500">
                    <i class="fas fa-search text-2xl mb-3"></i>
                    <p>No transactions found for the selected filters</p>
                </td>
            </tr>
        `;
        return;
    }
    
    transactions.forEach(tx => {
        const dateObj = new Date(tx.date);
        const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // Determine badge style
        let typeBadge = '';
        let amountClass = '';
        let sign = '';
        
        switch(tx.type) {
            case 'receipt':
                typeBadge = '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Receipt</span>';
                amountClass = 'text-green-600';
                sign = '+';
                break;
            case 'withdrawal':
            case 'expense':
                typeBadge = '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">Expense</span>';
                amountClass = 'text-red-600';
                sign = '-';
                break;
            case 'credit':
                typeBadge = '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">Credit</span>';
                amountClass = 'text-blue-600';
                sign = '-';
                break;
            case 'transfer':
                typeBadge = '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">Transfer</span>';
                amountClass = 'text-purple-600';
                sign = '↔';
                break;
            default:
                typeBadge = '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">Other</span>';
                amountClass = 'text-gray-600';
                sign = '';
        }
        
        const row = `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${dateStr}</td>
                <td class="px-6 py-4 whitespace-nowrap">${typeBadge}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${tx.bankName || ''}</td>
                <td class="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">${tx.description || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-bold ${amountClass}">
                    ${sign}${formatNumber(tx.amount || 0)} 
                    <span class="text-xs text-gray-400 font-normal ml-1">${tx.currency || 'KES'}</span>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function generateReportCharts(transactions) {
    // Income vs Expense Chart
    const incomeExpenseCtx = document.getElementById('incomeExpenseChart');
    if (incomeExpenseCtx) {
        // Destroy existing chart if it exists
        if (window.incomeExpenseChart && typeof window.incomeExpenseChart.destroy === 'function') {
            window.incomeExpenseChart.destroy();
        }
        
        // Group by day
        const dailyData = {};
        transactions.forEach(tx => {
            const date = new Date(tx.date).toDateString();
            if (!dailyData[date]) {
                dailyData[date] = { income: 0, expense: 0 };
            }
            
            const amount = parseFloat(tx.amount) || 0;
            if (tx.type === 'receipt') {
                dailyData[date].income += amount;
            } else if (['expense', 'credit', 'withdrawal'].includes(tx.type)) {
                dailyData[date].expense += amount;
            }
        });
        
        const dates = Object.keys(dailyData).sort();
        const incomeData = dates.map(date => dailyData[date].income);
        const expenseData = dates.map(date => dailyData[date].expense);
        
        // Check if we have data to display
        if (dates.length === 0) {
            incomeExpenseCtx.parentElement.innerHTML = `
                <div class="text-center text-gray-500 py-8">
                    <i class="fas fa-chart-line text-3xl mb-3"></i>
                    <p>No transaction data for selected filters</p>
                </div>
            `;
        } else {
            window.incomeExpenseChart = new Chart(incomeExpenseCtx, {
                type: 'line',
                data: {
                    labels: dates.map(date => new Date(date).toLocaleDateString()),
                    datasets: [
                        {
                            label: 'Income',
                            data: incomeData,
                            borderColor: '#10B981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'Expenses',
                            data: expenseData,
                            borderColor: '#EF4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            tension: 0.4,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false
                        }
                    },
                    scales: {
                        x: {
                            grid: {
                                display: false
                            }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return 'KES ' + formatNumber(value);
                                }
                            }
                        }
                    }
                }
            });
        }
    }
    
    // Bank Balance Chart
    const bankBalanceCtx = document.getElementById('bankBalanceChart');
    if (bankBalanceCtx) {
        // Destroy existing chart if it exists
        if (window.bankBalanceChart && typeof window.bankBalanceChart.destroy === 'function') {
            window.bankBalanceChart.destroy();
        }
        
        const bankNames = state.banks.map(bank => bank.name);
        const bankBalances = state.banks.map(bank => state.balances[bank.id] || 0);
        
        // Check if we have data to display
        if (bankNames.length === 0) {
            bankBalanceCtx.parentElement.innerHTML = `
                <div class="text-center text-gray-500 py-8">
                    <i class="fas fa-university text-3xl mb-3"></i>
                    <p>No bank data available</p>
                </div>
            `;
        } else {
            window.bankBalanceChart = new Chart(bankBalanceCtx, {
                type: 'bar',
                data: {
                    labels: bankNames,
                    datasets: [{
                        label: 'Current Balance',
                        data: bankBalances,
                        backgroundColor: bankBalances.map(balance => 
                            balance >= 0 ? 'rgba(16, 185, 129, 0.8)' : 'rgba(239, 68, 68, 0.8)'
                        ),
                        borderColor: bankBalances.map(balance => 
                            balance >= 0 ? '#10B981' : '#EF4444'
                        ),
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const bank = state.banks[context.dataIndex];
                                    return `${bank.name}: ${bank.currency} ${formatNumber(context.raw)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: {
                                display: false
                            }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return formatNumber(value);
                                }
                            }
                        }
                    }
                }
            });
        }
    }
}

// --- MODAL CONTROLS ---

function showTransferConfirmation() {
    if (!state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    // Update bank selects first
    updateBankSelects();
    
    // Show the enhanced transfer modal
    openModal('transfer-modal-enhanced');
}

function showExpensePaymentModal(bankId = null) {
    if (!state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    // Update bank selects
    updateBankSelects();
    
    // Show modal
    openModal('expense-payment-modal');
    
    // Preselect bank if provided
    if (bankId) {
        const bankSelect = document.getElementById('expense-bank');
        if (bankSelect) {
            bankSelect.value = bankId;
            updateBankBalanceDisplay(bankId, 'expense-bank-balance');
        }
    }
}

function showCreditTransferModal() {
    if (!state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    // Update bank selects
    updateBankSelects();
    
    // Show modal
    openModal('credit-transfer-modal');
    
    // Add event listener for recipient type change
    const recipientTypeSelect = document.getElementById('credit-recipient-type');
    const categorySection = document.getElementById('credit-category-section');
    const customSection = document.getElementById('credit-custom-section');
    
    if (recipientTypeSelect && categorySection && customSection) {
        recipientTypeSelect.addEventListener('change', function() {
            if (this.value === 'category') {
                categorySection.classList.remove('hidden');
                customSection.classList.add('hidden');
            } else {
                categorySection.classList.add('hidden');
                customSection.classList.remove('hidden');
            }
        });
    }
}

function showTransactionFeeReport() {
    // Calculate total transaction fees
    let totalFees = 0;
    let feeByBank = {};
    
    state.ledger.forEach(tx => {
        if (tx.type === 'transfer_fee' || (tx.type === 'transfer' && tx.feeAmount)) {
            const feeAmount = parseFloat(tx.feeAmount) || 0;
            totalFees += feeAmount;
            
            const bankName = tx.bankName || 'Unknown';
            feeByBank[bankName] = (feeByBank[bankName] || 0) + feeAmount;
        }
    });
    
    // Create report modal
    const modal = document.createElement('div');
    modal.id = 'fee-report-modal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black bg-opacity-50" onclick="closeModal('fee-report-modal')"></div>
        <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-auto p-6">
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-gray-800 flex items-center">
                    <i class="fas fa-percentage mr-3"></i>Transaction Fees Report
                </h2>
                <button onclick="closeModal('fee-report-modal')"
                        class="text-gray-500 hover:text-gray-700 text-2xl">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="mb-6">
                <div class="bg-purple-50 p-4 rounded-lg mb-4">
                    <div class="text-sm text-gray-600">Total Transaction Fees</div>
                    <div class="text-2xl font-bold text-purple-600">KSH ${formatNumber(totalFees)}</div>
                </div>
                
                <h4 class="font-semibold text-gray-800 mb-3">Fees by Bank</h4>
                <div class="space-y-3 max-h-64 overflow-y-auto">
                    ${Object.entries(feeByBank).map(([bank, fees]) => `
                        <div class="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                            <span class="font-medium text-gray-700">${bank}</span>
                            <span class="font-bold text-red-600">KSH ${formatNumber(fees)}</span>
                        </div>
                    `).join('')}
                    
                    ${Object.keys(feeByBank).length === 0 ? `
                        <div class="text-center py-4 text-gray-500">
                            <i class="fas fa-receipt text-2xl mb-2"></i>
                            <p>No transaction fees recorded yet</p>
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <button onclick="closeModal('fee-report-modal')"
                    class="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 rounded-lg transition-all">
                Close Report
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// --- ALL BANKS SUMMARY ---

function showAllBanksSummary() {
    if (state.banks.length === 0) {
        showToast('No banks loaded. Please connect to Firebase and refresh data.', 'error');
        return;
    }
    
    let summary = `=== ALL BANKS SUMMARY ===\n\n`;
    let totalKES = 0;
    let totalUSD = 0;
    
    // Sort banks alphabetically
    const sortedBanks = [...state.banks].sort((a, b) => a.name.localeCompare(b.name));
    
    sortedBanks.forEach(bank => {
        const balance = state.balances[bank.id] || 0;
        const currencySymbol = bank.currency === 'USD' ? '$' : 'KES ';
        const openingBalance = state.openingBalanceTimestamps[bank.name]?.balance || bank.openingBalanceConfig?.amount || 0;
        
        // Calculate credits and debits for this bank
        const bankTransactions = state.ledger.filter(tx => 
            tx.bankId === bank.id || tx.toBankId === bank.id
        );
        
        let totalCredits = 0;
        let totalDebits = 0;
        
        bankTransactions.forEach(tx => {
            const amount = parseFloat(tx.amount) || 0;
            if (tx.type === 'receipt' || (tx.type === 'transfer' && tx.toBankId === bank.id)) {
                totalCredits += amount;
            } else if (tx.type === 'withdrawal' || tx.type === 'expense' || tx.type === 'credit' || (tx.type === 'transfer' && tx.bankId === bank.id)) {
                totalDebits += amount;
            }
        });
        
        summary += `${bank.name} (${bank.currency}):\n`;
        summary += `  Current Balance: ${currencySymbol}${formatNumber(balance)}\n`;
        summary += `  Opening Balance: ${currencySymbol}${formatNumber(openingBalance)}\n`;
        summary += `  Total Credits: ${currencySymbol}${formatNumber(totalCredits)}\n`;
        summary += `  Total Debits: ${currencySymbol}${formatNumber(totalDebits)}\n`;
        
        if (state.openingBalanceTimestamps[bank.name]) {
            summary += `  Opening Set: ${new Date(state.openingBalanceTimestamps[bank.name].timestamp).toLocaleDateString()}\n`;
        } else {
            summary += `  Opening Set: Not configured\n`;
        }
        
        summary += `\n`;
        
        if (bank.currency === 'KES') {
            totalKES += balance;
        } else if (bank.currency === 'USD') {
            totalUSD += balance;
        }
    });
    
    summary += `=== TOTALS ===\n`;
    summary += `Total KSH Funds: KSH ${formatNumber(totalKES)}\n`;
    summary += `Total USD Funds: $${formatNumber(totalUSD)}\n`;
    summary += `Total Banks: ${state.banks.length}\n`;
    summary += `Total Transactions Processed: ${state.processedTransactions.size}\n`;
    
    // Add expense summary
    let totalExpenses = 0;
    Object.values(state.expenseSummary).forEach(amount => {
        totalExpenses += amount;
    });
    
    summary += `Total Expenses: KSH ${formatNumber(totalExpenses)}\n`;
    summary += `Expense Categories: ${Object.keys(state.expenseSummary).filter(cat => state.expenseSummary[cat] > 0).length}\n`;
    summary += `Custom Recipients: ${state.customRecipients.length}\n`;
    summary += `\nGenerated: ${new Date().toLocaleString()}`;
    
    // Create a modal to show the summary
    const summaryModal = document.createElement('div');
    summaryModal.id = 'all-banks-summary-modal';
    summaryModal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
    summaryModal.innerHTML = `
        <div class="absolute inset-0 bg-black bg-opacity-50" onclick="closeAllBanksSummary()"></div>
        <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-auto p-6">
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-gray-800 flex items-center">
                    <i class="fas fa-university mr-3"></i>All Banks Summary
                </h2>
                <button onclick="closeAllBanksSummary()"
                        class="text-gray-500 hover:text-gray-700 text-2xl">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="mb-6">
                <div class="grid grid-cols-2 gap-4 mb-6">
                    <div class="bg-green-50 p-4 rounded-lg">
                        <div class="text-sm text-gray-600">Total KSH Funds</div>
                        <div class="text-2xl font-bold text-green-600">KSH ${formatNumber(totalKES)}</div>
                    </div>
                    <div class="bg-blue-50 p-4 rounded-lg">
                        <div class="text-sm text-gray-600">Total USD Funds</div>
                        <div class="text-2xl font-bold text-blue-600">$${formatNumber(totalUSD)}</div>
                    </div>
                </div>
            </div>
            
            <div class="max-h-96 overflow-y-auto mb-6">
                <pre class="bg-gray-50 p-4 rounded-lg text-sm text-gray-800 whitespace-pre-wrap font-mono">${summary}</pre>
            </div>
            
            <div class="flex justify-end space-x-4">
                <button onclick="closeAllBanksSummary()"
                        class="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-6 rounded-lg transition-all">
                    Close
                </button>
                <button onclick="printSummary()"
                        class="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-6 rounded-lg transition-all flex items-center">
                    <i class="fas fa-print mr-2"></i>Print Summary
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(summaryModal);
}

function closeAllBanksSummary() {
    const modal = document.getElementById('all-banks-summary-modal');
    if (modal) {
        modal.remove();
    }
}

function printSummary() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showToast('Please allow popups to print', 'error');
        return;
    }
    
    printWindow.document.write(`
        <html>
            <head>
                <title>CarKenya - All Banks Summary</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { color: #267921; }
                    .summary { white-space: pre-wrap; font-family: monospace; }
                    .totals { margin-top: 20px; padding: 10px; background: #f5f5f5; }
                    .footer { margin-top: 30px; font-size: 12px; color: #666; }
                </style>
            </head>
            <body>
                <h1>CarKenya Bank Summary Report</h1>
                <div class="summary" id="summary-content"></div>
                <div class="footer">
                    Generated on ${new Date().toLocaleString()} by ${state.user?.email || 'System'}
                </div>
                <script>
                    // Copy summary content
                    const modal = window.opener.document.getElementById('all-banks-summary-modal');
                    if (modal) {
                        const summary = modal.querySelector('pre').textContent;
                        document.getElementById('summary-content').textContent = summary;
                        window.print();
                        window.close();
                    }
                </script>
            </body>
        </html>
    `);
}

// --- TAB AND MODAL CONTROLS ---

function openTab(evt, tabName) {
    // Hide all tab content
    const tabcontents = document.getElementsByClassName('tab-content');
    for (let i = 0; i < tabcontents.length; i++) {
        tabcontents[i].classList.remove('active');
    }
    
    // Remove active class from all tabs
    const tablinks = document.getElementsByClassName('custom-tab');
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove('active');
    }
    
    // Show current tab and add active class
    const targetTab = document.getElementById(tabName);
    if (targetTab) {
        targetTab.classList.add('active');
    }
    
    if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add('active');
    }
    
    // Special handling for specific tabs
    if (tabName === 'ledger-history') {
        renderLedgerTable();
    } else if (tabName === 'expense-categories') {
        renderExpenseSummary();
    } else if (tabName === 'reports') {
        initializeReports();
    }
    
}

function openModal(id) {
    // Check if PIN is verified for bank-related modals
    const bankModals = ['transfer-modal-enhanced', 'expense-payment-modal', 'credit-transfer-modal', 'withdrawal-modal'];
    if (bankModals.includes(id) && !state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('hidden');
    }
}

function refreshBankData() {
    if (!state.user) {
        showToast("Please login to Firebase first", "error");
        return;
    }
    
    if (!state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    initApp();
    showToast('Refreshing bank data...', 'info');
}

function initializeBankSystem() {
    if (confirm('Reinitialize the system? This will reload all data from Firebase.')) {
        initApp();
    }
}

// --- OPENING BALANCE MODAL (Updated to work with new HTML structure) ---

function openOpeningModal(bankId) {
    // Check if PIN is verified
    if (!state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    const bank = state.banks.find(b => b.id === bankId);
    if (!bank) {
        showToast("Bank not found", "error");
        return;
    }
    
    // Create enhanced opening balance modal (same as in original code)
    const modal = document.createElement('div');
    modal.id = 'opening-balance-modal-enhanced';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black bg-opacity-50" onclick="closeOpeningModalEnhanced()"></div>
        <div class="relative bg-white rounded-xl shadow-2xl max-w-md w-full mx-auto p-6">
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-gray-800 flex items-center">
                    <i class="fas fa-balance-scale mr-3"></i>Set Opening Balance
                </h2>
                <button onclick="closeOpeningModalEnhanced()"
                        class="text-gray-500 hover:text-gray-700 text-2xl">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div id="opening-balance-details-enhanced" class="bg-gray-50 rounded-lg p-4 mb-6">
                <!-- Details will be filled by JavaScript -->
            </div>
            
            <form id="opening-balance-form-enhanced" class="space-y-4">
                <input type="hidden" id="op-enhanced-bank-id" value="${bankId}">
                
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Opening Balance Amount</label>
                    <div class="flex items-center">
                        <span id="opening-currency-symbol-enhanced" class="mr-2 text-lg font-semibold">${bank.currency === 'USD' ? '$' : 'KES'}</span>
                        <input type="number" id="opening-balance-amount-enhanced" 
                               class="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                               placeholder="0.00" min="0" step="0.01" required>
                    </div>
                    <p class="text-sm text-gray-500 mt-2">
                        This will be the starting balance for all future calculations
                    </p>
                </div>
                
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">As of Date & Time</label>
                    <div class="grid grid-cols-2 gap-4">
                        <input type="date" id="opening-balance-date-enhanced" 
                               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                               required>
                        <input type="time" id="opening-balance-time-enhanced" 
                               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                               required>
                    </div>
                    <p class="text-sm text-gray-500 mt-2">
                        Transactions before this date/time will be excluded from calculations
                    </p>
                </div>
                
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Notes (Optional)</label>
                    <textarea id="opening-balance-notes-enhanced" 
                              class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                              rows="2" placeholder="e.g., Verified against bank statement"></textarea>
                </div>
                
                <div class="flex items-start">
                    <input type="checkbox" id="confirm-opening-balance-enhanced" class="mt-1 mr-3" required>
                    <label for="confirm-opening-balance-enhanced" class="text-sm text-gray-600">
                        I confirm this opening balance is accurate and has been verified
                    </label>
                </div>
                
                <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                    <h4 class="font-semibold text-gray-800 mb-2 flex items-center">
                        <i class="fas fa-exclamation-triangle text-yellow-500 mr-2"></i>
                        Important Note
                    </h4>
                    <p class="text-sm text-gray-600">
                        Setting an opening balance will reset all transaction history before the selected date.
                        All calculations will start from this balance.
                    </p>
                </div>
                
                <div class="flex space-x-4">
                    <button type="button" onclick="closeOpeningModalEnhanced()"
                            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 rounded-lg transition-all">
                        Cancel
                    </button>
                    <button type="submit"
                            class="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition-all flex items-center justify-center">
                        <i class="fas fa-check-circle mr-2"></i>Set Opening Balance
                    </button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Fill details
    const detailsContainer = document.getElementById('opening-balance-details-enhanced');
    const currentBalance = state.balances[bankId] || 0;
    const openingBalance = state.openingBalanceTimestamps[bank.name]?.balance || bank.openingBalanceConfig?.amount || 0;
    
    detailsContainer.innerHTML = `
        <div class="space-y-2">
            <div class="flex justify-between">
                <span class="text-gray-600">Bank:</span>
                <span class="font-semibold">${bank.name}</span>
            </div>
            <div class="flex justify-between">
                <span class="text-gray-600">Currency:</span>
                <span class="font-semibold ${bank.currency === 'USD' ? 'text-blue-600' : 'text-green-600'}">
                    ${bank.currency}
                </span>
            </div>
            <div class="flex justify-between">
                <span class="text-gray-600">Current Opening Balance:</span>
                <span class="font-semibold">${bank.currency === 'USD' ? '$' : 'KES'} ${formatNumber(openingBalance)}</span>
            </div>
            <div class="flex justify-between">
                <span class="text-gray-600">Current Balance:</span>
                <span class="font-semibold ${currentBalance >= 0 ? 'text-green-600' : 'text-red-600'}">
                    ${bank.currency === 'USD' ? '$' : 'KES'} ${formatNumber(currentBalance)}
                </span>
            </div>
        </div>
    `;
    
    // Set current date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('opening-balance-date-enhanced').value = today;
    document.getElementById('opening-balance-amount-enhanced').value = openingBalance || '';
    
                   // Add form submit handler
    document.getElementById('opening-balance-form-enhanced').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const amount = parseFloat(document.getElementById('opening-balance-amount-enhanced').value);
        const date = document.getElementById('opening-balance-date-enhanced').value;
        const time = document.getElementById('opening-balance-time-enhanced').value;
        const notes = document.getElementById('opening-balance-notes-enhanced').value;
        
        if (!amount || isNaN(amount) || amount < 0) {
            showToast('Please enter a valid balance amount', 'error');
            return;
        }
        
        if (!date || !time) {
            showToast('Please select both date and time', 'error');
            return;
        }
        
        // Combine date and time into a single timestamp
        const dateTimeString = `${date}T${time}:00`;
        const timestamp = new Date(dateTimeString);
        
        if (isNaN(timestamp.getTime())) {
            showToast('Invalid date/time combination', 'error');
            return;
        }
        
        showLoading(true, 'Setting opening balance...');
        
        try {
            // Store in openingBalanceTimestamps
            state.openingBalanceTimestamps[bank.name] = {
                balance: amount,
                timestamp: timestamp.toISOString(), // Store as ISO string
                updatedBy: state.user?.email || 'Anonymous',
                updatedAt: new Date().toISOString(),
                notes: notes || ''
            };
            
            // Save to processed transactions
            await saveProcessedTransactions();
            
            // Also update bankDetails for backward compatibility
            await db.collection('bankDetails').doc(bankId).update({
                openingBalanceConfig: {
                    amount: amount,
                    dateString: timestamp.toISOString(), // Store as ISO string
                    updatedAt: new Date().toISOString(),
                    updatedBy: state.user?.email || 'Unknown',
                    notes: notes
                }
            });
            
            closeOpeningModalEnhanced();
            
            // Refresh data
            await initApp();
            
            showToast(`Opening balance set successfully for ${timestamp.toLocaleString()}!`, 'success');
        } catch (error) {
            showToast('Failed to set opening balance: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    });
} // <-- THIS WAS THE MISSING CLOSING BRACE for the openOpeningModal function
function closeOpeningModalEnhanced() {
    const modal = document.getElementById('opening-balance-modal-enhanced');
    if (modal) {
        modal.remove();
    }
}

// --- WITHDRAWAL MODAL (Updated) ---

function openWithdrawalModal(bankId) {
    // Check if PIN is verified
    if (!state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    const bank = state.banks.find(b => b.id === bankId);
    if (!bank) {
        showToast("Bank not found", "error");
        return;
    }
    
    // Create enhanced withdrawal modal
    const modal = document.createElement('div');
    modal.id = 'withdrawal-modal-enhanced';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black bg-opacity-50" onclick="closeWithdrawalModalEnhanced()"></div>
        <div class="relative bg-white rounded-xl shadow-2xl max-w-lg w-full mx-auto p-6">
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-gray-800 flex items-center">
                    <i class="fas fa-money-check-alt mr-3"></i>Bank Withdrawal / Payment
                </h2>
                <button onclick="closeWithdrawalModalEnhanced()"
                        class="text-gray-500 hover:text-gray-700 text-2xl">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <form id="withdrawal-form-enhanced">
                <div class="space-y-4 mb-6">
                    <!-- Bank Selection -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Source Bank Account</label>
                        <div class="bg-gray-50 p-3 rounded-lg">
                            <div class="font-semibold">${bank.name}</div>
                            <div class="text-sm text-gray-500">${bank.currency} Account</div>
                            <div id="withdrawal-bank-balance-enhanced" class="text-sm font-medium mt-2">
                                <!-- Balance will be filled by JavaScript -->
                            </div>
                        </div>
                        <input type="hidden" id="withdrawal-bank-enhanced" value="${bankId}">
                    </div>
                    
                    <!-- Expense Category -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Expense Category</label>
                        <select id="withdrawal-category-enhanced" 
                                class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600">
                            <option value="">Select Category</option>
                            <option value="Operational Expense">Operational Expense</option>
                            <option value="Salary">Salary</option>
                            <option value="Vendor Payment">Vendor Payment</option>
                            <option value="Tax">Tax</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                    
                    <!-- Amount -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Amount (${bank.currency})</label>
                        <input type="number" id="withdrawal-amount-enhanced" 
                               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                               placeholder="0.00" min="0.01" step="0.01" required>
                    </div>
                    
                    <!-- Description -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Description</label>
                        <input type="text" id="withdrawal-description-enhanced" 
                               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                               placeholder="e.g., Payment for office supplies" required>
                    </div>
                    
                    <!-- Recipient/Vendor -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Payee/Vendor</label>
                        <input type="text" id="withdrawal-payee-enhanced" 
                               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                               placeholder="e.g., Office Depot Ltd">
                    </div>
                    
                    <!-- Date -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Payment Date</label>
                        <input type="date" id="withdrawal-date-enhanced" 
                               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                               required>
                    </div>
                    
                    <!-- Reference Number -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Transaction Reference</label>
                        <input type="text" id="withdrawal-reference-enhanced" 
                               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                               placeholder="e.g., CHQ-12345, MPESA-ABC123">
                    </div>
                </div>
                
                <div class="flex space-x-4">
                    <button type="button" onclick="closeWithdrawalModalEnhanced()"
                            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 rounded-lg transition-all">
                        Cancel
                    </button>
                    <button type="submit"
                            class="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-all flex items-center justify-center">
                        <i class="fas fa-check-circle mr-2"></i>Confirm Withdrawal
                    </button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Fill balance information
    const balance = state.balances[bankId] || 0;
    const balanceEl = document.getElementById('withdrawal-bank-balance-enhanced');
    if (balanceEl) {
        balanceEl.innerHTML = `
            Available: <span class="${balance >= 0 ? 'text-green-600' : 'text-red-600'} font-bold">
                ${bank.currency === 'USD' ? '$' : 'KES'} ${formatNumber(balance)}
            </span>
        `;
    }
    
    // Set current date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('withdrawal-date-enhanced').value = today;
    
    // Add form submit handler
    document.getElementById('withdrawal-form-enhanced').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const amount = parseFloat(document.getElementById('withdrawal-amount-enhanced').value);
        const category = document.getElementById('withdrawal-category-enhanced').value;
        const description = document.getElementById('withdrawal-description-enhanced').value;
        const payee = document.getElementById('withdrawal-payee-enhanced').value;
        const date = document.getElementById('withdrawal-date-enhanced').value;
        const reference = document.getElementById('withdrawal-reference-enhanced').value;
        
        if (!amount || amount <= 0 || isNaN(amount)) {
            showToast('Please enter a valid amount', 'error');
            return;
        }
        
        if (!category) {
            showToast('Please select a category', 'error');
            return;
        }
        
        // Check balance
        if (amount > balance) {
            showToast(`Insufficient funds. Available: ${formatCurrency(balance, bank.currency)}`, 'error');
            return;
        }
        
        showLoading(true, 'Processing withdrawal...');
        
        try {
            await db.collection('bankLedger').add({
                type: 'withdrawal',
                date: new Date(date).toISOString(),
                amount: amount,
                bankId: bankId,
                bankName: bank.name,
                currency: bank.currency,
                category: category,
                description: `${category} - ${description}`,
                payee: payee,
                reference: reference,
                createdBy: state.user?.email || 'Unknown',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                status: 'completed',
                userId: 'global'
            });
            
            closeWithdrawalModalEnhanced();
            
            // Refresh data
            await initApp();
            
            showToast(`Withdrawal of ${formatCurrency(amount, bank.currency)} recorded successfully!`, 'success');
        } catch (error) {
            showToast('Withdrawal failed: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    });
}

function closeWithdrawalModalEnhanced() {
    const modal = document.getElementById('withdrawal-modal-enhanced');
    if (modal) {
        modal.remove();
    }
}

// --- AUTO REFRESH SYSTEM ---

let autoRefreshInterval = null;

function startAutoRefresh(intervalMinutes = 0.1667) { // 10 seconds = 0.1667 minutes
    // Clear existing interval if any
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    // Refresh every X minutes
    autoRefreshInterval = setInterval(async () => {
        if (state.user && state.isBankPinVerified) {
            console.log(`Auto-refreshing data... (${new Date().toLocaleTimeString()})`);
            
            try {
                // Refresh data silently
                await refreshData();
                
                // Update last sync time
                updateLastSyncTime();
                
                // Show subtle notification (only if tab is active)
                if (!document.hidden) {
                    const syncStatus = document.getElementById('sync-status-text');
                    if (syncStatus) {
                        const originalText = syncStatus.textContent;
                        syncStatus.textContent = 'Auto-refreshed just now';
                        setTimeout(() => {
                            syncStatus.textContent = originalText;
                        }, 3000);
                    }
                }
            } catch (error) {
                console.error('Auto-refresh failed:', error);
            }
        }
    }, intervalMinutes * 60 * 1000);
    
    console.log(`Auto-refresh started (every ${intervalMinutes * 60} seconds)`);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        console.log('Auto-refresh stopped');
    }
}

async function refreshData() {
    try {
        // Load fresh data from Firebase
        const [banksData, ledgerData] = await Promise.all([
            loadBanks(),
            loadLedger()
        ]);
        
        // Process receipt payments
        await processReceiptPayments();
        
        // Calculate balances
        calculateBalances();
        
        // Calculate expense summary
        calculateExpenseSummary();
        
        // Update UI if on relevant tabs
        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab && activeTab.id === 'dashboard') {
            renderDashboard();
        } else if (activeTab && activeTab.id === 'ledger-history') {
            renderLedgerTable();
        } else if (activeTab && activeTab.id === 'expense-categories') {
            renderExpenseSummary();
        } else if (activeTab && activeTab.id === 'reports') {
            generateFinancialReport();
        }
        
        updateStatistics();
        updateLastSyncTime();
        
        return true;
    } catch (error) {
        console.error("Refresh failed:", error);
        return false;
    }
}

// Update initApp to start auto-refresh
async function initApp() {
    console.log("Initializing App...");
    showLoading(true, "Loading bank data...");
    
    try {
        // Update sync status
        const syncStatus = document.getElementById('sync-status-text');
        if (syncStatus) syncStatus.textContent = 'Loading bank data...';
        
        // Load data in parallel
        const [banksData, ledgerData] = await Promise.all([
            loadBanks(),
            loadLedger()
        ]);
        
        // Process receipt payments
        await processReceiptPayments();
        
        // Calculate balances
        calculateBalances();
        
        // Calculate expense summary
        calculateExpenseSummary();
        
        // Update UI
        renderDashboard();
        updateStatistics();
        updateLastSyncTime();
        
        // Populate expense categories
        populateExpenseCategories();
        
        // Update expense tab
        renderExpenseSummary();

        // Initialize reports if reports tab is active
        const reportsTab = document.getElementById('reports');
        if (reportsTab && reportsTab.classList.contains('active')) {
            initializeReports();
        }
        
        // Mark system as ready
        state.systemReady = true;
        updateSystemStatus(true);
        
        // Start auto-refresh
        startAutoRefresh(0.1667); // Refresh every 10 seconds (10/60 = 0.1667 minutes)
        
        showToast('System initialized successfully! Auto-refresh enabled.', 'success');
    } catch (error) {
        console.error("Init failed", error);
        showToast('Failed to load data: ' + error.message, 'error');
    } finally {
        showLoading(false);
        
        // Update sync status
        const syncStatus = document.getElementById('sync-status-text');
        if (syncStatus) syncStatus.textContent = 'Data loaded successfully';
    }
}

// Update refreshBankData to use refreshData
function refreshBankData() {
    if (!state.user) {
        showToast("Please login to Firebase first", "error");
        return;
    }
    
    if (!state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    showLoading(true, 'Refreshing data...');
    refreshData().finally(() => {
        showLoading(false);
        showToast('Data refreshed successfully!', 'success');
    });
}

// --- AUTO REFRESH CONTROLS ---

let isAutoRefreshEnabled = true;

function toggleAutoRefresh() {
    isAutoRefreshEnabled = !isAutoRefreshEnabled;
    
    if (isAutoRefreshEnabled) {
        startAutoRefresh(2);
        showToast('Auto-refresh enabled (every 10 seconds)', 'success');
        
        const toggleText = document.getElementById('auto-refresh-toggle-text');
        if (toggleText) toggleText.textContent = 'Pause Auto-Refresh';
        
        const statusEl = document.getElementById('auto-refresh-status');
        if (statusEl) {
            const dot = statusEl.querySelector('span');
            if (dot) {
                dot.className = 'inline-block w-2 h-2 rounded-full bg-green-500 mr-2';
                statusEl.innerHTML = `${dot.outerHTML} Active (every 10 seconds)`;
            }
        }
    } else {
        stopAutoRefresh();
        showToast('Auto-refresh paused', 'warning');
        
        const toggleText = document.getElementById('auto-refresh-toggle-text');
        if (toggleText) toggleText.textContent = 'Resume Auto-Refresh';
        
        const statusEl = document.getElementById('auto-refresh-status');
        if (statusEl) {
            const dot = statusEl.querySelector('span');
            if (dot) {
                dot.className = 'inline-block w-2 h-2 rounded-full bg-yellow-500 mr-2';
                statusEl.innerHTML = `${dot.outerHTML} Paused`;
            }
        }
    }
}

// Update the startAutoRefresh function to update UI
function startAutoRefresh(intervalMinutes = 0.1667) { // 10 seconds = 0.1667 minutes
    // Clear existing interval if any
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    // Refresh every X minutes
    autoRefreshInterval = setInterval(async () => {
        if (state.user && state.isBankPinVerified && isAutoRefreshEnabled) {
            console.log(`Auto-refreshing data... (${new Date().toLocaleTimeString()})`);
            
            try {
                // Refresh data silently
                await refreshData();
                
                // Update last sync time
                updateLastSyncTime();
                
                // Show subtle notification (only if tab is active)
                if (!document.hidden) {
                    const syncStatus = document.getElementById('sync-status-text');
                    if (syncStatus) {
                        const originalText = syncStatus.textContent;
                        syncStatus.textContent = 'Auto-refreshed just now';
                        setTimeout(() => {
                            if (syncStatus.textContent === 'Auto-refreshed just now') {
                                syncStatus.textContent = 'Data synced successfully';
                            }
                        }, 3000);
                    }
                }
            } catch (error) {
                console.error('Auto-refresh failed:', error);
            }
        }
    }, intervalMinutes * 60 * 1000);
    
    console.log(`Auto-refresh started (every ${intervalMinutes * 60} seconds)`);
}

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', function() {
    // Check if user is already logged in
    const user = auth.currentUser;
    if (user) {
        updateSystemStatus(true);
        // Show PIN gate for logged-in users
        const bankAccessGate = document.getElementById('bank-access-gate');
        if (bankAccessGate) {
            bankAccessGate.style.display = 'flex';
        }
    } else {
        updateSystemStatus(false);
    }
    
    // Set today's date for date inputs
    const today = new Date().toISOString().split('T')[0];
    const dateInputs = document.querySelectorAll('input[type="date"]');
    dateInputs.forEach(input => {
        if (!input.value) {
            input.value = today;
        }
    });
    
    // Initialize Firebase
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    // Initialize auto-refresh status UI
    const autoRefreshStatus = document.getElementById('auto-refresh-status');
    if (autoRefreshStatus && !autoRefreshStatus.querySelector('span')) {
        autoRefreshStatus.innerHTML = `
            <span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>
            Ready
        `;
    }
    
    // Add currency prefix update for credit bank modal
    const creditBankSelect = document.getElementById('credit-bank');
    if (creditBankSelect) {
        creditBankSelect.addEventListener('change', function() {
            const bank = state.banks.find(b => b.id === this.value);
            const currencyPrefix = document.getElementById('credit-currency-prefix');
            if (currencyPrefix && bank) {
                currencyPrefix.textContent = bank.currency;
            }
        });
    }
    
    // Add event listeners for recipient type switching
    const recipientTypeSelect = document.getElementById('credit-recipient-type');
    if (recipientTypeSelect) {
        recipientTypeSelect.addEventListener('change', function() {
            const categorySection = document.getElementById('credit-category-section');
            const customSection = document.getElementById('credit-custom-section');
            
            if (this.value === 'category') {
                if (categorySection) categorySection.classList.remove('hidden');
                if (customSection) customSection.classList.add('hidden');
            } else {
                if (categorySection) categorySection.classList.add('hidden');
                if (customSection) customSection.classList.remove('hidden');
            }
        });
        
        const oldForms = ['transfer-form', 'withdrawal-form', 'opening-form'];
        oldForms.forEach(formId => {
            const oldForm = document.getElementById(formId);
            if (oldForm) {
                const newForm = oldForm.cloneNode(true);
                oldForm.parentNode.replaceChild(newForm, oldForm);
            }
        });
    }
});

// Expose functions to global scope for HTML onclick handlers
window.generateFinancialReport = generateFinancialReport;
window.initializeReports = initializeReports;
window.toggleLoginModal = toggleLoginModal;
window.logout = logout;
window.syncReceipts = syncReceipts;
window.openModal = openModal;
window.closeModal = closeModal;
window.openOpeningModal = openOpeningModal;
window.refreshBankData = refreshBankData;
window.showAllBanksSummary = showAllBanksSummary;
window.initializeBankSystem = initializeBankSystem;
window.openTab = openTab;
window.checkBankAccessCode = checkBankAccessCode;
window.showTransferConfirmation = showTransferConfirmation;
window.openWithdrawalModal = openWithdrawalModal;
window.showExpensePaymentModal = showExpensePaymentModal;
window.showCreditTransferModal = showCreditTransferModal;
window.refreshExpenseSummary = refreshExpenseSummary;
window.showTransactionFeeReport = showTransactionFeeReport;
window.closeAllBanksSummary = closeAllBanksSummary;
window.printSummary = printSummary;
window.closeOpeningModalEnhanced = closeOpeningModalEnhanced;
window.closeWithdrawalModalEnhanced = closeWithdrawalModalEnhanced;
window.toggleAutoRefresh = toggleAutoRefresh;
window.refreshData = refreshData;
window.debugBalanceCalculation = debugBalanceCalculation;


// Debug function for balance calculation troubleshooting
function debugBalanceCalculation(bankId) {
    const bank = state.banks.find(b => b.id === bankId);
    if (!bank) {
        console.error('Bank not found');
        return;
    }
    
    console.log(`=== DEBUG: ${bank.name} ===`);
    
    const cutoffDateTime = state.openingBalanceTimestamps[bank.name]?.timestamp ?
        new Date(state.openingBalanceTimestamps[bank.name].timestamp).getTime() : null;
    console.log('Opening Balance:', state.openingBalanceTimestamps[bank.name]?.balance || 0);
    console.log('Cutoff DateTime:', cutoffDateTime ? new Date(cutoffDateTime).toLocaleString() : 'None');
    
    const bankTransactions = state.ledger
        .filter(tx => tx.bankId === bank.id || tx.toBankId === bank.id)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    console.log(`Total transactions: ${bankTransactions.length}`);
    
    bankTransactions.forEach((tx, index) => {
        const txDateTime = new Date(tx.date).getTime();
        const isBeforeCutoff = cutoffDateTime && txDateTime < cutoffDateTime;
        console.log(`${index + 1}. ${tx.type} ${tx.amount} on ${new Date(tx.date).toLocaleString()} - ${isBeforeCutoff ? 'SKIPPED' : 'INCLUDED'}`);
    });
    
    console.log('Current Balance:', state.balances[bankId]);
    console.log('====================');
}



[file content end]
