//! Official TOML compatibility: one preservation base, an editable projection,
//! and one validation path shared by preview and actual launch. Never return
//! upstream parse errors: they may embed credentials or the entire document.
mod editor;
mod projection;
mod validation;

use crate::process::{CoreError, ErrorCode, Result};
use cleartier_config::ConnectionConfig;
use serde::Serialize;
use uuid::Uuid;

pub const MAX_TOML_BYTES: usize = 256 * 1024;

pub(crate) use validation::issues as validation_issues;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub path: String,
    pub code: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub id: Uuid,
    pub config: ConnectionConfig,
    pub issues: Vec<Issue>,
    pub preserved_fields: Vec<String>,
}

pub fn import(id: Uuid, text: &str) -> Result<Preview> {
    let mut table = parse(text)?;
    // Only unspecified interface names receive a local, stable default. Explicit
    // names, hostnames, addresses, ports and all other settings remain intact.
    if !cfg!(target_os = "macos") {
        let flags = table
            .entry("flags")
            .or_insert_with(|| toml::Value::Table(Default::default()));
        if let Some(flags) = flags.as_table_mut() {
            flags.entry("dev_name").or_insert_with(|| {
                toml::Value::String(format!("ct-{}", &id.simple().to_string()[..8]))
            });
        }
    }
    let text = encode(&table)?;
    let config = projection::project(id, &table, text);
    inspect(id, &config)
}

pub fn inspect(id: Uuid, config: &ConnectionConfig) -> Result<Preview> {
    let text = export(id, config)?;
    let table = parse(&text)?;
    Ok(Preview {
        id,
        config: config.clone(),
        issues: validation::issues(&table),
        preserved_fields: projection::preserved_fields(&table),
    })
}

/// Export intentionally permits unrecognized/unsupported fields for migration.
/// Only syntactically invalid/oversized preservation bases cannot be exported.
pub fn export(id: Uuid, config: &ConnectionConfig) -> Result<String> {
    if let Some(original) = &config.official_toml {
        let mut table = parse(original)?;
        let baseline = projection::project(id, &table, original.clone());
        projection::overlay(&mut table, config, &baseline)?;
        table.insert("instance_id".into(), toml::Value::String(id.to_string()));
        encode(&table)
    } else {
        editor::editor_toml(id, config)
    }
}

pub(crate) fn for_connection(id: Uuid, config: &ConnectionConfig) -> Result<String> {
    config.validate().map_err(|_| invalid())?;
    if !["auto", "manual", "none"].contains(&config.ipv4_mode.as_str())
        || !["auto", "lazy", "disabled", "only"].contains(&config.p2p_policy.as_str())
    {
        return Err(invalid());
    }
    if !config.extra.is_empty() {
        return Err(CoreError::new(
            ErrorCode::UnsupportedConfig,
            "Unrecognized connection parameters",
        ));
    }
    let text = export(id, config)?;
    let issues = validation::issues(&parse(&text)?);
    if !issues.is_empty() {
        let platform = issues.iter().any(|issue| issue.code == "platform");
        return Err(CoreError::new(
            if platform {
                ErrorCode::UnsupportedPlatform
            } else {
                ErrorCode::UnsupportedConfig
            },
            "Configuration cannot be applied; inspect its compatibility report",
        ));
    }
    Ok(text)
}

pub(crate) fn parse(text: &str) -> Result<toml::Table> {
    if text.len() > MAX_TOML_BYTES {
        return Err(CoreError::new(
            ErrorCode::InvalidConfig,
            "TOML exceeds 256 KiB",
        ));
    }
    toml::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| invalid())
}
fn encode(table: &toml::Table) -> Result<String> {
    let text = toml::to_string_pretty(table).map_err(|_| invalid())?;
    if text.len() > MAX_TOML_BYTES {
        return Err(invalid());
    }
    Ok(text)
}
fn invalid() -> CoreError {
    CoreError::new(ErrorCode::InvalidConfig, "Invalid TOML configuration")
}

#[cfg(test)]
mod tests;
