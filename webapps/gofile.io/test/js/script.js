/* ================================================================
   script.js — GoFile Index Code Generator
   ================================================================
   Sections:
     1. AD PENALTY SYSTEM
     2. NOTICE / MAINTENANCE
     3. SEND LOGIN LINK + COOLDOWN TIMER
     4. CODE GENERATION
     5. COPY / DOWNLOAD HELPERS
     6. POPUP / ALERT HELPERS
     7. INIT
   ================================================================ */

'use strict';

/* ================================================================
   1. AD PENALTY SYSTEM
   ────────────────────────────────────────────────────────────────
   Tracks clicks on the "Send Login Link" button in a rolling
   time window. When the threshold is exceeded the button is hidden
   and replaced by the penalty container (a 320×50 ad + a Smartlink
   unlock button). Only this one button is affected.

   Config:
     threshold   – max clicks allowed within the window (exclusive)
     windowMs    – rolling window in milliseconds
     unlockDelaySec – seconds to wait after the user clicks the
                      Smartlink before the button is restored
   ================================================================ */

const AD_PENALTY_CONFIG = {
  threshold:      3,          // 4th click triggers the penalty
  windowMs:       2 * 60_000, // rolling 2-minute window
  unlockDelaySec: 12,         // countdown after Smartlink click
};

let _penaltyClickTimestamps = []; // timestamps of recent clicks
let _penaltyActive          = false;
let _unlockCountdownId      = null;

/** Record a click; return true if the penalty should now trigger. */
function _recordClickAndCheckPenalty() {
  const now = Date.now();
  _penaltyClickTimestamps = _penaltyClickTimestamps.filter(
    (t) => now - t < AD_PENALTY_CONFIG.windowMs
  );
  _penaltyClickTimestamps.push(now);
  return _penaltyClickTimestamps.length > AD_PENALTY_CONFIG.threshold;
}

/** Hide the send button; show the penalty container. */
function _showAdPenalty() {
  _penaltyActive = true;
  document.getElementById('sendLoginBtn').style.display        = 'none';
  document.getElementById('adPenaltyContainer').style.display  = 'flex';
  _setUnlockInfo('View the ad above, then click "Unlock" below.', '');
}

/** Restore the send button; hide the penalty container. */
function _hideAdPenalty() {
  _penaltyActive = false;
  document.getElementById('adPenaltyContainer').style.display  = 'none';
  document.getElementById('sendLoginBtn').style.display         = '';
  // Prune oldest timestamps so user gets a fresh window
  _penaltyClickTimestamps = _penaltyClickTimestamps.slice(-2);
  _setUnlockInfo('', '');
}

/** Update the small status line inside the penalty container. */
function _setUnlockInfo(text, cssClass) {
  const el   = document.getElementById('adUnlockInfo');
  el.textContent = text;
  el.className   = 'ad-unlock-info' + (cssClass ? ` ${cssClass}` : '');
}

/**
 * Called when the user clicks the Smartlink unlock button.
 * Opens the Smartlink (handled by the href), then starts a
 * countdown. When it reaches zero the send button is restored.
 * Exposed globally so the onclick attribute in HTML can call it.
 */
function onAdClicked() {
  // Prevent double-start if user clicks again mid-countdown
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
      setTimeout(_hideAdPenalty, 900);
    }
  }, 1_000);
}


/* ================================================================
   2. NOTICE / MAINTENANCE
   ================================================================ */

function acknowledgeNotice() {
  document.getElementById('important-notice').style.display = 'none';
  document.body.style.overflow = '';
}

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
    // Silently ignore — never block the UI for a failed status check
  }
  return false;
}


/* ================================================================
   3. SEND LOGIN LINK + COOLDOWN TIMER
   ────────────────────────────────────────────────────────────────
   Progressive cooldown after each successful send.
   Runs independently of the ad-penalty check.
   ================================================================ */

const TIMER_DURATIONS = [30, 30, 60, 120, 300]; // seconds
let _sendClickCount  = 0;
let _cooldownTimerId = null;

function startTimer(seconds) {
  const btn       = document.getElementById('sendLoginBtn');
  const timerText = document.getElementById('timerText');

  btn.disabled = true;
  let remaining = seconds;
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

async function sendLoginLink(e) {
  createRipple(e);

  // ── Ad-penalty check (runs before anything else) ─────────────
  if (_recordClickAndCheckPenalty()) {
    _showAdPenalty();
    return; // Do NOT fire the API call
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
      const idx = Math.min(_sendClickCount, TIMER_DURATIONS.length - 1);
      startTimer(TIMER_DURATIONS[idx]);
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

function formatTimestamp(timestamp) {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

async function generateCode(e) {
  createRipple(e);

  const input = document.getElementById('tokenInput').value.trim();
  const token = (input.match(/[A-Za-z0-9]{32,}/) || [])[0];
  if (!token) {
    showAlert('Invalid token / URL', false);
    return;
  }

  try {
    const accountRes  = await fetch('https://api.gofile.io/accounts/website', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const accountData = await accountRes.json();
    if (accountData.status !== 'ok') {
      throw new Error(accountData.error || 'Failed to fetch account data');
    }

    const { rootFolder, email, tier, createTime, statsCurrent } = accountData.data;

    const themeUrl  = document.getElementById('themeSelect').value;
    const codeRes   = await fetch(themeUrl);
    const code      = await codeRes.text();

    const modified = code
      .replace(/THEGOFILETOKEN/g,  token)
      .replace(/THEROOTFOLDERID/g, rootFolder);

    document.getElementById('codeOutput').value = modified;
    document.querySelector('.code-container').classList.add('visible');
    document.getElementById('outputSection').style.display = 'block';

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
    href: url, download: 'gofile-worker.js',
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

function showAlert(message, isSuccess) {
  const alertEl = document.getElementById('alert');
  const icon    = alertEl.querySelector('.alert-icon');
  alertEl.className = 'alert ' + (isSuccess ? 'alert-success' : 'alert-error');
  icon.className    = 'alert-icon fas ' + (isSuccess ? 'fa-check-circle' : 'fa-times-circle');
  document.getElementById('alertMessage').textContent = message;
  alertEl.classList.add('show');
  setTimeout(() => alertEl.classList.remove('show'), 3_000);
}

function createRipple(event) {
  const btn    = event.currentTarget;
  const circle = document.createElement('div');
  const rect   = btn.getBoundingClientRect();
  const size   = Math.max(rect.width, rect.height);
  circle.className     = 'ripple';
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

// Block background scroll until the notice is dismissed
document.body.style.overflow = 'hidden';

// Check maintenance flag immediately
checkMaintenanceStatus();
