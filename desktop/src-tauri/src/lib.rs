// HYDRA desktop commands: the project folder (Documents\HYDRA or HYDRA_HOME) with the same behaviour as the
// HYDRA.bat launcher — projects, autosave, backups (newest 10 per project) — and the .hydra file the app was opened with.
// Only plain file names inside those folders are accepted; nothing else on disk can be read or written.
use serde::Serialize;
use serde_json::{json, Value};
use std::{fs, path::PathBuf, time::UNIX_EPOCH};
use tauri::{ipc::Request, ipc::Response, AppHandle, Manager};

pub mod ai;

const KEEP_BACKUPS: usize = 10;
const AREAS: [&str; 4] = ["projects", "autosave", "backups", "samples"];

fn home(app: &AppHandle) -> PathBuf {
    if let Ok(h) = std::env::var("HYDRA_HOME") { if !h.trim().is_empty() { return PathBuf::from(h); } }
    app.path().document_dir().unwrap_or_else(|_| PathBuf::from(".")).join("HYDRA")
}
fn area_dir(app: &AppHandle, area: &str) -> Result<PathBuf, String> {
    if !AREAS.contains(&area) { return Err("area".into()); }
    let d = home(app).join(area);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}
fn safe_name(n: &str) -> bool {
    let lower = n.to_ascii_lowercase();
    !n.is_empty() && n.len() <= 140 && !n.contains("..") && (lower.ends_with(".hydra") || lower.ends_with(".json"))
        && n.chars().next().map_or(false, |c| c.is_alphanumeric() || c == '_')
        && n.chars().all(|c| c.is_alphanumeric() || " _-.()+".contains(c))
}
fn file_in(app: &AppHandle, area: &str, name: &str) -> Result<PathBuf, String> {
    if !safe_name(name) { return Err("name".into()); }
    Ok(area_dir(app, area)?.join(name))
}

#[derive(Serialize)]
struct FileInfo { name: String, size: u64, mtime: String }

#[tauri::command]
fn hydra_info(app: AppHandle) -> Value {
    let h = home(&app);
    for a in ["projects", "autosave", "backups"] { let _ = fs::create_dir_all(h.join(a)); }
    let s = |a: &str| h.join(a).to_string_lossy().to_string();
    json!({ "ok": true, "launcher": 2, "desktop": true, "port": 0, "root": "", "home": h.to_string_lossy(),
            "projects": s("projects"), "autosave": s("autosave"), "backups": s("backups"), "samples": s("samples"), "keep": KEEP_BACKUPS })
}

#[tauri::command]
fn hydra_list(app: AppHandle, area: String) -> Result<Vec<FileInfo>, String> {
    let dir = area_dir(&app, &area)?;
    let mut out: Vec<(u64, FileInfo)> = vec![];
    for e in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !safe_name(&name) || name == "index.json" { continue; }
        let Ok(md) = e.metadata() else { continue };
        if !md.is_file() { continue; }
        let secs = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        let mtime = chrono::DateTime::from_timestamp(secs as i64, 0).map(|d| d.to_rfc3339()).unwrap_or_default();
        out.push((secs, FileInfo { name, size: md.len(), mtime }));
    }
    out.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(out.into_iter().map(|x| x.1).collect())
}

#[tauri::command]
fn hydra_read(app: AppHandle, area: String, name: String) -> Result<Response, String> {
    let f = file_in(&app, &area, &name)?;
    fs::read(&f).map(Response::new).map_err(|e| e.to_string())
}

/// body: the raw file bytes; headers: area, name
#[tauri::command]
fn hydra_write(app: AppHandle, request: Request<'_>) -> Result<Value, String> {
    let h = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let (area, name) = (h("area"), h("name"));
    if area != "projects" && area != "autosave" { return Err("read-only area".into()); }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw bytes".into()) };
    let file = file_in(&app, &area, &name)?;
    let mut backup: Option<String> = None;
    if area == "projects" && file.exists() {
        let p = PathBuf::from(&name);
        let base = p.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let b = format!("{}_{}{}", base, chrono::Local::now().format("%Y%m%d-%H%M%S"), ext);
        let bdir = area_dir(&app, "backups")?;
        fs::copy(&file, bdir.join(&b)).map_err(|e| e.to_string())?;
        backup = Some(b);
        let mut old: Vec<String> = fs::read_dir(&bdir).map_err(|e| e.to_string())?.flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with(&format!("{}_", base)) && n.ends_with(&ext) && n.len() == base.len() + 16 + ext.len()).collect();
        old.sort(); old.reverse();
        for n in old.into_iter().skip(KEEP_BACKUPS) { let _ = fs::remove_file(bdir.join(n)); }
    }
    let tmp = file.with_extension("part");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    if file.exists() { fs::remove_file(&file).map_err(|e| e.to_string())?; }
    fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "path": file.to_string_lossy(), "size": bytes.len(), "backup": backup }))
}

#[tauri::command]
fn hydra_delete(app: AppHandle, area: String, name: String) -> Result<(), String> {
    if area != "projects" && area != "autosave" { return Err("read-only area".into()); }
    let f = file_in(&app, &area, &name)?;
    if f.exists() { fs::remove_file(f).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
fn hydra_reveal(app: AppHandle, area: String) -> Result<(), String> {
    let d = area_dir(&app, &area)?;
    std::process::Command::new("explorer").arg(d).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// the .hydra file HYDRA was started with (double-click in Explorer): its name, or null
fn startup_path() -> Option<PathBuf> {
    std::env::args().skip(1).map(PathBuf::from).find(|p| p.extension().map_or(false, |e| e.eq_ignore_ascii_case("hydra")) && p.is_file())
}
#[tauri::command]
fn hydra_startup_name() -> Option<String> { startup_path().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())) }
#[tauri::command]
fn hydra_startup_read() -> Result<Response, String> {
    let p = startup_path().ok_or("no file")?;
    fs::read(p).map(Response::new).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // one HYDRA window: a second start (e.g. HYDRA.exe --mcp starting HYDRA) brings the open one to the front
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.set_focus(); }
        }))
        .manage(ai::AiState::default())
        .invoke_handler(tauri::generate_handler![hydra_info, hydra_list, hydra_read, hydra_write, hydra_delete, hydra_reveal, hydra_startup_name, hydra_startup_read,
            ai::ai_mcp_listen, ai::ai_mcp_reply, ai::ai_claude_config, ai::ai_cli_detect, ai::ai_key_set, ai::ai_key_has, ai::ai_key_delete,
            ai::ai_cli_run, ai::ai_cli_stop, ai::ai_api_chat])
        .build(tauri::generate_context!())
        .expect("error while running HYDRA")
        .run(|app, ev| { if let tauri::RunEvent::Exit = ev { ai::shutdown(&app.state::<ai::AiState>()); } });
}
