/*
 * GED Travel Agency
 * GED Concierge — Frontend Controller
 *
 * Flow:
 *   help.html → help.js → POST /api/concierge → Flask → concierge.py → NVIDIA
 *
 * Language: English primary, French secondary (AI handles the rest).
 *
 * Backend discovery:
 *   - If the page is served BY Flask (port 5000), we use a relative path.
 *   - If the page is served by Live Server / file://, we auto-target
 *     http://127.0.0.1:5000/api/concierge.
 *   - If a custom host is set via window.GED_BACKEND_URL, we honor it.
 */

(() => {
    "use strict";

    // --------------------------------------------------------------
    // BACKEND DISCOVERY
    // --------------------------------------------------------------

    /**
     * Decide qual endpoint usar para falar com o Flask.
     *
     * Prioridade:
     *   1. window.GED_BACKEND_URL (override manual)
     *   2. Se servido pela porta 5000 → path relativo
     *   3. Caso contrário → URL completa para 127.0.0.1:5000
     */
    function resolveApiEndpoint() {
        // 1. Override manual
        if (typeof window !== "undefined" && window.GED_BACKEND_URL) {
            return String(window.GED_BACKEND_URL).replace(/\/+$/, "") + "/api/concierge";
        }

        // 2. Detecta o protocolo e porta atuais
        const loc = window.location;
        const isFile = loc.protocol === "file:";
        const isFlaskPort = loc.port === "5000";
        const isLocalhost = loc.hostname === "127.0.0.1" || loc.hostname === "localhost";

        // Se a página veio do próprio Flask → usa relativo
        if (!isFile && isFlaskPort && isLocalhost) {
            return "/api/concierge";
        }

        // Caso contrário (Live Server, file://, ngrok, etc.) → Flask fixo
        return "http://127.0.0.1:5000/api/concierge";
    }

    const API_ENDPOINT = resolveApiEndpoint();
    const HEALTH_ENDPOINT = API_ENDPOINT.replace(/\/concierge$/, "/health");

    // --------------------------------------------------------------
    // CONFIG
    // --------------------------------------------------------------

    const CONFIG = {
        apiEndpoint: API_ENDPOINT,
        healthEndpoint: HEALTH_ENDPOINT,
        maxMessageLength: 2000,
        maxHistoryMessages: 12,
        storageKey: "ged-concierge-history",
        requestTimeout: 60000,
        minResponseDelay: 1200,
        debug: true,
    };

    const state = {
        conversation: [],
        controller: null,
        isGenerating: false,
        backendOnline: null, // true / false / null (unknown)
    };

    const elements = {
        chat: document.getElementById("chat"),
        question: document.getElementById("question"),
        ask: document.getElementById("ask"),
        clearChat: document.getElementById("clear-chat"),
        copyLast: document.getElementById("copy-last"),
        stopGeneration: document.getElementById("stop-generation"),
        typingIndicator: document.getElementById("typing-indicator"),
        connectionStatus: document.getElementById("connection-status"),
        conciergeStatusText: document.getElementById("concierge-status-text"),
        modelLabel: document.getElementById("model-label"),
        characterCount: document.getElementById("character-count"),
    };

    const WELCOME = "Hi. I'm GED Concierge. Where in Canada would you like to go?";

    // --------------------------------------------------------------
    // LOGGING
    // --------------------------------------------------------------

    function log(...args) {
        if (CONFIG.debug) {
            console.log("%c[GED Concierge]", "color:#007aff;font-weight:bold", ...args);
        }
    }
    function warn(...args) {
        if (CONFIG.debug) {
            console.warn("%c[GED Concierge]", "color:#ff9500;font-weight:bold", ...args);
        }
    }
    function error(...args) {
        console.error("%c[GED Concierge]", "color:#ff3b30;font-weight:bold", ...args);
    }

    // --------------------------------------------------------------
    // UTILS
    // --------------------------------------------------------------

    function escapeHTML(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatMessage(value) {
        let text = escapeHTML(value);
        text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
        text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
        text = text.replace(/\n/g, "<br>");
        return text;
    }

    function scrollChatToBottom() {
        if (elements.chat) {
            elements.chat.scrollTop = elements.chat.scrollHeight;
        }
    }

    function setStatus(status, text) {
        if (elements.connectionStatus) {
            elements.connectionStatus.dataset.status = status;
        }
        if (elements.conciergeStatusText) {
            elements.conciergeStatusText.textContent = text;
        }
    }

    function setModelLabel(model) {
        if (elements.modelLabel) {
            elements.modelLabel.textContent = model || "GED Smart";
        }
    }

    // --------------------------------------------------------------
    // BACKEND HEALTH CHECK
    // --------------------------------------------------------------

    /**
     * Verifica se o Flask está online ANTES de qualquer envio.
     * Roda uma vez na inicialização.
     */
    async function probeBackend() {
        try {
            const res = await fetch(CONFIG.healthEndpoint, {
                method: "GET",
                credentials: "omit",   // health não precisa de credenciais
                mode: "cors",
                cache: "no-store",
            });

            if (!res.ok) {
                state.backendOnline = false;
                warn("Backend health check returned HTTP", res.status);
                return false;
            }

            const data = await res.json();
            state.backendOnline = true;

            log("Backend online ✓", data);

            if (data && data.concierge && data.concierge.available === false) {
                warn("Backend is up, but the Concierge engine is NOT available.");
                setStatus("warn", "Backend up · AI engine offline");
            }

            return true;
        } catch (err) {
            state.backendOnline = false;
            error("Backend health check failed:", err);
            return false;
        }
    }

    // --------------------------------------------------------------
    // MESSAGE RENDERING
    // --------------------------------------------------------------

    function createMessageElement(role, content, imageData) {
        const wrapper = document.createElement("div");
        wrapper.className = `chat-message ${role}`;

        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.textContent = role === "user" ? "YOU" : "GED";

        const body = document.createElement("div");
        body.className = "message-body";

        const contentElement = document.createElement("div");
        contentElement.className = "message-content";
        contentElement.innerHTML = formatMessage(content);
        body.appendChild(contentElement);

        if (imageData && role === "assistant" && imageData.url) {
            const imgWrapper = document.createElement("div");
            imgWrapper.className = "message-image";

            const img = document.createElement("img");
            img.src = imageData.url;
            img.alt = imageData.caption || "Generated image";
            img.loading = "lazy";
            img.onerror = () => { imgWrapper.style.display = "none"; };

            imgWrapper.appendChild(img);

            if (imageData.caption) {
                const cap = document.createElement("div");
                cap.className = "image-caption";
                cap.textContent = imageData.caption;
                imgWrapper.appendChild(cap);
            }

            body.appendChild(imgWrapper);
        }

        wrapper.appendChild(avatar);
        wrapper.appendChild(body);
        return wrapper;
    }

    function addMessage(role, content, imageData = null, save = true) {
        if (!elements.chat) return;
        const el = createMessageElement(role, content, imageData);
        elements.chat.appendChild(el);

        if (save) {
            state.conversation.push({ role, content, image: imageData });
            trimConversation();
            saveHistory();
        }
        scrollChatToBottom();
    }

    function clearRenderedChat() {
        if (elements.chat) elements.chat.innerHTML = "";
    }

    function renderConversation() {
        clearRenderedChat();
        for (const msg of state.conversation) {
            addMessage(msg.role, msg.content, msg.image || null, false);
        }
        scrollChatToBottom();
    }

    // --------------------------------------------------------------
    // HISTORY
    // --------------------------------------------------------------

    function trimConversation() {
        if (state.conversation.length > CONFIG.maxHistoryMessages) {
            state.conversation = state.conversation.slice(-CONFIG.maxHistoryMessages);
        }
    }

    function saveHistory() {
        try {
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(state.conversation));
        } catch (_) { /* ignore */ }
    }

    function loadHistory() {
        try {
            const raw = localStorage.getItem(CONFIG.storageKey);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                state.conversation = parsed
                    .filter(
                        (item) =>
                            item &&
                            typeof item.role === "string" &&
                            typeof item.content === "string"
                    )
                    .slice(-CONFIG.maxHistoryMessages);
            }
        } catch (_) { /* ignore */ }
    }

    // --------------------------------------------------------------
    // TYPING
    // --------------------------------------------------------------

    function showTyping() {
        if (elements.typingIndicator) {
            elements.typingIndicator.hidden = false;
            scrollChatToBottom();
        }
    }

    function hideTyping() {
        if (elements.typingIndicator) {
            elements.typingIndicator.hidden = true;
        }
    }

    // --------------------------------------------------------------
    // INPUT
    // --------------------------------------------------------------

    function updateCharacterCount() {
        if (!elements.question || !elements.characterCount) return;
        const len = elements.question.value.length;
        elements.characterCount.textContent = `${len}/${CONFIG.maxMessageLength}`;
    }

    function resizeTextarea() {
        if (!elements.question) return;
        elements.question.style.height = "auto";
        elements.question.style.height =
            Math.min(elements.question.scrollHeight, 220) + "px";
    }

    function getQuestion() {
        return elements.question ? elements.question.value.trim() : "";
    }

    function clearInput() {
        if (elements.question) {
            elements.question.value = "";
            updateCharacterCount();
            resizeTextarea();
        }
    }

    // --------------------------------------------------------------
    // BACKEND REQUEST
    // --------------------------------------------------------------

    async function requestGED(message) {
        if (state.controller) {
            state.controller.abort();
        }

        state.controller = new AbortController();
        const signal = state.controller.signal;

        const timeoutId = setTimeout(() => {
            state.controller && state.controller.abort("timeout");
        }, CONFIG.requestTimeout);

        const payload = {
            message,
            conversation: state.conversation.slice(-CONFIG.maxHistoryMessages),
        };

        log("POST", CONFIG.apiEndpoint, payload);

        let response;

        try {
            const [fetchResult] = await Promise.all([
                fetch(CONFIG.apiEndpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                    // credentials: "omit" evita problemas de CORS
                    // entre Live Server e Flask
                    credentials: "omit",
                    mode: "cors",
                    body: JSON.stringify(payload),
                    signal,
                }),
                new Promise((resolve) =>
                    setTimeout(resolve, CONFIG.minResponseDelay)
                ),
            ]);

            response = fetchResult;
        } catch (err) {
            clearTimeout(timeoutId);
            state.controller = null;

            if (err.name === "AbortError") {
                if (signal.reason === "timeout") {
                    throw new Error(
                        `Request timed out after ${CONFIG.requestTimeout}ms`
                    );
                }
                throw err;
            }

            error("Network error:", err);
            throw new Error(
                `Cannot reach the Flask backend at ${CONFIG.apiEndpoint}. ` +
                `Make sure it's running with \`python app.py\`.`
            );
        }

        clearTimeout(timeoutId);
        state.controller = null;

        log("Response status:", response.status, response.headers.get("content-type"));

        // ---------------------------------------------------------
        // Parse JSON (safe)
        // ---------------------------------------------------------

        let data = null;
        let parseError = null;
        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
            try {
                data = await response.json();
            } catch (err) {
                parseError = err;
            }
        } else {
            // Resposta não-JSON (provavelmente HTML de erro do servidor)
            const text = await response.text();
            warn("Non-JSON response body (first 200 chars):", text.slice(0, 200));

            if (response.status === 405) {
                throw new Error(
                    `The request hit a static file server instead of the Flask backend. ` +
                    `Open the page at http://127.0.0.1:5000/pages/help.html ` +
                    `(or make sure Flask is running on port 5000).`
                );
            }

            throw new Error(
                `Server returned non-JSON response (HTTP ${response.status}). ` +
                `Backend may not be running correctly.`
            );
        }

        if (!response.ok) {
            const serverMessage =
                (data && (data.answer || data.error)) ||
                `Server returned HTTP ${response.status}`;
            throw new Error(`HTTP ${response.status} — ${serverMessage}`);
        }

        if (!data || typeof data !== "object") {
            throw new Error("Invalid server response — not an object.");
        }

        if (typeof data.answer !== "string" || !data.answer.trim()) {
            error("Unexpected payload:", data);
            throw new Error(
                data.error || "Server returned an empty or malformed answer."
            );
        }

        return {
            answer: data.answer.trim(),
            model: data.model || "GED Concierge",
            image: data.image || null,
            success: data.success !== false,
        };
    }

    // --------------------------------------------------------------
    // SEND
    // --------------------------------------------------------------

    async function sendMessage() {
        if (state.isGenerating) return;

        const message = getQuestion();
        if (!message) return;

        if (message.length > CONFIG.maxMessageLength) {
            addMessage(
                "assistant",
                `Please keep your message under ${CONFIG.maxMessageLength} characters.`
            );
            return;
        }

        state.isGenerating = true;
        if (elements.ask) elements.ask.disabled = true;
        if (elements.stopGeneration) elements.stopGeneration.disabled = false;

        addMessage("user", message);
        clearInput();

        showTyping();
        setStatus("thinking", "GED Concierge is thinking…");

        try {
            const result = await requestGED(message);

            hideTyping();
            addMessage("assistant", result.answer, result.image);

            setModelLabel(result.model || "GED Smart");
            setStatus("online", "GED Concierge is ready");

        } catch (err) {
            hideTyping();

            if (err.name === "AbortError") {
                addMessage("assistant", "Generation stopped.");
                setStatus("ready", "Generation stopped");
            } else {
                error("Send failed:", err);

                const reason = err.message || "Unknown error";
                addMessage(
                    "assistant",
                    `I couldn't reach the GED Concierge right now.\n\n` +
                    `**Reason:** ${reason}\n\n` +
                    `Quick checklist:\n` +
                    `• Backend endpoint: \`${CONFIG.apiEndpoint}\`\n` +
                    `• Open the page at \`http://127.0.0.1:5000/pages/help.html\`\n` +
                    `• Start Flask: \`cd backend && python app.py\``
                );
                setStatus("error", "Connection error");
            }
        } finally {
            state.isGenerating = false;
            if (elements.ask) elements.ask.disabled = false;
            if (elements.stopGeneration) elements.stopGeneration.disabled = true;
        }
    }

    // --------------------------------------------------------------
    // STOP / CLEAR / COPY
    // --------------------------------------------------------------

    function stopGeneration() {
        if (state.controller) {
            try { state.controller.abort("user"); } catch (_) { }
            state.controller = null;
        }
        state.isGenerating = false;
        hideTyping();
        if (elements.ask) elements.ask.disabled = false;
        if (elements.stopGeneration) elements.stopGeneration.disabled = true;
    }

    function clearConversation() {
        state.conversation = [];
        saveHistory();
        clearRenderedChat();
        addMessage("assistant", WELCOME);
        setModelLabel("GED Smart");
        setStatus("online", "GED Concierge is ready");
    }

    async function copyLastResponse() {
        const assistants = state.conversation.filter((m) => m.role === "assistant");
        if (!assistants.length) return;

        const last = assistants[assistants.length - 1];

        try {
            await navigator.clipboard.writeText(last.content);
            if (elements.copyLast) {
                const original = elements.copyLast.textContent;
                elements.copyLast.textContent = "✓";
                setTimeout(() => { elements.copyLast.textContent = original; }, 1200);
            }
        } catch (_) { }
    }

    // --------------------------------------------------------------
    // EVENTS
    // --------------------------------------------------------------

    function bindEvents() {
        if (elements.ask) elements.ask.addEventListener("click", sendMessage);

        if (elements.question) {
            elements.question.addEventListener("input", () => {
                updateCharacterCount();
                resizeTextarea();
            });
            elements.question.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });
        }

        if (elements.stopGeneration) {
            elements.stopGeneration.addEventListener("click", stopGeneration);
            elements.stopGeneration.disabled = true;
        }

        if (elements.clearChat) {
            elements.clearChat.addEventListener("click", clearConversation);
        }

        if (elements.copyLast) {
            elements.copyLast.addEventListener("click", copyLastResponse);
        }

        document.querySelectorAll("[data-q]").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                const q = e.currentTarget.dataset.q;
                if (q && elements.question) {
                    elements.question.value = q;
                    updateCharacterCount();
                    resizeTextarea();
                    elements.question.focus();
                    setTimeout(sendMessage, 120);
                }
            });
        });
    }

    // --------------------------------------------------------------
    // INIT
    // --------------------------------------------------------------

    function initialize() {
        log("Initializing…");
        log("Resolved API endpoint:", CONFIG.apiEndpoint);
        log("Resolved health endpoint:", CONFIG.healthEndpoint);

        loadHistory();
        bindEvents();
        updateCharacterCount();
        resizeTextarea();

        if (state.conversation.length) {
            log(`Restoring ${state.conversation.length} messages.`);
            renderConversation();
        } else {
            addMessage("assistant", WELCOME);
        }

        setModelLabel("GED Smart");

        // Health probe em background (não bloqueia)
        probeBackend().then((ok) => {
            if (ok === true) {
                setStatus("online", "GED Concierge is ready");
            } else if (ok === false) {
                setStatus("error", "Backend offline — start Flask on port 5000");
                warn(
                    `Backend at ${CONFIG.healthEndpoint} is not reachable. ` +
                    `Start it with: cd backend && python app.py`
                );
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }
})();