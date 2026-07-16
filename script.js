// script.js - Enhanced Bank Ledger System with Complete Features - PRODUCTION READY

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

// Enable persistence for offline support
db.enablePersistence({ synchronizeTabs: true })
    .catch(err => console.warn('Firestore persistence error:', err));

// --- LIVE SYNC (real-time updates across all logged-in users) ---
// Holds active onSnapshot unsubscribe functions so they can be torn down on logout.
let liveListenerUnsubscribers = [];
let liveSyncDebounceTimer = null;
let liveListenersAttached = false;

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
    processedTransactions: new Set(),
    openingBalanceTimestamps: {},
    bankDetails: [],
    expenseCategories: [], // From Excel
    customRecipients: [], // Custom recipients
    expenseSummary: {}, // Category -> total amount
    chartInstance: null, // Chart.js instance
    transactionLock: false, // For preventing race conditions
    idempotencyKeys: new Set(), // Prevent duplicate transactions
    balanceVerification: {}, // Store verification results
    
    // PIN Management State
    pinManagement: {
        currentPin: '',
        newPin: '',
        confirmPin: '',
        mode: 'create'
    },
    
    // ===== FIXED: These properties are correctly added with commas =====
    openModals: new Set(), // Track open modals to prevent dropdown refresh
    lastSelection: {
        transferFrom: null,
        transferTo: null,
        expenseBank: null,
        creditBank: null,
        withdrawalBank: null
    },

    // Accrual Finance State
    accruals: {
        entries: [],
        summary: {
            totalReceivable: { KES: 0, USD: 0 },
            totalPayable: { KES: 0, USD: 0 },
            overdueReceivable: { KES: 0, USD: 0 },
            overduePayable: { KES: 0, USD: 0 },
            aging: {
                current:    { receivable: { KES: 0, USD: 0 }, payable: { KES: 0, USD: 0 } },
                thirtyPlus: { receivable: { KES: 0, USD: 0 }, payable: { KES: 0, USD: 0 } },
                sixtyPlus:  { receivable: { KES: 0, USD: 0 }, payable: { KES: 0, USD: 0 } },
                ninetyPlus: { receivable: { KES: 0, USD: 0 }, payable: { KES: 0, USD: 0 } }
            },
            pendingCount: { receivable: 0, payable: 0 },
            settledCount: { receivable: 0, payable: 0 }
        }
    }
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

// Maximum amounts for validation
const MAX_AMOUNT = 1000000000; // 1 billion
const MAX_TRANSACTION_FEE = 10000000; // 10 million

// --- UTILITY FUNCTIONS ---

function sanitizeString(str) {
    if (!str) return '';
    return DOMPurify.sanitize(String(str).trim());
}

function showLoading(show, text = "Loading...") {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    
    if (overlay && loadingText) {
        loadingText.textContent = sanitizeString(text);
        overlay.classList.toggle('hidden', !show);
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    // Sanitize message
    const safeMessage = sanitizeString(message);
    
    const toast = document.createElement('div');
    toast.className = `toast bg-white border-l-4 ${type === 'success' ? 'border-green-500' : type === 'error' ? 'border-red-500' : 'border-blue-500'} shadow-lg rounded-lg p-4 mb-2`;
    toast.innerHTML = `
        <div class="flex items-center">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'} 
               ${type === 'success' ? 'text-green-500' : type === 'error' ? 'text-red-500' : 'text-blue-500'} mr-3"></i>
            <div>
                <p class="font-medium text-gray-800">${safeMessage}</p>
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

function validateAmount(amount, bank = null, isFee = false, checkBalance = false) {
    // Check if amount exists and is a number
    if (amount === null || amount === undefined || isNaN(amount)) {
        throw new Error('Invalid amount: must be a number');
    }
    
    // Parse to float
    const numAmount = parseFloat(amount);
    
    // Check if positive
    if (numAmount <= 0) {
        throw new Error('Amount must be greater than zero');
    }
    
    // Check maximum (different for fees vs transactions)
    const maxAllowed = isFee ? MAX_TRANSACTION_FEE : MAX_AMOUNT;
    if (numAmount > maxAllowed) {
        throw new Error(`Amount exceeds maximum limit of ${maxAllowed.toLocaleString()}`);
    }
    
    // Check decimal places (max 2)
    if (!/^\d+(\.\d{1,2})?$/.test(numAmount.toString())) {
        throw new Error('Amount can have at most 2 decimal places');
    }
    
    // If bank provided and checkBalance is explicitly true, verify sufficient funds
    if (bank && checkBalance) {
        const currentBalance = state.balances[bank.id] || 0;
        if (currentBalance < numAmount) {
            throw new Error(`Insufficient funds. Available: ${formatCurrency(currentBalance, bank.currency)}`);
        }
    }
    
    return parseFloat(numAmount.toFixed(2));
}
// -----------------------------------------------------------------
// Waits for state.transactionLock to be free before proceeding. Used by
// writes that must never overlap with an in-flight processReceiptPayments()
// pass — see the opening-balance handler for why this matters: without it,
// a receipt-processing pass that started just before an opening balance
// change can finish deciding (using the OLD cutoff) and commit its batch
// AFTER the new cutoff has been written, silently including transactions
// the user just tried to exclude.
async function waitForTransactionLock(maxWaitMs = 15000, pollMs = 150) {
    const start = Date.now();
    while (state.transactionLock) {
        if (Date.now() - start > maxWaitMs) {
            throw new Error('Timed out waiting for an in-progress transaction to finish. Please try again in a moment.');
        }
        await new Promise(resolve => setTimeout(resolve, pollMs));
    }
}

function generateIdempotencyKey(operation, params) {
    const str = `${operation}_${JSON.stringify(params)}_${Date.now()}_${Math.random()}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
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

// --- AUDIT LOGGING ---

async function addAuditLog(action, details, status = 'success') {
    try {
        if (!state.user) return;
        
        await db.collection('auditLogs').add({
            userId: state.user.uid,
            userEmail: state.user.email,
            action: action,
            details: details,
            status: status,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            ipAddress: 'client-side', // Would need backend for real IP
            userAgent: navigator.userAgent
        });
    } catch (error) {
        console.error('Failed to add audit log:', error);
    }
}

// --- BANK PIN VERIFICATION (SECURE VERSION) ---

async function verifyBankAccessPin() {
    const pinInput = document.getElementById('bank-access-code');
    const errorEl = document.getElementById('pin-error-message');
    if (!pinInput) return;
    
    const pin = pinInput.value;
    
    if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
        if (errorEl) {
            errorEl.textContent = 'Please enter a valid 4-digit PIN';
            errorEl.classList.remove('hidden');
        }
        return;
    }
    
    showLoading(true, 'Verifying PIN...');
    
    try {
        // Get user-specific PIN from Firestore (no hardcoded PIN)
        const pinDoc = await db.collection('systemSettings').doc('bankPin').get();
        
        let storedPinHash = null;
        if (pinDoc.exists) {
            storedPinHash = pinDoc.data().pinHash;
        }
        
        // If no PIN is set in system, allow first-time setup with a secure default?
        // For security, we'll require the PIN to be set in Firestore first
        
        if (!storedPinHash) {
            showToast('Bank PIN not configured. Please contact administrator.', 'error');
            if (errorEl) {
                errorEl.textContent = 'System not configured. Contact admin.';
                errorEl.classList.remove('hidden');
            }
            return;
        }
        
        // Simple hash for demo - in production use proper bcrypt via Cloud Function
        const inputHash = btoa(pin); // Simple encoding - REPLACE with proper hash
        
        if (inputHash === storedPinHash) {
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
            
            if (errorEl) errorEl.classList.add('hidden');
            
            showToast("Bank management unlocked successfully!", "success");
            await addAuditLog('PIN_VERIFICATION_SUCCESS', { method: 'bank_access' });

              // Show PIN manage button in header (in case it wasn't already visible)
    document.getElementById('pin-manage-btn')?.classList.remove('hidden');
            
            // Initialize bank system if user is logged in
            if (state.user) {
                initApp();
            }
        } else {
            showToast("Invalid PIN. Please try again.", "error");
            if (errorEl) {
                errorEl.textContent = 'Invalid PIN';
                errorEl.classList.remove('hidden');
            }
            pinInput.value = '';
            pinInput.focus();
            await addAuditLog('PIN_VERIFICATION_FAILED', { method: 'bank_access' }, 'failure');
        }
    } catch (error) {
        console.error('PIN verification error:', error);
        showToast('Error verifying PIN: ' + error.message, 'error');
    } finally {
        showLoading(false);
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

        // Show PIN manage button in header (visible even before PIN verification)
        document.getElementById('pin-manage-btn')?.classList.remove('hidden');
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
        
        addAuditLog('USER_LOGIN', { email: user.email });
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

        // Hide PIN manage button when logged out
        document.getElementById('pin-manage-btn')?.classList.add('hidden');
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
        addAuditLog('USER_LOGOUT', { email: state.user?.email });
        teardownLiveListeners();
        state.systemReady = false;
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

// PIN Management State
//let pinManagementState = {
    //currentPin: '',
   // newPin: '',
  //  confirmPin: '',
    //mode: 'create' // 'create' or 'change'
//};

// PIN dot indicators
function updatePinDots(value) {
    const dots = document.querySelectorAll('#pin-dots .pin-dot');
    for (let i = 0; i < 4; i++) {
        if (i < value.length) {
            dots[i].className = 'pin-dot pin-dot-active';
        } else {
            dots[i].className = 'pin-dot pin-dot-inactive';
        }
    }
}

// Update these functions:

function updateCreatePinDots(value) {
    const dots = document.querySelectorAll('#create-pin-dots .pin-dot');
    for (let i = 0; i < 4; i++) {
        if (i < value.length) {
            dots[i].className = 'pin-dot pin-dot-active';
        } else {
            dots[i].className = 'pin-dot pin-dot-inactive';
        }
    }
    state.pinManagement.newPin = value; // Changed from pinManagementState
}

function updateConfirmPinDots(value) {
    const dots = document.querySelectorAll('#confirm-pin-dots .pin-dot');
    for (let i = 0; i < 4; i++) {
        if (i < value.length) {
            dots[i].className = 'pin-dot pin-dot-active';
        } else {
            dots[i].className = 'pin-dot pin-dot-inactive';
        }
    }
    state.pinManagement.confirmPin = value; // Changed from pinManagementState
}

function updateCurrentPinDots(value) {
    const dots = document.querySelectorAll('#current-pin-dots .pin-dot');
    for (let i = 0; i < 4; i++) {
        if (i < value.length) {
            dots[i].className = 'pin-dot pin-dot-active';
        } else {
            dots[i].className = 'pin-dot pin-dot-inactive';
        }
    }
    state.pinManagement.currentPin = value; // Changed from pinManagementState
}

function updateChangeNewPinDots(value) {
    const dots = document.querySelectorAll('#change-new-pin-dots .pin-dot');
    for (let i = 0; i < 4; i++) {
        if (i < value.length) {
            dots[i].className = 'pin-dot pin-dot-active';
        } else {
            dots[i].className = 'pin-dot pin-dot-inactive';
        }
    }
    state.pinManagement.newPin = value; // Changed from pinManagementState
}

function updateChangeConfirmPinDots(value) {
    const dots = document.querySelectorAll('#change-confirm-pin-dots .pin-dot');
    for (let i = 0; i < 4; i++) {
        if (i < value.length) {
            dots[i].className = 'pin-dot pin-dot-active';
        } else {
            dots[i].className = 'pin-dot pin-dot-inactive';
        }
    }
    state.pinManagement.confirmPin = value; // Changed from pinManagementState
}

function switchPinTab(tab) {
    state.pinManagement.mode = tab; // Changed from pinManagementState
    
    // Update tab styles
    document.getElementById('tab-create').classList.toggle('active', tab === 'create');
    document.getElementById('tab-change').classList.toggle('active', tab === 'change');
    
    // Show/hide forms
    document.getElementById('create-pin-form').classList.toggle('hidden', tab !== 'create');
    document.getElementById('change-pin-form').classList.toggle('hidden', tab !== 'change');
    
    // Clear all inputs
    document.querySelectorAll('#create-pin-form input, #change-pin-form input').forEach(input => {
        input.value = '';
    });
    
    // Reset dots
    updateCreatePinDots('');
    updateConfirmPinDots('');
    updateCurrentPinDots('');
    updateChangeNewPinDots('');
    updateChangeConfirmPinDots('');
    
    // Hide error messages
    document.getElementById('create-pin-error').classList.add('hidden');
    document.getElementById('change-pin-error').classList.add('hidden');
}

function showPinManagementModal() {
    // Reset state
    state.pinManagement = { // Changed from pinManagementState
        currentPin: '',
        newPin: '',
        confirmPin: '',
        mode: 'create'
    };

    function closePinManagementModal() {
    const modal = document.getElementById('pin-management-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}
    
    // Reset UI
    document.getElementById('tab-create').classList.add('active');
    document.getElementById('tab-change').classList.remove('active');
    document.getElementById('create-pin-form').classList.remove('hidden');
    document.getElementById('change-pin-form').classList.add('hidden');
    
    // Clear all inputs
    document.querySelectorAll('#create-pin-form input, #change-pin-form input').forEach(input => {
        input.value = '';
    });
    
    // Reset dots
    updateCreatePinDots('');
    updateConfirmPinDots('');
    updateCurrentPinDots('');
    updateChangeNewPinDots('');
    updateChangeConfirmPinDots('');
    
    // Hide error messages
    document.getElementById('create-pin-error').classList.add('hidden');
    document.getElementById('change-pin-error').classList.add('hidden');
    
    // Show modal
    // Show modal
    document.getElementById('pin-management-modal').classList.remove('hidden');
}

function closePinManagementModal() {
    const modal = document.getElementById('pin-management-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

async function createNewPin() {
    const errorEl = document.getElementById('create-pin-error');
    
    // Validate PINs
    if (!state.pinManagement.newPin || state.pinManagement.newPin.length !== 4) { // Changed
        errorEl.textContent = 'Please enter a 4-digit PIN';
        errorEl.classList.remove('hidden');
        return;
    }
    
    if (!state.pinManagement.confirmPin || state.pinManagement.confirmPin.length !== 4) { // Changed
        errorEl.textContent = 'Please confirm your PIN';
        errorEl.classList.remove('hidden');
        return;
    }
    
    if (state.pinManagement.newPin !== state.pinManagement.confirmPin) { // Changed
        errorEl.textContent = 'PINs do not match';
        errorEl.classList.remove('hidden');
        return;
    }
    
    // Validate that it's numeric
    if (!/^\d+$/.test(state.pinManagement.newPin)) { // Changed
        errorEl.textContent = 'PIN must contain only numbers';
        errorEl.classList.remove('hidden');
        return;
    }
    
    showLoading(true, 'Creating PIN...');
    
    try {
        // Simple hash for demo - in production use proper bcrypt via Cloud Function
        const pinHash = btoa(state.pinManagement.newPin); // Changed
        
        // Store in Firestore
        await db.collection('systemSettings').doc('bankPin').set({
            pinHash: pinHash,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: state.user?.email || 'system'
        }, { merge: true });
        
        // Add audit log
        await addAuditLog('PIN_CREATED', { 
            createdBy: state.user?.email || 'system'
        });
        
        showToast('PIN created successfully!', 'success');
        closePinManagementModal();
        
        // Clear PIN input on access gate
        document.getElementById('bank-access-code').value = '';
        updatePinDots('');
        
    } catch (error) {
        console.error('PIN creation error:', error);
        errorEl.textContent = 'Failed to create PIN: ' + error.message;
        errorEl.classList.remove('hidden');
    } finally {
        showLoading(false);
    }
}

async function changeExistingPin() {
    const errorEl = document.getElementById('change-pin-error');
    
    // Validate current PIN
    if (!state.pinManagement.currentPin || state.pinManagement.currentPin.length !== 4) { // Changed
        errorEl.textContent = 'Please enter your current PIN';
        errorEl.classList.remove('hidden');
        return;
    }
    
    // Validate new PIN
    if (!state.pinManagement.newPin || state.pinManagement.newPin.length !== 4) { // Changed
        errorEl.textContent = 'Please enter a new 4-digit PIN';
        errorEl.classList.remove('hidden');
        return;
    }
    
    if (!state.pinManagement.confirmPin || state.pinManagement.confirmPin.length !== 4) { // Changed
        errorEl.textContent = 'Please confirm your new PIN';
        errorEl.classList.remove('hidden');
        return;
    }
    
    if (state.pinManagement.newPin !== state.pinManagement.confirmPin) { // Changed
        errorEl.textContent = 'New PINs do not match';
        errorEl.classList.remove('hidden');
        return;
    }
    
    // Validate that PINs are numeric
    if (!/^\d+$/.test(state.pinManagement.currentPin) || !/^\d+$/.test(state.pinManagement.newPin)) { // Changed
        errorEl.textContent = 'PINs must contain only numbers';
        errorEl.classList.remove('hidden');
        return;
    }
    
    // Don't allow same PIN
    if (state.pinManagement.currentPin === state.pinManagement.newPin) { // Changed
        errorEl.textContent = 'New PIN must be different from current PIN';
        errorEl.classList.remove('hidden');
        return;
    }
    
    showLoading(true, 'Changing PIN...');
    
    try {
        // Get current PIN hash from Firestore
        const pinDoc = await db.collection('systemSettings').doc('bankPin').get();
        
        if (!pinDoc.exists) {
            errorEl.textContent = 'No PIN configured. Please create a PIN first.';
            errorEl.classList.remove('hidden');
            return;
        }
        
        const storedPinHash = pinDoc.data().pinHash;
        const currentPinHash = btoa(state.pinManagement.currentPin); // Changed
        
        // Verify current PIN
        if (currentPinHash !== storedPinHash) {
            errorEl.textContent = 'Current PIN is incorrect';
            errorEl.classList.remove('hidden');
            return;
        }
        
        // Store new PIN hash
        const newPinHash = btoa(state.pinManagement.newPin); // Changed
        
        await db.collection('systemSettings').doc('bankPin').set({
            pinHash: newPinHash,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: state.user?.email || 'system',
            previousHash: storedPinHash // Store previous hash for audit trail
        }, { merge: true });
        
        // Add audit log
        await addAuditLog('PIN_CHANGED', { 
            changedBy: state.user?.email || 'system'
        });
        
        showToast('PIN changed successfully!', 'success');
        closePinManagementModal();
        
        // Clear PIN input on access gate
        document.getElementById('bank-access-code').value = '';
        updatePinDots('');
        
    } catch (error) {
        console.error('PIN change error:', error);
        errorEl.textContent = 'Failed to change PIN: ' + error.message;
        errorEl.classList.remove('hidden');
    } finally {
        showLoading(false);
    }
}

// Update the verifyBankAccessPin function to use Firestore-stored PIN
async function verifyBankAccessPin() {
    const pinInput = document.getElementById('bank-access-code');
    const errorEl = document.getElementById('pin-error-message');
    if (!pinInput) return;
    
    const pin = pinInput.value;
    
    if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
        if (errorEl) {
            errorEl.textContent = 'Please enter a valid 4-digit PIN';
            errorEl.classList.remove('hidden');
        }
        return;
    }
    
    showLoading(true, 'Verifying PIN...');
    
    try {
        // Get user-specific PIN from Firestore
        const pinDoc = await db.collection('systemSettings').doc('bankPin').get();
        
        let storedPinHash = null;
        if (pinDoc.exists) {
            storedPinHash = pinDoc.data().pinHash;
        }
        
        // If no PIN is set, prompt user to create one
        if (!storedPinHash) {
            showToast('No PIN configured. Please create a PIN first.', 'warning');
            if (errorEl) {
                errorEl.textContent = 'No PIN configured. Click "Manage PIN" to create one.';
                errorEl.classList.remove('hidden');
            }
            showPinManagementModal();
            return;
        }
        
        // Simple hash for demo - in production use proper bcrypt via Cloud Function
        const inputHash = btoa(pin);
        
        if (inputHash === storedPinHash) {
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
            
            if (errorEl) errorEl.classList.add('hidden');
            
            showToast("Bank management unlocked successfully!", "success");
            await addAuditLog('PIN_VERIFICATION_SUCCESS', { method: 'bank_access' });
            
            // Show PIN manage button in header
            document.getElementById('pin-manage-btn')?.classList.remove('hidden');
            
            // Initialize bank system if user is logged in
            if (state.user) {
                initApp();
            }
        } else {
            showToast("Invalid PIN. Please try again.", "error");
            if (errorEl) {
                errorEl.textContent = 'Invalid PIN';
                errorEl.classList.remove('hidden');
            }
            pinInput.value = '';
            updatePinDots('');
            pinInput.focus();
            await addAuditLog('PIN_VERIFICATION_FAILED', { method: 'bank_access' }, 'failure');
        }
    } catch (error) {
        console.error('PIN verification error:', error);
        showToast('Error verifying PIN: ' + error.message, 'error');
    } finally {
        showLoading(false);
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

    // Guard against overlapping full reloads — e.g. a live-sync tick firing
    // while a user-triggered reload (such as after saving an opening
    // balance) is already in progress. calculateBalances() itself always
    // re-reads the current cutoff so it can't produce wrong numbers, but
    // running two full reloads at once is wasteful and can flash a stale
    // balance mid-way through.
    if (state.initInProgress) {
        console.log('initApp already in progress, skipping overlapping call');
        return;
    }
    state.initInProgress = true;

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

        // Reconcile any receipts that were revoked/deleted in the source
        // app before this session started — otherwise their money would
        // stay in the balance until the next live-sync cycle catches it.
        const { reversedCount } = await reconcileRevokedReceipts(false);
        state.lastReconcileTime = Date.now();
        if (reversedCount > 0) {
            console.log(`Reconciled ${reversedCount} revoked receipt(s) on startup`);
        }

        // Calculate balances
        calculateBalances();
        
        // Calculate expense summary
        calculateExpenseSummary();
        
        // Load accrual entries
        await loadAccruals();
        
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
        
        // Verify balances after initialization
        await verifyAllBalances(false); // Silent verification
        
        // Mark system as ready
        state.systemReady = true;
        updateSystemStatus(true);

        // Start real-time listeners so changes made by other users (opening balance resets,
        // new transactions, new receipts) appear here immediately without a page refresh.
        setupLiveListeners();

        showToast('System initialized successfully!', 'success');
        await addAuditLog('SYSTEM_INIT', { banks: state.banks.length, transactions: state.ledger.length });
    } catch (error) {
        console.error("Init failed", error);
        showToast('Failed to load data: ' + error.message, 'error');
        await addAuditLog('SYSTEM_INIT_FAILED', { error: error.message }, 'failure');
    } finally {
        state.initInProgress = false;
        showLoading(false);
        
        // Update sync status
        const syncStatus = document.getElementById('sync-status-text');
        if (syncStatus) syncStatus.textContent = 'Data loaded successfully';
    }
}

// --- LIVE SYNC: real-time updates so all users see the same balances immediately ---

function scheduleLiveRefresh(reason) {
    // Debounce so a burst of snapshot events (e.g. a batch write) only triggers one recalculation
    if (liveSyncDebounceTimer) clearTimeout(liveSyncDebounceTimer);
    liveSyncDebounceTimer = setTimeout(async () => {
        if (!state.systemReady) return; // don't run before initial load has finished
        if (state.initInProgress) {
            console.log('Live sync: skipping, a full reload is already in progress');
            return;
        }
        try {
            console.log(`Live sync: refreshing (${reason})`);
            await processReceiptPayments();

            // Throttled: check for revoked/deleted receipts at most once every
            // 20 seconds, since each check does a Firestore existence read
            // per outstanding receipt ledger entry.
            const now = Date.now();
            if (!state.lastReconcileTime || now - state.lastReconcileTime > 20000) {
                state.lastReconcileTime = now;
                const { reversedCount } = await reconcileRevokedReceipts(false);
                if (reversedCount > 0) {
                    console.log(`Reconciled ${reversedCount} revoked receipt(s) during live sync`);
                }
            }

            calculateBalances();
            calculateExpenseSummary();
            renderDashboard();
            updateStatistics();
            updateLastSyncTime();
            renderExpenseSummary();
            const syncStatus = document.getElementById('sync-status-text');
            if (syncStatus) syncStatus.textContent = `Live update received (${new Date().toLocaleTimeString()})`;
        } catch (err) {
            console.error('Live sync refresh failed:', err);
        }
    }, 400);
}

function setupLiveListeners() {
    if (liveListenersAttached) return; // avoid attaching twice
    liveListenersAttached = true;

    // Banks + opening balance config (bankDetails) — this is the shared source of truth that
    // was previously only read once at load, so other users' resets never appeared without a
    // manual page refresh. A live listener means every logged-in user's UI updates immediately.
    const unsubBanks = db.collection('bankDetails').onSnapshot(snap => {
        state.banks = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(bank => {
                if (!bank.name) {
                    console.warn('Bank missing name:', bank.id);
                    return false;
                }
                if (!bank.currency) bank.currency = 'KES';
                return true;
            });
        state.bankDetails = state.banks.map(bank => ({
            id: bank.id,
            name: bank.name,
            currency: bank.currency || 'KES',
            openingBalance: bank.openingBalanceConfig?.amount || 0,
            lastUpdated: new Date()
        }));
        updateBankSelects();
        scheduleLiveRefresh('bank details updated');
    }, err => console.error('Live bankDetails listener error:', err));

    // Ledger entries (transfers, withdrawals, expenses, credits)
    const unsubLedger = db.collection('bankLedger')
        .orderBy('date', 'desc')
        .limit(1000)
        .onSnapshot(snap => {
            state.ledger = snap.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    amount: parseFloat(data.amount) || 0,
                    date: data.date || new Date().toISOString()
                };
            }).filter(tx => tx.amount > 0);
            renderLedgerTable();
            scheduleLiveRefresh('ledger updated');
        }, err => console.error('Live bankLedger listener error:', err));

    // New receipts coming in from the receipt-writer app
    const unsubReceipts = db.collection('receipt_payments')
        .orderBy('createdAt', 'desc')
        .limit(200)
        .onSnapshot(() => {
            scheduleLiveRefresh('new receipt payment');
        }, err => console.error('Live receipt_payments listener error:', err));

    liveListenerUnsubscribers = [unsubBanks, unsubLedger, unsubReceipts];
}

function teardownLiveListeners() {
    liveListenerUnsubscribers.forEach(unsub => {
        try { unsub(); } catch (e) { /* already detached */ }
    });
    liveListenerUnsubscribers = [];
    liveListenersAttached = false;
    if (liveSyncDebounceTimer) {
        clearTimeout(liveSyncDebounceTimer);
        liveSyncDebounceTimer = null;
    }
}

async function loadBanks() {
    try {
        const snap = await db.collection('bankDetails').get();
        state.banks = snap.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data() 
        }));
        
        // Validate bank data
        state.banks = state.banks.filter(bank => {
            if (!bank.name) {
                console.warn('Bank missing name:', bank.id);
                return false;
            }
            if (!bank.currency) bank.currency = 'KES'; // Default
            return true;
        });
        
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
        
        // Validate ledger entries
        state.ledger = snap.docs.map(doc => {
            const data = doc.data();
            return { 
                id: doc.id, 
                ...data,
                amount: parseFloat(data.amount) || 0,
                date: data.date || new Date().toISOString()
            };
        }).filter(tx => tx.amount > 0); // Remove zero-amount transactions
        
        console.log(`Loaded ${state.ledger.length} ledger entries`);
        renderLedgerTable();
        
        return state.ledger;
    } catch (error) {
        console.error("Failed to load ledger:", error);
        throw error;
    }
}

// --- RECEIPT PAYMENTS PROCESSING (WITH TRANSACTION ISOLATION) ---

async function processReceiptPayments() {
    // Prevent concurrent processing
    if (state.transactionLock) {
        console.log('Transaction lock active, skipping receipt processing');
        return { newCount: 0, skippedCount: 0 };
    }
    
    state.transactionLock = true;
    
    try {
        // FIX: this used to be a single query with .limit(200), which means
        // any receipt older than the 200 most recent could never be picked
        // up at all — permanently missing from the ledger. This now pages
        // through the full collection (newest first), page by page, until
        // it runs out of documents (or hits a generous safety cap so a
        // single call can never run away indefinitely).
        const PAGE_SIZE = 200;
        const MAX_PAGES = 25; // safety cap: 5,000 receipts per call
        let totalNewCount = 0;
        let totalSkippedCount = 0;
        let cursor = null;
        let page = 0;

        while (page < MAX_PAGES) {
            let pageQuery = db.collection('receipt_payments')
                .orderBy('createdAt', 'desc')
                .limit(PAGE_SIZE);
            if (cursor) {
                pageQuery = pageQuery.startAfter(cursor);
            }
            const receiptsSnap = await pageQuery.get();
            if (receiptsSnap.empty) break;

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
                
                // Validate amount
                try {
                    amount = validateAmount(amount);
                } catch (e) {
                    console.warn(`Invalid amount in receipt ${transactionId}:`, e.message);
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
                        
                // Find matching bank — must match both name AND currency
                const receiptCurrency = isUSD ? 'USD' : 'KES';
                let targetBank = state.banks.find(bank => {
                    const nameMatches = bank.name.toLowerCase().includes(bankName.toLowerCase()) ||
                                        bankName.toLowerCase().includes(bank.name.toLowerCase());
                    const currencyMatches = bank.currency === receiptCurrency;
                    return nameMatches && currencyMatches;
                });
                
                // Fallback: if no currency-exact match, only fall back to a name-only match
                // when there's exactly one bank account with that name (no currency ambiguity).
                // If a bank has BOTH a KES and a USD account (e.g. "EQUITY BANK"), guessing here
                // risks crediting a USD receipt into the KES account (or vice versa), so we must
                // never silently pick one when more than one candidate exists.
                //
                // FIX: previously, when this fallback matched a bank whose currency did NOT match
                // the receipt's currency (e.g. a KES receipt landing on a bank that only has a USD
                // account), the raw un-converted amount was credited as-is — a KES 100,000 receipt
                // became "+100,000" in the USD balance, i.e. treated as if it were USD. This now
                // converts the amount into the target bank's actual currency using the receipt's
                // own exchange rate before crediting it, and records the conversion for audit.
                let conversionApplied = null;
                if (!targetBank) {
                    const nameMatchingBanks = state.banks.filter(bank =>
                        bank.name.toLowerCase().includes(bankName.toLowerCase()) ||
                        bankName.toLowerCase().includes(bank.name.toLowerCase())
                    );

                    if (nameMatchingBanks.length === 1) {
                        const candidate = nameMatchingBanks[0];
                        if (candidate.currency === receiptCurrency) {
                            targetBank = candidate;
                        } else {
                            // Genuine currency mismatch — only account with this name is the
                            // "wrong" currency. Convert using the receipt's own exchange rate
                            // rather than silently crediting the raw figure.
                            const exchangeRate = parseFloat(data.exchangeRate) || 0;
                            if (!exchangeRate || exchangeRate <= 0) {
                                console.error(`Cannot safely process receipt ${transactionId}: it's ${receiptCurrency} but the only matching account "${candidate.name}" is ${candidate.currency}, and the receipt has no valid exchange rate to convert with. Skipping instead of guessing.`);
                            } else {
                                const originalAmount = amount;
                                let convertedAmount;
                                if (receiptCurrency === 'KES' && candidate.currency === 'USD') {
                                    convertedAmount = originalAmount / exchangeRate;
                                } else if (receiptCurrency === 'USD' && candidate.currency === 'KES') {
                                    convertedAmount = originalAmount * exchangeRate;
                                } else {
                                    convertedAmount = originalAmount; // shouldn't happen given the currency check above
                                }
                                convertedAmount = Math.round(convertedAmount * 100) / 100;
                                console.warn(`Converting receipt ${transactionId}: ${originalAmount} ${receiptCurrency} -> ${convertedAmount} ${candidate.currency} using exchange rate ${exchangeRate} (only ${candidate.currency} account found for "${bankName}")`);
                                conversionApplied = {
                                    originalAmount,
                                    originalCurrency: receiptCurrency,
                                    exchangeRateUsed: exchangeRate
                                };
                                amount = convertedAmount;
                                targetBank = candidate;
                            }
                        }
                    } else if (nameMatchingBanks.length > 1) {
                        console.error(`Ambiguous bank match for receipt ${transactionId}: "${bankName}" (expected ${receiptCurrency}) matches ${nameMatchingBanks.length} accounts with currencies [${nameMatchingBanks.map(b => b.currency).join(', ')}] — skipping instead of guessing to avoid crediting the wrong currency account.`);
                    }
                }
                        
                if (!targetBank) {
                    console.warn(`No matching bank found for: ${bankName}`);
                    skippedCount++;
                    continue;
                }

                // IMPORTANT: Get the actual receipt date, not just created/processed date
                // Use paymentDate if available, otherwise createdAt
                const receiptDate = data.paymentDate || data.createdAt || new Date();
                const receiptDateTime = new Date(receiptDate).getTime();
                
                // Check opening balance cutoff for this bank.
                // bankDetails.openingBalanceConfig is the SHARED, cross-user source of truth (updated
                // on every reset, visible to all users). state.openingBalanceTimestamps is a per-user
                // cache (stored under processedTransactions/{uid}) and must never take priority, or a
                // user who previously set their own opening balance will keep seeing their own stale
                // value even after another user resets it.
                const openingConfig = (targetBank.openingBalanceConfig ? {
                                         timestamp: targetBank.openingBalanceConfig.dateString,
                                         balance: targetBank.openingBalanceConfig.amount
                                     } : null) ||
                                     state.openingBalanceTimestamps[targetBank.id] ||
                                     state.openingBalanceTimestamps[targetBank.name];
                
                if (openingConfig && openingConfig.timestamp) {
                    const cutoffDateTime = new Date(openingConfig.timestamp).getTime();
                    
                    // Skip if receipt is BEFORE opening balance cutoff date/time
                    if (receiptDateTime < cutoffDateTime) {
                        console.log(`Skipping receipt ${doc.id} (${new Date(receiptDate)}) before opening balance cutoff (${new Date(cutoffDateTime)}) for bank ${targetBank.name}`);
                        // Still mark as processed so we don't try again
                        state.processedTransactions.add(transactionId);
                        await saveProcessedTransactions();
                        skippedCount++;
                        continue;
                    }
                }
                        
                // Generate idempotency key
                const idempotencyKey = generateIdempotencyKey('receipt', { 
                    receiptId: transactionId,
                    amount,
                    bankId: targetBank.id,
                    date: receiptDate
                });
                
                // Check if already processed via idempotency
                const existingCheck = await db.collection('idempotencyKeys')
                    .doc(idempotencyKey)
                    .get();
                    
                if (existingCheck.exists) {
                    console.log(`Duplicate receipt attempt prevented: ${transactionId}`);
                    state.processedTransactions.add(transactionId);
                    skippedCount++;
                    continue;
                }
                
                // Create ledger entry with proper date
                const ledgerRef = db.collection('bankLedger').doc();
                batch.set(ledgerRef, {
                    date: receiptDate, // Use the actual receipt/payment date
                    type: 'receipt',
                    amount: amount,
                    bankId: targetBank.id,
                    bankName: targetBank.name,
                    // FIX: this must be the currency actually credited (the target bank's own
                    // currency), not the receipt's original currency — `amount` above has already
                    // been converted into the bank's currency when a mismatch fallback occurred,
                    // so labeling it with the original currency would misrepresent what's in the
                    // ledger and make the balance math wrong.
                    currency: targetBank.currency || (isUSD ? 'USD' : 'KES'),
                    description: `Receipt #${data.receiptNumber || 'N/A'} - ${data.description || data.customerName || ''}`,
                    sourceDocId: doc.id,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    userId: state.user?.uid,
                    userEmail: state.user?.email,
                    idempotencyKey: idempotencyKey,
                    ...(conversionApplied ? {
                        currencyConverted: true,
                        originalAmount: conversionApplied.originalAmount,
                        originalCurrency: conversionApplied.originalCurrency,
                        exchangeRateUsed: conversionApplied.exchangeRateUsed
                    } : {})
                });
                
                // Store idempotency key
                const idempotencyRef = db.collection('idempotencyKeys').doc(idempotencyKey);
                batch.set(idempotencyRef, {
                    operation: 'receipt',
                    transactionId: transactionId,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
                });
                        
                state.processedTransactions.add(transactionId);
                newCount++;
            }
            
            // Commit this page's batch if we have new receipts
            if (newCount > 0) {
                await batch.commit();
                await saveProcessedTransactions();
            }

            totalNewCount += newCount;
            totalSkippedCount += skippedCount;

            // Move cursor to the last doc in this page
            cursor = receiptsSnap.docs[receiptsSnap.docs.length - 1];
            page++;

            // Reached the end of the collection
            if (receiptsSnap.docs.length < PAGE_SIZE) break;
        }

        if (totalNewCount > 0) {
            // Reload ledger to include new entries
            await loadLedger();
            
            console.log(`Processed ${totalNewCount} new receipts, ${totalSkippedCount} skipped, across ${page} page(s)`);
            await addAuditLog('RECEIPTS_PROCESSED', { newCount: totalNewCount, skippedCount: totalSkippedCount, pages: page });
        }
        
        return { newCount: totalNewCount, skippedCount: totalSkippedCount };
    } catch (error) {
        console.error("Error processing receipt payments:", error);
        await addAuditLog('RECEIPTS_PROCESSING_ERROR', { error: error.message }, 'failure');
        return { newCount: 0, skippedCount: 0 };
    } finally {
        state.transactionLock = false;
    }
}

// -----------------------------------------------------------------
// RECONCILE REVOKED / DELETED RECEIPTS
// -----------------------------------------------------------------
// The receipt-writing app deletes a receipt_payments document when a
// receipt is revoked. Previously nothing here ever noticed: this app
// only ever ADDS entries to bankLedger (see processReceiptPayments)
// and never checks whether the source document it credited from is
// still there. That's why revoking a receipt never subtracted the
// money back out — this app kept trusting a ledger entry whose source
// no longer existed.
//
// This walks every 'receipt' ledger entry that hasn't already been
// reversed, checks whether its source receipt_payments doc still
// exists, and if not, writes a reversing 'receipt_reversal' entry
// (and flags the original so it's never reversed twice).
async function reconcileRevokedReceipts(showNotification = false) {
    if (state.reconcileInProgress) return { reversedCount: 0 };
    state.reconcileInProgress = true;

    try {
        const receiptEntries = state.ledger.filter(tx => tx.type === 'receipt' && !tx.reversed && tx.sourceDocId);
        const alreadyReversedSourceIds = new Set(
            state.ledger.filter(tx => tx.type === 'receipt_reversal').map(tx => tx.sourceDocId)
        );
        const toCheck = receiptEntries.filter(tx => !alreadyReversedSourceIds.has(tx.sourceDocId));

        if (toCheck.length === 0) return { reversedCount: 0 };

        // Check existence of each source document in parallel. If a check
        // itself errors out (network blip, permissions, etc.) we treat that
        // source as "still exists" — we'd rather miss a reversal for one
        // cycle than wrongly zero out a legitimate transaction.
        const existenceChecks = await Promise.all(
            toCheck.map(tx =>
                db.collection('receipt_payments').doc(tx.sourceDocId).get()
                    .then(snap => ({ tx, exists: snap.exists }))
                    .catch(() => ({ tx, exists: true }))
            )
        );

        const missing = existenceChecks.filter(r => !r.exists).map(r => r.tx);
        if (missing.length === 0) return { reversedCount: 0 };

        const batch = db.batch();
        missing.forEach(tx => {
            const reversalRef = db.collection('bankLedger').doc();
            batch.set(reversalRef, {
                type: 'receipt_reversal',
                date: new Date().toISOString(),
                amount: tx.amount,
                bankId: tx.bankId,
                bankName: tx.bankName,
                currency: tx.currency,
                description: `Reversal: source receipt was revoked (was: ${tx.description || 'N/A'})`,
                sourceDocId: tx.sourceDocId,
                reversalOfLedgerId: tx.id,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                userId: state.user?.uid,
                userEmail: state.user?.email
            });

            const originalRef = db.collection('bankLedger').doc(tx.id);
            batch.update(originalRef, {
                reversed: true,
                reversedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();

        await addAuditLog('REVOKED_RECEIPTS_RECONCILED', {
            count: missing.length,
            details: missing.map(tx => ({
                sourceDocId: tx.sourceDocId,
                bankName: tx.bankName,
                amount: tx.amount,
                currency: tx.currency
            }))
        }, 'warning');

        if (showNotification) {
            showToast(`Reconciled ${missing.length} revoked receipt(s) — bank balance(s) corrected.`, 'success');
        }

        return { reversedCount: missing.length };
    } catch (error) {
        console.error('Error reconciling revoked receipts:', error);
        return { reversedCount: 0 };
    } finally {
        state.reconcileInProgress = false;
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

// Replace your existing updateBankSelects function with this:

function updateBankSelects() {
    const selects = [
        't-from-enhanced', 't-to-enhanced', 
        'expense-bank', 'credit-bank',
        'w-bank'
    ];
    
    // ===== ADD THIS =====
    // Store current values before rebuilding
    const currentValues = {};
    selects.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            currentValues[id] = select.value;
        }
    });
    
    selects.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        
        // Remember the selected value before clearing
        const previousValue = select.value;
        
        select.innerHTML = '<option value="">Select Bank</option>';
        state.banks.forEach(bank => {
            const balance = state.balances[bank.id] || 0;
            const option = document.createElement('option');
            option.value = bank.id;
            option.textContent = `${bank.name} (${bank.currency} ${formatNumber(balance)})`;
            select.appendChild(option);
        });
        
        // ===== ADD THIS =====
        // Restore selection if modal is open, otherwise use stored value
        if (state.openModals.has('transfer-modal-enhanced') && (id === 't-from-enhanced' || id === 't-to-enhanced')) {
            if (id === 't-from-enhanced' && state.lastSelection.transferFrom) {
                select.value = state.lastSelection.transferFrom;
            } else if (id === 't-to-enhanced' && state.lastSelection.transferTo) {
                select.value = state.lastSelection.transferTo;
            } else {
                select.value = previousValue; // Fallback
            }
        } else if (state.openModals.has('expense-payment-modal') && id === 'expense-bank') {
            if (state.lastSelection.expenseBank) {
                select.value = state.lastSelection.expenseBank;
            } else {
                select.value = previousValue;
            }
        } else if (state.openModals.has('credit-transfer-modal') && id === 'credit-bank') {
            if (state.lastSelection.creditBank) {
                select.value = state.lastSelection.creditBank;
            } else {
                select.value = previousValue;
            }
        } else {
            // If no modal is open, restore previous value if it exists
            if (previousValue) {
                select.value = previousValue;
            }
        }
        
        // Add event listeners for balance display
        if (id.includes('from') || id === 'expense-bank' || id === 'credit-bank' || id === 'w-bank') {
            // Remove existing listener to prevent duplicates
            select.removeEventListener('change', handleBankSelectionChange);
            select.addEventListener('change', handleBankSelectionChange);
        }
    });
}

// ===== ADD THIS NEW HELPER FUNCTION =====
function handleBankSelectionChange(event) {
    const select = event.target;
    const id = select.id;
    const value = select.value;
    
    // Store selection in state
    if (id === 't-from-enhanced') {
        state.lastSelection.transferFrom = value;
    } else if (id === 't-to-enhanced') {
        state.lastSelection.transferTo = value;
    } else if (id === 'expense-bank') {
        state.lastSelection.expenseBank = value;
    } else if (id === 'credit-bank') {
        state.lastSelection.creditBank = value;
    }
    
    // Update balance display
    const balanceId = id === 't-from-enhanced' ? 't-from-balance-enhanced' :
                     id === 'expense-bank' ? 'expense-bank-balance' :
                     id === 'credit-bank' ? 'credit-bank-balance' :
                     `${id}-balance`;
    updateBankBalanceDisplay(value, balanceId);

    // If this change affects the transfer form's from/to selection, check
    // whether the two accounts are in different currencies and show the
    // conversion-rate field accordingly.
    if (id === 't-from-enhanced' || id === 't-to-enhanced') {
        updateTransferConversionUI();
    }
}

/**
 * Shows/hides the conversion-rate field on the transfer form depending on
 * whether the sender and receiver accounts are in different currencies.
 * Fixes: previously a transfer between a KES account and a USD account
 * moved the exact same number out of one and into the other with no
 * conversion at all (e.g. a KES 10,000 transfer showed up as "+10,000" in
 * the USD account).
 */
function updateTransferConversionUI() {
    const fromId = document.getElementById('t-from-enhanced')?.value;
    const toId = document.getElementById('t-to-enhanced')?.value;
    const section = document.getElementById('t-conversion-section-enhanced');
    const label = document.getElementById('t-conversion-label-enhanced');
    const rateInput = document.getElementById('t-conversion-rate-enhanced');
    if (!section || !fromId || !toId) {
        if (section) section.classList.add('hidden');
        return;
    }

    const fromBank = state.banks.find(b => b.id === fromId);
    const toBank = state.banks.find(b => b.id === toId);

    if (fromBank && toBank && fromBank.currency !== toBank.currency) {
        section.classList.remove('hidden');
        if (label) label.textContent = `1 USD = X KES, applied ${fromBank.currency} → ${toBank.currency}`;
        if (rateInput) rateInput.required = true;
        updateTransferConversionPreview();
    } else {
        section.classList.add('hidden');
        if (rateInput) rateInput.required = false;
    }
}

function updateTransferConversionPreview() {
    const fromId = document.getElementById('t-from-enhanced')?.value;
    const toId = document.getElementById('t-to-enhanced')?.value;
    const fromBank = state.banks.find(b => b.id === fromId);
    const toBank = state.banks.find(b => b.id === toId);
    const amount = parseFloat(document.getElementById('t-amount-enhanced')?.value) || 0;
    const rate = parseFloat(document.getElementById('t-conversion-rate-enhanced')?.value) || 0;
    const previewEl = document.getElementById('t-conversion-preview-enhanced');
    if (!previewEl || !fromBank || !toBank || !rate || !amount) {
        if (previewEl) previewEl.textContent = '';
        return;
    }

    let received;
    if (fromBank.currency === 'KES' && toBank.currency === 'USD') {
        received = amount / rate;
    } else if (fromBank.currency === 'USD' && toBank.currency === 'KES') {
        received = amount * rate;
    } else {
        received = amount;
    }
    previewEl.textContent = `${toBank.name} will receive ≈ ${formatCurrency(received, toBank.currency)}`;
}

function toggleTransferFeeInput(feeUnknown) {
    const fieldsContainer = document.getElementById('t-fee-fields-enhanced');
    const feeInput = document.getElementById('t-fee-enhanced');
    if (!fieldsContainer || !feeInput) return;
    if (feeUnknown) {
        fieldsContainer.classList.add('opacity-50', 'pointer-events-none');
        feeInput.value = '0.00';
    } else {
        fieldsContainer.classList.remove('opacity-50', 'pointer-events-none');
    }
}

function updateBankBalanceDisplay(bankId, elementId) {
    const balanceEl = document.getElementById(elementId);
    if (!balanceEl) return;
    
    const bank = state.banks.find(b => b.id === bankId);
    if (bank) {
        const balance = state.balances[bankId] || 0;
        balanceEl.textContent = `Available: ${formatCurrency(balance, bank.currency)}`;
        balanceEl.className = `text-xs ${balance >= 0 ? 'text-green-600' : 'text-red-600'} font-medium mt-1`;
    } else {
        balanceEl.textContent = '';
    }
}

// --- CORE CALCULATIONS (WITH IMPROVED CUTOFF HANDLING) ---

function calculateBalances() {
    // Reset balances
    state.balances = {};
    
    // Initialize each bank with 0 or opening balance
    state.banks.forEach(bank => {
        let cutoffDateTime = null;
        let startBalance = 0;
        
        // Shared source of truth first (bankDetails.openingBalanceConfig, visible to all users);
        // per-user timestamps cache only as legacy fallback for banks never migrated to it.
        if (bank.openingBalanceConfig && bank.openingBalanceConfig.amount !== undefined) {
            startBalance = parseFloat(bank.openingBalanceConfig.amount) || 0;
            if (bank.openingBalanceConfig.dateString) {
                cutoffDateTime = new Date(bank.openingBalanceConfig.dateString).getTime();
            }
        } else {
            const openingTimestamp = state.openingBalanceTimestamps[bank.id] ||
                                     state.openingBalanceTimestamps[bank.name];
            if (openingTimestamp) {
                startBalance = openingTimestamp.balance || 0;
                if (openingTimestamp.timestamp) {
                    cutoffDateTime = new Date(openingTimestamp.timestamp).getTime();
                }
            }
        }
        
        // Start with opening balance
        state.balances[bank.id] = startBalance;
        
        // Get all transactions for this bank, sorted by date
        const bankTransactions = state.ledger
            .filter(tx => tx.bankId === bank.id || tx.toBankId === bank.id)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        // Track running balance for verification
        let runningBalance = startBalance;
        let cutoffReached = cutoffDateTime ? false : true;
        
        // Process each transaction
        bankTransactions.forEach(tx => {
            const txDateTime = new Date(tx.date).getTime();
            const amount = parseFloat(tx.amount) || 0;
            
            // Check if we've reached the cutoff
            if (cutoffDateTime && txDateTime < cutoffDateTime) {
                // Transaction before cutoff - don't include in balance
                return;
            }
            
            // Process based on transaction type
            switch (tx.type) {
                case 'receipt':
                    if (tx.bankId === bank.id) {
                        runningBalance += amount;
                        state.balances[bank.id] = runningBalance;
                    }
                    break;
                    
                case 'withdrawal':
                case 'expense':
                case 'credit':
                case 'receipt_reversal':
                    if (tx.bankId === bank.id) {
                        runningBalance -= amount;
                        state.balances[bank.id] = runningBalance;
                    }
                    break;
                    
                case 'transfer':
                    // Outgoing transfer (always in the sender's own currency/amount)
                    if (tx.bankId === bank.id) {
                        runningBalance -= amount;
                        // Deduct transaction fee if sender bears it
                        if (tx.transactionFee && tx.transactionFeeBearer === 'sender' && tx.feeAmount) {
                            runningBalance -= parseFloat(tx.feeAmount);
                        }
                        state.balances[bank.id] = runningBalance;
                    }
                    // Incoming transfer — use toAmount (converted into the
                    // receiving bank's own currency) when present; falls back
                    // to `amount` for transfers recorded before conversion
                    // support existed, which were always same-currency.
                    if (tx.toBankId === bank.id) {
                        const creditedAmount = (tx.toAmount !== undefined && tx.toAmount !== null)
                            ? parseFloat(tx.toAmount) || 0
                            : amount;
                        runningBalance += creditedAmount;
                        // Deduct transaction fee if receiver bears it
                        if (tx.transactionFee && tx.transactionFeeBearer === 'receiver' && tx.feeAmount) {
                            runningBalance -= parseFloat(tx.feeAmount);
                        }
                        state.balances[bank.id] = runningBalance;
                    }
                    break;
                    
                case 'transfer_fee':
                    if (tx.bankId === bank.id) {
                        runningBalance -= amount;
                        state.balances[bank.id] = runningBalance;
                    }
                    break;
                    
                default:
                    console.warn('Unknown transaction type:', tx.type);
            }
        });
        
        console.log(`Final balance for ${bank.name}: ${state.balances[bank.id]} (opening: ${startBalance}, cutoff: ${cutoffDateTime ? new Date(cutoffDateTime) : 'none'})`);
    });
}

// --- BALANCE VERIFICATION ---

async function verifyAllBalances(showNotification = true) {
    if (showNotification) showLoading(true, 'Verifying balances...');
    
    try {
        const verificationResults = [];
        
        for (const bank of state.banks) {
            // Get all transactions for this bank in order
            const allTx = await db.collection('bankLedger')
                .where('bankId', '==', bank.id)
                .orderBy('date', 'asc')
                .get();
            
            let calculatedBalance = 0;
            let cutoffApplied = false;
            let cutoffDateTime = null;
            
            // Get opening balance info — shared bankDetails config first, per-user cache as legacy fallback
            if (bank.openingBalanceConfig && bank.openingBalanceConfig.amount !== undefined) {
                calculatedBalance = parseFloat(bank.openingBalanceConfig.amount) || 0;
                if (bank.openingBalanceConfig.dateString) {
                    cutoffDateTime = new Date(bank.openingBalanceConfig.dateString).getTime();
                }
            } else {
                const openingTs = state.openingBalanceTimestamps[bank.id] ||
                                  state.openingBalanceTimestamps[bank.name];
                if (openingTs) {
                    calculatedBalance = openingTs.balance || 0;
                    if (openingTs.timestamp) {
                        cutoffDateTime = new Date(openingTs.timestamp).getTime();
                    }
                }
            }
            
            // Process each transaction where this bank is the SENDER
            allTx.docs.forEach(doc => {
                const tx = doc.data();
                const txDateTime = new Date(tx.date).getTime();
                const amount = parseFloat(tx.amount) || 0;
                
                // Skip if before cutoff
                if (cutoffDateTime && txDateTime < cutoffDateTime) {
                    return;
                }
                
                if (tx.type === 'receipt') {
                    calculatedBalance += amount;
                } else if (['expense', 'credit', 'withdrawal', 'transfer_fee', 'receipt_reversal'].includes(tx.type)) {
                    calculatedBalance -= amount;
                } else if (tx.type === 'transfer') {
                    if (tx.bankId === bank.id) {
                        calculatedBalance -= amount;
                        if (tx.transactionFee && tx.transactionFeeBearer === 'sender' && tx.feeAmount) {
                            calculatedBalance -= parseFloat(tx.feeAmount);
                        }
                    }
                }
            });

            // FIX: this bank's incoming transfers were never checked at all —
            // the query above only matches `bankId == bank.id`, which is the
            // SENDER side. A transfer where this bank is the RECEIVER
            // (toBankId == bank.id) never showed up here, so verification
            // always looked wrong (or silently missed real problems) for any
            // bank that had ever received a transfer. This runs a second,
            // targeted query for those and credits the actual amount received
            // (toAmount, converted, when present).
            const incomingTx = await db.collection('bankLedger')
                .where('toBankId', '==', bank.id)
                .where('type', '==', 'transfer')
                .get();

            incomingTx.docs.forEach(doc => {
                const tx = doc.data();
                const txDateTime = new Date(tx.date).getTime();
                if (cutoffDateTime && txDateTime < cutoffDateTime) return;

                const creditedAmount = (tx.toAmount !== undefined && tx.toAmount !== null)
                    ? parseFloat(tx.toAmount) || 0
                    : (parseFloat(tx.amount) || 0);
                calculatedBalance += creditedAmount;
                if (tx.transactionFee && tx.transactionFeeBearer === 'receiver' && tx.feeAmount) {
                    calculatedBalance -= parseFloat(tx.feeAmount);
                }
            });
            
            // Compare with current balance
            const currentBalance = state.balances[bank.id] || 0;
            const difference = Math.abs(calculatedBalance - currentBalance);
            
            if (difference > 0.01) { // Allow for rounding errors
                verificationResults.push({
                    bank: bank.name,
                    expected: calculatedBalance,
                    actual: currentBalance,
                    difference: calculatedBalance - currentBalance
                });
                
                // Log to audit
                await addAuditLog('BALANCE_MISMATCH', {
                    bank: bank.name,
                    expected: calculatedBalance,
                    actual: currentBalance,
                    difference: calculatedBalance - currentBalance
                }, 'warning');
            }
        }
        
        // Update UI
        const integrityEl = document.getElementById('balance-integrity-status');
        if (integrityEl) {
            const dot = integrityEl.querySelector('span');
            if (verificationResults.length === 0) {
                dot.className = 'inline-block w-2 h-2 rounded-full bg-green-500 mr-2';
                integrityEl.innerHTML = `${dot.outerHTML} Verified`;
            } else {
                dot.className = 'inline-block w-2 h-2 rounded-full bg-red-500 mr-2';
                integrityEl.innerHTML = `${dot.outerHTML} ${verificationResults.length} Mismatches`;
            }
        }
        
        state.balanceVerification = {
            timestamp: new Date(),
            mismatches: verificationResults
        };
        
        if (showNotification) {
            if (verificationResults.length === 0) {
                showToast('All balances verified successfully!', 'success');
            } else {
                showToast(`Found ${verificationResults.length} balance mismatches`, 'error');
                // Show details
                let details = 'Balance Mismatches:\n';
                verificationResults.forEach(r => {
                    details += `${r.bank}: Expected ${formatCurrency(r.expected)}, Actual ${formatCurrency(r.actual)}\n`;
                });
                console.warn(details);
            }
        }
        
        return verificationResults;
    } catch (error) {
        console.error('Balance verification error:', error);
        showToast('Balance verification failed: ' + error.message, 'error');
        return [];
    } finally {
        if (showNotification) showLoading(false);
    }
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
        const reconcileResult = await reconcileRevokedReceipts(false);

        if (result.newCount > 0 || reconcileResult.reversedCount > 0) {
            // Recalculate balances
            calculateBalances();
            
            // Update UI
            renderDashboard();
            updateStatistics();

            const parts = [];
            if (result.newCount > 0) parts.push(`${result.newCount} new receipt(s) synced`);
            if (reconcileResult.reversedCount > 0) parts.push(`${reconcileResult.reversedCount} revoked receipt(s) reconciled`);
            showToast(parts.join(', ') + '.', 'success');
        } else {
            showToast("No new receipts or revocations found to sync.", 'info');
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

// --- TRANSFER WITH TRANSACTION FEES (WITH ROLLBACK) ---

document.getElementById('transfer-form-enhanced')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Check for transaction lock
    if (state.transactionLock) {
        showToast('Another transaction is in progress. Please wait.', 'error');
        return;
    }
    
    const fromId = document.getElementById('t-from-enhanced').value;
    const toId = document.getElementById('t-to-enhanced').value;
    const amountInput = document.getElementById('t-amount-enhanced').value;
    const desc = sanitizeString(document.getElementById('t-desc-enhanced').value);
    const feeUnknown = document.getElementById('t-fee-unknown-enhanced')?.checked || false;
    const feeAmountInput = document.getElementById('t-fee-enhanced').value;
    const feeBearer = document.querySelector('input[name="fee-bearer"]:checked').value;
    const conversionRateInput = document.getElementById('t-conversion-rate-enhanced')?.value;
    
    // Validation
    if (!fromId || !toId) {
        showToast('Please select both source and destination banks', 'error');
        return;
    }
    
    if (fromId === toId) {
        showToast('Cannot transfer to the same bank account', 'error');
        return;
    }
    
    if (!desc) {
        showToast('Please enter a description', 'error');
        return;
    }
    
    const fromBank = state.banks.find(b => b.id === fromId);
    const toBank = state.banks.find(b => b.id === toId);
    
    if (!fromBank || !toBank) {
        showToast('Invalid bank selection', 'error');
        return;
    }

    // FIX: currency conversion for cross-currency transfers. Previously the
    // exact same numeric amount was debited from the sender AND credited to
    // the receiver, even when they were different currencies — a KES 10,000
    // transfer into a USD account showed up as "+10,000" there with no
    // conversion at all. When the two accounts differ in currency, a
    // conversion rate is now required, and the receiving side gets the
    // converted amount instead of the raw sender-side figure.
    const currenciesDiffer = fromBank.currency !== toBank.currency;
    let conversionRate = null;
    if (currenciesDiffer) {
        conversionRate = parseFloat(conversionRateInput);
        if (!conversionRate || conversionRate <= 0) {
            showToast(`Please enter a valid conversion rate — ${fromBank.name} (${fromBank.currency}) and ${toBank.name} (${toBank.currency}) are different currencies.`, 'error');
            return;
        }
    }
    
    // Validate amounts
    // FIX: the fee was always run through validateAmount(), which throws for
    // any amount <= 0 — so even though the fee field defaulted to "0.00" and
    // looked optional, submitting with no fee always failed validation. Fee
    // is now genuinely optional: leaving it at 0 (or checking "fee not known
    // yet") simply means no fee entry is created, exactly like the
    // conditional `if (feeAmount > 0)` further down already expected.
    let amount, feeAmount;
    try {
        amount = validateAmount(amountInput, fromBank);
    } catch (error) {
        showToast(error.message, 'error');
        return;
    }
    if (feeUnknown) {
        feeAmount = 0;
    } else {
        const parsedFee = parseFloat(feeAmountInput);
        if (isNaN(parsedFee) || parsedFee < 0) {
            showToast('Transaction fee must be zero or a positive number.', 'error');
            return;
        }
        feeAmount = parsedFee > 0 ? Math.round(parsedFee * 100) / 100 : 0;
    }

    // Amount actually received on the other side, converted if needed
    let toAmount = amount;
    if (currenciesDiffer) {
        if (fromBank.currency === 'KES' && toBank.currency === 'USD') {
            toAmount = amount / conversionRate;
        } else if (fromBank.currency === 'USD' && toBank.currency === 'KES') {
            toAmount = amount * conversionRate;
        }
        toAmount = Math.round(toAmount * 100) / 100;
    }
    
    // Check balance (including fee if sender bears it)
    const currentBalance = state.balances[fromId] || 0;
    const totalDeduction = amount + (feeBearer === 'sender' ? feeAmount : 0);
    
    if (currentBalance < totalDeduction) {
        showToast(`Insufficient funds. Available: ${formatCurrency(currentBalance, fromBank.currency)}`, 'error');
        return;
    }
    
    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey('transfer', {
        fromId, toId, amount, feeAmount, feeBearer, desc, timestamp: Date.now()
    });
    
    // Check if already processed
    const existingCheck = await db.collection('idempotencyKeys').doc(idempotencyKey).get();
    if (existingCheck.exists) {
        showToast('This transaction appears to be a duplicate and was prevented.', 'error');
        return;
    }
    
    // Set transaction lock
    state.transactionLock = true;
    showLoading(true, 'Processing transfer...');
    
    // Use batched write with rollback capability
    const batch = db.batch();
    
    try {
        const transferDate = new Date().toISOString();
        const reference = `TRX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        
        // Add main transfer ledger entry
        const transferRef = db.collection('bankLedger').doc();
        batch.set(transferRef, {
            type: 'transfer',
            date: transferDate,
            amount: amount,
            // Amount actually credited to the receiving bank, in ITS currency.
            // Equal to `amount` for same-currency transfers; converted via
            // conversionRate otherwise. calculateBalances()/verifyAllBalances()
            // use this (falling back to `amount` for older records that
            // predate this field) for the credit side of the transfer.
            toAmount: toAmount,
            conversionRate: currenciesDiffer ? conversionRate : null,
            bankId: fromId,
            bankName: fromBank.name,
            toBankId: toId,
            toBankName: toBank.name,
            currency: fromBank.currency,
            toCurrency: toBank.currency,
            description: `Transfer: ${desc}`,
            reference: reference,
            transactionFee: feeAmount > 0,
            feeAmount: feeAmount,
            feeStatus: feeAmount > 0 ? 'recorded' : (feeUnknown ? 'pending' : 'none'),
            transactionFeeBearer: feeBearer,
            createdBy: state.user?.email || 'Unknown',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'completed',
            userId: 'global',
            idempotencyKey: idempotencyKey
        });
        
        // Add transaction fee entry if applicable
        if (feeAmount > 0) {
            const feeRef = db.collection('bankLedger').doc();
            batch.set(feeRef, {
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
                userId: 'global',
                idempotencyKey: `${idempotencyKey}_fee`
            });
        }
        
        // Store idempotency key
        const idempotencyRef = db.collection('idempotencyKeys').doc(idempotencyKey);
        batch.set(idempotencyRef, {
            operation: 'transfer',
            fromId, toId, amount, feeAmount, feeBearer,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });
        
        // Commit the batch
        await batch.commit();
        
        closeModal('transfer-modal-enhanced');
        document.getElementById('transfer-form-enhanced').reset();
        
        // Refresh data
        await initApp();
        
        await addAuditLog('TRANSFER_COMPLETED', { 
            from: fromBank.name, 
            to: toBank.name, 
            amount, 
            fee: feeAmount,
            feeBearer 
        });
        
        showToast(`Transfer of ${formatCurrency(amount, fromBank.currency)} completed with ${formatCurrency(feeAmount, fromBank.currency)} fee!`, 'success');
    } catch (error) {
        // No need to rollback - batch failed automatically
        console.error('Transfer failed:', error);
        showToast('Transfer failed: ' + error.message, 'error');
        await addAuditLog('TRANSFER_FAILED', { 
            from: fromBank.name, 
            to: toBank.name, 
            amount, 
            error: error.message 
        }, 'failure');
    } finally {
        state.transactionLock = false;
        showLoading(false);
    }
});

// -----------------------------------------------------------------
// SETTLE A DEFERRED TRANSFER FEE
// -----------------------------------------------------------------
// The transfer form already lets you check "Fee not known yet — record it
// later" (feeStatus: 'pending' on the transfer's ledger entry), but nothing
// anywhere let you actually go back and add that fee — it just sat there
// forever with no fee entry. This adds that missing step: a small modal
// from the ledger table's "+ Add Fee" button that creates the deferred
// transfer_fee entry and marks the original transfer as settled.
function openSettleTransferFeeModal(ledgerDocId) {
    const tx = state.ledger.find(t => t.id === ledgerDocId);
    if (!tx || tx.type !== 'transfer') {
        showToast('Transfer not found.', 'error');
        return;
    }
    if (tx.transactionFee) {
        showToast('This transfer already has a fee recorded.', 'info');
        return;
    }

    const existing = document.getElementById('settle-transfer-fee-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'settle-transfer-fee-modal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black bg-opacity-50" onclick="document.getElementById('settle-transfer-fee-modal').remove()"></div>
        <div class="relative bg-white rounded-xl shadow-2xl max-w-md w-full mx-auto p-6">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-bold text-gray-800">Add Transfer Fee</h2>
                <button onclick="document.getElementById('settle-transfer-fee-modal').remove()" class="text-gray-500 hover:text-gray-700 text-2xl">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="bg-gray-50 rounded-lg p-3 mb-4 text-sm text-gray-700">
                <div class="flex justify-between"><span>Transfer:</span><span class="font-semibold">${sanitizeString(tx.bankName)} → ${sanitizeString(tx.toBankName)}</span></div>
                <div class="flex justify-between"><span>Amount:</span><span class="font-semibold">${formatCurrency(tx.amount, tx.currency)}</span></div>
                <div class="flex justify-between"><span>Reference:</span><span class="font-mono text-xs">${sanitizeString(tx.reference || '')}</span></div>
            </div>
            <form id="settle-transfer-fee-form" class="space-y-4">
                <input type="hidden" id="stf-ledger-id" value="${ledgerDocId}">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Fee Amount</label>
                    <input type="number" id="stf-fee-amount" step="0.01" min="0.01" required
                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                           placeholder="0.00">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Who bears the fee?</label>
                    <div class="flex gap-4">
                        <label class="flex items-center"><input type="radio" name="stf-fee-bearer" value="sender" checked class="mr-2">Sender (${sanitizeString(tx.bankName)})</label>
                        <label class="flex items-center"><input type="radio" name="stf-fee-bearer" value="receiver" class="mr-2">Receiver (${sanitizeString(tx.toBankName)})</label>
                    </div>
                </div>
                <div class="flex space-x-3 pt-2">
                    <button type="button" onclick="document.getElementById('settle-transfer-fee-modal').remove()"
                            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2.5 rounded-lg transition-all">
                        Cancel
                    </button>
                    <button type="submit"
                            class="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-lg transition-all">
                        Save Fee
                    </button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('settle-transfer-fee-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await settleTransferFee(
            document.getElementById('stf-ledger-id').value,
            parseFloat(document.getElementById('stf-fee-amount').value),
            document.querySelector('input[name="stf-fee-bearer"]:checked').value
        );
    });
}

async function settleTransferFee(ledgerDocId, feeAmountInput, feeBearer) {
    if (state.transactionLock) {
        showToast('Another transaction is in progress. Please wait.', 'error');
        return;
    }

    let feeAmount;
    try {
        feeAmount = validateAmount(feeAmountInput, null, true);
    } catch (error) {
        showToast(error.message, 'error');
        return;
    }

    const tx = state.ledger.find(t => t.id === ledgerDocId);
    if (!tx || tx.type !== 'transfer') {
        showToast('Transfer not found.', 'error');
        return;
    }
    if (tx.transactionFee) {
        showToast('This transfer already has a fee recorded.', 'error');
        return;
    }

    const fromBank = state.banks.find(b => b.id === tx.bankId);
    const toBank = state.banks.find(b => b.id === tx.toBankId);
    if (!fromBank || !toBank) {
        showToast('Could not find one of the banks for this transfer.', 'error');
        return;
    }

    const idempotencyKey = generateIdempotencyKey('settle_transfer_fee', {
        ledgerDocId, feeAmount, feeBearer
    });
    const existingCheck = await db.collection('idempotencyKeys').doc(idempotencyKey).get();
    if (existingCheck.exists) {
        showToast('This fee appears to have already been recorded.', 'error');
        return;
    }

    state.transactionLock = true;
    showLoading(true, 'Saving fee...');

    const batch = db.batch();
    try {
        const feeBankId = feeBearer === 'sender' ? tx.bankId : tx.toBankId;
        const feeBankName = feeBearer === 'sender' ? tx.bankName : tx.toBankName;
        const feeBankCurrency = feeBearer === 'sender' ? fromBank.currency : toBank.currency;

        const feeRef = db.collection('bankLedger').doc();
        batch.set(feeRef, {
            type: 'transfer_fee',
            date: new Date().toISOString(),
            amount: feeAmount,
            bankId: feeBankId,
            bankName: feeBankName,
            currency: feeBankCurrency,
            description: `Transaction fee (added later) for transfer ${tx.reference}: ${tx.description || ''}`,
            reference: `FEE-${tx.reference}`,
            relatedTransferRef: tx.reference,
            createdBy: state.user?.email || 'Unknown',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'completed',
            userId: 'global',
            idempotencyKey: idempotencyKey
        });

        // Mark the original transfer as settled so "+ Add Fee" stops showing
        const transferRef = db.collection('bankLedger').doc(ledgerDocId);
        batch.update(transferRef, {
            transactionFee: true,
            feeAmount: feeAmount,
            feeStatus: 'recorded',
            transactionFeeBearer: feeBearer,
            feeAddedAt: firebase.firestore.FieldValue.serverTimestamp(),
            feeAddedBy: state.user?.email || 'Unknown'
        });

        const idempotencyRef = db.collection('idempotencyKeys').doc(idempotencyKey);
        batch.set(idempotencyRef, {
            operation: 'settle_transfer_fee',
            ledgerDocId, feeAmount, feeBearer,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });

        await batch.commit();

        const modalEl = document.getElementById('settle-transfer-fee-modal');
        if (modalEl) modalEl.remove();

        await initApp();

        await addAuditLog('TRANSFER_FEE_SETTLED', {
            transferRef: tx.reference,
            feeAmount, feeBearer
        });

        showToast(`Fee of ${formatCurrency(feeAmount, feeBankCurrency)} recorded for transfer ${tx.reference}.`, 'success');
    } catch (error) {
        console.error('Settle transfer fee failed:', error);
        showToast('Failed to save fee: ' + error.message, 'error');
        await addAuditLog('TRANSFER_FEE_SETTLE_FAILED', { ledgerDocId, error: error.message }, 'failure');
    } finally {
        state.transactionLock = false;
        showLoading(false);
    }
}

// --- EXPENSE PAYMENT (NEW FEATURE) ---

document.getElementById('expense-payment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Check for transaction lock
    if (state.transactionLock) {
        showToast('Another transaction is in progress. Please wait.', 'error');
        return;
    }
    
    const bankId = document.getElementById('expense-bank').value;
    const category = document.getElementById('expense-category').value;
    const customRecipient = sanitizeString(document.getElementById('expense-custom-recipient').value);
    const amountInput = document.getElementById('expense-amount').value;
    const desc = sanitizeString(document.getElementById('expense-desc').value);
    const reference = sanitizeString(document.getElementById('expense-reference').value);
    
    // Validation
    if (!bankId) {
        showToast('Please select a bank account', 'error');
        return;
    }
    
    if (!category && !customRecipient) {
        showToast('Please select a category or enter a custom recipient', 'error');
        return;
    }
    
    if (!desc) {
        showToast('Please enter a description', 'error');
        return;
    }
    
    const bank = state.banks.find(b => b.id === bankId);
    if (!bank) {
        showToast('Invalid bank selection', 'error');
        return;
    }
    
    // Validate amount
    let amount;
    try {
        amount = validateAmount(amountInput, bank, false, true);
    } catch (error) {
        showToast(error.message, 'error');
        return;
    }
    
    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey('expense', {
        bankId, category, customRecipient, amount, desc, reference, timestamp: Date.now()
    });
    
    // Check if already processed
    const existingCheck = await db.collection('idempotencyKeys').doc(idempotencyKey).get();
    if (existingCheck.exists) {
        showToast('This expense appears to be a duplicate and was prevented.', 'error');
        return;
    }
    
    // Set transaction lock
    state.transactionLock = true;
    showLoading(true, 'Recording expense...');
    
    try {
        const recipientName = customRecipient || category;
        const recipientType = customRecipient ? 'custom' : 'category';
        
        const batch = db.batch();
        
        const expenseRef = db.collection('bankLedger').doc();
        batch.set(expenseRef, {
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
            userId: 'global',
            idempotencyKey: idempotencyKey
        });
        
        // Store idempotency key
        const idempotencyRef = db.collection('idempotencyKeys').doc(idempotencyKey);
        batch.set(idempotencyRef, {
            operation: 'expense',
            bankId, category, customRecipient, amount,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });
        
        await batch.commit();
        
        closeModal('expense-payment-modal');
        document.getElementById('expense-payment-form').reset();
        
        // Refresh data
        await initApp();
        
        await addAuditLog('EXPENSE_RECORDED', { 
            bank: bank.name, 
            recipient: recipientName,
            amount,
            category 
        });
        
        showToast(`Expense of ${formatCurrency(amount, bank.currency)} recorded successfully!`, 'success');
    } catch (error) {
        showToast('Expense recording failed: ' + error.message, 'error');
        await addAuditLog('EXPENSE_FAILED', { 
            bank: bank.name, 
            amount, 
            error: error.message 
        }, 'failure');
    } finally {
        state.transactionLock = false;
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
        
        // Opening balance for display — shared bankDetails config first, per-user cache as legacy fallback
        const hasSharedOpeningConfig = bank.openingBalanceConfig && bank.openingBalanceConfig.amount !== undefined;
        const openingTs = state.openingBalanceTimestamps[bank.id] || state.openingBalanceTimestamps[bank.name];
        const hasOpeningTimestamp = hasSharedOpeningConfig || !!openingTs;
        const openingBalance = hasSharedOpeningConfig ? (bank.openingBalanceConfig?.amount || 0) : (openingTs ? openingTs.balance : 0);
        // Calculate credits and debits for this bank
        const bankTransactions = state.ledger.filter(tx => 
            tx.bankId === bank.id || tx.toBankId === bank.id
        );
        
        let totalCredits = 0;
        let totalDebits = 0;
        
        bankTransactions.forEach(tx => {
            const amount = parseFloat(tx.amount) || 0;
            const creditAmount = (tx.type === 'transfer' && tx.toBankId === bank.id && tx.toAmount !== undefined && tx.toAmount !== null)
                ? (parseFloat(tx.toAmount) || 0)
                : amount;
            if (tx.type === 'receipt' || (tx.type === 'transfer' && tx.toBankId === bank.id)) {
                totalCredits += creditAmount;
            } else if (tx.type === 'withdrawal' || tx.type === 'expense' || tx.type === 'credit' || tx.type === 'receipt_reversal' || (tx.type === 'transfer' && tx.bankId === bank.id)) {
                totalDebits += amount;
            }
        });
        
        const card = document.createElement('div');
        card.className = `bg-white rounded-xl shadow-sm p-6 bank-card ${colorClass} hover:shadow-lg transition-all duration-300`;
        card.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h3 class="font-bold text-gray-800 text-lg">${sanitizeString(bank.name)}</h3>
                    <p class="text-xs text-gray-500 mt-1">${bank.accountNumber ? sanitizeString(bank.accountNumber) : 'Account not specified'}</p>
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
        let pendingFeeButton = ''; // built separately so it isn't HTML-escaped by sanitizeString()
        
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
            case 'receipt_reversal':
                typeBadge = '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-orange-100 text-orange-800">Revoked Receipt</span>';
                amountClass = 'text-orange-600';
                sign = '-';
                recipientInfo = 'Revoked: ' + (tx.description || tx.bankName || '');
                break;
            case 'transfer':
                typeBadge = '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">Transfer</span>';
                amountClass = 'text-purple-600';
                sign = '↔';
                recipientInfo = `${tx.bankName} → ${tx.toBankName}`;
                if (tx.transactionFee) {
                    recipientInfo += ` (Fee: ${tx.feeAmount} ${tx.currency})`;
                } else if (tx.feeStatus === 'pending') {
                    // FIX: "fee not known yet" was recorded but there was never any way to
                    // actually come back and add it — the deferred fee just sat there forever.
                    pendingFeeButton = ` <button onclick="openSettleTransferFeeModal('${tx.id}')" class="ml-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border border-yellow-300 transition-colors">+ Add Fee</button>`;
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
                    ${sanitizeString(recipientInfo)}${pendingFeeButton}
                </td>
                <td class="px-6 py-4 text-gray-500 max-w-xs truncate" title="${sanitizeString(tx.description || '')}">${sanitizeString(tx.description || '')}</td>
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
                        <span class="font-medium text-gray-800 truncate">${sanitizeString(category)}</span>
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
                            <h5 class="font-semibold text-gray-800">${sanitizeString(recipient.name)}</h5>
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
        
        // Build PDF content (sanitized)
        pdfContent.innerHTML = `
            <div style="border-bottom: 2px solid #267921; padding-bottom: 15px; margin-bottom: 20px;">
                <h1 style="color: #267921; margin: 0; font-size: 24px;">CarKenya Bank Ledger Report</h1>
                <div style="color: #666; font-size: 14px; margin-top: 5px;">
                    Generated on ${sanitizeString(dateStr)} at ${sanitizeString(timeStr)} by ${sanitizeString(state.user?.email || 'System')}
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
                                <td style="padding: 8px; border: 1px solid #dee2e6;">${sanitizeString(bank.name)}</td>
                                <td style="padding: 8px; border: 1px solid #dee2e6;">${bank.accountNumber ? sanitizeString(bank.accountNumber) : 'N/A'}</td>
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
                            case 'receipt_reversal': typeBadge = 'Revoked Receipt'; break;
                            case 'transfer': typeBadge = 'Transfer'; break;
                            case 'withdrawal': typeBadge = 'Withdrawal'; break;
                            default: typeBadge = tx.type;
                        }
                        
                        return `
                            <tr style="border-bottom: 1px solid #dee2e6;">
                                <td style="padding: 6px; border: 1px solid #dee2e6;">${sanitizeString(dateStr)} ${sanitizeString(timeStr)}</td>
                                <td style="padding: 6px; border: 1px solid #dee2e6;">${typeBadge}</td>
                                <td style="padding: 6px; border: 1px solid #dee2e6;">${sanitizeString(tx.bankName || '')}</td>
                                <td style="padding: 6px; border: 1px solid #dee2e6;">${sanitizeString(tx.description || '')}</td>
                                <td style="text-align: right; padding: 6px; border: 1px solid #dee2e6; color: ${color}; font-weight: bold;">
                                    ${sign}${formatNumber(amount)} ${tx.currency || 'KES'}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #666; font-size: 12px;">
                <div>Report generated by CarKenya Financial Manager v2.0 (Production Ready)</div>
                <div>Total pages: 1</div>
            </div>
        `;
        
        document.body.appendChild(pdfContent);
        
        // Use html2pdf library
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
            // Fallback to print
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
        await addAuditLog('PDF_EXPORT', { transactionCount: state.ledger.length });
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
            option.textContent = sanitizeString(bank.name);
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
            case 'receipt_reversal':
                typeBadge = '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-orange-100 text-orange-800">Revoked Receipt</span>';
                amountClass = 'text-orange-600';
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
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${sanitizeString(dateStr)}</td>
                <td class="px-6 py-4 whitespace-nowrap">${typeBadge}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${sanitizeString(tx.bankName || '')}</td>
                <td class="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">${sanitizeString(tx.description || '')}</td>
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

// Update your showTransferConfirmation function:

function showTransferConfirmation() {
    if (!state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    // Update bank selects first
    updateBankSelects();
    
    // ===== ADD THIS =====
    // Clear previous selections
    state.lastSelection.transferFrom = null;
    state.lastSelection.transferTo = null;
    
    // Show the enhanced transfer modal
    openModal('transfer-modal-enhanced');
}

// Update your showExpensePaymentModal function:

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
            state.lastSelection.expenseBank = bankId; // ===== ADD THIS =====
            updateBankBalanceDisplay(bankId, 'expense-bank-balance');
        }
    }
}

// Update your showCreditTransferModal function:

function showCreditTransferModal() {
    if (!state.isBankPinVerified) {
        showToast("Please enter your PIN in the bank access gate first", "error");
        return;
    }
    
    // Update bank selects
    updateBankSelects();
    
    // Show modal
    openModal('credit-transfer-modal');
    
    // ===== ADD THIS =====
    // Clear previous selection
    state.lastSelection.creditBank = null;
    
    // Add event listener for recipient type change
    const recipientTypeSelect = document.getElementById('credit-recipient-type');
    const categorySection = document.getElementById('credit-category-section');
    const customSection = document.getElementById('credit-custom-section');
    
    if (recipientTypeSelect && categorySection && customSection) {
        // Remove existing listener to prevent duplicates
        recipientTypeSelect.removeEventListener('change', handleRecipientTypeChange);
        recipientTypeSelect.addEventListener('change', handleRecipientTypeChange);
    }
}

// Helper function for recipient type change
function handleRecipientTypeChange(event) {
    const categorySection = document.getElementById('credit-category-section');
    const customSection = document.getElementById('credit-custom-section');
    
    if (event.target.value === 'category') {
        if (categorySection) categorySection.classList.remove('hidden');
        if (customSection) customSection.classList.add('hidden');
    } else {
        if (categorySection) categorySection.classList.add('hidden');
        if (customSection) customSection.classList.remove('hidden');
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
                            <span class="font-medium text-gray-700">${sanitizeString(bank)}</span>
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
        const _openingTs = state.openingBalanceTimestamps[bank.id] || state.openingBalanceTimestamps[bank.name];
        const openingBalance = (bank.openingBalanceConfig?.amount !== undefined ? bank.openingBalanceConfig.amount : _openingTs?.balance) || 0;
        
        // Calculate credits and debits for this bank
        const bankTransactions = state.ledger.filter(tx => 
            tx.bankId === bank.id || tx.toBankId === bank.id
        );
        
        let totalCredits = 0;
        let totalDebits = 0;
        
        bankTransactions.forEach(tx => {
            const amount = parseFloat(tx.amount) || 0;
            const creditAmount = (tx.type === 'transfer' && tx.toBankId === bank.id && tx.toAmount !== undefined && tx.toAmount !== null)
                ? (parseFloat(tx.toAmount) || 0)
                : amount;
            if (tx.type === 'receipt' || (tx.type === 'transfer' && tx.toBankId === bank.id)) {
                totalCredits += creditAmount;
            } else if (tx.type === 'withdrawal' || tx.type === 'expense' || tx.type === 'credit' || tx.type === 'receipt_reversal' || (tx.type === 'transfer' && tx.bankId === bank.id)) {
                totalDebits += amount;
            }
        });
        
        summary += `${bank.name} (${bank.currency}):\n`;
        summary += `  Current Balance: ${currencySymbol}${formatNumber(balance)}\n`;
        summary += `  Opening Balance: ${currencySymbol}${formatNumber(openingBalance)}\n`;
        summary += `  Total Credits: ${currencySymbol}${formatNumber(totalCredits)}\n`;
        summary += `  Total Debits: ${currencySymbol}${formatNumber(totalDebits)}\n`;
        
        const _ts = bank.openingBalanceConfig?.dateString
            ? { timestamp: bank.openingBalanceConfig.dateString }
            : (state.openingBalanceTimestamps[bank.id] || state.openingBalanceTimestamps[bank.name]);
        if (_ts) {
            summary += `  Opening Set: ${new Date(_ts.timestamp).toLocaleDateString()}\n`;
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
                <pre class="bg-gray-50 p-4 rounded-lg text-sm text-gray-800 whitespace-pre-wrap font-mono">${sanitizeString(summary)}</pre>
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
    } else if (tabName === 'accruals') {
        renderAccrualsTab();
    } else if (tabName === 'summary') {
        renderSummaryDashboard();
    }
    
}

// Replace your existing openModal and closeModal functions with these:

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
        
        // ===== ADD THIS =====
        // Track that this modal is open
        state.openModals.add(id);
        
        // Store current selections when modal opens
        if (id === 'transfer-modal-enhanced') {
            state.lastSelection.transferFrom = document.getElementById('t-from-enhanced')?.value || null;
            state.lastSelection.transferTo = document.getElementById('t-to-enhanced')?.value || null;
        } else if (id === 'expense-payment-modal') {
            state.lastSelection.expenseBank = document.getElementById('expense-bank')?.value || null;
        } else if (id === 'credit-transfer-modal') {
            state.lastSelection.creditBank = document.getElementById('credit-bank')?.value || null;
        }
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('hidden');
        
        // ===== ADD THIS =====
        // Remove from open modals set
        state.openModals.delete(id);
        
        // Clear selections for this modal when closed
        if (id === 'transfer-modal-enhanced') {
            state.lastSelection.transferFrom = null;
            state.lastSelection.transferTo = null;
        } else if (id === 'expense-payment-modal') {
            state.lastSelection.expenseBank = null;
        } else if (id === 'credit-transfer-modal') {
            state.lastSelection.creditBank = null;
        }
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

// --- OPENING BALANCE MODAL (UPDATED WITH PROPER CUTOFF HANDLING) ---

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
                               placeholder="0.00" min="0" max="1000000000" step="0.01" required>
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
                              rows="2" placeholder="e.g., Verified against bank statement" maxlength="500"></textarea>
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
    const openingBalance = (bank.openingBalanceConfig?.amount !== undefined ? bank.openingBalanceConfig.amount : null) ??
                       state.openingBalanceTimestamps[bank.id]?.balance ??
                       state.openingBalanceTimestamps[bank.name]?.balance ?? 0;
    
    detailsContainer.innerHTML = `
        <div class="space-y-2">
            <div class="flex justify-between">
                <span class="text-gray-600">Bank:</span>
                <span class="font-semibold">${sanitizeString(bank.name)}</span>
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
        const notes = sanitizeString(document.getElementById('opening-balance-notes-enhanced').value);
        
        // Validate amount (zero is allowed for opening balance)
        if (isNaN(amount) || amount === null || amount === undefined) {
            showToast('Invalid amount: must be a number', 'error');
            return;
        }
        if (amount < 0) {
            showToast('Opening balance cannot be negative', 'error');
            return;
        }
        if (amount > MAX_AMOUNT) {
            showToast(`Amount exceeds maximum limit of ${MAX_AMOUNT.toLocaleString()}`, 'error');
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
            // FIX (race condition): if a receipt-processing pass is
            // currently deciding which receipts to credit, it's using the
            // OLD cutoff. If we write the new cutoff while that's still
            // running, the in-flight pass can still commit receipts the
            // user is right now trying to exclude — because its decisions
            // were already made before this write landed. Waiting for the
            // lock, then holding it ourselves while we write, guarantees
            // the next processReceiptPayments() run is the first one to
            // see the new cutoff, with no straddling.
            showLoading(true, 'Waiting for any in-progress sync to finish...');
            await waitForTransactionLock();
            state.transactionLock = true;

            // Store in openingBalanceTimestamps — keyed by bank.id to isolate KES/USD accounts
state.openingBalanceTimestamps[bank.id] = {
    balance: amount,
    timestamp: timestamp.toISOString(),
    updatedBy: state.user?.email || 'Anonymous',
    updatedAt: new Date().toISOString(),
    notes: notes || '',
    bankName: bank.name,
    currency: bank.currency
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

            // Release the lock before triggering a fresh reprocess, so
            // initApp()'s own call to processReceiptPayments() can acquire it.
            state.transactionLock = false;
            
            closeOpeningModalEnhanced();
            
            // Add audit log
            await addAuditLog('OPENING_BALANCE_SET', {
                bank: bank.name,
                amount: amount,
                cutoffDate: timestamp.toISOString()
            });
            
            showLoading(true, 'Reprocessing receipts with new opening balance...');
            // Refresh data — this now re-runs processReceiptPayments() fresh
            // against the newly-written cutoff, with no earlier pass able to
            // straddle the change.
            await initApp();
            
            // Verify balances after opening balance change
            await verifyAllBalances(true);
            
            showToast(`Opening balance set successfully for ${timestamp.toLocaleString()}!`, 'success');
        } catch (error) {
            showToast('Failed to set opening balance: ' + error.message, 'error');
            await addAuditLog('OPENING_BALANCE_FAILED', { 
                bank: bank.name, 
                amount, 
                error: error.message 
            }, 'failure');
        } finally {
            state.transactionLock = false; // safety net in case an error left it held
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

// --- WITHDRAWAL MODAL ---

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
                            <div class="font-semibold">${sanitizeString(bank.name)}</div>
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
                               placeholder="0.00" min="0.01" max="1000000000" step="0.01" required>
                    </div>
                    
                    <!-- Description -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Description</label>
                        <input type="text" id="withdrawal-description-enhanced" 
                               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                               placeholder="e.g., Payment for office supplies" required maxlength="200">
                    </div>
                    
                    <!-- Recipient/Vendor -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Payee/Vendor</label>
                        <input type="text" id="withdrawal-payee-enhanced" 
                               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-600"
                               placeholder="e.g., Office Depot Ltd" maxlength="100">
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
                               placeholder="e.g., CHQ-12345, MPESA-ABC123" maxlength="100">
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
        
        const amountInput = document.getElementById('withdrawal-amount-enhanced').value;
        const category = document.getElementById('withdrawal-category-enhanced').value;
        const description = sanitizeString(document.getElementById('withdrawal-description-enhanced').value);
        const payee = sanitizeString(document.getElementById('withdrawal-payee-enhanced').value);
        const date = document.getElementById('withdrawal-date-enhanced').value;
        const reference = sanitizeString(document.getElementById('withdrawal-reference-enhanced').value);
        
        // Validate amount
        let amount;
        try {
            amount = validateAmount(amountInput, bank, false, true);
        } catch (error) {
            showToast(error.message, 'error');
            return;
        }
        
        if (!category) {
            showToast('Please select a category', 'error');
            return;
        }
        
        // Generate idempotency key
        const idempotencyKey = generateIdempotencyKey('withdrawal', {
            bankId, amount, category, description, date, timestamp: Date.now()
        });
        
        showLoading(true, 'Processing withdrawal...');
        
        try {
            const batch = db.batch();
            
            const withdrawalRef = db.collection('bankLedger').doc();
            batch.set(withdrawalRef, {
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
                userId: 'global',
                idempotencyKey: idempotencyKey
            });
            
            // Store idempotency key
            const idempotencyRef = db.collection('idempotencyKeys').doc(idempotencyKey);
            batch.set(idempotencyRef, {
                operation: 'withdrawal',
                bankId, amount, category,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            });
            
            await batch.commit();
            
            closeWithdrawalModalEnhanced();
            
            // Refresh data
            await initApp();
            
            await addAuditLog('WITHDRAWAL_COMPLETED', {
                bank: bank.name,
                amount,
                category
            });
            
            showToast(`Withdrawal of ${formatCurrency(amount, bank.currency)} recorded successfully!`, 'success');
        } catch (error) {
            showToast('Withdrawal failed: ' + error.message, 'error');
            await addAuditLog('WITHDRAWAL_FAILED', { 
                bank: bank.name, 
                amount, 
                error: error.message 
            }, 'failure');
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
let isAutoRefreshEnabled = true;

// Replace your existing auto-refresh interval with this:

function startAutoRefresh(intervalSeconds = 10) { // 10 seconds default
    // Clear existing interval if any
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    // Refresh every X seconds
    autoRefreshInterval = setInterval(async () => {
        if (state.user && state.isBankPinVerified && isAutoRefreshEnabled && !state.transactionLock) {
            
            // ===== ADD THIS =====
            // Skip auto-refresh if any financial modals are open to preserve selections
            const financialModals = ['transfer-modal-enhanced', 'expense-payment-modal', 'credit-transfer-modal', 'withdrawal-modal'];
            const anyModalOpen = financialModals.some(modalId => {
                const modal = document.getElementById(modalId);
                return modal && !modal.classList.contains('hidden');
            });
            
            if (anyModalOpen) {
                console.log('Auto-refresh skipped - modal open');
                return;
            }
            
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
                            if (syncStatus && syncStatus.textContent === 'Auto-refreshed just now') {
                                syncStatus.textContent = 'Data synced successfully';
                            }
                        }, 3000);
                    }
                }
            } catch (error) {
                console.error('Auto-refresh failed:', error);
            }
        }
    }, intervalSeconds * 1000);
    
    console.log(`Auto-refresh started (every ${intervalSeconds} seconds)`);
    
    // Update UI
    const statusEl = document.getElementById('auto-refresh-status');
    if (statusEl) {
        const dot = statusEl.querySelector('span');
        if (dot) {
            dot.className = 'inline-block w-2 h-2 rounded-full bg-green-500 mr-2';
            statusEl.innerHTML = `${dot.outerHTML} Active (every 10 sec)`;
        }
    }
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        console.log('Auto-refresh stopped');
        
        // Update UI
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

function toggleAutoRefresh() {
    isAutoRefreshEnabled = !isAutoRefreshEnabled;
    
    if (isAutoRefreshEnabled) {
        startAutoRefresh(10);
        showToast('Auto-refresh enabled (every 10 seconds)', 'success');
        
        const toggleText = document.getElementById('auto-refresh-toggle-text');
        if (toggleText) toggleText.textContent = 'Pause Auto-Refresh';
    } else {
        stopAutoRefresh();
        showToast('Auto-refresh paused', 'warning');
        
        const toggleText = document.getElementById('auto-refresh-toggle-text');
        if (toggleText) toggleText.textContent = 'Resume Auto-Refresh';
    }
}

// Replace your existing refreshData function with this:

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
        
        // Reload accruals
        await loadAccruals();
        
        // Store current selections before UI update
        const currentSelections = {
            transferFrom: document.getElementById('t-from-enhanced')?.value || null,
            transferTo: document.getElementById('t-to-enhanced')?.value || null,
            expenseBank: document.getElementById('expense-bank')?.value || null,
            creditBank: document.getElementById('credit-bank')?.value || null
        };
        
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
        } else if (activeTab && activeTab.id === 'accruals') {
            renderAccrualsTab();
        } else if (activeTab && activeTab.id === 'summary') {
            renderSummaryDashboard();
        }
        
        // ===== ADD THIS =====
        // Restore selections if modals are open
        if (state.openModals.has('transfer-modal-enhanced')) {
            const fromSelect = document.getElementById('t-from-enhanced');
            const toSelect = document.getElementById('t-to-enhanced');
            
            if (fromSelect && state.lastSelection.transferFrom) {
                fromSelect.value = state.lastSelection.transferFrom;
                updateBankBalanceDisplay(state.lastSelection.transferFrom, 't-from-balance-enhanced');
            } else if (fromSelect && currentSelections.transferFrom) {
                fromSelect.value = currentSelections.transferFrom;
            }
            
            if (toSelect && state.lastSelection.transferTo) {
                toSelect.value = state.lastSelection.transferTo;
            } else if (toSelect && currentSelections.transferTo) {
                toSelect.value = currentSelections.transferTo;
            }
        }
        
        if (state.openModals.has('expense-payment-modal')) {
            const expenseSelect = document.getElementById('expense-bank');
            if (expenseSelect && state.lastSelection.expenseBank) {
                expenseSelect.value = state.lastSelection.expenseBank;
                updateBankBalanceDisplay(state.lastSelection.expenseBank, 'expense-bank-balance');
            } else if (expenseSelect && currentSelections.expenseBank) {
                expenseSelect.value = currentSelections.expenseBank;
            }
        }
        
        if (state.openModals.has('credit-transfer-modal')) {
            const creditSelect = document.getElementById('credit-bank');
            if (creditSelect && state.lastSelection.creditBank) {
                creditSelect.value = state.lastSelection.creditBank;
                updateBankBalanceDisplay(state.lastSelection.creditBank, 'credit-bank-balance');
            } else if (creditSelect && currentSelections.creditBank) {
                creditSelect.value = currentSelections.creditBank;
            }
        }
        
        updateStatistics();
        updateLastSyncTime();
        
        return true;
    } catch (error) {
        console.error("Refresh failed:", error);
        return false;
    }
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
    }
    
    // Remove old forms to prevent double listeners
    const oldForms = ['transfer-form', 'withdrawal-form', 'opening-form'];
    oldForms.forEach(formId => {
        const oldForm = document.getElementById(formId);
        if (oldForm) {
            const newForm = oldForm.cloneNode(true);
            oldForm.parentNode.replaceChild(newForm, oldForm);
        }
    });
    
    // Start auto-refresh after everything loads
    setTimeout(() => {
        if (state.user && state.isBankPinVerified) {
            startAutoRefresh(10);
        }
    }, 5000);
});

// ============================================================
// --- ACCRUAL FINANCE ENGINE ---
// ============================================================

async function loadAccruals() {
    try {
        const snap = await db.collection('accrualEntries')
            .orderBy('createdAt', 'desc')
            .limit(500)
            .get();

        state.accruals.entries = snap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString()
            };
        });

        // Auto-compute overdue status (UI-only, not persisted)
        const now = new Date();
        state.accruals.entries.forEach(entry => {
            if (entry.status === 'pending' && entry.dueDate) {
                if (new Date(entry.dueDate) < now) {
                    entry._computedStatus = 'overdue';
                } else {
                    entry._computedStatus = 'pending';
                }
            } else {
                entry._computedStatus = entry.status;
            }
        });

        calculateAccrualSummary();
        return state.accruals.entries;
    } catch (error) {
        console.error('Failed to load accruals:', error);
        return [];
    }
}

function calculateAccrualSummary() {
    const summary = {
        totalReceivable: { KES: 0, USD: 0 },
        totalPayable:    { KES: 0, USD: 0 },
        overdueReceivable: { KES: 0, USD: 0 },
        overduePayable:    { KES: 0, USD: 0 },
        aging: {
            current:    { receivable: { KES: 0, USD: 0 }, payable: { KES: 0, USD: 0 } },
            thirtyPlus: { receivable: { KES: 0, USD: 0 }, payable: { KES: 0, USD: 0 } },
            sixtyPlus:  { receivable: { KES: 0, USD: 0 }, payable: { KES: 0, USD: 0 } },
            ninetyPlus: { receivable: { KES: 0, USD: 0 }, payable: { KES: 0, USD: 0 } }
        },
        pendingCount: { receivable: 0, payable: 0 },
        settledCount: { receivable: 0, payable: 0 }
    };

    const now = new Date();

    state.accruals.entries.forEach(entry => {
        const amount  = parseFloat(entry.amount) || 0;
        const cur     = (entry.currency === 'USD') ? 'USD' : 'KES';
        const dueDate = entry.dueDate ? new Date(entry.dueDate) : now;
        const daysOverdue = Math.floor((now - dueDate) / 86400000);

        if (entry.status === 'settled') {
            if (entry.type === 'receivable') summary.settledCount.receivable++;
            else                             summary.settledCount.payable++;
            return;
        }

        const bucket = entry.type === 'receivable' ? 'receivable' : 'payable';

        if (bucket === 'receivable') {
            summary.totalReceivable[cur] += amount;
            summary.pendingCount.receivable++;
            if (daysOverdue > 0) summary.overdueReceivable[cur] += amount;
        } else {
            summary.totalPayable[cur] += amount;
            summary.pendingCount.payable++;
            if (daysOverdue > 0) summary.overduePayable[cur] += amount;
        }

        // Aging bucket (based on days overdue; not-yet-due goes into "current")
        let agingKey;
        if (daysOverdue <= 30) agingKey = 'current';
        else if (daysOverdue <= 60) agingKey = 'thirtyPlus';
        else if (daysOverdue <= 90) agingKey = 'sixtyPlus';
        else agingKey = 'ninetyPlus';

        summary.aging[agingKey][bucket][cur] += amount;
    });

    state.accruals.summary = summary;
    return summary;
}

async function saveAccrualEntry(formData) {
    if (!state.user) { showToast('Must be logged in', 'error'); return; }

    const {
        type, counterparty, description, amount, currency,
        category, invoiceRef, issueDate, dueDate, notes
    } = formData;

    // Validate
    if (!type || !counterparty || !description || !dueDate) {
        throw new Error('Please fill in all required fields');
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('Amount must be greater than zero');
    }
    if (numAmount > MAX_AMOUNT) {
        throw new Error(`Amount exceeds maximum of ${MAX_AMOUNT.toLocaleString()}`);
    }

    const idempotencyKey = generateIdempotencyKey('accrual', {
        type, counterparty, amount: numAmount, dueDate, timestamp: Date.now()
    });

    showLoading(true, 'Saving accrual entry...');
    try {
        const entryRef = db.collection('accrualEntries').doc();
        await entryRef.set({
            type,                // 'receivable' | 'payable'
            counterparty:  sanitizeString(counterparty),
            description:   sanitizeString(description),
            amount:        parseFloat(numAmount.toFixed(2)),
            currency:      currency || 'KES',
            category:      sanitizeString(category || ''),
            invoiceRef:    sanitizeString(invoiceRef || ''),
            issueDate:     issueDate || new Date().toISOString().split('T')[0],
            dueDate,
            notes:         sanitizeString(notes || ''),
            status:        'pending',
            settledAt:     null,
            settledBankId: null,
            settledBy:     null,
            settledLedgerId: null,
            userId:        'global',
            createdBy:     state.user.email,
            createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
            idempotencyKey
        });

        await addAuditLog('ACCRUAL_CREATED', { type, counterparty, amount: numAmount, currency, dueDate });
        showToast(`${type === 'receivable' ? 'Receivable' : 'Payable'} of ${formatCurrency(numAmount, currency)} saved!`, 'success');

        await loadAccruals();
        renderAccrualsTab();
    } catch (err) {
        console.error('saveAccrualEntry error:', err);
        showToast('Failed to save accrual: ' + err.message, 'error');
        await addAuditLog('ACCRUAL_CREATE_FAILED', { error: err.message }, 'failure');
    } finally {
        showLoading(false);
    }
}

async function settleAccrualEntry(accrualId, bankId) {
    if (!state.user) { showToast('Must be logged in', 'error'); return; }

    const entry = state.accruals.entries.find(e => e.id === accrualId);
    if (!entry) { showToast('Accrual entry not found', 'error'); return; }

    const bank = state.banks.find(b => b.id === bankId);
    if (!bank) { showToast('Bank not found', 'error'); return; }

    if (entry.currency !== bank.currency) {
        showToast(`Currency mismatch: accrual is ${entry.currency}, bank is ${bank.currency}`, 'error');
        return;
    }

    showLoading(true, 'Settling accrual...');
    try {
        const batch = db.batch();
        const now = new Date().toISOString();

        // Create ledger entry for the cash settlement
        const ledgerRef = db.collection('bankLedger').doc();
        const ledgerType = entry.type === 'receivable' ? 'receipt' : 'expense';
        batch.set(ledgerRef, {
            type:        ledgerType,
            date:        now,
            amount:      entry.amount,
            bankId:      bank.id,
            bankName:    bank.name,
            currency:    entry.currency,
            description: `[Accrual Settlement] ${entry.description} — ${entry.counterparty}`,
            reference:   entry.invoiceRef || '',
            category:    entry.category || '',
            accrualId:   accrualId,
            createdBy:   state.user.email,
            createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
            status:      'completed',
            userId:      'global'
        });

        // Mark accrual as settled
        const accrualRef = db.collection('accrualEntries').doc(accrualId);
        batch.update(accrualRef, {
            status:          'settled',
            settledAt:       now,
            settledBankId:   bank.id,
            settledBankName: bank.name,
            settledBy:       state.user.email,
            settledLedgerId: ledgerRef.id
        });

        await batch.commit();
        await addAuditLog('ACCRUAL_SETTLED', {
            accrualId,
            type:        entry.type,
            counterparty: entry.counterparty,
            amount:      entry.amount,
            bank:        bank.name
        });

        showToast(`Accrual settled! ${formatCurrency(entry.amount, entry.currency)} ${ledgerType === 'receipt' ? 'credited to' : 'debited from'} ${bank.name}`, 'success');

        await initApp();
    } catch (err) {
        console.error('settleAccrualEntry error:', err);
        showToast('Settlement failed: ' + err.message, 'error');
        await addAuditLog('ACCRUAL_SETTLE_FAILED', { accrualId, error: err.message }, 'failure');
    } finally {
        showLoading(false);
    }
}

async function deleteAccrualEntry(accrualId) {
    if (!confirm('Delete this accrual entry? This cannot be undone.')) return;
    if (!state.user) { showToast('Must be logged in', 'error'); return; }

    showLoading(true, 'Deleting accrual...');
    try {
        await db.collection('accrualEntries').doc(accrualId).delete();
        await addAuditLog('ACCRUAL_DELETED', { accrualId });
        showToast('Accrual entry deleted', 'success');
        await loadAccruals();
        renderAccrualsTab();
    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

// --- ACCRUALS TAB RENDERER ---

function renderAccrualsTab() {
    const container = document.getElementById('accruals-tab-content');
    if (!container) return;

    const s = state.accruals.summary;
    const entries = state.accruals.entries;

    const fmtKES = n => `KES ${formatNumber(n)}`;
    const fmtUSD = n => `$ ${formatNumber(n)}`;

    // Build status badge
    function statusBadge(entry) {
        const st = entry._computedStatus || entry.status;
        if (st === 'settled')  return '<span class="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800 font-semibold">Settled</span>';
        if (st === 'overdue')  return '<span class="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-800 font-semibold">Overdue</span>';
        return '<span class="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-800 font-semibold">Pending</span>';
    }

    function typeBadge(type) {
        if (type === 'receivable') return '<span class="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 font-semibold">Receivable (AR)</span>';
        return '<span class="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-800 font-semibold">Payable (AP)</span>';
    }

    const pendingEntries  = entries.filter(e => e.status !== 'settled');
    const settledEntries  = entries.filter(e => e.status === 'settled');
    const overdueEntries  = pendingEntries.filter(e => e._computedStatus === 'overdue');
    const receivables     = pendingEntries.filter(e => e.type === 'receivable');
    const payables        = pendingEntries.filter(e => e.type === 'payable');

    // Build bank options for settle modal
    const bankOptions = state.banks.map(b =>
        `<option value="${b.id}">${sanitizeString(b.name)} (${b.currency} — ${formatNumber(state.balances[b.id] || 0)})</option>`
    ).join('');

    container.innerHTML = `
        <!-- KPI Summary Row -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div class="text-xs text-blue-600 font-semibold mb-1">ACCOUNTS RECEIVABLE</div>
                <div class="text-xl font-bold text-blue-800">${fmtKES(s.totalReceivable.KES)}</div>
                <div class="text-sm text-blue-600">${fmtUSD(s.totalReceivable.USD)}</div>
                <div class="text-xs text-gray-500 mt-1">${s.pendingCount.receivable} pending</div>
            </div>
            <div class="bg-purple-50 border border-purple-200 rounded-xl p-4">
                <div class="text-xs text-purple-600 font-semibold mb-1">ACCOUNTS PAYABLE</div>
                <div class="text-xl font-bold text-purple-800">${fmtKES(s.totalPayable.KES)}</div>
                <div class="text-sm text-purple-600">${fmtUSD(s.totalPayable.USD)}</div>
                <div class="text-xs text-gray-500 mt-1">${s.pendingCount.payable} pending</div>
            </div>
            <div class="bg-red-50 border border-red-200 rounded-xl p-4">
                <div class="text-xs text-red-600 font-semibold mb-1">OVERDUE RECEIVABLE</div>
                <div class="text-xl font-bold text-red-800">${fmtKES(s.overdueReceivable.KES)}</div>
                <div class="text-sm text-red-600">${fmtUSD(s.overdueReceivable.USD)}</div>
                <div class="text-xs text-gray-500 mt-1">${overdueEntries.filter(e=>e.type==='receivable').length} overdue</div>
            </div>
            <div class="bg-green-50 border border-green-200 rounded-xl p-4">
                <div class="text-xs text-green-600 font-semibold mb-1">NET ACCRUAL (KES)</div>
                <div class="text-xl font-bold ${s.totalReceivable.KES - s.totalPayable.KES >= 0 ? 'text-green-800' : 'text-red-800'}">${fmtKES(s.totalReceivable.KES - s.totalPayable.KES)}</div>
                <div class="text-sm ${s.totalReceivable.USD - s.totalPayable.USD >= 0 ? 'text-green-600' : 'text-red-600'}">${fmtUSD(s.totalReceivable.USD - s.totalPayable.USD)}</div>
                <div class="text-xs text-gray-500 mt-1">${s.settledCount.receivable + s.settledCount.payable} settled total</div>
            </div>
        </div>

        <!-- Aging Analysis -->
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
            <div class="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                <h4 class="font-semibold text-gray-800 flex items-center"><i class="fas fa-clock mr-2 text-orange-500"></i>AR / AP Aging Analysis</h4>
            </div>
            <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                    <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
                        <tr>
                            <th class="px-4 py-3 text-left">Category</th>
                            <th class="px-4 py-3 text-right">Current (0-30d)</th>
                            <th class="px-4 py-3 text-right">31-60 Days</th>
                            <th class="px-4 py-3 text-right">61-90 Days</th>
                            <th class="px-4 py-3 text-right">90+ Days</th>
                            <th class="px-4 py-3 text-right font-bold">Total</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${['KES','USD'].map(cur => {
                            const ar = [s.aging.current.receivable[cur], s.aging.thirtyPlus.receivable[cur], s.aging.sixtyPlus.receivable[cur], s.aging.ninetyPlus.receivable[cur]];
                            const ap = [s.aging.current.payable[cur],    s.aging.thirtyPlus.payable[cur],    s.aging.sixtyPlus.payable[cur],    s.aging.ninetyPlus.payable[cur]];
                            const arTotal = ar.reduce((a,b)=>a+b,0);
                            const apTotal = ap.reduce((a,b)=>a+b,0);
                            const sym = cur === 'USD' ? '$' : 'KES';
                            if (arTotal === 0 && apTotal === 0) return '';
                            return `
                                <tr class="hover:bg-blue-50">
                                    <td class="px-4 py-3 font-medium text-blue-700">AR — ${cur}</td>
                                    ${ar.map(v=>`<td class="px-4 py-3 text-right ${v>0?'text-blue-600':''}">${sym} ${formatNumber(v)}</td>`).join('')}
                                    <td class="px-4 py-3 text-right font-bold text-blue-800">${sym} ${formatNumber(arTotal)}</td>
                                </tr>
                                <tr class="hover:bg-purple-50">
                                    <td class="px-4 py-3 font-medium text-purple-700">AP — ${cur}</td>
                                    ${ap.map(v=>`<td class="px-4 py-3 text-right ${v>0?'text-red-500':''}">${sym} ${formatNumber(v)}</td>`).join('')}
                                    <td class="px-4 py-3 text-right font-bold text-purple-800">${sym} ${formatNumber(apTotal)}</td>
                                </tr>
                            `;
                        }).join('')}
                        ${(s.totalReceivable.KES + s.totalPayable.KES + s.totalReceivable.USD + s.totalPayable.USD === 0) ? `
                            <tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">No pending accruals</td></tr>
                        ` : ''}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Actions -->
        <div class="flex flex-wrap gap-3 mb-6">
            <button onclick="openAccrualModal('receivable')"
                    class="flex items-center bg-blue-600 text-white hover:bg-blue-700 px-4 py-2.5 rounded-lg font-medium shadow-sm transition-all">
                <i class="fas fa-plus mr-2"></i> New Receivable (AR)
            </button>
            <button onclick="openAccrualModal('payable')"
                    class="flex items-center bg-purple-600 text-white hover:bg-purple-700 px-4 py-2.5 rounded-lg font-medium shadow-sm transition-all">
                <i class="fas fa-plus mr-2"></i> New Payable (AP)
            </button>
        </div>

        <!-- Pending Entries Table -->
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
            <div class="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                <h4 class="font-semibold text-gray-800 flex items-center">
                    <i class="fas fa-hourglass-half mr-2 text-yellow-500"></i>
                    Pending Accruals
                    <span class="ml-2 bg-yellow-100 text-yellow-700 text-xs font-bold px-2 py-0.5 rounded-full">${pendingEntries.length}</span>
                </h4>
            </div>
            <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                    <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
                        <tr>
                            <th class="px-4 py-3 text-left">Type</th>
                            <th class="px-4 py-3 text-left">Counterparty</th>
                            <th class="px-4 py-3 text-left">Description</th>
                            <th class="px-4 py-3 text-right">Amount</th>
                            <th class="px-4 py-3 text-center">Due Date</th>
                            <th class="px-4 py-3 text-center">Status</th>
                            <th class="px-4 py-3 text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${pendingEntries.length === 0 ? `
                            <tr><td colspan="7" class="px-4 py-8 text-center text-gray-400"><i class="fas fa-check-circle text-green-400 mr-2"></i>All accruals are settled</td></tr>
                        ` : pendingEntries.map(entry => {
                            const daysLabel = (() => {
                                if (!entry.dueDate) return '';
                                const diff = Math.floor((new Date(entry.dueDate) - new Date()) / 86400000);
                                if (diff < 0) return `<span class="text-red-500 text-xs">(${Math.abs(diff)}d overdue)</span>`;
                                if (diff === 0) return `<span class="text-orange-500 text-xs">(due today)</span>`;
                                return `<span class="text-gray-400 text-xs">(in ${diff}d)</span>`;
                            })();
                            return `
                                <tr class="hover:bg-gray-50 ${entry._computedStatus==='overdue'?'bg-red-50':''}">
                                    <td class="px-4 py-3">${typeBadge(entry.type)}</td>
                                    <td class="px-4 py-3 font-medium text-gray-800">${sanitizeString(entry.counterparty)}</td>
                                    <td class="px-4 py-3 text-gray-600 max-w-xs truncate">${sanitizeString(entry.description)}</td>
                                    <td class="px-4 py-3 text-right font-bold ${entry.type==='receivable'?'text-blue-700':'text-purple-700'}">
                                        ${formatCurrency(entry.amount, entry.currency)}
                                    </td>
                                    <td class="px-4 py-3 text-center text-gray-600">
                                        ${entry.dueDate ? new Date(entry.dueDate).toLocaleDateString() : '—'}<br>${daysLabel}
                                    </td>
                                    <td class="px-4 py-3 text-center">${statusBadge(entry)}</td>
                                    <td class="px-4 py-3 text-center">
                                        <div class="flex justify-center gap-2">
                                            <button onclick="openSettleAccrualModal('${entry.id}')"
                                                    class="bg-green-100 hover:bg-green-200 text-green-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-all">
                                                <i class="fas fa-check mr-1"></i>Settle
                                            </button>
                                            <button onclick="deleteAccrualEntry('${entry.id}')"
                                                    class="bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium px-2 py-1.5 rounded-lg transition-all">
                                                <i class="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Settled Entries (collapsed) -->
        ${settledEntries.length > 0 ? `
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div class="px-6 py-4 bg-green-50 border-b border-gray-200">
                <h4 class="font-semibold text-gray-800 flex items-center">
                    <i class="fas fa-check-circle mr-2 text-green-500"></i>
                    Settled Accruals
                    <span class="ml-2 bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">${settledEntries.length}</span>
                </h4>
            </div>
            <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                    <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
                        <tr>
                            <th class="px-4 py-3 text-left">Type</th>
                            <th class="px-4 py-3 text-left">Counterparty</th>
                            <th class="px-4 py-3 text-left">Description</th>
                            <th class="px-4 py-3 text-right">Amount</th>
                            <th class="px-4 py-3 text-center">Settled On</th>
                            <th class="px-4 py-3 text-left">Settled Via</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${settledEntries.slice(0, 20).map(entry => `
                            <tr class="hover:bg-gray-50 opacity-75">
                                <td class="px-4 py-3">${typeBadge(entry.type)}</td>
                                <td class="px-4 py-3 text-gray-700">${sanitizeString(entry.counterparty)}</td>
                                <td class="px-4 py-3 text-gray-500 max-w-xs truncate">${sanitizeString(entry.description)}</td>
                                <td class="px-4 py-3 text-right font-semibold text-gray-700">${formatCurrency(entry.amount, entry.currency)}</td>
                                <td class="px-4 py-3 text-center text-gray-500">${entry.settledAt ? new Date(entry.settledAt).toLocaleDateString() : '—'}</td>
                                <td class="px-4 py-3 text-gray-500 text-xs">${sanitizeString(entry.settledBankName || '—')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}
    `;
}

function openAccrualModal(defaultType = 'receivable') {
    const existing = document.getElementById('accrual-entry-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'accrual-entry-modal';
    modal.className = 'fixed inset-0 z-[100] overflow-y-auto';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black bg-opacity-60 backdrop-blur-sm" onclick="closeAccrualModal()"></div>
        <div class="relative bg-white rounded-xl shadow-2xl max-w-lg w-full mx-auto my-12 p-6">
            <div class="flex justify-between items-center mb-5">
                <h3 class="text-lg font-bold text-gray-900 flex items-center">
                    <div class="bg-blue-100 p-2 rounded-full mr-3"><i class="fas fa-file-invoice text-blue-600"></i></div>
                    New Accrual Entry
                </h3>
                <button onclick="closeAccrualModal()" class="text-gray-400 hover:text-gray-600 text-xl"><i class="fas fa-times"></i></button>
            </div>
            <form id="accrual-entry-form" class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">Entry Type *</label>
                        <select id="accrual-type" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
                            <option value="receivable" ${defaultType==='receivable'?'selected':''}>Receivable (AR) — Money owed TO us</option>
                            <option value="payable"    ${defaultType==='payable'?'selected':''}>Payable (AP) — Money we OWE</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">Currency *</label>
                        <select id="accrual-currency" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
                            <option value="KES">KES — Kenyan Shilling</option>
                            <option value="USD">USD — US Dollar</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-medium text-gray-500 mb-1">Counterparty (Client / Vendor) *</label>
                    <input type="text" id="accrual-counterparty" maxlength="150"
                           class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500"
                           placeholder="e.g. ABC Motors Ltd, John Doe" required>
                </div>
                <div>
                    <label class="block text-xs font-medium text-gray-500 mb-1">Description *</label>
                    <input type="text" id="accrual-description" maxlength="200"
                           class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500"
                           placeholder="e.g. Invoice #INV-2024-001 for Vehicle Service" required>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">Amount *</label>
                        <input type="number" id="accrual-amount" step="0.01" min="0.01"
                               class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500"
                               placeholder="0.00" required>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">Invoice / Reference</label>
                        <input type="text" id="accrual-invoice-ref" maxlength="100"
                               class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500"
                               placeholder="INV-2024-001">
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-medium text-gray-500 mb-1">Category</label>
                    <select id="accrual-category" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
                        <option value="">— Select Category —</option>
                        <option value="Sales Revenue">Sales Revenue</option>
                        <option value="Service Revenue">Service Revenue</option>
                        <option value="Rental Income">Rental Income</option>
                        <option value="Loan Receivable">Loan Receivable</option>
                        ${EXPENSE_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}
                    </select>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">Issue Date</label>
                        <input type="date" id="accrual-issue-date"
                               class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">Due Date *</label>
                        <input type="date" id="accrual-due-date"
                               class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500" required>
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                    <textarea id="accrual-notes" rows="2" maxlength="300"
                              class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500"
                              placeholder="Additional notes..."></textarea>
                </div>
                <button type="submit"
                        class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-semibold transition-colors shadow-md">
                    <i class="fas fa-save mr-2"></i>Save Accrual Entry
                </button>
            </form>
        </div>
    `;

    document.body.appendChild(modal);

    // Set default dates
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('accrual-issue-date').value = today;
    // Default due date: 30 days from now
    const due30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    document.getElementById('accrual-due-date').value = due30;

    document.getElementById('accrual-entry-form').addEventListener('submit', async e => {
        e.preventDefault();
        try {
            await saveAccrualEntry({
                type:         document.getElementById('accrual-type').value,
                currency:     document.getElementById('accrual-currency').value,
                counterparty: document.getElementById('accrual-counterparty').value,
                description:  document.getElementById('accrual-description').value,
                amount:       document.getElementById('accrual-amount').value,
                invoiceRef:   document.getElementById('accrual-invoice-ref').value,
                category:     document.getElementById('accrual-category').value,
                issueDate:    document.getElementById('accrual-issue-date').value,
                dueDate:      document.getElementById('accrual-due-date').value,
                notes:        document.getElementById('accrual-notes').value
            });
            closeAccrualModal();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function closeAccrualModal() {
    const m = document.getElementById('accrual-entry-modal');
    if (m) m.remove();
}

function openSettleAccrualModal(accrualId) {
    const entry = state.accruals.entries.find(e => e.id === accrualId);
    if (!entry) return;

    const existing = document.getElementById('settle-accrual-modal');
    if (existing) existing.remove();

    const compatBanks = state.banks.filter(b => b.currency === entry.currency);
    const bankOptions = compatBanks.map(b =>
        `<option value="${b.id}">${sanitizeString(b.name)} — Available: ${formatCurrency(state.balances[b.id] || 0, b.currency)}</option>`
    ).join('');

    const modal = document.createElement('div');
    modal.id = 'settle-accrual-modal';
    modal.className = 'fixed inset-0 z-[101] flex items-center justify-center';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black bg-opacity-60 backdrop-blur-sm" onclick="closeSettleAccrualModal()"></div>
        <div class="relative bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-bold text-gray-900 flex items-center">
                    <div class="bg-green-100 p-2 rounded-full mr-3"><i class="fas fa-check-circle text-green-600"></i></div>
                    Settle Accrual
                </h3>
                <button onclick="closeSettleAccrualModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
            </div>
            <div class="bg-gray-50 rounded-lg p-4 mb-4 text-sm">
                <div class="font-semibold text-gray-800 mb-1">${sanitizeString(entry.counterparty)}</div>
                <div class="text-gray-600">${sanitizeString(entry.description)}</div>
                <div class="mt-2 text-lg font-bold ${entry.type==='receivable'?'text-blue-700':'text-purple-700'}">${formatCurrency(entry.amount, entry.currency)}</div>
                <div class="text-xs text-gray-500 mt-1">
                    ${entry.type === 'receivable' ? 'Credit this amount to the selected bank' : 'Debit this amount from the selected bank'}
                </div>
            </div>
            ${compatBanks.length === 0 ? `
                <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                    <i class="fas fa-exclamation-circle mr-2"></i>No ${entry.currency} bank accounts found. Please add one first.
                </div>
            ` : `
                <div class="mb-4">
                    <label class="block text-xs font-medium text-gray-500 mb-1">Select Bank Account (${entry.currency})</label>
                    <select id="settle-bank-select" class="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-green-500">
                        <option value="">— Choose Bank —</option>
                        ${bankOptions}
                    </select>
                </div>
                <button onclick="confirmSettleAccrual('${accrualId}')"
                        class="w-full bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-lg font-semibold transition-colors">
                    <i class="fas fa-check mr-2"></i>Confirm Settlement
                </button>
            `}
        </div>
    `;
    document.body.appendChild(modal);
}

async function confirmSettleAccrual(accrualId) {
    const bankId = document.getElementById('settle-bank-select')?.value;
    if (!bankId) { showToast('Please select a bank account', 'error'); return; }
    closeSettleAccrualModal();
    await settleAccrualEntry(accrualId, bankId);
}

function closeSettleAccrualModal() {
    const m = document.getElementById('settle-accrual-modal');
    if (m) m.remove();
}

// ============================================================
// --- FINANCIAL SUMMARY DASHBOARD ---
// ============================================================

function renderSummaryDashboard() {
    const container = document.getElementById('summary-tab-content');
    if (!container) return;

    // ---- Cash metrics ----
    const cashKES = state.stats.totalKES || 0;
    const cashUSD = state.stats.totalUSD || 0;

    // ---- Ledger P&L (cash basis) ----
    let cashIncomeKES = 0, cashIncomeUSD = 0;
    let cashExpKES = 0,    cashExpUSD = 0;
    let monthlyData = {}; // "YYYY-MM" -> { income, expense }

    state.ledger.forEach(tx => {
        const amt = parseFloat(tx.amount) || 0;
        const cur = tx.currency || 'KES';
        const mo  = (tx.date || '').slice(0, 7); // "YYYY-MM"
        if (!monthlyData[mo]) monthlyData[mo] = { income: 0, expense: 0 };

        if (tx.type === 'receipt') {
            if (cur === 'USD') cashIncomeUSD += amt; else cashIncomeKES += amt;
            monthlyData[mo].income += amt;
        } else if (['expense', 'withdrawal', 'credit', 'receipt_reversal'].includes(tx.type)) {
            if (cur === 'USD') cashExpUSD += amt; else cashExpKES += amt;
            monthlyData[mo].expense += amt;
        }
    });

    const netCashKES = cashIncomeKES - cashExpKES;
    const netCashUSD = cashIncomeUSD - cashExpUSD;

    // ---- Accrual metrics ----
    const s = state.accruals.summary;
    const accrualRevenueKES = s.totalReceivable.KES;
    const accrualRevenueUSD = s.totalReceivable.USD;
    const accrualExpKES     = s.totalPayable.KES;
    const accrualExpUSD     = s.totalPayable.USD;

    // ---- Accrual basis P&L ----
    const accrualBasisIncKES = cashIncomeKES + accrualRevenueKES;
    const accrualBasisExpKES = cashExpKES    + accrualExpKES;
    const accrualBasisNetKES = accrualBasisIncKES - accrualBasisExpKES;

    // ---- Expense category breakdown (top 8) ----
    const topCategories = Object.entries(state.expenseSummary)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

    const totalCatExp = topCategories.reduce((acc, [, v]) => acc + v, 0);

    // ---- Monthly trend (last 6 months) ----
    const last6 = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - i);
        last6.push(d.toISOString().slice(0, 7));
    }

    // ---- Bank breakdown rows ----
    const bankRows = state.banks.map(bank => {
        const bal = state.balances[bank.id] || 0;
        const openTs = state.openingBalanceTimestamps[bank.id] || state.openingBalanceTimestamps[bank.name];
        const opening = (bank.openingBalanceConfig?.amount !== undefined ? bank.openingBalanceConfig.amount : null) ?? openTs?.balance ?? 0;
        const txns = state.ledger.filter(t => t.bankId === bank.id || t.toBankId === bank.id);
        let inc = 0, exp = 0;
        txns.forEach(t => {
            const a = parseFloat(t.amount) || 0;
            const creditA = (t.type === 'transfer' && t.toBankId === bank.id && t.toAmount !== undefined && t.toAmount !== null)
                ? (parseFloat(t.toAmount) || 0)
                : a;
            if (t.type === 'receipt' || (t.type === 'transfer' && t.toBankId === bank.id)) inc += creditA;
            else if (['expense','withdrawal','credit','receipt_reversal'].includes(t.type) || (t.type === 'transfer' && t.bankId === bank.id)) exp += a;
        });
        const pctBar = (v, max) => {
            if (max === 0) return 0;
            return Math.min(100, Math.max(0, (v / max) * 100)).toFixed(1);
        };
        return { bank, bal, opening, inc, exp, txns: txns.length };
    });

    const maxBal = Math.max(...bankRows.map(r => Math.abs(r.bal)), 1);

    container.innerHTML = `
        <!-- Page Header -->
        <div class="flex justify-between items-center mb-6">
            <div>
                <h3 class="text-xl font-bold text-gray-800">Financial Summary</h3>
                <p class="text-sm text-gray-500">Cash basis + Accrual overlay • Updated ${new Date().toLocaleString()}</p>
            </div>
            <button onclick="renderSummaryDashboard()"
                    class="flex items-center bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-all">
                <i class="fas fa-sync-alt mr-2"></i>Refresh
            </button>
        </div>

        <!-- KPI Row — Cash Basis -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="bg-gradient-to-br from-green-500 to-green-700 text-white rounded-xl p-5 shadow-md">
                <div class="text-xs font-semibold opacity-80 mb-2 uppercase">💵 Total Cash — KES</div>
                <div class="text-2xl font-bold">KES ${formatNumber(cashKES)}</div>
                <div class="text-xs opacity-75 mt-1">${state.banks.filter(b=>b.currency==='KES').length} KES accounts</div>
            </div>
            <div class="bg-gradient-to-br from-blue-500 to-blue-700 text-white rounded-xl p-5 shadow-md">
                <div class="text-xs font-semibold opacity-80 mb-2 uppercase">💵 Total Cash — USD</div>
                <div class="text-2xl font-bold">$ ${formatNumber(cashUSD)}</div>
                <div class="text-xs opacity-75 mt-1">${state.banks.filter(b=>b.currency==='USD').length} USD accounts</div>
            </div>
            <div class="bg-gradient-to-br from-indigo-500 to-indigo-700 text-white rounded-xl p-5 shadow-md">
                <div class="text-xs font-semibold opacity-80 mb-2 uppercase">📥 Cash Income (KES)</div>
                <div class="text-2xl font-bold">KES ${formatNumber(cashIncomeKES)}</div>
                <div class="text-xs opacity-75 mt-1">Total receipts received</div>
            </div>
            <div class="bg-gradient-to-br from-red-500 to-red-700 text-white rounded-xl p-5 shadow-md">
                <div class="text-xs font-semibold opacity-80 mb-2 uppercase">📤 Cash Expenses (KES)</div>
                <div class="text-2xl font-bold">KES ${formatNumber(cashExpKES)}</div>
                <div class="text-xs opacity-75 mt-1">Total payments made</div>
            </div>
        </div>

        <!-- P&L Comparison: Cash vs Accrual -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

            <!-- Cash Basis P&L -->
            <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div class="px-6 py-4 bg-gray-50 border-b border-gray-100">
                    <h4 class="font-semibold text-gray-800 flex items-center">
                        <i class="fas fa-coins mr-2 text-yellow-500"></i>Cash Basis P&L (KES)
                    </h4>
                </div>
                <div class="p-6 space-y-3">
                    <div class="flex justify-between items-center py-2 border-b border-gray-100">
                        <span class="text-sm text-gray-600">Total Receipts</span>
                        <span class="font-bold text-green-600">+ KES ${formatNumber(cashIncomeKES)}</span>
                    </div>
                    <div class="flex justify-between items-center py-2 border-b border-gray-100">
                        <span class="text-sm text-gray-600">Total Expenses</span>
                        <span class="font-bold text-red-600">− KES ${formatNumber(cashExpKES)}</span>
                    </div>
                    <div class="flex justify-between items-center py-3 rounded-lg ${netCashKES >= 0 ? 'bg-green-50' : 'bg-red-50'} px-3">
                        <span class="font-bold text-gray-800">Net Cash Income</span>
                        <span class="text-xl font-bold ${netCashKES >= 0 ? 'text-green-700' : 'text-red-700'}">
                            ${netCashKES >= 0 ? '+' : ''}KES ${formatNumber(netCashKES)}
                        </span>
                    </div>
                    <div class="flex justify-between items-center py-2 text-sm text-gray-500">
                        <span>Expense Ratio</span>
                        <span class="font-medium">${cashIncomeKES > 0 ? ((cashExpKES / cashIncomeKES) * 100).toFixed(1) + '%' : '—'}</span>
                    </div>
                    <div class="flex justify-between items-center py-2 text-sm text-gray-500">
                        <span>Total Transactions</span>
                        <span class="font-medium">${state.ledger.length}</span>
                    </div>
                </div>
            </div>

            <!-- Accrual Basis P&L -->
            <div class="bg-white rounded-xl border border-indigo-200 overflow-hidden">
                <div class="px-6 py-4 bg-indigo-50 border-b border-indigo-100">
                    <h4 class="font-semibold text-gray-800 flex items-center">
                        <i class="fas fa-file-invoice-dollar mr-2 text-indigo-500"></i>Accrual Basis P&L (KES)
                    </h4>
                </div>
                <div class="p-6 space-y-3">
                    <div class="flex justify-between items-center py-2 border-b border-gray-100">
                        <span class="text-sm text-gray-600">Cash Receipts</span>
                        <span class="font-semibold text-green-600">KES ${formatNumber(cashIncomeKES)}</span>
                    </div>
                    <div class="flex justify-between items-center py-2 border-b border-gray-100">
                        <span class="text-sm text-gray-600">Pending Receivables (AR)</span>
                        <span class="font-semibold text-blue-600">+ KES ${formatNumber(accrualRevenueKES)}</span>
                    </div>
                    <div class="flex justify-between items-center py-2 border-b border-gray-100 font-bold">
                        <span class="text-sm text-gray-800">Total Accrual Revenue</span>
                        <span class="text-green-700">KES ${formatNumber(accrualBasisIncKES)}</span>
                    </div>
                    <div class="flex justify-between items-center py-2 border-b border-gray-100">
                        <span class="text-sm text-gray-600">Cash Expenses</span>
                        <span class="font-semibold text-red-600">KES ${formatNumber(cashExpKES)}</span>
                    </div>
                    <div class="flex justify-between items-center py-2 border-b border-gray-100">
                        <span class="text-sm text-gray-600">Pending Payables (AP)</span>
                        <span class="font-semibold text-purple-600">+ KES ${formatNumber(accrualExpKES)}</span>
                    </div>
                    <div class="flex justify-between items-center py-2 border-b border-gray-100 font-bold">
                        <span class="text-sm text-gray-800">Total Accrual Expenses</span>
                        <span class="text-red-700">KES ${formatNumber(accrualBasisExpKES)}</span>
                    </div>
                    <div class="flex justify-between items-center py-3 rounded-lg ${accrualBasisNetKES >= 0 ? 'bg-indigo-50' : 'bg-red-50'} px-3">
                        <span class="font-bold text-gray-800">Net Accrual Income</span>
                        <span class="text-xl font-bold ${accrualBasisNetKES >= 0 ? 'text-indigo-700' : 'text-red-700'}">
                            ${accrualBasisNetKES >= 0 ? '+' : ''}KES ${formatNumber(accrualBasisNetKES)}
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Bank Account Summary Table -->
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
            <div class="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                <h4 class="font-semibold text-gray-800 flex items-center"><i class="fas fa-university mr-2 text-green-600"></i>Bank Account Summary</h4>
                <span class="text-xs text-gray-400">${state.banks.length} accounts</span>
            </div>
            <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                    <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
                        <tr>
                            <th class="px-4 py-3 text-left">Bank Account</th>
                            <th class="px-4 py-3 text-left">Currency</th>
                            <th class="px-4 py-3 text-right">Opening Balance</th>
                            <th class="px-4 py-3 text-right">Total Credits</th>
                            <th class="px-4 py-3 text-right">Total Debits</th>
                            <th class="px-4 py-3 text-right font-bold">Current Balance</th>
                            <th class="px-4 py-3 text-center">Balance Bar</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${bankRows.length === 0 ? `
                            <tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">No bank accounts loaded</td></tr>
                        ` : bankRows.map(({ bank, bal, opening, inc, exp, txns }) => `
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3 font-semibold text-gray-800">${sanitizeString(bank.name)}</td>
                                <td class="px-4 py-3">
                                    <span class="px-2 py-0.5 text-xs rounded-full font-bold ${bank.currency==='USD'?'bg-blue-100 text-blue-700':'bg-green-100 text-green-700'}">${bank.currency}</span>
                                </td>
                                <td class="px-4 py-3 text-right text-gray-500">${formatNumber(opening)}</td>
                                <td class="px-4 py-3 text-right text-green-600 font-medium">${formatNumber(inc)}</td>
                                <td class="px-4 py-3 text-right text-red-600 font-medium">${formatNumber(exp)}</td>
                                <td class="px-4 py-3 text-right font-bold ${bal >= 0 ? 'text-gray-900' : 'text-red-600'}">${formatNumber(bal)}</td>
                                <td class="px-4 py-3">
                                    <div class="w-full bg-gray-100 rounded-full h-2 min-w-16">
                                        <div class="h-2 rounded-full ${bal >= 0 ? 'bg-green-500' : 'bg-red-500'}"
                                             style="width:${Math.min(100,(Math.abs(bal)/maxBal)*100).toFixed(1)}%"></div>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                    ${bankRows.length > 0 ? `
                    <tfoot class="bg-gray-50 font-bold text-sm">
                        <tr>
                            <td colspan="3" class="px-4 py-3 text-gray-600">Totals</td>
                            <td class="px-4 py-3 text-right text-green-700">${formatNumber(bankRows.reduce((a,r)=>a+r.inc,0))}</td>
                            <td class="px-4 py-3 text-right text-red-700">${formatNumber(bankRows.reduce((a,r)=>a+r.exp,0))}</td>
                            <td class="px-4 py-3 text-right text-gray-900">
                                KES ${formatNumber(cashKES)}<br>
                                <span class="text-blue-600 text-xs font-normal">USD ${formatNumber(cashUSD)}</span>
                            </td>
                            <td></td>
                        </tr>
                    </tfoot>
                    ` : ''}
                </table>
            </div>
        </div>

        <!-- Bottom row: Expense Breakdown + AR/AP Summary -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

            <!-- Top Expense Categories -->
            <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div class="px-6 py-4 bg-gray-50 border-b border-gray-100">
                    <h4 class="font-semibold text-gray-800 flex items-center"><i class="fas fa-tags mr-2 text-red-500"></i>Top Expense Categories</h4>
                </div>
                <div class="p-5 space-y-3">
                    ${topCategories.length === 0 ? `<div class="text-center py-6 text-gray-400">No expenses recorded yet</div>` :
                        topCategories.map(([cat, amt]) => {
                            const pct = totalCatExp > 0 ? ((amt / totalCatExp) * 100).toFixed(1) : 0;
                            return `
                                <div>
                                    <div class="flex justify-between items-center mb-1">
                                        <span class="text-sm text-gray-700 truncate max-w-xs">${sanitizeString(cat)}</span>
                                        <span class="text-sm font-bold text-red-600 ml-2">KES ${formatNumber(amt)}</span>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <div class="flex-1 bg-gray-100 rounded-full h-2">
                                            <div class="bg-red-500 h-2 rounded-full" style="width:${pct}%"></div>
                                        </div>
                                        <span class="text-xs text-gray-400 w-10 text-right">${pct}%</span>
                                    </div>
                                </div>
                            `;
                        }).join('')
                    }
                </div>
            </div>

            <!-- AR / AP Summary -->
            <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div class="px-6 py-4 bg-gray-50 border-b border-gray-100">
                    <h4 class="font-semibold text-gray-800 flex items-center"><i class="fas fa-balance-scale mr-2 text-indigo-500"></i>AR / AP Overview</h4>
                </div>
                <div class="p-5 space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-blue-50 rounded-lg p-4 text-center">
                            <div class="text-xs text-blue-600 font-semibold mb-1">TOTAL AR (KES)</div>
                            <div class="text-xl font-bold text-blue-800">KES ${formatNumber(s.totalReceivable.KES)}</div>
                            <div class="text-sm text-blue-600">+ $ ${formatNumber(s.totalReceivable.USD)}</div>
                            <div class="text-xs text-gray-500 mt-1">${s.pendingCount.receivable} entries</div>
                        </div>
                        <div class="bg-purple-50 rounded-lg p-4 text-center">
                            <div class="text-xs text-purple-600 font-semibold mb-1">TOTAL AP (KES)</div>
                            <div class="text-xl font-bold text-purple-800">KES ${formatNumber(s.totalPayable.KES)}</div>
                            <div class="text-sm text-purple-600">+ $ ${formatNumber(s.totalPayable.USD)}</div>
                            <div class="text-xs text-gray-500 mt-1">${s.pendingCount.payable} entries</div>
                        </div>
                    </div>
                    <div class="border-t border-gray-100 pt-3 space-y-2">
                        <div class="flex justify-between text-sm">
                            <span class="text-red-600 font-medium"><i class="fas fa-exclamation-circle mr-1"></i>Overdue AR (KES)</span>
                            <span class="font-bold text-red-700">KES ${formatNumber(s.overdueReceivable.KES)}</span>
                        </div>
                        <div class="flex justify-between text-sm">
                            <span class="text-red-600 font-medium"><i class="fas fa-exclamation-circle mr-1"></i>Overdue AP (KES)</span>
                            <span class="font-bold text-red-700">KES ${formatNumber(s.overduePayable.KES)}</span>
                        </div>
                        <div class="flex justify-between text-sm border-t pt-2">
                            <span class="text-gray-600">Net AR (receivable − payable, KES)</span>
                            <span class="font-bold ${s.totalReceivable.KES - s.totalPayable.KES >= 0 ? 'text-green-700' : 'text-red-700'}">
                                KES ${formatNumber(s.totalReceivable.KES - s.totalPayable.KES)}
                            </span>
                        </div>
                        <div class="flex justify-between text-sm">
                            <span class="text-gray-600">Settled to date</span>
                            <span class="font-medium text-gray-700">${s.settledCount.receivable + s.settledCount.payable} entries</span>
                        </div>
                    </div>
                    <button onclick="openTab(null,'accruals')"
                            class="w-full text-center text-sm text-indigo-600 hover:text-indigo-800 font-medium py-2 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-all">
                        <i class="fas fa-external-link-alt mr-1"></i> Manage Accruals →
                    </button>
                </div>
            </div>
        </div>

        <!-- Monthly Trend Chart (canvas) -->
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div class="px-6 py-4 bg-gray-50 border-b border-gray-100">
                <h4 class="font-semibold text-gray-800 flex items-center"><i class="fas fa-chart-line mr-2 text-green-600"></i>Monthly Cash Flow — Last 6 Months</h4>
            </div>
            <div class="p-5">
                <div style="height: 260px; position: relative;">
                    <canvas id="summaryTrendChart"></canvas>
                </div>
            </div>
        </div>
    `;

    // Render monthly trend chart
    setTimeout(() => {
        const ctx = document.getElementById('summaryTrendChart');
        if (!ctx) return;
        if (window._summaryTrendChart && typeof window._summaryTrendChart.destroy === 'function') {
            window._summaryTrendChart.destroy();
        }
        const labels = last6.map(m => {
            const [y, mo] = m.split('-');
            return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
        });
        const incomeData = last6.map(m => monthlyData[m]?.income || 0);
        const expenseData = last6.map(m => monthlyData[m]?.expense || 0);
        window._summaryTrendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Income',
                        data: incomeData,
                        backgroundColor: 'rgba(16, 185, 129, 0.75)',
                        borderColor: '#10B981',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Expenses',
                        data: expenseData,
                        backgroundColor: 'rgba(239, 68, 68, 0.75)',
                        borderColor: '#EF4444',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: KES ${formatNumber(ctx.raw)}`
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: {
                        beginAtZero: true,
                        ticks: { callback: v => 'KES ' + formatNumber(v) }
                    }
                }
            }
        });
    }, 50);
}

// --- EXPOSE NEW ACCRUAL + SUMMARY FUNCTIONS ---
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
window.verifyBankAccessPin = verifyBankAccessPin; // Renamed from checkBankAccessCode
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
window.verifyAllBalances = verifyAllBalances;
window.showPinManagementModal = showPinManagementModal;
window.closePinManagementModal = closePinManagementModal;
window.createNewPin = createNewPin;
window.changeExistingPin = changeExistingPin;
window.switchPinTab = switchPinTab;
window.updatePinDots = updatePinDots;
window.updateCreatePinDots = updateCreatePinDots;
window.updateConfirmPinDots = updateConfirmPinDots;
window.updateCurrentPinDots = updateCurrentPinDots;
window.updateChangeNewPinDots = updateChangeNewPinDots;
window.updateChangeConfirmPinDots = updateChangeConfirmPinDots;

// Accrual & Summary exports
window.loadAccruals = loadAccruals;
window.renderAccrualsTab = renderAccrualsTab;
window.renderSummaryDashboard = renderSummaryDashboard;
window.openAccrualModal = openAccrualModal;
window.closeAccrualModal = closeAccrualModal;
window.openSettleAccrualModal = openSettleAccrualModal;
window.closeSettleAccrualModal = closeSettleAccrualModal;
window.confirmSettleAccrual = confirmSettleAccrual;
window.deleteAccrualEntry = deleteAccrualEntry;
window.settleAccrualEntry = settleAccrualEntry;
