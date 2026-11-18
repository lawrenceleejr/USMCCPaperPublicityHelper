// USMCC Publicity Helper: carousels and posts for a paper.
//
//   usmcc                      open the app window (default build)
//   usmcc --serve              terminal mode: serve the UI and open a browser
//        [--port 4880] [--no-open]
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod paper;
mod server;
#[cfg(feature = "gui")]
mod gui;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!(
            "usmcc — USMCC Publicity Helper: paper carousels and posts\n\n\
             usage: usmcc [--serve] [--port 4880] [--no-open]\n\n  \
             --serve    run in the terminal and use the app in your browser\n  \
             --port     port to listen on (default 4880; 0 picks a free one)\n  \
             --no-open  don't open a browser window\n\n\
             Carousels are kept in ~/.usmcc (or $USMCC_HOME)."
        );
        return;
    }
    let serve = args.iter().any(|a| a == "--serve") || !cfg!(feature = "gui");
    if serve {
        serve_mode(&args);
    } else {
        #[cfg(feature = "gui")]
        gui::run();
    }
}

fn serve_mode(args: &[String]) {
    let port = args
        .iter()
        .position(|a| a == "--port")
        .and_then(|i| args.get(i + 1))
        .and_then(|p| p.parse().ok())
        .unwrap_or(4880u16);
    let app = server::App::new("browser");
    let port = server::start(app, port).expect("could not start server");
    let url = format!("http://127.0.0.1:{}/", port);
    println!("\n  usmcc  →  {}\n  ctrl-c to quit\n", url);
    if !args.iter().any(|a| a == "--no-open") {
        server::open_path(&url);
    }
    loop {
        std::thread::park();
    }
}
