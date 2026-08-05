//! Native shell and narrowly scoped OS operations for the Bunkobank manager.

use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const SERVER_CONFIG_FILE: &str = "config.json";
const SIDECAR_NAME: &str = "binaries/bunkobank-server";
const LAUNCH_AGENT_LABEL: &str = "dev.bunkobank.server";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopEnvironment {
    platform: &'static str,
    home_dir: String,
    app_config_dir: String,
    app_data_dir: String,
    config_path: String,
    log_dir: String,
    sidecar_name: &'static str,
    sidecar_path: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailSettings {
    enabled: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerConfig {
    host: String,
    port: u16,
    thumbnails: ThumbnailSettings,
}

/// Returns paths and platform facts resolved by Tauri's native path API.
#[tauri::command]
fn get_desktop_environment(app: AppHandle) -> Result<DesktopEnvironment, String> {
    let app_config_dir = app.path().app_config_dir().map_err(display_error)?;
    let app_data_dir = app.path().app_data_dir().map_err(display_error)?;
    let log_dir = app.path().app_log_dir().map_err(display_error)?;
    let home_dir = app.path().home_dir().map_err(display_error)?;
    let config_path = app_config_dir.join(SERVER_CONFIG_FILE);
    let sidecar_path = resolve_bundled_sidecar_path()?;

    Ok(DesktopEnvironment {
        platform: current_platform(),
        home_dir: display_path(&home_dir),
        app_config_dir: display_path(&app_config_dir),
        app_data_dir: display_path(&app_data_dir),
        config_path: display_path(&config_path),
        log_dir: display_path(&log_dir),
        sidecar_name: SIDECAR_NAME,
        sidecar_path: display_path(&sidecar_path),
    })
}

/// Reads the fixed Bunkobank server config file when it exists.
#[tauri::command]
fn read_server_config(app: AppHandle) -> Result<Option<ServerConfig>, String> {
    let config_path = app
        .path()
        .app_config_dir()
        .map_err(display_error)?
        .join(SERVER_CONFIG_FILE);

    if !config_path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(config_path).map_err(display_error)?;
    serde_json::from_str(&raw).map(Some).map_err(display_error)
}

/// Writes a validated port while preserving the remaining server settings.
#[tauri::command]
fn write_server_port(app: AppHandle, port: u16) -> Result<ServerConfig, String> {
    if port == 0 {
        return Err("Server port must be between 1 and 65535.".to_string());
    }

    let app_config_dir = app.path().app_config_dir().map_err(display_error)?;
    let config_path = app_config_dir.join(SERVER_CONFIG_FILE);
    let mut config = read_server_config(app)?.unwrap_or_else(default_server_config);
    config.port = port;
    let serialized = format!(
        "{}\n",
        serde_json::to_string_pretty(&config).map_err(display_error)?
    );

    fs::create_dir_all(app_config_dir).map_err(display_error)?;
    fs::write(config_path, serialized).map_err(display_error)?;
    Ok(config)
}

/// Opens only Bunkobank's fixed application log directory.
#[tauri::command]
fn open_log_directory(app: AppHandle) -> Result<(), String> {
    let log_dir = app.path().app_log_dir().map_err(display_error)?;
    fs::create_dir_all(&log_dir).map_err(display_error)?;
    app.opener()
        .open_path(display_path(&log_dir), None::<&str>)
        .map_err(display_error)
}

/// Reads the fixed per-user Bunkobank LaunchAgent plist on macOS.
#[tauri::command]
fn read_mac_launch_agent_plist(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let path = resolve_launch_agent_path(&app)?;

        if !path.exists() {
            return Ok(None);
        }

        let domain = launch_agent_domain()?;
        let service_target = format!("{domain}/{LAUNCH_AGENT_LABEL}");

        if !is_launch_agent_loaded(&service_target)? {
            return Ok(None);
        }

        fs::read_to_string(path).map(Some).map_err(display_error)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("LaunchAgent operations are available only on macOS.".to_string())
    }
}

/// Atomically writes and activates the fixed Bunkobank LaunchAgent on macOS.
#[tauri::command]
fn install_mac_launch_agent(app: AppHandle, plist: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let expected_plist = create_expected_launch_agent_plist(&app)?;

        validate_launch_agent_plist(&plist, &expected_plist)?;
        let path = resolve_launch_agent_path(&app)?;
        let parent = path
            .parent()
            .ok_or_else(|| "LaunchAgent path has no parent directory.".to_string())?;
        let temporary_path = path.with_extension("plist.tmp");
        let log_dir = app.path().app_log_dir().map_err(display_error)?;
        let sidecar_path = resolve_bundled_sidecar_path()?;

        if !sidecar_path.is_file() {
            return Err(format!(
                "Bundled Bunkobank sidecar does not exist: {}",
                display_path(&sidecar_path)
            ));
        }

        fs::create_dir_all(parent).map_err(display_error)?;
        fs::create_dir_all(log_dir).map_err(display_error)?;
        fs::write(&temporary_path, plist).map_err(display_error)?;
        fs::rename(&temporary_path, &path).map_err(display_error)?;

        let domain = launch_agent_domain()?;
        let path_value = display_path(&path);
        let service_target = format!("{domain}/{LAUNCH_AGENT_LABEL}");

        let _ = run_launchctl(&["bootout", &domain, &path_value]);
        run_launchctl(&["bootstrap", &domain, &path_value])?;
        run_launchctl(&["kickstart", "-k", &service_target])?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, plist);
        Err("LaunchAgent operations are available only on macOS.".to_string())
    }
}

/// Deactivates and removes the fixed Bunkobank LaunchAgent on macOS.
#[tauri::command]
fn remove_mac_launch_agent(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let path = resolve_launch_agent_path(&app)?;
        let domain = launch_agent_domain()?;
        let path_value = display_path(&path);
        let service_target = format!("{domain}/{LAUNCH_AGENT_LABEL}");

        if is_launch_agent_loaded(&service_target)? {
            run_launchctl(&["bootout", &domain, &path_value])?;
        }

        if path.exists() {
            fs::remove_file(path).map_err(display_error)?;
        }

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("LaunchAgent operations are available only on macOS.".to_string())
    }
}

/// Starts the Bunkobank desktop manager and its platform plugins.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_desktop_environment,
            read_server_config,
            write_server_port,
            open_log_directory,
            read_mac_launch_agent_plist,
            install_mac_launch_agent,
            remove_mac_launch_agent
        ])
        .setup(|_app| {
            #[cfg(target_os = "windows")]
            _app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Bunkobank desktop manager");
}

/// Returns the same defaults used by the shared TypeScript config schema.
fn default_server_config() -> ServerConfig {
    ServerConfig {
        host: "127.0.0.1".to_string(),
        port: 4510,
        thumbnails: ThumbnailSettings { enabled: true },
    }
}

/// Resolves the sidecar path beside the native desktop executable.
fn resolve_bundled_sidecar_path() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(display_error)?;
    let directory = executable
        .parent()
        .ok_or_else(|| "Desktop executable path has no parent directory.".to_string())?;
    let file_name = if cfg!(target_os = "windows") {
        "bunkobank-server.exe"
    } else {
        "bunkobank-server"
    };

    Ok(directory.join(file_name))
}

/// Returns the frontend platform identifier used by the TypeScript runtime.
const fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// Converts a native path into a stable frontend string.
fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Converts any displayable native error into the Tauri command error type.
fn display_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(target_os = "macos")]
/// Resolves the fixed per-user LaunchAgent path.
fn resolve_launch_agent_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .home_dir()
        .map(|home| {
            home.join("Library")
                .join("LaunchAgents")
                .join(format!("{LAUNCH_AGENT_LABEL}.plist"))
        })
        .map_err(display_error)
}

#[cfg(target_os = "macos")]
/// Creates the only LaunchAgent plist accepted by the native command.
fn create_expected_launch_agent_plist(app: &AppHandle) -> Result<String, String> {
    let sidecar_path = display_path(&resolve_bundled_sidecar_path()?);
    let config_path = display_path(
        &app.path()
            .app_config_dir()
            .map_err(display_error)?
            .join(SERVER_CONFIG_FILE),
    );
    let log_dir = app.path().app_log_dir().map_err(display_error)?;

    Ok(create_launch_agent_plist(
        &sidecar_path,
        &config_path,
        &display_path(&log_dir),
    ))
}

#[cfg(target_os = "macos")]
/// Serializes the fixed Bunkobank LaunchAgent using the frontend line format.
fn create_launch_agent_plist(sidecar_path: &str, config_path: &str, log_dir: &str) -> String {
    let sidecar_path = escape_plist_xml(sidecar_path);
    let config_path = escape_plist_xml(config_path);
    let standard_out_path = escape_plist_xml(&format!("{log_dir}/server.out.log"));
    let standard_error_path = escape_plist_xml(&format!("{log_dir}/server.err.log"));

    [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>".to_string(),
        "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">".to_string(),
        "<plist version=\"1.0\">".to_string(),
        "<dict>".to_string(),
        "  <key>Label</key>".to_string(),
        format!("  <string>{LAUNCH_AGENT_LABEL}</string>"),
        "  <key>ProgramArguments</key>".to_string(),
        "  <array>".to_string(),
        format!("    <string>{sidecar_path}</string>"),
        "  </array>".to_string(),
        "  <key>RunAtLoad</key>".to_string(),
        "  <true/>".to_string(),
        "  <key>KeepAlive</key>".to_string(),
        "  <true/>".to_string(),
        "  <key>StandardOutPath</key>".to_string(),
        format!("  <string>{standard_out_path}</string>"),
        "  <key>StandardErrorPath</key>".to_string(),
        format!("  <string>{standard_error_path}</string>"),
        "  <key>EnvironmentVariables</key>".to_string(),
        "  <dict>".to_string(),
        "    <key>BUNKOBANK_CONFIG</key>".to_string(),
        format!("    <string>{config_path}</string>"),
        "  </dict>".to_string(),
        "</dict>".to_string(),
        "</plist>".to_string(),
        String::new(),
    ]
    .join("\n")
}

#[cfg(target_os = "macos")]
/// Rejects any LaunchAgent payload that differs from the fixed native model.
fn validate_launch_agent_plist(plist: &str, expected: &str) -> Result<(), String> {
    if plist != expected {
        return Err("LaunchAgent plist did not match the fixed Bunkobank service.".to_string());
    }

    Ok(())
}

#[cfg(target_os = "macos")]
/// Escapes a native path for use in a plist XML string node.
fn escape_plist_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(target_os = "macos")]
/// Returns the per-user launchd domain for the current process owner.
fn launch_agent_domain() -> Result<String, String> {
    let output = Command::new("id")
        .arg("-u")
        .output()
        .map_err(display_error)?;

    if !output.status.success() {
        return Err("Unable to determine the current macOS user id.".to_string());
    }

    let uid = String::from_utf8(output.stdout)
        .map_err(display_error)?
        .trim()
        .to_string();

    if uid.is_empty() || !uid.chars().all(|character| character.is_ascii_digit()) {
        return Err("macOS user id was not numeric.".to_string());
    }

    Ok(format!("gui/{uid}"))
}

#[cfg(target_os = "macos")]
/// Runs launchctl and surfaces stderr when the operation fails.
fn run_launchctl(arguments: &[&str]) -> Result<(), String> {
    let output = Command::new("launchctl")
        .args(arguments)
        .output()
        .map_err(display_error)?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("launchctl {} failed.", arguments.join(" "))
    } else {
        stderr
    })
}

#[cfg(target_os = "macos")]
/// Returns whether launchd currently has the fixed service registered.
fn is_launch_agent_loaded(service_target: &str) -> Result<bool, String> {
    let output = Command::new("launchctl")
        .args(["print", service_target])
        .output()
        .map_err(display_error)?;

    interpret_launch_agent_lookup(
        output.status.success(),
        output.status.code(),
        &String::from_utf8_lossy(&output.stderr),
    )
}

#[cfg(target_os = "macos")]
/// Distinguishes an absent launchd service from an operational lookup failure.
fn interpret_launch_agent_lookup(
    success: bool,
    exit_code: Option<i32>,
    stderr: &str,
) -> Result<bool, String> {
    if success {
        return Ok(true);
    }

    if exit_code == Some(113) {
        return Ok(false);
    }

    let message = stderr.trim();
    Err(if message.is_empty() {
        "Unable to inspect the Bunkobank LaunchAgent.".to_string()
    } else {
        message.to_string()
    })
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{
        create_launch_agent_plist, interpret_launch_agent_lookup, validate_launch_agent_plist,
    };

    #[test]
    fn validates_the_fixed_bunkobank_launch_agent_contract() {
        let expected = create_launch_agent_plist(
            "/Applications/Book&Cafe.app/Contents/MacOS/bunkobank-server",
            "/Users/alice/Library/Application Support/Bunkobank/config.json",
            "/Users/alice/Library/Logs/Bunkobank",
        );

        assert!(validate_launch_agent_plist(&expected, &expected).is_ok());
        assert!(validate_launch_agent_plist(
            &expected.replace(
                "/Applications/Book&amp;Cafe.app/Contents/MacOS/bunkobank-server",
                "/bin/sh"
            ),
            &expected
        )
        .is_err());
        assert!(expected.contains("/Applications/Book&amp;Cafe.app"));

        assert_eq!(interpret_launch_agent_lookup(true, Some(0), ""), Ok(true));
        assert_eq!(
            interpret_launch_agent_lookup(false, Some(113), "Could not find service"),
            Ok(false)
        );
        assert_eq!(
            interpret_launch_agent_lookup(false, Some(1), "Permission denied"),
            Err("Permission denied".to_string())
        );
    }
}
