use tauri_plugin_dialog::DialogExt;

#[tauri::command]
fn save_text_file_with_dialog(
    app: tauri::AppHandle,
    filename: String,
    contents: String,
) -> Result<String, String> {
    let file_path = app
        .dialog()
        .file()
        .set_file_name(&filename)
        .add_filter("CSV", &["csv"])
        .blocking_save_file();

    match file_path {
        None => Ok("cancelled".to_string()),
        Some(fp) => {
            let path = fp
                .into_path()
                .map_err(|_| "Dialog returned an unsupported path type".to_string())?;
            std::fs::write(&path, contents).map_err(|e| e.to_string())?;
            Ok("saved".to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_text_file_with_dialog])
        .run(tauri::generate_context!())
        .expect("error while running Vectair Flite");
}
