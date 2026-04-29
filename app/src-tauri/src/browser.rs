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

pub fn close_all(state: &BrowserState) {
    let removed: Vec<_> = {
        let mut map = state.webviews.lock().unwrap();
        map.drain().map(|(_, v)| v).collect()
    };
    for webview in removed {
        let _ = webview.close();
    }
}
