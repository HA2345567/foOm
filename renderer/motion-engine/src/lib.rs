#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickEvent {
    #[serde(flatten)]
    pub data: serde_json::Value,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollEvent {
    #[serde(flatten)]
    pub data: serde_json::Value,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseEvent {
    #[serde(flatten)]
    pub data: serde_json::Value,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeBurstEvent {
    #[serde(flatten)]
    pub data: serde_json::Value,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomConfig {
    #[serde(flatten)]
    pub data: serde_json::Value,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomKeyframe {
    #[serde(flatten)]
    pub data: serde_json::Value,
}

pub fn generate_zoom_keyframes(
    _clicks: &[ClickEvent],
    _duration: f64,
    _opts: &ZoomConfig,
    _scrolls: &[ScrollEvent],
    _pauses: &[PauseEvent],
    _type_bursts: &[TypeBurstEvent],
) -> Vec<ZoomKeyframe> {
    Vec::new()
}
