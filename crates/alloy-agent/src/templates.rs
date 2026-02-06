use std::collections::BTreeMap;

use alloy_proto::agent_v1::{ParamType, TemplateParam};

#[derive(Debug, Clone)]
pub struct ProcessTemplate {
    pub template_id: String,
    pub display_name: String,
    pub command: String,
    pub args: Vec<String>,
    pub params: Vec<TemplateParam>,

    // Optional graceful shutdown string to write to stdin before SIGTERM.
    #[allow(dead_code)]
    pub graceful_stdin: Option<String>,
}

fn param_string(
    key: &str,
    label: &str,
    required: bool,
    default_value: &str,
    enum_values: Vec<&str>,
    placeholder: &str,
    help: &str,
) -> TemplateParam {
    TemplateParam {
        key: key.to_string(),
        label: label.to_string(),
        r#type: ParamType::String as i32,
        required,
        default_value: default_value.to_string(),
        min_int: 0,
        max_int: 0,
        enum_values: enum_values.into_iter().map(|s| s.to_string()).collect(),
        secret: false,
        placeholder: placeholder.to_string(),
        help: help.to_string(),
        advanced: false,
    }
}

fn param_int(
    key: &str,
    label: &str,
    required: bool,
    default_value: &str,
    min_int: i64,
    max_int: i64,
    placeholder: &str,
    help: &str,
) -> TemplateParam {
    TemplateParam {
        key: key.to_string(),
        label: label.to_string(),
        r#type: ParamType::Int as i32,
        required,
        default_value: default_value.to_string(),
        min_int,
        max_int,
        enum_values: Vec::new(),
        secret: false,
        placeholder: placeholder.to_string(),
        help: help.to_string(),
        advanced: false,
    }
}

fn param_bool(
    key: &str,
    label: &str,
    required: bool,
    default_value: bool,
    help: &str,
) -> TemplateParam {
    TemplateParam {
        key: key.to_string(),
        label: label.to_string(),
        r#type: ParamType::Bool as i32,
        required,
        default_value: default_value.to_string(),
        min_int: 0,
        max_int: 0,
        enum_values: Vec::new(),
        secret: false,
        placeholder: String::new(),
        help: help.to_string(),
        advanced: false,
    }
}

fn param_secret(
    key: &str,
    label: &str,
    required: bool,
    default_value: &str,
    help: &str,
) -> TemplateParam {
    TemplateParam {
        key: key.to_string(),
        label: label.to_string(),
        r#type: ParamType::String as i32,
        required,
        default_value: default_value.to_string(),
        min_int: 0,
        max_int: 0,
        enum_values: Vec::new(),
        secret: true,
        placeholder: String::new(),
        help: help.to_string(),
        advanced: false,
    }
}

pub fn list_templates() -> Vec<ProcessTemplate> {
    // Phase 1: hardcoded templates to avoid turning the control plane into RCE.
    // These are demos; game adapters will provide real templates later.
    vec![
        ProcessTemplate {
            template_id: "demo:sleep".to_string(),
            display_name: "Demo: sleep".to_string(),
            command: "/bin/sleep".to_string(),
            args: vec!["60".to_string()],
            params: vec![param_int(
                "seconds",
                "Seconds",
                false,
                "60",
                1,
                3600,
                "60",
                "How long the demo process sleeps.",
            )],
            graceful_stdin: None,
        },
        ProcessTemplate {
            // Real implementation is added incrementally in Milestone 1.
            template_id: "minecraft:vanilla".to_string(),
            display_name: "Minecraft: Vanilla".to_string(),
            // Placeholder; spawn spec is prepared by the minecraft module.
            command: "java".to_string(),
            args: vec![],
            params: vec![
                param_bool(
                    "accept_eula",
                    "Accept EULA",
                    true,
                    false,
                    "Required to start Minecraft server. You must agree to Mojang's EULA.",
                ),
                param_string(
                    "version",
                    "Version",
                    false,
                    "latest_release",
                    vec!["latest_release", "latest_snapshot"],
                    "latest_release",
                    "Minecraft version id (e.g. 1.20.4). Default is latest_release.",
                ),
                param_int(
                    "memory_mb",
                    "Memory (MiB)",
                    false,
                    "2048",
                    512,
                    65536,
                    "2048",
                    "Max heap size passed to Java (Xmx).",
                ),
                param_int(
                    "port",
                    "Port",
                    false,
                    "0",
                    1024,
                    65535,
                    "25565 (leave blank for auto)",
                    "TCP port to bind. Use 0 or leave blank to auto-assign a free port.",
                ),
            ],
            graceful_stdin: Some("stop\n".to_string()),
        },
        ProcessTemplate {
            template_id: "minecraft:modrinth".to_string(),
            display_name: "Minecraft: Modrinth Pack".to_string(),
            command: "java".to_string(),
            args: vec![],
            params: vec![
                param_bool(
                    "accept_eula",
                    "Accept EULA",
                    true,
                    false,
                    "Required to start Minecraft server. You must agree to Mojang's EULA.",
                ),
                param_string(
                    "mrpack",
                    "Modpack (mrpack)",
                    true,
                    "",
                    Vec::new(),
                    "https://modrinth.com/modpack/.../version/...",
                    "Paste a Modrinth version URL or a direct .mrpack download URL.",
                ),
                param_int(
                    "memory_mb",
                    "Memory (MiB)",
                    false,
                    "2048",
                    512,
                    65536,
                    "2048",
                    "Max heap size passed to Java (Xmx).",
                ),
                param_int(
                    "port",
                    "Port",
                    false,
                    "0",
                    1024,
                    65535,
                    "25565 (leave blank for auto)",
                    "TCP port to bind. Use 0 or leave blank to auto-assign a free port.",
                ),
            ],
            graceful_stdin: Some("stop\n".to_string()),
        },
        ProcessTemplate {
            template_id: "minecraft:import".to_string(),
            display_name: "Minecraft: Import Pack".to_string(),
            command: "java".to_string(),
            args: vec![],
            params: vec![
                param_bool(
                    "accept_eula",
                    "Accept EULA",
                    true,
                    false,
                    "Required to start Minecraft server. You must agree to Mojang's EULA.",
                ),
                param_string(
                    "pack",
                    "Server pack (zip/path/url)",
                    true,
                    "",
                    Vec::new(),
                    "uploads/pack.zip or https://example.com/pack.zip",
                    "Provide a server pack .zip URL, or a path under /data (ALLOY_DATA_ROOT).",
                ),
                param_int(
                    "memory_mb",
                    "Memory (MiB)",
                    false,
                    "2048",
                    512,
                    65536,
                    "2048",
                    "Max heap size passed to Java (Xmx).",
                ),
                param_int(
                    "port",
                    "Port",
                    false,
                    "0",
                    1024,
                    65535,
                    "25565 (leave blank for auto)",
                    "TCP port to bind. Use 0 or leave blank to auto-assign a free port.",
                ),
            ],
            graceful_stdin: Some("stop\n".to_string()),
        },
        ProcessTemplate {
            template_id: "minecraft:curseforge".to_string(),
            display_name: "Minecraft: CurseForge Pack".to_string(),
            command: "java".to_string(),
            args: vec![],
            params: vec![
                param_bool(
                    "accept_eula",
                    "Accept EULA",
                    true,
                    false,
                    "Required to start Minecraft server. You must agree to Mojang's EULA.",
                ),
                param_string(
                    "curseforge",
                    "Modpack (CurseForge file)",
                    true,
                    "",
                    Vec::new(),
                    "https://www.curseforge.com/minecraft/modpacks/.../files/...",
                    "Paste a CurseForge file URL, or modId:fileId. Server pack is preferred when available.",
                ),
                param_int(
                    "memory_mb",
                    "Memory (MiB)",
                    false,
                    "2048",
                    512,
                    65536,
                    "2048",
                    "Max heap size passed to Java (Xmx).",
                ),
                param_int(
                    "port",
                    "Port",
                    false,
                    "0",
                    1024,
                    65535,
                    "25565 (leave blank for auto)",
                    "TCP port to bind. Use 0 or leave blank to auto-assign a free port.",
                ),
            ],
            graceful_stdin: Some("stop\n".to_string()),
        },
        ProcessTemplate {
            template_id: "terraria:vanilla".to_string(),
            display_name: "Terraria: Vanilla".to_string(),
            // Placeholder; spawn spec is prepared by the terraria module.
            command: "./TerrariaServer.bin.x86_64".to_string(),
            args: vec![],
            params: vec![
                param_string(
                    "version",
                    "Version",
                    false,
                    "1453",
                    vec![
                        "1453", "1452", "1451", "1450", "1449", "1448", "1447", "1436", "1435",
                        "1434", "1423",
                    ],
                    "1453",
                    "Terraria dedicated server package version id (e.g. 1453 = 1.4.5.3).",
                ),
                param_int(
                    "port",
                    "Port",
                    false,
                    "0",
                    1024,
                    65535,
                    "7777 (leave blank for auto)",
                    "TCP port to bind. Use 0 or leave blank to auto-assign a free port.",
                ),
                param_int(
                    "max_players",
                    "Max players",
                    false,
                    "8",
                    1,
                    255,
                    "8",
                    "Maximum number of players.",
                ),
                param_string(
                    "world_name",
                    "World name",
                    false,
                    "world",
                    Vec::new(),
                    "world",
                    "Used for world file name under worlds/ (letters, digits, '-', '_' and '.' only).",
                ),
                param_int(
                    "world_size",
                    "World size",
                    false,
                    "1",
                    1,
                    3,
                    "1",
                    "1=Small, 2=Medium, 3=Large. Only used when auto-creating a new world.",
                ),
                param_secret(
                    "password",
                    "Password",
                    false,
                    "",
                    "Optional server password for joining players.",
                ),
            ],
            graceful_stdin: Some("exit\n".to_string()),
        },
        ProcessTemplate {
            template_id: "dst:vanilla".to_string(),
            display_name: "Don't Starve Together".to_string(),
            command: "./dontstarve_dedicated_server_nullrenderer".to_string(),
            args: vec![],
            params: vec![
                param_secret(
                    "cluster_token",
                    "Cluster token",
                    true,
                    "",
                    "Required. Get it from Klei and paste it here (cluster_token.txt).",
                ),
                param_string(
                    "cluster_name",
                    "Cluster name",
                    false,
                    "Alloy DST server",
                    Vec::new(),
                    "Alloy DST server",
                    "Shown in the server list.",
                ),
                param_int(
                    "max_players",
                    "Max players",
                    false,
                    "6",
                    1,
                    64,
                    "6",
                    "Maximum number of players.",
                ),
                param_secret(
                    "password",
                    "Password",
                    false,
                    "",
                    "Optional cluster password for joining players.",
                ),
                param_int(
                    "port",
                    "Server port (UDP)",
                    false,
                    "10999",
                    0,
                    65535,
                    "10999 (0 = auto)",
                    "UDP port used by clients to connect. Use 0 to auto-assign.",
                ),
                param_int(
                    "master_port",
                    "Master port (UDP)",
                    false,
                    "27016",
                    0,
                    65535,
                    "27016 (0 = auto)",
                    "Steam master server port. Use 0 to auto-assign.",
                ),
                param_int(
                    "auth_port",
                    "Auth port (UDP)",
                    false,
                    "8766",
                    0,
                    65535,
                    "8766 (0 = auto)",
                    "Steam authentication port. Use 0 to auto-assign.",
                ),
            ],
            graceful_stdin: None,
        },
    ]
}

pub fn find_template(template_id: &str) -> Option<ProcessTemplate> {
    list_templates()
        .into_iter()
        .find(|t| t.template_id == template_id)
}

pub fn apply_params(
    mut t: ProcessTemplate,
    params: &BTreeMap<String, String>,
) -> anyhow::Result<ProcessTemplate> {
    // Phase 1 minimal params:
    // - demo:sleep: { seconds: "1..=3600" }
    if t.template_id == "demo:sleep"
        && let Some(v) = params.get("seconds")
    {
        let secs: u64 = match v.trim().parse() {
            Ok(v) => v,
            Err(_) => {
                let mut fields = BTreeMap::new();
                fields.insert(
                    "seconds".to_string(),
                    "Must be an integer (1..3600).".to_string(),
                );
                return Err(crate::error_payload::anyhow(
                    "invalid_param",
                    "invalid demo params",
                    Some(fields),
                    None,
                ));
            }
        };
        if !(1..=3600).contains(&secs) {
            let mut fields = BTreeMap::new();
            fields.insert(
                "seconds".to_string(),
                "Must be between 1 and 3600 seconds.".to_string(),
            );
            return Err(crate::error_payload::anyhow(
                "invalid_param",
                "invalid demo params",
                Some(fields),
                None,
            ));
        }
        t.args = vec![secs.to_string()];
    }

    if t.template_id == "minecraft:vanilla" {
        // Contract-only commit: validate params early; runtime wiring is in later commits.
        let _ = crate::minecraft::validate_vanilla_params(params)?;
    }

    if t.template_id == "minecraft:modrinth" {
        let _ = crate::minecraft_modrinth::validate_params(params)?;
    }

    if t.template_id == "minecraft:import" {
        let _ = crate::minecraft_import::validate_params(params)?;
    }

    if t.template_id == "minecraft:curseforge" {
        let _ = crate::minecraft_curseforge::validate_params(params)?;
    }

    if t.template_id == "terraria:vanilla" {
        let _ = crate::terraria::validate_vanilla_params(params)?;
    }

    if t.template_id == "dst:vanilla" {
        let _ = crate::dst::validate_vanilla_params(params)?;
    }

    Ok(t)
}
