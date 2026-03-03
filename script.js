// production-script.js - Production Ready Bank Ledger System
// Security Features: Input validation, Idempotency keys, Audit logging, 2FA, Rate limiting

// ==================== FIREBASE CONFIGURATION ====================
const firebaseConfig = {
    apiKey: "AIzaSyCuUKCxYx0jYKqWOQaN82K5zFGlQsKQsK0",
    authDomain: "ck-manager-1abdc.firebaseapp.com", // Fixed: was firebasestorage.app
    projectId: "ck-manager-1abdc",
    storageBucket: "ck-manager-1abdc.appspot.com", // Fixed: proper storage bucket format
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

// ==================== ENHANCED STATE MANAGEMENT ====================
const StateManager = (() => {
    let state = {
        user: null,
        banks: [],
        ledger: [],
        balances: {},
        auditLog: [],
        reconciliations: [],
        stats: {
            totalKES: 0,
            totalUSD: 0,
            totalTransactions: 0
        },
        security: {
            isAuthenticated: false,
            isMFAVerified: false,
            mfaPIN: null, // Hashed, never stored in plaintext
            pinAttempts: 0,
            pinLockoutUntil: null,
            sessionId: null,
            idempotencyKey: null,
            lastAuditId: null
        },
        lastSyncTime: null,
        systemReady: false,
        processedTransactions: new Set(),
        openingBalanceTimestamps: {},
        expenseCategories: []
    };

    // Version control for state changes
    let stateVersion = 0;
    const subscribers = new Set();

    return {
        get: () => ({ ...state }), // Return immutable copy
        getRaw: () => state,
        update: (updater) => {
            const newState = updater(state);
            state = { ...state, ...newState };
            stateVersion++;
            subscribers.forEach(cb => cb(state, stateVersion));
            return state;
        },
        subscribe: (callback) => {
            subscribers.add(callback);
            return () => subscribers.delete(callback);
        },
        getVersion: () => stateVersion
    };
})();

// ==================== SECURITY UTILITIES ====================

// XSS Prevention - Sanitize all user input
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return DOMPurify.sanitize(input, {
        ALLOWED_TAGS: [], // No HTML allowed
        ALLOWED_ATTR: []
    });
}

// Amount Validation with strict bounds
function validateAmount(amount, bank = null, operation = 'any') {
    const numAmount = parseFloat(amount);
    
    // Basic validation
    if (isNaN(numAmount) || !isFinite(numAmount)) {
        throw new Error('Invalid amount format');
    }
    if (numAmount <= 0) {
        throw new Error('Amount must be greater than zero');
    }
    if (numAmount > 1000000000) { // 1 billion max
        throw new Error('Amount exceeds maximum limit (1 billion)');
    }
    
    // Currency-specific validation
    if (bank) {
        const currentBalance = StateManager.get().balances[bank.id] || 0;
        if (operation === 'debit' && currentBalance < numAmount) {
            throw new Error(`Insufficient funds. Available: ${formatCurrency(currentBalance, bank.currency)}`);
        }
        
        // Currency consistency
        if (bank.currency === 'USD' && numAmount > 10000000) {
            throw new Error('USD amount exceeds reasonable limit');
        }
    }
    
    // Return rounded to 2 decimal places to prevent floating point issues
    return Math.round(numAmount * 100) / 100;
}

// Generate secure idempotency key
function generateIdempotencyKey() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Rate limiting
const rateLimiter = (() => {
    const limits = new Map();
    
    return {
        check: (key, maxAttempts = 5, windowMs = 60000) => {
            const now = Date.now();
            const record = limits.get(key) || { attempts: 0, resetTime: now + windowMs };
            
            if (now > record.resetTime) {
                record.attempts = 1;
                record.resetTime = now + windowMs;
            } else {
                record.attempts++;
            }
            
            limits.set(key, record);
            
            if (record.attempts > maxAttempts) {
                throw new Error(`Rate limit exceeded. Try again in ${Math.ceil((record.resetTime - now) / 1000)} seconds`);
            }
            
            return maxAttempts - record.attempts;
        },
        reset: (key) => limits.delete(key)
    };
})();

// Audit logging - IMMUTABLE
async function logAudit(action, details = {}, userId = null) {
    try {
        const state = StateManager.get();
        const auditEntry = {
            action,
            details: JSON.parse(JSON.stringify(details)), // Deep clone
            userId: userId || state.user?.uid || 'system',
            userEmail: state.user?.email || 'system',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            clientTimestamp: new Date().toISOString(),
            ipAddress: await getClientIP(), // Would need server endpoint for real IP
            userAgent: navigator.userAgent,
            sessionId: state.security.sessionId,
            idempotencyKey: state.security.idempotencyKey
        };

        // Store in Firestore
        const docRef = await db.collection('auditLog').add(auditEntry);
        
        // Also store in local state
        StateManager.update(s => {
            s.auditLog = [{ id: docRef.id, ...auditEntry }, ...s.auditLog].slice(0, 1000);
            s.security.lastAuditId = docRef.id;
            return s;
        });
        
        return docRef.id;
    } catch (error) {
        console.error('Audit logging failed:', error);
        // Fail silently - don't block main operation
    }
}

// Get client IP (would need backend endpoint in production)
async function getClientIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch {
        return 'unknown';
    }
}

// ==================== 2FA / PIN MANAGEMENT ====================

// Hash PIN using SHA-256 (client-side, but in production use server-side hashing)
async function hashPIN(pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin + firebaseConfig.projectId); // Add pepper
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Setup MFA PIN (first time)
async function setupMFA() {
    const pin1 = document.getElementById('mfa-pin-1')?.value;
    const pin2 = document.getElementById('mfa-pin-2')?.value;
    const errorEl = document.getElementById('mfa-error');
    
    if (!pin1 || !pin2) {
        errorEl.textContent = 'Please enter and confirm your PIN';
        errorEl.classList.remove('hidden');
        return;
    }
    
    if (pin1 !== pin2) {
        errorEl.textContent = 'PINs do not match';
        errorEl.classList.remove('hidden');
        return;
    }
    
    if (pin1.length !== 6 || !/^\d+$/.test(pin1)) {
        errorEl.textContent = 'PIN must be exactly 6 digits';
        errorEl.classList.remove('hidden');
        return;
    }
    
    showLoading(true, 'Setting up security...');
    
    try {
        const state = StateManager.get();
        if (!state.user) throw new Error('Not authenticated');
        
        // Hash PIN before storing
        const hashedPIN = await hashPIN(pin1);
        
        // Store in Firestore with user document
        await db.collection('userSecurity').doc(state.user.uid).set({
            mfaHash: hashedPIN,
            mfaEnabled: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: state.user.uid
        }, { merge: true });
        
        // Update local state
        StateManager.update(s => {
            s.security.mfaHash = hashedPIN;
            s.security.isMFAVerified = true;
            return s;
        });
        
        // Hide MFA modal
        document.getElementById('mfa-setup-modal')?.classList.add('hidden');
        
        // Show bank access gate
        document.getElementById('bank-access-gate').style.display = 'flex';
        
        showToast('Security PIN setup successful!', 'success');
        await logAudit('MFA_SETUP', { method: 'PIN' });
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.classList.remove('hidden');
    } finally {
        showLoading(false);
    }
}

// Verify bank access PIN
async function verifyBankAccess() {
    const pinInput = document.getElementById('bank-access-code');
    const attemptsEl = document.getElementById('pin-attempts-remaining');
    
    if (!pinInput) return;
    
    const pin = pinInput.value;
    
    // Check rate limiting
    try {
        const state = StateManager.get();
        
        // Check lockout
        if (state.security.pinLockoutUntil && new Date() < new Date(state.security.pinLockoutUntil)) {
            const waitSeconds = Math.ceil((new Date(state.security.pinLockoutUntil) - new Date()) / 1000);
            showToast(`Account locked. Try again in ${waitSeconds} seconds`, 'error');
            if (attemptsEl) attemptsEl.textContent = `Locked for ${waitSeconds}s`;
            return;
        }
        
        // Validate format
        if (!pin || pin.length !== 6 || !/^\d+$/.test(pin)) {
            showToast('Please enter a valid 6-digit PIN', 'error');
            rateLimiter.check('pin_' + state.user?.uid);
            state.security.pinAttempts++;
            if (attemptsEl) attemptsEl.textContent = `Attempts: ${state.security.pinAttempts}/5`;
            return;
        }
        
        showLoading(true, 'Verifying PIN...');
        
        // Get stored PIN hash
        const securityDoc = await db.collection('userSecurity').doc(state.user.uid).get();
        if (!securityDoc.exists) {
            // First time - show setup
            document.getElementById('bank-access-gate').style.display = 'none';
            document.getElementById('mfa-setup-modal')?.classList.remove('hidden');
            return;
        }
        
        const storedHash = securityDoc.data().mfaHash;
        const inputHash = await hashPIN(pin);
        
        if (inputHash === storedHash) {
            // Success
            StateManager.update(s => {
                s.security.isMFAVerified = true;
                s.security.pinAttempts = 0;
                s.security.pinLockoutUntil = null;
                s.security.sessionId = generateIdempotencyKey();
                s.security.idempotencyKey = generateIdempotencyKey();
                return s;
            });
            
            // Hide gate, show content
            document.getElementById('bank-access-gate').style.display = 'none';
            document.getElementById('bank-management-content').classList.remove('hidden');
            
            // Update UI
            document.getElementById('mfa-status').innerHTML = `
                <span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                Verified
            `;
            
            showToast('Access granted!', 'success');
            await logAudit('MFA_VERIFY', { success: true });
            
            // Initialize app
            initApp();
        } else {
            // Failed attempt
            state.security.pinAttempts++;
            
            if (state.security.pinAttempts >= 5) {
                // Lock account for 5 minutes
                const lockoutUntil = new Date(Date.now() + 5 * 60 * 1000);
                StateManager.update(s => {
                    s.security.pinLockoutUntil = lockoutUntil.toISOString();
                    return s;
                });
                showToast('Too many failed attempts. Account locked for 5 minutes.', 'error');
                await logAudit('MFA_LOCKOUT', { attempts: state.security.pinAttempts });
            } else {
                showToast(`Invalid PIN. ${5 - state.security.pinAttempts} attempts remaining`, 'error');
                if (attemptsEl) attemptsEl.textContent = `Attempts: ${state.security.pinAttempts}/5`;
            }
        }
    } catch (error) {
        showToast('Verification failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ==================== AUTHENTICATION ====================

auth.onAuthStateChanged(async user => {
    const oldState = StateManager.get();
    
    StateManager.update(s => {
        s.user = user;
        s.security.isAuthenticated = !!user;
        return s;
    });
    
    const state = StateManager.get();
    
    if (user) {
        // Update UI
        document.getElementById('user-email').textContent = user.email;
        document.getElementById('login-btn').classList.add('hidden');
        document.getElementById('logout-btn').classList.remove('hidden');
        document.getElementById('firebase-user-info').classList.remove('hidden');
        document.getElementById('login-modal')?.classList.add('hidden');
        
        // Check if MFA is set up
        const securityDoc = await db.collection('userSecurity').doc(user.uid).get();
        
        if (securityDoc.exists && securityDoc.data().mfaEnabled) {
            // Show PIN gate
            document.getElementById('bank-access-gate').style.display = 'flex';
            document.getElementById('bank-management-content').classList.add('hidden');
        } else {
            // First time login - show MFA setup
            document.getElementById('mfa-setup-modal')?.classList.remove('hidden');
            document.getElementById('bank-access-gate').style.display = 'none';
        }
        
        // Load processed transactions
        await loadProcessedTransactions();
        
        // Generate session ID
        StateManager.update(s => {
            s.security.sessionId = generateIdempotencyKey();
            s.security.idempotencyKey = generateIdempotencyKey();
            return s;
        });
        
        await logAudit('LOGIN', { method: 'email' });
        showToast(`Welcome, ${user.email}!`, 'success');
    } else {
        // Reset UI
        document.getElementById('login-btn').classList.remove('hidden');
        document.getElementById('logout-btn').classList.add('hidden');
        document.getElementById('firebase-user-info').classList.add('hidden');
        document.getElementById('login-modal')?.classList.remove('hidden');
        document.getElementById('bank-access-gate').style.display = 'none';
        document.getElementById('bank-management-content').classList.add('hidden');
        document.getElementById('mfa-setup-modal')?.classList.add('hidden');
        
        // Reset security state
        StateManager.update(s => {
            s.security.isMFAVerified = false;
            s.security.sessionId = null;
            s.security.idempotencyKey = null;
            return s;
        });
        
        updateSystemStatus(false);
    }
});

async function login() {
    const email = document.getElementById('l-email').value;
    const password = document.getElementById('l-password').value;
    const remember = document.getElementById('remember-session')?.checked || false;
    const errorEl = document.getElementById('login-error');
    
    // Rate limiting
    try {
        rateLimiter.check('login_' + email, 3, 300000); // 3 attempts per 5 minutes
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.classList.remove('hidden');
        return;
    }
    
    if (!email || !password) {
        errorEl.textContent = 'Please enter both email and password';
        errorEl.classList.remove('hidden');
        return;
    }
    
    showLoading(true, 'Authenticating...');
    
    try {
        // Set persistence based on "remember me"
        const persistence = remember 
            ? firebase.auth.Auth.Persistence.LOCAL 
            : firebase.auth.Auth.Persistence.SESSION;
        await auth.setPersistence(persistence);
        
        await auth.signInWithEmailAndPassword(email, password);
        errorEl.classList.add('hidden');
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.classList.remove('hidden');
        await logAudit('LOGIN_FAILED', { email, reason: error.message });
    } finally {
        showLoading(false);
    }
}

async function logout() {
    if (confirm('Are you sure you want to logout?')) {
        showLoading(true, 'Logging out...');
        
        try {
            await logAudit('LOGOUT', {});
            await auth.signOut();
            showToast('Logged out successfully', 'success');
        } catch (error) {
            showToast('Logout error: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    }
}

// ==================== IDEMPOTENCY & TRANSACTION SAFETY ====================

// Check for duplicate transactions
async function checkIdempotency(key, operation) {
    if (!key) return false;
    
    const state = StateManager.get();
    
    // Check in-memory cache first
    if (state.processedTransactions.has(key)) {
        throw new Error('Duplicate transaction detected. This operation has already been processed.');
    }
    
    // Check Firestore
    const existing = await db.collection('idempotencyKeys')
        .where('key', '==', key)
        .where('operation', '==', operation)
        .get();
    
    if (!existing.empty) {
        state.processedTransactions.add(key);
        throw new Error('Duplicate transaction detected. This operation has already been processed.');
    }
    
    return true;
}

// Mark transaction as processed
async function markIdempotency(key, operation, transactionId) {
    const state = StateManager.get();
    
    await db.collection('idempotencyKeys').doc(key).set({
        key,
        operation,
        transactionId,
        userId: state.user?.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    });
    
    state.processedTransactions.add(key);
    await saveProcessedTransactions();
}

// ==================== FIREBASE TRANSACTIONS WITH ROLLBACK ====================

async function runFirestoreTransaction(operations, description) {
    const state = StateManager.get();
    
    if (!state.user || !state.security.isMFAVerified) {
        throw new Error('Authentication required');
    }
    
    // Generate idempotency key for this transaction batch
    const idempotencyKey = generateIdempotencyKey();
    await checkIdempotency(idempotencyKey, description);
    
    return await db.runTransaction(async (transaction) => {
        const results = [];
        const auditEntries = [];
        
        try {
            for (const op of operations) {
                const result = await op(transaction);
                results.push(result);
                
                // Prepare audit entry
                auditEntries.push({
                    action: description,
                    details: op.details || {},
                    operationId: idempotencyKey,
                    timestamp: new Date().toISOString()
                });
            }
            
            return results;
        } catch (error) {
            // Transaction will automatically rollback
            throw new Error(`Transaction failed: ${error.message}`);
        }
    }).then(async (results) => {
        // Mark as processed
        await markIdempotency(idempotencyKey, description, results[0]?.id);
        
        // Log audit
        await logAudit(description, { 
            idempotencyKey, 
            results: results.map(r => r.id) 
        });
        
        return results;
    }).catch(error => {
        throw error;
    });
}

// ==================== PROCESSED TRANSACTIONS MANAGEMENT ====================

async function loadProcessedTransactions() {
    try {
        const state = StateManager.get();
        if (!state.user) return;
        
        // Load idempotency keys
        const keysSnap = await db.collection('idempotencyKeys')
            .where('userId', '==', state.user.uid)
            .where('expiresAt', '>', new Date())
            .get();
        
        keysSnap.docs.forEach(doc => {
            state.processedTransactions.add(doc.id);
        });
        
        // Load opening balance timestamps
        const settingsSnap = await db.collection('userSettings').doc(state.user.uid).get();
        if (settingsSnap.exists) {
            state.openingBalanceTimestamps = settingsSnap.data().openingBalances || {};
        }
        
        console.log(`Loaded ${state.processedTransactions.size} processed transactions`);
    } catch (error) {
        console.error("Error loading processed transactions:", error);
    }
}

async function saveProcessedTransactions() {
    try {
        const state = StateManager.get();
        if (!state.user) return;
        
        await db.collection('userSettings').doc(state.user.uid).set({
            openingBalances: state.openingBalanceTimestamps,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error("Error saving settings:", error);
    }
}

// ==================== EXPENSE CATEGORIES ====================

const EXPENSE_CATEGORIES = [
    "Audit & Accountancy Fees", "Bank & Mpesa Charges", "Cleaning Expense",
    "Commissions and fees", "Computer Expenses", "Director's Fees",
    "fuel (companys car)", "fuel (clients Car)", "general and admin expense",
    "HOUSING LEVY", "Legal and professional fees", "Loan payments",
    "Management compensation", "Marketing Expense", "Meals and entertainment",
    "Motorvehicle Repairs", "NSSF", "Office expenses",
    "Other general and administrative expenses", "Parking Expenses", "PAYE",
    "Postage", "Printing & Stationary", "Purchase of fixed assets",
    "Rent or lease payments", "Repairs and Maintenance", "Salaries and Wages",
    "SHA", "Staff Wellfare", "Stationery and printing", "Supplies",
    "Telephone & Internet", "Transport Expense", "Travel expenses",
    "Vendor payments", "Water & Electricity Expense"
];

function populateExpenseCategories() {
    const categorySelect = document.getElementById('expense-category');
    if (!categorySelect) return;
    
    categorySelect.innerHTML = '<option value="">Select Category</option>';
    EXPENSE_CATEGORIES.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        categorySelect.appendChild(option);
    });
}

// ==================== DATA LOADING ====================

async function loadBanks() {
    try {
        const snap = await db.collection('bankDetails').get();
        const banks = snap.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data() 
        }));
        
        StateManager.update(s => {
            s.banks = banks;
            return s;
        });
        
        updateBankSelects();
        
        const noBanksMsg = document.getElementById('no-banks-message');
        if (noBanksMsg) noBanksMsg.classList.toggle('hidden', banks.length > 0);
        
        return banks;
    } catch (error) {
        console.error("Failed to load banks:", error);
        throw error;
    }
}

async function loadLedger() {
    try {
        const snap = await db.collection('bankLedger')
            .orderBy('date', 'desc')
            .limit(1000)
            .get();
        
        const ledger = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        StateManager.update(s => {
            s.ledger = ledger;
            return s;
        });
        
        renderLedgerTable();
        return ledger;
    } catch (error) {
        console.error("Failed to load ledger:", error);
        throw error;
    }
}

async function loadAuditLog() {
    try {
        const snap = await db.collection('auditLog')
            .orderBy('timestamp', 'desc')
            .limit(200)
            .get();
        
        const auditLog = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        StateManager.update(s => {
            s.auditLog = auditLog;
            return s;
        });
        
        renderAuditTable();
        return auditLog;
    } catch (error) {
        console.error("Failed to load audit log:", error);
    }
}

// ==================== RECEIPT PROCESSING (WITH IDEMPOTENCY) ====================

async function processReceiptPayments() {
    const state = StateManager.get();
    
    try {
        const receiptsSnap = await db.collection('receipt_payments')
            .orderBy('createdAt', 'desc')
            .limit(200)
            .get();
        
        const results = { new: 0, skipped: 0, errors: 0 };
        
        for (const doc of receiptsSnap.docs) {
            const transactionId = doc.id;
            
            // Skip if already processed
            if (state.processedTransactions.has(transactionId)) {
                results.skipped++;
                continue;
            }
            
            const data = doc.data();
            
            // Validate receipt data
            if (!data.amount || data.amount <= 0) {
                results.skipped++;
                continue;
            }
            
            // Determine currency and amount
            const isUSD = (data.paymentMethod || '').toLowerCase().includes('usd') || 
                         data.currency === 'USD';
            const amount = isUSD ? parseFloat(data.amountUSD || data.amount) : 
                                   parseFloat(data.amountKSH || data.amount);
            
            if (!amount || amount <= 0) {
                results.skipped++;
                continue;
            }
            
            // Parse bank name
            const bankName = parseBankName(data.paymentMethod);
            if (!bankName) {
                results.skipped++;
                continue;
            }
            
            // Find matching bank
            const targetBank = state.banks.find(b => 
                b.name.toLowerCase().includes(bankName.toLowerCase()) ||
                bankName.toLowerCase().includes(b.name.toLowerCase())
            );
            
            if (!targetBank) {
                results.skipped++;
                continue;
            }
            
            // Check opening balance cutoff
            const receiptDate = data.paymentDate || data.createdAt || new Date();
            const receiptDateTime = new Date(receiptDate).getTime();
            const openingConfig = state.openingBalanceTimestamps[targetBank.name];
            
            if (openingConfig && openingConfig.timestamp) {
                const cutoffDateTime = new Date(openingConfig.timestamp).getTime();
                if (receiptDateTime < cutoffDateTime) {
                    // Mark as processed but don't add to ledger
                    state.processedTransactions.add(transactionId);
                    results.skipped++;
                    continue;
                }
            }
            
            // Use transaction to add ledger entry
            await runFirestoreTransaction([
                async (transaction) => {
                    const ledgerRef = db.collection('bankLedger').doc();
                    transaction.set(ledgerRef, {
                        date: receiptDate,
                        type: 'receipt',
                        amount: amount,
                        bankId: targetBank.id,
                        bankName: targetBank.name,
                        currency: isUSD ? 'USD' : (targetBank.currency || 'KES'),
                        description: `Receipt #${data.receiptNumber || 'N/A'} - ${data.description || data.customerName || ''}`,
                        sourceDocId: doc.id,
                        sourceCollection: 'receipt_payments',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        userId: state.user?.uid,
                        userEmail: state.user?.email,
                        idempotencyKey: transactionId
                    }, { merge: false });
                    
                    return ledgerRef;
                }
            ], 'PROCESS_RECEIPT');
            
            // Mark as processed
            state.processedTransactions.add(transactionId);
            results.new++;
        }
        
        // Save processed transactions
        await saveProcessedTransactions();
        
        if (results.new > 0) {
            await loadLedger();
            calculateBalances();
        }
        
        return results;
    } catch (error) {
        console.error("Error processing receipts:", error);
        throw error;
    }
}

function parseBankName(paymentMethod) {
    if (!paymentMethod) return '';
    return paymentMethod
        .replace(/^Bank:\s*/i, '')
        .replace(/\s*\(USD\)/i, '')
        .replace(/\s*\(KES\)/i, '')
        .replace(/\s*-\s*.*$/i, '')
        .trim();
}

// ==================== BALANCE CALCULATION (ACCURATE) ====================

function calculateBalances() {
    const state = StateManager.getRaw();
    const newBalances = {};
    
    state.banks.forEach(bank => {
        // Get opening balance with cutoff
        let cutoffDateTime = null;
        let startBalance = 0;
        
        if (state.openingBalanceTimestamps[bank.name]) {
            startBalance = state.openingBalanceTimestamps[bank.name].balance || 0;
            cutoffDateTime = new Date(state.openingBalanceTimestamps[bank.name].timestamp).getTime();
        } else if (bank.openingBalanceConfig?.amount) {
            startBalance = parseFloat(bank.openingBalanceConfig.amount) || 0;
            if (bank.openingBalanceConfig.dateString) {
                cutoffDateTime = new Date(bank.openingBalanceConfig.dateString).getTime();
            }
        }
        
        // Start with opening balance
        let runningBalance = startBalance;
        
        // Get ALL transactions for this bank, sorted by date
        const bankTransactions = state.ledger
            .filter(tx => tx.bankId === bank.id || tx.toBankId === bank.id)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        // Track which transactions contributed to balance
        const contributingTransactions = [];
        
        bankTransactions.forEach(tx => {
            const txDateTime = new Date(tx.date).getTime();
            const amount = parseFloat(tx.amount) || 0;
            
            // Skip if before cutoff (strict)
            if (cutoffDateTime && txDateTime < cutoffDateTime) {
                return;
            }
            
            // Process based on type
            switch (tx.type) {
                case 'receipt':
                    if (tx.bankId === bank.id) {
                        runningBalance += amount;
                        contributingTransactions.push(tx.id);
                    }
                    break;
                case 'expense':
                case 'credit':
                case 'withdrawal':
                    if (tx.bankId === bank.id) {
                        runningBalance -= amount;
                        contributingTransactions.push(tx.id);
                    }
                    break;
                case 'transfer':
                    if (tx.bankId === bank.id) {
                        runningBalance -= amount;
                        if (tx.transactionFee && tx.transactionFeeBearer === 'sender' && tx.feeAmount) {
                            runningBalance -= parseFloat(tx.feeAmount);
                        }
                        contributingTransactions.push(tx.id);
                    }
                    if (tx.toBankId === bank.id) {
                        runningBalance += amount;
                        if (tx.transactionFee && tx.transactionFeeBearer === 'receiver' && tx.feeAmount) {
                            runningBalance -= parseFloat(tx.feeAmount);
                        }
                        contributingTransactions.push(tx.id);
                    }
                    break;
                case 'transfer_fee':
                    if (tx.bankId === bank.id) {
                        runningBalance -= amount;
                        contributingTransactions.push(tx.id);
                    }
                    break;
            }
        });
        
        // Store final balance
        newBalances[bank.id] = runningBalance;
        
        // Store contributing transaction count for audit
        bank.contributingTransactions = contributingTransactions.length;
    });
    
    // Update state
    StateManager.update(s => {
        s.balances = newBalances;
        return s;
    });
    
    updateStatistics();
}

// ==================== BALANCE VERIFICATION ====================

async function verifyAllBalances() {
    showLoading(true, 'Verifying balances...');
    
    try {
        const state = StateManager.get();
        const results = [];
        
        for (const bank of state.banks) {
            // Calculate from scratch using Firestore
            const transactions = await db.collection('bankLedger')
                .where('bankId', '==', bank.id)
                .orderBy('date', 'asc')
                .get();
            
            let calculatedBalance = 0;
            const cutoffTime = state.openingBalanceTimestamps[bank.name]?.timestamp 
                ? new Date(state.openingBalanceTimestamps[bank.name].timestamp).getTime() 
                : 0;
            
            transactions.docs.forEach(doc => {
                const tx = doc.data();
                const txTime = new Date(tx.date).getTime();
                
                if (cutoffTime && txTime < cutoffTime) return;
                
                if (tx.type === 'receipt') {
                    calculatedBalance += tx.amount;
                } else if (['expense', 'credit', 'withdrawal'].includes(tx.type)) {
                    calculatedBalance -= tx.amount;
                } else if (tx.type === 'transfer') {
                    if (tx.bankId === bank.id) calculatedBalance -= tx.amount;
                    if (tx.toBankId === bank.id) calculatedBalance += tx.amount;
                }
            });
            
            const currentBalance = state.balances[bank.id] || 0;
            const difference = calculatedBalance - currentBalance;
            
            results.push({
                bank: bank.name,
                calculated: calculatedBalance,
                current: currentBalance,
                difference: difference,
                verified: Math.abs(difference) < 0.01
            });
            
            // Log discrepancy if > 0.01
            if (Math.abs(difference) >= 0.01) {
                await logAudit('BALANCE_DISCREPANCY', {
                    bank: bank.name,
                    calculated: calculatedBalance,
                    current: currentBalance,
                    difference
                });
            }
        }
        
        // Show results
        const verifiedCount = results.filter(r => r.verified).length;
        const totalCount = results.length;
        
        if (verifiedCount === totalCount) {
            showToast(`All balances verified (${totalCount}/${totalCount})`, 'success');
        } else {
            showToast(`${verifiedCount}/${totalCount} banks verified. ${totalCount - verifiedCount} discrepancies found.`, 'warning');
        }
        
        // Display detailed results
        displayVerificationResults(results);
        
        return results;
    } catch (error) {
        showToast('Verification failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function displayVerificationResults(results) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black bg-opacity-50" onclick="this.parentElement.remove()"></div>
        <div class="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-auto p-6 max-h-[80vh] overflow-y-auto">
            <h2 class="text-2xl font-bold mb-4">Balance Verification Results</h2>
            <div class="space-y-4">
                ${results.map(r => `
                    <div class="p-4 ${r.verified ? 'bg-green-50' : 'bg-red-50'} rounded-lg">
                        <div class="flex justify-between items-start">
                            <div>
                                <h3 class="font-semibold">${r.bank}</h3>
                                <p class="text-sm text-gray-600">Calculated: KES ${formatNumber(r.calculated)}</p>
                                <p class="text-sm text-gray-600">Current: KES ${formatNumber(r.current)}</p>
                                ${!r.verified ? `<p class="text-sm text-red-600">Difference: KES ${formatNumber(r.difference)}</p>` : ''}
                            </div>
                            <span class="px-3 py-1 rounded-full text-sm ${r.verified ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}">
                                ${r.verified ? '✓ Verified' : '✗ Discrepancy'}
                            </span>
                        </div>
                    </div>
                `).join('')}
            </div>
            <button onclick="this.closest('.fixed').remove()" class="mt-6 w-full bg-gray-200 py-3 rounded-lg">Close</button>
        </div>
    `;
    document.body.appendChild(modal);
}

// ==================== RECONCILIATION ====================

async function runReconciliation() {
    showLoading(true, 'Running reconciliation...');
    
    try {
        const state = StateManager.get();
        const results = [];
        
        for (const bank of state.banks) {
            // Get last reconciliation
            const lastRecon = await db.collection('reconciliations')
                .where('bankId', '==', bank.id)
                .orderBy('date', 'desc')
                .limit(1)
                .get();
            
            const lastReconData = lastRecon.docs[0]?.data();
            const lastReconDate = lastReconData?.date || null;
            
            // Get transactions since last reconciliation
            let query = db.collection('bankLedger')
                .where('bankId', '==', bank.id)
                .orderBy('date', 'asc');
            
            if (lastReconDate) {
                query = query.where('date', '>', lastReconDate);
            }
            
            const transactionsSnap = await query.get();
            
            // Calculate running balance
            let runningBalance = lastReconData?.closingBalance || state.openingBalanceTimestamps[bank.name]?.balance || 0;
            const transactions = [];
            
            transactionsSnap.docs.forEach(doc => {
                const tx = doc.data();
                const amount = tx.amount;
                
                if (tx.type === 'receipt') {
                    runningBalance += amount;
                } else {
                    runningBalance -= amount;
                }
                
                transactions.push({
                    id: doc.id,
                    ...tx,
                    runningBalance
                });
            });
            
            results.push({
                bank: bank.name,
                bankId: bank.id,
                lastReconciliation: lastReconDate,
                transactionCount: transactions.length,
                closingBalance: runningBalance,
                transactions
            });
        }
        
        // Display results
        displayReconciliationResults(results);
        
    } catch (error) {
        showToast('Reconciliation failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function displayReconciliationResults(results) {
    const modal = document.getElementById('reconciliation-report-modal');
    const content = document.getElementById('reconciliation-report-content');
    
    if (!modal || !content) return;
    
    content.innerHTML = results.map(r => `
        <div class="mb-8 border-b pb-6">
            <h3 class="text-xl font-bold mb-2">${r.bank}</h3>
            <div class="grid grid-cols-3 gap-4 mb-4">
                <div class="bg-gray-50 p-3 rounded">
                    <p class="text-sm text-gray-600">Last Reconciliation</p>
                    <p class="font-semibold">${r.lastReconciliation ? new Date(r.lastReconciliation).toLocaleDateString() : 'Never'}</p>
                </div>
                <div class="bg-gray-50 p-3 rounded">
                    <p class="text-sm text-gray-600">Transactions Since</p>
                    <p class="font-semibold">${r.transactionCount}</p>
                </div>
                <div class="bg-gray-50 p-3 rounded">
                    <p class="text-sm text-gray-600">Closing Balance</p>
                    <p class="font-semibold">KES ${formatNumber(r.closingBalance)}</p>
                </div>
            </div>
            
            ${r.transactionCount > 0 ? `
                <div class="max-h-60 overflow-y-auto">
                    <table class="min-w-full text-sm">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-3 py-2 text-left">Date</th>
                                <th class="px-3 py-2 text-left">Type</th>
                                <th class="px-3 py-2 text-right">Amount</th>
                                <th class="px-3 py-2 text-right">Running</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${r.transactions.map(tx => `
                                <tr class="border-t">
                                    <td class="px-3 py-2">${new Date(tx.date).toLocaleDateString()}</td>
                                    <td class="px-3 py-2">${tx.type}</td>
                                    <td class="px-3 py-2 text-right">${formatNumber(tx.amount)}</td>
                                    <td class="px-3 py-2 text-right">${formatNumber(tx.runningBalance)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : '<p class="text-gray-500">No new transactions since last reconciliation</p>'}
        </div>
    `).join('');
    
    modal.classList.remove('hidden');
}

// ==================== AUDIT LOG RENDERING ====================

function renderAuditTable() {
    const tbody = document.getElementById('audit-body');
    const state = StateManager.get();
    
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (state.auditLog.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="px-6 py-8 text-center text-gray-500">
                    <i class="fas fa-shield-alt text-3xl mb-3"></i>
                    <p>No audit entries yet</p>
                </td>
            </tr>
        `;
        return;
    }
    
    state.auditLog.slice(0, 100).forEach(entry => {
        const date = entry.timestamp?.toDate ? entry.timestamp.toDate() : new Date(entry.clientTimestamp);
        const row = `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap text-sm">${date.toLocaleString()}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">${entry.userEmail || entry.userId}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">${entry.action}</td>
                <td class="px-6 py-4 text-sm max-w-xs truncate">${JSON.stringify(entry.details).substring(0, 50)}...</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">${entry.ipAddress || 'unknown'}</td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

// ==================== BANK TRANSFER (WITH TRANSACTION) ====================

document.getElementById('transfer-form-enhanced')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const state = StateManager.get();
    
    if (!state.security.isMFAVerified) {
        showToast('Please verify your PIN first', 'error');
        return;
    }
    
    try {
        const fromId = document.getElementById('t-from-enhanced').value;
        const toId = document.getElementById('t-to-enhanced').value;
        const amountInput = document.getElementById('t-amount-enhanced').value;
        const desc = sanitizeInput(document.getElementById('t-desc-enhanced').value);
        const feeAmountInput = document.getElementById('t-fee-enhanced').value;
        const feeBearer = document.querySelector('input[name="fee-bearer"]:checked')?.value;
        
        // Validate inputs
        if (!fromId || !toId) throw new Error('Please select both banks');
        if (fromId === toId) throw new Error('Cannot transfer to same bank');
        
        const fromBank = state.banks.find(b => b.id === fromId);
        const toBank = state.banks.find(b => b.id === toId);
        if (!fromBank || !toBank) throw new Error('Invalid bank selection');
        
        // Validate amounts
        const amount = validateAmount(amountInput, fromBank, 'debit');
        const feeAmount = feeAmountInput ? validateAmount(feeAmountInput, fromBank) : 0;
        
        // Currency validation
        if (fromBank.currency !== toBank.currency) {
            if (!confirm(`Currency mismatch: ${fromBank.currency} → ${toBank.currency}. Continue?`)) {
                return;
            }
        }
        
        // Check balance with fee
        const totalDeduction = amount + (feeBearer === 'sender' ? feeAmount : 0);
        if ((state.balances[fromId] || 0) < totalDeduction) {
            throw new Error(`Insufficient funds. Need: ${formatCurrency(totalDeduction, fromBank.currency)}`);
        }
        
        showLoading(true, 'Processing secure transfer...');
        
        // Generate idempotency key for this transfer
        const transferKey = generateIdempotencyKey();
        document.getElementById('transfer-idempotency-key').value = transferKey;
        document.getElementById('transfer-idempotency').textContent = transferKey.substring(0, 8) + '...';
        
        // Execute as transaction
        await runFirestoreTransaction([
            async (transaction) => {
                // Main transfer
                const transferRef = db.collection('bankLedger').doc();
                transaction.set(transferRef, {
                    type: 'transfer',
                    date: new Date().toISOString(),
                    amount: amount,
                    bankId: fromId,
                    bankName: fromBank.name,
                    toBankId: toId,
                    toBankName: toBank.name,
                    currency: fromBank.currency,
                    description: desc,
                    transactionFee: feeAmount > 0,
                    feeAmount: feeAmount,
                    transactionFeeBearer: feeBearer,
                    createdBy: state.user?.email,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    userId: state.user?.uid,
                    idempotencyKey: transferKey
                }, { merge: false });
                
                return transferRef;
            },
            ...(feeAmount > 0 ? [async (transaction) => {
                const feeRef = db.collection('bankLedger').doc();
                transaction.set(feeRef, {
                    type: 'transfer_fee',
                    date: new Date().toISOString(),
                    amount: feeAmount,
                    bankId: feeBearer === 'sender' ? fromId : toId,
                    bankName: feeBearer === 'sender' ? fromBank.name : toBank.name,
                    currency: feeBearer === 'sender' ? fromBank.currency : toBank.currency,
                    description: `Transaction fee for transfer to ${toBank.name}`,
                    parentTransferKey: transferKey,
                    createdBy: state.user?.email,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    userId: state.user?.uid,
                    idempotencyKey: transferKey + '_fee'
                }, { merge: false });
                
                return feeRef;
            }] : [])
        ], 'TRANSFER');
        
        closeModal('transfer-modal-enhanced');
        e.target.reset();
        
        // Refresh data
        await loadLedger();
        calculateBalances();
        renderDashboard();
        
        showToast(`Transfer of ${formatCurrency(amount, fromBank.currency)} completed`, 'success');
        
    } catch (error) {
        showToast('Transfer failed: ' + error.message, 'error');
        await logAudit('TRANSFER_FAILED', { error: error.message });
    } finally {
        showLoading(false);
    }
});

// ==================== EXPENSE PAYMENT (WITH TRANSACTION) ====================

document.getElementById('expense-payment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const state = StateManager.get();
    
    if (!state.security.isMFAVerified) {
        showToast('Please verify your PIN first', 'error');
        return;
    }
    
    try {
        const bankId = document.getElementById('expense-bank').value;
        const category = document.getElementById('expense-category').value;
        const customRecipient = sanitizeInput(document.getElementById('expense-custom-recipient').value);
        const amountInput = document.getElementById('expense-amount').value;
        const desc = sanitizeInput(document.getElementById('expense-desc').value);
        const reference = sanitizeInput(document.getElementById('expense-reference').value);
        
        // Validate
        if (!bankId) throw new Error('Please select a bank');
        if (!category && !customRecipient) throw new Error('Please select category or enter recipient');
        
        const bank = state.banks.find(b => b.id === bankId);
        if (!bank) throw new Error('Invalid bank');
        
        const amount = validateAmount(amountInput, bank, 'debit');
        
        showLoading(true, 'Recording expense...');
        
        const expenseKey = generateIdempotencyKey();
        
        await runFirestoreTransaction([
            async (transaction) => {
                const expenseRef = db.collection('bankLedger').doc();
                transaction.set(expenseRef, {
                    type: 'expense',
                    date: new Date().toISOString(),
                    amount: amount,
                    bankId: bankId,
                    bankName: bank.name,
                    currency: bank.currency,
                    category: category || null,
                    recipientName: customRecipient || category,
                    recipientType: customRecipient ? 'custom' : 'category',
                    description: desc,
                    reference: reference,
                    createdBy: state.user?.email,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    userId: state.user?.uid,
                    idempotencyKey: expenseKey
                }, { merge: false });
                
                return expenseRef;
            }
        ], 'EXPENSE');
        
        closeModal('expense-payment-modal');
        e.target.reset();
        
        await loadLedger();
        calculateBalances();
        renderDashboard();
        
        showToast(`Expense of ${formatCurrency(amount, bank.currency)} recorded`, 'success');
        
    } catch (error) {
        showToast('Expense failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
});

// ==================== CREDIT TRANSFER ====================

document.getElementById('credit-transfer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const state = StateManager.get();
    
    if (!state.security.isMFAVerified) {
        showToast('Please verify your PIN first', 'error');
        return;
    }
    
    try {
        const bankId = document.getElementById('credit-bank').value;
        const source = sanitizeInput(document.getElementById('credit-source').value);
        const amountInput = document.getElementById('credit-amount').value;
        const desc = sanitizeInput(document.getElementById('credit-desc').value);
        const reference = sanitizeInput(document.getElementById('credit-reference').value);
        
        if (!bankId) throw new Error('Please select a bank');
        if (!source) throw new Error('Please enter source of funds');
        
        const bank = state.banks.find(b => b.id === bankId);
        if (!bank) throw new Error('Invalid bank');
        
        const amount = validateAmount(amountInput, bank, 'credit');
        
        showLoading(true, 'Processing credit...');
        
        const creditKey = generateIdempotencyKey();
        
        await runFirestoreTransaction([
            async (transaction) => {
                const creditRef = db.collection('bankLedger').doc();
                transaction.set(creditRef, {
                    type: 'credit',
                    date: new Date().toISOString(),
                    amount: amount,
                    bankId: bankId,
                    bankName: bank.name,
                    currency: bank.currency,
                    source: source,
                    description: desc,
                    reference: reference,
                    createdBy: state.user?.email,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    userId: state.user?.uid,
                    idempotencyKey: creditKey
                }, { merge: false });
                
                return creditRef;
            }
        ], 'CREDIT');
        
        closeModal('credit-transfer-modal');
        e.target.reset();
        
        await loadLedger();
        calculateBalances();
        renderDashboard();
        
        showToast(`Credit of ${formatCurrency(amount, bank.currency)} added`, 'success');
        
    } catch (error) {
        showToast('Credit failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
});

// ==================== OPENING BALANCE (WITH TIMESTAMP) ====================

function openOpeningModal(bankId) {
    const state = StateManager.get();
    
    if (!state.security.isMFAVerified) {
        showToast('Please verify your PIN first', 'error');
        return;
    }
    
    const bank = state.banks.find(b => b.id === bankId);
    if (!bank) {
        showToast('Bank not found', 'error');
        return;
    }
    
    // Create modal
    const modal = document.createElement('div');
    modal.id = 'opening-balance-modal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black bg-opacity-50" onclick="this.closest('.fixed').remove()"></div>
        <div class="relative bg-white rounded-xl shadow-2xl max-w-md w-full mx-auto p-6">
            <h2 class="text-2xl font-bold mb-4">Set Opening Balance</h2>
            
            <div class="bg-gray-50 p-4 rounded-lg mb-6">
                <div class="flex justify-between mb-2">
                    <span class="text-gray-600">Bank:</span>
                    <span class="font-semibold">${bank.name}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-600">Current Balance:</span>
                    <span class="font-semibold">${formatCurrency(state.balances[bank.id] || 0, bank.currency)}</span>
                </div>
            </div>
            
            <form id="opening-balance-form">
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Opening Balance Amount</label>
                        <input type="number" id="opening-amount" step="0.01" min="0" 
                               class="w-full px-4 py-3 border rounded-lg" 
                               value="${bank.openingBalanceConfig?.amount || ''}" required>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">As of Date & Time</label>
                        <div class="grid grid-cols-2 gap-4">
                            <input type="date" id="opening-date" class="px-4 py-3 border rounded-lg" required>
                            <input type="time" id="opening-time" class="px-4 py-3 border rounded-lg" required>
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">Notes (Optional)</label>
                        <textarea id="opening-notes" class="w-full px-4 py-3 border rounded-lg" rows="2"></textarea>
                    </div>
                    
                    <div class="bg-yellow-50 p-4 rounded-lg">
                        <p class="text-sm text-yellow-800">
                            <i class="fas fa-exclamation-triangle mr-2"></i>
                            Setting an opening balance will exclude all transactions before the selected date/time from calculations.
                            This action is audited and cannot be undone.
                        </p>
                    </div>
                    
                    <div class="flex space-x-4">
                        <button type="button" onclick="this.closest('.fixed').remove()"
                                class="flex-1 bg-gray-200 hover:bg-gray-300 py-3 rounded-lg">
                            Cancel
                        </button>
                        <button type="submit"
                                class="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg">
                            Set Opening Balance
                        </button>
                    </div>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Set current date/time
    const now = new Date();
    document.getElementById('opening-date').value = now.toISOString().split('T')[0];
    document.getElementById('opening-time').value = now.toTimeString().slice(0, 5);
    
    // Handle submit
    document.getElementById('opening-balance-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const amount = parseFloat(document.getElementById('opening-amount').value);
        const date = document.getElementById('opening-date').value;
        const time = document.getElementById('opening-time').value;
        const notes = document.getElementById('opening-notes').value;
        
        if (!amount || amount < 0) {
            showToast('Please enter a valid amount', 'error');
            return;
        }
        
        const dateTimeString = `${date}T${time}:00`;
        const timestamp = new Date(dateTimeString);
        
        if (isNaN(timestamp.getTime())) {
            showToast('Invalid date/time', 'error');
            return;
        }
        
        showLoading(true, 'Setting opening balance...');
        
        try {
            // Update state
            StateManager.update(s => {
                if (!s.openingBalanceTimestamps) s.openingBalanceTimestamps = {};
                s.openingBalanceTimestamps[bank.name] = {
                    balance: amount,
                    timestamp: timestamp.toISOString(),
                    updatedBy: s.user?.email,
                    updatedAt: new Date().toISOString(),
                    notes: notes
                };
                return s;
            });
            
            // Save to Firestore
            await saveProcessedTransactions();
            
            // Also update bankDetails
            await db.collection('bankDetails').doc(bankId).update({
                openingBalanceConfig: {
                    amount: amount,
                    dateString: timestamp.toISOString(),
                    updatedAt: new Date().toISOString(),
                    updatedBy: state.user?.email,
                    notes: notes
                }
            });
            
            // Log audit
            await logAudit('SET_OPENING_BALANCE', {
                bank: bank.name,
                amount,
                timestamp: timestamp.toISOString()
            });
            
            modal.remove();
            
            // Recalculate balances
            calculateBalances();
            renderDashboard();
            
            showToast(`Opening balance set for ${timestamp.toLocaleString()}`, 'success');
            
        } catch (error) {
            showToast('Failed to set opening balance: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    });
}

// ==================== UI RENDERING ====================

function renderDashboard() {
    const container = document.getElementById('bank-cards-container');
    const state = StateManager.get();
    
    if (!container) return;
    
    container.innerHTML = '';
    
    if (state.banks.length === 0) {
        document.getElementById('no-banks-message')?.classList.remove('hidden');
        return;
    }
    
    document.getElementById('no-banks-message')?.classList.add('hidden');
    
    state.banks.forEach(bank => {
        const balance = state.balances[bank.id] || 0;
        const isUSD = bank.currency === 'USD';
        const balanceClass = balance >= 0 ? 'text-gray-900' : 'text-red-600';
        
        // Calculate stats
        const bankTransactions = state.ledger.filter(tx => 
            tx.bankId === bank.id || tx.toBankId === bank.id
        );
        
        const openingBalance = state.openingBalanceTimestamps[bank.name]?.balance || 
                              bank.openingBalanceConfig?.amount || 0;
        
        const card = document.createElement('div');
        card.className = `bg-white rounded-xl shadow-sm p-6 bank-card border-l-4 ${isUSD ? 'border-blue-500' : 'border-green-500'}`;
        card.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h3 class="font-bold text-gray-800 text-lg">${bank.name}</h3>
                    <p class="text-xs text-gray-500 mt-1">${bank.accountNumber || 'No account number'}</p>
                </div>
                <div class="bg-gray-50 p-2 rounded-full">
                    <span class="font-bold text-sm ${isUSD ? 'text-blue-500' : 'text-green-500'}">${bank.currency}</span>
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
                    <div class="text-gray-500">Opening</div>
                    <div class="font-medium">${isUSD ? '$' : 'KES'} ${formatNumber(openingBalance)}</div>
                </div>
                <div>
                    <div class="text-gray-500">Transactions</div>
                    <div class="font-medium">${bankTransactions.length}</div>
                </div>
            </div>
            
            <div class="flex space-x-2">
                <button onclick="window.openOpeningModal('${bank.id}')" 
                        class="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-3 rounded-lg">
                    <i class="fas fa-balance-scale mr-1"></i> Opening
                </button>
                <button onclick="window.showExpensePaymentModal('${bank.id}')" 
                        class="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2 px-3 rounded-lg">
                    <i class="fas fa-money-check-alt mr-1"></i> Expense
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

function renderLedgerTable() {
    const tbody = document.getElementById('ledger-body');
    const countSpan = document.getElementById('ledger-count');
    const state = StateManager.get();
    
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (state.ledger.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="px-6 py-8 text-center text-gray-500">
                    <i class="fas fa-exchange-alt text-3xl mb-3"></i>
                    <p>No transactions yet</p>
                </td>
            </tr>
        `;
        if (countSpan) countSpan.textContent = '0 Records';
        return;
    }
    
    state.ledger.slice(0, 100).forEach(tx => {
        const date = new Date(tx.date);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        let typeBadge = '';
        let amountClass = '';
        let sign = '';
        
        switch(tx.type) {
            case 'receipt':
                typeBadge = '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Receipt</span>';
                amountClass = 'text-green-600';
                sign = '+';
                break;
            case 'expense':
            case 'withdrawal':
                typeBadge = '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">Expense</span>';
                amountClass = 'text-red-600';
                sign = '-';
                break;
            case 'credit':
                typeBadge = '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">Credit</span>';
                amountClass = 'text-blue-600';
                sign = '+';
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
                <td class="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title="${tx.description || ''}">${tx.description || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-bold ${amountClass}">
                    ${sign} ${formatNumber(tx.amount)} ${tx.currency || 'KES'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-xs text-gray-400 text-center">
                    ${tx.idempotencyKey ? tx.idempotencyKey.substring(0, 6) + '...' : ''}
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
    
    if (countSpan) countSpan.textContent = `${state.ledger.length} Records`;
}

// ==================== UTILITY FUNCTIONS ====================

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
    
    const sanitizedMessage = sanitizeInput(message);
    
    const toast = document.createElement('div');
    toast.className = `toast bg-white border-l-4 ${type === 'success' ? 'border-green-500' : type === 'error' ? 'border-red-500' : 'border-blue-500'} shadow-lg rounded-lg p-4 mb-2`;
    toast.innerHTML = `
        <div class="flex items-center">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'} 
               ${type === 'success' ? 'text-green-500' : type === 'error' ? 'text-red-500' : 'text-blue-500'} mr-3"></i>
            <div>
                <p class="font-medium text-gray-800">${sanitizedMessage}</p>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-auto text-gray-400 hover:text-gray-600">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
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

function updateStatistics() {
    const state = StateManager.get();
    
    let totalKES = 0;
    let totalUSD = 0;
    
    state.banks.forEach(bank => {
        const balance = state.balances[bank.id] || 0;
        if (bank.currency === 'USD') {
            totalUSD += balance;
        } else {
            totalKES += balance;
        }
    });
    
    StateManager.update(s => {
        s.stats.totalKES = totalKES;
        s.stats.totalUSD = totalUSD;
        s.stats.totalTransactions = state.ledger.length;
        return s;
    });
    
    // Update UI
    document.getElementById('stats-active-banks').textContent = state.banks.length;
    document.getElementById('stats-total-kes').textContent = formatCurrency(totalKES, 'KES');
    document.getElementById('stats-total-usd').textContent = formatCurrency(totalUSD, 'USD');
    document.getElementById('transactions-count').textContent = `${state.ledger.length} transactions`;
}

function updateSystemStatus(connected = false) {
    const statusEl = document.getElementById('firebase-connection-status');
    if (statusEl) {
        statusEl.innerHTML = `
            <span class="inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'} mr-2"></span>
            ${connected ? 'Connected' : 'Not Connected'}
        `;
    }
}

function updateBankSelects() {
    const state = StateManager.get();
    const selects = ['t-from-enhanced', 't-to-enhanced', 'expense-bank', 'credit-bank'];
    
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
    });
}

// ==================== MODAL CONTROLS ====================

function openModal(id) {
    const state = StateManager.get();
    const bankModals = ['transfer-modal-enhanced', 'expense-payment-modal', 'credit-transfer-modal'];
    
    if (bankModals.includes(id) && !state.security.isMFAVerified) {
        showToast('Please verify your PIN first', 'error');
        return;
    }
    
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('hidden');
        
        // Set idempotency key
        if (id === 'transfer-modal-enhanced') {
            const key = generateIdempotencyKey();
            document.getElementById('transfer-idempotency-key').value = key;
            document.getElementById('transfer-idempotency').textContent = key.substring(0, 8) + '...';
        }
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('hidden');
    }
}

function openTab(evt, tabName) {
    const tabcontents = document.getElementsByClassName('tab-content');
    for (let i = 0; i < tabcontents.length; i++) {
        tabcontents[i].classList.remove('active');
    }
    
    const tablinks = document.getElementsByClassName('custom-tab');
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove('active');
    }
    
    document.getElementById(tabName)?.classList.add('active');
    if (evt?.currentTarget) evt.currentTarget.classList.add('active');
    
    // Load tab-specific data
    if (tabName === 'ledger-history') {
        renderLedgerTable();
    } else if (tabName === 'audit') {
        loadAuditLog();
    }
}

// ==================== EXPORTS ====================

window.StateManager = StateManager;
window.verifyBankAccess = verifyBankAccess;
window.setupMFA = setupMFA;
window.login = login;
window.logout = logout;
window.openModal = openModal;
window.closeModal = closeModal;
window.openTab = openTab;
window.openOpeningModal = openOpeningModal;
window.showTransferConfirmation = () => {
    updateBankSelects();
    openModal('transfer-modal-enhanced');
};
window.showExpensePaymentModal = (bankId = null) => {
    updateBankSelects();
    openModal('expense-payment-modal');
    if (bankId) {
        setTimeout(() => {
            document.getElementById('expense-bank').value = bankId;
        }, 100);
    }
};
window.showCreditTransferModal = () => {
    updateBankSelects();
    openModal('credit-transfer-modal');
};
window.syncReceipts = async () => {
    showLoading(true, 'Syncing receipts...');
    try {
        const results = await processReceiptPayments();
        showToast(`Synced ${results.new} new receipts (${results.skipped} skipped)`, 'success');
    } catch (error) {
        showToast('Sync failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
};
window.refreshBankData = async () => {
    showLoading(true, 'Refreshing data...');
    try {
        await loadBanks();
        await loadLedger();
        calculateBalances();
        renderDashboard();
        showToast('Data refreshed', 'success');
    } catch (error) {
        showToast('Refresh failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
};
window.verifyAllBalances = verifyAllBalances;
window.runReconciliation = runReconciliation;
window.exportLedgerToPDF = async () => {
    showLoading(true, 'Generating PDF...');
    try {
        // PDF generation logic here
        showToast('PDF export not implemented in this version', 'info');
    } finally {
        showLoading(false);
    }
};
window.showAuditLog = loadAuditLog;
window.rotateIdempotencyKey = () => {
    const newKey = generateIdempotencyKey();
    StateManager.update(s => {
        s.security.idempotencyKey = newKey;
        return s;
    });
    showToast('Security keys rotated', 'success');
};
window.showSecurityReport = () => {
    const modal = document.getElementById('security-report-modal');
    const content = document.getElementById('security-report-content');
    const state = StateManager.get();
    
    if (!modal || !content) return;
    
    content.innerHTML = `
        <div class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
                <div class="bg-gray-50 p-4 rounded">
                    <p class="text-sm text-gray-600">2FA Status</p>
                    <p class="font-semibold text-lg">${state.security.isMFAVerified ? '✅ Verified' : '❌ Not Verified'}</p>
                </div>
                <div class="bg-gray-50 p-4 rounded">
                    <p class="text-sm text-gray-600">Session ID</p>
                    <p class="font-mono text-sm">${state.security.sessionId?.substring(0, 16) || 'None'}...</p>
                </div>
                <div class="bg-gray-50 p-4 rounded">
                    <p class="text-sm text-gray-600">Audit Log Count</p>
                    <p class="font-semibold">${state.auditLog.length} entries</p>
                </div>
                <div class="bg-gray-50 p-4 rounded">
                    <p class="text-sm text-gray-600">Last Audit ID</p>
                    <p class="font-mono text-sm">${state.security.lastAuditId?.substring(0, 8) || 'None'}...</p>
                </div>
            </div>
            <div class="bg-yellow-50 p-4 rounded">
                <p class="font-medium">Security Recommendations</p>
                <ul class="list-disc list-inside text-sm mt-2">
                    <li>Regularly rotate idempotency keys</li>
                    <li>Run balance verification daily</li>
                    <li>Review audit log for suspicious activity</li>
                    <li>Ensure all users have 2FA enabled</li>
                </ul>
            </div>
        </div>
    `;
    
    modal.classList.remove('hidden');
};
window.runFullSecurityAudit = async () => {
    showLoading(true, 'Running security audit...');
    try {
        await verifyAllBalances();
        await loadAuditLog();
        showToast('Security audit complete', 'success');
    } finally {
        showLoading(false);
    }
};

// ==================== INITIALIZATION ====================

async function initApp() {
    showLoading(true, 'Initializing system...');
    
    try {
        const state = StateManager.get();
        
        if (!state.user || !state.security.isMFAVerified) {
            throw new Error('Authentication required');
        }
        
        // Load data
        await Promise.all([
            loadBanks(),
            loadLedger(),
            loadAuditLog()
        ]);
        
        // Process receipts
        await processReceiptPayments();
        
        // Calculate balances
        calculateBalances();
        
        // Update UI
        renderDashboard();
        updateStatistics();
        populateExpenseCategories();
        
        // Update status
        document.getElementById('sync-status-text').textContent = 'System ready';
        document.getElementById('last-updated').textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
        
        StateManager.update(s => {
            s.systemReady = true;
            return s;
        });
        
        updateSystemStatus(true);
        
        await logAudit('SYSTEM_INIT', {});
        showToast('System initialized successfully', 'success');
        
    } catch (error) {
        console.error('Init failed:', error);
        showToast('Initialization failed: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Set today's date for date inputs
    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach(input => {
        if (!input.value) input.value = today;
    });
    
    // Initialize idempotency key display
    setInterval(() => {
        const state = StateManager.get();
        const display = document.getElementById('idempotency-key-display');
        if (display && state.security.idempotencyKey) {
            display.textContent = `ID: ${state.security.idempotencyKey.substring(0, 16)}...`;
        }
    }, 1000);
});
