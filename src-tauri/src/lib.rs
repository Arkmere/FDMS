use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;
use serde_json::{json, Value};
use std::sync::Mutex;

// ── Updater state ────────────────────────────────────────────────────────────

struct UpdaterState {
    pending_update: Mutex<Option<tauri_plugin_updater::Update>>,
}

// ── Timestamp helper (no external time dependency needed) ────────────────────

fn unix_secs_to_iso8601(secs: u64) -> String {
    let days = secs / 86400;
    let secs_today = secs % 86400;
    let hour = secs_today / 3600;
    let min = (secs_today % 3600) / 60;
    let sec = secs_today % 60;

    let mut year = 1970u64;
    let mut rem = days;
    loop {
        let in_year = if is_leap(year) { 366 } else { 365 };
        if rem < in_year { break; }
        rem -= in_year;
        year += 1;
    }

    let month_days: [u64; 12] = if is_leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1u64;
    for &md in &month_days {
        if rem < md { break; }
        rem -= md;
        month += 1;
    }
    let day = rem + 1;

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, month, day, hour, min, sec)
}

fn is_leap(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn now_iso8601() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    unix_secs_to_iso8601(secs)
}

// ── File dialog commands ─────────────────────────────────────────────────────

#[tauri::command]
async fn save_text_file_with_dialog(
    app: tauri::AppHandle,
    filename: String,
    contents: String,
) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<std::path::PathBuf>>();

    app.dialog()
        .file()
        .set_file_name(&filename)
        .add_filter("CSV", &["csv"])
        .save_file(move |file_path| {
            let path = file_path.and_then(|fp| fp.into_path().ok());
            let _ = tx.send(path);
        });

    let path = rx.await.map_err(|e| e.to_string())?;

    match path {
        None => Ok("cancelled".to_string()),
        Some(p) => {
            std::fs::write(&p, contents).map_err(|e| e.to_string())?;
            Ok("saved".to_string())
        }
    }
}

#[tauri::command]
async fn save_binary_file_with_dialog(
    app: tauri::AppHandle,
    filename: String,
    contents_base64: String,
) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&contents_base64)
        .map_err(|e| e.to_string())?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Option<std::path::PathBuf>>();

    app.dialog()
        .file()
        .set_file_name(&filename)
        .add_filter("Excel Workbook", &["xlsx"])
        .save_file(move |file_path| {
            let path = file_path.and_then(|fp| fp.into_path().ok());
            let _ = tx.send(path);
        });

    let path = rx.await.map_err(|e| e.to_string())?;

    match path {
        None => Ok("cancelled".to_string()),
        Some(p) => {
            std::fs::write(&p, &bytes).map_err(|e| e.to_string())?;
            Ok("saved".to_string())
        }
    }
}

// ── Updater commands ─────────────────────────────────────────────────────────

#[tauri::command]
async fn flite_get_app_version(app: tauri::AppHandle) -> Value {
    let version = app.package_info().version.to_string();
    json!({
        "version": version,
        "buildSource": "unknown"
    })
}

#[tauri::command]
async fn flite_check_for_update(
    app: tauri::AppHandle,
    updater_state: State<'_, UpdaterState>,
) -> Result<Value, String> {
    let current_version = app.package_info().version.to_string();
    let last_checked = now_iso8601();

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            return Ok(json!({
                "status": "error",
                "currentVersion": current_version,
                "lastChecked": last_checked,
                "message": e.to_string()
            }));
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let available_version = update.version.clone();
            let date = update.date
                .map(|d| d.to_string())
                .unwrap_or_default();
            let body = update.body.clone().unwrap_or_default();

            let mut pending = updater_state.pending_update.lock().unwrap();
            *pending = Some(update);

            Ok(json!({
                "status": "update_available",
                "currentVersion": current_version,
                "availableVersion": available_version,
                "date": date,
                "body": body,
                "lastChecked": last_checked
            }))
        }
        Ok(None) => {
            let mut pending = updater_state.pending_update.lock().unwrap();
            *pending = None;
            Ok(json!({
                "status": "up_to_date",
                "currentVersion": current_version,
                "lastChecked": last_checked
            }))
        }
        Err(e) => {
            let msg = e.to_string();
            let msg_lower = msg.to_lowercase();
            let status = if msg_lower.contains("connect")
                || msg_lower.contains("network")
                || msg_lower.contains("timeout")
                || msg_lower.contains("dns")
                || msg_lower.contains("unreachable")
                || msg_lower.contains("offline")
                || msg_lower.contains("refused")
            {
                "offline"
            } else {
                "error"
            };
            Ok(json!({
                "status": status,
                "currentVersion": current_version,
                "lastChecked": last_checked,
                "message": msg
            }))
        }
    }
}

#[tauri::command]
async fn flite_download_and_install_update(
    updater_state: State<'_, UpdaterState>,
) -> Result<Value, String> {
    let update = {
        let mut pending = updater_state.pending_update.lock().unwrap();
        pending.take()
    };

    match update {
        None => Ok(json!({
            "status": "error",
            "message": "No pending update. Run Check for Updates first."
        })),
        Some(update) => {
            match update.download_and_install(|_chunk, _total| {}, || {}).await {
                Ok(()) => Ok(json!({
                    "status": "installed_restart_required",
                    "message": "Update installed. Restart Flite to apply."
                })),
                Err(e) => Ok(json!({
                    "status": "error",
                    "message": e.to_string()
                })),
            }
        }
    }
}

#[tauri::command]
fn flite_restart_app(app: tauri::AppHandle) {
    app.restart();
}

// ── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(UpdaterState {
            pending_update: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            save_text_file_with_dialog,
            save_binary_file_with_dialog,
            flite_get_app_version,
            flite_check_for_update,
            flite_download_and_install_update,
            flite_restart_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vectair Flite");
}
