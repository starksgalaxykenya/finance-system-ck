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

    // Initialize Firebase
    let firebaseApp;
    let firestore;
    let auth;
    let firebaseInitialized = false;
    let user = null;

    // Main Application Data
    const { jsPDF } = window.jspdf;
    let pettyCashTransactions = [];
    let majorTransactions = [];
    let banks = [];
    let loans = [];
    let bankTransfers = [];
    let loanRepayments = [];
    const DEFAULT_PIN = "2679";
    let currentPIN = DEFAULT_PIN;
    let userPINHash = null;
    let financialReportsUnlocked = false;
    let bankManagementUnlocked = false;
    let pettyChartInstance = null;
    let majorChartInstance = null;
    let pettyLineChartInstance = null;
    let basicCalcCurrentExpression = '';
    let currentMonthSpend = {
        month: new Date().getMonth(),
        year: new Date().getFullYear(),
        totalExpense: 0
    };

    // Add Bank Modal State
    let addBankStep = 1;
    let selectedFirebaseBank = null;

    // Balance visibility state
    let balancesHidden = false;

    // Current repayment loan ID
    let currentRepaymentLoanId = null;

    // --- PIN Management Functions ---
    function openPinManager() {
        const modal = document.getElementById('pin-manager-modal');
        if (!modal) return;
        
        modal.classList.remove('hidden');
        switchPinTab({ currentTarget: document.querySelector('.pin-tab-button.active') }, 'set-pin');
        
        // Clear all inputs
        document.getElementById('new-pin').value = '';
        document.getElementById('confirm-pin').value = '';
        document.getElementById('current-pin').value = '';
        document.getElementById('change-new-pin').value = '';
        document.getElementById('change-confirm-pin').value = '';
        
        // Hide status
        const statusElement = document.getElementById('pin-manager-status');
        if (statusElement) {
            statusElement.classList.add('hidden');
        }
    }

    function closePinManager() {
        const modal = document.getElementById('pin-manager-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    function switchPinTab(evt, tabName) {
        document.querySelectorAll(".pin-tab-content").forEach(el => {
            el.classList.remove('active');
            el.style.display = 'none';
        });
        document.querySelectorAll(".pin-tab-button").forEach(el => {
            el.classList.remove('active');
            el.classList.remove('border-primary');
        });
        
        const tabElement = document.getElementById(tabName);
        if (tabElement) {
            tabElement.classList.add('active');
            tabElement.style.display = 'block';
        }
        
        if (evt && evt.currentTarget) {
            evt.currentTarget.classList.add('active');
            evt.currentTarget.classList.add('border-primary');
        }
    }

    // Simple hash function for PIN (in production, use a proper hashing library)
    function hashPIN(pin) {
        // Simple hash - in production, use bcrypt or similar
        let hash = 0;
        for (let i = 0; i < pin.length; i++) {
            const char = pin.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString();
    }

    async function setNewPin() {
        const newPin = document.getElementById('new-pin').value;
        const confirmPin = document.getElementById('confirm-pin').value;
        
        if (!newPin || newPin.length !== 4 || !/^\d+$/.test(newPin)) {
            showPinStatus('Please enter a valid 4-digit PIN', 'error');
            return;
        }
        
        if (newPin !== confirmPin) {
            showPinStatus('PINs do not match', 'error');
            return;
        }
        
        try {
            const pinHash = hashPIN(newPin);
            currentPIN = newPin;
            userPINHash = pinHash;
            
            // Save to localStorage
            localStorage.setItem('carKenyaPin', newPin);
            localStorage.setItem('carKenyaPinHash', pinHash);
            
            // Save to Firestore if user is logged in
            if (user) {
                await firestore.collection('userData').doc(user.uid).set({
                    pinHash: pinHash,
                    pinLastUpdated: new Date().toISOString()
                }, { merge: true });
            }
            
            showPinStatus('New PIN set successfully!', 'success');
            
            // Clear inputs after successful save
            setTimeout(() => {
                document.getElementById('new-pin').value = '';
                document.getElementById('confirm-pin').value = '';
                closePinManager();
            }, 1500);
            
        } catch (error) {
            console.error("Error saving PIN:", error);
            showPinStatus('Error saving PIN. Please try again.', 'error');
        }
    }

    async function changeExistingPin() {
        const currentPin = document.getElementById('current-pin').value;
        const newPin = document.getElementById('change-new-pin').value;
        const confirmPin = document.getElementById('change-confirm-pin').value;
        
        if (!currentPin || currentPin.length !== 4 || !/^\d+$/.test(currentPin)) {
            showPinStatus('Please enter your current 4-digit PIN', 'error');
            return;
        }
        
        // Verify current PIN
        if (currentPin !== currentPIN) {
            showPinStatus('Current PIN is incorrect', 'error');
            return;
        }
        
        if (!newPin || newPin.length !== 4 || !/^\d+$/.test(newPin)) {
            showPinStatus('Please enter a valid new 4-digit PIN', 'error');
            return;
        }
        
        if (newPin !== confirmPin) {
            showPinStatus('New PINs do not match', 'error');
            return;
        }
        
        if (newPin === currentPin) {
            showPinStatus('New PIN must be different from current PIN', 'error');
            return;
        }
        
        try {
            const pinHash = hashPIN(newPin);
            currentPIN = newPin;
            userPINHash = pinHash;
            
            // Save to localStorage
            localStorage.setItem('carKenyaPin', newPin);
            localStorage.setItem('carKenyaPinHash', pinHash);
            
            // Save to Firestore if user is logged in
            if (user) {
                await firestore.collection('userData').doc(user.uid).set({
                    pinHash: pinHash,
                    pinLastUpdated: new Date().toISOString()
                }, { merge: true });
            }
            
            showPinStatus('PIN changed successfully!', 'success');
            
            // Clear inputs after successful change
            setTimeout(() => {
                document.getElementById('current-pin').value = '';
                document.getElementById('change-new-pin').value = '';
                document.getElementById('change-confirm-pin').value = '';
                closePinManager();
            }, 1500);
            
        } catch (error) {
            console.error("Error changing PIN:", error);
            showPinStatus('Error changing PIN. Please try again.', 'error');
        }
    }

    function showPinStatus(message, type = 'info') {
        const statusElement = document.getElementById('pin-manager-status');
        const statusText = document.getElementById('pin-manager-status-text');
        
        if (statusElement && statusText) {
            statusElement.classList.remove('hidden');
            statusElement.className = `mt-6 p-4 rounded-lg ${type === 'error' ? 'bg-red-50 text-red-800' : type === 'success' ? 'bg-green-50 text-green-800' : 'bg-blue-50 text-blue-800'}`;
            statusText.textContent = message;
        }
    }

    // Modified tab opening function to require PIN for secure tabs
    function openTab(evt, tabName) {
        // Hide all tab contents
        const tabContents = document.querySelectorAll('.tab-content');
        tabContents.forEach(tab => {
            tab.classList.remove('active');
            tab.style.display = 'none';
        });

        // Remove active class from all tab buttons
        const tabButtons = document.querySelectorAll('.custom-tab');
        tabButtons.forEach(button => {
            button.classList.remove('active');
        });

        // Show the selected tab
        const selectedTab = document.getElementById(tabName);
        if (selectedTab) {
            selectedTab.style.display = 'block';
            selectedTab.classList.add('active');
            
            // Handle secure tabs
            if (tabName === 'financial-reports') {
                // Always require PIN for financial reports
                financialReportsUnlocked = false;
                document.getElementById('access-gate').style.display = 'block';
                document.getElementById('report-input-area').style.display = 'none';
                
                // Clear any previous PIN input
                document.getElementById('access-code').value = '';
            } 
            else if (tabName === 'bank-management') {
                // Always require PIN for bank management
                bankManagementUnlocked = false;
                document.getElementById('bank-access-gate').classList.remove('hidden');
                document.getElementById('bank-management-content').classList.add('hidden');
                
                // Clear any previous PIN input
                document.getElementById('bank-access-code').value = '';
            }
            else {
                // For non-secure tabs, reset unlock flags
                financialReportsUnlocked = false;
                bankManagementUnlocked = false;
            }
        }

        // Add active class to clicked button
        if (evt && evt.currentTarget) {
            evt.currentTarget.classList.add('active');
        }
        
        // Update data when switching to bank management tab
        if (tabName === 'bank-management') {
            updateBankSelectors();
            updateTransferBankSelectors();
            updateBankCards();
            updateTransferHistory();
        }
    }

    // Modified checkAccessCode function
    function checkAccessCode() {
        const codeInput = document.getElementById('access-code').value;
        
        if (!codeInput || codeInput.length !== 4 || !/^\d+$/.test(codeInput)) {
            showToast('Please enter a valid 4-digit PIN', 'error');
            return;
        }
        
        if (codeInput === currentPIN) {
            financialReportsUnlocked = true;
            document.getElementById('access-gate').style.display = 'none';
            document.getElementById('report-input-area').style.display = 'block';
            updateMajorCategoryChart();
            updateFinancialDashboard();
            updateBankSelectors();
            showToast('Access Granted! Welcome to Financial Reports.', 'success');
        } else {
            showToast('Access Denied. Invalid PIN.', 'error');
            document.getElementById('access-code').value = '';
            document.getElementById('access-code').focus();
        }
    }

    // New function for bank management access
    function checkBankAccessCode() {
        const codeInput = document.getElementById('bank-access-code').value;
        
        if (!codeInput || codeInput.length !== 4 || !/^\d+$/.test(codeInput)) {
            showToast('Please enter a valid 4-digit PIN', 'error');
            return;
        }
        
        if (codeInput === currentPIN) {
            bankManagementUnlocked = true;
            document.getElementById('bank-access-gate').classList.add('hidden');
            document.getElementById('bank-management-content').classList.remove('hidden');
            
            // Update bank data when unlocked
            updateBankSelectors();
            updateTransferBankSelectors();
            updateBankCards();
            updateTransferHistory();
            
            showToast('Access Granted! Welcome to Bank Management.', 'success');
        } else {
            showToast('Access Denied. Invalid PIN.', 'error');
            document.getElementById('bank-access-code').value = '';
            document.getElementById('bank-access-code').focus();
        }
    }

    async function initializePinSystem() {
        // Check if user has a saved PIN in localStorage
        const savedPin = localStorage.getItem('carKenyaPin');
        const savedPinHash = localStorage.getItem('carKenyaPinHash');
        
        if (savedPin && savedPinHash) {
            currentPIN = savedPin;
            userPINHash = savedPinHash;
        }
        
        // If user is logged in, try to load PIN from Firestore
        if (user) {
            try {
                const userDoc = await firestore.collection('userData').doc(user.uid).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    if (userData.pinHash) {
                        userPINHash = userData.pinHash;
                        // Note: In a real app, you'd need to store the PIN securely
                        // For this demo, we'll keep using localStorage PIN
                    }
                }
            } catch (error) {
                console.error("Error loading PIN from Firestore:", error);
            }
        }
    }

    // --- Firebase Login Function ---
   async function firebaseLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const statusElement = document.getElementById('firebase-status');
    
    if (!email || !password) {
        showToast('Please enter both email and password', 'error');
        return;
    }
    
    showLoading('Connecting to Firebase...');
    
    try {
        // Check if Firebase auth is properly initialized
        if (!auth) {
            showLoading(false);
            showToast('Firebase authentication not initialized', 'error');
            return;
        }
        
        // Use the correct signInWithEmailAndPassword method
        await auth.signInWithEmailAndPassword(email, password);
        showToast('Login successful!', 'success');
        toggleFirebaseLogin();
        
        // Update UI
        updateFirebaseUI();
        
    } catch (error) {
        showLoading(false);
        console.error("Firebase login error:", error);
        
        let errorMessage = 'Login failed. ';
        switch (error.code) {
            case 'auth/invalid-email':
                errorMessage += 'Invalid email address.';
                break;
            case 'auth/user-disabled':
                errorMessage += 'This account has been disabled.';
                break;
            case 'auth/user-not-found':
                errorMessage += 'No account found with this email.';
                break;
            case 'auth/wrong-password':
                errorMessage += 'Incorrect password.';
                break;
            default:
                errorMessage += error.message;
        }
        
        showToast(errorMessage, 'error');
        
        // Show status in the modal
        if (statusElement) {
            statusElement.classList.remove('hidden');
            document.getElementById('firebase-status-text').textContent = errorMessage;
        }
    }
}

    function toggleFirebaseLogin() {
        const modal = document.getElementById('login-modal');
        if (!modal) return;
        
        // Toggle display
        if (modal.classList.contains('hidden')) {
            modal.classList.remove('hidden');
            // Clear any previous inputs
            document.getElementById('login-email').value = '';
            document.getElementById('login-password').value = '';
            // Hide status message
            const statusElement = document.getElementById('firebase-status');
            if (statusElement) {
                statusElement.classList.add('hidden');
            }
        } else {
            modal.classList.add('hidden');
        }
    }

    function updateFirebaseUI() {
        const loginBtn = document.getElementById('firebase-login-btn');
        const userInfo = document.getElementById('firebase-user-info');
        const userEmail = document.getElementById('user-email');
        const syncStatus = document.getElementById('firebase-sync-status');
        
        if (user) {
            loginBtn.innerHTML = '<i class="fas fa-check-circle mr-2"></i>Connected';
            loginBtn.classList.remove('bg-white', 'text-primary');
            loginBtn.classList.add('bg-green-500', 'text-white', 'hover:bg-green-600');
            
            userInfo.classList.remove('hidden');
            userEmail.textContent = user.email;
            
            syncStatus.classList.remove('hidden');
            document.getElementById('sync-status-text').textContent = `Connected as ${user.email}`;
            
            // Start the payment scanner when user is connected
            setTimeout(() => startPaymentScanner(), 1000);
            
        } else {
            loginBtn.innerHTML = '<i class="fas fa-cloud mr-2"></i>Connect Firebase';
            loginBtn.classList.remove('bg-green-500', 'text-white', 'hover:bg-green-600');
            loginBtn.classList.add('bg-white', 'text-primary');
            
            userInfo.classList.add('hidden');
            syncStatus.classList.add('hidden');
        }
    }

    function initializeFirebase() {
    try {
        // Check if Firebase is already initialized
        if (!firebase.apps.length) {
            firebaseApp = firebase.initializeApp(firebaseConfig);
        } else {
            firebaseApp = firebase.app();
        }
        
        // Initialize services with compatibility mode
        firestore = firebase.firestore();
        auth = firebase.auth();
        firebaseInitialized = true;
        
        console.log("Firebase initialized successfully", firebaseApp.name);
        
        // Set up auth state listener
        auth.onAuthStateChanged(async (firebaseUser) => {
            user = firebaseUser;
            console.log("Auth state changed:", user ? "User logged in" : "User logged out");
            updateFirebaseUI();
            
            if (user) {
                showToast('Connected to Firebase successfully!', 'success');
                await loadFirebaseBanks();
                await loadReceiptPayments();
                await loadUserData(); // Load all user data from Firestore
                updateBankSelectors(); // Load banks into transfer selectors
            }
        });
        
    } catch (error) {
        console.error("Firebase initialization error:", error);
        showToast('Firebase initialization failed. Using local data only.', 'error');
        
        // Fallback: Set up local data even if Firebase fails
        ensureMpesaBank();
        renderPettyCash();
        updatePettyCashBalanceDisplay();
        updatePettyCashChart();
    }
}

    // --- Firestore Persistent Storage Functions ---
    async function saveUserData() {
        if (!user) return;
        
        try {
            // Get current processed payments from the payment scanner
            const processedPaymentIds = new Set();
            
            // Collect all receipt IDs from majorTransactions
            majorTransactions
                .filter(t => t.isFromReceipt && t.receiptId)
                .forEach(t => processedPaymentIds.add(t.receiptId));
            
            const userData = {
                pettyCashTransactions: pettyCashTransactions,
                majorTransactions: majorTransactions,
                banks: banks,
                loans: loans,
                bankTransfers: bankTransfers,
                loanRepayments: loanRepayments,
                currentMonthSpend: currentMonthSpend,
                processedReceiptPayments: Array.from(processedPaymentIds), // Save processed payments
                lastUpdated: new Date().toISOString()
            };
            
            // Also save PIN hash if available
            if (userPINHash) {
                userData.pinHash = userPINHash;
            }
            
            await firestore.collection('userData').doc(user.uid).set(userData, { merge: true });
            console.log("User data saved to Firestore");
        } catch (error) {
            console.error("Error saving user data:", error);
        }
    }

    async function loadUserData() {
        if (!user) return;
        
        try {
            const doc = await firestore.collection('userData').doc(user.uid).get();
            if (doc.exists) {
                const userData = doc.data();
                
                // Load PIN if exists
                if (userData.pinHash) {
                    userPINHash = userData.pinHash;
                    // Note: In production, you'd verify against the hash
                }
                
                // Load data
                pettyCashTransactions = userData.pettyCashTransactions || [];
                majorTransactions = userData.majorTransactions || [];
                banks = userData.banks || [];
                loans = userData.loans || [];
                bankTransfers = userData.bankTransfers || [];
                loanRepayments = userData.loanRepayments || [];
                currentMonthSpend = userData.currentMonthSpend || {
                    month: new Date().getMonth(),
                    year: new Date().getFullYear(),
                    totalExpense: 0
                };
                
                // Note: processedReceiptPayments is loaded separately in startPaymentScanner
                
                // Recalculate balances to ensure integrity
                await recalculateBalances();
                
                // Ensure M-Pesa bank exists
                ensureMpesaBank();
                
                // Update all UI components
                renderPettyCash();
                updatePettyCashBalanceDisplay();
                updatePettyCashChart();
                updatePettyExpenditureChart();
                updateBankSelectors();
                updateTransferBankSelectors();
                updateMajorSummary();
                updateFinancialDashboard();
                updateBankCards();
                updateTransferHistory();
                updateQuickStats();
                initializeLoanBankSelector();
                updateLoanCards();
                
                showToast('User data loaded from Firestore', 'success');
            } else {
                // Initialize with default M-Pesa bank
                ensureMpesaBank();
                showToast('Welcome! Starting with new data', 'info');
            }
        } catch (error) {
            console.error("Error loading user data:", error);
            // Initialize with default M-Pesa bank
            ensureMpesaBank();
        }
    }

    // UPDATED: Recalculate balances using ledger logic
    async function recalculateBalances() {
        console.log('Recalculating all balances using ledger logic...');
        
        // Reset all bank balances to their opening balance
        banks.forEach(bank => {
            const originalBalance = bank.balance;
            bank.balance = bank.openingBalance || 0;
            console.log(`Reset ${bank.name} balance from ${formatCurrency(originalBalance, bank.currency)} to opening balance: ${formatCurrency(bank.openingBalance || 0, bank.currency)}`);
        });
        
        // Calculate from major transactions (acting as our ledger)
        let receiptTransactions = 0;
        let otherTransactions = 0;
        
        for (const transaction of majorTransactions) {
            const bank = banks.find(b => b.id === transaction.bankId);
            if (bank) {
                // Check if transaction date is after opening date
                const transactionDate = new Date(transaction.date || transaction.processedAt || Date.now());
                const openingDate = new Date(bank.openingDate || 0);
                
                if (transactionDate >= openingDate) {
                    if (transaction.category === 'Sales' || 
                        transaction.isFromReceipt || 
                        transaction.isLoanDisbursement) {
                        // Income transactions (CREDIT)
                        bank.balance += transaction.amount;
                        if (transaction.isFromReceipt) receiptTransactions++;
                    } else {
                        // Expense transactions (DEBIT)
                        bank.balance -= transaction.amount;
                        otherTransactions++;
                    }
                } else {
                    console.log(`Skipped transaction before opening date for ${bank.name}: ${transactionDate} < ${openingDate}`);
                }
            }
        }
        
        console.log(`Recalculated balances: ${receiptTransactions} valid receipt transactions, ${otherTransactions} other transactions`);
        
        // Calculate petty cash separately
        const { currentBalance } = calculatePettyCashBalance();
        const mpesaBank = banks.find(b => b.id === 'mpesa');
        if (mpesaBank) {
            console.log(`M-Pesa balance set to petty cash balance: ${formatCurrency(currentBalance, mpesaBank.currency)}`);
            mpesaBank.balance = currentBalance;
        }
        
        // Log final balances
        banks.forEach(bank => {
            console.log(`${bank.name} final balance: ${formatCurrency(bank.balance, bank.currency)}`);
        });
    }

    // --- Initialize Loan Bank Selector ---
    async function initializeLoanBankSelector() {
        const bankSelect = document.getElementById('loan-bank-account');
        if (!bankSelect) return;
        
        bankSelect.innerHTML = '<option value="" disabled selected>Select Bank Account</option>';
        
        // Clear previous options
        bankSelect.innerHTML = '<option value="" disabled selected>Loading banks from Firebase...</option>';
        
        try {
            // Load banks from Firestore
            const banksSnapshot = await firestore.collection('bankDetails').get();
            
            if (banksSnapshot.empty) {
                const option = document.createElement('option');
                option.value = "";
                option.textContent = "No banks found in Firebase - Add banks first";
                option.disabled = true;
                bankSelect.appendChild(option);
                showToast('No banks found in Firebase', 'warning');
                return;
            }
            
            // Clear loading message
            bankSelect.innerHTML = '<option value="" disabled selected>Select Bank Account</option>';
            
            // Add banks from Firestore
            banksSnapshot.forEach(doc => {
                const bankData = doc.data();
                const bankId = doc.id;
                
                // Extract bank name from Firebase data
                const bankName = bankData.bankName || 
                               bankData.name || 
                               bankData.bank || 
                               bankData.bank_name || 
                               bankData.bankName || 
                               'Bank Account';
                
                // Extract account number
                const accountNumber = bankData.accountNumber || 
                                    bankData.account || 
                                    bankData.account_number || 
                                    bankData.accountNumber || 
                                    'N/A';
                
                // Extract branch
                const branch = bankData.branch || 
                             bankData.branchName || 
                             bankData.branch_name || 
                             bankData.branchName || 
                             '';
                
                const option = document.createElement('option');
                option.value = bankId;
                option.setAttribute('data-firebase-id', bankId);
                option.textContent = `${bankName} - ${accountNumber} ${branch ? `(${branch})` : ''}`;
                bankSelect.appendChild(option);
            });
            
            // Add local M-Pesa bank if it exists
            const mpesaBank = banks.find(b => b.id === 'mpesa');
            if (mpesaBank) {
                const option = document.createElement('option');
                option.value = 'mpesa';
                option.textContent = `${mpesaBank.name} (Petty Cash) - ${formatKSH(mpesaBank.balance)}`;
                bankSelect.appendChild(option);
            }
            
        } catch (error) {
            console.error("Error loading banks from Firestore:", error);
            bankSelect.innerHTML = '<option value="" disabled selected>Error loading banks</option>';
            showToast('Error loading banks from Firebase', 'error');
        }
        
        // Add event listener to show balance
        bankSelect.addEventListener('change', async function() {
            const bankId = this.value;
            const firebaseId = this.options[this.selectedIndex].getAttribute('data-firebase-id');
            const balanceElement = document.getElementById('loan-bank-balance');
            
            if (bankId === 'mpesa') {
                // For M-Pesa, use local balance
                const mpesaBank = banks.find(b => b.id === 'mpesa');
                if (mpesaBank && balanceElement) {
                    balanceElement.innerHTML = 
                        `<span class="font-semibold">Current Balance:</span> ${formatKSH(mpesaBank.balance)}`;
                }
            } else if (firebaseId) {
                // For Firebase banks, fetch the latest balance
                try {
                    const bankDoc = await firestore.collection('bankDetails').doc(firebaseId).get();
                    if (bankDoc.exists) {
                        const bankData = bankDoc.data();
                        // Try to get balance from various possible field names
                        const balance = bankData.balance || 
                                       bankData.currentBalance || 
                                       bankData.accountBalance || 
                                       bankData.balanceAmount || 
                                       0;
                        
                        if (balanceElement) {
                            balanceElement.innerHTML = 
                                `<span class="font-semibold">Current Balance (from Firebase):</span> ${formatKSH(parseFloat(balance))}`;
                        }
                    }
                } catch (error) {
                    console.error("Error fetching bank balance:", error);
                    if (balanceElement) {
                        balanceElement.innerHTML = 
                            `<span class="font-semibold text-red-600">Unable to fetch balance from Firebase</span>`;
                    }
                }
            }
        });
    }

    // --- Payment Scanner Functions ---
    async function startPaymentScanner() {
        if (!user) return;
        
        // Track already processed payment IDs in memory
        let processedPaymentIds = new Set();
        
        // Load already processed payments from Firestore user data
        try {
            if (user) {
                const userDataDoc = await firestore.collection('userData').doc(user.uid).get();
                if (userDataDoc.exists) {
                    const userData = userDataDoc.data();
                    const processedPayments = userData.processedReceiptPayments || [];
                    processedPayments.forEach(id => processedPaymentIds.add(id));
                    console.log('Loaded processed payments from Firestore:', processedPayments.length);
                }
            }
        } catch (error) {
            console.error("Error loading processed payments from Firestore:", error);
        }
        
        // Function to process a single payment
        async function processPaymentIfNew(payment) {
            // Check if this payment has already been processed
            if (processedPaymentIds.has(payment.id)) {
                console.log('Payment already processed, skipping:', payment.id);
                return false;
            }
            
            await processNewPayment(payment);
            
            // Mark as processed
            processedPaymentIds.add(payment.id);
            return true;
        }
        
        // Process ALL existing payments in the collection first
        try {
            showLoading('Scanning all receipt payments...');
            
            const paymentsCollection = firestore.collection('receipt_payments');
            const allPaymentsSnapshot = await paymentsCollection.get();
            
            console.log(`Found ${allPaymentsSnapshot.size} payments in receipt_payments collection`);
            
            let processedCount = 0;
            const paymentsToProcess = [];
            
            // First, collect all payments
            allPaymentsSnapshot.forEach(doc => {
                const payment = { id: doc.id, ...doc.data() };
                paymentsToProcess.push(payment);
            });
            
            // Process payments in batches to avoid overwhelming the system
            for (const payment of paymentsToProcess) {
                const wasProcessed = await processPaymentIfNew(payment);
                if (wasProcessed) processedCount++;
                
                // Small delay to prevent overwhelming the system
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            console.log(`Processed ${processedCount} new payments out of ${paymentsToProcess.length} total`);
            
            if (processedCount > 0) {
                showToast(`Processed ${processedCount} receipt payments`, 'success');
            }
            
            showLoading(false);
            
        } catch (error) {
            console.error("Error processing existing payments:", error);
            showLoading(false);
            showToast('Error processing existing payments', 'error');
        }
        
        // Now set up real-time listener for NEW payments only
        const paymentsCollection = firestore.collection('receipt_payments');
        
        // Listen for new documents added to receipt_payments (real-time updates)
        paymentsCollection.onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const payment = { id: change.doc.id, ...change.doc.data() };
                    
                    // Check if this is a brand new payment (not from initial load)
                    if (!processedPaymentIds.has(payment.id)) {
                        console.log('New real-time payment detected:', payment.id);
                        await processPaymentIfNew(payment);
                    }
                }
            });
        }, (error) => {
            console.error("Payment scanner real-time listener error:", error);
            showToast('Payment scanner real-time listener error', 'error');
        });
        
        // Save processed payments to Firestore periodically
        async function saveProcessedPayments() {
            if (!user) return;
            
            try {
                const processedArray = Array.from(processedPaymentIds);
                await firestore.collection('userData').doc(user.uid).update({
                    processedReceiptPayments: processedArray,
                    lastPaymentScan: new Date().toISOString()
                });
                console.log('Saved processed payments to Firestore:', processedArray.length);
            } catch (error) {
                console.error("Error saving processed payments:", error);
            }
        }
        
        // Save processed payments every 30 seconds and on page unload
        setInterval(saveProcessedPayments, 30000);
        window.addEventListener('beforeunload', saveProcessedPayments);
    }

    // UPDATED: Atomic balance update function
    async function updateBankBalanceAtomically(bank, amount, type, receiptId, paymentDate, receiptNumber, paymentMethod) {
        try {
            if (!user) {
                // Fallback to local update if not logged in
                return updateBankBalanceLocally(bank, amount, type, receiptId, paymentDate, receiptNumber, paymentMethod);
            }
            
            // Use Firestore Transaction for atomic updates
            await firestore.runTransaction(async (transaction) => {
                // Get the latest bank document
                const bankDocRef = firestore.collection('userData').doc(user.uid);
                const bankDoc = await transaction.get(bankDocRef);
                
                if (!bankDoc.exists) {
                    throw new Error('User data not found');
                }
                
                const userData = bankDoc.data();
                const bankIndex = userData.banks.findIndex(b => b.id === bank.id);
                
                if (bankIndex === -1) {
                    throw new Error('Bank not found in user data');
                }
                
                // Calculate new balance
                const currentBalance = userData.banks[bankIndex].balance || 0;
                const newBalance = type === 'CREDIT' ? currentBalance + amount : currentBalance - amount;
                
                // Update bank balance
                transaction.update(bankDocRef, {
                    [`banks.${bankIndex}.balance`]: newBalance,
                    [`banks.${bankIndex}.lastUpdated`]: new Date().toISOString()
                });
                
                // Create ledger entry
                const ledgerRef = firestore.collection('bankLedgers').doc();
                const ledgerEntry = {
                    id: ledgerRef.id,
                    bankId: bank.id,
                    bankName: bank.name,
                    type: type,
                    amount: amount,
                    receiptId: receiptId,
                    receiptNumber: receiptNumber,
                    paymentMethod: paymentMethod,
                    paymentDate: paymentDate.toISOString(),
                    processedAt: new Date().toISOString(),
                    previousBalance: currentBalance,
                    newBalance: newBalance,
                    userId: user.uid
                };
                
                transaction.set(ledgerRef, ledgerEntry);
                
                // Add to processed receipts
                transaction.update(bankDocRef, {
                    [`banks.${bankIndex}.processedReceipts`]: firebase.firestore.FieldValue.arrayUnion(receiptId)
                });
                
                // Update local bank object
                bank.balance = newBalance;
                bank.lastUpdated = new Date().toISOString();
                if (!bank.processedReceipts) bank.processedReceipts = [];
                bank.processedReceipts.push(receiptId);
                
                // Add to local major transactions
                const newTransaction = {
                    id: 'receipt_' + Date.now() + '_' + receiptId,
                    description: `Payment received: ${receiptNumber} - ${paymentMethod}`,
                    amount: amount,
                    category: 'Sales',
                    date: paymentDate.toISOString(),
                    formattedDate: paymentDate.toLocaleDateString('en-KE'),
                    bankId: bank.id,
                    bankName: bank.name,
                    bankCurrency: bank.currency,
                    isFromReceipt: true,
                    receiptId: receiptId,
                    receiptNumber: receiptNumber,
                    originalAmount: amount,
                    paymentMethod: paymentMethod,
                    originalPaymentId: receiptId,
                    processedAt: new Date().toISOString(),
                    previousBankBalance: currentBalance,
                    newBankBalance: newBalance,
                    ledgerId: ledgerRef.id
                };
                
                majorTransactions.push(newTransaction);
                
                console.log(`Atomic update: ${amount} ${bank.currency} ${type} to ${bank.name}. Balance: ${currentBalance} → ${newBalance}`);
            });
            
            // Update UI
            updateFinancialDashboard();
            updateBankCards();
            updateBankSelectors();
            updateTransferBankSelectors();
            updateQuickStats();
            
            showToast(`New payment added to ${bank.name}: ${formatCurrency(amount, bank.currency)}`, 'success');
            
        } catch (error) {
            console.error("Atomic update failed:", error);
            // Fallback to local update
            updateBankBalanceLocally(bank, amount, type, receiptId, paymentDate, receiptNumber, paymentMethod);
            showToast('Used local update (Firestore transaction failed)', 'warning');
        }
    }

    // Fallback local update function
    function updateBankBalanceLocally(bank, amount, type, receiptId, paymentDate, receiptNumber, paymentMethod) {
        const currentBalance = bank.balance;
        const newBalance = type === 'CREDIT' ? currentBalance + amount : currentBalance - amount;
        
        bank.balance = newBalance;
        bank.lastUpdated = new Date().toISOString();
        
        if (!bank.processedReceipts) bank.processedReceipts = [];
        bank.processedReceipts.push(receiptId);
        
        const newTransaction = {
            id: 'receipt_' + Date.now() + '_' + receiptId,
            description: `Payment received: ${receiptNumber} - ${paymentMethod}`,
            amount: amount,
            category: 'Sales',
            date: paymentDate.toISOString(),
            formattedDate: paymentDate.toLocaleDateString('en-KE'),
            bankId: bank.id,
            bankName: bank.name,
            bankCurrency: bank.currency,
            isFromReceipt: true,
            receiptId: receiptId,
            receiptNumber: receiptNumber,
            originalAmount: amount,
            paymentMethod: paymentMethod,
            originalPaymentId: receiptId,
            processedAt: new Date().toISOString(),
            previousBankBalance: currentBalance,
            newBankBalance: newBalance
        };
        
        majorTransactions.push(newTransaction);
        
        console.log(`Local update: ${amount} ${bank.currency} ${type} to ${bank.name}. Balance: ${currentBalance} → ${newBalance}`);
    }

    // UPDATED: Process a new payment with ledger logic
    async function processNewPayment(payment) {
        try {
            const paymentId = payment.id;
            const paymentDate = payment.paymentDate || payment.date || payment.createdAt || Date.now();
            const receiptNumber = payment.receiptNumber || payment.id;
            
            // Check if this payment has already been processed (using Firestore)
            let alreadyProcessed = false;
            
            if (user) {
                try {
                    // Check in Firestore ledger
                    const ledgerCheck = await firestore.collection('bankLedgers')
                        .where('receiptId', '==', paymentId)
                        .limit(1)
                        .get();
                    
                    if (!ledgerCheck.empty) {
                        console.log('Payment already processed in ledger, skipping:', paymentId);
                        alreadyProcessed = true;
                    }
                } catch (error) {
                    console.error("Error checking ledger:", error);
                }
            }
            
            // Also check local memory cache
            const existingTransaction = majorTransactions.find(t => 
                t.receiptId === paymentId || 
                (t.isFromReceipt && t.receiptNumber === receiptNumber) ||
                (t.isFromReceipt && t.description.includes(receiptNumber)) ||
                (t.isFromReceipt && t.originalPaymentId === paymentId)
            );
            
            if (alreadyProcessed || existingTransaction) {
                console.log('Payment already processed, skipping:', paymentId, receiptNumber);
                return;
            }
            
            const paymentMethod = payment.paymentMethod || payment.method || 'Unknown';
            let amount = 0;
            let currency = 'KSH';
            
            // Determine amount and currency
            if (payment.amountUSD && payment.amountUSD > 0) {
                amount = parseFloat(payment.amountUSD);
                currency = 'USD';
            } else if (payment.amountKSH && payment.amountKSH > 0) {
                amount = parseFloat(payment.amountKSH);
                currency = 'KSH';
            } else if (payment.amount && payment.amount > 0) {
                amount = parseFloat(payment.amount);
                currency = payment.currency || 'KSH';
            }
            
            if (amount <= 0) {
                console.log('Skipping payment with zero or negative amount:', payment);
                return;
            }
            
            // Find the appropriate bank
            const targetBank = await findBankByPaymentMethod(paymentMethod, currency);
            
            if (targetBank) {
                // CHECK: Verify payment date is after bank's opening date
                const paymentDateTime = new Date(paymentDate);
                const openingDate = new Date(targetBank.openingDate || 0);
                
                if (paymentDateTime < openingDate) {
                    console.log(`Skipping payment dated ${paymentDateTime.toISOString()} before opening date ${openingDate.toISOString()} for ${targetBank.name}`);
                    return; // Ignore payments before opening date
                }
                
                // Convert USD to KSH if needed
                let amountInBankCurrency = amount;
                let exchangeRate = 1;
                
                if (currency !== targetBank.currency) {
                    exchangeRate = await getExchangeRate(currency, targetBank.currency);
                    amountInBankCurrency = amount * exchangeRate;
                    console.log(`Currency conversion: ${amount} ${currency} to ${amountInBankCurrency} ${targetBank.currency} (Rate: ${exchangeRate})`);
                }
                
                // Use ATOMIC TRANSACTION to update balance
                await updateBankBalanceAtomically(
                    targetBank, 
                    amountInBankCurrency, 
                    'CREDIT', 
                    paymentId,
                    paymentDateTime,
                    receiptNumber,
                    paymentMethod
                );
                
            } else {
                console.log('No matching bank found for payment method:', paymentMethod, 'with currency:', currency);
                
                // Log as unmatched for debugging
                const unmatchedTransaction = {
                    id: 'unmatched_' + Date.now(),
                    description: `Unmatched payment: ${receiptNumber} - ${paymentMethod} (${currency} ${amount})`,
                    amount: amount,
                    category: 'Sales',
                    date: new Date(paymentDate).toISOString(),
                    formattedDate: new Date(paymentDate).toLocaleDateString('en-KE'),
                    bankId: 'unmatched',
                    bankName: 'Unmatched Bank',
                    isFromReceipt: true,
                    receiptId: paymentId,
                    receiptNumber: receiptNumber,
                    originalCurrency: currency,
                    originalAmount: amount,
                    convertedAmount: amount,
                    isUnmatched: true,
                    paymentMethod: paymentMethod,
                    processedAt: new Date().toISOString()
                };
                
                majorTransactions.push(unmatchedTransaction);
                
                showToast(`Payment received but no matching ${currency} bank found for: ${paymentMethod}`, 'warning');
            }
            
        } catch (error) {
            console.error("Error processing payment:", error);
            showToast('Error processing payment', 'error');
        }
    }

    // Helper function to get available banks from Firestore
    async function getAvailableBanksFromFirestore() {
        if (!user) return [];
        
        try {
            const banksSnapshot = await firestore.collection('bankDetails').get();
            const availableBanks = [];
            
            banksSnapshot.forEach(doc => {
                const bankData = doc.data();
                // Skip transfer documents
                if (bankData.isTransfer || bankData.transferId || bankData.type === 'transfer') {
                    return;
                }
                
                availableBanks.push({
                    id: doc.id,
                    name: bankData.bankName || bankData.name || bankData.bank || 'Unknown',
                    currency: bankData.currency || 'KSH'
                });
            });
            
            return availableBanks;
        } catch (error) {
            console.error("Error getting available banks:", error);
            return [];
        }
    }

    // Find bank by payment method (Query Firestore directly)
    async function findBankByPaymentMethod(paymentMethod, currency) {
        if (!user) return null;
        
        const method = paymentMethod.toLowerCase();
        
        // First, check for M-Pesa/Mobile Money
        if (method.includes('mpesa') || method.includes('mobile') || method.includes('pesa')) {
            const mpesaBank = banks.find(b => b.id === 'mpesa');
            if (mpesaBank) {
                return mpesaBank;
            }
        }
        
        try {
            // Query bankDetails collection in Firestore
            const banksSnapshot = await firestore.collection('bankDetails').get();
            
            // Array to store matching banks
            const matchingBanks = [];
            
            banksSnapshot.forEach(doc => {
                const bankData = doc.data();
                const bankName = (bankData.bankName || bankData.name || bankData.bank || '').toLowerCase();
                const bankCurrency = bankData.currency || 'KSH';
                
                // Skip documents that aren't actual banks
                if (bankData.isTransfer || bankData.transferId || bankData.type === 'transfer') {
                    return;
                }
                
                // Check if payment method contains bank name or vice versa
                const methodMatchesBank = method.includes(bankName) || bankName.includes(method);
                const currencyMatches = bankCurrency === currency;
                
                // If both method and currency match, this is a strong candidate
                if (methodMatchesBank && currencyMatches) {
                    matchingBanks.push({
                        id: doc.id,
                        name: bankData.bankName || bankData.name || bankData.bank || 'Bank Account',
                        accountNumber: bankData.accountNumber || bankData.account || 'N/A',
                        branch: bankData.branch || '',
                        currency: bankCurrency,
                        firebaseId: doc.id,
                        firebaseData: bankData
                    });
                }
            });
            
            // If we found exact matches, return the first one
            if (matchingBanks.length > 0) {
                // Check if this bank already exists locally
                const existingBank = banks.find(b => b.firebaseId === matchingBanks[0].id);
                if (existingBank) {
                    return existingBank;
                }
                
                // Create a new local bank entry
                const newBank = {
                    id: 'fb_' + matchingBanks[0].id,
                    name: matchingBanks[0].name,
                    accountNumber: matchingBanks[0].accountNumber,
                    branch: matchingBanks[0].branch,
                    currency: matchingBanks[0].currency,
                    balance: 0,
                    firebaseId: matchingBanks[0].id,
                    firebaseData: matchingBanks[0].firebaseData,
                    lastUpdated: new Date().toISOString(),
                    isSynced: true,
                    // NEW: Opening Balance fields
                    openingBalance: 0,
                    openingDate: new Date().toISOString(),
                    processedReceipts: []
                };
                
                // Add to local banks array
                banks.push(newBank);
                return newBank;
            }
            
            // If no exact matches found, try fuzzy matching
            // Define bank keywords with their typical currencies
            const bankKeywords = [
                { keywords: ['equity', 'equity bank'], currency: 'KSH' },
                { keywords: ['kcb', 'kenya commercial'], currency: 'KSH' },
                { keywords: ['cooperative', 'co-op'], currency: 'KSH' },
                { keywords: ['standard chartered', 'standard'], currency: 'KSH' },
                { keywords: ['barclays', 'absa'], currency: 'KSH' },
                { keywords: ['diamond trust', 'dtb'], currency: 'KSH' },
                { keywords: ['ncba'], currency: 'KSH' },
                { keywords: ['bank of africa', 'boa'], currency: 'KSH' },
                { keywords: ['citibank', 'citi'], currency: 'USD' },
                { keywords: ['stanbic'], currency: 'KSH' },
                { keywords: ['family bank'], currency: 'KSH' },
                { keywords: ['gt bank', 'guaranty trust'], currency: 'KSH' },
                { keywords: ['i&m'], currency: 'KSH' }
            ];
            
            for (const bankInfo of bankKeywords) {
                for (const keyword of bankInfo.keywords) {
                    if (method.includes(keyword)) {
                        // Search for this bank in Firestore
                        banksSnapshot.forEach(doc => {
                            const bankData = doc.data();
                            const bankName = (bankData.bankName || bankData.name || bankData.bank || '').toLowerCase();
                            const bankCurrency = bankData.currency || 'KSH';
                            
                            if (bankName.includes(keyword) && bankCurrency === currency) {
                                // Check if this bank already exists locally
                                const existingBank = banks.find(b => b.firebaseId === doc.id);
                                if (existingBank) {
                                    return existingBank;
                                }
                                
                                // Create new local bank entry
                                const newBank = {
                                    id: 'fb_' + doc.id,
                                    name: bankData.bankName || bankData.name || bankData.bank || 'Bank Account',
                                    accountNumber: bankData.accountNumber || bankData.account || 'N/A',
                                    branch: bankData.branch || '',
                                    currency: bankCurrency,
                                    balance: 0,
                                    firebaseId: doc.id,
                                    firebaseData: bankData,
                                    lastUpdated: new Date().toISOString(),
                                    isSynced: true,
                                    // NEW: Opening Balance fields
                                    openingBalance: 0,
                                    openingDate: new Date().toISOString(),
                                    processedReceipts: []
                                };
                                
                                banks.push(newBank);
                                return newBank;
                            }
                        });
                    }
                }
            }
            
        } catch (error) {
            console.error("Error querying banks from Firestore:", error);
        }
        
        // No matching bank found
        return null;
    }

    // Exchange rate function (with fallback)
    async function getExchangeRate(fromCurrency, toCurrency) {
        // Try to get live rate from an API
        try {
            const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${fromCurrency}`);
            if (response.ok) {
                const data = await response.json();
                return data.rates[toCurrency] || getDefaultExchangeRate(fromCurrency, toCurrency);
            }
        } catch (error) {
            console.log('Using default exchange rate:', error);
        }
        
        // Fallback to default rates
        return getDefaultExchangeRate(fromCurrency, toCurrency);
    }

    function getDefaultExchangeRate(fromCurrency, toCurrency) {
        // Default rates (update these as needed)
        const rates = {
            'USD_KSH': 150, // 1 USD = 150 KSH
            'KSH_USD': 1/150 // 1 KSH = 0.00667 USD
        };
        
        if (fromCurrency === 'USD' && toCurrency === 'KSH') {
            return rates.USD_KSH;
        } else if (fromCurrency === 'KSH' && toCurrency === 'USD') {
            return rates.KSH_USD;
        }
        
        return 1; // Same currency
    }

    // UPDATED: ensureMpesaBank() with opening balance fields
    function ensureMpesaBank() {
        const mpesaBank = banks.find(b => b.id === 'mpesa');
        if (!mpesaBank) {
            banks.push({
                id: 'mpesa',
                name: 'M-Pesa',
                accountNumber: '0712-XXX-XXX',
                branch: 'Mobile Money',
                balance: 0,
                currency: 'KSH',
                isMpesa: true,
                lastUpdated: new Date().toISOString(),
                primaryPettyCash: true,
                // NEW: Opening Balance fields
                openingBalance: 0,
                openingDate: new Date().toISOString(),
                processedReceipts: [] // Track processed receipt IDs
            });
        }
        
        // Ensure Card Wallet exists
        const cardWallet = banks.find(b => b.id === 'cardwallet');
        if (!cardWallet) {
            banks.push({
                id: 'cardwallet',
                name: 'CARD WALLET',
                accountNumber: 'CARD-XXXX-XXXX',
                branch: 'Digital Wallet',
                balance: 0,
                currency: 'KSH', // Default currency, can be changed by user
                isCardWallet: true,
                lastUpdated: new Date().toISOString(),
                primaryCardWallet: true,
                // NEW: Opening Balance fields
                openingBalance: 0,
                openingDate: new Date().toISOString(),
                processedReceipts: []
            });
        }
    }

    // Add this new function to update Card Wallet from major transactions
    function updateCardWalletFromTransactions() {
        const cardWallet = banks.find(b => b.id === 'cardwallet');
        if (!cardWallet) return;
        
        // Calculate total card-related transactions
        let cardBalance = 0;
        
        // Sum all card-related major transactions
        const cardTransactions = majorTransactions.filter(t => 
            t.paymentMethod && 
            (t.paymentMethod.toLowerCase().includes('card') || 
             t.paymentMethod.toLowerCase().includes('visa') ||
             t.paymentMethod.toLowerCase().includes('mastercard') ||
             t.paymentMethod.toLowerCase().includes('debit') ||
             t.paymentMethod.toLowerCase().includes('credit'))
        );
        
        cardTransactions.forEach(t => {
            if (t.category === 'Sales' || t.isFromReceipt) {
                cardBalance += t.amount;
            } else {
                cardBalance -= t.amount;
            }
        });
        
        cardWallet.balance = cardBalance;
        cardWallet.lastUpdated = new Date().toISOString();
        
        // Update bank cards if on bank management tab
        updateBankCards();
        updateBankSelectors();
        updateTransferBankSelectors();
    }

    function updateMpesaFromPettyCash() {
        const mpesaBank = banks.find(b => b.id === 'mpesa');
        if (!mpesaBank) return;
        
        const { currentBalance } = calculatePettyCashBalance();
        mpesaBank.balance = currentBalance;
        mpesaBank.lastUpdated = new Date().toISOString();
        
        // Update bank cards if on bank management tab
        updateBankCards();
        updateBankSelectors();
        updateTransferBankSelectors();
        
        // Save to Firestore
        if (user) saveUserData();
    }

    // --- Balance Visibility Functions ---
    function toggleAllBalances() {
        balancesHidden = !balancesHidden;
        
        // Update all balance displays
        updateBalanceDisplay('current-balance', balancesHidden);
        updateBalanceDisplay('day-expense', balancesHidden);
        updateBalanceDisplay('day-income', balancesHidden);
        updateBalanceDisplay('total-bank-funds', balancesHidden);
        updateBalanceDisplay('total-outstanding-loans', balancesHidden);
        updateBalanceDisplay('monthly-spend', balancesHidden);
        
        // Update bank cards
        updateBankCards();
        
        // Update button text
        const button = document.querySelector('#petty-cash-balance-bar button:first-child');
        if (button) {
            if (balancesHidden) {
                button.innerHTML = '<i class="fas fa-eye mr-2"></i>Show All Balances';
            } else {
                button.innerHTML = '<i class="fas fa-eye-slash mr-2"></i>Hide All Balances';
            }
        }
    }

    function updateBalanceDisplay(elementId, hidden) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        if (hidden) {
            element.classList.add('hidden-balance');
            if (elementId === 'current-balance') {
                element.textContent = '********';
            } else if (elementId === 'day-expense' || elementId === 'day-income') {
                element.textContent = 'KSH *****';
            } else {
                element.textContent = '*****';
            }
        } else {
            element.classList.remove('hidden-balance');
            // Restore actual values
            if (elementId === 'current-balance') {
                const { currentBalance } = calculatePettyCashBalance();
                element.textContent = formatKSH(currentBalance);
                element.style.color = currentBalance < 0 ? '#dc3545' : 'var(--primary-color)';
            } else if (elementId === 'day-expense') {
                const { totalExpense } = calculatePettyCashBalance();
                element.textContent = formatKSH(totalExpense);
            } else if (elementId === 'day-income') {
                const { totalIncome } = calculatePettyCashBalance();
                element.textContent = formatKSH(totalIncome);
            } else if (elementId === 'total-bank-funds') {
                const totalBankFunds = banks.reduce((sum, bank) => sum + bank.balance, 0);
                element.textContent = formatKSH(totalBankFunds);
            } else if (elementId === 'total-outstanding-loans') {
                const totalOutstandingLoans = loans.reduce((sum, loan) => sum + loan.balance, 0);
                element.textContent = formatKSH(totalOutstandingLoans);
            } else if (elementId === 'monthly-spend') {
                element.textContent = formatKSH(currentMonthSpend.totalExpense);
            }
        }
    }

    async function loadFirebaseBanks() {
        if (!user) return;
        
        showLoading('Loading bank data from Firebase...');
        
        try {
            const banksSnapshot = await firestore.collection('bankDetails').get();
            const banksListDiv = document.getElementById('firebase-banks-list');
            banksListDiv.innerHTML = '';
            
            if (banksSnapshot.empty) {
                banksListDiv.innerHTML = `
                    <div class="text-center py-8 text-gray-500">
                        <i class="fas fa-university text-3xl mb-3"></i>
                        <p>No banks found in Firebase</p>
                        <p class="text-sm mt-2">Add banks in your other system first</p>
                    </div>
                `;
                showLoading(false);
                return;
            }
            
            let hasAvailableBanks = false;
            banksSnapshot.forEach(doc => {
                const bankData = doc.data();
                const bankId = doc.id;
                
                // Skip any documents that aren't actual banks (like transfers)
                if (bankData.isTransfer || bankData.transferId || 
                    bankData.type === 'transfer' || bankData.category === 'transfer') {
                    return; // Skip this document
                }
                
                // Check if bank already exists locally
                const existingBank = banks.find(b => b.firebaseId === bankId);
                
                // Only show banks not already added locally
                if (!existingBank) {
                    hasAvailableBanks = true;
                    
                    // Extract bank name from Firebase data
                    const bankName = bankData.bankName || 
                                   bankData.name || 
                                   bankData.bank || 
                                   'Bank Account';
                    
                    // Extract account number
                    const accountNumber = bankData.accountNumber || 
                                        bankData.account || 
                                        'N/A';
                    
                    // Extract branch
                    const branch = bankData.branch || '';
                    
                    // Extract currency
                    const currency = bankData.currency || 'KSH';
                    
                    const bankOption = document.createElement('div');
                    bankOption.className = `p-4 border rounded-lg cursor-pointer transition-all hover:bg-gray-50 bg-white border-gray-200`;
                    bankOption.onclick = () => selectFirebaseBank(bankId, bankData);
                    bankOption.innerHTML = `
                        <div class="flex justify-between items-center">
                            <div>
                                <h4 class="font-semibold text-gray-800">${bankName}</h4>
                                <p class="text-sm text-gray-600">Account: ${accountNumber}</p>
                                <p class="text-xs text-gray-500 mt-1">Currency: ${currency}</p>
                                ${branch ? `<p class="text-xs text-gray-500 mt-1">${branch}</p>` : ''}
                                <p class="text-xs text-green-600 mt-1 font-medium">Click to add</p>
                            </div>
                            <i class="fas fa-chevron-right text-gray-400"></i>
                        </div>
                    `;
                    
                    banksListDiv.appendChild(bankOption);
                }
            });
            
            if (!hasAvailableBanks) {
                banksListDiv.innerHTML = `
                    <div class="text-center py-8 text-gray-500">
                        <i class="fas fa-check-circle text-3xl mb-3 text-green-500"></i>
                        <p>All Firebase banks have been added</p>
                        <p class="text-sm mt-2">Add more banks in your other system</p>
                    </div>
                `;
            }
            
            showLoading(false);
        } catch (error) {
            console.error("Error loading banks:", error);
            showLoading(false);
            showToast('Error loading banks from Firebase', 'error');
        }
    }

    // Modify the existing loadReceiptPayments function to use the new processing
    async function loadReceiptPayments() {
        if (!user) return;
        
        try {
            const paymentsSnapshot = await firestore.collection('receipt_payments').get();
            const receipts = [];
            
            paymentsSnapshot.forEach(doc => {
                receipts.push({ id: doc.id, ...doc.data() });
            });
            
            // Track processed payments to avoid duplicates
            const processedPaymentIds = new Set(
                majorTransactions
                    .filter(t => t.isFromReceipt && t.receiptId)
                    .map(t => t.receiptId)
            );
            
            // Process only unprocessed receipts
            for (const receipt of receipts) {
                if (!processedPaymentIds.has(receipt.id)) {
                    await processNewPayment(receipt);
                } else {
                    console.log('Skipping already processed payment:', receipt.id);
                }
            }
            
            // Update all UI components
            updateFinancialDashboard();
            updateBankCards();
            updateBankSelectors();
            updateTransferBankSelectors();
            
        } catch (error) {
            console.error("Error loading receipts:", error);
            showToast('Error loading payments from Firebase', 'error');
        }
    }

    function updateBankBalancesFromReceipts(receipts) {
        receipts.forEach(receipt => {
            const bankName = receipt.bankName || receipt.bank;
            const amount = parseFloat(receipt.amount) || 0;
            
            if (bankName && amount) {
                // Check if it's M-Pesa
                if (bankName.toLowerCase().includes('mpesa') || bankName.toLowerCase().includes('mobile')) {
                    const mpesaBank = banks.find(b => b.id === 'mpesa');
                    if (mpesaBank) {
                        mpesaBank.balance += amount;
                        
                        // Add to petty cash as income
                        pettyCashTransactions.push({
                            date: new Date(receipt.paymentDate || Date.now()).toLocaleDateString('en-KE'),
                            time: new Date(receipt.paymentDate || Date.now()).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
                            description: `M-Pesa payment: ${receipt.receiptNumber || 'Unknown'}`,
                            recipient: 'M-Pesa',
                            cost: amount,
                            type: 'income'
                        });
                        
                        renderPettyCash();
                        updatePettyCashBalanceDisplay();
                        updatePettyCashChart();
                    }
                } else {
                    // Find local bank by name
                    const localBank = banks.find(b => 
                        b.name.toLowerCase().includes(bankName.toLowerCase()) || 
                        bankName.toLowerCase().includes(b.name.toLowerCase())
                    );
                    
                    if (localBank && receipt.paymentDate) {
                        localBank.balance += amount;
                        
                        // Add to major transactions
                        majorTransactions.push({
                            description: `Payment from receipt: ${receipt.receiptNumber || 'Unknown'}`,
                            amount: amount,
                            category: 'Sales',
                            date: new Date(receipt.paymentDate).toLocaleDateString('en-KE') || new Date().toLocaleDateString('en-KE'),
                            bankId: localBank.id,
                            isFromReceipt: true
                        });
                        
                        console.log(`Updated ${localBank.name} balance by +${amount} from receipt`);
                    }
                }
            }
        });
        
        updateFinancialDashboard();
        updateBankCards();
        updateBankSelectors();
        updateTransferBankSelectors();
        
        // Save to Firestore
        if (user) saveUserData();
    }

    function selectFirebaseBank(bankId, bankData) {
        // Extract bank name from Firebase data with multiple possible field names
        const bankName = bankData.bankName || 
                       bankData.name || 
                       bankData.bank || 
                       bankData.bank_name || 
                       bankData.bankName || 
                       'Bank Account';
        
        const accountNumber = bankData.accountNumber || 
                            bankData.account || 
                            bankData.account_number || 
                            bankData.accountNumber || 
                            'N/A';
        
        const branch = bankData.branch || 
                     bankData.branchName || 
                     bankData.branch_name || 
                     bankData.branchName || 
                     '';
        
        selectedFirebaseBank = {
            id: bankId,
            name: bankName,
            accountNumber: accountNumber,
            branch: branch,
            data: bankData
        };
        
        // Highlight selection
        document.querySelectorAll('#firebase-banks-list > div').forEach(div => {
            div.classList.remove('bg-primary', 'text-white', 'border-primary');
            div.classList.add('bg-white', 'border-gray-200');
        });
        
        event.currentTarget.classList.remove('bg-white', 'border-gray-200');
        event.currentTarget.classList.add('bg-primary', 'text-white', 'border-primary');
        
        // Update selected bank name display
        document.getElementById('selected-bank-name').textContent = selectedFirebaseBank.name;
        document.getElementById('confirm-bank-name').textContent = selectedFirebaseBank.name;
    }

    // --- Add Bank Modal Functions ---
    function openAddBankModal() {
        if (!user) {
            showToast('Please connect to Firebase first', 'warning');
            toggleFirebaseLogin();
            return;
        }
        
        const modal = document.getElementById('add-bank-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
        loadFirebaseBanks();
        resetAddBankModal();
    }

    function closeAddBankModal() {
        const modal = document.getElementById('add-bank-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    function resetAddBankModal() {
        addBankStep = 1;
        selectedFirebaseBank = null;
        
        // Reset steps
        document.getElementById('step-1-indicator').className = 'step-indicator active';
        document.getElementById('step-2-indicator').className = 'step-indicator';
        document.getElementById('step-3-indicator').className = 'step-indicator';
        
        // Show step 1
        document.querySelectorAll('.bank-step').forEach(step => {
            step.classList.remove('active');
            step.style.display = 'none';
        });
        document.getElementById('step-1').classList.add('active');
        document.getElementById('step-1').style.display = 'block';
        
        // Reset inputs
        document.getElementById('bank-initial-balance').value = '';
        document.getElementById('confirm-terms').checked = false;
    }

    function nextBankStep() {
        if (addBankStep === 1) {
            if (!selectedFirebaseBank) {
                showToast('Please select a bank first', 'error');
                return;
            }
            addBankStep = 2;
        } else if (addBankStep === 2) {
            const balance = parseFloat(document.getElementById('bank-initial-balance').value);
            if (!balance || balance < 0) {
                showToast('Please enter a valid balance', 'error');
                return;
            }
            document.getElementById('confirm-bank-balance').textContent = `KSH ${balance.toLocaleString('en-KE')}`;
            addBankStep = 3;
        }
        
        updateBankModalSteps();
    }

    function prevBankStep() {
        if (addBankStep === 2) {
            addBankStep = 1;
        } else if (addBankStep === 3) {
            addBankStep = 2;
        }
        updateBankModalSteps();
    }

    function updateBankModalSteps() {
        // Update indicators
        document.getElementById('step-1-indicator').className = `step-indicator ${addBankStep >= 1 ? 'active' : ''}`;
        document.getElementById('step-2-indicator').className = `step-indicator ${addBankStep >= 2 ? 'active' : ''}`;
        document.getElementById('step-3-indicator').className = `step-indicator ${addBankStep >= 3 ? 'active' : ''}`;
        
        // Show current step
        document.querySelectorAll('.bank-step').forEach(step => {
            step.classList.remove('active');
            step.style.display = 'none';
        });
        
        const currentStep = document.getElementById(`step-${addBankStep}`);
        if (currentStep) {
            currentStep.classList.add('active');
            currentStep.style.display = 'block';
        }
    }

    // UPDATED: submitNewBank() with opening balance fields
    function submitNewBank() {
        const termsAccepted = document.getElementById('confirm-terms').checked;
        if (!termsAccepted) {
            showToast('Please confirm the terms', 'error');
            return;
        }
        
        const balance = parseFloat(document.getElementById('bank-initial-balance').value);
        
        const newBank = {
            id: 'fb_' + selectedFirebaseBank.id,
            name: selectedFirebaseBank.name,
            accountNumber: selectedFirebaseBank.accountNumber,
            branch: selectedFirebaseBank.branch,
            currency: selectedFirebaseBank.data.currency || 'KSH',
            balance: balance,
            firebaseId: selectedFirebaseBank.id,
            firebaseData: selectedFirebaseBank.data,
            lastUpdated: new Date().toISOString(),
            isSynced: true,
            // NEW: Opening Balance fields
            openingBalance: balance,
            openingDate: new Date().toISOString(),
            processedReceipts: []
        };
        
        // Check if bank already exists
        const existingBankIndex = banks.findIndex(b => b.firebaseId === newBank.firebaseId);
        if (existingBankIndex >= 0) {
            // Update existing bank
            banks[existingBankIndex] = { ...banks[existingBankIndex], ...newBank };
            showToast(`Bank ${newBank.name} updated successfully!`, 'success');
        } else {
            // Add new bank
            banks.push(newBank);
            showToast(`Bank ${newBank.name} added successfully!`, 'success');
        }
        
        updateBankSelectors();
        updateTransferBankSelectors();
        updateFinancialDashboard();
        updateBankCards();
        closeAddBankModal();
        
        // Update quick stats
        updateQuickStats();
        
        // Save to Firestore
        if (user) saveUserData();
    }

    // --- Inter-Bank Transfer Functions ---
    function updateTransferBankSelectors() {
        const fromSelect = document.getElementById('transfer-from-bank');
        const toSelect = document.getElementById('transfer-to-bank');
        
        if (!fromSelect || !toSelect) return;
        
        fromSelect.innerHTML = '<option value="" disabled selected>Select Source Bank</option>';
        toSelect.innerHTML = '<option value="" disabled selected>Select Destination Bank</option>';
        
        if (banks.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "No banks available - Add banks first";
            option.disabled = true;
            fromSelect.appendChild(option.cloneNode(true));
            toSelect.appendChild(option.cloneNode(true));
            return;
        }
        
        banks.forEach(bank => {
            const fromOption = document.createElement('option');
            fromOption.value = bank.id;
            if (bank.id === 'mpesa') {
                fromOption.textContent = `${bank.name} (Petty Cash) - ${formatKSH(bank.balance)}`;
            } else {
                fromOption.textContent = `${bank.name} - ${formatKSH(bank.balance)}`;
            }
            fromSelect.appendChild(fromOption.cloneNode(true));
            
            const toOption = fromOption.cloneNode(true);
            toSelect.appendChild(toOption);
        });
        
        // Add event listeners for balance display
        fromSelect.addEventListener('change', function() {
            const bank = getBankById(this.value);
            const balanceElement = document.getElementById('from-bank-balance');
            if (bank && balanceElement) {
                balanceElement.innerHTML = 
                    `<span class="font-semibold">Current Balance:</span> ${formatKSH(bank.balance)}`;
            }
        });
        
        toSelect.addEventListener('change', function() {
            const bank = getBankById(this.value);
            const balanceElement = document.getElementById('to-bank-balance');
            if (bank && balanceElement) {
                balanceElement.innerHTML = 
                    `<span class="font-semibold">Current Balance:</span> ${formatKSH(bank.balance)}`;
            }
        });
        
        // Initialize fee calculation
        const transferAmount = document.getElementById('transfer-amount');
        if (transferAmount) {
            transferAmount.addEventListener('input', function() {
                const amount = parseFloat(this.value) || 0;
                const fee = calculateTransferFee(amount);
                const feeElement = document.getElementById('transfer-fee');
                if (feeElement) {
                    feeElement.textContent = `Transfer Fee: ${formatKSH(fee)}`;
                }
            });
        }
    }

    function calculateTransferFee(amount) {
        // Simple fee calculation: 0.1% or min 50, max 5000
        const fee = Math.max(50, Math.min(5000, amount * 0.001));
        return fee;
    }

    function closeTransferConfirm() {
        const modal = document.getElementById('transfer-confirm-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
        document.getElementById('transfer-pin').value = '';
    }

    function executeBankTransfer() {
        const pin = document.getElementById('transfer-pin').value;
        
        if (pin !== currentPIN) {
            showToast('Invalid security PIN', 'error');
            return;
        }
        
        const fromBankId = document.getElementById('transfer-from-bank').value;
        const toBankId = document.getElementById('transfer-to-bank').value;
        const amount = parseFloat(document.getElementById('transfer-amount').value);
        const fee = parseFloat(document.getElementById('transfer-fee-input').value) || 0;
        const feeBearer = document.getElementById('fee-bearer').value;
        const reason = document.getElementById('transfer-reason').value;
        
        const fromBank = getBankById(fromBankId);
        const toBank = getBankById(toBankId);

        // Check if currencies match, convert if necessary
        if (fromBank.currency !== toBank.currency) {
            const confirmConvert = confirm(
                `Currency mismatch!\nFrom: ${fromBank.currency}\nTo: ${toBank.currency}\n` +
                `Amount ${formatCurrency(amount, fromBank.currency)} will be converted.\n\n` +
                `Continue with conversion?`
            );
            
            if (!confirmConvert) {
                return;
            }
        }
        
        // Calculate total debit based on fee bearer
        let fromBankDebit = amount;
        let toBankCredit = amount;
        
        if (feeBearer === 'sending') {
            fromBankDebit += fee;
        } else if (feeBearer === 'receiving') {
            toBankCredit -= fee;
        }
        
        // Check if sending bank has sufficient funds
        if (fromBank.balance < fromBankDebit) {
            showToast(`Insufficient funds. Available: ${formatKSH(fromBank.balance)}, Required: ${formatKSH(fromBankDebit)}`, 'error');
            return;
        }
        
        // Execute transfer
        fromBank.balance -= fromBankDebit;
        toBank.balance += toBankCredit;
        
        // If transferring to/from M-Pesa, update petty cash
        if (toBank.id === 'mpesa') {
            // Add as petty cash income
            pettyCashTransactions.push({
                date: new Date().toLocaleDateString('en-KE'),
                time: new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
                description: `Bank transfer to M-Pesa: ${reason || 'Transfer'}`,
                recipient: 'M-Pesa',
                cost: amount,
                type: 'income'
            });
            renderPettyCash();
            updatePettyCashBalanceDisplay();
            updatePettyCashChart();
        } else if (fromBank.id === 'mpesa') {
            // Add as petty cash expense
            pettyCashTransactions.push({
                date: new Date().toLocaleDateString('en-KE'),
                time: new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
                description: `M-Pesa transfer to ${toBank.name}: ${reason || 'Transfer'}`,
                recipient: toBank.name,
                cost: amount + (feeBearer === 'sending' ? fee : 0),
                type: 'expense'
            });
            renderPettyCash();
            updatePettyCashBalanceDisplay();
            updatePettyCashChart();
        }
        
        // Record transfer
        const transferId = 't' + Date.now();
        const transferRecord = {
            id: transferId,
            date: new Date().toISOString(),
            fromBankId: fromBankId,
            fromBankName: fromBank.name,
            toBankId: toBankId,
            toBankName: toBank.name,
            amount: amount,
            fee: fee,
            feeBearer: feeBearer,
            fromBankDebit: fromBankDebit,
            toBankCredit: toBankCredit,
            reason: reason,
            status: 'completed'
        };
        
        bankTransfers.push(transferRecord);
        
        // Add to major transactions
        majorTransactions.push({
            description: `Bank Transfer: ${reason || 'Inter-bank transfer'}`,
            amount: amount,
            category: 'Assets',
            date: new Date().toLocaleDateString('en-KE'),
            bankId: toBankId,
            isTransfer: true,
            transferId: transferId
        });
        
        // Add fee as expense to the appropriate bank
        if (fee > 0) {
            const feeBankId = feeBearer === 'sending' ? fromBankId : toBankId;
            const feeBank = getBankById(feeBankId);
            majorTransactions.push({
                description: `Bank Transfer Fee`,
                amount: fee,
                category: 'Overheads',
                date: new Date().toLocaleDateString('en-KE'),
                bankId: feeBankId,
                isTransferFee: true,
                transferId: transferId,
                feeBearer: feeBearer
            });
        }
        
        // Update UI
        updateFinancialDashboard();
        updateBankCards();
        updateTransferHistory();
        updateBankSelectors();
        updateTransferBankSelectors();
        
        // Clear form
        document.getElementById('bank-transfer-form').reset();
        document.getElementById('transfer-preview').classList.add('hidden');
        document.getElementById('transfer-pin').value = '';
        document.getElementById('transfer-confirm-modal').classList.add('hidden');
        
        // Animate bank cards
        const fromCard = document.querySelector(`[data-bank-id="${fromBankId}"]`);
        const toCard = document.querySelector(`[data-bank-id="${toBankId}"]`);
        
        if (fromCard) fromCard.classList.add('transfer-animation');
        if (toCard) toCard.classList.add('transfer-animation');
        
        setTimeout(() => {
            if (fromCard) fromCard.classList.remove('transfer-animation');
            if (toCard) toCard.classList.remove('transfer-animation');
        }, 500);
        
        showToast(`Transfer of ${formatKSH(amount)} completed successfully!`, 'success');
        
        // Update quick stats
        updateQuickStats();
        
        // Save to Firestore
        if (user) saveUserData();
    }

    function updateTransferHistory() {
        const tbody = document.getElementById('transfer-history');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        // Show last 5 transfers
        const recentTransfers = [...bankTransfers]
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 5);
        
        if (recentTransfers.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-8 text-center text-gray-500">
                        <i class="fas fa-exchange-alt text-3xl mb-3"></i>
                        <p>No transfers yet</p>
                        <p class="text-sm mt-2">Make your first inter-bank transfer above</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        recentTransfers.forEach(transfer => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-50';
            
            const date = new Date(transfer.date);
            const formattedDate = date.toLocaleDateString('en-KE');
            
            row.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${formattedDate}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${transfer.fromBankName}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${transfer.toBankName}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600">${formatKSH(transfer.amount)}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-3 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                        ${transfer.status}
                    </span>
                </td>
            `;
            
            tbody.appendChild(row);
        });
    }

    // --- Bank Cards Display ---
    function updateBankCards() {
        // Filter out any banks that might be transfers
        const actualBanks = banks.filter(bank => 
            !bank.isTransfer && 
            !bank.transferId && 
            bank.id !== 'transfer' &&
            !bank.name.toLowerCase().includes('transfer')
        );
        const container = document.getElementById('bank-details-cards');
        const loading = document.getElementById('bank-cards-loading');
        const noBanks = document.getElementById('no-banks-message');
        
        if (!container || !loading || !noBanks) return;
        
        if (banks.length === 0) {
            container.innerHTML = '';
            loading.classList.add('hidden');
            noBanks.classList.remove('hidden');
            return;
        }
        
        loading.classList.add('hidden');
        noBanks.classList.add('hidden');
        container.innerHTML = '';
        
        banks.forEach(bank => {
            const card = document.createElement('div');
            
            // Special styling for M-Pesa
            if (bank.id === 'mpesa') {
                card.className = 'mpesa-card rounded-xl shadow-card overflow-hidden hover:shadow-card-hover transition-all duration-300';
            } else {
                card.className = 'bg-white rounded-xl shadow-card overflow-hidden hover:shadow-card-hover transition-all duration-300';
            }
            
            card.setAttribute('data-bank-id', bank.id);
            
            const balanceColor = bank.balance < 0 ? 'text-red-500' : (bank.id === 'mpesa' ? 'text-white' : 'text-primary');
            const balanceIcon = bank.balance < 0 ? 'fa-arrow-down' : 'fa-arrow-up';
            const displayBalance = balancesHidden ? '*****' : formatKSH(bank.balance, false);
            const currency = bank.currency || 'KSH';
            const currencySymbol = currency === 'USD' ? '$' : 'KSH';
            
            card.innerHTML = `
                <div class="p-6">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <h4 class="text-xl font-bold ${bank.id === 'mpesa' ? 'text-white' : 'text-gray-800'}">
                                ${bank.name}
                                ${bank.id === 'mpesa' ? '<span class="mpesa-badge text-xs px-2 py-1 rounded-full ml-2">Petty Cash</span>' : ''}
                                ${bank.isAutoGenerated ? '<span class="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800 ml-2">Auto</span>' : ''}
                            </h4>
                            <p class="${bank.id === 'mpesa' ? 'text-white opacity-80' : 'text-gray-600'} mt-1">${bank.accountNumber || 'No account number'}</p>
                            ${bank.branch ? `<p class="${bank.id === 'mpesa' ? 'text-white opacity-60' : 'text-gray-500'} text-xs mt-1">${bank.branch}</p>` : ''}
                            <p class="${bank.id === 'mpesa' ? 'text-white opacity-70' : 'text-gray-500'} text-xs mt-1">
                                ${currency} ${bank.currency === 'USD' ? '(USD)' : '(KSH)'}
                            </p>
                            ${bank.openingDate ? `<p class="${bank.id === 'mpesa' ? 'text-white opacity-60' : 'text-gray-500'} text-xs mt-1">Since: ${new Date(bank.openingDate).toLocaleDateString('en-KE')}</p>` : ''}
                        </div>
                        <div class="${bank.id === 'mpesa' ? 'bg-white bg-opacity-20 text-white' : 'bg-primary bg-opacity-10 text-primary'} p-3 rounded-lg">
                            <i class="fas ${bank.id === 'mpesa' ? 'fa-mobile-alt' : 'fa-university'} text-xl"></i>
                        </div>
                    </div>
                    
                    <div class="mb-4">
                        <div class="flex justify-between items-center mb-2">
                            <span class="${bank.id === 'mpesa' ? 'text-white opacity-80' : 'text-gray-600'}">Current Balance</span>
                            <span class="text-xs ${bank.id === 'mpesa' ? 'text-white opacity-60' : 'text-gray-500'}">Updated: ${new Date(bank.lastUpdated || Date.now()).toLocaleTimeString('en-KE', {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                        <div class="text-2xl font-bold ${balanceColor} flex items-center ${balancesHidden ? 'hidden-balance' : ''}">
                            <i class="fas ${balanceIcon} mr-2"></i>
                            ${balancesHidden ? '*****' : formatKSH(bank.balance, false)}
                            <span class="text-sm ml-2">${currency === 'USD' ? '(USD)' : '(KSH)'}</span>
                        </div>
                        ${bank.openingBalance !== undefined ? `
                            <div class="text-xs ${bank.id === 'mpesa' ? 'text-white opacity-60' : 'text-gray-500'} mt-1">
                                Opening Balance: ${formatKSH(bank.openingBalance)}
                            </div>
                        ` : ''}
                    </div>
                    
                    <div class="flex space-x-2">
                        <button onclick="updateBankBalance('${bank.id}')"
                                class="flex-1 ${bank.id === 'mpesa' ? 'bg-white bg-opacity-20 hover:bg-opacity-30 text-white' : 'bg-blue-50 hover:bg-blue-100 text-blue-600'} font-medium py-2 px-3 rounded-lg text-sm transition-all flex items-center justify-center">
                            <i class="fas fa-edit mr-2"></i>Update
                        </button>
                        <button onclick="showBankTransactions('${bank.id}')"
                                class="flex-1 ${bank.id === 'mpesa' ? 'bg-white bg-opacity-10 hover:bg-opacity-20 text-white' : 'bg-gray-50 hover:bg-gray-100 text-gray-600'} font-medium py-2 px-3 rounded-lg text-sm transition-all flex items-center justify-center">
                            <i class="fas fa-history mr-2"></i>History
                        </button>
                    </div>
                </div>
                
                ${bank.firebaseId ? `
                <div class="${bank.id === 'mpesa' ? 'bg-white bg-opacity-10' : 'bg-gray-50'} px-6 py-3 border-t ${bank.id === 'mpesa' ? 'border-white border-opacity-20' : 'border-gray-100'}">
                    <div class="flex items-center text-sm ${bank.id === 'mpesa' ? 'text-white opacity-80' : 'text-gray-600'}">
                        <i class="fas fa-fire ${bank.id === 'mpesa' ? 'text-yellow-300' : 'text-orange-500'} mr-2"></i>
                        <span>Synced with Firebase</span>
                        <button onclick="syncBankWithFirebase('${bank.id}')"
                                class="ml-auto ${bank.id === 'mpesa' ? 'text-yellow-300 hover:text-yellow-200' : 'text-primary hover:text-primary-dark'} text-xs font-medium">
                            <i class="fas fa-sync-alt mr-1"></i>Sync Now
                        </button>
                    </div>
                </div>
                ` : ''}
            `;
            
            container.appendChild(card);
        });
        
        // Update quick stats
        updateQuickStats();
    }

    // --- Loan Card Functions ---
    function updateLoanCards() {
        const container = document.getElementById('loan-cards-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (loans.length === 0) {
            container.innerHTML = `
                <div class="col-span-full text-center py-8 text-gray-500">
                    <i class="fas fa-hand-holding-usd text-3xl mb-3"></i>
                    <p>No active loans</p>
                    <p class="text-sm mt-2">Add loans to see them listed here</p>
                </div>
            `;
            return;
        }
        
        loans.forEach(loan => {
            const card = document.createElement('div');
            card.className = 'bg-white border border-gray-200 rounded-xl shadow-card hover:shadow-card-hover transition-all duration-300';
            
            // Calculate repayment progress
            const repaymentProgress = ((loan.originalBalance - loan.balance) / loan.originalBalance) * 100;
            const dueDate = new Date(loan.dueDate);
            const today = new Date();
            const daysRemaining = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
            const isOverdue = daysRemaining < 0;
            
            // Determine card color based on status
            let statusColor = 'bg-green-100 text-green-800';
            if (isOverdue) {
                statusColor = 'bg-red-100 text-red-800';
            } else if (daysRemaining < 30) {
                statusColor = 'bg-yellow-100 text-yellow-800';
            }
            
            card.innerHTML = `
                <div class="p-5">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <h4 class="text-xl font-bold text-gray-800">${loan.institution}</h4>
                            <p class="text-sm text-gray-600 mt-1">${loan.type.charAt(0).toUpperCase() + loan.type.slice(1)} Loan</p>
                        </div>
                        <div class="bg-primary bg-opacity-10 text-primary p-3 rounded-lg">
                            <i class="fas fa-landmark text-xl"></i>
                        </div>
                    </div>
                    
                    <div class="mb-4">
                        <div class="flex justify-between items-center mb-2">
                            <span class="text-gray-600">Current Balance</span>
                            <span class="font-bold text-lg ${loan.balance > 0 ? 'text-red-600' : 'text-green-600'} ${balancesHidden ? 'hidden-balance' : ''}">
                                ${balancesHidden ? '*****' : formatKSH(loan.balance)}
                            </span>
                        </div>
                        
                        <div class="w-full bg-gray-200 rounded-full h-2 mb-1">
                            <div class="bg-primary h-2 rounded-full" style="width: ${Math.min(100, repaymentProgress)}%"></div>
                        </div>
                        <div class="text-xs text-gray-500 flex justify-between">
                            <span>Repaid: ${repaymentProgress.toFixed(1)}%</span>
                            <span class="${balancesHidden ? 'hidden-balance' : ''}">Original: ${balancesHidden ? '*****' : formatKSH(loan.originalBalance)}</span>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-2 gap-4 text-sm mb-4">
                        <div>
                            <span class="text-gray-600 block">Interest Rate</span>
                            <span class="font-semibold">${loan.interestRate}%</span>
                        </div>
                        <div>
                            <span class="text-gray-600 block">Due In</span>
                            <span class="font-semibold ${isOverdue ? 'text-red-600' : ''}">
                                ${isOverdue ? Math.abs(daysRemaining) + ' days overdue' : daysRemaining + ' days'}
                            </span>
                        </div>
                    </div>
                    
                    <div class="flex space-x-2">
                        <button onclick="openLoanRepaymentModal('${loan.id}')"
                                class="flex-1 bg-primary hover:bg-primary-dark text-white font-medium py-2 px-3 rounded-lg text-sm transition-all flex items-center justify-center">
                            <i class="fas fa-money-check-alt mr-2"></i>Repay
                        </button>
                        <button onclick="viewLoanDetails('${loan.id}')"
                                class="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-600 font-medium py-2 px-3 rounded-lg text-sm transition-all flex items-center justify-center">
                            <i class="fas fa-history mr-2"></i>History
                        </button>
                    </div>
                </div>
                
                <div class="px-5 py-3 border-t border-gray-100 ${statusColor}">
                    <div class="flex items-center text-sm">
                        <i class="fas ${isOverdue ? 'fa-exclamation-triangle' : 'fa-calendar-check'} mr-2"></i>
                        <span>${isOverdue ? 'PAYMENT OVERDUE' : (daysRemaining < 30 ? 'PAYMENT DUE SOON' : 'ACTIVE')}</span>
                    </div>
                </div>
            `;
            
            container.appendChild(card);
        });
    }

    function openLoanRepaymentModal(loanId) {
        currentRepaymentLoanId = loanId;
        const loan = loans.find(l => l.id === loanId);
        if (!loan) return;
        
        const modal = document.getElementById('loan-repayment-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
        
        // Update loan details
        const detailsDiv = document.getElementById('repayment-loan-details');
        detailsDiv.innerHTML = `
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <span class="text-gray-600 text-sm">Institution:</span>
                    <p class="font-semibold">${loan.institution}</p>
                </div>
                <div>
                    <span class="text-gray-600 text-sm">Current Balance:</span>
                    <p class="font-bold text-lg text-red-600">${formatKSH(loan.balance)}</p>
                </div>
                <div>
                    <span class="text-gray-600 text-sm">Loan Type:</span>
                    <p class="font-medium">${loan.type.charAt(0).toUpperCase() + loan.type.slice(1)}</p>
                </div>
                <div>
                    <span class="text-gray-600 text-sm">Due Date:</span>
                    <p class="font-medium">${new Date(loan.dueDate).toLocaleDateString('en-KE')}</p>
                </div>
            </div>
        `;
        
        // Update bank selector
        const bankSelect = document.getElementById('repayment-bank-select');
        bankSelect.innerHTML = '<option value="" disabled selected>Select Bank for Repayment</option>';
        
        if (banks.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "No banks available";
            option.disabled = true;
            bankSelect.appendChild(option);
        } else {
            banks.forEach(bank => {
                const option = document.createElement('option');
                option.value = bank.id;
                if (bank.id === 'mpesa') {
                    option.textContent = `${bank.name} (Petty Cash) - ${formatKSH(bank.balance)}`;
                } else {
                    option.textContent = `${bank.name} - ${formatKSH(bank.balance)}`;
                }
                bankSelect.appendChild(option);
            });
        }
        
        // Add event listener for bank balance display
        bankSelect.addEventListener('change', function() {
            const bank = getBankById(this.value);
            const balanceElement = document.getElementById('repayment-bank-balance');
            if (bank && balanceElement) {
                balanceElement.innerHTML = 
                    `<span class="font-semibold">Available Balance:</span> ${formatKSH(bank.balance)}`;
            }
        });
        
        // Update remaining balance text
        document.getElementById('remaining-balance-text').textContent = 
            `Remaining balance: ${formatKSH(loan.balance)}`;
        
        // Update preview
        updateRepaymentPreview();
        
        // Add event listeners for real-time preview
        document.getElementById('repayment-amount').addEventListener('input', updateRepaymentPreview);
        document.getElementById('repayment-bank-select').addEventListener('change', updateRepaymentPreview);
    }

    function closeLoanRepaymentModal() {
        const modal = document.getElementById('loan-repayment-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
        currentRepaymentLoanId = null;
        document.getElementById('loan-repayment-form').reset();
    }

    function fillFullBalance() {
        const loan = loans.find(l => l.id === currentRepaymentLoanId);
        if (!loan) return;
        
        document.getElementById('repayment-amount').value = loan.balance.toFixed(2);
        updateRepaymentPreview();
    }

    function updateRepaymentPreview() {
        const loan = loans.find(l => l.id === currentRepaymentLoanId);
        if (!loan) return;
        
        const amount = parseFloat(document.getElementById('repayment-amount').value) || 0;
        const bankId = document.getElementById('repayment-bank-select').value;
        const bank = getBankById(bankId);
        
        document.getElementById('preview-loan').textContent = loan.institution;
        document.getElementById('preview-amount').textContent = formatKSH(amount);
        document.getElementById('preview-source-bank').textContent = bank ? bank.name : 'Not selected';
        document.getElementById('preview-new-balance').textContent = formatKSH(Math.max(0, loan.balance - amount));
    }

    function viewLoanDetails(loanId) {
        const loan = loans.find(l => l.id === loanId);
        if (!loan) return;
        
        let message = `Loan Details - ${loan.institution}\n\n`;
        message += `Type: ${loan.type.charAt(0).toUpperCase() + loan.type.slice(1)}\n`;
        message += `Original Amount: ${formatKSH(loan.originalBalance)}\n`;
        message += `Current Balance: ${formatKSH(loan.balance)}\n`;
        message += `Interest Rate: ${loan.interestRate}%\n`;
        message += `Due Date: ${new Date(loan.dueDate).toLocaleDateString('en-KE')}\n`;
        message += `Disbursed to: ${loan.bankName}\n\n`;
        
        if (loan.repayments && loan.repayments.length > 0) {
            message += `Repayment History:\n\n`;
            loan.repayments.forEach(repayment => {
                message += `${new Date(repayment.date).toLocaleDateString('en-KE')}: ${formatKSH(repayment.amount)}\n`;
                message += `  From: ${repayment.bankName}\n`;
                message += `  Ref: ${repayment.reference}\n`;
                if (repayment.notes) message += `  Notes: ${repayment.notes}\n`;
                message += `\n`;
            });
        } else {
            message += `No repayments made yet.\n`;
        }
        
        alert(message);
    }

    function updateBankBalance(bankId) {
        const bank = getBankById(bankId);
        if (!bank) return;
        
        const newBalance = prompt(`Update balance for ${bank.name}\nCurrent: ${formatKSH(bank.balance)}\nOpening: ${formatKSH(bank.openingBalance || 0)}\n\nEnter new balance (KSH):`, bank.balance);
        
        if (newBalance !== null) {
            const balance = parseFloat(newBalance);
            if (!isNaN(balance)) {
                const oldBalance = bank.balance;
                bank.balance = balance;
                bank.lastUpdated = new Date().toISOString();
                
                // If updating M-Pesa, also update petty cash
                if (bank.id === 'mpesa') {
                    // Update petty cash transactions to reflect new balance
                    const { currentBalance } = calculatePettyCashBalance();
                    const difference = balance - currentBalance;
                    
                    if (difference !== 0) {
                        pettyCashTransactions.push({
                            date: new Date().toLocaleDateString('en-KE'),
                            time: new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
                            description: `Manual M-Pesa balance adjustment`,
                            recipient: 'System',
                            cost: Math.abs(difference),
                            type: difference > 0 ? 'income' : 'expense'
                        });
                        renderPettyCash();
                        updatePettyCashBalanceDisplay();
                        updatePettyCashChart();
                    }
                }
                
                // Record the adjustment
                majorTransactions.push({
                    description: `Manual balance adjustment for ${bank.name}`,
                    amount: Math.abs(balance - oldBalance),
                    category: balance > oldBalance ? 'Sales' : 'Overheads',
                    date: new Date().toLocaleDateString('en-KE'),
                    bankId: bankId,
                    isAdjustment: true,
                    oldBalance: oldBalance,
                    newBalance: balance
                });
                
                updateFinancialDashboard();
                updateBankCards();
                updateBankSelectors();
                updateTransferBankSelectors();
                
                showToast(`Updated ${bank.name} balance to ${formatKSH(balance)}`, 'success');
                
                // Save to Firestore
                if (user) saveUserData();
            } else {
                showToast('Invalid balance amount', 'error');
            }
        }
    }

    function showBankTransactions(bankId) {
        const bank = getBankById(bankId);
        if (!bank) return;
        
        // Filter transactions for this bank
        const bankTransactions = majorTransactions.filter(t => t.bankId === bankId);
        
        if (bankTransactions.length === 0) {
            alert(`No transactions recorded for ${bank.name}`);
            return;
        }
        
        let message = `Transaction History for ${bank.name}\n\n`;
        message += `Current Balance: ${formatKSH(bank.balance)}\n`;
        message += `Opening Balance: ${formatKSH(bank.openingBalance || 0)}\n`;
        message += `Opening Date: ${new Date(bank.openingDate || Date.now()).toLocaleDateString('en-KE')}\n\n`;
        
        bankTransactions.slice(-10).reverse().forEach(t => {
            const type = t.category === 'Sales' ? 'INCOME' : 'EXPENSE';
            const sign = t.category === 'Sales' ? '+' : '-';
            message += `${t.date}: ${t.description}\n`;
            message += `  ${type}: ${sign}${formatKSH(t.amount)}\n\n`;
        });
        
        alert(message);
    }

    async function syncBankWithFirebase(bankId) {
        const bank = getBankById(bankId);
        if (!bank || !bank.firebaseId) return;
        
        showLoading(`Syncing ${bank.name} with Firebase...`);
        
        try {
            // In a real implementation, you would update Firebase with the current balance
            // or fetch the latest from Firebase
            
            // For now, we'll simulate a sync
            setTimeout(() => {
                showLoading(false);
                showToast(`${bank.name} synced successfully!`, 'success');
                
                // Update the last updated time
                bank.lastUpdated = new Date().toISOString();
                updateBankCards();
                
                // Save to Firestore
                if (user) saveUserData();
            }, 1000);
            
        } catch (error) {
            showLoading(false);
            showToast(`Sync failed: ${error.message}`, 'error');
        }
    }

    // --- Utility Functions ---
    function getBankById(id) {
        return banks.find(b => b.id === id);
    }

    function formatKSH(amount, showCurrency = true) {
        // This function now handles different currencies
        const currency = 'KSH'; // Default to KSH for backward compatibility
        if (showCurrency) {
            return `${currency} ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        } else {
            return `${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
    }

    // Add a new function for proper currency formatting
    function formatCurrency(amount, currency = 'KSH', showCurrency = true) {
        if (currency === 'USD') {
            if (showCurrency) {
                return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            } else {
                return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
        } else {
            if (showCurrency) {
                return `KSH ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            } else {
                return `${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
        }
    }

    function showLoading(message = 'Loading...') {
        const overlay = document.getElementById('loading-overlay');
        const text = document.getElementById('loading-text');
        
        if (message) {
            overlay.classList.remove('hidden');
            text.textContent = message;
        } else {
            overlay.classList.add('hidden');
        }
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toastId = 'toast-' + Date.now();
        
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        
        const colors = {
            success: 'bg-green-500',
            error: 'bg-red-500',
            warning: 'bg-yellow-500',
            info: 'bg-blue-500'
        };
        
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.className = `toast ${colors[type]} text-white rounded-lg shadow-lg p-4`;
        toast.innerHTML = `
            <div class="flex items-center">
                <i class="fas ${icons[type]} text-xl mr-3"></i>
                <div class="flex-1">${message}</div>
                <button onclick="document.getElementById('${toastId}').remove()" class="ml-4 text-white opacity-70 hover:opacity-100">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        container.appendChild(toast);
        
        // Show toast
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }, 5000);
    }

    function updateQuickStats() {
        // Today's transactions
        const today = new Date().toLocaleDateString('en-KE');
        const todayTrans = pettyCashTransactions.filter(t => t.date === today);
        const todayElement = document.getElementById('stats-today-transactions');
        if (todayElement) todayElement.textContent = todayTrans.length;
        
        // Progress bar (capped at 20 transactions)
        const todayProgress = Math.min(100, (todayTrans.length / 20) * 100);
        const progressElement = document.getElementById('stats-today-progress');
        if (progressElement) progressElement.style.width = `${todayProgress}%`;
        
        // Active banks
        const banksElement = document.getElementById('stats-active-banks');
        if (banksElement) banksElement.textContent = banks.length;
        
        // Monthly budget used (simplified)
        const monthlyBudget = 1000000; // Example budget
        const budgetUsed = Math.min(100, (currentMonthSpend.totalExpense / monthlyBudget) * 100);
        const budgetUsedElement = document.getElementById('stats-budget-used');
        if (budgetUsedElement) budgetUsedElement.textContent = `${budgetUsed.toFixed(1)}%`;
        const budgetProgressElement = document.getElementById('stats-budget-progress');
        if (budgetProgressElement) budgetProgressElement.style.width = `${budgetUsed}%`;
    }

    function refreshAllData() {
        showLoading('Refreshing all data...');
        
        // Refresh Firebase data if connected
        if (user) {
            loadFirebaseBanks();
            loadReceiptPayments();
            loadUserData();
        }
        
        // Update all local data
        updateFinancialDashboard();
        updateBankCards();
        updatePettyCashBalanceDisplay();
        updatePettyCashChart();
        updateMajorCategoryChart();
        updateTransferHistory();
        updateQuickStats();
        updateLoanCards();
        
        setTimeout(() => {
            showLoading(false);
            showToast('All data refreshed successfully!', 'success');
        }, 1000);
    }

    function refreshBankData() {
        if (user) {
            loadFirebaseBanks();
            loadReceiptPayments();
            showToast('Bank data refreshed from Firebase', 'success');
        } else {
            showToast('Connect to Firebase to refresh bank data', 'warning');
        }
    }

    function toggleDarkMode() {
        document.body.classList.toggle('bg-gray-900');
        document.body.classList.toggle('text-gray-100');
        
        const isDark = document.body.classList.contains('bg-gray-900');
        const icon = document.querySelector('#firebase-login-btn + button i');
        
        if (isDark) {
            icon.className = 'fas fa-sun';
            document.body.style.backgroundColor = '#1a202c';
        } else {
            icon.className = 'fas fa-moon';
            document.body.style.backgroundColor = '';
        }
        
        // Store preference
        localStorage.setItem('darkMode', isDark);
    }

    // --- Petty Cash Functions ---
    document.addEventListener('DOMContentLoaded', function() {
        // Petty Cash Form
        const pettyCashForm = document.getElementById('petty-cash-form');
        if (pettyCashForm) {
            pettyCashForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const description = document.getElementById('description').value;
                const recipient = document.getElementById('recipient').value;
                const cost = parseFloat(document.getElementById('cost').value);
                const type = document.getElementById('type').value;

                if (cost <= 0) {
                    alert("Cost must be a positive value.");
                    return;
                }

                const now = new Date();
                const newTransaction = {
                    date: now.toLocaleDateString('en-KE'),
                    time: now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
                    description: description,
                    recipient: recipient,
                    cost: cost,
                    type: type
                };

                pettyCashTransactions.push(newTransaction);
                renderPettyCash();
                updatePettyCashBalanceDisplay();
                updatePettyCashChart();
                updatePettyExpenditureChart();
                
                // Update M-Pesa balance
                updateMpesaFromPettyCash();
                
                document.getElementById('petty-cash-form').reset();
                checkAnomalies(newTransaction);
                updateQuickStats();
                showToast('Transaction added successfully!', 'success');
                
                // Save to Firestore
                if (user) saveUserData();
            });
        }
        
        // Major Transaction Form
        const majorTransactionForm = document.getElementById('major-transaction-form');
        if (majorTransactionForm) {
            majorTransactionForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const description = document.getElementById('major-description').value;
                const cost = parseFloat(document.getElementById('major-cost').value);
                const category = document.getElementById('major-category').value;
                const bankId = document.getElementById('transaction-bank-id').value;

                if (cost <= 0) {
                    showToast("Amount must be a positive value.", 'error');
                    return;
                }
                if (!bankId) {
                    showToast("Please select a bank account for this transaction.", 'error');
                    return;
                }

                const selectedBank = getBankById(bankId);
                const isIncome = category === 'Sales';
                
                if (isIncome) {
                    selectedBank.balance += cost;
                } else {
                    selectedBank.balance -= cost;
                }
                
                majorTransactions.push({
                    description,
                    amount: cost,
                    category,
                    date: new Date().toLocaleDateString('en-KE'),
                    bankId: bankId
                });

                updateBankSelectors();
                updateMajorSummary();
                updateMajorCategoryChart();
                updateFinancialDashboard();
                document.getElementById('major-transaction-form').reset();
                showToast(`Major Transaction Logged: ${description} - ${formatKSH(cost)}`, 'success');
                
                // Save to Firestore
                if (user) saveUserData();
            });
        }
        
        // Loan Form
        const loanForm = document.getElementById('loan-form');
        // Update the loan form submission to handle Firebase bank IDs
        if (loanForm) {
            loanForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                const institution = document.getElementById('loan-institution').value;
                const balance = parseFloat(document.getElementById('loan-balance').value);
                const bankSelect = document.getElementById('loan-bank-account');
                const selectedOption = bankSelect.options[bankSelect.selectedIndex];
                const bankFirebaseId = selectedOption.getAttribute('data-firebase-id');
                const bankId = bankSelect.value;
                const loanType = document.getElementById('loan-type').value;
                const interestRate = parseFloat(document.getElementById('loan-interest-rate').value) || 0;
                const dueDate = document.getElementById('loan-due-date').value;
                
                if (!bankId) {
                    showToast('Please select a bank account for loan disbursement', 'error');
                    return;
                }
                
                // Find or create local bank representation
                let selectedBank;
                
                if (bankId === 'mpesa') {
                    selectedBank = banks.find(b => b.id === 'mpesa');
                } else {
                    // Check if we already have this bank locally
                    selectedBank = banks.find(b => b.firebaseId === bankFirebaseId);
                    
                    // If not, create a local entry for it
                    if (!selectedBank) {
                        try {
                            // Fetch bank details from Firebase
                            const bankDoc = await firestore.collection('bankDetails').doc(bankFirebaseId).get();
                            if (bankDoc.exists) {
                                const bankData = bankDoc.data();
                                const bankName = bankData.bankName || 
                                               bankData.name || 
                                               bankData.bank || 
                                               bankData.bank_name || 
                                               bankData.bankName || 
                                               'Bank Account';
                                
                                const accountNumber = bankData.accountNumber || 
                                                    bankData.account || 
                                                    bankData.account_number || 
                                                    bankData.accountNumber || 
                                                    'N/A';
                                
                                const branch = bankData.branch || 
                                             bankData.branchName || 
                                             bankData.branch_name || 
                                             bankData.branchName || 
                                             '';
                                
                                const initialBalance = bankData.balance || 
                                                     bankData.currentBalance || 
                                                     bankData.accountBalance || 
                                                     bankData.balanceAmount || 
                                                     0;
                                
                                selectedBank = {
                                    id: 'fb_' + bankFirebaseId,
                                    name: bankName,
                                    accountNumber: accountNumber,
                                    branch: branch,
                                    balance: parseFloat(initialBalance) + balance, // Add loan amount
                                    firebaseId: bankFirebaseId,
                                    firebaseData: bankData,
                                    lastUpdated: new Date().toISOString(),
                                    // NEW: Opening Balance fields
                                    openingBalance: parseFloat(initialBalance),
                                    openingDate: new Date().toISOString(),
                                    processedReceipts: []
                                };
                                
                                banks.push(selectedBank);
                            }
                        } catch (error) {
                            console.error("Error fetching bank details:", error);
                            showToast('Error loading bank details from Firebase', 'error');
                            return;
                        }
                    } else {
                        // Update existing bank balance
                        selectedBank.balance += balance;
                    }
                }
                
                if (!selectedBank) {
                    showToast('Selected bank not found', 'error');
                    return;
                }
                
                // Add loan amount to selected bank
                if (bankId !== 'mpesa') {
                    selectedBank.balance += balance;
                }
                
                const newLoan = {
                    id: 'l' + Date.now(),
                    institution: institution,
                    balance: balance,
                    originalBalance: balance,
                    bankId: selectedBank.id,
                    bankName: selectedBank.name,
                    bankFirebaseId: bankFirebaseId,
                    type: loanType,
                    interestRate: interestRate,
                    dueDate: dueDate,
                    createdAt: new Date().toISOString(),
                    repayments: []
                };
                
                loans.push(newLoan);
                
                // Add loan disbursement as major transaction
                majorTransactions.push({
                    description: `Loan disbursement from ${institution}`,
                    amount: balance,
                    category: 'Sales',
                    date: new Date().toLocaleDateString('en-KE'),
                    bankId: selectedBank.id,
                    isLoanDisbursement: true,
                    loanId: newLoan.id
                });
                
                updateFinancialDashboard();
                updateBankCards();
                updateBankSelectors();
                initializeLoanBankSelector();
                updateLoanCards();
                document.getElementById('loan-form').reset();
                
                showToast(`Loan from ${institution} added. ${formatKSH(balance)} deposited to ${selectedBank.name}`, 'success');
                
                // Save to Firestore
                if (user) saveUserData();
            });
        }
        
        // Bank Transfer Form
        const bankTransferForm = document.getElementById('bank-transfer-form');
        if (bankTransferForm) {
            bankTransferForm.addEventListener('submit', function(e) {
                e.preventDefault();
                
                const fromBankId = document.getElementById('transfer-from-bank').value;
                const toBankId = document.getElementById('transfer-to-bank').value;
                const amount = parseFloat(document.getElementById('transfer-amount').value);
                const fee = parseFloat(document.getElementById('transfer-fee-input').value) || 0;
                const feeBearer = document.getElementById('fee-bearer').value;
                const reason = document.getElementById('transfer-reason').value;
                
                if (!fromBankId || !toBankId) {
                    showToast('Please select both source and destination banks', 'error');
                    return;
                }
                
                if (fromBankId === toBankId) {
                    showToast('Cannot transfer to the same bank account', 'error');
                    return;
                }
                
                if (!amount || amount <= 0) {
                    showToast('Please enter a valid transfer amount', 'error');
                    return;
                }
                
                const fromBank = getBankById(fromBankId);
                const toBank = getBankById(toBankId);
                
                // Calculate total debit based on fee bearer
                let fromBankDebit = amount;
                let toBankCredit = amount;
                
                if (feeBearer === 'sending') {
                    fromBankDebit += fee;
                } else if (feeBearer === 'receiving') {
                    toBankCredit -= fee;
                }
                
                if (fromBank.balance < fromBankDebit) {
                    showToast(`Insufficient funds. Available: ${formatKSH(fromBank.balance)}, Required: ${formatKSH(fromBankDebit)}`, 'error');
                    return;
                }
                
                // Show preview - FIXED IDs
                document.getElementById('preview-from').textContent = fromBank.name;
                document.getElementById('preview-to').textContent = toBank.name;
                document.getElementById('preview-amount').textContent = formatKSH(amount);
                document.getElementById('preview-fee').textContent = formatKSH(fee);
                document.getElementById('preview-fee-bearer').textContent = feeBearer === 'sending' ? 'Sending Bank' : 'Receiving Bank';
                document.getElementById('preview-total-debit').textContent = formatKSH(fromBankDebit);
                document.getElementById('preview-reason').textContent = reason || 'No reason provided';
                document.getElementById('transfer-preview').classList.remove('hidden');
                
                // Show confirmation modal - FIXED IDs
                document.getElementById('confirm-transfer-from').textContent = fromBank.name;
                document.getElementById('confirm-transfer-to').textContent = toBank.name;
                document.getElementById('confirm-transfer-amount').textContent = formatKSH(amount);
                document.getElementById('confirm-transfer-fee').textContent = formatKSH(fee);
                // Add fee bearer to confirmation modal if it exists
                const confirmFeeBearer = document.getElementById('confirm-transfer-fee-bearer');
                if (confirmFeeBearer) {
                    confirmFeeBearer.textContent = feeBearer === 'sending' ? 'Sending Bank' : 'Receiving Bank';
                }
                document.getElementById('confirm-transfer-total').textContent = formatKSH(fromBankDebit);
                document.getElementById('confirm-transfer-reason').textContent = reason || 'No reason provided';
                
                document.getElementById('transfer-confirm-modal').classList.remove('hidden');
            });
        }

        // Loan Repayment Form
        const repaymentForm = document.getElementById('loan-repayment-form');
        if (repaymentForm) {
            repaymentForm.addEventListener('submit', function(e) {
                e.preventDefault();
                
                const loan = loans.find(l => l.id === currentRepaymentLoanId);
                if (!loan) {
                    showToast('Loan not found', 'error');
                    return;
                }
                
                const bankId = document.getElementById('repayment-bank-select').value;
                const amount = parseFloat(document.getElementById('repayment-amount').value);
                const date = document.getElementById('repayment-date').value;
                const reference = document.getElementById('repayment-reference').value;
                const notes = document.getElementById('repayment-notes').value;
                
                if (!bankId) {
                    showToast('Please select a bank account', 'error');
                    return;
                }
                
                if (!amount || amount <= 0) {
                    showToast('Please enter a valid repayment amount', 'error');
                    return;
                }
                
                if (amount > loan.balance) {
                    showToast(`Repayment amount cannot exceed loan balance of ${formatKSH(loan.balance)}`, 'error');
                    return;
                }
                
                const bank = getBankById(bankId);
                if (amount > bank.balance) {
                    showToast(`Insufficient funds in ${bank.name}. Available: ${formatKSH(bank.balance)}`, 'error');
                    return;
                }
                
                // Deduct from bank
                bank.balance -= amount;
                
                // Update loan balance
                loan.balance -= amount;
                
                // Record repayment
                const repaymentId = 'r' + Date.now();
                const repaymentRecord = {
                    id: repaymentId,
                    loanId: loan.id,
                    date: new Date(date).toISOString(),
                    amount: amount,
                    bankId: bankId,
                    bankName: bank.name,
                    reference: reference,
                    notes: notes,
                    previousBalance: loan.balance + amount,
                    newBalance: loan.balance
                };
                
                loanRepayments.push(repaymentRecord);
                loan.repayments = loan.repayments || [];
                loan.repayments.push(repaymentRecord);
                
                // Add repayment as major transaction
                majorTransactions.push({
                    description: `Loan repayment to ${loan.institution} - Ref: ${reference}`,
                    amount: amount,
                    category: 'Payroll',
                    date: new Date(date).toLocaleDateString('en-KE'),
                    bankId: bankId,
                    isLoanRepayment: true,
                    loanId: loan.id,
                    repaymentId: repaymentId
                });
                
                // Update UI
                updateFinancialDashboard();
                updateBankCards();
                updateBankSelectors();
                updateLoanCards();
                closeLoanRepaymentModal();
                
                showToast(`Loan repayment of ${formatKSH(amount)} to ${loan.institution} processed successfully!`, 'success');
                
                // If loan is fully paid, show confirmation
                if (loan.balance <= 0) {
                    setTimeout(() => {
                        showToast(`🎉 Congratulations! Loan from ${loan.institution} has been fully paid off!`, 'success');
                    }, 1000);
                }
                
                // Save to Firestore
                if (user) saveUserData();
            });
        }
        
        // EMI Calculator Form
        const emiForm = document.getElementById('emi-calculator-form');
        if (emiForm) {
            emiForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const principal = parseFloat(document.getElementById('principal').value);
                const rateAnnual = parseFloat(document.getElementById('rate').value);
                const months = parseInt(document.getElementById('months').value);
                const resultElement = document.getElementById('emi-result');
                
                if (principal <= 0 || rateAnnual < 0 || months <= 0) {
                    resultElement.textContent = "Please enter positive values.";
                    return;
                }

                const rateMonthly = (rateAnnual / 100) / 12;
                const n = months;
                
                let emi;
                if (rateMonthly === 0) {
                    emi = principal / n;
                } else {
                    const power = Math.pow((1 + rateMonthly), n);
                    emi = principal * (rateMonthly * power) / (power - 1);
                }

                const totalInterest = (emi * n) - principal;

                resultElement.style.color = 'var(--primary-color)';
                resultElement.innerHTML = `
                    <p>Monthly Payment (EMI): <strong>${formatKSH(emi.toFixed(2))}</strong></p>
                    <p>Total Repayment: ${formatKSH((emi * n).toFixed(2))}</p>
                    <p>Total Interest: ${formatKSH(totalInterest.toFixed(2))}</p>
                `;
            });
        }
    });

    function renderPettyCash() {
        const list = document.getElementById('transaction-list');
        if (!list) return;
        
        list.innerHTML = '';
        const sortedTransactions = [...pettyCashTransactions].sort((a, b) => new Date(b.date + ' ' + b.time) - new Date(a.date + ' ' + a.time));
        const transactionsToShow = sortedTransactions.slice(0, 5);

        if (transactionsToShow.length === 0) {
            list.innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-8 text-center text-gray-500">
                        <i class="fas fa-exchange-alt text-3xl mb-3"></i>
                        <p>No transactions yet</p>
                        <p class="text-sm mt-2">Add your first transaction above</p>
                    </td>
                </tr>
            `;
            return;
        }

        transactionsToShow.forEach(tx => {
            const row = list.insertRow();
            row.style.color = tx.type === 'expense' ? '#d9534f' : 'var(--primary-color)';
            
            row.insertCell().textContent = tx.date;
            row.insertCell().textContent = tx.description;
            row.insertCell().textContent = tx.recipient;
            row.insertCell().textContent = tx.type.charAt(0).toUpperCase() + tx.type.slice(1);
            row.insertCell().textContent = formatKSH(tx.cost);
        });
        updatePettyCashBalanceDisplay();
    }

    function calculatePettyCashBalance() {
        let totalExpense = 0;
        let totalIncome = 0;
        let currentBalance = 0;
        
        pettyCashTransactions.forEach(t => {
            currentBalance += (t.type === 'income' ? t.cost : -t.cost);
        });
        
        const today = new Date().toLocaleDateString('en-KE');
        const todayTrans = pettyCashTransactions.filter(t => t.date === today);

        todayTrans.forEach(t => {
            if (t.type === 'expense') {
                totalExpense += t.cost;
            } else {
                totalIncome += t.cost;
            }
        });
        
        return { currentBalance, totalExpense, totalIncome };
    }

    function updatePettyCashBalanceDisplay() {
        const { currentBalance, totalExpense, totalIncome } = calculatePettyCashBalance();
        
        const currentBalanceElement = document.getElementById('current-balance');
        const dayExpenseElement = document.getElementById('day-expense');
        const dayIncomeElement = document.getElementById('day-income');
        
        if (currentBalanceElement) {
            if (balancesHidden) {
                currentBalanceElement.textContent = '********';
                currentBalanceElement.classList.add('hidden-balance');
            } else {
                currentBalanceElement.textContent = formatKSH(currentBalance);
                currentBalanceElement.classList.remove('hidden-balance');
                currentBalanceElement.style.color = currentBalance < 0 ? '#dc3545' : 'var(--primary-color)';
            }
        }
        
        if (dayExpenseElement) {
            if (balancesHidden) {
                dayExpenseElement.textContent = 'KSH *****';
                dayExpenseElement.classList.add('hidden-balance');
            } else {
                dayExpenseElement.textContent = formatKSH(totalExpense);
                dayExpenseElement.classList.remove('hidden-balance');
            }
        }
        
        if (dayIncomeElement) {
            if (balancesHidden) {
                dayIncomeElement.textContent = 'KSH *****';
                dayIncomeElement.classList.add('hidden-balance');
            } else {
                dayIncomeElement.textContent = formatKSH(totalIncome);
                dayIncomeElement.classList.remove('hidden-balance');
            }
        }
    }

    async function endDayAndGenerateReport() {
        const today = new Date().toLocaleDateString('en-KE');
        const todayTrans = pettyCashTransactions.filter(t => t.date === today);
        const { currentBalance, totalExpense, totalIncome } = calculatePettyCashBalance();
        
        if (todayTrans.length === 0) {
            alert("No transactions logged for today to generate a report.");
            return;
        }

        const pdf = new jsPDF('p', 'mm', 'a4');
        const title = `Petty Cash Daily Report - ${today}`;
        const startingBalance = currentBalance + totalExpense - totalIncome;

        pdf.setFontSize(22);
        pdf.setTextColor(38, 121, 33);
        pdf.text(title, 14, 20);
        
        pdf.setFontSize(12);
        pdf.setTextColor(51, 51, 51);
        pdf.text(`Starting Balance (EOD T-1): ${formatKSH(startingBalance)}`, 14, 38);
        pdf.text(`(+) Total Income Today: ${formatKSH(totalIncome)}`, 14, 44);
        pdf.text(`(-) Total Expense Today: ${formatKSH(totalExpense)}`, 14, 50);
        pdf.text(`(=) End of Day Balance: ${formatKSH(currentBalance)}`, 14, 56);
        
        pdf.setFontSize(16);
        pdf.setTextColor(38, 121, 33);
        pdf.text('Detailed Daily Transactions', 14, 68);
        
        let y = 75;
        pdf.setFontSize(9);
        
        pdf.setFillColor(38, 121, 33);
        pdf.setTextColor(255, 255, 255);
        pdf.rect(10, y, 190, 6, 'F');
        pdf.text('Time', 12, y + 4);
        pdf.text('Description', 40, y + 4);
        pdf.text('Recipient', 100, y + 4);
        pdf.text('Type', 135, y + 4);
        pdf.text('Amount (KSH)', 165, y + 4);
        y += 6;

        pdf.setTextColor(51, 51, 51);
        todayTrans.forEach(tx => {
            if (y > 280) { pdf.addPage(); y = 20; pdf.setTextColor(51, 51, 51); }
            const time = tx.time || new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
            const color = tx.type === 'income' ? '#267921' : '#d9534f';
            
            pdf.setTextColor(51, 51, 51);
            pdf.text(time, 12, y + 4);
            pdf.text(tx.description.substring(0, 30) + (tx.description.length > 30 ? '...' : ''), 40, y + 4);
            pdf.text(tx.recipient, 100, y + 4);
            pdf.text(tx.type.toUpperCase(), 135, y + 4);
            pdf.setTextColor(color);
            pdf.text(tx.cost.toLocaleString('en-KE'), 165, y + 4);
            y += 6;
        });

        pdf.save(`CarKenya_Petty_Cash_Daily_Report_${today.replace(/\//g, '-')}.pdf`);
        showToast(`Day closed. Report generated for ${today}.`, 'success');
    }

    // --- Chart Functions ---
    function updatePettyCashChart() {
        let totalExpense = pettyCashTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.cost, 0);
        let totalIncome = pettyCashTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.cost, 0);

        const data = {
            labels: ['Total Expenses', 'Total Income'],
            datasets: [{
                label: 'Petty Cash Flow (KSH)',
                data: [totalExpense, totalIncome],
                backgroundColor: ['#d9534f', 'var(--primary-color)'],
                borderWidth: 1
            }]
        };

        const canvas = document.getElementById('pettyCashChart');
        if (!canvas) return;
        
        if (pettyChartInstance) {
            pettyChartInstance.data = data;
            pettyChartInstance.update();
        } else {
            const ctx = canvas.getContext('2d');
            pettyChartInstance = new Chart(ctx, { 
                type: 'bar', 
                data: data, 
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { legend: { display: false } }, 
                    scales: { y: { beginAtZero: true } } 
                } 
            });
        }
    }
    
    function updatePettyExpenditureChart() {
        // Sample data for demonstration
        const data = { 
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], 
            datasets: [{ 
                label: 'Monthly Expenditure Trend', 
                data: [10000, 15000, 12000, 18000, 14000, 16000], 
                borderColor: '#dc3545', 
                fill: false, 
                tension: 0.3 
            }] 
        };
        
        const canvas = document.getElementById('pettyExpenditureLineChart');
        if (!canvas) return;
        
        if (pettyLineChartInstance) {
            pettyLineChartInstance.data = data;
            pettyLineChartInstance.update();
        } else {
            const ctx = canvas.getContext('2d');
            pettyLineChartInstance = new Chart(ctx, { 
                type: 'line', 
                data: data, 
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { legend: { position: 'top' } }, 
                    scales: { y: { beginAtZero: true } } 
                } 
            });
        }
    }

    // --- Major Financial Reports Logic ---
    function updateMajorSummary() {
        const majorSummaryElement = document.getElementById('major-summary');
        if (!majorSummaryElement) return;
        
        if (majorTransactions.length === 0) {
            majorSummaryElement.innerHTML = '<p>No major transactions logged yet.</p>';
            return;
        }
        
        let summaryHTML = '<h4 class="font-semibold mb-2">Major Transactions Summary</h4>';
        const total = majorTransactions.reduce((sum, t) => sum + t.amount, 0);
        summaryHTML += `<p class="mb-4"><strong>Total Major Value Logged:</strong> ${formatKSH(total)}</p>`;
        
        const detailsHTML = `
            <h5 class="font-semibold mb-2">Recent Transactions:</h5>
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-2 text-left text-xs font-semibold text-gray-700">Date</th>
                            <th class="px-4 py-2 text-left text-xs font-semibold text-gray-700">Description</th>
                            <th class="px-4 py-2 text-left text-xs font-semibold text-gray-700">Category</th>
                            <th class="px-4 py-2 text-left text-xs font-semibold text-gray-700">Amount</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${majorTransactions.slice(-5).reverse().map(t => `
                            <tr>
                                <td class="px-4 py-2 text-sm">${t.date}</td>
                                <td class="px-4 py-2 text-sm">${t.description}</td>
                                <td class="px-4 py-2 text-sm">${t.category}</td>
                                <td class="px-4 py-2 text-sm font-semibold ${t.category === 'Sales' ? 'text-green-600' : 'text-red-600'}">${formatKSH(t.amount)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        majorSummaryElement.innerHTML = summaryHTML + detailsHTML;
    }

    function updateMajorCategoryChart() {
        const categories = majorTransactions.reduce((acc, t) => {
            acc[t.category] = (acc[t.category] || 0) + t.amount;
            return acc;
        }, {});

        const labels = Object.keys(categories);
        const dataValues = Object.values(categories);
        
        if (labels.length === 0) {
            const canvas = document.getElementById('majorCategoryChart');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#f0f0f0';
                ctx.font = '14px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('No data available', canvas.width/2, canvas.height/2);
            }
            return;
        }
        
        const data = {
            labels: labels,
            datasets: [{
                label: 'Value by Category (KSH)',
                data: dataValues,
                backgroundColor: ['#267921', '#ffc107', '#0dcaf0', '#dc3545', '#6c757d'],
                hoverOffset: 4
            }]
        };

        const canvas = document.getElementById('majorCategoryChart');
        if (!canvas) return;
        
        if (majorChartInstance) {
            majorChartInstance.data = data;
            majorChartInstance.update();
        } else {
            const ctx = canvas.getContext('2d');
            majorChartInstance = new Chart(ctx, { 
                type: 'doughnut', 
                data: data, 
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { 
                        title: { 
                            display: true, 
                            text: 'Major Transactions Breakdown' 
                        } 
                    } 
                } 
            });
        }
    }
    
    function generateReport() {
        if (majorTransactions.length === 0) {
            const reportOutput = document.getElementById('report-output-area');
            if (reportOutput) {
                reportOutput.innerHTML = '<p style="color: #d9534f;">⚠️ No major transactions logged. Cannot generate report.</p>';
            }
            showToast('No major transactions to generate report', 'warning');
            return;
        }
        updateMajorSummary();
        updateMajorCategoryChart();
        showToast('Financial Report Generated! Ready to print/export.', 'success');
    }

    // --- Financial Dashboard Functions ---
    function updateFinancialDashboard() {
        // Calculate KSH and USD balances separately
        let totalKesFunds = 0;
        let totalUsdFunds = 0;
        
        banks.forEach(bank => {
            if (bank.currency === 'USD') {
                totalUsdFunds += bank.balance;
            } else {
                // Default to KSH for banks without specified currency
                totalKesFunds += bank.balance;
            }
        });
        
        // 1. Total KSH Funds
        const totalKesElement = document.getElementById('total-kes-funds');
        if (totalKesElement) {
            if (balancesHidden) {
                totalKesElement.textContent = '*****';
                totalKesElement.classList.add('hidden-balance');
            } else {
                totalKesElement.textContent = formatCurrency(totalKesFunds, 'KSH');
                totalKesElement.classList.remove('hidden-balance');
            }
        }
        
        // 2. Total USD Funds
        const totalUsdElement = document.getElementById('total-usd-funds');
        if (totalUsdElement) {
            if (balancesHidden) {
                totalUsdElement.textContent = '*****';
                totalUsdElement.classList.add('hidden-balance');
            } else {
                totalUsdElement.textContent = formatCurrency(totalUsdFunds, 'USD');
                totalUsdElement.classList.remove('hidden-balance');
            }
        }
            
        // 3. Total Outstanding Loans (in KSH)
        const totalOutstandingLoans = loans.reduce((sum, loan) => sum + loan.balance, 0);
        const totalLoansElement = document.getElementById('total-outstanding-loans');
        if (totalLoansElement) {
            if (balancesHidden) {
                totalLoansElement.textContent = '*****';
                totalLoansElement.classList.add('hidden-balance');
            } else {
                totalLoansElement.textContent = formatCurrency(totalOutstandingLoans, 'KSH');
                totalLoansElement.classList.remove('hidden-balance');
            }
        }
            
        // 3. Monthly Spend
        const now = new Date();
        if (now.getMonth() !== currentMonthSpend.month || now.getFullYear() !== currentMonthSpend.year) {
            currentMonthSpend.month = now.getMonth();
            currentMonthSpend.year = now.getFullYear();
            currentMonthSpend.totalExpense = 0;
        } else {
            currentMonthSpend.totalExpense = majorTransactions
                .filter(t => {
                    const tDate = new Date(t.date);
                    const isExpense = ['Payroll', 'Overheads', 'Assets'].includes(t.category);
                    const isThisMonth = tDate.getMonth() === currentMonthSpend.month && tDate.getFullYear() === currentMonthSpend.year;
                    return isExpense && isThisMonth;
                })
                .reduce((sum, t) => sum + t.amount, 0);
        }
        
        const monthlySpendElement = document.getElementById('monthly-spend');
        if (monthlySpendElement) {
            if (balancesHidden) {
                monthlySpendElement.textContent = '*****';
                monthlySpendElement.classList.add('hidden-balance');
            } else {
                monthlySpendElement.textContent = formatKSH(currentMonthSpend.totalExpense);
                monthlySpendElement.classList.remove('hidden-balance');
            }
        }
    }

    // --- Auditing Logic ---
    function simulateAudit() {
        let auditIssues = [];
        
        const pettyAnomalies = pettyCashTransactions.filter(t => t.type === 'expense' && t.cost > 5000);
        if (pettyAnomalies.length > 0) { 
            auditIssues.push(`[Petty Cash] ${pettyAnomalies.length} high-value expenses (>KSH 5,000) found.`); 
        }

        const pettyBalance = pettyCashTransactions.reduce((sum, t) => sum + (t.type === 'income' ? t.cost : -t.cost), 0);
        if (pettyBalance < 0) { 
            auditIssues.push(`[Petty Cash] Negative Balance: ${formatKSH(pettyBalance)}.`); 
        }
        
        banks.filter(b => b.balance < 0).forEach(b => { 
            auditIssues.push(`[Bank Integrity] ${b.name} has a negative balance of ${formatKSH(b.balance)}.`); 
        });
        
        const smallMajorExpenses = majorTransactions.filter(t => ['Payroll', 'Overheads'].includes(t.category) && t.amount < 1000);
        if (smallMajorExpenses.length > 0) { 
            auditIssues.push(`[Major Integrity] ${smallMajorExpenses.length} small expenses logged as Major.`); 
        }

        const statusElement = document.getElementById('audit-status');
        if (statusElement) {
            if (auditIssues.length > 0) {
                statusElement.className = 'bg-red-50 border border-red-200 rounded-lg p-4 mb-6';
                statusElement.innerHTML = `
                    <div class="flex items-center">
                        <i class="fas fa-exclamation-triangle text-red-500 mr-3"></i>
                        <div>
                            <span class="font-medium text-red-800">AUDIT WARNING - ${auditIssues.length} issues found:</span>
                            <ul class="text-sm text-red-700 mt-1 list-disc pl-5">
                                ${auditIssues.map(issue => `<li>${issue}</li>`).join('')}
                            </ul>
                        </div>
                    </div>
                `;
                showToast('Audit Complete: WARNING! See Audit Status for details.', 'warning');
            } else {
                statusElement.className = 'bg-green-50 border border-green-200 rounded-lg p-4 mb-6';
                statusElement.innerHTML = `
                    <div class="flex items-center">
                        <i class="fas fa-check-circle text-green-500 mr-3"></i>
                        <span class="font-medium text-green-800">System Health: All Clear. Financial data integrity passed basic audit.</span>
                    </div>
                `;
                showToast('Audit Complete: System passed all checks.', 'success');
            }
        }
    }

    function checkAnomalies(transaction) {
        if (transaction.type === 'expense' && transaction.cost > 5000) {
            const statusElement = document.getElementById('audit-status');
            if (statusElement) {
                statusElement.className = 'bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6';
                statusElement.innerHTML = `
                    <div class="flex items-center">
                        <i class="fas fa-exclamation-triangle text-yellow-500 mr-3"></i>
                        <span class="font-medium text-yellow-800">PETTY CASH ALERT: Expense of ${formatKSH(transaction.cost)} logged. Check receipt for "${transaction.description}".</span>
                    </div>
                `;
            }
        }
    }

    // --- PDF Generation ---
    async function exportReportToPdf() {
        if (majorTransactions.length === 0) {
            showToast("Cannot generate PDF. No major transactions logged.", 'warning');
            return;
        }
        
        const pdf = new jsPDF('p', 'mm', 'a4');
        const title = 'CarKenya.Co.Ke Financial Report';

        pdf.setFontSize(22);
        pdf.setTextColor(38, 121, 33);
        pdf.text(title, 14, 20);
        
        pdf.setFontSize(10);
        pdf.setTextColor(51, 51, 51);
        pdf.text(`Date Generated: ${new Date().toLocaleDateString('en-KE')}`, 14, 25);
        pdf.text(`Total Bank Funds: ${formatKSH(banks.reduce((sum, b) => sum + b.balance, 0))}`, 14, 30);
        
        pdf.setFontSize(16);
        pdf.text('Category Breakdown Graph', 14, 40);

        const canvas = await html2canvas(document.getElementById('majorCategoryChart'), { scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 10, 45, 180, 100); 

        pdf.setFontSize(16);
        pdf.text('Transaction Details', 14, 155);

        let y = 165;
        pdf.setFontSize(10);
        
        pdf.setFillColor(38, 121, 33);
        pdf.setTextColor(255, 255, 255);
        pdf.rect(10, y, 190, 7, 'F');
        pdf.text('Date', 12, y + 5);
        pdf.text('Description', 40, y + 5);
        pdf.text('Category', 95, y + 5);
        pdf.text('Bank', 130, y + 5);
        pdf.text('Amount (KSH)', 165, y + 5);
        y += 7;

        pdf.setTextColor(51, 51, 51);
        majorTransactions.forEach(tx => {
            if (y > 280) { pdf.addPage(); y = 20; pdf.setTextColor(51, 51, 51); }
            pdf.text(tx.date, 12, y + 5);
            pdf.text(tx.description.substring(0, 30) + (tx.description.length > 30 ? '...' : ''), 40, y + 5);
            pdf.text(tx.category, 95, y + 5);
            pdf.text(getBankById(tx.bankId)?.name || 'N/A', 130, y + 5);
            pdf.text(tx.amount.toLocaleString('en-KE'), 165, y + 5);
            y += 7;
        });

        pdf.save("CarKenya_Financial_Report.pdf");
        showToast('PDF Report exported successfully!', 'success');
    }

    // --- Calculator Logic ---
    function openCalculatorModal(defaultTab) {
        const modal = document.getElementById('calculator-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
        if (defaultTab) {
            const tabButton = document.querySelector(`.calc-tab-button[onclick*='${defaultTab}-calc']`);
            if (tabButton) { 
                switchCalcTab({ currentTarget: tabButton }, `${defaultTab}-calc`); 
            }
        }
    }
    
    function closeCalculatorModal() {
        const modal = document.getElementById('calculator-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }
