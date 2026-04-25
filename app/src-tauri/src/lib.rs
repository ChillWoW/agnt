mod terminals;

use std::sync::{Arc, Mutex};
use std::time::Duration;
#[cfg(windows)]
use tauri::image::Image;
#[cfg(windows)]
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use terminals::TerminalsState;

// Store the child process to kill it when app closes
struct SidecarState {
    child: Arc<Mutex<Option<CommandChild>>>,
    initializing: Arc<Mutex<bool>>,
    server_info: Arc<Mutex<Option<ServerInfo>>>,
}

#[derive(serde::Serialize, Clone)]
struct ServerInfo {
    url: String,
    password: String,
}

// Helper: Find a free port
fn get_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn kill_existing_server(state: &SidecarState) {
    let mut child_guard = state.child.lock().unwrap();
    if let Some(child) = child_guard.take() {
        let _ = child.kill();
        std::thread::sleep(Duration::from_millis(100));
    }
    let mut info_guard = state.server_info.lock().unwrap();
    *info_guard = None;
}

#[tauri::command]
async fn start_server(app: AppHandle, state: State<'_, SidecarState>) -> Result<ServerInfo, String> {
    // Reuse existing server if it's still healthy
    let existing = state.server_info.lock().unwrap().clone();
    if let Some(info) = existing {
        let client = reqwest::Client::new();
        let health = client.get(format!("{}/health", info.url))
            .basic_auth("app", Some(&info.password))
            .timeout(Duration::from_secs(2))
            .send()
            .await;
        if matches!(health, Ok(resp) if resp.status().is_success()) {
            return Ok(info);
        }
    }

    // Prevent concurrent initialization
    {
        let mut init_guard = state.initializing.lock().unwrap();
        if *init_guard {
            return Err("Server initialization already in progress".to_string());
        }
        *init_guard = true;
    }

    // Ensure we clean up if something goes wrong
    let cleanup = || {
        let mut init_guard = state.initializing.lock().unwrap();
        *init_guard = false;
    };

    // If an older sidecar is running, shut it down first
    kill_existing_server(&state);

    let port = get_free_port();
    let password = uuid::Uuid::new_v4().to_string(); // Generate secure random password
    let hostname = "127.0.0.1";
    
    // Prepare the command: sidecar serve --port <port>
    let sidecar_command = app.shell()
        .sidecar("sidecar")
        .map_err(|e| e.to_string())?
        .args(["serve", "--port", &port.to_string()])
        .env("SERVER_PASSWORD", &password); // Pass password safely via Env

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| e.to_string())?;

    // Save child handle to state so it can be killed on exit
    {
        let mut child_guard = state.child.lock().unwrap();
        *child_guard = Some(child);
    }

    // Spawn a thread to log stdout/stderr (optional but good for debug)
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line) = event {
                println!("[SIDECAR] {}", String::from_utf8_lossy(&line));
            }
        }
    });

    let url = format!("http://{}:{}", hostname, port);

    // Wait for liveness check (Retry loop)
    let client = reqwest::Client::new();
    let start = std::time::Instant::now();
    
    let info = loop {
        if start.elapsed() > Duration::from_secs(15) {
            cleanup();
            kill_existing_server(&state);
            return Err("Server timed out".to_string());
        }

        let health = client.get(format!("{}/health", url))
            .basic_auth("app", Some(&password))
            .send()
            .await;

        if let Ok(resp) = health {
            if resp.status().is_success() {
                break ServerInfo { url, password };
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    };

    {
        let mut info_guard = state.server_info.lock().unwrap();
        *info_guard = Some(info.clone());
    }

    cleanup();
    Ok(info)
}

#[tauri::command]
async fn stop_server(state: State<'_, SidecarState>) -> Result<(), String> {
    kill_existing_server(&state);
    let mut init_guard = state.initializing.lock().unwrap();
    *init_guard = false;
    Ok(())
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
            initializing: Arc::new(Mutex::new(false)),
            server_info: Arc::new(Mutex::new(None)),
        })
        .manage(TerminalsState::default())
        .invoke_handler(tauri::generate_handler![
            start_server,
            stop_server,
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
