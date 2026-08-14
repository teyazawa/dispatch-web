// Phase3 (Tauri): cross-window D&D 基盤
//   - get_cursor_pos: OS グローバル座標のカーソル位置
//   - get_window_bounds: 全 Tauri window の (label, x, y, width, height, focused)
//   - start_drag_session: マウスボタンリリースまで 16ms 間隔で cursor & button 状態を全窓にブロードキャスト

use tauri::{command, AppHandle, Emitter, Manager};

#[derive(serde::Serialize, Clone)]
struct WindowBounds {
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    focused: bool,
}

#[command]
fn get_cursor_pos() -> Result<(i32, i32), String> {
    use mouse_position::mouse_position::Mouse;
    match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => Ok((x, y)),
        Mouse::Error => Err("failed to get cursor position".to_string()),
    }
}

#[command]
fn get_window_bounds(app: AppHandle) -> Result<Vec<WindowBounds>, String> {
    let mut result = vec![];
    for (label, w) in app.webview_windows() {
        let pos = w.outer_position().map_err(|e| e.to_string())?;
        let size = w.outer_size().map_err(|e| e.to_string())?;
        result.push(WindowBounds {
            label,
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
            focused: w.is_focused().unwrap_or(false),
        });
    }
    Ok(result)
}

// drag session: フロントで drag 開始時に呼び出す。
//   payload には dnd-kit の drag data (item id/type 等) をそのまま渡す。
//   全 window に xdrag-start / xdrag-move (16ms間隔) / xdrag-end を発火。
//   マウスボタンリリース検知で自動終了。
#[command]
async fn start_drag_session(
    webview: tauri::WebviewWindow,
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<(), String> {
    use device_query::{DeviceQuery, DeviceState};
    use mouse_position::mouse_position::Mouse;

    // 呼び出し元 window の label を xdrag-start payload に注入 (受信側 window で source 判定に使う)
    let source_label = webview.label().to_string();
    let mut start_payload = payload.clone();
    if let serde_json::Value::Object(ref mut m) = start_payload {
        m.insert(
            "sourceLabel".into(),
            serde_json::Value::String(source_label),
        );
    }
    app.emit("xdrag-start", &start_payload)
        .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        let device_state = DeviceState::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(16)).await;

            let (cx, cy) = match Mouse::get_mouse_position() {
                Mouse::Position { x, y } => (x, y),
                Mouse::Error => break,
            };

            let mouse_state = device_state.get_mouse();
            // device_query の button_pressed は index 1 が左ボタン
            let left_pressed = *mouse_state.button_pressed.get(1).unwrap_or(&false);

            let _ = app.emit(
                "xdrag-move",
                serde_json::json!({
                    "x": cx,
                    "y": cy,
                    "pressed": left_pressed,
                }),
            );

            if !left_pressed {
                let _ = app.emit(
                    "xdrag-end",
                    serde_json::json!({
                        "x": cx,
                        "y": cy,
                    }),
                );
                break;
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            get_cursor_pos,
            get_window_bounds,
            start_drag_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
