// Import Firebase modules for Authentication and Firestore
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithCustomToken, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig as localFirebaseConfig } from './firebase-config.js'; 

const isCanvasEnvironment = typeof __app_id !== 'undefined';
const appId = isCanvasEnvironment ? __app_id : localFirebaseConfig.projectId || 'default-app-id';

let canvasConfig = {};
if (isCanvasEnvironment && typeof __firebase_config !== 'undefined' && __firebase_config) {
    try {
        canvasConfig = JSON.parse(__firebase_config);
    } catch (e) {
        console.error("Error parsing __firebase_config:", e);
    }
}
const firebaseConfig = isCanvasEnvironment ? canvasConfig : localFirebaseConfig;
const initialAuthToken = isCanvasEnvironment ? (typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null) : null;

let auth, db;
let userId = null;
let monthlyBudget = 0;
let expensesData = [];
let unsubscribeListeners = [];

const $ = id => document.getElementById(id);
const formatCurrency = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function showMessage(text, isError = false) {
    const box = $('messageBox');
    const textEl = $('messageText');
    if (!box || !textEl) return;
    box.classList.remove('translate-x-full', 'bg-blue-600', 'bg-red-600');
    box.classList.add(isError ? 'bg-red-600' : 'bg-blue-600');
    textEl.textContent = text;
    box.classList.remove('translate-x-full');
    setTimeout(() => box.classList.add('translate-x-full'), 3000);
}

window.togglePassword = function(id) {
    const input = $(id);
    const icon = input.nextElementSibling;
    if (!input || !icon) return;
    if (input.type === "password") {
        input.type = "text";
        icon.setAttribute('data-lucide', 'eye');
    } else {
        input.type = "password";
        icon.setAttribute('data-lucide', 'eye-off');
    }
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
};

const views = {
    landing: $('landingView'),
    login: $('loginForm'),
    signup: $('signupForm'),
    dashboard: $('dashboardView'),
    expenses: $('expensesView'),
    'add-expense': $('addExpenseView')
};
const mainViews = ['landing', 'dashboard', 'expenses', 'add-expense'];
const protectedViews = ['dashboard', 'expenses', 'add-expense'];
let currentView = 'landing';

function showView(viewName) {
    if (protectedViews.includes(viewName) && !userId) {
        showView('login');
        return;
    }
    currentView = viewName;
    mainViews.forEach(v => views[v]?.classList.add('hidden'));

    const authContainer = $('authView');
    const isAuthView = viewName === 'login' || viewName === 'signup';
    if (isAuthView) {
        authContainer?.classList.remove('hidden');
        views.login?.classList.add('hidden');
        views.signup?.classList.add('hidden');
        views[viewName]?.classList.remove('hidden');
    } else {
        authContainer?.classList.add('hidden');
        views[viewName]?.classList.remove('hidden');
    }

    const isAuthenticated = !!userId;
    const isPublicView = viewName === 'landing' || isAuthView;

    if (isPublicView) {
        $('dashboardNav')?.classList.add('hidden');
        $('userNav')?.classList.add('hidden');
        $('authNav')?.classList.remove('hidden');
    } else {
        $('dashboardNav')?.classList.remove('hidden');
        $('userNav')?.classList.remove('hidden');
        $('authNav')?.classList.add('hidden');
    }

    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

async function initializeFirebase() {
    if (!firebaseConfig || Object.keys(firebaseConfig).length === 0) {
        showMessage("Missing Firebase configuration.", true);
        $('loadingOverlay')?.classList.add('hidden');
        showView('landing');
        return;
    }

    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        if (isCanvasEnvironment && initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else if (!isCanvasEnvironment) {
            try {
                const { signInAnonymously } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
                await signInAnonymously(auth);
            } catch {}
        }

        onAuthStateChanged(auth, handleAuthStateChange);
    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        showMessage("Firebase init failed.", true);
        $('loadingOverlay')?.classList.add('hidden');
        showView('landing');
    }
}

function clearListeners() {
    unsubscribeListeners.forEach(unsub => unsub());
    unsubscribeListeners = [];
}

function handleAuthStateChange(user) {
    $('loadingOverlay')?.classList.add('hidden');
    clearListeners();
    if (user) {
        userId = user.uid;
        $('userEmail').textContent = user.email || 'Guest User';
        showView(protectedViews.includes(currentView) ? currentView : 'dashboard');
        startDataListeners(user.uid);
    } else {
        userId = null;
        currentView = 'landing';
        showView('landing');
    }
}

async function handleSignUp() {
    const name = $('signupName').value;
    const email = $('signupEmail').value;
    const password = $('signupPassword').value;
    const confirmPassword = $('confirmPassword').value;

    if (!name || !email || !password || !confirmPassword) return showMessage('All fields required.', true);
    if (password !== confirmPassword) return showMessage('Passwords do not match.', true);
    if (password.length < 6) return showMessage('Password too short.', true);

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, `artifacts/${appId}/users/${userCredential.user.uid}/profiles/main`), {
            name, email, createdAt: serverTimestamp()
        });
        showMessage('Account created successfully!');
    } catch (e) {
        console.error("Signup error:", e);
        showMessage(e.message, true);
    }
}

async function handleSignIn() {
    const email = $('loginEmail').value;
    const password = $('loginPassword').value;
    if (!email || !password) return showMessage('Enter email & password.', true);
    try {
        await signInWithEmailAndPassword(auth, email, password);
        showMessage('Signed in successfully!');
    } catch {
        showMessage('Login failed.', true);
    }
}

async function handleLogout() {
    try {
        await signOut(auth);
        showMessage('Logged out.');
    } catch {
        showMessage('Logout failed.', true);
    }
}

function startDataListeners(uid) {
    const budgetRef = doc(db, `artifacts/${appId}/users/${uid}/budgets/main`);
    const unsubBudget = onSnapshot(budgetRef, docSnap => {
        monthlyBudget = docSnap.exists() ? docSnap.data().monthlyBudget || 0 : 3000;
        if (!docSnap.exists()) setDoc(budgetRef, { monthlyBudget, createdAt: serverTimestamp() }, { merge: true });
        renderSummary();
    });
    unsubscribeListeners.push(unsubBudget);

    const expensesRef = collection(db, `artifacts/${appId}/users/${uid}/expenses`);
    const unsubExpenses = onSnapshot(expensesRef, querySnapshot => {
        expensesData = [];
        querySnapshot.forEach(doc => expensesData.push({ id: doc.id, ...doc.data() }));
        expensesData.sort((a, b) => new Date(b.date) - new Date(a.date));
        renderSummary();
        if (!views.expenses.classList.contains('hidden')) renderExpensesList();
    });
    unsubscribeListeners.push(unsubExpenses);
}

function renderSummary() {
    if (!userId) return;
    const now = new Date();
    const thisMonth = now.getMonth(), thisYear = now.getFullYear();
    const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
    const lastMonth = lastMonthDate.getMonth(), lastYear = lastMonthDate.getFullYear();

    let totalThisMonth = 0, totalLastMonth = 0, highestExpense = 0;
    expensesData.forEach(e => {
        const d = new Date(e.date);
        const amt = Number(e.amount) || 0;
        // treat positive amounts as expenses (your UI lists Income as separate category)
        if (amt > 0) {
            if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) totalThisMonth += amt;
            if (d.getMonth() === lastMonth && d.getFullYear() === lastYear) totalLastMonth += amt;
            if (amt > highestExpense) highestExpense = amt;
        }
    });

    const remaining = Math.max(0, monthlyBudget - totalThisMonth);
    const utilization = monthlyBudget > 0 ? Math.round((totalThisMonth / monthlyBudget) * 100) : 0;
    const changePct = totalLastMonth === 0 ? 0 : Math.round(((totalThisMonth - totalLastMonth) / lastMonth === 0 ? 1 : totalLastMonth) * 100);

    $('budgetDisplay').textContent = formatCurrency(monthlyBudget);
    $('remainingDisplay').textContent = formatCurrency(remaining);
    $('totalThisMonth').textContent = formatCurrency(totalThisMonth);
    $('totalLastMonth').textContent = formatCurrency(totalLastMonth);
    $('highestExpense').textContent = formatCurrency(highestExpense);

    $('utilizationPct').textContent = `${utilization}%`;
    $('utilizationFill').style.width = `${Math.min(100, utilization)}%`;
    $('utilizationFill').className = `h-full rounded-lg ${utilization > 100 ? 'bg-red-500' : utilization > 80 ? 'bg-yellow-500' : 'bg-blue-500'}`;

    const changeColor = changePct < 0 ? 'text-green-500' : changePct > 0 ? 'text-red-500' : 'text-gray-500';
    $('changePct').textContent = `${changePct >= 0 ? '+' : ''}${changePct}%`;
    $('changeIcon').className = `${changeColor} h-6 w-6`;

    if (typeof lucide !== 'undefined' && $('changeIcon')) {
        $('changeIcon').setAttribute('data-lucide', changePct > 0 ? 'trending-up' : changePct < 0 ? 'trending-down' : 'minus');
        lucide.createIcons();
    }

    // Update charts
    try {
        updateCharts();
    } catch (e) {
        console.error("Chart update error:", e);
    }

    // Budget exceeded notification (show once per month)
    checkAndNotifyBudgetExceeded(totalThisMonth);
}

function renderExpensesList() {
    const tbody = $('expensesTableBody');
    if (!tbody) return;
    if (expensesData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">No expenses recorded yet.</td></tr>';
        return;
    }
    tbody.innerHTML = expensesData.map(d => {
        const isExpense = Number(d.amount) > 0;
        const amountColor = isExpense ? 'text-red-600' : 'text-green-600';
        const title = d.title || d.category;
        return `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 text-sm font-medium text-gray-900">${title}</td>
                <td class="px-6 py-4 text-sm ${amountColor} font-semibold">${formatCurrency(d.amount)}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${d.category}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${d.date}</td>
                <td class="px-6 py-4 text-sm text-gray-500 truncate">${d.note || '-'}</td>
            </tr>`;
    }).join('');
}

// EDIT BUDGET
async function handleUpdateBudget() {
    if (!userId) return showMessage('You must be logged in.', true);
    const val = prompt('Enter your new monthly budget:');
    const num = Number(val);
    if (!val || isNaN(num) || num <= 0) return showMessage('Invalid number.', true);
    try {
        const budgetRef = doc(db, `artifacts/${appId}/users/${userId}/budgets/main`);
        await setDoc(budgetRef, { monthlyBudget: num }, { merge: true });
        showMessage('Budget updated!');
    } catch (e) {
        console.error("Budget update error:", e);
        showMessage('Failed to update budget.', true);
    }
}

// ADD EXPENSE
async function handleAddExpense(e) {
    e.preventDefault();
    if (!userId) return showMessage('You must be logged in.', true);

    const amount = Number($('expenseAmount').value);
    const category = $('expenseCategory').value;
    const date = $('expenseDate').value;
    const note = $('expenseNote').value;
    const derivedTitle = category;

    if (!amount || !category || !date) return showMessage('Fill all fields.', true);

    try {
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/expenses`), {
            userId, title: derivedTitle, amount, category, date, note, createdAt: serverTimestamp()
        });
        showMessage('Expense recorded!');
        $('addExpenseForm').reset();
        showView('expenses');
    } catch (err) {
        console.error("Error adding expense:", err);
        showMessage('Error recording expense.', true);
    }
}

/* ---------------------------
   Chart handling
   --------------------------- */
let categoryChart = null;
let monthlyTrendChart = null;
let alertShownFor = null; // format "YYYY-MM" when notification was shown

function ensureChartsExist() {
    // Category chart (doughnut)
    const catCtx = document.getElementById('categoryChart');
    if (catCtx && !categoryChart) {
        categoryChart = new Chart(catCtx, {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: undefined // Chart will auto-assign palette
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: { mode: 'index' }
                }
            }
        });
    }

    const monCtx = document.getElementById('monthlyTrendChart');
    if (monCtx && !monthlyTrendChart) {
        monthlyTrendChart = new Chart(monCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Spending',
                    data: [],
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }
}

function updateCharts() {
    ensureChartsExist();
    if (!categoryChart || !monthlyTrendChart) return;

    // Fixed colors for categories
    const categoryColors = {
        "Food": "#FF6384",
        "Transport": "#36A2EB",
        "Shopping": "#4BC0C0",
        "Bills": "#FFCE56",
        "Entertainment": "#9966FF",
        "Health": "#FF9F40",
        "Education": "#00A36C",
        "Groceries": "#A0522D",
        "Income": "#2ECC71",
        "Other": "#7F8C8D"
    };

    // Category breakdown for current month
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    const categoryTotals = {};
    expensesData.forEach(e => {
        const d = new Date(e.date);
        const amt = Number(e.amount) || 0;
        if (amt > 0 && d.getMonth() === thisMonth && d.getFullYear() === thisYear) {
            const cat = e.category || 'Other';
            categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
        }
    });

    const catLabels = Object.keys(categoryTotals);
    const catValues = catLabels.map(l => categoryTotals[l]);

    // Assign color for each category (fallback: gray)
    const bgColors = catLabels.map(cat => categoryColors[cat] || "#BDC3C7");

    // Update category chart
    categoryChart.data.labels = catLabels.length ? catLabels : ['No data'];
    categoryChart.data.datasets[0].data = catValues.length ? catValues : [1];
    categoryChart.data.datasets[0].backgroundColor = bgColors.length ? bgColors : ["#BDC3C7"];
    categoryChart.update();

    // Monthly trend (last 6 months)
    const months = [];
    const monthKeys = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(thisYear, thisMonth - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push(d.toLocaleString('default', { month: 'short', year: 'numeric' }));
        monthKeys.push({ key, month: d.getMonth(), year: d.getFullYear() });
    }

    const monthTotals = monthKeys.map(mk => {
        let s = 0;
        expensesData.forEach(e => {
            const d = new Date(e.date);
            const amt = Number(e.amount) || 0;
            if (amt > 0 && d.getMonth() === mk.month && d.getFullYear() === mk.year) s += amt;
        });
        return s;
    });

    monthlyTrendChart.data.labels = months;
    monthlyTrendChart.data.datasets[0].data = monthTotals;
    monthlyTrendChart.update();
}


/* ---------------------------
   Notification for budget exceeded
   --------------------------- */
function checkAndNotifyBudgetExceeded(totalThisMonth) {
    if (!monthlyBudget || monthlyBudget <= 0) return;

    const now = new Date();
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (totalThisMonth > monthlyBudget) {
        // Only show once per month
        if (alertShownFor !== currentKey) {
            alertShownFor = currentKey;
            // show a red error message
            showMessage(`⚠️ Budget exceeded for ${now.toLocaleString('default', { month: 'long', year: 'numeric' })}!`, true);
            // (Optional) if you want browser notifications, you could request permission and show a Notification
            // but for now we use your on-page messageBox
        }
    } else {
        // Optionally reset alertShownFor if user is below budget (so if they exceed later again same month it will alert)
        // We'll keep it such that once below again we clear the flag.
        alertShownFor = alertShownFor === currentKey ? null : alertShownFor;
    }
}

/* ---------------------------
   Init & event binding
   --------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    showView('landing');
    initializeFirebase();

    const today = new Date().toISOString().split('T')[0];
    $('expenseDate')?.setAttribute('value', today);

    $('signupBtn')?.addEventListener('click', handleSignUp);
    $('loginBtn')?.addEventListener('click', handleSignIn);
    $('logoutBtn')?.addEventListener('click', handleLogout);
    $('editBudgetBtn')?.addEventListener('click', handleUpdateBudget);
    $('addExpenseForm')?.addEventListener('submit', handleAddExpense);

    document.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            const viewName = btn.getAttribute('data-view');
            showView(viewName);
            if (viewName === 'expenses' && userId) renderExpensesList();
            // rebuild charts when navigating to dashboard
            if (viewName === 'dashboard') updateCharts();
        });
    });

    // When window resizes, reflow charts
    window.addEventListener('resize', () => {
        if (categoryChart) categoryChart.resize();
        if (monthlyTrendChart) monthlyTrendChart.resize();
    });
});
