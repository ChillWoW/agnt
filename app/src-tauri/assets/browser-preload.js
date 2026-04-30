// Injected into every Agnt browser-tab webview before any page script runs.
// `window.__AGNT_BROWSER_TAB_ID__` is set by the host immediately above this
// script (see browser.rs).
//
// The preload does two things:
//   1. Reports title/favicon/url back to the host so the React UI can
//      mirror the page chrome.
//   2. Exposes `window.__agnt_browser__` — the agent surface the server
//      tools target via `evalBrowser`. Every op dispatched through
//      `__run({opId, op, args})` calls back via the
//      `browser_op_result` Tauri command, which the host re-emits as the
//      `browser://op-result` event the bridge listens to.
(function () {
    if (window.__agnt_browser__) return;

    var TAB_ID = window.__AGNT_BROWSER_TAB_ID__;
    if (!TAB_ID) return;

    function invoke(cmd, args) {
        try {
            var ipc = window.__TAURI_INTERNALS__;
            if (!ipc || typeof ipc.invoke !== "function") return null;
            return ipc.invoke(cmd, args);
        } catch (_) {
            return null;
        }
    }

    function pickFavicon() {
        var rels = ["icon", "shortcut icon", "apple-touch-icon"];
        for (var i = 0; i < rels.length; i++) {
            var sel =
                'link[rel="' +
                rels[i] +
                '"], link[rel*="' +
                rels[i] +
                '"]';
            var el = document.querySelector(sel);
            if (el && el.href) return el.href;
        }
        try {
            return new URL("/favicon.ico", location.href).toString();
        } catch (_) {
            return "";
        }
    }

    var lastTitle = "";
    var lastFavicon = "";
    var lastUrl = "";

    function report(force) {
        var title = document.title || "";
        var favicon = pickFavicon();
        var url = location.href;
        if (force || title !== lastTitle) {
            lastTitle = title;
            invoke("browser_meta_report", {
                id: TAB_ID,
                title: title,
                favicon: null,
                url: null
            });
        }
        if (force || favicon !== lastFavicon) {
            lastFavicon = favicon;
            invoke("browser_meta_report", {
                id: TAB_ID,
                title: null,
                favicon: favicon,
                url: null
            });
        }
        if (force || url !== lastUrl) {
            lastUrl = url;
            invoke("browser_meta_report", {
                id: TAB_ID,
                title: null,
                favicon: null,
                url: url
            });
        }
    }

    function attachObservers() {
        if (!document.head) return;
        var titleEl = document.querySelector("title");
        if (titleEl) {
            new MutationObserver(function () {
                report(false);
            }).observe(titleEl, {
                childList: true,
                characterData: true,
                subtree: true
            });
        }
        new MutationObserver(function () {
            report(false);
        }).observe(document.head, { childList: true, subtree: true });
    }

    function onReady() {
        report(true);
        attachObservers();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", onReady);
    } else {
        onReady();
    }
    window.addEventListener("load", function () {
        report(true);
    });
    window.addEventListener("popstate", function () {
        report(false);
    });
    window.addEventListener("hashchange", function () {
        report(false);
    });

    try {
        var origPush = history.pushState;
        var origReplace = history.replaceState;
        history.pushState = function () {
            var r = origPush.apply(this, arguments);
            setTimeout(function () {
                report(false);
            }, 0);
            return r;
        };
        history.replaceState = function () {
            var r = origReplace.apply(this, arguments);
            setTimeout(function () {
                report(false);
            }, 0);
            return r;
        };
    } catch (_) {}

    // -----------------------------------------------------------------
    // Agent surface
    // -----------------------------------------------------------------

    /** @type {Map<number, WeakRef<Element>>} */
    var refsByNumber = new Map();
    var nextRefNumber = 1;
    var weakRefSupported = typeof WeakRef === "function";

    function assignRef(el) {
        if (!el) return null;
        var n = nextRefNumber++;
        try {
            refsByNumber.set(
                n,
                weakRefSupported ? new WeakRef(el) : { deref: function () { return el; } }
            );
        } catch (_) {
            refsByNumber.set(n, { deref: function () { return el; } });
        }
        return n;
    }

    function resolveRef(ref) {
        if (typeof ref !== "number") return null;
        var holder = refsByNumber.get(ref);
        if (!holder) return null;
        try {
            var el = holder.deref();
            if (!el || !el.isConnected) {
                refsByNumber.delete(ref);
                return null;
            }
            return el;
        } catch (_) {
            return null;
        }
    }

    function isInteractive(el) {
        if (!el || el.nodeType !== 1) return false;
        var tag = el.tagName;
        if (
            tag === "A" ||
            tag === "BUTTON" ||
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            tag === "OPTION" ||
            tag === "LABEL" ||
            tag === "SUMMARY"
        ) {
            return true;
        }
        if (
            el.hasAttribute("role") ||
            el.hasAttribute("tabindex") ||
            el.hasAttribute("contenteditable") ||
            (typeof el.getAttribute === "function" &&
                el.getAttribute("onclick"))
        ) {
            return true;
        }
        return false;
    }

    function isVisible(el) {
        if (!el || el.nodeType !== 1) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        var style = window.getComputedStyle(el);
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            parseFloat(style.opacity || "1") === 0
        ) {
            return false;
        }
        return true;
    }

    function trimText(text, max) {
        if (!text) return "";
        var s = String(text).replace(/\s+/g, " ").trim();
        if (max && s.length > max) {
            return s.slice(0, max - 1) + "…";
        }
        return s;
    }

    function describeElement(el) {
        var tag = el.tagName.toLowerCase();
        var role = el.getAttribute && el.getAttribute("role");
        if (role) return role;
        if (tag === "a") return "link";
        if (tag === "button") return "button";
        if (tag === "input") {
            var t = (el.getAttribute("type") || "text").toLowerCase();
            if (t === "checkbox" || t === "radio" || t === "submit") return t;
            return "textbox";
        }
        if (tag === "textarea") return "textbox";
        if (tag === "select") return "combobox";
        if (tag === "img") return "image";
        if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4")
            return "heading";
        return tag;
    }

    function elementName(el) {
        var aria = el.getAttribute && el.getAttribute("aria-label");
        if (aria) return aria;
        var labelledBy = el.getAttribute && el.getAttribute("aria-labelledby");
        if (labelledBy) {
            try {
                var refEl = document.getElementById(labelledBy);
                if (refEl) return trimText(refEl.textContent || "", 80);
            } catch (_) {}
        }
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
            var ph = el.getAttribute("placeholder");
            if (ph) return ph;
            var nm = el.getAttribute("name");
            if (nm) return nm;
            return el.type ? "[" + el.type + "]" : "";
        }
        if (el.tagName === "IMG") {
            return el.getAttribute("alt") || "";
        }
        return trimText(el.textContent || "", 80);
    }

    /**
     * Walk the DOM and emit a YAML-ish a11y tree, capping output by
     * `maxChars`. Interactive nodes get a `[ref=N]` id stashed in
     * `refsByNumber` so subsequent click/type calls can resolve them.
     */
    function buildSnapshot(maxChars) {
        // Reset refs per snapshot — refs are scoped to the most recent
        // snapshot (matching the agent's expectation).
        refsByNumber = new Map();
        nextRefNumber = 1;

        var lines = [];
        var totalChars = 0;
        var truncated = false;
        var skipTags = {
            SCRIPT: 1,
            STYLE: 1,
            NOSCRIPT: 1,
            TEMPLATE: 1,
            HEAD: 1,
            META: 1,
            LINK: 1
        };

        function pushLine(line) {
            if (totalChars + line.length + 1 > maxChars) {
                truncated = true;
                return false;
            }
            lines.push(line);
            totalChars += line.length + 1;
            return true;
        }

        function walk(el, depth) {
            if (truncated) return;
            if (!el) return;
            if (el.nodeType === 3) {
                var text = trimText(el.textContent, 0);
                if (text && depth > 0) {
                    pushLine(repeat("  ", depth) + "- text: " + JSON.stringify(trimText(text, 200)));
                }
                return;
            }
            if (el.nodeType !== 1) return;
            if (skipTags[el.tagName]) return;
            if (!isVisible(el) && el.tagName !== "BODY") return;

            var interactive = isInteractive(el);
            var role = describeElement(el);
            var name = trimText(elementName(el), 80);
            var refStr = "";
            if (interactive) {
                var refNum = assignRef(el);
                if (refNum !== null) refStr = " [ref=" + refNum + "]";
            }

            // Skip noisy purely-structural divs unless they have direct text.
            var isStructural =
                el.tagName === "DIV" ||
                el.tagName === "SPAN" ||
                el.tagName === "SECTION" ||
                el.tagName === "ARTICLE" ||
                el.tagName === "NAV" ||
                el.tagName === "MAIN" ||
                el.tagName === "ASIDE" ||
                el.tagName === "FOOTER" ||
                el.tagName === "HEADER" ||
                el.tagName === "UL" ||
                el.tagName === "OL" ||
                el.tagName === "LI";

            if (interactive || !isStructural) {
                var line =
                    repeat("  ", depth) +
                    "- " +
                    role +
                    (name ? ': "' + name.replace(/"/g, '\\"') + '"' : "") +
                    refStr;
                if (!pushLine(line)) return;
            }

            // Recurse children, but flatten when we skipped this node so
            // we don't waste indentation on structural wrappers.
            var nextDepth =
                interactive || !isStructural || el.tagName === "BODY"
                    ? depth + 1
                    : depth;
            for (var i = 0; i < el.childNodes.length; i++) {
                walk(el.childNodes[i], nextDepth);
                if (truncated) return;
            }
        }

        function repeat(s, n) {
            var out = "";
            for (var i = 0; i < n; i++) out += s;
            return out;
        }

        if (document.body) {
            walk(document.body, 0);
        }

        return {
            yaml: lines.join("\n"),
            charCount: totalChars,
            truncated: truncated,
            refCount: nextRefNumber - 1
        };
    }

    // ---- Reader (lightweight Readability) ---------------------------

    var BLOCK_TAGS = {
        P: 1,
        H1: 1,
        H2: 1,
        H3: 1,
        H4: 1,
        H5: 1,
        H6: 1,
        LI: 1,
        BLOCKQUOTE: 1,
        PRE: 1,
        TR: 1,
        TD: 1,
        TH: 1,
        DIV: 1,
        ARTICLE: 1,
        SECTION: 1
    };

    var DROP_TAGS = {
        SCRIPT: 1,
        STYLE: 1,
        NOSCRIPT: 1,
        TEMPLATE: 1,
        IFRAME: 1,
        SVG: 1,
        CANVAS: 1,
        NAV: 1,
        FOOTER: 1,
        ASIDE: 1,
        FORM: 1,
        BUTTON: 1
    };

    function pickReadRoot() {
        var candidates = [
            document.querySelector("main"),
            document.querySelector("article"),
            document.querySelector("[role='main']"),
            document.querySelector("#content"),
            document.querySelector(".content"),
            document.body
        ];
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i]) return candidates[i];
        }
        return document.body;
    }

    function buildReadable(maxChars) {
        var root = pickReadRoot();
        if (!root) return { markdown: "", charCount: 0, truncated: false };

        var out = [];
        var totalChars = 0;
        var truncated = false;

        function pushLine(line) {
            if (line === undefined) line = "";
            if (totalChars + line.length + 1 > maxChars) {
                truncated = true;
                return false;
            }
            out.push(line);
            totalChars += line.length + 1;
            return true;
        }

        function walkBlock(el) {
            if (truncated) return;
            if (!el || el.nodeType !== 1) return;
            if (DROP_TAGS[el.tagName]) return;
            if (!isVisible(el)) return;

            var tag = el.tagName;
            if (tag === "H1") return pushLine("# " + trimText(el.textContent || "", 0));
            if (tag === "H2") return pushLine("## " + trimText(el.textContent || "", 0));
            if (tag === "H3") return pushLine("### " + trimText(el.textContent || "", 0));
            if (tag === "H4") return pushLine("#### " + trimText(el.textContent || "", 0));
            if (tag === "H5") return pushLine("##### " + trimText(el.textContent || "", 0));
            if (tag === "H6") return pushLine("###### " + trimText(el.textContent || "", 0));
            if (tag === "P") return pushLine(trimText(el.textContent || "", 0));
            if (tag === "PRE") {
                pushLine("```");
                pushLine((el.textContent || "").replace(/\n+$/, ""));
                return pushLine("```");
            }
            if (tag === "BLOCKQUOTE") {
                var lines = (el.textContent || "").split(/\n/);
                for (var i = 0; i < lines.length; i++) {
                    if (!pushLine("> " + trimText(lines[i], 0))) return;
                }
                return;
            }
            if (tag === "LI") {
                return pushLine("- " + trimText(el.textContent || "", 0));
            }
            if (tag === "A") {
                // Standalone link in an unknown block — render as link.
                var href = el.getAttribute("href") || "";
                var text = trimText(el.textContent || "", 0);
                if (text) return pushLine("[" + text + "](" + href + ")");
                return;
            }

            if (BLOCK_TAGS[tag]) {
                for (var j = 0; j < el.children.length; j++) {
                    walkBlock(el.children[j]);
                    if (truncated) return;
                }
                if (!el.children.length) {
                    var direct = trimText(el.textContent || "", 0);
                    if (direct) pushLine(direct);
                }
                return;
            }

            for (var k = 0; k < el.children.length; k++) {
                walkBlock(el.children[k]);
                if (truncated) return;
            }
        }

        walkBlock(root);
        // Collapse runs of empty lines.
        var cleaned = out.filter(function (l, idx, arr) {
            if (l === "" && arr[idx - 1] === "") return false;
            return true;
        });
        var md = cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
        return {
            markdown: md,
            charCount: md.length,
            truncated: truncated
        };
    }

    // ---- Find ------------------------------------------------------

    function findInPage(query, maxResults) {
        // Fresh snapshot to ensure we have refs we can hand back.
        buildSnapshot(50000);
        var q = String(query || "").toLowerCase();
        if (!q) return { matches: [] };
        var matches = [];
        var seen = new Set();
        var limit = Math.max(1, Math.min(50, maxResults || 10));

        var iter = refsByNumber.entries();
        var entry = iter.next();
        while (!entry.done && matches.length < limit) {
            var refNum = entry.value[0];
            var holder = entry.value[1];
            try {
                var el = holder.deref();
                if (el && el.isConnected && isVisible(el)) {
                    var text = trimText(
                        elementName(el) || el.textContent || "",
                        120
                    );
                    if (text.toLowerCase().indexOf(q) !== -1 && !seen.has(el)) {
                        seen.add(el);
                        matches.push({
                            ref: refNum,
                            text: text,
                            tag: el.tagName.toLowerCase()
                        });
                    }
                }
            } catch (_) {}
            entry = iter.next();
        }
        return { matches: matches };
    }

    // ---- Click / type / scroll / etc. ------------------------------

    function dispatchMouseSequence(el) {
        var rect = el.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var common = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: cx,
            clientY: cy,
            button: 0
        };
        try {
            el.dispatchEvent(new MouseEvent("mousedown", common));
            el.dispatchEvent(new MouseEvent("mouseup", common));
            el.dispatchEvent(new MouseEvent("click", common));
        } catch (_) {
            try {
                el.click();
            } catch (__) {}
        }
    }

    function clickRef(ref) {
        var el = resolveRef(ref);
        if (!el) throw new Error("ref " + ref + " not found");
        var beforeUrl = location.href;
        try {
            el.scrollIntoView({ block: "center", inline: "center" });
        } catch (_) {}
        dispatchMouseSequence(el);
        return new Promise(function (resolve) {
            // Best-effort wait for navigation triggered by the click.
            var deadline = Date.now() + 2000;
            (function poll() {
                if (location.href !== beforeUrl) {
                    return resolve({ clicked: true, navigated: true });
                }
                if (Date.now() > deadline) {
                    return resolve({ clicked: true, navigated: false });
                }
                requestAnimationFrame(poll);
            })();
        });
    }

    function typeRef(ref, text, submit) {
        var el = resolveRef(ref);
        if (!el) throw new Error("ref " + ref + " not found");
        try {
            el.focus();
        } catch (_) {}
        var submitted = false;
        if (
            el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA"
        ) {
            // Use native setter so React's controlled inputs see the change.
            try {
                var proto =
                    el.tagName === "INPUT"
                        ? HTMLInputElement.prototype
                        : HTMLTextAreaElement.prototype;
                var setter = Object.getOwnPropertyDescriptor(proto, "value");
                if (setter && setter.set) {
                    setter.set.call(el, text);
                } else {
                    el.value = text;
                }
            } catch (_) {
                el.value = text;
            }
            try {
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            } catch (_) {}
            if (submit) {
                if (el.form && typeof el.form.requestSubmit === "function") {
                    try {
                        el.form.requestSubmit();
                        submitted = true;
                    } catch (_) {}
                }
                if (!submitted) {
                    try {
                        el.dispatchEvent(
                            new KeyboardEvent("keydown", {
                                key: "Enter",
                                code: "Enter",
                                bubbles: true,
                                cancelable: true
                            })
                        );
                        submitted = true;
                    } catch (_) {}
                }
            }
        } else if (el.isContentEditable) {
            el.textContent = text;
            try {
                el.dispatchEvent(new Event("input", { bubbles: true }));
            } catch (_) {}
        } else {
            // Last resort: dispatch keystrokes one by one.
            for (var i = 0; i < text.length; i++) {
                var ch = text[i];
                try {
                    el.dispatchEvent(
                        new KeyboardEvent("keydown", {
                            key: ch,
                            bubbles: true
                        })
                    );
                    el.dispatchEvent(
                        new KeyboardEvent("keypress", {
                            key: ch,
                            bubbles: true
                        })
                    );
                    el.dispatchEvent(
                        new KeyboardEvent("keyup", {
                            key: ch,
                            bubbles: true
                        })
                    );
                } catch (_) {}
            }
        }
        return { typed: true, submitted: submitted };
    }

    function pressKey(key, ref) {
        var target = ref !== undefined && ref !== null ? resolveRef(ref) : null;
        if (!target) target = document.activeElement || document.body;
        try {
            target.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: key,
                    code: key,
                    bubbles: true,
                    cancelable: true
                })
            );
            target.dispatchEvent(
                new KeyboardEvent("keyup", {
                    key: key,
                    code: key,
                    bubbles: true,
                    cancelable: true
                })
            );
        } catch (_) {}
        return { pressed: true };
    }

    function scrollPage(direction, toRef) {
        if (toRef !== null && toRef !== undefined) {
            var el = resolveRef(toRef);
            if (!el) throw new Error("ref " + toRef + " not found");
            try {
                el.scrollIntoView({
                    behavior: "auto",
                    block: "center",
                    inline: "center"
                });
            } catch (_) {}
            return { scrolled: true, scrollY: window.scrollY };
        }
        var dy = 0;
        if (direction === "up") dy = -Math.round(window.innerHeight * 0.9);
        else if (direction === "down")
            dy = Math.round(window.innerHeight * 0.9);
        else if (direction === "top") {
            window.scrollTo({ top: 0, behavior: "auto" });
            return { scrolled: true, scrollY: 0 };
        } else if (direction === "bottom") {
            window.scrollTo({
                top: document.documentElement.scrollHeight,
                behavior: "auto"
            });
            return { scrolled: true, scrollY: window.scrollY };
        }
        if (dy !== 0) {
            window.scrollBy({ top: dy, behavior: "auto" });
        }
        return { scrolled: true, scrollY: window.scrollY };
    }

    function waitFor(args) {
        var timeoutMs = Math.max(
            1,
            Math.min(30000, Number(args.timeoutMs) || 8000)
        );
        var deadline = Date.now() + timeoutMs;

        return new Promise(function (resolve, reject) {
            function check() {
                if (args.text) {
                    var lower = String(args.text).toLowerCase();
                    if ((document.body.innerText || "").toLowerCase().indexOf(lower) !== -1) {
                        return resolve({ matched: true, reason: "text" });
                    }
                }
                if (args.ref !== null && args.ref !== undefined) {
                    var el = resolveRef(args.ref);
                    if (el && isVisible(el)) {
                        return resolve({ matched: true, reason: "ref" });
                    }
                }
                if (args.navigation) {
                    if (document.readyState === "complete") {
                        return resolve({ matched: true, reason: "navigation" });
                    }
                }
                if (Date.now() > deadline) {
                    return reject(new Error("timeout"));
                }
                setTimeout(check, 100);
            }
            check();
        });
    }

    function getState() {
        return {
            url: location.href,
            title: document.title || "",
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            readyState: document.readyState,
            loading: document.readyState !== "complete"
        };
    }

    function evalExpression(expression) {
        // Use indirect eval so the expression runs in global scope.
        var fn = new Function(
            "return (function(){ \"use strict\"; return (" +
                expression +
                "); })();"
        );
        var value = fn();
        var t = typeof value;
        var out;
        try {
            out = JSON.parse(JSON.stringify(value));
        } catch (_) {
            // Cycles / functions / DOM nodes — best-effort string repr.
            try {
                out = String(value);
            } catch (__) {
                out = null;
            }
        }
        return { value: out, valueType: t };
    }

    var META_DEFAULT = function () {
        return {
            tabId: TAB_ID,
            url: location.href,
            title: document.title || ""
        };
    };

    /**
     * Dispatch table for `__run({opId, op, args})`. Each entry returns
     * either a value, a Promise, or throws. Wrappers attach the meta
     * preface and forward results via `browser_op_result`.
     */
    var ops = {
        snapshot: function (args) {
            var max = Math.max(1, Math.min(30000, Number(args.maxChars) || 6000));
            return buildSnapshot(max);
        },
        read: function (args) {
            var max = Math.max(1, Math.min(40000, Number(args.maxChars) || 8000));
            return buildReadable(max);
        },
        find: function (args) {
            return findInPage(args.query, args.maxResults);
        },
        click: function (args) {
            return clickRef(args.ref);
        },
        type: function (args) {
            return typeRef(args.ref, args.text, !!args.submit);
        },
        press_key: function (args) {
            return pressKey(args.key, args.ref);
        },
        scroll: function (args) {
            return scrollPage(args.direction, args.toRef);
        },
        wait_for: function (args) {
            return waitFor(args);
        },
        get_state: function () {
            return getState();
        },
        post_navigate: function () {
            // Helper used by the bridge after host-side back/forward/
            // reload/navigate calls. Returns the same shape the
            // browser_navigate tool expects, waiting briefly for the
            // page to leave `loading` (DOMContentLoaded) so the
            // returned title is populated.
            return new Promise(function (resolve) {
                var deadline = Date.now() + 6000;
                (function poll() {
                    if (
                        document.readyState !== "loading" ||
                        Date.now() > deadline
                    ) {
                        return resolve({
                            finalUrl: location.href,
                            title: document.title || "",
                            statusCode: null
                        });
                    }
                    setTimeout(poll, 50);
                })();
            });
        },
        eval: function (args) {
            return evalExpression(args.expression);
        }
    };

    function postResult(opId, ok, result, error) {
        invoke("browser_op_result", {
            id: TAB_ID,
            opId: opId,
            ok: ok,
            result: ok ? result : null,
            error: ok ? null : error
        });
    }

    function run(req) {
        var opId = req && req.opId;
        var op = req && req.op;
        var args = (req && req.args) || {};
        if (!opId || !op) {
            postResult("", false, null, "missing opId or op");
            return;
        }
        var fn = ops[op];
        if (typeof fn !== "function") {
            postResult(opId, false, null, "unknown op: " + op);
            return;
        }
        try {
            var maybe = fn(args);
            if (maybe && typeof maybe.then === "function") {
                maybe
                    .then(function (data) {
                        postResult(opId, true, {
                            meta: META_DEFAULT(),
                            data: data
                        });
                    })
                    .catch(function (e) {
                        postResult(
                            opId,
                            false,
                            null,
                            String((e && e.message) || e)
                        );
                    });
            } else {
                postResult(opId, true, { meta: META_DEFAULT(), data: maybe });
            }
        } catch (e) {
            postResult(opId, false, null, String((e && e.message) || e));
        }
    }

    window.__agnt_browser__ = {
        tabId: TAB_ID,
        report: report,
        __run: run,
        snapshot: function () {
            return buildSnapshot(6000);
        },
        read: function () {
            return buildReadable(8000);
        },
        find: findInPage,
        click: clickRef,
        type: typeRef,
        pressKey: pressKey,
        scroll: scrollPage,
        waitFor: waitFor,
        getState: getState
    };
})();
