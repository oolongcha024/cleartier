use crate::{Error, Result};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const REPOSITORY: &str = "oolongcha024/cleartier";
pub const MANIFEST_NAME: &str = "latest.json";
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
struct Asset {
    name: String,
    browser_download_url: String,
    state: String,
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    body: Option<String>,
    assets: Vec<Asset>,
}
pub fn select_release(
    json: &serde_json::Value,
    current: &str,
    prereleases: bool,
) -> Result<Option<Candidate>> {
    let releases: Vec<Release> =
        serde_json::from_value(json.clone()).map_err(|_| Error::new("metadata"))?;
    let mut best: Option<(Version, Candidate)> = None;
    for release in releases {
        let Some(version) = release.tag_name.strip_prefix('v') else {
            continue;
        };
        let candidate = Candidate {
            version: version.to_owned(),
            notes: release
                .body
                .unwrap_or_default()
                .chars()
                .take(16384)
                .collect(),
        };
        if release.draft || !candidate.accepted(current, prereleases) {
            continue;
        }
        let version = Version::parse(version).map_err(|_| Error::new("metadata"))?;
        if release.prerelease == version.pre.is_empty() {
            continue;
        }
        let required = [
            (MANIFEST_NAME.to_owned(), candidate.manifest_url()),
            (candidate.installer_name(), candidate.installer_url()),
            ("cleartier-windows-x64.zip".to_owned(), candidate.zip_url()),
        ];
        if !required.iter().all(|(name, url)| {
            release
                .assets
                .iter()
                .filter(|asset| {
                    &asset.name == name
                        && &asset.browser_download_url == url
                        && asset.state == "uploaded"
                })
                .count()
                == 1
        }) {
            continue;
        }
        if best
            .as_ref()
            .is_none_or(|(previous, _)| version > *previous)
        {
            best = Some((version, candidate));
        }
    }
    Ok(best.map(|(_, candidate)| candidate))
}

pub struct Github {
    client: reqwest::Client,
}
impl Github {
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
        let mut releases = Vec::new();
        for page in 1..=10 {
            let response = self
                .client
                .get(format!(
                    "https://api.github.com/repos/{REPOSITORY}/releases?per_page=100&page={page}"
                ))
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2026-03-10")
                .send()
                .await
                .map_err(|_| Error::new("network"))?;
            if matches!(response.status().as_u16(), 403 | 429) {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                let retry = response
                    .headers()
                    .get("retry-after")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .map(|seconds| now.saturating_add(seconds));
                let reset = response
                    .headers()
                    .get("x-ratelimit-reset")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok());
                return Err(Error {
                    code: "rateLimited",
                    retry_at: Some(retry.or(reset).unwrap_or(now + 3600).max(now + 60)),
                });
            }
            if !response.status().is_success() {
                return Err(Error::new("network"));
            }
            if response
                .content_length()
                .is_some_and(|size| size > 8 * 1024 * 1024)
            {
                return Err(Error::new("metadata"));
            }
            let mut response = response;
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| Error::new("network"))? {
                if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                    return Err(Error::new("metadata"));
                }
                bytes.extend_from_slice(&chunk);
            }
            let entries: Vec<serde_json::Value> =
                serde_json::from_slice(&bytes).map_err(|_| Error::new("metadata"))?;
            let complete = entries.len() < 100;
            releases.extend(entries);
            if complete {
                return select_release(&serde_json::Value::Array(releases), current, prereleases);
            }
        }
        Err(Error::new("metadata"))
    }
    pub async fn manifest(&self, candidate: &Candidate) -> Result<serde_json::Value> {
        let response = self
            .client
            .get(candidate.manifest_url())
            .send()
            .await
            .map_err(|_| Error::new("network"))?;
        if !response.status().is_success() {
            return Err(Error::new("metadata"));
        }
        let mut response = response;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error::new("network"))? {
            if bytes.len() + chunk.len() > 256 * 1024 {
                return Err(Error::new("metadata"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let json: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| Error::new("metadata"))?;
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
}
