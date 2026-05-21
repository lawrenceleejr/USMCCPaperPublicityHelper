mod anthropic;
mod commands;
mod parse_row;
mod prompts;
mod settings;

fn log_stage(stage: &str) {
    eprintln!("[usmcc-stage] {stage}");
    use std::io::Write;
    let mut path = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
    path.push("Library/Logs");
    let _ = std::fs::create_dir_all(&path);
    path.push("usmcc-publicity-helper-stages.log");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "[usmcc-stage] {stage}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log_stage("lib::run: enter");
    let builder = tauri::Builder::default();
    log_stage("lib::run: default builder created");
    let builder = builder.plugin(tauri_plugin_store::Builder::new().build());
    log_stage("lib::run: store plugin attached");
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::parse_row,
        commands::generate,
        commands::get_api_key_status,
        commands::set_api_key,
        commands::test_api_key,
        commands::get_prefs,
        commands::set_prefs,
    ]);
    log_stage("lib::run: invoke_handler attached");
    let context = tauri::generate_context!();
    log_stage("lib::run: context generated, calling builder.run()");
    match builder.run(context) {
        Ok(()) => log_stage("lib::run: tauri exited Ok"),
        Err(e) => {
            log_stage(&format!("lib::run: tauri returned Err: {e}"));
            panic!("error while running tauri application: {e}");
        }
    }
}
