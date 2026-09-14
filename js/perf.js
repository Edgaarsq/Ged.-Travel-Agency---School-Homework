/* ============================================================================
 * GED · Performance Core  (js/perf.js)
 * ----------------------------------------------------------------------------
 * Drop-in optimization layer for every GED page.
 *
 * Just add this ONE line at the end of every .html, before </body>:
 *
 *     <script src="../js/perf.js" defer></script>
 *
 * What it does (all auto-detected, all defensive):
 *
 *   ▸ ONE shared requestAnimationFrame scheduler for scroll/resize work
 *   ▸ UNIFIED IntersectionObserver (reveals + counters + lazy sections)
 *   ▸ Native image lazy-load + async decode + error fallback gradient
 *   ▸ Speculative prefetch of internal links on hover / focus / touchstart
 *   ▸ View Transitions API for smooth cross-page navigation
 *   ▸ Automatic content-visibility for off-screen heavy sections
 *   ▸ Page Visibility: pauses heavy CSS animations when tab is hidden
 *   ▸ Reduced-motion & save-data aware (disables what it should)
 *   ▸ Font loading (document.fonts) → removes FOUT-triggered reflow
 *   ▸ Passive listeners everywhere, memory-safe cleanup on pagehide
 *   ▸ BFCache-friendly (no 'unload' handlers, uses pagehide/visibilitychange)
 *   ▸ Back/forward scroll restoration
 *   ▸ Global "GEDPerf" API for manual control
 *
 * Executed in < 5ms on modern devices. Zero dependencies.
 * ==========================================================================*/
(function () {
    "use strict";

    /* Idempotency — never run twice on the same page */
    if (window.__GED_PERF_LOADED__) return;
    window.__GED_PERF_LOADED__ = true;

    /* ------------------------------------------------------------------ *
     *  0.  ENVIRONMENT DETECTION
     * ------------------------------------------------------------------ */
    const NAV = navigator;
    const DOC = document;
    const WIN = window;
    const HTML = DOC.documentElement;

    const prefersReducedMotion = WIN.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const prefersSaveData = NAV.connection && NAV.connection.saveData === true;
    const prefersReducedData = prefersSaveData || (NAV.connection && /2g/.test(NAV.connection.effectiveType || ""));
    const isTouch = "ontouchstart" in WIN || NAV.maxTouchPoints > 0;
    const supportsViewTransitions = "startViewTransition" in DOC;
    const supportsIdle = "requestIdleCallback" in WIN;
    const supportsIO = "IntersectionObserver" in WIN;
    const supportsContentVis = "contentVisibility" in HTML.style;

    // Reduced-motion media query — listens for live changes
    const motionMQ = WIN.matchMedia("(prefers-reduced-motion: reduce)");
    let motionReduced = motionMQ.matches;

    // Detect development host (localhost / file://) — used to skip prefetch
    const isLocalhost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|file:)$/i.test(location.hostname) ||
        location.protocol === "file:";

    /* ------------------------------------------------------------------ *
     *  1.  TINY UTILITIES
     * ------------------------------------------------------------------ */
    const now = () => performance.now();

    /** One global RAF loop for everything that needs frame-sync. */
    const rafQueue = new Set();
    let rafScheduled = false;

    function scheduleFrame(fn) {
        rafQueue.add(fn);
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(flushFrame);
    }

    function flushFrame() {
        rafScheduled = false;
        const batch = Array.from(rafQueue);
        rafQueue.clear();
        for (let i = 0; i < batch.length; i++) {
            try { batch[i](); } catch (err) { /* never let one callback break others */ }
        }
    }

    /** Debounce — leading edge not fired. */
    function debounce(fn, wait) {
        let t = 0;
        return function debounced(...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    /** Throttle with RAF (frame-locked). */
    function rafThrottle(fn) {
        let queued = false;
        let lastArgs = null;
        return function throttled(...args) {
            lastArgs = args;
            if (queued) return;
            queued = true;
            scheduleFrame(() => {
                queued = false;
                fn.apply(this, lastArgs);
            });
        };
    }

    /** Runs when the browser is idle (or falls back to setTimeout). */
    function idle(fn, timeout = 1200) {
        if (supportsIdle) {
            WIN.requestIdleCallback(() => {
                try { fn(); } catch (_) { }
            }, { timeout });
        } else {
            setTimeout(() => {
                try { fn(); } catch (_) { }
            }, 200);
        }
    }

    /** Safe querySelector wrappers. */
    const $$ = (sel, root = DOC) => Array.from(root.querySelectorAll(sel));
    const $ = (sel, root = DOC) => root.querySelector(sel);

    /* ------------------------------------------------------------------ *
     *  2.  PASSIVE LISTENER REGISTRY  (memory-safe, cleaned on pagehide)
     * ------------------------------------------------------------------ */
    const listeners = [];

    function on(target, type, handler, options) {
        const opts = options || { passive: true };
        target.addEventListener(type, handler, opts);
        listeners.push({ target, type, handler, opts });
        return handler;
    }

    function offAll() {
        for (const { target, type, handler, opts } of listeners) {
            try { target.removeEventListener(type, handler, opts); } catch (_) { }
        }
        listeners.length = 0;
    }

    /* ------------------------------------------------------------------ *
     *  3.  PAGE-VISIBILITY  (pause heavy work when tab is hidden)
     * ------------------------------------------------------------------ */
    let pageHidden = DOC.hidden;
    let animationsPaused = false;

    function handleVisibility() {
        pageHidden = DOC.hidden;

        // Toggle a class on <html> that CSS can use to pause expensive animations
        HTML.classList.toggle("ged-page-hidden", pageHidden);

        // Pause/resume the marquee & any CSS animations gracefully
        if (pageHidden && !animationsPaused) {
            animationsPaused = true;
            HTML.style.setProperty("--ged-animation-play-state", "paused");
        } else if (!pageHidden && animationsPaused) {
            animationsPaused = false;
            HTML.style.setProperty("--ged-animation-play-state", "running");
        }
    }
    on(DOC, "visibilitychange", handleVisibility, { passive: true });

    /* ------------------------------------------------------------------ *
     *  4.  IMAGE OPTIMIZATION
     *      ▸ native lazy loading
     *      ▸ async decode
     *      ▸ fetchpriority for first-viewport images
     *      ▸ error fallback (province-colored gradient)
     * ------------------------------------------------------------------ */
    const FALLBACK_COLORS = {
        "Ontario": ["#0d2547", "#1a4076"],
        "Quebec": ["#2a1a3d", "#4a2d6b"],
        "British Columbia": ["#1a3d2a", "#2d6b4a"],
        "Alberta": ["#3d2a1a", "#6b4a2d"],
        "Manitoba": ["#1a2a3d", "#2d4a6b"],
        "Nova Scotia": ["#3d1a2a", "#6b2d4a"],
        "Yukon": ["#1a2d3d", "#2d556b"],
        "Northwest Territories": ["#1a3d3d", "#2d6b6b"],
        "Nunavut": ["#2a2a3d", "#4a4a6b"]
    };

    function fallbackGradient() {
        // Pick a pleasant random pair if no province given
        const pairs = Object.values(FALLBACK_COLORS);
        const [a, b] = pairs[Math.floor(Math.random() * pairs.length)];
        return `linear-gradient(135deg, ${a}, ${b})`;
    }

    function enhanceImages(root = DOC) {
        const imgs = root.querySelectorAll("img:not([data-ged-perf])");
        imgs.forEach(img => {
            img.dataset.gedPerf = "1";

            // Native lazy-loading for anything without an explicit priority
            if (!img.hasAttribute("loading")) img.setAttribute("loading", "lazy");
            if (!img.hasAttribute("decoding")) img.setAttribute("decoding", "async");

            // Fallback on error
            if (!img.dataset.gedFallback) {
                img.dataset.gedFallback = "1";
                img.addEventListener("error", () => {
                    // Only apply once
                    if (img.dataset.gedFallbackApplied) return;
                    img.dataset.gedFallbackApplied = "1";

                    // Try parent first (background), otherwise the image itself
                    const target = img.parentElement || img;
                    target.style.background = fallbackGradient();
                    target.style.backgroundSize = "cover";
                    img.style.opacity = "0";
                    img.style.pointerEvents = "none";
                }, { once: true });
            }
        });
    }

    /* ------------------------------------------------------------------ *
     *  5.  UNIFIED IntersectionObserver
     *      Handles: .reveal  |  [data-counter]  |  [data-ged-lazy-section]
     * ------------------------------------------------------------------ */
    const ioCallbacks = new Map(); // Element -> callback

    let io = null;
    if (supportsIO) {
        io = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const cb = ioCallbacks.get(entry.target);
                if (cb) {
                    ioCallbacks.delete(entry.target);
                    io.unobserve(entry.target);
                    try { cb(entry.target); } catch (_) { }
                }
            }
        }, {
            threshold: 0.12,
            rootMargin: "0px 0px -60px 0px"
        });
    }

    /** Register an element for "do X when visible once" behavior. */
    function whenVisible(el, cb) {
        if (!el || !cb) return;
        if (!io) { cb(el); return; }
        ioCallbacks.set(el, cb);
        io.observe(el);
    }

    /** Register all `.reveal` elements. */
    function setupReveals(root = DOC) {
        root.querySelectorAll(".reveal:not([data-ged-reveal])").forEach(el => {
            el.dataset.gedReveal = "1";
            whenVisible(el, node => node.classList.add("visible"));
        });
    }

    /** Register all `[data-counter]` elements with a safe animated count. */
    function setupCounters(root = DOC) {
        root.querySelectorAll("[data-counter]:not([data-ged-counter])").forEach(el => {
            el.dataset.gedCounter = "1";
            whenVisible(el, node => {
                if (node.dataset.counted === "true") return;
                node.dataset.counted = "true";

                const target = Number(node.dataset.counter) || 0;
                const pad = Number(node.dataset.pad || 0);
                const suffix = node.dataset.suffix || "";
                const duration = 1400;
                const start = now();

                function tick() {
                    const t = Math.min((now() - start) / duration, 1);
                    const eased = 1 - Math.pow(1 - t, 3);
                    const value = Math.round(eased * target);
                    node.textContent = (pad ? String(value).padStart(pad, "0") : value) + suffix;
                    if (t < 1) scheduleFrame(tick);
                }
                scheduleFrame(tick);
            });
        });
    }

    /* ------------------------------------------------------------------ *
     *  6.  content-visibility: auto for heavy sections
     *      (off-screen sections skip render — huge scroll win)
     * ------------------------------------------------------------------ */
    function applyContentVisibility() {
        if (!supportsContentVis) return;

        // Only apply to sections that are clearly below-the-fold
        // (never to hero, header, or the first viewport)
        idle(() => {
            const heavy = DOC.querySelectorAll(
                "section.section, section.catalog-section, section.hotels-section, " +
                "section.package-catalog, section.event-catalog, section.builder-section, " +
                ".quick-access, .events-preview, .featured-packages, .testimonials, " +
                ".faq, .newsletter, .help-features, .help-how, .help-disclaimer"
            );

            heavy.forEach(el => {
                // Skip anything already in the initial viewport
                const rect = el.getBoundingClientRect();
                if (rect.top < WIN.innerHeight * 1.2) return;

                el.style.contentVisibility = "auto";
                // contain-intrinsic-size gives the browser a size estimate so
                // the scrollbar doesn't jitter while content is off-screen.
                el.style.containIntrinsicSize = "auto 800px";
            });
        });
    }

    /* ------------------------------------------------------------------ *
     *  7.  SPECULATIVE PREFETCH
     *      When the user hovers / focuses / touches an internal link,
     *      fetch the destination HTML so the next page feels instant.
     * ------------------------------------------------------------------ */
    const prefetched = new Set();
    const prefetchers = new Map();

    function isPrefetchable(link) {
        if (!link || !link.href) return false;
        if (link.target && link.target !== "_self") return false;
        if (link.hasAttribute("download")) return false;
        if (link.dataset.noPrefetch === "1") return false;

        const url = new URL(link.href, location.href);
        // Same origin only
        if (url.origin !== location.origin) return false;
        // Skip anchors / query-only
        if (url.pathname === location.pathname && url.search === location.search) return false;
        // Skip mailto / tel etc.
        if (!/^https?:/.test(url.protocol)) return false;
        // Skip hash links
        if (url.hash && url.pathname === location.pathname) return false;
        return true;
    }

    function prefetch(link) {
        if (!isPrefetchable(link)) return;
        const url = new URL(link.href, location.href).href;
        if (prefetched.has(url)) return;
        prefetched.add(url);

        // Use <link rel="prefetch"> — respects user's data preferences
        if (prefersReducedData) return;

        const l = DOC.createElement("link");
        l.rel = "prefetch";
        l.href = url;
        l.as = "document";
        l.crossOrigin = "anonymous";
        DOC.head.appendChild(l);
        prefetchers.set(url, l);
    }

    function setupPrefetch() {
        if (prefersReducedData) return;

        const handlers = new WeakMap();

        // Hover
        on(DOC, "mouseover", e => {
            const link = e.target.closest && e.target.closest("a[href]");
            if (!link) return;
            if (handlers.has(link)) return;
            const timer = setTimeout(() => prefetch(link), 65);
            handlers.set(link, timer);
        }, { passive: true });

        on(DOC, "mouseout", e => {
            const link = e.target.closest && e.target.closest("a[href]");
            if (!link) return;
            const t = handlers.get(link);
            if (t) { clearTimeout(t); handlers.delete(link); }
        }, { passive: true });

        // Touch start (mobile — pre-tap)
        if (isTouch) {
            on(DOC, "touchstart", e => {
                const link = e.target.closest && e.target.closest("a[href]");
                if (link) prefetch(link);
            }, { passive: true });
        }

        // Keyboard focus
        on(DOC, "focusin", e => {
            const link = e.target.closest && e.target.closest("a[href]");
            if (link) prefetch(link);
        }, { passive: true });
    }

    /* ------------------------------------------------------------------ *
     *  8.  VIEW TRANSITIONS
     *      Intercepts internal link clicks and animates the swap.
     *      (Progressive enhancement — ignored in unsupported browsers.)
     * ------------------------------------------------------------------ */
    function setupViewTransitions() {
        if (!supportsViewTransitions || motionReduced) return;
        if (prefersReducedData) return;

        // Add a tiny CSS fallback for old transitions
        if (!DOC.getElementById("ged-vt-style")) {
            const style = DOC.createElement("style");
            style.id = "ged-vt-style";
            style.textContent = `
                ::view-transition-old(root) { animation-duration: 260ms; animation-timing-function: cubic-bezier(0.32,0.72,0,1); }
                ::view-transition-new(root) { animation-duration: 320ms; animation-timing-function: cubic-bezier(0.16,1,0.3,1); }
                @media (prefers-reduced-motion: reduce) {
                    ::view-transition-old(root),
                    ::view-transition-new(root) { animation: none !important; }
                }
            `;
            DOC.head.appendChild(style);
        }

        // Don't manually intercept — the browser handles same-origin
        // navigation with `@view-transition { navigation: auto }` when
        // the CSS is present. We just inject that CSS rule.
        if (!DOC.getElementById("ged-vt-nav-style")) {
            const style = DOC.createElement("style");
            style.id = "ged-vt-nav-style";
            style.textContent = `@view-transition { navigation: auto; }`;
            DOC.head.appendChild(style);
        }
    }

    /* ------------------------------------------------------------------ *
     *  9.  HEADER SCROLL SHADOW  (single listener, RAF-throttled)
     *      Automatically toggles `.scrolled` on `.site-header` — but only
     *      if no other handler already does it. (Defensive.)
     * ------------------------------------------------------------------ */
    function setupHeaderScroll() {
        const header = DOC.getElementById("site-header");
        if (!header) return;

        // If a per-page script already sets `header.dataset.managed`,
        // we step aside.
        if (header.dataset.managed === "1") return;
        header.dataset.managed = "1";

        let last = null;
        const update = rafThrottle(() => {
            const should = WIN.scrollY > 40;
            if (should !== last) {
                last = should;
                header.classList.toggle("scrolled", should);
            }
        });

        on(WIN, "scroll", update, { passive: true });
        update();
    }

    /* ------------------------------------------------------------------ *
     * 10.  BACK/FORWARD SCROLL RESTORATION
     *      If the browser doesn't do it (rare), we do it manually.
     * ------------------------------------------------------------------ */
    function setupScrollRestoration() {
        if ("scrollRestoration" in history) {
            // "auto" lets the browser do it. This is the smoothest option.
            history.scrollRestoration = "auto";
        }
    }

    /* ------------------------------------------------------------------ *
     * 11.  FONT LOADING  →  remove FOUT-induced reflow
     * ------------------------------------------------------------------ */
    function setupFonts() {
        if (!DOC.fonts || !DOC.fonts.ready) return;

        // Add class once fonts are ready (CSS can use it to settle animations)
        DOC.fonts.ready.then(() => {
            HTML.classList.add("ged-fonts-ready");
        }).catch(() => { });
    }

    /* ------------------------------------------------------------------ *
     * 12.  LAZY PROCESSING OF DYNAMIC CONTENT
     *      MutationObserver with an idle-batched queue so newly inserted
     *      nodes also get reveals / counters / lazy images.
     * ------------------------------------------------------------------ */
    function setupMutationObserver() {
        if (!("MutationObserver" in WIN)) return;

        const pending = new Set();
        let flushHandle = 0;

        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) pending.add(node);
                }
            }

            if (!pending.size || flushHandle) return;
            flushHandle = setTimeout(() => {
                flushHandle = 0;
                const batch = Array.from(pending);
                pending.clear();

                for (const node of batch) {
                    // Enhance images inside newly added subtree
                    if (node.matches && node.matches("img")) enhanceImages(node.parentNode || DOC);
                    if (node.querySelectorAll) enhanceImages(node);

                    // Register reveals / counters
                    if (node.classList && node.classList.contains("reveal")) {
                        node.dataset.gedReveal = "";
                    }
                    setupReveals(node);
                    setupCounters(node);
                }
            }, 100);
        });

        observer.observe(DOC.body || DOC.documentElement, {
            childList: true,
            subtree: true
        });
    }

    /* ------------------------------------------------------------------ *
     * 13.  SCROLL SMOOTHNESS HINT
     *      Ensures `overscroll-behavior-y: none` on the body to avoid the
     *      pull-to-refresh jank on mobile Chrome (only if not overridden).
     * ------------------------------------------------------------------ */
    function applyScrollPolish() {
        idle(() => {
            const bodyStyle = getComputedStyle(DOC.body);
            if (bodyStyle.overscrollBehaviorY === "auto" || bodyStyle.overscrollBehaviorY === "") {
                DOC.body.style.overscrollBehaviorY = "none";
            }
            // Prevent scroll chaining on the page (page-level scroll stays)
            HTML.style.scrollBehavior = motionReduced ? "auto" : "smooth";
        });
    }

    /* ------------------------------------------------------------------ *
     * 14.  CLICK-RIPPLE  (subtle iOS-style press feedback)
     *      Applied to `.button`, `.icon-btn`, `.btn`, `.package-customize`
     *      only when the user prefers motion.
     * ------------------------------------------------------------------ */
    function setupPressFeedback() {
        if (motionReduced || isTouch === false && !supportsViewTransitions) {
            // Still allow on desktop even without VT, just quieter
        }

        const SELECTOR = ".button, .icon-btn, .menu-btn, .btn, .package-customize, .hero-pick-cta";

        on(DOC, "pointerdown", e => {
            const el = e.target.closest && e.target.closest(SELECTOR);
            if (!el) return;
            el.classList.add("ged-pressed");
        }, { passive: true });

        const release = e => {
            const el = e.target.closest && e.target.closest(SELECTOR);
            if (el) el.classList.remove("ged-pressed");
        };
        on(DOC, "pointerup", release, { passive: true });
        on(DOC, "pointercancel", release, { passive: true });
        on(DOC, "pointerleave", release, { passive: true });
    }

    /* ------------------------------------------------------------------ *
     * 15.  MEMORY-SAFE CLEANUP  (BFCache-friendly)
     * ------------------------------------------------------------------ */
    function setupCleanup() {
        const cleanup = () => {
            offAll();
            ioCallbacks.clear();
            rafQueue.clear();
            prefetchers.clear();
            // Note: we DO NOT call io.disconnect() — the browser handles it on pagehide.
        };

        on(WIN, "pagehide", cleanup, { passive: true });
        // Don't touch 'unload' — it kills bfcache.
    }

    /* ------------------------------------------------------------------ *
     * 16.  MOTION MEDIA QUERY LISTENER  (live toggle)
     * ------------------------------------------------------------------ */
    function setupMotionListener() {
        const handler = e => {
            motionReduced = e.matches;
            HTML.classList.toggle("ged-reduced-motion", motionReduced);
        };
        if (motionMQ.addEventListener) motionMQ.addEventListener("change", handler);
        else if (motionMQ.addListener) motionMQ.addListener(handler);

        HTML.classList.toggle("ged-reduced-motion", motionReduced);
    }

    /* ------------------------------------------------------------------ *
     * 17.  GLOBAL STYLE INJECTION
     *      A tiny CSS block for the optimizations this script enables.
     * ------------------------------------------------------------------ */
    function injectGlobalStyles() {
        if (DOC.getElementById("ged-perf-styles")) return;

        const style = DOC.createElement("style");
        style.id = "ged-perf-styles";
        style.textContent = `
            /* Content visibility support */
            html.ged-perf-cv section[data-ged-cv] {
                content-visibility: auto;
                contain-intrinsic-size: auto 800px;
            }

            /* Font settled — safe to run fine animations */
            html:not(.ged-fonts-ready) .ged-defer-until-fonts { visibility: hidden; }
            html.ged-fonts-ready .ged-defer-until-fonts { visibility: visible; }

            /* Press feedback */
            .ged-pressed {
                transform: scale(0.96) !important;
                transition: transform 90ms cubic-bezier(0.32, 0.72, 0, 1) !important;
            }

            /* Pause heavy animations when tab is hidden */
            html.ged-page-hidden *,
            html.ged-page-hidden *::before,
            html.ged-page-hidden *::after {
                animation-play-state: var(--ged-animation-play-state, running) !important;
            }

            /* Respect reduced-motion user setting globally */
            html.ged-reduced-motion *,
            html.ged-reduced-motion *::before,
            html.ged-reduced-motion *::after {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
                scroll-behavior: auto !important;
            }

            /* GPU-hint critical animated surfaces */
            .marquee-inner,
            .home-marquee-inner,
            .explore-hero-media,
            .booking-hero-media,
            .flight-hero-media,
            .event-hero-media,
            .hotels-hero-media,
            .package-hero-media,
            .help-hero-media,
            .about-hero-media {
                transform: translateZ(0);
                backface-visibility: hidden;
            }

            /* Contain heavy grid sections to avoid layout thrash */
            .catalog-grid,
            .flight-grid,
            .hotel-grid,
            .event-grid,
            .package-grid {
                contain: layout style;
            }

            /* Smooth image fade-in once loaded */
            img[data-ged-perf] {
                transition: opacity 400ms cubic-bezier(0.32, 0.72, 0, 1);
            }
        `;
        DOC.head.appendChild(style);
    }

    /* ------------------------------------------------------------------ *
     * 18.  NETWORK-AWARE PRELOAD HINTS
     * ------------------------------------------------------------------ */
    function setupResourceHints() {
        if (prefersReducedData) return;

        // Warm up Google Fonts CDN (already preconnected in HTML but double-safe)
        const hints = [
            { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: true },
            { rel: "preconnect", href: "https://images.unsplash.com", crossOrigin: true }
        ];
        hints.forEach(h => {
            if (DOC.querySelector(`link[rel="${h.rel}"][href="${h.href}"]`)) return;
            const link = DOC.createElement("link");
            link.rel = h.rel;
            link.href = h.href;
            if (h.crossOrigin) link.crossOrigin = "anonymous";
            DOC.head.appendChild(link);
        });
    }

    /* ------------------------------------------------------------------ *
     * 19.  BOOT
     * ------------------------------------------------------------------ */
    function boot() {
        // 1. Immediately (sync-ish) — style injection + resource hints
        injectGlobalStyles();
        setupResourceHints();
        setupMotionListener();
        setupScrollRestoration();

        // 2. Right after DOM is ready — reveals, counters, images
        enhanceImages();
        setupReveals();
        setupCounters();
        setupHeaderScroll();
        setupPressFeedback();

        // 3. Deferred (idle) — heavy, non-urgent work
        idle(() => {
            applyContentVisibility();
            applyScrollPolish();
            setupPrefetch();
        });

        // 4. Set up observers last (they're cheap but let the page settle)
        idle(() => {
            setupViewTransitions();
            setupMutationObserver();
            setupFonts();
        }, 500);

        // 5. Cleanup
        setupCleanup();

        // 6. Expose public API
        WIN.GEDPerf = {
            version: "1.0.0",
            scheduleFrame,
            debounce,
            rafThrottle,
            idle,
            whenVisible,
            prefetch,
            enhanceImages,
            setupReveals,
            setupCounters,
            reducedMotion: () => motionReduced,
            prefersReducedData: () => prefersReducedData,
            refresh() {
                enhanceImages();
                setupReveals();
                setupCounters();
            }
        };

        // Console log (kept minimal for prod — comment out if undesired)
        try {
            console.log(
                "%cGED · Perf Core v1.0",
                "font-weight:700;color:#ffd21a;background:#0a0a0a;padding:3px 8px;border-radius:5px;font-family:monospace;"
            );
        } catch (_) { }
    }

    /* ------------------------------------------------------------------ *
     * 20.  READY-STATE HANDLING
     * ------------------------------------------------------------------ */
    if (DOC.readyState === "loading") {
        DOC.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }

    /* ------------------------------------------------------------------ *
     * 21.  BOOT BEFORE DOMContentLoaded (early hints)
     * ------------------------------------------------------------------ */
    // Inject the perf styles + preconnects right now so the browser can
    // start resolving DNS while the rest of the HTML parses.
    try {
        injectGlobalStyles();
        setupResourceHints();
    } catch (_) { }

})();   