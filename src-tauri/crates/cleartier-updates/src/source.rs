use crate::{Error, Result};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const REPOSITORY: &str = "oolongcha024/cleartier";
pub const MANIFEST_NAME: &str = "latest.json";
pub const UPDATE_INDEX_URL: &str = "https://oolongcha024.github.io/cleartier/updates/updates.json";
const MAX_METADATA_BYTES: usize = 256 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub version: String,
    pub notes: String,
}
impl Candidate {
    pub fn accepted(&self, current: &str, prereleases: bool) -> bool {
        let (Ok(version), Ok(current)) = (Version::parse(&self.version), Version::parse(current))
        else {
            return false;
        };
        version.to_string() == self.version
            && version.build.is_empty()
            && version > current
            && (prereleases || version.pre.is_empty())
    }
    pub fn release_url(&self) -> String {
        format!(
            "https://github.com/{REPOSITORY}/releases/tag/v{}",
            self.version
        )
    }
    pub fn asset_url(&self, name: &str) -> String {
        format!(
            "https://github.com/{REPOSITORY}/releases/download/v{}/{name}",
            self.version
        )
    }
    pub fn manifest_url(&self) -> String {
        self.asset_url(MANIFEST_NAME)
    }
    pub fn zip_url(&self) -> String {
        self.asset_url("cleartier-windows-x64.zip")
    }
    pub fn installer_name(&self) -> String {
        format!("ClearTier_{}_x64-setup.exe", self.version)
    }
    pub fn installer_url(&self) -> String {
        self.asset_url(&self.installer_name())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    schema_version: u32,
    stable: Option<Candidate>,
    preview: Option<Candidate>,
}
pub(crate) fn select_candidate(
    json: &serde_json::Value,
    current: &str,
    prereleases: bool,
) -> Result<Option<Candidate>> {
    let index: Index = serde_json::from_value(json.clone()).map_err(|_| Error::new("metadata"))?;
    if index.schema_version != 1 || json.get("stable").is_none() || json.get("preview").is_none() {
        return Err(Error::new("metadata"));
    }
    let version_of = |candidate: &Candidate| -> Result<Version> {
        let version = Version::parse(&candidate.version).map_err(|_| Error::new("metadata"))?;
        if version.to_string() != candidate.version
            || !version.build.is_empty()
            || candidate.notes.chars().count() > 16384
        {
            return Err(Error::new("metadata"));
        }
        Ok(version)
    };
    let stable = index.stable.as_ref().map(version_of).transpose()?;
    let preview = index.preview.as_ref().map(version_of).transpose()?;
    let consistent = match (&stable, &preview) {
        (None, None) => true,
        (None, Some(preview)) => !preview.pre.is_empty(),
        (Some(stable), Some(preview)) => {
            stable.pre.is_empty()
                && preview >= stable
                && (!preview.pre.is_empty() || preview == stable)
        }
        _ => false,
    };
    if !consistent {
        return Err(Error::new("metadata"));
    }
    let candidate = if prereleases {
        index.preview
    } else {
        index.stable
    };
    Ok(candidate.filter(|candidate| candidate.accepted(current, prereleases)))
}

pub struct UpdateSource {
    client: reqwest::Client,
}
impl UpdateSource {
    pub fn new() -> Result<Self> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .user_agent("ClearTier-updater")
            .https_only(true)
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| Error::new("network"))?;
        Ok(Self { client })
    }
    pub async fn find(&self, current: &str, prereleases: bool) -> Result<Option<Candidate>> {
        self.find_at(UPDATE_INDEX_URL, current, prereleases).await
    }
    async fn find_at(
        &self,
        url: &str,
        current: &str,
        prereleases: bool,
    ) -> Result<Option<Candidate>> {
        select_candidate(&self.json(url, "network").await?, current, prereleases)
    }
    pub async fn manifest(&self, candidate: &Candidate) -> Result<serde_json::Value> {
        let json = self.json(&candidate.manifest_url(), "metadata").await?;
        let platform = &json["platforms"]["windows-x86_64"];
        if json["version"].as_str() != Some(candidate.version.as_str())
            || platform["url"].as_str() != Some(candidate.installer_url().as_str())
            || platform["signature"]
                .as_str()
                .is_none_or(|signature| signature.is_empty() || signature.len() > 16384)
        {
            return Err(Error::new("metadata"));
        }
        Ok(json)
    }
    async fn json(&self, url: &str, rejected: &'static str) -> Result<serde_json::Value> {
        tokio::time::timeout(Duration::from_secs(20), self.fetch_json(url, rejected))
            .await
            .map_err(|_| Error::new("network"))?
    }
    async fn fetch_json(&self, url: &str, rejected: &'static str) -> Result<serde_json::Value> {
        for attempt in 0..3 {
            let response = self
                .client
                .get(url)
                .header("Accept", "application/json")
                .send()
                .await;
            if attempt < 2
                && (response
                    .as_ref()
                    .is_err_and(|error| error.is_timeout() || error.is_connect())
                    || response
                        .as_ref()
                        .is_ok_and(|response| response.status().is_server_error()))
            {
                tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                continue;
            }
            let mut response = response.map_err(|_| Error::new("network"))?;
            let status = response.status();
            let exhausted = response
                .headers()
                .get("x-ratelimit-remaining")
                .is_some_and(|value| value == "0");
            if status.as_u16() == 429 || (status.as_u16() == 403 && exhausted) {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                let retry = response
                    .headers()
                    .get("retry-after")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| {
                        value
                            .parse::<u64>()
                            .ok()
                            .map(|seconds| now.saturating_add(seconds))
                            .or_else(|| {
                                httpdate::parse_http_date(value)
                                    .ok()?
                                    .duration_since(UNIX_EPOCH)
                                    .ok()
                                    .map(|time| time.as_secs())
                            })
                    });
                let reset = exhausted
                    .then(|| {
                        response
                            .headers()
                            .get("x-ratelimit-reset")
                            .and_then(|value| value.to_str().ok())
                            .and_then(|value| value.parse::<u64>().ok())
                    })
                    .flatten();
                return Err(Error {
                    code: "rateLimited",
                    retry_at: Some(retry.or(reset).unwrap_or(now + 60).max(now + 60)),
                });
            }
            if matches!(status.as_u16(), 401 | 403) {
                return Err(Error::new("access"));
            }
            if !status.is_success() {
                return Err(Error::new(rejected));
            }
            if response
                .content_length()
                .is_some_and(|size| size > MAX_METADATA_BYTES as u64)
            {
                return Err(Error::new("metadata"));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| Error::new("network"))? {
                if bytes.len() + chunk.len() > MAX_METADATA_BYTES {
                    return Err(Error::new("metadata"));
                }
                bytes.extend_from_slice(&chunk);
            }
            return serde_json::from_slice(&bytes).map_err(|_| Error::new("metadata"));
        }
        Err(Error::new("network"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{
            Arc,
            atomic::{AtomicBool, AtomicUsize, Ordering},
        },
        thread,
    };

    const INDEX: &str =
        r#"{"schemaVersion":1,"stable":null,"preview":{"version":"0.2.0-rc.1","notes":"notes"}}"#;

    struct Server {
        url: String,
        requests: Arc<AtomicUsize>,
        stop: Arc<AtomicBool>,
        thread: Option<thread::JoinHandle<()>>,
    }
    impl Server {
        fn new(responses: Vec<String>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let url = format!(
                "http://{}/updates/updates.json",
                listener.local_addr().unwrap()
            );
            let requests = Arc::new(AtomicUsize::new(0));
            let stop = Arc::new(AtomicBool::new(false));
            let (count, stopped) = (requests.clone(), stop.clone());
            let thread = thread::spawn(move || {
                for response in responses {
                    let (mut stream, _) = loop {
                        if stopped.load(Ordering::SeqCst) {
                            return;
                        }
                        match listener.accept() {
                            Ok(connection) => break connection,
                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                                thread::sleep(Duration::from_millis(1))
                            }
                            Err(error) => panic!("{error}"),
                        }
                    };
                    // Windows inherits the listener's nonblocking mode.
                    stream.set_nonblocking(false).unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let mut request = [0; 8192];
                    let size = stream.read(&mut request).unwrap();
                    let request = String::from_utf8_lossy(&request[..size]);
                    assert!(request.starts_with("GET /updates/updates.json HTTP/1.1"));
                    assert!(!request.to_ascii_lowercase().contains("authorization:"));
                    count.fetch_add(1, Ordering::SeqCst);
                    let _ = stream.write_all(response.as_bytes());
                }
            });
            Self {
                url,
                requests,
                stop,
                thread: Some(thread),
            }
        }
        fn source(&self) -> UpdateSource {
            let _ = rustls::crypto::ring::default_provider().install_default();
            UpdateSource {
                client: reqwest::Client::builder()
                    .no_proxy()
                    .timeout(Duration::from_secs(2))
                    .build()
                    .unwrap(),
            }
        }
    }
    impl Drop for Server {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            self.thread.take().unwrap().join().unwrap();
        }
    }
    fn response(status: u16, headers: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status} Test\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{body}",
            body.len()
        )
    }

    #[test]
    fn accepted_connections_wait_for_request_data() {
        let server = Server::new(vec![response(200, "", INDEX)]);
        let address = server
            .url
            .strip_prefix("http://")
            .unwrap()
            .split('/')
            .next()
            .unwrap();
        let mut client = std::net::TcpStream::connect(address).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        // Accept must tolerate a connected client whose request has not arrived.
        thread::sleep(Duration::from_millis(100));
        client
            .write_all(b"GET /updates/updates.json HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();
        let mut reply = String::new();
        client.read_to_string(&mut reply).unwrap();
        assert!(reply.starts_with("HTTP/1.1 200"));
        assert!(reply.ends_with(INDEX));
        assert_eq!(server.requests.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_check_reads_one_anonymous_static_index() {
        let server = Server::new(vec![response(200, "", INDEX)]);
        let candidate = server
            .source()
            .find_at(&server.url, "0.1.0", true)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(candidate.version, "0.2.0-rc.1");
        assert_eq!(server.requests.load(Ordering::SeqCst), 1);
        assert!(UPDATE_INDEX_URL.starts_with("https://oolongcha024.github.io/"));
    }

    #[tokio::test]
    async fn production_source_rejects_plain_http() {
        let server = Server::new(vec![response(200, "", INDEX)]);
        assert_eq!(
            UpdateSource::new()
                .unwrap()
                .find_at(&server.url, "0.1.0", true)
                .await
                .unwrap_err()
                .code,
            "network"
        );
        assert_eq!(server.requests.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn forbidden_access_is_not_reported_as_rate_limiting() {
        let server = Server::new(vec![response(403, "", "Forbidden")]);
        let error = server
            .source()
            .find_at(&server.url, "0.1.0", true)
            .await
            .unwrap_err();
        assert_eq!(error.code, "access");
        assert_eq!(error.retry_at, None);
        assert_eq!(server.requests.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn throttling_honors_seconds_http_dates_and_exhausted_quota_reset_without_retrying() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let future = now + 3600;
        for (status, header) in [
            (429, "Retry-After: 3600\r\n".to_owned()),
            (
                429,
                format!(
                    "Retry-After: {}\r\n",
                    httpdate::fmt_http_date(UNIX_EPOCH + Duration::from_secs(future))
                ),
            ),
            (
                403,
                format!("X-RateLimit-Remaining: 0\r\nX-RateLimit-Reset: {future}\r\n"),
            ),
        ] {
            let server = Server::new(vec![response(status, &header, "Limited")]);
            let error = server
                .source()
                .find_at(&server.url, "0.1.0", true)
                .await
                .unwrap_err();
            assert_eq!(error.code, "rateLimited");
            assert!(error.retry_at.unwrap() >= future);
            assert_eq!(server.requests.load(Ordering::SeqCst), 1);
        }
    }

    #[tokio::test]
    async fn transient_server_failures_retry_with_a_finite_budget() {
        let server = Server::new(vec![response(503, "", "Busy"), response(200, "", INDEX)]);
        server
            .source()
            .find_at(&server.url, "0.1.0", true)
            .await
            .unwrap();
        assert_eq!(server.requests.load(Ordering::SeqCst), 2);
        let server = Server::new(vec![response(503, "", "Busy"); 3]);
        assert_eq!(
            server
                .source()
                .find_at(&server.url, "0.1.0", true)
                .await
                .unwrap_err()
                .code,
            "network"
        );
        assert_eq!(server.requests.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn malformed_and_oversized_metadata_fail_without_claiming_current_or_retrying() {
        for reply in [
            response(200, "", "broken json"),
            response(200, "", &"x".repeat(MAX_METADATA_BYTES + 1)),
            format!(
                "HTTP/1.1 200 OK\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n",
                MAX_METADATA_BYTES + 1,
                "x".repeat(MAX_METADATA_BYTES + 1)
            ),
        ] {
            let server = Server::new(vec![reply]);
            assert_eq!(
                server
                    .source()
                    .find_at(&server.url, "0.1.0", true)
                    .await
                    .unwrap_err()
                    .code,
                "metadata"
            );
            assert_eq!(server.requests.load(Ordering::SeqCst), 1);
        }
    }
}
