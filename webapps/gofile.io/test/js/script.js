/* ================================================================
   script.js — GoFile Index Code Generator
   ================================================================
   Sections:
     1. AD PENALTY SYSTEM  ← new feature
     2. NOTICE / MAINTENANCE
     3. SEND LOGIN LINK + RATE-LIMIT TIMER
     4. CODE GENERATION
     5. COPY / DOWNLOAD HELPERS
     6. POPUP HELPERS
     7. INIT
   ================================================================ */

'use strict';

/* ================================================================
   1. AD PENALTY SYSTEM
   ────────────────────────────────────────────────────────────────
   Purpose: When a user clicks "Send Login Link" more than
   AD_PENALTY_CONFIG.threshold times within the rolling window,
   the button is hidden and replaced by an Adsterra ad link.
   The user must click that link (opening it in a new tab) before
   a short countdown completes and the button is restored.

   Only the email send button is affected. The timer-based
   cooldown that already exists (startTimer) continues to work
   independently — the ad penalty is an additional, separate check.
   ================================================================ */

const AD_PENALTY_CONFIG = {
  threshold:    3,            // clicks allowed within the window
  windowMs:     2 * 60_000,  // rolling window: 2 minutes
  unlockDelaySec: 12,         // seconds the user must wait after clicking the ad
};

/** Timestamps (ms) of the most recent threshold+1 send-button clicks. */
let _penaltyClickTimestamps = [];

/** True while the penalty UI is shown and the button is locked. */
let _penaltyActive = false;

/** Interval handle for the unlock countdown. */
let _unlockCountdownId = null;

/**
 * Record a click and return true if the penalty should now activate.
 * Uses a rolling window: only clicks within the last windowMs ms count.
 */
function _recordClickAndCheckPenalty() {
  const now = Date.now();
  // Discard timestamps outside the rolling window
  _penaltyClickTimestamps = _penaltyClickTimestamps.filter(
    (t) => now - t < AD_PENALTY_CONFIG.windowMs
  );
  _penaltyClickTimestamps.push(now);
  return _penaltyClickTimestamps.length > AD_PENALTY_CONFIG.threshold;
}

/** Hide the send button and show the ad-penalty container. */
function _showAdPenalty() {
  _penaltyActive = true;
  document.getElementById('sendLoginBtn').style.display       = 'none';
  document.getElementById('adPenaltyContainer').style.display = 'flex';
  _setUnlockInfo('Click the ad above to unlock the send button.', '');
}

/** Restore the send button and hide the penalty container. */
function _hideAdPenalty() {
  _penaltyActive = false;
  document.getElementById('adPenaltyContainer').style.display = 'none';
  document.getElementById('sendLoginBtn').style.display        = '';
  // Give the user a fresh window — remove the oldest clicks so they
  // are back below the threshold (keep the most recent 2 as context).
  _penaltyClickTimestamps = _penaltyClickTimestamps.slice(-2);
  _setUnlockInfo('', '');
}

/**
 * Update the small status line inside the penalty container.
 * @param {string} text    - message to display
 * @param {string} cssClass - 'unlocking' | 'unlocked' | '' (default colour)
 */
function _setUnlockInfo(text, cssClass) {
  const el = document.getElementById('adUnlockInfo');
  el.textContent = text;
  el.className   = 'ad-unlock-info' + (cssClass ? ` ${cssClass}` : '');
}

/**
 * Called when the user clicks the penalty ad link.
 * Starts a short countdown; once it reaches zero the button is restored.
 * Exported to global scope so the onclick attribute in HTML can call it.
 */
function onAdClicked() {
  // Prevent double-triggering if the user clicks the link again mid-countdown
  if (_unlockCountdownId !== null) return;

  let remaining = AD_PENALTY_CONFIG.unlockDelaySec;
  _setUnlockInfo(`Unlocking in ${remaining}s…`, 'unlocking');

  _unlockCountdownId = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      _setUnlockInfo(`Unlocking in ${remaining}s…`, 'unlocking');
    } else {
      clearInterval(_unlockCountdownId);
      _unlockCountdownId = null;
      _setUnlockInfo('Unlocked! You can send again.', 'unlocked');
      // Brief pause so the user sees the "Unlocked!" message
      setTimeout(_hideAdPenalty, 800);
    }
  }, 1_000);
}


/* ================================================================
   2. NOTICE / MAINTENANCE
   ================================================================ */

/** Dismiss the important-notice overlay and restore page scrolling. */
function acknowledgeNotice() {
  document.getElementById('important-notice').style.display = 'none';
  document.body.style.overflow = '';
}

/** Fetch the maintenance flag from GitHub and show the overlay if TRUE. */
async function checkMaintenanceStatus() {
  try {
    const res  = await fetch(
      'https://raw.githubusercontent.com/developeranaz/developeranaz.github.io/refs/heads/main/webapps/gofile.io/maintenance.log'
    );
    const text = await res.text();
    if (text.trim().toUpperCase() === 'TRUE') {
      document.getElementById('maintenanceOverlay').classList.add('active');
      return true;
    }
  } catch {
    // Silently fail — do not block the UI if the check can't reach GitHub
  }
  return false;
}


/* ================================================================
   3. SEND LOGIN LINK + RATE-LIMIT TIMER
   ================================================================ */

/** Progressive cooldown durations (seconds) for repeated sends. */
const TIMER_DURATIONS = [30, 30, 60, 120, 300];
let _sendClickCount = 0;
let _cooldownTimerId = null;

/**
 * Start the button's cooldown timer after a successful send.
 * This is separate from the ad-penalty check and runs concurrently.
 * @param {number} seconds
 */
function startTimer(seconds) {
  const btn       = document.getElementById('sendLoginBtn');
  const timerText = document.getElementById('timerText');

  btn.disabled     = true;
  let remaining    = seconds;
  timerText.textContent =
    `Please wait ${remaining}s before sending again. Check spam if not received.`;

  _cooldownTimerId = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      timerText.textContent =
        `Please wait ${remaining}s before sending again. Check spam if not received.`;
    } else {
      clearInterval(_cooldownTimerId);
      _cooldownTimerId      = null;
      btn.disabled          = false;
      timerText.textContent = '';
    }
  }, 1_000);
}

/**
 * Handle "Send Login Link" click.
 * Checks the ad penalty first; if not triggered, proceeds with the API call.
 * @param {MouseEvent} e
 */
async function sendLoginLink(e) {
  createRipple(e);

  // ── Ad-penalty check ─────────────────────────────────────────
  if (_recordClickAndCheckPenalty()) {
    _showAdPenalty();
    return; // Do NOT make the API call
  }
  // ─────────────────────────────────────────────────────────────

  const email = document.getElementById('emailInput').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAlert('Please enter a valid email address', false);
    return;
  }

  try {
    const response = await fetch('https://api-gofileio.anas-appdata.workers.dev/', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });

    const result = await response.json();

    if (result.status === 'ok') {
      showAlert('Login link sent! Check your email.', true);
      const timerIndex = Math.min(_sendClickCount, TIMER_DURATIONS.length - 1);
      startTimer(TIMER_DURATIONS[timerIndex]);
      _sendClickCount += 1;
    } else {
      showAlert('Error: ' + (result.error || 'Failed to send link'), false);
    }
  } catch (err) {
    showAlert('Request failed: ' + err.message, false);
  }
}


/* ================================================================
   4. CODE GENERATION
   ================================================================ */

/** Format a Unix timestamp (seconds) to a readable date string. */
function formatTimestamp(timestamp) {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year:  'numeric',
    month: 'short',
    day:   'numeric',
  });
}

/**
 * Validate the token, fetch account info and the chosen worker template,
 * inject credentials, and display the ready-to-deploy code.
 * @param {MouseEvent} e
 */
async function generateCode(e) {
  createRipple(e);

  const input = document.getElementById('tokenInput').value.trim();
  const token = (input.match(/[A-Za-z0-9]{32,}/) || [])[0];

  if (!token) {
    showAlert('Invalid token / URL', false);
    return;
  }

  try {
    const accountResponse = await fetch('https://api.gofile.io/accounts/website', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const accountData = await accountResponse.json();

    if (accountData.status !== 'ok') {
      throw new Error(accountData.error || 'Failed to fetch account data');
    }

    const { rootFolder, email, tier, createTime, statsCurrent } = accountData.data;

    const selectedTheme = document.getElementById('themeSelect').value;
    const codeResponse  = await fetch(selectedTheme);
    const code          = await codeResponse.text();

    const modifiedCode = code
      .replace(/THEGOFILETOKEN/g,   token)
      .replace(/THEROOTFOLDERID/g,  rootFolder);

    document.getElementById('codeOutput').value = modifiedCode;
    document.querySelector('.code-container').classList.add('visible');
    document.getElementById('outputSection').style.display = 'block';

    // Populate success popup
    document.getElementById('popupEmail').textContent      = email;
    document.getElementById('popupTier').textContent       = tier;
    document.getElementById('popupCreateTime').textContent = formatTimestamp(createTime);
    document.getElementById('popupRootFolder').textContent = rootFolder;
    document.getElementById('popupFolders').textContent    = statsCurrent.folderCount;
    document.getElementById('popupFiles').textContent      = statsCurrent.fileCount;
    document.getElementById('accountPopup').classList.add('visible');

  } catch (err) {
    showAlert('Error: ' + err.message, false);
  }
}


/* ================================================================
   5. COPY / DOWNLOAD HELPERS
   ================================================================ */

function copyCode() {
  const ta = document.getElementById('codeOutput');
  ta.select();
  document.execCommand('copy');
  const note = document.getElementById('copyNotification');
  note.classList.add('show');
  setTimeout(() => note.classList.remove('show'), 2_000);
}

function downloadCode() {
  const code = document.getElementById('codeOutput').value;
  if (!code) return;
  const blob = new Blob([code], { type: 'text/javascript' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href:     url,
    download: 'gofile-worker.js',
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


/* ================================================================
   6. POPUP / ALERT HELPERS
   ================================================================ */

function closeAccountPopup() {
  document.getElementById('accountPopup').classList.remove('visible');
}

/**
 * Show a floating alert at the top of the viewport.
 * @param {string}  message
 * @param {boolean} isSuccess
 */
function showAlert(message, isSuccess) {
  const alertEl = document.getElementById('alert');
  const icon    = alertEl.querySelector('.alert-icon');

  alertEl.className  = 'alert ' + (isSuccess ? 'alert-success' : 'alert-error');
  icon.className     = 'alert-icon fas ' + (isSuccess ? 'fa-check-circle' : 'fa-times-circle');
  document.getElementById('alertMessage').textContent = message;

  alertEl.classList.add('show');
  setTimeout(() => alertEl.classList.remove('show'), 3_000);
}

/**
 * Append a CSS ripple element to the clicked button.
 * @param {MouseEvent} event
 */
function createRipple(event) {
  const btn    = event.currentTarget;
  const circle = document.createElement('div');
  const rect   = btn.getBoundingClientRect();

  circle.className  = 'ripple';
  const size        = Math.max(rect.width, rect.height);
  circle.style.cssText = `
    width:  ${size}px;
    height: ${size}px;
    left:   ${event.clientX - rect.left - size / 2}px;
    top:    ${event.clientY - rect.top  - size / 2}px;
  `;
  btn.appendChild(circle);
  setTimeout(() => circle.remove(), 600);
}


/* ================================================================
   7. INIT
   ================================================================ */

// Prevent background scrolling until the notice is acknowledged
document.body.style.overflow = 'hidden';

// Run the maintenance check as soon as the script is parsed
checkMaintenanceStatus();
