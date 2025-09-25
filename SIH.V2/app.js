import { auth } from './firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { localDataService } from './service.js';
import { 
    renderLoginPage, 
    renderAppShell, 
    renderStudentUI, 
    renderAdminUI, 
    renderChapterList, 
    renderChapterDetail, 
    showQuizDialog, 
    renderStudentDetailModal, 
    showLoading, 
    showToast, 
    setInputError, 
    clearInputError 
} from './ui.js';

import { chapters } from './data.js';

// --- App State ---
let state = {
    appId: typeof __app_id !== 'undefined' ? __app_id : 'default-app-id',
    adminSchoolId: 'admin-school-123',
    userId: null,
    userRole: 'student',
    isAuthReady: false,
    admin: {
        students: [],
        sort: { column: 'score', direction: 'desc' },
        filter: '',
    }
};

// --- App Initialization ---
onAuthStateChanged(auth, (user) => {
    localDataService.initialize();
    if (user) {
        state.isAuthReady = true;
        state.userId = user.uid;
        localDataService.setUserId(user.uid);
        state.userRole = localStorage.getItem('userRole') || 'student';
        renderApp();
    } else {
        state.isAuthReady = false;
        state.userId = null;
        localDataService.setUserId(null);
        renderLoginPage(handleLogin, handleClearData, handleInputFocus);
    }
});

// --- Event Handlers & Logic ---
async function handleLogin(role) {
    const idInputId = `${role}-id-input`;
    const passwordInputId = `${role}-password-input`;

    const userId = document.getElementById(idInputId).value.trim();
    const password = document.getElementById(passwordInputId).value.trim();
    let isValid = true;

    clearInputError(idInputId);
    clearInputError(passwordInputId);

    if (!userId) {
        setInputError(idInputId, 'User ID is required.');
        isValid = false;
    }
    if (!password) {
        setInputError(passwordInputId, 'Password is required.');
        isValid = false;
    }

    if (!isValid) return;

    const email = `${userId}@email.com`;

    try {
        showLoading(true);
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        state.isAuthReady = true;
        state.userId = user.uid;
        state.userRole = role;
        localStorage.setItem('userRole', role);
        localDataService.setUserId(user.uid);

        renderApp();
    } catch (error) {
        setInputError(idInputId, 'Invalid credentials. Please try again.');
        console.error("Login failed:", error);
    } finally {
        showLoading(false);
    }
}

function handleLogout() {
    signOut(auth).then(() => {
        localStorage.removeItem('userRole');
    });
}

function handleClearData() {
    if (confirm('Are you sure you want to reset all saved progress for the current user? This cannot be undone.')) {
        localDataService.clearData();
        showToast('Your saved data has been reset.', 'bg-blue-500');
        renderApp();
    }
}

function renderApp() {
    if (!state.isAuthReady) return;
    renderAppShell();
    
    if (state.userRole === 'admin') {
        renderAdminDashboard();
    } else {
        renderStudentDashboard();
    }
}

function handleInputFocus(inputElement, isFocused) {
    // Placeholder for future animations
}

async function renderStudentDashboard() {
    showLoading(true);
    await localDataService.ensureUserProfile(state.appId, state.adminSchoolId);

    localDataService.listenToUserData(state.appId, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            renderStudentUI(state.userId, data, {
                onLogout: handleLogout,
                // instead of renderChapterList, go directly to first chapter
                onStartLearning: () => renderChapterList(data, chapterEventHandlers),
                onTakeQuiz: (quizType) => showQuizDialog(quizType, (score) => handleQuizCompletion(quizType, score))
            });
        }
        showLoading(false);
    });
}

const chapterEventHandlers = {
    onBackToDashboard: renderStudentDashboard,
    onSelectChapter: (index) => renderChapterDetail(index, null, chapterDetailEventHandlers),
};

const chapterDetailEventHandlers = {
    onBackToChapters: () => renderChapterList({}, chapterEventHandlers),
    onTakeQuiz: (quizType) => showQuizDialog(quizType, (score) => handleQuizCompletion(quizType, score)),
};

function updateAdminView() {
    const students = state.admin.students;
    const totalScore = students.reduce((sum, s) => sum + (s.score || 0), 0);
    const averageScore = students.length > 0 ? Math.round(totalScore / students.length) : 0;
    
    const achievementCounts = {};
    students.forEach(student => {
        (student.achievements || []).forEach(ach => {
            achievementCounts[ach] = (achievementCounts[ach] || 0) + 1;
        });
    });
    const topAchievement = Object.keys(achievementCounts).length > 0 
        ? Object.entries(achievementCounts).sort((a, b) => b[1] - a[1])[0][0] 
        : 'None';

    const stats = { totalScore, averageScore, topAchievement };

    renderAdminUI(students, state.admin.sort, state.admin.filter, stats, adminEventHandlers);
}

const adminEventHandlers = {
    onLogout: handleLogout,
    onFilter: (value) => {
        state.admin.filter = value;
        updateAdminView();
    },
    onSort: (column) => {
        if (state.admin.sort.column === column) {
            state.admin.sort.direction = state.admin.sort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            state.admin.sort.column = column;
            state.admin.sort.direction = column === 'score' ? 'desc' : 'asc';
        }
        updateAdminView();
    },
    onSelectStudent: (studentId) => {
        const studentData = state.admin.students.find(s => s.id === studentId);
        if (studentData) {
            renderStudentDetailModal(studentId, studentData);
        }
    }
};

async function renderAdminDashboard() {
    showLoading(true);
    state.admin.students = [];
    updateAdminView();
    showLoading(false);
}

function handleQuizCompletion(quizType, score) {
    if (score > 0) {
        localDataService.updateUserScore(state.appId, score);
        checkAndAwardAchievements();
        showToast(`You earned ${score} points!`, 'bg-green-500');
        if (score >= 60) localDataService.markQuizAsCompleted(state.appId, quizType);
        if (score === 200) {
            localDataService.awardUserAchievement(state.appId, 'Perfect Score');
            showToast('Perfect Score! Achievement Unlocked!', 'bg-amber-500');
        }
    }
}

async function checkAndAwardAchievements() {
    const docSnap = await localDataService.getUserDoc(state.appId);
    const data = docSnap.data();
    const score = data.score || 0;
    const achievements = data.achievements || [];
    const level = Math.floor(score / 100) + 1;

    if (score >= 50 && !achievements.includes('Fire Safety Pro')) localDataService.awardUserAchievement(state.appId, 'Fire Safety Pro');
    if (score >= 100 && !achievements.includes('Earthquake Expert')) localDataService.awardUserAchievement(state.appId, 'Earthquake Expert');
    if (score >= 150 && !achievements.includes('All-Rounder')) localDataService.awardUserAchievement(state.appId, 'All-Rounder');
    if (score >= 300 && !achievements.includes('Safety Superstar')) localDataService.awardUserAchievement(state.appId, 'Safety Superstar');

    const completed = data.completedQuizzes || [];
    if (completed.length > 0 && !achievements.includes('Quiz Novice')) localDataService.awardUserAchievement(state.appId, 'Quiz Novice');
    if (completed.includes('fire') && !achievements.includes('Fire Quiz Master')) localDataService.awardUserAchievement(state.appId, 'Fire Quiz Master');
    if (completed.includes('earthquake') && !achievements.includes('Earthquake Quiz Master')) localDataService.awardUserAchievement(state.appId, 'Earthquake Quiz Master');
    if (completed.includes('tornado') && !achievements.includes('Tornado Quiz Master')) localDataService.awardUserAchievement(state.appId, 'Tornado Quiz Master');
    if (completed.includes('flood') && !achievements.includes('Flood Quiz Master')) localDataService.awardUserAchievement(state.appId, 'Flood Quiz Master');
    if (completed.includes('wildfire') && !achievements.includes('Wildfire Quiz Master')) localDataService.awardUserAchievement(state.appId, 'Wildfire Quiz Master');
    if (completed.includes('hurricane') && !achievements.includes('Hurricane Quiz Master')) localDataService.awardUserAchievement(state.appId, 'Hurricane Quiz Master');
    if (completed.includes('active-shooter') && !achievements.includes('Response Protocol Master')) localDataService.awardUserAchievement(state.appId, 'Response Protocol Master');

    if (level >= 5 && !achievements.includes('Level 5 Reached')) localDataService.awardUserAchievement(state.appId, 'Level 5 Reached');
    if (level >= 10 && !achievements.includes('Level 10 Pro')) localDataService.awardUserAchievement(state.appId, 'Level 10 Pro');
    if (completed.length >= 3 && !achievements.includes('Triple Threat')) localDataService.awardUserAchievement(state.appId, 'Triple Threat');
    if (completed.length >= 5 && !achievements.includes('Penta-Perfect')) localDataService.awardUserAchievement(state.appId, 'Penta-Perfect');
    
    const allQuizTypes = chapters.filter(c => c.gameType !== 'none').map(c => c.gameType);
    if (allQuizTypes.every(q => completed.includes(q)) && !achievements.includes('Safety Savant')) localDataService.awardUserAchievement(state.appId, 'Safety Savant');
}
