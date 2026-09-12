window.GED = window.GED || {}; GED.toast = function (msg) { const t = document.querySelector('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(GED._toast); GED._toast = setTimeout(() => t.classList.remove('show'), 2600) }; document.addEventListener('DOMContentLoaded', () => { setTimeout(() => document.querySelector('#loader')?.classList.add('hidden'), 750); document.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => GED.toast(`${b.dataset.demo} is running on the GED demo engine.`))); document.querySelectorAll('[data-demo-action]').forEach(b => b.addEventListener('click', () => GED.toast(b.dataset.demoAction))); });

window.GED = window.GED || {};

/* ============================================================
   TOAST (mantido)
   ============================================================ */
GED.toast = function (msg) {
    const t = document.querySelector('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(GED._toast);
    GED._toast = setTimeout(() => t.classList.remove('show'), 2600);
};

/* ============================================================
   BOOT (mantido)
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {

    setTimeout(() => {
        document.querySelector('#loader')?.classList.add('hidden');
    }, 750);

    document.querySelectorAll('[data-demo]').forEach(b => {
        b.addEventListener('click', () => {
            GED.toast(`${b.dataset.demo} is running on the GED demo engine.`);
        });
    });

    document.querySelectorAll('[data-demo-action]').forEach(b => {
        b.addEventListener('click', () => {
            GED.toast(b.dataset.demoAction);
        });
    });
});

/* ============================================================
   IOS SEGMENTED CONTROL — auto-init
   ============================================================
   Uso:
     <div class="segmented" data-segmented role="tablist">
         <button data-value="cad" class="active" role="tab">CAD</button>
         <button data-value="usd" role="tab">USD</button>
     </div>

   API pública:
     GED.segmented.setValue(rootOrSelector, value)
     GED.segmented.refresh(rootOrSelector)

   Evento emitido:
     "segmented-change" → { detail: { value, index, element } }
   ============================================================ */
(function () {
    "use strict";

    const THUMB_CLASS = "segmented-thumb";

    /* --------------------------------------------------
       HELPERS
       -------------------------------------------------- */
    function getItems(root) {
        return Array.from(
            root.querySelectorAll(":scope > button, :scope > .segmented-item")
        );
    }

    function ensureThumb(root) {
        let thumb = root.querySelector(":scope > ." + THUMB_CLASS);
        if (!thumb) {
            thumb = document.createElement("span");
            thumb.className = THUMB_CLASS;
            thumb.setAttribute("aria-hidden", "true");
            root.insertBefore(thumb, root.firstChild);
        }
        return thumb;
    }

    function getActive(root) {
        return root.querySelector(
            ":scope > button.active, :scope > .segmented-item.active"
        ) || getItems(root)[0] || null;
    }

    /* --------------------------------------------------
       MOVE THUMB (animação deslizante)
       -------------------------------------------------- */
    function moveThumb(root, animate) {
        const thumb = ensureThumb(root);
        const active = getActive(root);
        if (!active) return;

        const rootRect = root.getBoundingClientRect();
        const itemRect = active.getBoundingClientRect();
        if (!rootRect.width || !itemRect.width) return;

        const offsetX = itemRect.left - rootRect.left;
        const width = itemRect.width;

        if (animate === false) thumb.style.transition = "none";
        thumb.style.width = width + "px";
        thumb.style.transform = `translate3d(${offsetX}px, 0, 0)`;

        if (animate === false) {
            // force reflow + restore transition
            void thumb.offsetWidth;
            thumb.style.transition = "";
        }
    }

    /* --------------------------------------------------
       SET ACTIVE
       -------------------------------------------------- */
    function setActive(root, btn, emit) {
        if (!btn || btn.disabled) return;

        const items = getItems(root);
        items.forEach(it => {
            it.classList.remove("active");
            it.setAttribute("aria-selected", "false");
        });

        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");

        moveThumb(root, true);

        if (emit !== false) {
            root.dispatchEvent(new CustomEvent("segmented-change", {
                detail: {
                    value: btn.dataset.value || btn.textContent.trim(),
                    index: items.indexOf(btn),
                    element: btn
                },
                bubbles: true
            }));
        }
    }

    /* --------------------------------------------------
       SETUP
       -------------------------------------------------- */
    function setup(root) {
        if (!root || root.dataset.segmentedReady === "true") return;
        root.dataset.segmentedReady = "true";

        ensureThumb(root);

        // Se nenhum estiver ativo, ativa o primeiro
        if (!getActive(root)) {
            const first = getItems(root)[0];
            if (first) first.classList.add("active");
        }

        // Marca aria-selected inicial
        getItems(root).forEach(it => {
            it.setAttribute("aria-selected",
                it.classList.contains("active") ? "true" : "false");
        });

        // CLICK
        root.addEventListener("click", (e) => {
            const btn = e.target.closest("button, .segmented-item");
            if (!btn || !root.contains(btn)) return;
            if (btn.parentElement !== root) return;
            setActive(root, btn);
        });

        // KEYBOARD (arrows + home/end)
        root.addEventListener("keydown", (e) => {
            const list = getItems(root).filter(it => !it.disabled);
            const idx = list.indexOf(document.activeElement);
            if (idx === -1) return;

            let next = null;
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                next = list[(idx + 1) % list.length];
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                next = list[(idx - 1 + list.length) % list.length];
            } else if (e.key === "Home") {
                next = list[0];
            } else if (e.key === "End") {
                next = list[list.length - 1];
            }

            if (next) {
                e.preventDefault();
                next.focus();
                setActive(root, next);
            }
        });

        // POSIÇÃO INICIAL
        requestAnimationFrame(() => moveThumb(root, false));

        // RESIZE / FONT LOAD
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => moveThumb(root, false));
            ro.observe(root);
            getItems(root).forEach(it => ro.observe(it));
        } else {
            window.addEventListener("resize", () => moveThumb(root, false), { passive: true });
        }
    }

    /* --------------------------------------------------
       SCAN
       -------------------------------------------------- */
    function scan(scope) {
        (scope || document)
            .querySelectorAll("[data-segmented]")
            .forEach(setup);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => scan());
    } else {
        scan();
    }

    /* Re-scan automático para elementos inseridos depois */
    if (window.MutationObserver) {
        const mo = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches && node.matches("[data-segmented]")) setup(node);
                    if (node.querySelectorAll) scan(node);
                }
            }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
    }

    /* Recálculo após carregamento das fontes (larguras mudam) */
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            document.querySelectorAll("[data-segmented]").forEach(root => {
                moveThumb(root, false);
            });
        });
    }

    /* --------------------------------------------------
       API PÚBLICA
       -------------------------------------------------- */
    GED.segmented = {
        setValue(rootOrSelector, value) {
            const root = typeof rootOrSelector === "string"
                ? document.querySelector(rootOrSelector)
                : rootOrSelector;
            if (!root) return;
            const btn = getItems(root)
                .find(it => it.dataset.value === value);
            if (btn) setActive(root, btn);
        },

        refresh(rootOrSelector) {
            const root = typeof rootOrSelector === "string"
                ? document.querySelector(rootOrSelector)
                : rootOrSelector;
            if (root) moveThumb(root, false);
        },

        setup
    };

    /* Recálculo em orientationchange também */
    window.addEventListener("orientationchange", () => {
        setTimeout(() => {
            document.querySelectorAll("[data-segmented]").forEach(root => {
                moveThumb(root, false);
            });
        }, 300);
    });

})();