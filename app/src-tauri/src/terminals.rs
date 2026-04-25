use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct TerminalSession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

pub struct TerminalsState {
    pub sessions: Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
}

impl Default for TerminalsState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct OutputPayload {
    id: String,
    data: String,
}

#[derive(Debug, Clone, Serialize)]
struct ExitPayload {
    id: String,
    code: Option<i32>,
}

fn pick_shell_path(custom: Option<&str>) -> String {
    if let Some(c) = custom.filter(|s| !s.is_empty()) {
        return c.to_string();
    }
    if cfg!(windows) {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

#[tauri::command]
pub fn terminal_open(
    app: AppHandle,
    state: State<'_, TerminalsState>,
    id: String,
    workspace_id: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<(), String> {
    let _ = workspace_id;
    let cols = cols.max(2);
    let rows = rows.max(2);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {}", e))?;

    let shell_path = pick_shell_path(shell.as_deref());
    let mut cmd = CommandBuilder::new(&shell_path);
    if let Some(cwd) = cwd.as_deref().filter(|p| !p.is_empty()) {
        cmd.cwd(cwd);
    }
    cmd.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell ({}) failed: {}", shell_path, e))?;
    drop(pair.slave);

    let killer = child.clone_killer();
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader failed: {}", e))?;

    let session = Arc::new(TerminalSession {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
    });

    {
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(prev) = sessions.remove(&id) {
            if let Ok(mut k) = prev.killer.lock() {
                let _ = k.kill();
            }
        }
        sessions.insert(id.clone(), session);
    }

    {
        let app = app.clone();
        let id = id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                        let _ = app.emit(
                            "terminal://output",
                            OutputPayload {
                                id: id.clone(),
                                data: chunk,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    {
        let app = app.clone();
        let id = id.clone();
        let sessions_arc = state.sessions.clone();
        std::thread::spawn(move || {
            let exit = child.wait();
            let code = exit.ok().map(|s| s.exit_code() as i32);
            if let Ok(mut sessions) = sessions_arc.lock() {
                sessions.remove(&id);
            }
            let _ = app.emit("terminal://exit", ExitPayload { id, code });
        });
    }

    Ok(())
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalsState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&id).cloned()
    };
    let session = session.ok_or_else(|| "terminal not found".to_string())?;
    let mut writer = session.writer.lock().unwrap();
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write failed: {}", e))?;
    writer.flush().map_err(|e| format!("flush failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalsState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&id).cloned()
    };
    let session = session.ok_or_else(|| "terminal not found".to_string())?;
    let master = session.master.lock().unwrap();
    master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn terminal_close(
    state: State<'_, TerminalsState>,
    id: String,
) -> Result<(), String> {
    let removed = {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.remove(&id)
    };
    if let Some(session) = removed {
        if let Ok(mut k) = session.killer.lock() {
            let _ = k.kill();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_list_alive(state: State<'_, TerminalsState>) -> Vec<String> {
    state.sessions.lock().unwrap().keys().cloned().collect()
}

pub fn kill_all(state: &TerminalsState) {
    let removed: Vec<_> = {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.drain().map(|(_, v)| v).collect()
    };
    for session in removed {
        if let Ok(mut k) = session.killer.lock() {
            let _ = k.kill();
        }
    }
}
