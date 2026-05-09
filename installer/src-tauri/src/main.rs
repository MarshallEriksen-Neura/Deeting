// Prevents additional console window on Windows (both debug and release), DO NOT REMOVE!!
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    installer_lib::run()
}
