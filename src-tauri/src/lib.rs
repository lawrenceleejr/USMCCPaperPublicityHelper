mod anthropic;
mod arxiv;
mod commands;
mod parse_row;
mod prompts;
mod settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::parse_row,
            commands::generate,
            commands::get_api_key_status,
            commands::set_api_key,
            commands::test_api_key,
            commands::get_prefs,
            commands::set_prefs,
            commands::arxiv_eprint_url,
            commands::fetch_arxiv_figures,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
