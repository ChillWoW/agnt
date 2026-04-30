use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, Webview, WebviewUrl,
    Wry,
};

const BROWSER_LABEL_PREFIX: &str = "agnt-browser-";
const PRELOAD: &str = include_str!("../assets/browser-preload.js");

const HIDE_X: f64 = -100_000.0;
const HIDE_Y: f64 = -100_000.0;

pub struct BrowserState {
    pub webviews: Arc<Mutex<HashMap<String, Webview<Wry>>>>,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            webviews: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn label_for(id: &str) -> String {
    format!("{}{}", BROWSER_LABEL_PREFIX, id)
}

fn profile_dir(app: &AppHandle) -> PathBuf {
    let home = app
        .path()
        .home_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    home.join(".agnt").join("browser-profile")
}

fn build_preload(id: &str) -> String {
    // Embed the tab id ahead of the preload body so the script can
    // attribute its IPC calls back to the right tab.
    let id_json = serde_json::to_string(id).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        "window.__AGNT_BROWSER_TAB_ID__ = {};\n{}",
        id_json, PRELOAD
    )
}

fn get_webview(state: &State<'_, BrowserState>, id: &str) -> Option<Webview<Wry>> {
    state.webviews.lock().unwrap().get(id).cloned()
}

#[derive(Debug, Clone, Serialize)]
struct NavigatedPayload {
    id: String,
    url: String,
}

#[derive(Debug, Clone, Serialize)]
struct LoadStatePayload {
    id: String,
    #[serde(rename = "isLoading")]
    is_loading: bool,
}

#[derive(Debug, Clone, Serialize)]
struct TitlePayload {
    id: String,
    title: String,
}

#[derive(Debug, Clone, Serialize)]
struct FaviconPayload {
    id: String,
    favicon: String,
}

#[derive(Debug, Clone, Serialize)]
struct UrlReportPayload {
    id: String,
    url: String,
}

// Browser-op IPC. The preload's `__agnt_browser__.__run({opId, op, args})`
// dispatcher calls back into this command with the result; the host then
// re-emits it as the `browser://op-result` event the React-side bridge
// listens to and forwards to the server. Keeping the round-trip in one
// event channel (rather than per-op-id channels) means we don't have to
// register / unregister listeners for every tool call.
#[derive(Debug, Clone, Serialize)]
struct OpResultPayload {
    #[serde(rename = "tabId")]
    tab_id: String,
    #[serde(rename = "opId")]
    op_id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    state: State<'_, BrowserState>,
    id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    {
        let map = state.webviews.lock().unwrap();
        if map.contains_key(&id) {
            return Ok(());
        }
    }

    let parsed_url = Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    let label = label_for(&id);

    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let app_for_nav = app.clone();
    let id_for_nav = id.clone();
    let app_for_load = app.clone();
    let id_for_load = id.clone();
    let app_for_title = app.clone();
    let id_for_title = id.clone();

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed_url))
        .initialization_script(build_preload(&id))
        .data_directory(profile_dir(&app))
        .on_navigation(move |url| {
            let _ = app_for_nav.emit(
                "browser://navigated",
                NavigatedPayload {
                    id: id_for_nav.clone(),
                    url: url.as_str().to_string(),
                },
            );
            true
        })
        .on_page_load(move |_, payload| {
            let is_loading = matches!(payload.event(), PageLoadEvent::Started);
            let _ = app_for_load.emit(
                "browser://load-state",
                LoadStatePayload {
                    id: id_for_load.clone(),
                    is_loading,
                },
            );
        })
        .on_document_title_changed(move |_, title| {
            let _ = app_for_title.emit(
                "browser://title",
                TitlePayload {
                    id: id_for_title.clone(),
                    title,
                },
            );
        });

    let width = width.max(1.0);
    let height = height.max(1.0);

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| format!("add_child failed: {e}"))?;

    state.webviews.lock().unwrap().insert(id, webview);
    Ok(())
}

#[tauri::command]
pub async fn browser_navigate(
    state: State<'_, BrowserState>,
    id: String,
    url: String,
) -> Result<(), String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    let parsed = Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    webview
        .navigate(parsed)
        .map_err(|e| format!("navigate failed: {e}"))
}

#[tauri::command]
pub async fn browser_back(
    state: State<'_, BrowserState>,
    id: String,
) -> Result<(), String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    webview
        .eval("history.back()")
        .map_err(|e| format!("back failed: {e}"))
}

#[tauri::command]
pub async fn browser_forward(
    state: State<'_, BrowserState>,
    id: String,
) -> Result<(), String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    webview
        .eval("history.forward()")
        .map_err(|e| format!("forward failed: {e}"))
}

#[tauri::command]
pub async fn browser_reload(
    state: State<'_, BrowserState>,
    id: String,
) -> Result<(), String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    webview
        .eval("location.reload()")
        .map_err(|e| format!("reload failed: {e}"))
}

#[tauri::command]
pub async fn browser_stop(
    state: State<'_, BrowserState>,
    id: String,
) -> Result<(), String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    webview
        .eval("window.stop()")
        .map_err(|e| format!("stop failed: {e}"))
}

// "Hard reload" performs a fresh top-level navigation to the current URL
// rather than `location.reload()`. WebView2 / WKWebView don't expose a
// CDP-style "reload, ignore-cache" toggle to Tauri, so the closest we can
// get without nuking site data is to ask the engine for a fresh navigate
// — which goes through the network stack and re-validates resources.
#[tauri::command]
pub async fn browser_hard_reload(
    state: State<'_, BrowserState>,
    id: String,
) -> Result<(), String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    let current = webview.url().map_err(|e| format!("url failed: {e}"))?;
    webview
        .navigate(current)
        .map_err(|e| format!("navigate failed: {e}"))
}

// Cookies-only clear. We iterate the global cookie store and delete the
// cookies one by one because Tauri's coarse `clear_all_browsing_data`
// would also wipe cache / localStorage / IndexedDB.
#[tauri::command]
pub async fn browser_clear_cookies(
    state: State<'_, BrowserState>,
    id: String,
) -> Result<u32, String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    let cookies = webview
        .cookies()
        .map_err(|e| format!("cookies failed: {e}"))?;
    let mut cleared = 0u32;
    for cookie in cookies {
        if webview.delete_cookie(cookie).is_ok() {
            cleared += 1;
        }
    }
    Ok(cleared)
}

// Cache-only clear (best effort). Tauri/Wry only expose a single
// `clear_all_browsing_data` entry point that wipes cookies + cache +
// localStorage + IndexedDB together. To approximate "cache only", we
// snapshot cookies first, run the coarse clear, and re-set the cookies.
// LocalStorage / IndexedDB are still wiped — document this in the toast
// so users aren't surprised.
#[tauri::command]
pub async fn browser_clear_cache(
    state: State<'_, BrowserState>,
    id: String,
) -> Result<(), String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    let cookies = webview.cookies().unwrap_or_default();
    webview
        .clear_all_browsing_data()
        .map_err(|e| format!("clear_all_browsing_data failed: {e}"))?;
    for cookie in cookies {
        let _ = webview.set_cookie(cookie);
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_get_url(
    state: State<'_, BrowserState>,
    id: String,
) -> Result<String, String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    let url = webview.url().map_err(|e| format!("url failed: {e}"))?;
    Ok(url.to_string())
}

#[tauri::command]
pub async fn browser_set_bounds(
    state: State<'_, BrowserState>,
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    let width = width.max(1.0);
    let height = height.max(1.0);
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("set_position failed: {e}"))?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("set_size failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn browser_set_visible(
    state: State<'_, BrowserState>,
    id: String,
    visible: bool,
) -> Result<(), String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    if visible {
        webview
            .show()
            .map_err(|e| format!("show failed: {e}"))?;
    } else {
        // Belt-and-suspenders: hide the webview AND park it offscreen.
        // hide() alone has been observed to leave a 1px residue on some
        // WebView2 versions when the parent window is repainted.
        let _ = webview.set_position(LogicalPosition::new(HIDE_X, HIDE_Y));
        webview
            .hide()
            .map_err(|e| format!("hide failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_close(
    state: State<'_, BrowserState>,
    id: String,
) -> Result<(), String> {
    let webview = state.webviews.lock().unwrap().remove(&id);
    if let Some(webview) = webview {
        webview
            .close()
            .map_err(|e| format!("close failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_list_alive(state: State<'_, BrowserState>) -> Vec<String> {
    state.webviews.lock().unwrap().keys().cloned().collect()
}

#[tauri::command]
pub async fn browser_eval(
    state: State<'_, BrowserState>,
    id: String,
    js: String,
) -> Result<(), String> {
    let webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    webview
        .eval(js)
        .map_err(|e| format!("eval failed: {e}"))
}

#[tauri::command]
pub fn browser_meta_report(
    app: AppHandle,
    id: String,
    title: Option<String>,
    favicon: Option<String>,
    url: Option<String>,
) -> Result<(), String> {
    if let Some(title) = title {
        let _ = app.emit(
            "browser://title",
            TitlePayload {
                id: id.clone(),
                title,
            },
        );
    }
    if let Some(favicon) = favicon {
        let _ = app.emit(
            "browser://favicon",
            FaviconPayload {
                id: id.clone(),
                favicon,
            },
        );
    }
    if let Some(url) = url {
        let _ = app.emit(
            "browser://url-report",
            UrlReportPayload { id, url },
        );
    }
    Ok(())
}

/// Receive a result from the preload's `__agnt_browser__.__run`
/// dispatcher and re-emit it as a `browser://op-result` event for the
/// React bridge to forward back to the server.
#[tauri::command]
pub fn browser_op_result(
    app: AppHandle,
    id: String,
    #[allow(non_snake_case)] opId: String,
    ok: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
) -> Result<(), String> {
    let _ = app.emit(
        "browser://op-result",
        OpResultPayload {
            tab_id: id,
            op_id: opId,
            ok,
            result,
            error,
        },
    );
    Ok(())
}

/// Capture the current viewport of a tab as a PNG.
///
/// Tauri 2.10 doesn't expose a per-webview screenshot primitive yet
/// (proposed for wry but not landed) — neither WebView2 nor WKWebView
/// surface a synchronous capture through Tauri. To avoid pulling in a
/// platform-specific screen-grab dep just for this, we return a
/// structured error here so the `browser_screenshot` tool can fail
/// gracefully and tell the model to use `browser_read` /
/// `browser_snapshot` instead. When wry's `WebView::screenshot` lands,
/// swap this body for the real call.
#[tauri::command]
pub async fn browser_screenshot(
    state: State<'_, BrowserState>,
    id: String,
) -> Result<serde_json::Value, String> {
    // Make sure the tab actually exists so the failure message is the
    // right one (rather than "no impl").
    let _webview =
        get_webview(&state, &id).ok_or_else(|| "browser tab not found".to_string())?;
    Err(
        "browser_screenshot is not yet supported on this build of Tauri \
         (no per-webview capture primitive). Use browser_read or browser_snapshot \
         to inspect the page instead."
            .to_string(),
    )
}

pub fn close_all(state: &BrowserState) {
    let removed: Vec<_> = {
        let mut map = state.webviews.lock().unwrap();
        map.drain().map(|(_, v)| v).collect()
    };
    for webview in removed {
        let _ = webview.close();
    }
}
