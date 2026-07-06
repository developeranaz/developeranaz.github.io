/* ================================================================
   script.js — GoFile Index Code Generator
   ================================================================
   Sections:
     1. AD RENDERING (isolated iframes — fixes duplicate ads)
     2. AD PENALTY SYSTEM
     3. NOTICE / MAINTENANCE
     4. SEND LOGIN LINK + COOLDOWN TIMER
     5. CODE GENERATION
     6. COPY / DOWNLOAD HELPERS
     7. POPUP / ALERT HELPERS
     8. INIT
   ================================================================ */

'use strict';

/* ================================================================
   1. AD RENDERING — ISOLATED IFRAMES
   ────────────────────────────────────────────────────────────────
   PROBLEM this solves: all Adsterra banner scripts read the SAME
   global `atOptions` variable. When two banners load on one page,
   whichever invoke.js runs last reads the last-written config —
   result: the same ad (e.g. 300×250) rendered twice, and mobile
   layout blowups.

   FIX: each banner gets its own <iframe srcdoc="..."> — a separate
   JS context, so each atOptions is private. Each iframe has a hard
   width/height, so ads can NEVER overflow or cover the page.
   ================================================================ */

const AD_UNITS = {
  '728x90': {
    key: 'cfdd26285d2be07540494f6205a5954a',
    width: 728, height: 90,
  },
  '300x250': {
    key: '30303a6a547002e2316ff549bfa6bdb3',
    width: 300, height: 250,
  },
  '320x50': {
    key: '456831897108255b1704a6daa2b31f0f',
    width: 320, height: 50,
  },
};

/**
 * Build a fully isolated ad iframe for one Adsterra banner unit.
 * @param {{key:string,width:number,height:number}} unit
 * @returns {HTMLIFrameElement}
 */
function _buildAdIframe(unit) {
  const iframe = document.createElement('iframe');
  iframe.width       = unit.width;
  iframe.height      = unit.height;
  iframe.scrolling   = 'no';
  iframe.frameBorder = '0';
  iframe.style.cssText =
    `width:${unit.width}px;height:${unit.height}px;max-width:100%;` +
    'border:0;overflow:hidden;display:block;margin:0 auto;';
  iframe.srcdoc = `<!DOCTYPE html><html><head><style>
      html,body{margin:0;padding:0;overflow:hidden;background:transparent}
    </style></head><body>
    <script>atOptions={'key':'${unit.key}','format':'iframe','height':${unit.height},'width':${unit.width},'params':{}};<\/script>
    <script src="https://amoralstern.com/${unit.key}/invoke.js"><\/script>
    </body></html>`;
  return iframe;
}

/**
 * Fill every element that has a data-ad attribute with its
 * isolated ad iframe. Skips slots that are hidden (display:none
 * via CSS — e.g. the top 728×90 on mobile) so no impression is
 * wasted and nothing renders off-layout.
 * Each slot is filled exactly ONCE (guarded by data-ad-loaded).
 */
function renderAdSlots(root = document) {
  root.querySelectorAll('[data-ad]').forEach((slot) => {
    if (slot.dataset.adLoaded === '1') return;               // already filled
    if (getComputedStyle(slot).display === 'none') return;   // hidden slot (mobile)
    const unit = AD_UNITS[slot.dataset.ad];
    if (!unit) return;
    slot.appendChild(_buildAdIframe(unit));
    slot.dataset.adLoaded = '1';
  });
}


/* ================================================================
   2. AD PENALTY SYSTEM
   ────────────────────────────────────────────────────────────────
   Rolling-window click tracker on the "Send Login Link" button.
   Exceed the threshold → button replaced by penalty container
   (320×50 ad + Smartlink unlock button + countdown).
   Only this one button is affected.
   ================================================================ */

const AD_PENALTY_CONFIG = {
  threshold:      3,          // 4th click inside the window triggers penalty
  windowMs:       2 * 60_000, // rolling 2-minute window
  unlockDelaySec: 12,         // countdown after Smartlink click
};

let _penaltyClickTimestamps = [];
let _unlockCountdownId      = null;

function _recordClickAndCheckPenalty() {
  const now = Date.now();
  _penaltyClickTimestamps = _penaltyClickTimestamps.filter(
    (t) => now - t < AD_PENALTY_CONFIG.windowMs
  );
  _penaltyClickTimestamps.push(now);
  return _penaltyClickTimestamps.length > AD_PENALTY_CONFIG.threshold;
}

function _showAdPenalty() {
  document.getElementById('sendLoginBtn').style.display       = 'none';
  const container = document.getElementById('adPenaltyContainer');
  container.style.display = 'flex';
  renderAdSlots(container);   // lazy-load the penalty ad only when shown
  _setUnlockInfo('View the ad, then click "Unlock" below.', '');
}

function _hideAdPenalty() {
  document.getElementById('adPenaltyContainer').style.display = 'none';
  document.getElementById('sendLoginBtn').style.display        = '';
  _penaltyClickTimestamps = _penaltyClickTimestamps.slice(-2); // fresh window
  _setUnlockInfo('', '');
}

function _setUnlockInfo(text, cssClass) {
  const el = document.getElementById('adUnlockInfo');
  el.textContent = text;
  el.className   = 'ad-unlock-info' + (cssClass ? ` ${cssClass}` : '');
}

/** Smartlink unlock click → countdown → restore button. (global for HTML onclick) */
function onAdClicked() {
  if (_unlockCountdownId !== null) return; // already counting

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
   3. NOTICE / MAINTENANCE
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
  } catch { /* never block the UI on a failed status check */ }
  return false;
}


/* ================================================================
   4. SEND LOGIN LINK + COOLDOWN TIMER
   ================================================================ */

const TIMER_DURATIONS = [30, 30, 60, 120, 300]; // progressive cooldown (s)
let _sendClickCount  = 0;
let _cooldownTimerId = null;

function startTimer(seconds) {
  const btn       = document.getElementById('sendLoginBtn');
  const timerText = document.getElementById('timerText');

  btn.disabled  = true;
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

  // ── Ad-penalty check (before anything else) ──────────────────
  if (_recordClickAndCheckPenalty()) {
    _showAdPenalty();
    return; // Do NOT fire the API call
  }

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
   5. CODE GENERATION
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

    const themeUrl = document.getElementById('themeSelect').value;
    const codeRes  = await fetch(themeUrl);
    const code     = await codeRes.text();

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

    const popup = document.getElementById('accountPopup');
    popup.classList.add('visible');
    renderAdSlots(popup);   // lazy-load the popup ad only when shown

  } catch (err) {
    showAlert('Error: ' + err.message, false);
  }
}


/* ================================================================
   6. COPY / DOWNLOAD HELPERS
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
   7. POPUP / ALERT HELPERS
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
    width:${size}px;height:${size}px;
    left:${event.clientX - rect.left - size / 2}px;
    top:${event.clientY - rect.top - size / 2}px;`;
  btn.appendChild(circle);
  setTimeout(() => circle.remove(), 600);
}


/* ================================================================
   8. INIT
   ================================================================ */

// Block background scroll until the notice is dismissed
document.body.style.overflow = 'hidden';

// Check maintenance flag
checkMaintenanceStatus();

// Render visible ad slots once the DOM is ready.
// Hidden slots (top banner on mobile, penalty, popup) are skipped
// here and lazy-loaded when they actually become visible.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => renderAdSlots());
} else {
  renderAdSlots();
}
