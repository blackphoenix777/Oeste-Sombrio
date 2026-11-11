use std::fs;
use std::path::PathBuf;
use serde::{Serialize, Deserialize};
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
pub struct CharacterMeta {
  name: String,
  filename: String,
  last_modified: String,
}

fn get_characters_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let mut path = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;
  path.push("characters");
  if !path.exists() {
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
  }
  Ok(path)
}

#[tauri::command]
fn list_characters(app: AppHandle) -> Result<Vec<CharacterMeta>, String> {
  let dir = get_characters_dir(&app)?;
  let mut list = Vec::new();

  let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
  for entry in entries {
    if let Ok(entry) = entry {
      let path = entry.path();
      if path.is_file() && path.extension().map_or(false, |ext| ext == "json") {
        let filename = path.file_name().unwrap().to_string_lossy().to_string();
        if filename == "itens_criados.json" || filename == "magias_criadas.json" { continue; }
        let name = filename.replace(".json", "").replace("_", " ");
        
        let metadata = fs::metadata(&path);
        let last_modified = if let Ok(meta) = metadata {
          if let Ok(modified) = meta.modified() {
            if let Ok(duration) = modified.duration_since(SystemTime::UNIX_EPOCH) {
              duration.as_secs().to_string()
            } else {
              "0".to_string()
            }
          } else {
            "0".to_string()
          }
        } else {
          "0".to_string()
        };

        list.push(CharacterMeta {
          name,
          filename,
          last_modified,
        });
      }
    }
  }
  
  list.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
  Ok(list)
}

#[tauri::command]
fn load_character(app: AppHandle, filename: String) -> Result<String, String> {
  let mut path = get_characters_dir(&app)?;
  path.push(&filename);
  fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_character(app: AppHandle, filename: String, data: String) -> Result<(), String> {
  let mut path = get_characters_dir(&app)?;
  path.push(&filename);
  fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_character(app: AppHandle, filename: String) -> Result<(), String> {
  let mut path = get_characters_dir(&app)?;
  path.push(&filename);
  if path.exists() {
    fs::remove_file(path).map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      list_characters,
      load_character,
      save_character,
      delete_character
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
