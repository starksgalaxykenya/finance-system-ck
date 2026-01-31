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
    banks: [], // Array of { id, name, currency, openingBalanceConfig, accountNumber, branch }
    ledger: [], // Array of transaction objects
    balances: {}, // Map: bankId -> currentBalance
    stats: {
        totalKES: 0,
        totalUSD: 0,
        todayTransactions: 0,
        totalTransactions: 0
    },
    lastSyncTime: null,
    systemReady: false,
    isBankPinVerified: false, // NEW: Bank PIN verification state
    bankPin: '1234', // Default PIN (should be configurable)
    processedTransactions: new Set(), // NEW: Track processed transactions
    openingBalanceTimestamps: {}, // NEW: Track opening balance timestamps
    bankDetails: [] // NEW: Store bank details separately
};

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

// --- BANK PIN VERIFICATION (NEW FEATURE) ---

function checkBankAccessCode() {
    const pinInput = document.getElementById('bank-access-code');
    if (!pinInput) return;
    
    const pin = pinInput.value;
    
    // Accept any 4-digit PIN for now (in production, verify against stored PIN)
    if (pin && pin.length === 4 && /^\d+$/.test(pin)) {
        state.isBankPinVerified = true;
        
        // Hide the gate and show bank management content
        const gate = document.getElementById('bank-access-gate');
        const content = document.getElementById('bank-management-content');
        
        if (gate) gate.classList.add('hidden');
        if (content) content.classList.remove('hidden');
        
        showToast("Bank management unlocked successfully!", "success");
        
        // Initialize bank system if user is logged in
        if (state.user) {
            initApp();
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
        
        // Update system status
        updateSystemStatus(true);
        showToast(`Welcome back, ${user.email.split('@')[0]}!`, "success");
        
        // Load processed transactions
        loadProcessedTransactions().then(() => {
            // Initialize app if PIN is already verified
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
        
        // Update system status
        updateSystemStatus(false);
        
        // Reset PIN verification
        state.isBankPinVerified = false;
        
        // Hide bank management content if PIN gate exists
        const gate = document.getElementById('bank-access-gate');
        const content = document.getElementById('bank-management-content');
        if (gate) gate.classList.remove('hidden');
        if (content) content.classList.add('hidden');
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

// --- PROCESSED TRANSACTIONS MANAGEMENT (NEW FEATURE) ---

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
        
        // Update UI
        renderDashboard();
        updateStatistics();
        updateLastSyncTime();
        
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
        let query = db.collection('bankLedger').orderBy('date', 'desc');
        
        // Filter by user if field exists (for backward compatibility)
        if (state.user) {
            // Try to filter by userId first
            query = db.collection('bankLedger')
                .where('userId', '==', state.user.uid)
                .orderBy('date', 'desc');
        }
        
        const snap = await query.limit(1000).get();
        
        state.ledger = snap.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data() 
        }));
        
        console.log(`Loaded ${state.ledger.length} ledger entries`);
        renderLedgerTable();
        
        return state.ledger;
    } catch (error) {
        console.error("Failed to load ledger:", error);
        // Fallback to loading without user filter
        const snap = await db.collection('bankLedger')
            .orderBy('date', 'desc')
            .limit(1000)
            .get();
        
        state.ledger = snap.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data() 
        }));
        
        console.log(`Loaded ${state.ledger.length} ledger entries (fallback)`);
        renderLedgerTable();
        
        return state.ledger;
    }
}

// --- RECEIPT PAYMENTS PROCESSING (ENHANCED) ---

async function processReceiptPayments() {
    try {
        const receiptsSnap = await db.collection('receipt_payments')
            .orderBy('createdAt', 'desc')
            .limit(200)
            .get();
        
        const batch = db.batch();
        let newCount = 0;
        let skippedCount = 0;
        
        receiptsSnap.forEach(doc => {
            const transactionId = doc.id;
            
            // Skip if already processed
            if (state.processedTransactions.has(transactionId)) {
                skippedCount++;
                return;
            }
            
            const data = doc.data();
            const amount = parseFloat(data.amountUSD || data.amountKSH || data.amount || 0);
            
            if (amount === 0 || isNaN(amount)) {
                skippedCount++;
                return;
            }
            
            // Parse bank name from payment method
            const bankName = parseBankName(data.paymentMethod);
            if (!bankName) {
                console.warn(`Could not parse bank name from: ${data.paymentMethod}`);
                skippedCount++;
                return;
            }
            
            // Find matching bank
            const targetBank = state.banks.find(bank => 
                bank.name.toLowerCase().includes(bankName.toLowerCase()) ||
                bankName.toLowerCase().includes(bank.name.toLowerCase())
            );
            
            if (!targetBank) {
                console.warn(`No matching bank found for: ${bankName}`);
                skippedCount++;
                return;
            }
            
            // Create ledger entry
            const ledgerRef = db.collection('bankLedger').doc();
            batch.set(ledgerRef, {
                date: data.paymentDate || data.createdAt || new Date().toISOString(),
                type: 'receipt',
                amount: amount,
                bankId: targetBank.id,
                bankName: targetBank.name,
                currency: data.currency || targetBank.currency || 'KES',
                description: `Receipt #${data.receiptNumber || 'N/A'} - ${data.description || data.customerName || ''}`,
                sourceDocId: doc.id,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                userId: state.user?.uid,
                userEmail: state.user?.email
            });
            
            state.processedTransactions.add(transactionId);
            newCount++;
        });
        
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

function updateBankSelects() {
    const selects = ['t-from', 't-to', 'w-bank'];
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
        if (id === 't-from' || id === 'w-bank') {
            select.addEventListener('change', function() {
                updateBankBalanceDisplay(this.value, `${id}-balance`);
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
        balanceEl.className = `text-sm ${balance >= 0 ? 'text-green-600' : 'text-red-600'} font-medium mt-2`;
    } else {
        balanceEl.textContent = '';
    }
}

// --- CORE CALCULATIONS (Enhanced with Opening Balance Timestamps) ---

function calculateBalances() {
    // Reset balances
    state.balances = {};
    
    // Initialize each bank with 0 or opening balance
    state.banks.forEach(bank => {
        let cutoffDate = null;
        let startBalance = 0;
        
        // Check for opening balance configuration from timestamps
        if (state.openingBalanceTimestamps[bank.name]) {
            startBalance = state.openingBalanceTimestamps[bank.name].balance || 0;
            if (state.openingBalanceTimestamps[bank.name].timestamp) {
                cutoffDate = new Date(state.openingBalanceTimestamps[bank.name].timestamp).getTime();
            }
        }
        // Fallback to bankDetails openingBalanceConfig
        else if (bank.openingBalanceConfig && bank.openingBalanceConfig.amount) {
            startBalance = parseFloat(bank.openingBalanceConfig.amount) || 0;
            if (bank.openingBalanceConfig.dateString) {
                cutoffDate = new Date(bank.openingBalanceConfig.dateString).getTime();
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
            const txDate = new Date(tx.date).getTime();
            const amount = parseFloat(tx.amount) || 0;
            
            // Skip if transaction is before cutoff date
            if (cutoffDate && txDate < cutoffDate) return;
            
            // Process based on transaction type
            switch (tx.type) {
                case 'receipt':
                    if (tx.bankId === bank.id) {
                        state.balances[bank.id] += amount;
                    }
                    break;
                    
                case 'withdrawal':
                    if (tx.bankId === bank.id) {
                        state.balances[bank.id] -= amount;
                    }
                    break;
                    
                case 'transfer':
                    // Outgoing transfer
                    if (tx.bankId === bank.id) {
                        state.balances[bank.id] -= amount;
                    }
                    // Incoming transfer
                    if (tx.toBankId === bank.id) {
                        state.balances[bank.id] += amount;
                    }
                    break;
                    
                default:
                    console.warn('Unknown transaction type:', tx.type);
            }
        });
    });
}

// --- SYNC ENGINE (Enhanced Receipt Processing) ---

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

// --- ACTIONS (Enhanced with Validation) ---

// 1. Inter-Bank Transfer
document.getElementById('transfer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const fromId = document.getElementById('t-from').value;
    const toId = document.getElementById('t-to').value;
    const amount = parseFloat(document.getElementById('t-amount').value);
    const desc = document.getElementById('t-desc').value;
    
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
    
    // Check balance
    const currentBalance = state.balances[fromId] || 0;
    if (currentBalance < amount) {
        showToast(`Insufficient funds. Available: ${formatCurrency(currentBalance, fromBank.currency)}`, 'error');
        return;
    }
    
    // Currency mismatch warning
    if (fromBank.currency !== toBank.currency) {
        if (!confirm(`Warning: Currencies differ (${fromBank.currency} vs ${toBank.currency}). Proceed?`)) {
            return;
        }
    }
    
    showLoading(true, 'Processing transfer...');
    
    try {
        const transferDate = new Date().toISOString();
        const reference = `TRX-${Date.now()}`;
        
        // Add outgoing ledger entry
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
            createdBy: state.user?.email || 'Unknown',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'completed',
            userId: state.user?.uid
        });
        
        closeModal('transfer-modal');
        document.getElementById('transfer-form').reset();
        
        // Refresh data
        await initApp();
        
        showToast(`Transfer of ${formatCurrency(amount, fromBank.currency)} completed successfully!`, 'success');
    } catch (error) {
        showToast('Transfer failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
});

// 2. Withdrawal
document.getElementById('withdrawal-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const bankId = document.getElementById('w-bank').value;
    const amount = parseFloat(document.getElementById('w-amount').value);
    const category = document.getElementById('w-category').value;
    const desc = document.getElementById('w-desc').value;
    
    // Validation
    if (!bankId) {
        showToast('Please select a bank account', 'error');
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
    
    showLoading(true, 'Processing withdrawal...');
    
    try {
        await db.collection('bankLedger').add({
            type: 'withdrawal',
            date: new Date().toISOString(),
            amount: amount,
            bankId: bankId,
            bankName: bank.name,
            currency: bank.currency,
            category: category,
            description: `${category} - ${desc}`,
            createdBy: state.user?.email || 'Unknown',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'completed',
            userId: state.user?.uid
        });
        
        closeModal('withdrawal-modal');
        document.getElementById('withdrawal-form').reset();
        
        // Refresh data
        await initApp();
        
        showToast(`Withdrawal of ${formatCurrency(amount, bank.currency)} recorded successfully!`, 'success');
    } catch (error) {
        showToast('Withdrawal failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
});

// 3. Opening Balance with Timestamps (NEW IMPLEMENTATION)
document.getElementById('opening-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const bankId = document.getElementById('op-bank-id').value;
    const amount = parseFloat(document.getElementById('op-amount').value);
    const date = document.getElementById('op-date').value;
    
    if (!amount || isNaN(amount) || amount < 0) {
        showToast('Please enter a valid opening balance', 'error');
        return;
    }
    
    if (!date) {
        showToast('Please select an effective date', 'error');
        return;
    }
    
    const bank = state.banks.find(b => b.id === bankId);
    if (!bank) {
        showToast('Bank not found', 'error');
        return;
    }
    
    if (!confirm(`Are you sure? This will reset all transaction history before ${date} for ${bank.name}.`)) {
        return;
    }
    
    showLoading(true, 'Setting opening balance...');
    
    try {
        // Store in openingBalanceTimestamps
        state.openingBalanceTimestamps[bank.name] = {
            balance: amount,
            timestamp: new Date(date),
            updatedBy: state.user?.email || 'Anonymous',
            updatedAt: new Date().toISOString()
        };
        
        // Save to processed transactions
        await saveProcessedTransactions();
        
        // Also update bankDetails for backward compatibility
        await db.collection('bankDetails').doc(bankId).update({
            openingBalanceConfig: {
                amount: amount,
                dateString: date,
                updatedAt: new Date().toISOString(),
                updatedBy: state.user?.email || 'Unknown'
            }
        });
        
        closeModal('opening-balance-modal');
        
        // Refresh data
        await initApp();
        
        showToast('Opening balance set successfully!', 'success');
    } catch (error) {
        showToast('Failed to set opening balance: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
});

// --- UI RENDERING (Enhanced with Bank Details) ---

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
            } else if (tx.type === 'withdrawal' || (tx.type === 'transfer' && tx.bankId === bank.id)) {
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
                <button onclick="openWithdrawalModal('${bank.id}')" 
                        class="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2 px-3 rounded-lg transition-all">
                    <i class="fas fa-money-check-alt mr-1"></i> Withdraw
                </button>
                <button onclick="openOpeningModal('${bank.id}')" 
                        class="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-3 rounded-lg transition-all">
                    <i class="fas fa-balance-scale mr-1"></i> Set Opening Balance
                </button>
            </div>
            
            ${hasOpeningTimestamp ? `
                <div class="mt-4 pt-4 border-t border-gray-200">
                    <div class="text-xs text-gray-500">
                        <div class="flex items-center mb-1">
                            <i class="fas fa-calendar-alt mr-1"></i>
                            <span>Opening balance set on: ${new Date(state.openingBalanceTimestamps[bank.name].timestamp).toLocaleDateString()}</span>
                        </div>
                        ${state.openingBalanceTimestamps[bank.name].notes ? `
                            <div class="flex items-center">
                                <i class="fas fa-sticky-note mr-1"></i>
                                <span class="truncate" title="${state.openingBalanceTimestamps[bank.name].notes}">${state.openingBalanceTimestamps[bank.name].notes}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}
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
    
    // Show latest 50 transactions
    const transactionsToShow = state.ledger.slice(0, 50);
    
    transactionsToShow.forEach(tx => {
        const dateObj = new Date(tx.date);
        const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // Determine badge style
        let typeBadge = '';
        let amountClass = '';
        let sign = '';
        
        switch(tx.type) {
            case 'receipt':
                typeBadge = '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Receipt</span>';
                amountClass = 'text-green-600';
                sign = '+';
                break;
            case 'withdrawal':
                typeBadge = '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Payment</span>';
                amountClass = 'text-red-600';
                sign = '-';
                break;
            case 'transfer':
                typeBadge = '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">Transfer</span>';
                amountClass = 'text-purple-600';
                sign = '↔';
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
                    ${tx.bankName || 'N/A'} 
                    ${tx.toBankName ? `<i class="fas fa-arrow-right mx-1 text-gray-400 text-xs"></i> ${tx.toBankName}` : ''}
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

// --- TRANSFER CONFIRMATION MODAL (NEW FEATURE) ---

function showTransferConfirmation() {
    const fromId = document.getElementById('t-from')?.value;
    const toId = document.getElementById('t-to')?.value;
    const amount = parseFloat(document.getElementById('t-amount')?.value || 0);
    const desc = document.getElementById('t-desc')?.value || '';
    
    if (!fromId || !toId || !amount) {
        showToast('Please fill in all transfer details first', 'error');
        return;
    }
    
    const fromBank = state.banks.find(b => b.id === fromId);
    const toBank = state.banks.find(b => b.id === toId);
    
    if (!fromBank || !toBank) {
        showToast('Bank selection error', 'error');
        return;
    }
    
    // Create confirmation modal
    const modal = document.createElement('div');
    modal.id = 'transfer-confirm-modal-custom';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black bg-opacity-50" onclick="closeCustomModal()"></div>
        <div class="relative bg-white rounded-xl shadow-2xl max-w-md w-full mx-auto p-6">
            <div class="text-center mb-6">
                <i class="fas fa-paper-plane text-5xl text-green-600 mb-4"></i>
                <h3 class="text-2xl font-bold text-gray-800 mb-2">Confirm Transfer</h3>
                <p class="text-gray-600">Please confirm the bank transfer details</p>
            </div>
            
            <div class="bg-gray-50 rounded-lg p-6 mb-6">
                <div class="space-y-3">
                    <div class="flex justify-between">
                        <span class="text-gray-600">From:</span>
                        <span class="font-semibold">${fromBank.name}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-600">To:</span>
                        <span class="font-semibold">${toBank.name}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-600">Amount:</span>
                        <span class="font-semibold text-green-600">${formatCurrency(amount, fromBank.currency)}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-600">Description:</span>
                        <span class="font-semibold">${desc}</span>
                    </div>
                </div>
            </div>
            
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Security PIN</label>
                    <input type="password" id="transfer-confirm-pin" 
                           class="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-xl tracking-widest focus:ring-2 focus:ring-green-600"
                           placeholder="0000" maxlength="4" required>
                    <p class="text-xs text-gray-500 mt-2">Enter your 4-digit security PIN to confirm</p>
                </div>
                
                <div class="flex space-x-4">
                    <button onclick="closeCustomModal()"
                            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 rounded-lg transition-all">
                        Cancel
                    </button>
                    <button onclick="executeConfirmedTransfer('${fromId}', '${toId}', ${amount}, '${desc.replace(/'/g, "\\'")}')"
                            class="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition-all">
                        Confirm Transfer
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function closeCustomModal() {
    const modal = document.getElementById('transfer-confirm-modal-custom');
    if (modal) {
        modal.remove();
    }
}

async function executeConfirmedTransfer(fromId, toId, amount, desc) {
    const pin = document.getElementById('transfer-confirm-pin')?.value;
    
    if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
        showToast("Please enter a valid 4-digit PIN", "error");
        return;
    }
    
    // Verify PIN (in production, verify against stored PIN)
    if (pin !== state.bankPin) {
        showToast("Invalid PIN", "error");
        return;
    }
    
    showLoading(true, 'Processing transfer...');
    
    try {
        const fromBank = state.banks.find(b => b.id === fromId);
        const toBank = state.banks.find(b => b.id === toId);
        
        const transferDate = new Date().toISOString();
        const reference = `TRX-${Date.now()}`;
        
        // Add outgoing ledger entry
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
            createdBy: state.user?.email || 'Unknown',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'completed',
            userId: state.user?.uid
        });
        
        closeCustomModal();
        closeModal('transfer-modal');
        document.getElementById('transfer-form').reset();
        
        // Refresh data
        await initApp();
        
        showToast(`Transfer of ${formatCurrency(amount, fromBank.currency)} completed successfully!`, 'success');
    } catch (error) {
        showToast('Transfer failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// --- OPENING BALANCE MODAL (ENHANCED) ---

function openOpeningModal(bankId) {
    // Check if PIN is verified
    if (!state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    const bank = state.banks.find(b => b.id === bankId);
    if (!bank) return;
    
    // Create enhanced opening balance modal
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
                    <label class="block text-sm font-medium text-gray-700 mb-2">As of Date</label>
                    <input type="date" id="opening-balance-date-enhanced" 
                           class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                           required>
                    <p class="text-sm text-gray-500 mt-2">
                        Transactions before this date will be excluded from calculations
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
        const notes = document.getElementById('opening-balance-notes-enhanced').value;
        
        if (!amount || isNaN(amount) || amount < 0) {
            showToast('Please enter a valid balance amount', 'error');
            return;
        }
        
        if (!date) {
            showToast('Please select a date', 'error');
            return;
        }
        
        showLoading(true, 'Setting opening balance...');
        
        try {
            // Store in openingBalanceTimestamps
            state.openingBalanceTimestamps[bank.name] = {
                balance: amount,
                timestamp: new Date(date),
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
                    dateString: date,
                    updatedAt: new Date().toISOString(),
                    updatedBy: state.user?.email || 'Unknown',
                    notes: notes
                }
            });
            
            closeOpeningModalEnhanced();
            
            // Refresh data
            await initApp();
            
            showToast('Opening balance set successfully!', 'success');
        } catch (error) {
            showToast('Failed to set opening balance: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    });
}

function closeOpeningModalEnhanced() {
    const modal = document.getElementById('opening-balance-modal-enhanced');
    if (modal) {
        modal.remove();
    }
}

// --- WITHDRAWAL MODAL (ENHANCED) ---

function openWithdrawalModal(bankId) {
    // Check if PIN is verified
    if (!state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    const bank = state.banks.find(b => b.id === bankId);
    if (!bank) return;
    
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
                userId: state.user?.uid
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

// --- ALL BANKS SUMMARY (NEW FEATURE) ---

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
            } else if (tx.type === 'withdrawal' || (tx.type === 'transfer' && tx.bankId === bank.id)) {
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

// --- NEW FEATURES ---

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
    
    // If opening ledger tab, refresh the table
    if (tabName === 'ledger-history') {
        renderLedgerTable();
    }
}

function openModal(id) {
    // Check if PIN is verified for bank-related modals
    if ((id === 'transfer-modal' || id === 'withdrawal-modal') && !state.isBankPinVerified) {
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

function exportLedgerToPDF() {
    showToast('PDF export feature coming soon!', 'info');
    // Future implementation with jsPDF
}

// Initialize on load
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is already logged in
    const user = auth.currentUser;
    if (user) {
        updateSystemStatus(true);
        // PIN verification will trigger initApp
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
    
    // Set opening balance modal date to today
    const opDateInput = document.getElementById('op-date');
    if (opDateInput && !opDateInput.value) {
        opDateInput.value = today;
    }
    
    // Initialize Firebase
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
});

// Expose functions to global scope for HTML onclick handlers
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
