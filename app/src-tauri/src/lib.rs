mod terminals;

use std::sync::{Arc, Mutex};
#[cfg(windows)]
use tauri::image::Image;
#[cfg(windows)]
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use terminals::TerminalsState;

// In release builds the Rust host owns the sidecar process: it is spawned
// during `setup` and killed when the window is closed. In debug builds
// (`tauri dev`, used by both `bun run prod` and `bun run local:dev`) we
// deliberately do NOT spawn the sidecar — the developer runs
// `bun run start:server` in a separate terminal so server changes hot-reload.
struct SidecarState {
    child: Arc<Mutex<Option<CommandChild>>>,
}

// The frontend's connection monitor and `api` client both target this URL
// verbatim (see `app/src/features/server/state.ts` and `app/src/lib/api.ts`),
// and `bun run start:server` listens here too — keep them aligned.
#[cfg(not(debug_assertions))]
const SIDECAR_PORT: &str = "4727";
#[cfg(not(debug_assertions))]
const SIDECAR_HOST: &str = "127.0.0.1";

fn kill_existing_server(state: &SidecarState) {
    let mut child_guard = state.child.lock().unwrap();
    if let Some(child) = child_guard.take() {
        let _ = child.kill();
    }
}

#[cfg(not(debug_assertions))]
fn spawn_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();

    let sidecar = match app.shell().sidecar("sidecar") {
        Ok(cmd) => cmd,
        Err(e) => {
            eprintln!("[sidecar] failed to resolve sidecar binary: {e}");
            return;
        }
    };

    let spawn_result = sidecar
        .args([
            "serve",
            "--port",
            SIDECAR_PORT,
            "--hostname",
            SIDECAR_HOST,
        ])
        .spawn();

    let (mut rx, child) = match spawn_result {
        Ok(pair) => pair,
        Err(e) => {
            // Most common cause: port already in use (e.g. a stray
            // `bun run start:server` left running). The frontend will
            // happily talk to whatever else is listening on 4727, so we
            // just log and move on instead of crashing the app.
            eprintln!("[sidecar] failed to spawn sidecar: {e}");
            return;
        }
    };

    *state.child.lock().unwrap() = Some(child);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[SIDECAR] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[SIDECAR ERR] {}", String::from_utf8_lossy(&line));
                }
                _ => {}
            }
        }
    });
}

// Update the Windows taskbar overlay icon to reflect the unread count.
// On non-Windows platforms this is a no-op because `set_overlay_icon`
// is only exposed by Tauri on Windows.
#[tauri::command]
async fn set_unread_badge(app: AppHandle, count: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(());
        };
        if count == 0 {
            window.set_overlay_icon(None).map_err(|e| e.to_string())?;
            return Ok(());
        }
        let file = if count >= 10 {
            "9plus.png".to_string()
        } else {
            format!("{}.png", count)
        };
        let resource_path = app
            .path()
            .resolve(format!("icons/badges/{}", file), BaseDirectory::Resource)
            .map_err(|e| e.to_string())?;
        let image = Image::from_path(&resource_path).map_err(|e| e.to_string())?;
        window
            .set_overlay_icon(Some(image))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (app, count);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarState {
            child: Arc::new(Mutex::new(None)),
        })
        .manage(TerminalsState::default())
        .setup(|_app| {
            #[cfg(not(debug_assertions))]
            spawn_sidecar(&_app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_unread_badge,
            terminals::terminal_open,
            terminals::terminal_write,
            terminals::terminal_resize,
            terminals::terminal_close,
            terminals::terminal_list_alive
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let app = window.app_handle();
                let server_state = app.state::<SidecarState>();
                kill_existing_server(&server_state);
                let term_state = app.state::<TerminalsState>();
                terminals::kill_all(&term_state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
