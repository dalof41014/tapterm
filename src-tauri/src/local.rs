//! Local shell sessions over a PTY (ConPTY on Windows, openpty on Unix).
//! Emits the same `ssh://data/<id>` / `ssh://closed/<id>` events as SSH so the
//! frontend terminal can treat local and remote sessions identically.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

struct LocalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Clone)]
pub struct LocalManager {
    sessions: Arc<Mutex<HashMap<String, LocalSession>>>,
}

impl LocalManager {
    pub fn new() -> Self {
        LocalManager {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn open(&self, app: AppHandle, id: String, cols: u16, rows: u16) -> anyhow::Result<()> {
        let pty = native_pty_system();
        let pair = pty.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let (shell, args) = default_shell();
        let mut cmd = CommandBuilder::new(shell);
        for a in args {
            cmd.arg(a);
        }
        if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }
        cmd.env("TERM", "xterm-256color");

        let mut child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave); // close our handle to the slave side

        let killer = child.clone_killer();
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        self.sessions.lock().unwrap().insert(
            id.clone(),
            LocalSession {
                master: pair.master,
                writer,
                killer,
            },
        );

        // Pump PTY output to the frontend.
        let app2 = app.clone();
        let id2 = id.clone();
        let mut reader = reader;
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let _ = app2.emit(
                            &format!("ssh://data/{id2}"),
                            String::from_utf8_lossy(&buf[..n]).to_string(),
                        );
                    }
                }
            }
            let _ = app2.emit(&format!("ssh://closed/{id2}"), ());
        });

        // Reap the child in the background.
        std::thread::spawn(move || {
            let _ = child.wait();
        });

        Ok(())
    }

    pub fn send(&self, id: &str, data: &[u8]) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(id) {
            let _ = s.writer.write_all(data);
            let _ = s.writer.flush();
        }
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) {
        if let Some(s) = self.sessions.lock().unwrap().get(id) {
            let _ = s.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }

    pub fn close(&self, id: &str) {
        if let Some(mut s) = self.sessions.lock().unwrap().remove(id) {
            let _ = s.killer.kill();
        }
    }
}

fn default_shell() -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        // Prefer PowerShell; it's present on every modern Windows.
        ("powershell.exe".to_string(), vec!["-NoLogo".to_string()])
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        (shell, vec!["-l".to_string()])
    }
}
