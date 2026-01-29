use specta::Type;

/// Stable template identifier selected by control/web.
///
/// NOTE: This is not a command. The agent maps templates to safe spawn specs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Type)]
pub struct ProcessTemplateId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Type)]
pub struct ProcessId(pub String);

impl ProcessId {
    pub fn new() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }
}

impl Default for ProcessId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, Type)]
pub enum ProcessState {
    Starting,
    Running,
    Stopping,
    Exited,
    Failed,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Type)]
pub struct ProcessStatus {
    pub id: ProcessId,
    pub template_id: ProcessTemplateId,
    pub state: ProcessState,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub message: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_id_is_non_empty() {
        let id = ProcessId::new();
        assert!(!id.0.is_empty());
    }
}
