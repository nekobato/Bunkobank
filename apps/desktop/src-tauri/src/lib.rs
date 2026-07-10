//! Native shell for the BookCafe desktop manager.

use tauri::Manager;

/// Starts the BookCafe desktop manager and its platform plugins.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running BookCafe desktop manager");
}
