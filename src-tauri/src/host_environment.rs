#[cfg(unix)]
fn hostname() -> Result<String, String> {
    unsafe extern "C" {
        fn gethostname(name: *mut std::ffi::c_char, len: usize) -> std::ffi::c_int;
    }
    let mut buffer = [0u8; 1024];
    // The buffer remains writable for the full call and has ample room for
    // Linux/macOS hostnames. Never read beyond its first NUL terminator.
    if unsafe { gethostname(buffer.as_mut_ptr().cast(), buffer.len()) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let length = buffer
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(buffer.len());
    Ok(String::from_utf8_lossy(&buffer[..length]).into_owned())
}

#[cfg(target_os = "windows")]
fn hostname() -> Result<String, String> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetComputerNameW(buffer: *mut u16, size: *mut u32) -> i32;
    }
    let mut buffer = [0u16; 256];
    let mut length = buffer.len() as u32;
    // GetComputerNameW writes at most the supplied capacity and reports the
    // number of UTF-16 code units excluding the terminator on success.
    if unsafe { GetComputerNameW(buffer.as_mut_ptr(), &mut length) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(String::from_utf16_lossy(&buffer[..length as usize]))
}

pub fn read() -> Result<(String, String), String> {
    let hostname = hostname()?.trim().to_owned();
    if hostname.is_empty() {
        return Err("Hostname is empty".to_owned());
    }
    Ok((hostname, std::env::consts::OS.to_owned()))
}
