// Injected into every Agnt browser-tab webview before any page script runs.
// `window.__AGNT_BROWSER_TAB_ID__` is set by the host immediately above this
// script (see browser.rs). The preload reports title/favicon/url back to the
// host via Tauri IPC and reserves a small `window.__agnt_browser__` namespace
// for future agent browser-tools to extend (snapshot, click, type, etc.).
(function () {
    if (window.__agnt_browser__) return;

    var TAB_ID = window.__AGNT_BROWSER_TAB_ID__;
    if (!TAB_ID) return;

    function invoke(cmd, args) {
        try {
            var ipc = window.__TAURI_INTERNALS__;
            if (!ipc || typeof ipc.invoke !== "function") return;
            ipc.invoke(cmd, args);
        } catch (_) {
            // swallow — IPC may not be ready yet on cold-load
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

    // SPA navigation hooks — pushState / replaceState don't emit events
    // natively, so wrap them. Browser tools that wait for navigation
    // can subscribe to browser://navigated on the host side instead, but
    // we still want title/url reports to fire on SPA route changes.
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

    // ---------------------------------------------------------------
    // Public namespace reserved for future agent browser-tools.
    // Intentionally minimal in v1 — implementations live behind the
    // `browser_eval` host command so future tool authors can extend
    // each method without re-shipping the preload.
    // ---------------------------------------------------------------
    var notImplemented = function (name) {
        return function () {
            throw new Error(
                "[agnt-browser] " + name + " is not implemented yet"
            );
        };
    };

    window.__agnt_browser__ = {
        tabId: TAB_ID,
        report: report,
        snapshot: notImplemented("snapshot"),
        findByRef: notImplemented("findByRef"),
        click: notImplemented("click"),
        type: notImplemented("type"),
        screenshot: notImplemented("screenshot")
    };
})();
