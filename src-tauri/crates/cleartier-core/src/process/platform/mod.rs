#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

pub struct OwnerGuard(tokio::task::JoinHandle<()>);

impl Drop for OwnerGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}
