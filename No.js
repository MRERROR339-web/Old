// This file contains all the JavaScript logic for the Himalayan Royals game.
// It should be linked from the main HTML file.

// Import the required Firebase services.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously,
    signInWithCustomToken,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc,
    updateDoc,
    collection,
    query,
    where,
    getDocs,
    getDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
// Include Tone.js for sound effects.
import "https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js";

// --- Firebase Security Rules ---
// For this app to work, you MUST set up these security rules in your Firestore console.
// Go to Firestore > Rules and replace the existing rules with the ones below.
// Make sure to publish them after pasting.
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /artifacts/{appId}/public/data/users/{userId} {
      allow read, write: if request.auth != null;
    }
  }
}
*/

// --- Firebase Initialization ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : '';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let userId = '';

/**
 * Signs in the user using the provided custom token or anonymously.
 * This function must be awaited before any Firestore operations.
 */
async function authenticateUser() {
    try {
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }
        userId = auth.currentUser?.uid || crypto.randomUUID();
        console.log("Firebase authentication successful. User ID:", userId);
    } catch (error) {
        console.error("Firebase authentication failed:", error);
        showMessage("Authentication Error", "Failed to authenticate with Firebase. Please try again.");
    }
}

// --- Game Configuration ---
// Updated color scheme and chances
const segments = [
    { text: '2 XD', value: 2, chance: 37, color: '#2C3E50' },
    { text: '4 XD', value: 4, chance: 30, color: '#34495E' },
    { text: '10 XD', value: 10, chance: 10, color: '#F39C12' },
    { text: '20 XD', value: 20, chance: 5, color: '#F1C40F' },
    { text: '16 XD', value: 16, chance: 15, color: '#3498DB' },
    { text: '50 XD', value: 50, chance: 2, color: '#E74C3C' },
    { text: '100 XD', value: 100, chance: 0.9, color: '#9B59B6' },
    { text: 'Jackpot', value: 0, chance: 0.1, color: '#FFD700' }, // Jackpot is now winnable
];

// Jackpot constants
const JACKPOT_INCREMENT_PER_MINUTE = 100;

// Withdrawal constants
const MIN_WITHDRAW_RBX = 7;
const RBX_TO_XD_RATE = 100;
const GAMEPASS_DEDUCTION_RATE = 0.40;
const REFERRAL_BONUS_RATE = 0.10;

// --- State Variables ---
let xdBalance = 0;
let jackpot = 0;
let userReferralCode = '';
let referredBy = null;
let isSpinning = false;
let notifications = [];
let username = '';

// --- Audio Context & Sound Effects ---
let spinSound, winSound;
try {
    // A synth for the spinning sound effect
    const spinSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: {
            attack: 0.05,
            decay: 0.1,
            sustain: 0.1,
            release: 0.1
        }
    }).toDestination();
    
    // A loop to play a sound every 8th note while spinning
    spinSound = new Tone.Loop(time => {
        spinSynth.triggerAttackRelease("C4", "8n", time);
    }, "8n");

    // A synth for the winning chime
    winSound = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: {
            attack: 0.005,
            decay: 0.5,
            sustain: 0.1,
            release: 1
        }
    }).toDestination();
} catch (e) {
    console.error("Tone.js failed to initialize:", e);
}

// --- DOM Elements ---
const messageModal = document.getElementById('message-modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalCloseBtn = document.getElementById('modal-close-btn');

const wheelCanvas = document.getElementById('wheelCanvas');
const ctx = wheelCanvas.getContext('2d');
const spinBtn = document.getElementById('spin-btn');
const xdBalanceEl = document.getElementById('xd-balance');
const userUsernameEl = document.getElementById('user-username');
const userReferralCodeEl = document.getElementById('user-referral-code');
const wheelContainer = document.getElementById('wheel-container');
const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');
const spinSection = document.getElementById('spin-section');
const withdrawSection = document.getElementById('withdraw-section');
const notificationSection = document.getElementById('notification-section');
const redeemAmountRbxInput = document.getElementById('redeem-amount-rbx');
const robloxUsernameInput = document.getElementById('roblox-username');
const withdrawForm = document.getElementById('withdraw-form');
const withdrawBtn = document.getElementById('withdraw-btn');
const xdDeductedAmountEl = document.getElementById('xd-deducted-amount');
const gamepassAmountEl = document.getElementById('gamepass-amount');
const notificationList = document.getElementById('notification-list');
const clearNotificationsBtn = document.getElementById('clear-notifications-btn');
const confettiCanvas = document.getElementById('confetti-canvas');
const confettiCtx = confettiCanvas.getContext('2d');

// --- Confetti VFX ---
const confettiParticles = [];
const confettiColors = ['#FFD700', '#F1C40F', '#F39C12', '#FFFFFF', '#3498DB'];
const confettiDuration = 3000;

function createConfetti() {
    for (let i = 0; i < 100; i++) {
        confettiParticles.push({
            x: Math.random() * confettiCanvas.width,
            y: Math.random() * -confettiCanvas.height,
            vx: Math.random() * 6 - 3,
            vy: Math.random() * 3 + 2,
            rot: Math.random() * 360,
            color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
            opacity: 1,
            size: Math.random() * 8 + 4
        });
    }
}

function drawConfetti() {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    for (let i = 0; i < confettiParticles.length; i++) {
        const p = confettiParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05; // Gravity
        p.opacity -= 0.01;
        
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rot * Math.PI / 180);
        confettiCtx.fillStyle = p.color;
        confettiCtx.globalAlpha = p.opacity;
        confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        confettiCtx.restore();

        if (p.y > confettiCanvas.height || p.opacity <= 0) {
            confettiParticles.splice(i, 1);
            i--;
        }
    }
    if (confettiParticles.length > 0) {
        requestAnimationFrame(drawConfetti);
    }
}

/**
 * Triggers the confetti effect for a specified duration.
 */
function triggerConfetti() {
    createConfetti();
    drawConfetti();
    setTimeout(() => {
        confettiParticles.length = 0;
    }, confettiDuration);
}

// --- Helper Functions ---

/**
 * Creates and appends the light bulbs to the wheel container.
 * There will be one light bulb at each segment division point.
 */
function createLightBulbs() {
    const numBulbs = segments.length;
    // Remove any existing bulbs first
    const existingBulbs = wheelContainer.querySelectorAll('.light-bulb');
    existingBulbs.forEach(bulb => bulb.remove());

    const radius = 175; // Half of wheel-container size
    const bulbSize = 16;
    const offset = 8; // Half of bulb size
    
    for (let i = 0; i < numBulbs; i++) {
        const bulb = document.createElement('div');
        bulb.className = 'light-bulb';
        
        // Position the bulb at the start of each segment's arc
        const angle = (i / numBulbs) * 360 - 90; // -90 to align the start to the top of the wheel
        const x = radius + radius * Math.cos(angle * Math.PI / 180);
        const y = radius + radius * Math.sin(angle * Math.PI / 180);
        
        bulb.style.top = `${y - offset}px`;
        bulb.style.left = `${x - offset}px`;
        
        wheelContainer.appendChild(bulb);
    }
}

/**
 * Displays a custom message box instead of using an alert.
 * @param {string} title The title of the message.
 * @param {string} message The content of the message.
 * @param {boolean} showButton If the close button should be shown. Defaults to true.
 * @param {number} duration The duration in milliseconds for the modal to auto-close. Defaults to 0 (no auto-close).
 */
function showMessage(title, message, showButton = true, duration = 0) {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    messageModal.style.display = 'flex';
    modalCloseBtn.style.display = showButton ? 'flex' : 'none';

    if (duration > 0) {
        setTimeout(() => {
            messageModal.style.display = 'none';
        }, duration);
    }
}

/**
 * Fetches a user's data from Firestore.
 * @param {string} id The user's Firebase UID.
 * @returns {object} The user's data or null if not found.
 */
async function fetchUserData(id) {
    const userDocRef = doc(db, `artifacts/${appId}/public/data/users`, id);
    try {
        const docSnap = await getDoc(userDocRef);
        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            console.log("No such user document!");
            return null;
        }
    } catch (e) {
        console.error("Error fetching user data:", e);
        return null;
    }
}

/**
 * Updates a user's data in Firestore.
 * @param {string} id The user's Firebase UID.
 * @param {object} data The data to update.
 */
async function updateUserData(id, data) {
    const userDocRef = doc(db, `artifacts/${appId}/public/data/users`, id);
    try {
        await updateDoc(userDocRef, data);
    } catch (e) {
        console.error("Error updating user data:", e);
    }
}

/**
 * Draws the prize wheel on the canvas.
 */
function drawWheel() {
    const totalSegments = segments.length;
    const arcSize = (2 * Math.PI) / totalSegments;
    const radius = wheelCanvas.width / 2;
    const centerX = radius;
    const centerY = radius;
    ctx.clearRect(0, 0, wheelCanvas.width, wheelCanvas.height);

    const segmentsToDraw = segments.map(segment => {
        if (segment.text.startsWith('Jackpot')) {
            return { ...segment, text: `Jackpot: ${jackpot} XD` };
        }
        return segment;
    });

    segmentsToDraw.forEach((segment, i) => {
        const startAngle = i * arcSize;
        const endAngle = (i + 1) * arcSize;

        // Draw the segment
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.lineTo(centerX, centerY);
        ctx.fillStyle = segment.color;
        ctx.fill();

        // Draw the text
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(startAngle + arcSize / 2);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#E0E0E0';
        ctx.font = 'bold 16px Poppins';
        ctx.fillText(segment.text, radius * 0.85, 5);
        ctx.restore();
    });

    // Draw the center circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, 30, 0, 2 * Math.PI);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FFD700';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 12px Poppins';
    ctx.fillText('SPIN', centerX, centerY);
}

/**
 * Selects a winning segment based on probabilities.
 * @returns {object} The winning segment.
 */
function getRandomSegment() {
    const totalChance = segments.reduce((acc, seg) => acc + seg.chance, 0);
    const rand = Math.random() * totalChance;
    let cumulativeChance = 0;
    for (const segment of segments) {
        cumulativeChance += segment.chance;
        if (rand < cumulativeChance) {
            return segment;
        }
    }
    return segments[segments.length - 1]; 
}

/**
 * Handles the spinning animation and result.
 */
function spin() {
    if (isSpinning) return;
    isSpinning = true;
    spinBtn.disabled = true;
    
    // Start the spin sound and activate audio context
    Tone.start();
    spinSound.start();

    const winningSegment = getRandomSegment();
    const segmentIndex = segments.indexOf(winningSegment);
    const totalSegments = segments.length;
    const segmentArc = 360 / totalSegments;
    
    // Calculate the angle to precisely land on the winning segment
    const targetAngleForSegment = (segmentIndex * segmentArc) + (segmentArc / 2);
    // The pointer is at 90 degrees relative to the canvas's 3 o'clock start point.
    // We need to subtract the segment's angle from 270 degrees to align it with the pointer.
    const finalAngle = (270 - targetAngleForSegment + 360) % 360;

    // Rotate the wheel a total of 5 full rotations plus the final calculated angle
    const totalRotation = 360 * 5 + finalAngle;
    
    let start = null;
    const duration = 4000;
    
    function animate(timestamp) {
        if (!start) start = timestamp;
        const elapsed = timestamp - start;
        const progress = Math.min(elapsed / duration, 1);
        
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        const rotation = easedProgress * totalRotation;
        
        wheelContainer.style.transform = `rotate(${rotation}deg)`;
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Stop the spin sound and animation
            spinSound.stop();
            isSpinning = false;
            spinBtn.disabled = false;
            handleWin(winningSegment);
        }
    }
    requestAnimationFrame(animate);
}

/**
 * Handles the win, updates balance, and saves data to Firestore.
 * @param {object} winningSegment The segment the wheel landed on.
 */
async function handleWin(winningSegment) {
    let winAmount = winningSegment.value;
    let message = '';
    
    if (winningSegment.text.startsWith('Jackpot')) {
        if (jackpot > 0) {
            winAmount = jackpot;
            jackpot = 0;
            message = `Congratulations! You won the Jackpot of ${winAmount} XD!`;
            triggerConfetti();
            winSound.triggerAttackRelease("C5", "8n");
        } else {
            winAmount = 0;
            message = `Sorry, the Jackpot was empty. Better luck next time!`;
        }
    } else {
        message = `You won ${winAmount} XD!`;
        winSound.triggerAttackRelease("G4", "8n");
    }
    
    xdBalance += winAmount;
    
    notifications.unshift({
        message: message,
        timestamp: new Date().toISOString()
    });
    await updateUserData(userId, { xdBalance: xdBalance, notifications: notifications, jackpot: jackpot });
    
    updateUI();
    showMessage('Spin Result', message);
}

/**
 * Updates the UI to reflect the current state.
 */
function updateUI() {
    xdBalanceEl.textContent = xdBalance.toLocaleString();
    userUsernameEl.textContent = username;
    userReferralCodeEl.textContent = userReferralCode;
    drawWheel();

    notificationList.innerHTML = '';
    notifications.forEach(note => {
        const li = document.createElement('li');
        li.className = 'text-gray-300 p-2 border-b border-gray-700 last:border-b-0 text-sm';
        const date = new Date(note.timestamp).toLocaleString();
        li.innerHTML = `<span class="font-semibold text-yellow-500">${note.message}</span> <br> <span class="text-xs text-gray-500">${date}</span>`;
        notificationList.appendChild(li);
    });

    clearNotificationsBtn.disabled = notifications.length === 0;
    if (notifications.length > 0) {
        clearNotificationsBtn.classList.remove('disabled:bg-gray-500', 'disabled:cursor-not-allowed');
        clearNotificationsBtn.classList.add('hover:bg-red-600');
    } else {
        clearNotificationsBtn.classList.remove('hover:bg-red-600');
        clearNotificationsBtn.classList.add('disabled:bg-gray-500', 'disabled:cursor-not-allowed');
    }
}

/**
 * Dynamically updates the calculated withdrawal amounts.
 */
function updateWithdrawalCalculations() {
    const amountRbx = parseInt(redeemAmountRbxInput.value, 10);
    
    if (isNaN(amountRbx) || amountRbx < MIN_WITHDRAW_RBX) {
        xdDeductedAmountEl.textContent = '0';
        gamepassAmountEl.textContent = '0';
        withdrawBtn.disabled = true;
        return;
    }

    const xdToDeduct = amountRbx * RBX_TO_XD_RATE;
    const gamepassAmount = Math.ceil(amountRbx / (1 - GAMEPASS_DEDUCTION_RATE));

    xdDeductedAmountEl.textContent = xdToDeduct.toLocaleString();
    gamepassAmountEl.textContent = gamepassAmount.toLocaleString();

    if (xdBalance >= xdToDeduct) {
        withdrawBtn.disabled = false;
    } else {
        withdrawBtn.disabled = true;
    }
}

/**
 * Handles the withdrawal request from the form and awards referral bonus.
 * @param {Event} e The form submission event.
 */
async function handleWithdraw(e) {
    e.preventDefault();
    const amountRbx = parseInt(redeemAmountRbxInput.value, 10);
    const roboxUsername = robloxUsernameInput.value.trim();

    if (isNaN(amountRbx) || amountRbx < MIN_WITHDRAW_RBX) {
        showMessage('Withdrawal Failed', `Please enter a valid amount of at least ${MIN_WITHDRAW_RBX} RBX.`);
        return;
    }

    if (roboxUsername === '') {
        showMessage('Withdrawal Failed', 'Roblox username cannot be empty.');
        return;
    }

    const xdToDeduct = amountRbx * RBX_TO_XD_RATE;
    const gamepassAmount = Math.ceil(amountRbx / (1 - GAMEPASS_DEDUCTION_RATE));

    if (xdBalance < xdToDeduct) {
        showMessage('Withdrawal Failed', `You do not have enough XD to withdraw this amount. You need ${xdToDeduct} XD.`);
        return;
    }
    
    xdBalance -= xdToDeduct;

    notifications.unshift({
        message: `Withdrawal request for ${amountRbx} RBX submitted for Roblox user "${roboxUsername}". A total of ${xdToDedu-ct} XD was deducted.`,
        timestamp: new Date().toISOString()
    });

    if (referredBy) {
        const bonusAmount = xdToDeduct * REFERRAL_BONUS_RATE;
        const referrerData = await fetchUserData(referredBy);
        if (referrerData) {
            const newReferrerBalance = referrerData.xdBalance + bonusAmount;
            const referrerNotifications = referrerData.notifications || [];
            referrerNotifications.unshift({
                message: `Referral bonus! You received ${bonusAmount.toFixed(0)} XD from a withdrawal by a user you referred.`,
                timestamp: new Date().toISOString()
            });
            await updateUserData(referredBy, { xdBalance: newReferrerBalance, notifications: referrerNotifications });
        }
    }

    await updateUserData(userId, { xdBalance: xdBalance, notifications: notifications });

    withdrawForm.reset();

    updateUI();
    
    showMessage('Withdrawal Successful', `Your withdrawal request for ${amountRbx} RBX has been submitted. We have deducted ${xdToDeduct} XD from your balance. Please create a Gamepass of ${gamepassAmount} RBX as instructed.`);
}

/**
 * Clears all notifications from the list.
 */
async function clearNotifications() {
    notifications = [];
    await updateUserData(userId, { notifications: notifications });
    up
