use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

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
        .invoke_handler(tauri::generate_handler![start_server, stop_server])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let state = window.app_handle().state::<SidecarState>();
                kill_existing_server(&state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
