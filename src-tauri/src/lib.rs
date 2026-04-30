use tauri_plugin_dialog::DialogExt;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_text_file_with_dialog,
            save_binary_file_with_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vectair Flite");
}
