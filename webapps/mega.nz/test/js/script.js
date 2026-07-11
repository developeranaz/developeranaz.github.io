/* ================================================================
   script.js — MEGA Index Code Generator
   ================================================================
   Sections:
     1. AD RENDERING (isolated iframes — fixes duplicate ads)
     2. AD PENALTY SYSTEM
     3. NOTICE / MAINTENANCE
     4. ADBLOCKER DETECTION (Extreme level)
     5. CODE GENERATION (Calling api-meganz worker brain)
     6. COPY / DOWNLOAD HELPERS
     7. POPUP / ALERT HELPERS
     8. INIT
   ================================================================ */

'use strict';

/* ================================================================
   1. AD RENDERING — ISOLATED IFRAMES
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

function renderAdSlots(root = document) {
  root.querySelectorAll('[data-ad]').forEach((slot) => {
    if (slot.dataset.adLoaded === '1') return;
    if (getComputedStyle(slot).display === 'none') return;
    const unit = AD_UNITS[slot.dataset.ad];
    if (!unit) return;
    slot.appendChild(_buildAdIframe(unit));
    slot.dataset.adLoaded = '1';
  });
}


/* ================================================================
   2. AD PENALTY SYSTEM
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
  document.getElementById('generateBtn').style.display = 'none';
  const container = document.getElementById('adPenaltyContainer');
  container.style.display = 'flex';
  renderAdSlots(container);
  _setUnlockInfo('View the ad, then click "Unlock" below.', '');
}

function _hideAdPenalty() {
  document.getElementById('adPenaltyContainer').style.display = 'none';
  document.getElementById('generateBtn').style.display = '';
  _penaltyClickTimestamps = _penaltyClickTimestamps.slice(-2); // reset window partially
  _setUnlockInfo('', '');
}

function _setUnlockInfo(text, cssClass) {
  const el = document.getElementById('adUnlockInfo');
  el.textContent = text;
  el.className   = 'ad-unlock-info' + (cssClass ? ` ${cssClass}` : '');
}

function onAdClicked() {
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
      _setUnlockInfo('Unlocked! Re-enabling generation.', 'unlocked');
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
  } catch { /* do not block ui on request failure */ }
  return false;
}


/* ================================================================
   4. ADBLOCKER DETECTION (Extreme Level)
   ================================================================ */

async function detectAdBlocker() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('bypass_adblock')) {
    console.log('AdBlocker check bypassed for testing.');
    return;
  }

  let isBlocked = false;

  // Check 1: Bait div injection checking height/collapsing
  const bait = document.createElement('div');
  bait.className = 'adsbox ad-slot ad-banner doubleclick ad-placement sponsored-post';
  bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;display:block !important;';
  document.body.appendChild(bait);
  
  await new Promise(resolve => requestAnimationFrame(resolve));
  
  if (bait.offsetHeight === 0 || bait.offsetWidth === 0 || 
      window.getComputedStyle(bait).display === 'none' || 
      window.getComputedStyle(bait).visibility === 'hidden') {
    isBlocked = true;
  }
  document.body.removeChild(bait);

  // Check 2: Try fetching standard Adsterra invoke.js script (triggers ERR_BLOCKED_BY_CLIENT)
  try {
    const res = await fetch('https://amoralstern.com/cfdd26285d2be07540494f6205a5954a/invoke.js', {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store'
    });
  } catch (err) {
    isBlocked = true;
  }

  // Check 3: Check if global window script blocks are active
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.adblock) {
    isBlocked = true;
  }

  if (isBlocked) {
    document.getElementById('adblockerOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Disable inputs & button as a strict fallback
    document.getElementById('emailInput').disabled = true;
    document.getElementById('passwordInput').disabled = true;
    document.getElementById('generateBtn').disabled = true;
  }
}


/* ================================================================
   5. CODE GENERATION
   ================================================================ */

async function generateMegaCode(e) {
  createRipple(e);

  // Trigger penalty if click limit exceeded
  if (_recordClickAndCheckPenalty()) {
    _showAdPenalty();
    return;
  }

  const email = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passwordInput').value.trim();

  if (!email || !password) {
    showAlert('Please enter both your MEGA email and password', false);
    return;
  }

  const genBtn = document.getElementById('generateBtn');
  genBtn.disabled = true;
  genBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Generating code...';

  try {
    const res = await fetch('https://api-meganz.anas-appdata.workers.dev/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server returned error status ${res.status}`);
    }

    const data = await res.json();
    if (!data || !data.DEFAULT_SESSION_ID || !data.DEFAULT_MASTER_KEY) {
      throw new Error('Invalid credentials or no session data received from server.');
    }

    const sidVal = data.DEFAULT_SESSION_ID;
    const masterVal = data.DEFAULT_MASTER_KEY;

    // Download the template script
    const templateSelect = document.getElementById('themeSelect');
    const templateUrl = templateSelect.value;
    const templateRes = await fetch(templateUrl);
    if (!templateRes.ok) {
      throw new Error(`Failed to download worker template. Status: ${templateRes.status}`);
    }

    let workerCode = await templateRes.text();
    
    // Replace placeholders exactly
    workerCode = workerCode.replace(/THE_SESSION_ID_FROM_MEGA\.NZ_CODE_GENERATOR/g, sidVal);
    workerCode = workerCode.replace(/THE_MASTER_KEY_FROM_MEGA\.NZ_CODE_GENERATOR/g, masterVal);

    document.getElementById('codeOutput').value = workerCode;
    document.querySelector('.code-container').classList.add('visible');
    document.getElementById('outputSection').style.display = 'block';

    // Display parsed info in stats popup (truncated for security)
    document.getElementById('popupEmail').textContent = email;
    document.getElementById('popupSession').textContent = sidVal.substring(0, 8) + '••••••••••••' + sidVal.slice(-8);
    document.getElementById('popupMaster').textContent = masterVal.substring(0, 8) + '••••••••••••' + masterVal.slice(-8);

    const popup = document.getElementById('accountPopup');
    popup.classList.add('visible');
    renderAdSlots(popup);

  } catch (err) {
    showAlert(err.message, false);
  } finally {
    genBtn.disabled = false;
    genBtn.innerHTML = '<i class="fas fa-bolt"></i> Generate Custom worker.js';
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
    href: url, download: 'mega-worker.js',
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

// Toggle Password Visibility
const togglePassword = document.getElementById("togglePassword");
const passwordInput = document.getElementById("passwordInput");
togglePassword.addEventListener("click", () => {
  const type = passwordInput.getAttribute("type") === "password" ? "text" : "password";
  passwordInput.setAttribute("type", type);
  togglePassword.classList.toggle("fa-eye");
  togglePassword.classList.toggle("fa-eye-slash");
});

// Block background scroll until the notice is dismissed
document.body.style.overflow = 'hidden';

// Run adblocker detection
detectAdBlocker();

// Re-run adblocker check periodically in case it is enabled after load
setInterval(detectAdBlocker, 3000);

// Check maintenance flag
checkMaintenanceStatus();

// Render visible ad slots once the DOM is ready.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => renderAdSlots());
} else {
  renderAdSlots();
}
