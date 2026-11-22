// HYDRA AI bridge.
// · HYDRA.exe --mcp: an MCP server over stdio for Claude Desktop and other MCP clients. It answers initialize,
//   ping and tools/list itself (the tool list is compiled in from mcp-tools.json) and forwards tools/call to the
//   running HYDRA. If HYDRA is not running it starts it once and waits for it.
// · In HYDRA: a listener on 127.0.0.1 only (random port + session token, written to mcp.json in the app-data
//   folder). It runs only while AI features and the MCP server are switched on, and hands every call to the app's
//   command API (the web view), which checks it, logs it and turns edits into plans that wait for Apply.
// · Claude Desktop config writer (with a backup), CLI detection, API keys in the Windows Credential Manager.
// · CLI bridge: runs the user's own Claude Code / Codex with only HYDRA's MCP tools; API-key requests to Anthropic / OpenAI.
// Nothing here runs scripts or reads files other than HYDRA's own mcp.json and the Claude Desktop config.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Stdio};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

pub const TOOLS: &str = include_str!("../mcp-tools.json");
const PROTOCOLS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const IDENT: &str = "io.github.hydra.cad";
const MAX_LINE: u64 = 8 << 20;
const OFF_MSG: &str = "HYDRA is not accepting AI connections. In HYDRA open Settings › AI & Connections and turn on AI features and the MCP server.";

// ---------- discovery file (same folder for the app and for --mcp) ----------
pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join(IDENT)
}
fn disco_path() -> PathBuf { data_dir().join("mcp.json") }

/// 256-bit session token from the OS-seeded hasher keys, the clock and the process id
pub fn new_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    (0..4u64).map(|i| { let mut h = RandomState::new().build_hasher(); h.write_u64(i); h.write_u128(t); h.write_u32(std::process::id()); format!("{:016x}", h.finish()) }).collect()
}
fn same(a: &str, b: &str) -> bool { a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |x, (p, q)| x | (p ^ q)) == 0 }
fn read_line_capped<R: BufRead>(r: &mut R, buf: &mut String) -> std::io::Result<usize> { buf.clear(); r.by_ref().take(MAX_LINE).read_line(buf) }

// ---------- listener: generic part (unit-tested without Tauri) ----------
pub type Handler = Arc<dyn Fn(&str, Value, &str) -> Value + Send + Sync>;
pub fn serve(listener: TcpListener, token: String, stop: Arc<AtomicBool>, handler: Handler) {
    for conn in listener.incoming() {
        if stop.load(Ordering::SeqCst) { break; }
        let Ok(s) = conn else { continue };
        if !s.peer_addr().map(|a| a.ip().is_loopback()).unwrap_or(false) { continue; } // 127.0.0.1 only
        let (tk, h, st) = (token.clone(), handler.clone(), stop.clone());
        std::thread::spawn(move || handle_conn(s, tk, h, st));
    }
}
fn handle_conn(s: TcpStream, token: String, handler: Handler, stop: Arc<AtomicBool>) {
    let Ok(mut w) = s.try_clone() else { return };
    let mut r = BufReader::new(s); let mut line = String::new();
    while !stop.load(Ordering::SeqCst) {
        match read_line_capped(&mut r, &mut line) { Ok(0) | Err(_) => return, Ok(_) => {} }
        let Ok(req) = serde_json::from_str::<Value>(&line) else { return };
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        if !same(req.get("token").and_then(|t| t.as_str()).unwrap_or(""), &token) {
            let _ = writeln!(w, "{}", json!({ "id": id, "error": "unauthorized" })); return;
        }
        let tool = req.get("tool").and_then(|t| t.as_str()).unwrap_or("").to_string();
        let client = req.get("client").and_then(|c| c.as_str()).unwrap_or("").to_string();
        let res = handler(&tool, req.get("args").cloned().unwrap_or(json!({})), &client);
        if writeln!(w, "{}", json!({ "id": id, "result": res })).is_err() { return; }
    }
}

// ---------- listener: inside HYDRA ----------
#[derive(Default)]
pub struct AiState { run: Mutex<Option<(u16, Arc<AtomicBool>)>>, pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>, next: Arc<AtomicU64>, cli: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>> }

#[tauri::command]
pub fn ai_mcp_listen(app: AppHandle, state: State<'_, AiState>, on: bool) -> Result<Value, String> {
    let mut run = state.run.lock().map_err(|e| e.to_string())?;
    if !on { stop_listener(&mut run); return Ok(json!({ "listening": false })); }
    if let Some((port, _)) = run.as_ref() { return Ok(json!({ "listening": true, "port": port })); }
    let l = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0)).map_err(|e| e.to_string())?;
    let port = l.local_addr().map_err(|e| e.to_string())?.port(); let token = new_token();
    std::fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    std::fs::write(disco_path(), json!({ "port": port, "token": token, "pid": std::process::id() }).to_string()).map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let (pending, next) = (state.pending.clone(), state.next.clone());
    let handler: Handler = Arc::new(move |tool: &str, args: Value, client: &str| {
        let rid = format!("m{}", next.fetch_add(1, Ordering::SeqCst)); let (tx, rx) = mpsc::channel();
        if let Ok(mut p) = pending.lock() { p.insert(rid.clone(), tx); }
        if app.emit("ai-mcp-call", json!({ "rid": rid, "tool": tool, "args": args, "client": client })).is_err() { return json!({ "ok": false, "error": "HYDRA window not ready" }); }
        rx.recv_timeout(Duration::from_secs(180)).unwrap_or_else(|_| { if let Ok(mut p) = pending.lock() { p.remove(&rid); } json!({ "ok": false, "error": "HYDRA did not answer in time" }) })
    });
    let st = stop.clone(); std::thread::spawn(move || serve(l, token, st, handler));
    *run = Some((port, stop));
    Ok(json!({ "listening": true, "port": port }))
}
fn stop_listener(run: &mut Option<(u16, Arc<AtomicBool>)>) {
    if let Some((port, stop)) = run.take() {
        stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect_timeout(&SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port), Duration::from_millis(300)); // wakes accept()
    }
    let _ = std::fs::remove_file(disco_path());
}
/// app exit: the discovery file goes, so --mcp does not try a dead port
pub fn shutdown(state: &AiState) { if let Ok(mut run) = state.run.lock() { stop_listener(&mut run); } }

#[tauri::command]
pub fn ai_mcp_reply(state: State<'_, AiState>, rid: String, result: Value) {
    if let Some(tx) = state.pending.lock().ok().and_then(|mut p| p.remove(&rid)) { let _ = tx.send(result); }
}

// ---------- HYDRA.exe --mcp ----------
const INSTR: &str = "HYDRA is a hydraulic / pneumatic circuit CAD with a solver. Read with get_project_info and get_sheet, find parts with search_library and describe_part, draw a whole circuit with build_circuit (ISO 1219-2 tags, nets of TAG.PORT), check with validate and run_sim. Edits become plans shown in HYDRA; the user presses Apply there.";

#[derive(Default)]
struct Link { conn: Option<(BufReader<TcpStream>, TcpStream, String)>, launched: bool, next: u64 }
impl Link {
    fn connect(&mut self) -> Result<(), String> {
        let d: Value = serde_json::from_str(&std::fs::read_to_string(disco_path()).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let port = d["port"].as_u64().ok_or("no port")? as u16; let token = d["token"].as_str().ok_or("no token")?.to_string();
        let s = TcpStream::connect_timeout(&SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port), Duration::from_secs(2)).map_err(|e| e.to_string())?;
        let _ = s.set_read_timeout(Some(Duration::from_secs(200)));
        let w = s.try_clone().map_err(|e| e.to_string())?;
        self.conn = Some((BufReader::new(s), w, token)); Ok(())
    }
    fn ensure(&mut self) -> Result<(), String> {
        if self.conn.is_some() || self.connect().is_ok() { return Ok(()); }
        if !self.launched && std::env::var("HYDRA_MCP_NO_LAUNCH").map(|v| v != "1").unwrap_or(true) { launch_app(); }
        self.launched = true;
        let wait = std::env::var("HYDRA_MCP_WAIT").ok().and_then(|v| v.parse::<u64>().ok()).unwrap_or(30);
        let until = Instant::now() + Duration::from_secs(wait);
        while Instant::now() < until { std::thread::sleep(Duration::from_millis(500)); if self.connect().is_ok() { return Ok(()); } }
        Err(OFF_MSG.into())
    }
    fn call(&mut self, tool: &str, args: Value) -> Result<Value, String> {
        for _ in 0..2 {
            self.ensure()?; self.next += 1; let id = self.next;
            let (r, w, token) = self.conn.as_mut().unwrap();
            let client = std::env::var("HYDRA_MCP_CLIENT").unwrap_or_default();
            let req = json!({ "token": token, "id": id, "tool": tool, "args": args, "client": client });
            if writeln!(w, "{}", req).is_err() { self.conn = None; continue; } // stale connection: reconnect once
            let mut line = String::new();
            match read_line_capped(r, &mut line) {
                Ok(n) if n > 0 => {}
                _ => { self.conn = None; return Err("Lost the connection to HYDRA (it may have closed). Try again.".into()); }
            }
            let v: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            if v["error"] == "unauthorized" { self.conn = None; continue; } // HYDRA restarted with a new token
            return Ok(v["result"].clone());
        }
        Err(OFF_MSG.into())
    }
}
fn launch_app() {
    let Ok(exe) = std::env::current_exe() else { return };
    let mut c = std::process::Command::new(exe);
    c.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0000_0008 | 0x0000_0200); } // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    let _ = c.spawn();
}
fn tool_result(r: Result<Value, String>) -> Value {
    let text = |s: String| json!([{ "type": "text", "text": s }]);
    match r {
        Ok(v) if v["ok"] == true => json!({ "content": text(serde_json::to_string(&v["data"]).unwrap_or_default()), "isError": false }),
        Ok(v) => { let mut m = v["error"].as_str().unwrap_or("Error").to_string(); if let Some(d) = v["details"].as_array() { for x in d { m.push_str("\n- "); m.push_str(x.as_str().unwrap_or("")); } } json!({ "content": text(m), "isError": true }) }
        Err(e) => json!({ "content": text(e), "isError": true }),
    }
}
/// one JSON-RPC message → the reply (None for notifications)
fn handle_rpc(msg: &Value, tools: &Value, link: &mut Link) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg["method"].as_str().unwrap_or("");
    let ok = |r: Value| json!({ "jsonrpc": "2.0", "id": id, "result": r });
    Some(match method {
        "initialize" => { let want = msg["params"]["protocolVersion"].as_str().unwrap_or(""); let v = if PROTOCOLS.contains(&want) { want } else { PROTOCOLS[0] };
            ok(json!({ "protocolVersion": v, "capabilities": { "tools": { "listChanged": false } }, "serverInfo": { "name": "hydra", "title": "HYDRA", "version": env!("CARGO_PKG_VERSION") }, "instructions": INSTR })) }
        "ping" => ok(json!({})),
        "tools/list" => ok(json!({ "tools": tools["tools"] })),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or("");
            if !tools["tools"].as_array().map(|a| a.iter().any(|t| t["name"] == name)).unwrap_or(false) { ok(tool_result(Err(format!("Unknown tool {}", name)))) }
            else { let args = msg["params"].get("arguments").cloned().filter(|a| a.is_object()).unwrap_or(json!({})); ok(tool_result(link.call(name, args))) }
        }
        _ => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("Method not found: {}", method) } }),
    })
}
pub fn run_mcp() -> i32 {
    let tools: Value = serde_json::from_str(TOOLS).unwrap_or(json!({ "tools": [] }));
    let mut link = Link::default();
    let stdin = std::io::stdin(); let mut input = stdin.lock(); let mut out = std::io::stdout();
    let mut line = String::new();
    loop {
        match read_line_capped(&mut input, &mut line) { Ok(0) | Err(_) => return 0, Ok(_) => {} }
        if line.trim().is_empty() { continue; }
        let replies: Vec<Value> = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(a)) => a.iter().filter_map(|m| handle_rpc(m, &tools, &mut link)).collect(),
            Ok(m) => handle_rpc(&m, &tools, &mut link).into_iter().collect(),
            Err(_) => vec![json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } })],
        };
        for r in replies { if writeln!(out, "{}", r).is_err() { return 0; } }
        let _ = out.flush();
    }
}

// ---------- Claude Desktop config ----------
fn claude_targets() -> Vec<PathBuf> {
    let mut v = vec![];
    if let Some(a) = std::env::var_os("APPDATA") { v.push(PathBuf::from(a).join("Claude").join("claude_desktop_config.json")); }
    // Microsoft Store install keeps its config inside the package folder
    if let Some(l) = std::env::var_os("LOCALAPPDATA") {
        if let Ok(rd) = std::fs::read_dir(PathBuf::from(l).join("Packages")) {
            for e in rd.flatten() { let n = e.file_name().to_string_lossy().to_string(); if n.starts_with("Claude_") || n.starts_with("AnthropicPBC.Claude") {
                let d = e.path().join("LocalCache").join("Roaming").join("Claude"); if d.is_dir() { v.push(d.join("claude_desktop_config.json")); } } }
        }
    }
    v
}
pub fn hydra_entry(exe: &str) -> Value { json!({ "command": exe, "args": ["--mcp"] }) }
/// adds / replaces mcpServers.hydra; a copy of the old file is kept next to it. An unreadable file is never overwritten.
pub fn write_claude_config(path: &Path, exe: &str) -> Result<Value, String> {
    let mut cfg: Value = if path.exists() {
        let txt = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        if txt.trim().is_empty() { json!({}) } else { serde_json::from_str(&txt).map_err(|_| format!("{} is not valid JSON — fix it in Claude Desktop first; nothing was changed", path.display()))? }
    } else { json!({}) };
    if !cfg.is_object() { return Err("The Claude Desktop config is not a JSON object; nothing was changed".into()); }
    let mut backup = Value::Null;
    if path.exists() {
        let b = path.with_file_name(format!("claude_desktop_config.json.bak-{}", chrono::Local::now().format("%Y%m%d-%H%M%S")));
        std::fs::copy(path, &b).map_err(|e| e.to_string())?; backup = json!(b.to_string_lossy());
    } else if let Some(d) = path.parent() { std::fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    let servers = cfg.as_object_mut().unwrap().entry("mcpServers").or_insert_with(|| json!({}));
    if !servers.is_object() { *servers = json!({}); }
    servers.as_object_mut().unwrap().insert("hydra".into(), hydra_entry(exe));
    let tmp = path.with_extension("json.part");
    std::fs::write(&tmp, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(json!({ "path": path.to_string_lossy(), "backup": backup }))
}
fn has_hydra(path: &Path) -> bool { std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).map(|v| v["mcpServers"]["hydra"].is_object()).unwrap_or(false) }

#[tauri::command(async)]
pub fn ai_claude_config(write: bool) -> Result<Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().to_string();
    let mut targets = claude_targets(); if targets.is_empty() { return Err("No Claude Desktop folder found".into()); }
    let existing: Vec<PathBuf> = targets.iter().filter(|p| p.parent().map(|d| d.is_dir()).unwrap_or(false)).cloned().collect();
    if !existing.is_empty() { targets = existing; } else { targets.truncate(1); }
    let mut written = vec![];
    if write { for t in &targets { written.push(write_claude_config(t, &exe)?); } }
    Ok(json!({ "exe": exe, "snippet": { "hydra": hydra_entry(&exe) }, "installed": targets.iter().any(|t| t.parent().map(|d| d.is_dir()).unwrap_or(false)),
        "targets": targets.iter().map(|t| json!({ "path": t.to_string_lossy(), "exists": t.exists(), "hydra": has_hydra(t) })).collect::<Vec<_>>(), "written": written }))
}

// ---------- installed AI command-line tools ----------
fn find_on_path(name: &str) -> Option<String> {
    let mut c = std::process::Command::new(if cfg!(windows) { "where.exe" } else { "which" });
    c.arg(name).stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); } // CREATE_NO_WINDOW
    let out = c.output().ok()?; if !out.status.success() { return None; }
    let all: Vec<String> = String::from_utf8_lossy(&out.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
    let ends = |l: &&String, ext: &str| l.to_ascii_lowercase().ends_with(ext);
    all.iter().find(|l| ends(l, ".exe")).or_else(|| all.iter().find(|l| ends(l, ".cmd") || ends(l, ".bat"))).or_else(|| all.first()).cloned()
}
fn codex_signed_in(path: &str) -> Option<bool> {
    let mut c = std::process::Command::new(path);
    c.args(["login", "status"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); }
    c.status().ok().map(|s| s.success())
}
#[tauri::command(async)]
pub fn ai_cli_detect() -> Value {
    let codex = find_on_path("codex");
    let signed = codex.as_deref().and_then(codex_signed_in);
    json!({ "claude": find_on_path("claude"), "codex": codex, "codexSignedIn": signed })
}

// ---------- CLI bridge: the user's own Claude Code / Codex, with HYDRA's tools only ----------
fn valid_id(s: &str) -> bool { !s.is_empty() && s.len() < 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') }
fn pump_lines<R: Read>(r: R, mut each: impl FnMut(String)) {
    let mut r = BufReader::new(r); let mut buf = Vec::new();
    loop { buf.clear(); match r.read_until(b'\n', &mut buf) { Ok(0) | Err(_) => break, Ok(_) => { let l = String::from_utf8_lossy(&buf).trim_end().to_string(); if !l.is_empty() { each(l); } } } }
}
#[tauri::command(async)]
pub fn ai_cli_run(app: AppHandle, state: State<'_, AiState>, tool: String, prompt: String, resume: Option<String>, system: String, client: String) -> Result<String, String> {
    if tool != "claude" && tool != "codex" { return Err("Unknown CLI".into()); }
    let path = find_on_path(&tool).ok_or_else(|| format!("{} was not found on this PC", if tool == "claude" { "Claude Code (claude)" } else { "Codex (codex)" }))?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().to_string();
    let dir = data_dir().join("cli"); std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let resume = resume.filter(|s| valid_id(s));
    let mut c = std::process::Command::new(&path);
    if tool == "claude" {
        let cfg = dir.join("mcp.json");
        std::fs::write(&cfg, json!({ "mcpServers": { "hydra": { "type": "stdio", "command": exe, "args": ["--mcp"], "env": { "HYDRA_MCP_CLIENT": client } } } }).to_string()).map_err(|e| e.to_string())?;
        let sys = dir.join("system.txt"); std::fs::write(&sys, &system).map_err(|e| e.to_string())?;
        // prompt on stdin; only HYDRA's MCP tools; Claude Code's own file, shell and web tools are switched off
        c.args(["-p", "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--permission-mode", "dontAsk", "--max-turns", "40"]);
        c.arg("--mcp-config").arg(&cfg).arg("--append-system-prompt-file").arg(&sys);
        c.arg("--allowedTools").arg("mcp__hydra").arg("--tools").arg("");
        c.arg("--disallowedTools").arg("Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit");
        if let Some(id) = &resume { c.arg("--resume").arg(id); }
    } else {
        let lit = |s: &str| format!("'{}'", s.replace('\'', ""));
        c.arg("exec").args(["--json", "--skip-git-repo-check", "--sandbox", "read-only"]).arg("-C").arg(&dir);
        c.arg("-c").arg(format!("mcp_servers.hydra.command={}", lit(&exe)));
        c.arg("-c").arg("mcp_servers.hydra.args=['--mcp']");
        c.arg("-c").arg(format!("mcp_servers.hydra.env.HYDRA_MCP_CLIENT={}", lit(&client)));
        c.arg("-c").arg("mcp_servers.hydra.default_tools_approval_mode='approve'");
        if let Some(id) = &resume { c.arg("resume").arg(id); }
        c.arg("-");
    }
    c.current_dir(&dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); } // CREATE_NO_WINDOW
    let mut child = c.spawn().map_err(|e| format!("Could not start {}: {}", tool, e))?;
    if let Some(mut si) = child.stdin.take() { let _ = si.write_all(prompt.as_bytes()); } // closed here → end of prompt
    let (out, err) = (child.stdout.take(), child.stderr.take());
    let run = format!("r{}", state.next.fetch_add(1, Ordering::SeqCst));
    let child = Arc::new(Mutex::new(child));
    state.cli.lock().map_err(|e| e.to_string())?.insert(run.clone(), child.clone());
    let errbuf = Arc::new(Mutex::new(String::new()));
    if let Some(e) = err { let eb = errbuf.clone(); std::thread::spawn(move || pump_lines(e, |l| { if let Ok(mut b) = eb.lock() { b.push_str(&l); b.push('\n'); if b.len() > 4000 { let mut cut = b.len() - 4000; while !b.is_char_boundary(cut) { cut += 1; } b.drain(..cut); } } })); }
    let (app2, run2, cli) = (app.clone(), run.clone(), state.cli.clone());
    std::thread::spawn(move || {
        if let Some(o) = out { pump_lines(o, |l| { let _ = app2.emit("ai-cli", json!({ "run": run2, "kind": "line", "line": l })); }); }
        let mut code = -1;
        for _ in 0..100 { if let Some(s) = child.lock().ok().and_then(|mut c| c.try_wait().ok().flatten()) { code = s.code().unwrap_or(-1); break; } std::thread::sleep(Duration::from_millis(100)); }
        std::thread::sleep(Duration::from_millis(100));
        let err = errbuf.lock().map(|b| b.clone()).unwrap_or_default();
        if let Ok(mut m) = cli.lock() { m.remove(&run2); }
        let _ = app2.emit("ai-cli", json!({ "run": run2, "kind": "done", "code": code, "err": err }));
    });
    Ok(run)
}
#[tauri::command]
pub fn ai_cli_stop(state: State<'_, AiState>, run: String) {
    let c = state.cli.lock().ok().and_then(|m| m.get(&run).cloned());
    if let Some(c) = c { if let Ok(mut c) = c.lock() { let _ = c.kill(); } }
}

// ---------- own API key: the request goes from here, the key never reaches the page ----------
#[tauri::command(async)]
pub fn ai_api_chat(provider: String, body: Value) -> Result<Value, String> {
    let key = key_entry(&provider)?.get_password().map_err(|_| "No API key saved for this provider — add it in Connect an AI".to_string())?;
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(600)).build();
    let req = if provider == "anthropic" {
        agent.post("https://api.anthropic.com/v1/messages").set("x-api-key", &key).set("anthropic-version", "2023-06-01").set("anthropic-beta", "server-side-fallback-2026-07-01")
    } else {
        agent.post("https://api.openai.com/v1/chat/completions").set("Authorization", &format!("Bearer {}", key))
    };
    match req.set("content-type", "application/json").send_json(body) {
        Ok(r) => r.into_json::<Value>().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(code, r)) => {
            let t = r.into_string().unwrap_or_default();
            let msg = serde_json::from_str::<Value>(&t).ok().and_then(|v| v["error"]["message"].as_str().map(String::from)).unwrap_or(t);
            Err(format!("{} error {}: {}", if provider == "anthropic" { "Anthropic" } else { "OpenAI" }, code, msg.chars().take(400).collect::<String>()))
        }
        Err(e) => Err(format!("Network error: {}", e)),
    }
}

// ---------- API keys: Windows Credential Manager; HYDRA never shows a stored key again ----------
const KEY_SERVICE: &str = "HYDRA AI";
fn key_entry(provider: &str) -> Result<keyring::Entry, String> {
    if provider != "anthropic" && provider != "openai" { return Err("Unknown provider".into()); }
    keyring::Entry::new(KEY_SERVICE, provider).map_err(|e| e.to_string())
}
#[tauri::command(async)]
pub fn ai_key_set(provider: String, key: String) -> Result<(), String> {
    let k = key.trim(); if k.is_empty() || k.len() > 400 || k.chars().any(|c| c.is_whitespace()) { return Err("That does not look like an API key".into()); }
    key_entry(&provider)?.set_password(k).map_err(|e| e.to_string())
}
#[tauri::command(async)]
pub fn ai_key_has(provider: String) -> bool { key_entry(&provider).and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok() }
#[tauri::command(async)]
pub fn ai_key_delete(provider: String) -> Result<(), String> { match key_entry(&provider)?.delete_credential() { Ok(_) | Err(keyring::Error::NoEntry) => Ok(()), Err(e) => Err(e.to_string()) } }

#[cfg(test)]
mod tests {
    use super::*;
    fn start(handler: Handler) -> (u16, String, Arc<AtomicBool>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap(); let port = l.local_addr().unwrap().port();
        let tk = new_token(); let stop = Arc::new(AtomicBool::new(false)); let (t2, s2) = (tk.clone(), stop.clone());
        std::thread::spawn(move || serve(l, t2, s2, handler)); (port, tk, stop)
    }
    fn ask(port: u16, token: &str, tool: &str) -> Value {
        let s = TcpStream::connect(("127.0.0.1", port)).unwrap(); let mut w = s.try_clone().unwrap(); let mut r = BufReader::new(s);
        writeln!(w, "{}", json!({ "token": token, "id": 7, "tool": tool, "args": { "x": 1 }, "client": "cli-test" })).unwrap();
        let mut line = String::new(); r.read_line(&mut line).unwrap(); serde_json::from_str(&line).unwrap()
    }
    #[test] fn ids_for_resume_are_checked() { assert!(valid_id("0199a213-81c0-7800")); assert!(!valid_id("a b")); assert!(!valid_id("x;rm")); assert!(!valid_id("")); }
    #[test] fn token_is_256_bit_and_unique() { let (a, b) = (new_token(), new_token()); assert_eq!(a.len(), 64); assert_ne!(a, b); }
    #[test] fn round_trip_and_token_check() {
        let (port, tk, _s) = start(Arc::new(|tool: &str, args: Value, client: &str| json!({ "ok": true, "data": { "tool": tool, "x": args["x"], "client": client } })));
        let v = ask(port, &tk, "get_sheet"); assert_eq!(v["id"], 7); assert_eq!(v["result"]["data"]["tool"], "get_sheet"); assert_eq!(v["result"]["data"]["x"], 1); assert_eq!(v["result"]["data"]["client"], "cli-test");
        let bad = ask(port, "nope", "get_sheet"); assert_eq!(bad["error"], "unauthorized"); assert!(bad.get("result").is_none());
    }
    #[test] fn rpc_without_hydra() {
        std::env::set_var("HYDRA_MCP_NO_LAUNCH", "1"); std::env::set_var("HYDRA_MCP_WAIT", "0");
        std::env::set_var("APPDATA", std::env::temp_dir().join("hydra-mcp-test-none"));
        let tools: Value = serde_json::from_str(TOOLS).unwrap(); let mut link = Link::default();
        let init = handle_rpc(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2024-11-05" } }), &tools, &mut link).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2024-11-05"); assert_eq!(init["result"]["serverInfo"]["name"], "hydra");
        assert!(handle_rpc(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), &tools, &mut link).is_none());
        let list = handle_rpc(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }), &tools, &mut link).unwrap();
        assert!(list["result"]["tools"].as_array().unwrap().iter().any(|t| t["name"] == "build_circuit"));
        let call = handle_rpc(&json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "get_project_info", "arguments": {} } }), &tools, &mut link).unwrap();
        assert_eq!(call["result"]["isError"], true); assert!(call["result"]["content"][0]["text"].as_str().unwrap().contains("Settings"));
        let bad = handle_rpc(&json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "run_script", "arguments": {} } }), &tools, &mut link).unwrap();
        assert!(bad["result"]["content"][0]["text"].as_str().unwrap().contains("Unknown tool"));
        let nf = handle_rpc(&json!({ "jsonrpc": "2.0", "id": 5, "method": "resources/list" }), &tools, &mut link).unwrap(); assert_eq!(nf["error"]["code"], -32601);
    }
    #[test] fn claude_config_backup_and_merge() {
        let d = std::env::temp_dir().join(format!("hydra-cfg-{}", std::process::id())); let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap();
        let p = d.join("claude_desktop_config.json");
        std::fs::write(&p, r#"{"mcpServers":{"other":{"command":"x"}},"theme":"dark"}"#).unwrap();
        let r = write_claude_config(&p, "C:\\HYDRA\\HYDRA.exe").unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["mcpServers"]["hydra"]["args"][0], "--mcp"); assert_eq!(v["mcpServers"]["other"]["command"], "x"); assert_eq!(v["theme"], "dark");
        assert!(Path::new(r["backup"].as_str().unwrap()).exists());
        std::fs::write(&p, "{ broken").unwrap(); assert!(write_claude_config(&p, "x").is_err()); assert_eq!(std::fs::read_to_string(&p).unwrap(), "{ broken");
        let _ = std::fs::remove_dir_all(&d);
    }
}
