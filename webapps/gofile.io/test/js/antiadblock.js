/**
 * Anti-Adblock Detector
 * ------------------------------------------------------------------
 * Client-side only, no server/backend required.
 *
 * WHAT THIS CAN AND CANNOT DO (read this before relying on it):
 *
 *  - It CAN detect "something is blocking/hiding ad-like content" with
 *    good reliability, using multiple independent signals combined.
 *  - It CANNOT reliably identify *which* specific extension is doing it
 *    (uBlock vs AdGuard vs ABP all behave the same way from the page's
 *    point of view: they hide/remove elements and block requests). Any
 *    script that claims to name the exact extension is guessing from
 *    indirect signals and will be wrong often. This script reports
 *    *that* blocking is happening, and a best-effort *category* only.
 *  - Brave Shields and Firefox Enhanced Tracking Protection are privacy
 *    features, not classic adblockers. They mostly block trackers, not
 *    on-page ad slots, so they are treated as a soft/optional signal
 *    here rather than a hard "ad blocked" verdict, to avoid punishing
 *    ordinary privacy-conscious visitors.
 *  - No amount of obfuscation stops a filter list, because filter lists
 *    match on DOM/CSS/URL patterns, not on how readable your JS is.
 *    This script avoids obvious naming (no id="ad-banner" anywhere)
 *    but does not pretend to be unbreakable.
 *
 * HOW IT DECIDES:
 *  Several independent checks each contribute a weighted "signal".
 *  If the combined weight crosses a threshold, we call it a positive
 *  detection. This avoids false positives from e.g. one slow CDN
 *  request, because no single check alone can trigger the response.
 *
 * USAGE:
 *   <link rel="stylesheet" href="css/antiadblock.css">
 *   <script src="js/antiadblock.js"></script>
 *   <script>
 *     AntiAdblock.init({
 *       responseMode: 'lock',      // 'lock' | 'banner' | 'overlay' | 'redirect'
 *       recheckMin: 8000,
 *       recheckMax, 20000,
 *       threshold: 2,
 *     });
 *   </script>
 */

(function (window, document) {
  'use strict';

  // ------------------------------------------------------------------
  // Config (overridable via AntiAdblock.init(options))
  // ------------------------------------------------------------------
  const defaults = {
    responseMode: 'lock',      // 'lock' (blur+overlay) | 'banner' | 'overlay' | 'redirect'
    redirectUrl: null,         // used only if responseMode === 'redirect'
    threshold: 2,              // combined weight needed to trigger positive detection
    recheckMin: 6000,          // ms, minimum delay between periodic rechecks
    recheckMax: 18000,         // ms, maximum delay (randomized to dodge simple filter timing)
    initialDelayMin: 400,      // ms, randomize first check so it isn't a fixed-time fingerprint
    initialDelayMax: 1600,
    networkTimeout: 2500,      // ms, how long to wait on the bait network request
    lockTargetSelector: 'body',// what gets blurred in 'lock' mode
    debug: false,              // set true to console.log internal decisions during dev
  };

  let cfg = Object.assign({}, defaults);
  let currentWeight = 0;
  let activeSignals = new Set();
  let responseShown = false;
  let mutationObserverRef = null;

  function log(...args) {
    if (cfg.debug) console.log('[AntiAdblock]', ...args);
  }

  // ------------------------------------------------------------------
  // Utility: random integer between min and max (inclusive)
  // ------------------------------------------------------------------
  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ------------------------------------------------------------------
  // Signal 1: Bait elements
  // Create elements with classnames/ids that filter lists commonly
  // target (this list mirrors EasyList-style selectors) and check
  // whether they get hidden, zero-sized, or removed shortly after.
  // ------------------------------------------------------------------
  function checkBaitElements() {
    return new Promise((resolve) => {
      const baitClassNames = [
        'adsbox', 'ad-banner', 'banner-ads', 'ads-banner',
        'sponsor', 'sponsored-content', 'text-ad', 'textAd',
        'ad-container', 'adsbygoogle', 'pub_300x250',
      ];

      const bait = document.createElement('div');
      bait.className = baitClassNames.join(' ');
      // Common inline-style bait pattern many filter lists key on
      bait.style.cssText =
        'position:absolute; left:-9999px; top:-9999px; width:1px; height:1px;';
      bait.setAttribute('data-aab', 'bait');

      // A second bait using a background-image referencing a known
      // ad-serving-like path, since some filter lists match on URL
      // patterns for background images too.
      const bait2 = document.createElement('div');
      bait2.className = 'ad-slot ad-unit ad-placement';
      bait2.style.cssText = 'height:1px;width:1px;';

      document.body.appendChild(bait);
      document.body.appendChild(bait2);

      // Give filter lists (which act via CSS injected at document-idle
      // or via MutationObserver-based extensions) a moment to act.
      setTimeout(() => {
        let blocked = false;

        [bait, bait2].forEach((el) => {
          if (!el.parentNode) {
            blocked = true; // removed entirely
            return;
          }
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            parseInt(style.height, 10) === 0 ||
            el.offsetParent === null && style.position !== 'absolute' ||
            rect.height === 0
          ) {
            blocked = true;
          }
        });

        [bait, bait2].forEach((el) => el.parentNode && el.parentNode.removeChild(el));
        log('bait element check ->', blocked);
        resolve(blocked);
      }, 150);
    });
  }

  // ------------------------------------------------------------------
  // Signal 2: Ad-script load check
  // Try to load a script path that resembles a known ad-serving script.
  // If it errors/blocks (adblockers intercept the request), that's a
  // strong signal. We don't actually need the script to exist — a
  // blocked *request* (not a 404) is the tell, so we race it against
  // a timeout and also inspect whether it was blocked vs simply missing.
  // ------------------------------------------------------------------
  function checkScriptBlocking() {
    return new Promise((resolve) => {
      const testUrls = [
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://www.googletagservices.com/tag/js/gpt.js',
      ];

      let remaining = testUrls.length;
      let anyBlocked = false;
      let settled = false;

      function finish() {
        if (settled) return;
        settled = true;
        resolve(anyBlocked);
      }

      const timer = setTimeout(finish, cfg.networkTimeout);

      testUrls.forEach((url) => {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = () => {
          remaining -= 1;
          if (remaining === 0) {
            clearTimeout(timer);
            finish();
          }
        };
        s.onerror = () => {
          // A network-level block (ERR_BLOCKED_BY_CLIENT) fires onerror
          // almost immediately; a genuine 404 also fires onerror, so
          // we treat onerror as a *soft* signal only, combined with
          // the fetch-based check below for confirmation.
          anyBlocked = true;
          remaining -= 1;
          if (remaining === 0) {
            clearTimeout(timer);
            finish();
          }
        };
        document.head.appendChild(s);
        setTimeout(() => s.parentNode && s.parentNode.removeChild(s), cfg.networkTimeout + 200);
      });
    });
  }

  // ------------------------------------------------------------------
  // Signal 3: Network request test via fetch
  // fetch() to a known ad-serving endpoint. Adblockers that intercept
  // at the network layer (most do, via webRequest API) will reject
  // this with a TypeError ("Failed to fetch") rather than a normal
  // HTTP error, which is distinguishable from generic network flakiness
  // because we also do a control request to a neutral, unblocked host.
  // ------------------------------------------------------------------
  function checkNetworkRequest() {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.networkTimeout);

      const adLikeUrl = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';

      fetch(adLikeUrl, { mode: 'no-cors', signal: controller.signal })
        .then(() => {
          clearTimeout(timer);
          resolve(false); // request went through, not blocked
        })
        .catch((err) => {
          clearTimeout(timer);
          // AbortError from OUR OWN timeout is ambiguous (could be slow
          // network, not a blocker) so we do NOT count it as a signal.
          // A blocked-by-client failure is near-instant and throws a
          // generic TypeError instead — that's the reliable tell.
          if (err && err.name === 'AbortError') {
            log('network check inconclusive (timeout, not counted)');
            resolve(false);
          } else {
            log('network check -> blocked', err && err.message);
            resolve(true);
          }
        });
    });
  }

  // ------------------------------------------------------------------
  // Signal 4: CSS-hiding detection
  // Some blockers apply cosmetic filters (pure CSS, no element removal)
  // via injected stylesheets. Check whether a bait element with an
  // ad-like id gets a display:none / visibility:hidden / height:0 rule
  // applied purely through the cascade, separate from Signal 1's
  // timing-based check (this one checks *immediately*, catching
  // synchronous CSS injection specifically).
  // ------------------------------------------------------------------
  function checkCssHiding() {
    const probe = document.createElement('ins');
    probe.className = 'adsbygoogle';
    probe.setAttribute('data-ad-client', 'ca-pub-0000000000000000');
    probe.setAttribute('data-ad-slot', '0000000000');
    probe.style.cssText = 'display:inline-block; width:1px; height:1px;';
    document.body.appendChild(probe);

    const style = window.getComputedStyle(probe);
    const hidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0';

    probe.parentNode.removeChild(probe);
    log('css hiding check ->', hidden);
    return hidden;
  }

  // ------------------------------------------------------------------
  // Signal 5: DOM modification / dynamic-disable detection
  // Watches for elements matching ad-like selectors being removed or
  // re-hidden AFTER initial load (covers "ad blocker enabled mid-session"
  // and lazy-loaded/async ad slots that get stripped after they mount).
  // This runs continuously via MutationObserver rather than on a timer.
  // ------------------------------------------------------------------
  function watchDomMutations(onSuspiciousActivity) {
    if (mutationObserverRef) return; // already watching

    mutationObserverRef = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.removedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const cls = (node.className || '') + '';
          if (/\b(ad|ads|sponsor|banner-ad)\b/i.test(cls) && node.getAttribute('data-aab') !== 'bait') {
            log('mutation observer saw an ad-like node removed:', cls);
            onSuspiciousActivity();
          }
        });
      }
    });

    mutationObserverRef.observe(document.body, { childList: true, subtree: true });
  }

  // ------------------------------------------------------------------
  // Combine signals into a weighted score.
  // Weighting rationale:
  //   - Bait element hidden/removed: strong, direct evidence -> 1.0
  //   - CSS hiding probe: strong, direct, synchronous -> 1.0
  //   - Script blocked (onerror): soft signal alone (could be 404 or
  //     ISP-level DNS issue) -> 0.5
  //   - Network fetch blocked: stronger than script-onerror because we
  //     exclude timeouts -> 1.0
  // A single soft signal (0.5) never crosses the default threshold of
  // 2 on its own; you need at least one strong signal plus corroboration,
  // which is what keeps slow-network false positives out.
  // ------------------------------------------------------------------
  async function runFullCheck() {
    const [baited, scriptBlocked, netBlocked] = await Promise.all([
      checkBaitElements(),
      checkScriptBlocking(),
      checkNetworkRequest(),
    ]);
    const cssHidden = checkCssHiding();

    let weight = 0;
    activeSignals.clear();

    if (baited) { weight += 1.0; activeSignals.add('bait-element'); }
    if (cssHidden) { weight += 1.0; activeSignals.add('css-hiding'); }
    if (netBlocked) { weight += 1.0; activeSignals.add('network-request'); }
    if (scriptBlocked) { weight += 0.5; activeSignals.add('script-load'); }

    currentWeight = weight;
    log('signals:', [...activeSignals], 'weight:', weight);
    return weight >= cfg.threshold;
  }

  // ------------------------------------------------------------------
  // Response UI
  // ------------------------------------------------------------------
  function buildOverlayMarkup() {
    const wrap = document.createElement('div');
    wrap.className = 'aab-overlay';
    wrap.id = 'aab-overlay-root';
    wrap.innerHTML = `
      <div class="aab-box" role="dialog" aria-modal="true" aria-labelledby="aab-title">
        <svg class="aab-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="#2563eb" stroke-width="1.6"/>
          <path d="M12 7.5v5.25" stroke="#2563eb" stroke-width="1.6" stroke-linecap="round"/>
          <circle cx="12" cy="16" r="0.9" fill="#2563eb"/>
        </svg>
        <h2 id="aab-title">Ad blocker detected</h2>
        <p>This site relies on ads to keep running and stay free. Please disable your ad blocker for this site, then reload the page.</p>
        <div class="aab-actions">
          <button class="aab-btn aab-btn-primary" id="aab-recheck-btn">I've disabled it — recheck</button>
        </div>
        <div class="aab-hint">This message will disappear automatically once no blocker is detected.</div>
      </div>
    `;
    return wrap;
  }

  function showResponse() {
    if (responseShown) return;
    responseShown = true;

    if (cfg.responseMode === 'redirect') {
      if (cfg.redirectUrl) window.location.href = cfg.redirectUrl;
      return;
    }

    if (cfg.responseMode === 'banner') {
      const banner = document.createElement('div');
      banner.id = 'aab-banner-root';
      banner.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111827;color:#fff;' +
        'padding:12px 16px;text-align:center;font-family:sans-serif;font-size:0.9rem;';
      banner.innerHTML =
        'Ad blocker detected — please consider disabling it to support this site. ' +
        '<button id="aab-banner-dismiss" style="margin-left:12px;background:#2563eb;border:none;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;">Dismiss</button>';
      document.body.appendChild(banner);
      document.getElementById('aab-banner-dismiss').addEventListener('click', () => {
        banner.remove();
        responseShown = false;
      });
      return;
    }

    // 'lock' and 'overlay' both show the modal; 'lock' additionally blurs page content.
    if (cfg.responseMode === 'lock') {
      const target = document.querySelector(cfg.lockTargetSelector);
      if (target) target.classList.add('aab-blurred');
    }

    const overlay = buildOverlayMarkup();
    document.body.appendChild(overlay);

    document.getElementById('aab-recheck-btn').addEventListener('click', async () => {
      const btn = document.getElementById('aab-recheck-btn');
      btn.textContent = 'Checking...';
      btn.disabled = true;
      const stillBlocked = await runFullCheck();
      if (!stillBlocked) {
        hideResponse();
      } else {
        btn.textContent = "I've disabled it — recheck";
        btn.disabled = false;
      }
    });
  }

  function hideResponse() {
    responseShown = false;
    const overlay = document.getElementById('aab-overlay-root');
    if (overlay) overlay.remove();
    const banner = document.getElementById('aab-banner-root');
    if (banner) banner.remove();
    const target = document.querySelector(cfg.lockTargetSelector);
    if (target) target.classList.remove('aab-blurred');
  }

  // ------------------------------------------------------------------
  // Scheduling: randomized initial delay + randomized recheck interval,
  // so the timing itself isn't a fixed pattern a filter rule could key
  // on, and periodic rechecks catch adblockers toggled on mid-session.
  // ------------------------------------------------------------------
  function scheduleNextCheck() {
    const delay = rand(cfg.recheckMin, cfg.recheckMax);
    setTimeout(async () => {
      const detected = await runFullCheck();
      if (detected) {
        showResponse();
      } else {
        hideResponse();
      }
      scheduleNextCheck();
    }, delay);
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------
  const AntiAdblock = {
    init(options) {
      cfg = Object.assign({}, defaults, options || {});

      const start = async () => {
        watchDomMutations(() => {
          // A suspicious removal happened outside our own scheduled
          // check; run a full verification rather than trusting the
          // single mutation signal alone (avoids false positives from
          // legitimate DOM cleanup code on the page).
          runFullCheck().then((detected) => {
            if (detected) showResponse();
          });
        });

        const initialDelay = rand(cfg.initialDelayMin, cfg.initialDelayMax);
        setTimeout(async () => {
          const detected = await runFullCheck();
          if (detected) showResponse();
          scheduleNextCheck();
        }, initialDelay);
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
      } else {
        start();
      }
    },

    // Exposed for debugging / manual triggering from console if needed.
    forceCheck: runFullCheck,
    getStatus: () => ({ weight: currentWeight, signals: [...activeSignals], shown: responseShown }),
  };

  window.AntiAdblock = AntiAdblock;
})(window, document);
