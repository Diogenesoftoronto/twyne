//! Source wire shapes, not consent grants. Unknown response fields are retained.
//! Encoded argument size is checked with JSON.stringify in the SDK helper;
//! Rust number serialization is not an exact JavaScript encoding oracle.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SourceCatalogResponse {
    pub data: Vec<AccountSource>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AccountSource {
    pub id: String,
    pub label: String,
    pub tools: Vec<AccountTool>,
    pub resources_allowed: bool,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AccountTool {
    pub name: String,
    #[serde(
        default,
        rename = "inputSchema",
        skip_serializing_if = "Option::is_none"
    )]
    pub input_schema: Option<Value>,
    // Source admits title/description without a type check. Keep them raw,
    // including explicit null and absent keys; never normalize a definition.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResourceListResponse {
    pub resources: Vec<AccountResource>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AccountResource {
    pub uri: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResourceReadResponse {
    #[serde(default)]
    pub contents: Vec<ResourceContent>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResourceContent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourcesInput {}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResourcesInput {
    #[serde(rename = "sourceId")]
    pub source_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReadResourceInput {
    #[serde(rename = "sourceId")]
    pub source_id: String,
    pub uri: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CallToolInput {
    #[serde(rename = "sourceId")]
    pub source_id: String,
    pub tool: String,
    pub arguments: Map<String, Value>,
}

fn validate_nonempty_utf16(value: &str, limit: usize, field: &str) -> Result<()> {
    // The Source segment() guard checks emptiness without trimming IDs.
    if value.is_empty() || value.encode_utf16().count() > limit {
        bail!("invalid {field}");
    }
    Ok(())
}

impl ResourcesInput {
    pub fn validate(&self) -> Result<()> {
        validate_nonempty_utf16(&self.source_id, 256, "sourceId")
    }
}

impl ReadResourceInput {
    pub fn validate(&self) -> Result<()> {
        validate_nonempty_utf16(&self.source_id, 256, "sourceId")?;
        validate_nonempty_utf16(&self.uri, 4096, "resourceURI")
    }
}

impl CallToolInput {
    pub fn validate(&self) -> Result<()> {
        validate_nonempty_utf16(&self.source_id, 256, "sourceId")?;
        validate_nonempty_utf16(&self.tool, 256, "tool")?;
        // The helper applies the exact Source JSON.stringify(...).length
        // admission before dispatch. Map typing already rejects nonobjects.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_js_utf16_limits() {
        let input = ResourcesInput {
            source_id: "🪼".repeat(128),
        };
        assert!(input.validate().is_ok());
        let input = ResourcesInput {
            source_id: "🪼".repeat(129),
        };
        assert!(input.validate().is_err());
        let input = ReadResourceInput {
            source_id: "s".into(),
            uri: "🪼".repeat(2048),
        };
        assert!(input.validate().is_ok());
        let input = ReadResourceInput {
            source_id: "s".into(),
            uri: "🪼".repeat(2049),
        };
        assert!(input.validate().is_err());
    }

    #[test]
    fn validates_arguments_object_and_source_whitespace() {
        assert!(
            serde_json::from_value::<CallToolInput>(
                json!({"sourceId":"s","tool":"t","arguments":[]})
            )
            .is_err()
        );
        assert!(
            ResourcesInput {
                source_id: " \u{feff}".into()
            }
            .validate()
            .is_ok()
        );
        assert!(
            ResourcesInput {
                source_id: "\u{0085}".into()
            }
            .validate()
            .is_ok()
        );
        assert!(
            serde_json::from_value::<ResourcesInput>(
                json!({"sourceId":"s","owner":"another-account"})
            )
            .is_err()
        );
    }

    #[test]
    fn preserves_unknown_catalog_tool_and_resource_fields() {
        let catalog: SourceCatalogResponse = serde_json::from_value(json!({
            "data": [{"id":"s","label":"S","resources_allowed":false,"futureSource":1,
                "tools":[{"name":"t","inputSchema":{"type":"object"},"futureTool":2}]}],
            "futureCatalog":3
        }))
        .unwrap();
        assert_eq!(catalog.extra["futureCatalog"], json!(3));
        assert_eq!(catalog.data[0].extra["futureSource"], json!(1));
        assert_eq!(catalog.data[0].tools[0].extra["futureTool"], json!(2));
        let resources: ResourceListResponse = serde_json::from_value(json!({
            "resources":[{"uri":"u","name":"n","futureResource":4}],"futureWrapper":5
        }))
        .unwrap();
        assert_eq!(resources.extra["futureWrapper"], json!(5));
        assert_eq!(resources.resources[0].extra["futureResource"], json!(4));
    }

    #[test]
    fn retains_source_admitted_tool_metadata_without_narrowing_or_null_loss() {
        let raw = json!({"data":[{"id":"s","label":"S","resources_allowed":true,
            "tools":[{"name":"t","title":5,"description":null,"inputSchema":{"type":"object"}},
                {"name":"u","inputSchema":{"type":"object"}}]}]});
        let catalog: SourceCatalogResponse = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(catalog.data[0].tools[0].extra["title"], json!(5));
        assert_eq!(catalog.data[0].tools[0].extra["description"], Value::Null);
        assert!(!catalog.data[0].tools[1].extra.contains_key("description"));
        assert_eq!(serde_json::to_value(catalog).unwrap(), raw);
    }
}
