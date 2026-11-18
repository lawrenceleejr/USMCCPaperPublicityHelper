//! The app window: a system WebView (WKWebView on macOS) pointed at the
//! embedded local server, plus a native folder dialog and window control.

use crate::server;
use serde_json::json;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

pub fn run() {
    let srv = server::App::new("tauri");

    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_menu).on_menu_event(|app, event| {
        // the app's own items: run the same command the keyboard runs
        let id = event.id().as_ref().to_string();
        if let Some(cmd) = id.strip_prefix("cmd:") {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval(&format!("window.usmccCommand && window.usmccCommand({:?})", cmd));
            }
        }
    });

    builder
        .setup(move |app| {
            let h = app.handle().clone();
            let _ = srv.picker.set(Box::new(move |prompt, default| {
                let mut d = h.dialog().file().set_title(prompt);
                if let Some(p) = default {
                    d = d.set_directory(p);
                }
                d.blocking_pick_folder().and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().to_string())
            }));
            let h = app.handle().clone();
            let _ = srv.window.set(Box::new(move |cmd, body| {
                let Some(w) = h.get_webview_window("main") else { return json!({}) };
                match cmd {
                    "fullscreen" => {
                        let on = body.get("on").and_then(|v| v.as_bool()).unwrap_or(false);
                        let _ = w.set_fullscreen(on);
                        json!({ "fullscreen": on })
                    }
                    _ => json!({ "fullscreen": w.is_fullscreen().unwrap_or(false) }),
                }
            }));

            let port = server::start(srv.clone(), 0)?;
            let url = format!("http://127.0.0.1:{}/?shell=tauri", port);
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .title("USMCC Publicity Helper")
                .inner_size(1440.0, 900.0)
                .min_inner_size(380.0, 600.0)
                .background_color(tauri::window::Color(13, 13, 12, 255));
            #[cfg(target_os = "macos")]
            let builder = builder.title_bar_style(tauri::TitleBarStyle::Transparent).hidden_title(true);
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while starting USMCC Publicity Helper");
}

// The menu bar mirrors the in-app Menu: every tool, grouped. Items carry no
// key equivalents, so keys (⌘Z, ⌘⌫, ⌘D, letters) still reach the page, where
// the same shortcuts are handled; Undo/Redo are left out for that reason.
#[cfg(target_os = "macos")]
fn build_menu<R: tauri::Runtime>(h: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let item = |id: &str, label: &str| MenuItem::with_id(h, format!("cmd:{}", id), label, true, None::<&str>);
    Menu::with_items(
        h,
        &[
            &Submenu::with_items(
                h,
                "USMCC Publicity Helper",
                true,
                &[&P::about(h, None, None)?, &P::separator(h)?, &P::hide(h, None)?, &P::hide_others(h, None)?, &P::separator(h)?, &P::quit(h, None)?],
            )?,
            &Submenu::with_items(
                h,
                "File",
                true,
                &[
                    &item("new", "New Carousel")?,
                    &item("open", "Carousels…   O")?,
                    &P::separator(h)?,
                    &item("add", "Add Photos, PDFs, Plots…   A")?,
                    &item("paper", "Paper…   P")?,
                    &item("posts", "Write Posts…   W")?,
                    &P::separator(h)?,
                    &item("export", "Export Slides…   E")?,
                ],
            )?,
            &Submenu::with_items(
                h,
                "Edit",
                true,
                &[
                    &P::cut(h, None)?,
                    &P::copy(h, None)?,
                    &P::paste(h, None)?,
                    &P::select_all(h, None)?,
                    &P::separator(h)?,
                    &item("duplicate", "Duplicate Layer   ⌘D")?,
                    &item("delete", "Delete Layer   ⌫")?,
                ],
            )?,
            &Submenu::with_items(
                h,
                "Slide",
                true,
                &[
                    &item("newslide", "New Slide   N")?,
                    &item("dupslide", "Duplicate Slide   D")?,
                    &item("delslide", "Delete Slide   ⌘⌫")?,
                    &P::separator(h)?,
                    &item("prev", "Previous Slide   [")?,
                    &item("next", "Next Slide   ]")?,
                    &P::separator(h)?,
                    &item("size", "Slide Size   S")?,
                    &item("theme", "Theme…   Y")?,
                ],
            )?,
            &Submenu::with_items(
                h,
                "Layer",
                true,
                &[
                    &item("text", "Add Text   T")?,
                    &item("logo", "Add Logo   L")?,
                    &P::separator(h)?,
                    &item("crop", "Crop Image   C")?,
                    &item("fill", "Fill / Fit   B")?,
                    &item("rotate", "Rotate 90°   R")?,
                    &item("spread", "Use as Background   X")?,
                    &item("background", "Add a Background Picture…   K")?,
                    &item("soften", "Soften Background (Blur, Darken)   U")?,
                    &P::separator(h)?,
                    &item("backward", "Send Backward   ,")?,
                    &item("forward", "Bring Forward   .")?,
                ],
            )?,
            &Submenu::with_items(h, "View", true, &[&item("preview", "Preview the Carousel   V")?,
                    &item("guides", "Guides   G")?, &item("fullscreen", "Full Screen   F")?])?,
            &Submenu::with_items(h, "Window", true, &[&P::minimize(h, None)?, &P::close_window(h, None)?])?,
            &Submenu::with_items(h, "Help", true, &[&item("keys", "Keyboard Shortcuts   ?")?])?,
        ],
    )
}
