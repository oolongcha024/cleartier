use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use uuid::Uuid;

use super::{CoreError, ErrorCode, Result};
use crate::InstanceSnapshot;

pub const PROTOCOL: u32 = 1;
pub const MAX_FRAME: usize = 1024 * 1024;

pub trait LocalIo: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> LocalIo for T {}
pub type Connection = Box<dyn LocalIo>;

#[derive(Debug, Serialize, Deserialize)]
pub struct Hello {
    pub protocol: u32,
    pub pid: u32,
    pub version: String,
    pub elevated: bool,
}

#[derive(Serialize, Deserialize)]
pub struct Request {
    pub id: u64,
    pub command: Command,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    Start { toml: String },
    Stop { id: Uuid },
    Snapshot,
    Shutdown,
}

#[derive(Serialize, Deserialize)]
pub struct Response {
    pub id: u64,
    pub result: Result<Data>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum Data {
    Started(Uuid),
    Snapshot(Vec<InstanceSnapshot>),
    Done,
}

pub async fn read<T: DeserializeOwned>(io: &mut (impl AsyncRead + Unpin + ?Sized)) -> Result<T> {
    let size = io.read_u32_le().await? as usize;
    if size == 0 || size > MAX_FRAME {
        return Err(CoreError::new(
            ErrorCode::ProtocolError,
            "Invalid local message size",
        ));
    }
    let mut bytes = vec![0; size];
    io.read_exact(&mut bytes).await?;
    serde_json::from_slice(&bytes)
        .map_err(|_| CoreError::new(ErrorCode::ProtocolError, "Invalid local message"))
}

pub async fn write<T: Serialize>(
    io: &mut (impl AsyncWrite + Unpin + ?Sized),
    value: &T,
) -> Result<()> {
    let bytes = serde_json::to_vec(value)
        .map_err(|_| CoreError::new(ErrorCode::ProtocolError, "Cannot encode local message"))?;
    if bytes.len() > MAX_FRAME {
        return Err(CoreError::new(
            ErrorCode::ProtocolError,
            "Local message is too large",
        ));
    }
    io.write_u32_le(bytes.len() as u32).await?;
    io.write_all(&bytes).await?;
    io.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_oversized_frame_before_reading_payload() {
        let mut bytes = (MAX_FRAME as u32 + 1).to_le_bytes().as_slice().to_vec();
        assert_eq!(
            read::<Hello>(&mut bytes.as_slice()).await.unwrap_err().code,
            ErrorCode::ProtocolError
        );
        bytes.clear();
    }
}
