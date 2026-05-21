fn main() {
    install_panic_logger();
    log_stage("main: enter");
    usmcc_publicity_helper_lib::run();
    log_stage("main: returned cleanly");
}

fn install_panic_logger() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!(
            "PANIC at {:?}\n{}\nbacktrace:\n{}\n",
            info.location(),
            info,
            std::backtrace::Backtrace::force_capture()
        );
        let _ = std::fs::write(log_path("usmcc-publicity-helper-panic.log"), &msg);
        eprintln!("{msg}");
        default_hook(info);
    }));
}

fn log_path(name: &str) -> std::path::PathBuf {
    let mut path = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
    path.push("Library/Logs");
    let _ = std::fs::create_dir_all(&path);
    path.push(name);
    path
}

pub fn log_stage(stage: &str) {
    eprintln!("[usmcc-stage] {stage}");
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path("usmcc-publicity-helper-stages.log"))
    {
        let _ = writeln!(f, "[usmcc-stage] {stage}");
    }
}
