//! Private compositor fixture; never uses an inherited display.

#[cfg(target_os = "linux")]
#[path = "native-view.rs"]
mod native_view;

#[cfg(target_os = "linux")]
fn main() -> anyhow::Result<()> {
    native_view::run()
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("This fixture requires a new owned Wayland compositor on Linux");
}
