use std::{
    ffi::{OsStr, c_void},
    fs::{File, OpenOptions},
    io::Read,
    os::windows::{
        ffi::OsStrExt,
        fs::OpenOptionsExt,
        io::{AsHandle, AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::Path,
    ptr::{null, null_mut},
};

use sha2::{Digest, Sha256};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions};
use windows_sys::Win32::{
    Foundation::{ERROR_CANCELLED, HANDLE, LocalFree, STILL_ACTIVE},
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            SDDL_REVISION_1,
        },
        GetTokenInformation, SECURITY_ATTRIBUTES, TOKEN_ELEVATION, TOKEN_QUERY, TOKEN_USER,
        TokenElevation, TokenUser,
    },
    Storage::FileSystem::{FILE_SHARE_READ, SECURITY_IDENTIFICATION},
    System::{
        Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize},
        Pipes::{GetNamedPipeClientProcessId, GetNamedPipeServerProcessId},
        Threading::{
            CREATE_NO_WINDOW, GetCurrentProcess, GetExitCodeProcess, GetProcessId, OpenProcess,
            OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
            TerminateProcess,
        },
    },
    UI::{
        Shell::{
            SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
            ShellExecuteExW,
        },
        WindowsAndMessaging::SW_HIDE,
    },
};

use super::OwnerGuard;
use crate::process::{CoreError, ErrorCode, Result, wire::Connection};

fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}
fn last_error() -> CoreError {
    std::io::Error::last_os_error().into()
}

struct LocalMemory(*mut c_void);
impl Drop for LocalMemory {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}

fn token() -> Result<OwnedHandle> {
    let mut handle = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle) } == 0 {
        return Err(last_error());
    }
    // The successful call transfers a real, uniquely owned token handle.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn current_sid() -> Result<String> {
    let token = token()?;
    let mut size = 0;
    unsafe {
        GetTokenInformation(token.as_raw_handle(), TokenUser, null_mut(), 0, &mut size);
    }
    let mut storage = vec![0u64; (size as usize).div_ceil(8)];
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            storage.as_mut_ptr().cast(),
            size,
            &mut size,
        )
    } == 0
    {
        return Err(last_error());
    }
    let user = unsafe { &*storage.as_ptr().cast::<TOKEN_USER>() };
    let mut text = null_mut();
    if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) } == 0 {
        return Err(last_error());
    }
    let _memory = LocalMemory(text.cast());
    let mut len = 0;
    while unsafe { *text.add(len) } != 0 {
        len += 1;
    }
    Ok(String::from_utf16_lossy(unsafe {
        std::slice::from_raw_parts(text, len)
    }))
}

pub fn elevated() -> Result<bool> {
    let token = token()?;
    let mut result: TOKEN_ELEVATION = unsafe { std::mem::zeroed() };
    let mut size = 0;
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenElevation,
            (&mut result as *mut TOKEN_ELEVATION).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        )
    } == 0
    {
        return Err(last_error());
    }
    Ok(result.TokenIsElevated != 0)
}

pub struct Listener {
    pipe: Option<NamedPipeServer>,
    name: String,
}

impl Listener {
    pub fn create(_directory: &Path) -> Result<Self> {
        // Protected DACL: this user, administrators (including alternate UAC credentials), SYSTEM.
        let sddl = wide(format!(
            "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;{})",
            current_sid()?
        ));
        let mut descriptor = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(last_error());
        }
        let _memory = LocalMemory(descriptor);
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let name = format!(r"\\.\pipe\ClearTier-{}", uuid::Uuid::new_v4());
        // Only this first local instance can bind; remote pipe clients are rejected by the OS.
        let pipe = unsafe {
            ServerOptions::new()
                .first_pipe_instance(true)
                .reject_remote_clients(true)
                .max_instances(1)
                .create_with_security_attributes_raw(
                    &name,
                    (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
                )
        }?;
        Ok(Self {
            pipe: Some(pipe),
            name,
        })
    }

    pub fn endpoint(&self) -> String {
        self.name.clone()
    }

    pub async fn accept(&mut self, expected_pid: u32) -> Result<Connection> {
        let pipe = self.pipe.as_ref().unwrap();
        loop {
            pipe.connect().await?;
            let mut pid = 0;
            if unsafe { GetNamedPipeClientProcessId(pipe.as_raw_handle(), &mut pid) } != 0
                && pid == expected_pid
            {
                return Ok(Box::new(self.pipe.take().unwrap()));
            }
            pipe.disconnect()?;
        }
    }
}

pub struct Process {
    handle: OwnedHandle,
    pid: u32,
}

impl Process {
    pub fn pid(&self) -> u32 {
        self.pid
    }
    pub fn exited(&mut self) -> Result<bool> {
        exited(self.handle.as_raw_handle())
    }
    pub fn terminate(&mut self) -> Result<()> {
        if unsafe { TerminateProcess(self.handle.as_raw_handle(), 1) } == 0 {
            return Err(last_error());
        }
        Ok(())
    }
}

fn exited(handle: HANDLE) -> Result<bool> {
    let mut code = 0;
    if unsafe { GetExitCodeProcess(handle, &mut code) } == 0 {
        return Err(last_error());
    }
    Ok(code != STILL_ACTIVE as u32)
}

impl Drop for Process {
    fn drop(&mut self) {
        if !exited(self.handle.as_raw_handle()).unwrap_or(true) {
            unsafe {
                TerminateProcess(self.handle.as_raw_handle(), 1);
            }
        }
    }
}

pub async fn spawn(
    executable: &Path,
    endpoint: &str,
    elevate: bool,
    resources: Vec<File>,
) -> Result<(Process, Vec<File>)> {
    let executable = executable.to_owned();
    let endpoint = endpoint.to_owned();
    tokio::task::spawn_blocking(move || {
        if !elevate {
            use std::os::windows::process::CommandExt;
            let child = std::process::Command::new(&executable)
                .args(["--core-host", &endpoint, &std::process::id().to_string()])
                .current_dir(executable.parent().unwrap())
                .creation_flags(CREATE_NO_WINDOW)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|error| CoreError::new(ErrorCode::LaunchFailed, error.to_string()))?;
            return Ok((
                Process {
                    handle: child.as_handle().try_clone_to_owned()?,
                    pid: child.id(),
                },
                resources,
            ));
        }
        let file = wide(&executable);
        let parameters = wide(format!("--core-host {endpoint} {}", std::process::id()));
        let directory = wide(executable.parent().unwrap());
        let verb = wide("runas");
        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = parameters.as_ptr();
        info.lpDirectory = directory.as_ptr();
        info.nShow = SW_HIDE;
        let initialized = unsafe { CoInitializeEx(null(), COINIT_APARTMENTTHREADED as u32) } >= 0;
        let success = unsafe { ShellExecuteExW(&mut info) };
        let error = std::io::Error::last_os_error();
        if initialized {
            unsafe {
                CoUninitialize();
            }
        }
        if success == 0 {
            let code = if error.raw_os_error() == Some(ERROR_CANCELLED as i32) {
                ErrorCode::ElevationCancelled
            } else {
                ErrorCode::LaunchFailed
            };
            return Err(CoreError::new(code, error.to_string()));
        }
        if info.hProcess.is_null() {
            return Err(CoreError::new(
                ErrorCode::LaunchFailed,
                "Windows returned no core process handle",
            ));
        }
        let handle = unsafe { OwnedHandle::from_raw_handle(info.hProcess) };
        let pid = unsafe { GetProcessId(handle.as_raw_handle()) };
        if pid == 0 {
            return Err(last_error());
        }
        Ok((Process { handle, pid }, resources))
    })
    .await
    .map_err(|_| CoreError::new(ErrorCode::LaunchFailed, "Core launch task failed"))?
}

pub async fn connect(endpoint: &str, owner: u32) -> Result<Connection> {
    if !endpoint.starts_with(r"\\.\pipe\ClearTier-") || endpoint.len() > 100 {
        return Err(CoreError::new(
            ErrorCode::IdentityRejected,
            "Invalid local pipe name",
        ));
    }
    // The ordinary server must not be able to impersonate its elevated client.
    let io = ClientOptions::new()
        .security_qos_flags(SECURITY_IDENTIFICATION)
        .open(endpoint)?;
    let mut pid = 0;
    if unsafe { GetNamedPipeServerProcessId(io.as_raw_handle(), &mut pid) } == 0 || pid != owner {
        return Err(CoreError::new(
            ErrorCode::IdentityRejected,
            "Unexpected controller process",
        ));
    }
    Ok(Box::new(io))
}

pub fn guard_owner(owner: u32) -> Result<OwnerGuard> {
    let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, owner) };
    if raw.is_null() {
        return Err(last_error());
    }
    let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut image = vec![0u16; 32768];
    let mut len = image.len() as u32;
    if unsafe {
        QueryFullProcessImageNameW(handle.as_raw_handle(), 0, image.as_mut_ptr(), &mut len)
    } == 0
    {
        return Err(last_error());
    }
    let image = std::path::PathBuf::from(String::from_utf16_lossy(&image[..len as usize]));
    let normalize = |path: &Path| -> Result<String> {
        Ok(std::fs::canonicalize(path)?
            .to_string_lossy()
            .to_lowercase())
    };
    if normalize(&image)? != normalize(&std::env::current_exe()?)? {
        return Err(CoreError::new(
            ErrorCode::IdentityRejected,
            "Controller image does not match",
        ));
    }
    Ok(OwnerGuard(tokio::spawn(async move {
        loop {
            if exited(handle.as_raw_handle()).unwrap_or(true) {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                std::process::exit(0);
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    })))
}

pub fn lock_resources(executable: &Path) -> Result<Vec<File>> {
    // Compile-time manifest, not a potentially replaceable JSON next to the executable.
    #[derive(serde::Deserialize)]
    struct Manifest {
        files: Vec<Resource>,
    }
    #[derive(serde::Deserialize)]
    struct Resource {
        path: String,
        sha256: String,
    }
    let manifest: Manifest = serde_json::from_str(include_str!(
        "../../../../../resources/windows/core-resources.json"
    ))
    .map_err(|_| {
        CoreError::new(
            ErrorCode::ResourceMismatch,
            "Invalid embedded resource manifest",
        )
    })?;
    let directory = executable.parent().ok_or_else(|| {
        CoreError::new(
            ErrorCode::MissingResource,
            "Executable directory is unavailable",
        )
    })?;
    let mut locks = Vec::new();
    locks.push(
        OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(executable)?,
    );
    for resource in manifest.files {
        let mut file = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(directory.join(&resource.path))
            .map_err(|_| {
                CoreError::new(
                    ErrorCode::MissingResource,
                    format!("Missing or inaccessible runtime file: {}", resource.path),
                )
            })?;
        let mut hash = Sha256::new();
        let mut bytes = [0u8; 16384];
        loop {
            let size = file.read(&mut bytes)?;
            if size == 0 {
                break;
            }
            hash.update(&bytes[..size]);
        }
        if format!("{:x}", hash.finalize()) != resource.sha256 {
            return Err(CoreError::new(
                ErrorCode::ResourceMismatch,
                format!("Runtime file does not match this build: {}", resource.path),
            ));
        }
        locks.push(file);
    }
    Ok(locks)
}

pub fn tun_exists(name: &str) -> Result<bool> {
    use windows_sys::Win32::{
        Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_NO_DATA},
        NetworkManagement::IpHelper::GetAdaptersAddresses,
    };
    let mut size = 0;
    let code = unsafe { GetAdaptersAddresses(0, 0, null(), null_mut(), &mut size) };
    if code == ERROR_NO_DATA {
        return Ok(false);
    }
    if code != ERROR_BUFFER_OVERFLOW {
        return Err(CoreError::new(
            ErrorCode::Io,
            format!("Cannot enumerate adapters: {code}"),
        ));
    }
    for _ in 0..3 {
        let mut storage = vec![0u64; (size as usize).div_ceil(8)];
        let head = storage.as_mut_ptr().cast();
        let code = unsafe { GetAdaptersAddresses(0, 0, null(), head, &mut size) };
        if code == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if code == ERROR_NO_DATA {
            return Ok(false);
        }
        if code != 0 {
            return Err(CoreError::new(
                ErrorCode::Io,
                format!("Cannot enumerate adapters: {code}"),
            ));
        }
        let mut current = head;
        while !current.is_null() {
            let adapter = unsafe { &*current };
            if !adapter.FriendlyName.is_null() {
                let mut len = 0;
                while unsafe { *adapter.FriendlyName.add(len) } != 0 {
                    len += 1;
                }
                let actual = String::from_utf16_lossy(unsafe {
                    std::slice::from_raw_parts(adapter.FriendlyName, len)
                });
                if actual.eq_ignore_ascii_case(name) {
                    return Ok(true);
                }
            }
            current = adapter.Next;
        }
        return Ok(false);
    }
    Err(CoreError::new(ErrorCode::Io, "Adapter list kept changing"))
}
