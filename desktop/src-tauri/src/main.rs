// HYDRA desktop: the same offline web build in a native window (WebView2).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // HYDRA.exe --mcp: MCP server over stdio for Claude Desktop (no window); see ai.rs
    if std::env::args().skip(1).any(|a| a == "--mcp") { std::process::exit(hydra_lib::ai::run_mcp()); }
    hydra_lib::run()
}
