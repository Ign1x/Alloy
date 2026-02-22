#![allow(clippy::too_many_arguments)]

use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TemplateParamKind {
    String,
    Int { min: i64, max: i64 },
    Bool,
    SecretString,
}

#[derive(Clone, Copy, Debug)]
pub struct AdapterTemplateParam {
    pub key: &'static str,
    pub label: &'static str,
    pub kind: TemplateParamKind,
    pub required: bool,
    pub default_value: &'static str,
    pub enum_values: &'static [&'static str],
    pub placeholder: &'static str,
    pub help: &'static str,
    pub advanced: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PortProtocol {
    Tcp,
    Udp,
}

#[derive(Clone, Copy, Debug)]
pub struct PortField {
    pub key: &'static str,
    pub protocol: PortProtocol,
}

#[derive(Clone, Debug)]
pub struct AdapterTemplate {
    pub template_id: &'static str,
    pub display_name: &'static str,
    pub startup_command: &'static str,
    pub startup_args: &'static [&'static str],
    pub params: &'static [AdapterTemplateParam],
    pub graceful_stdin: Option<&'static str>,
    pub validator: Option<TemplateValidator>,
    pub ports: &'static [PortField],
}

pub type TemplateValidator = fn(&BTreeMap<String, String>) -> anyhow::Result<()>;

const EMPTY_ENUM: &[&str] = &[];
const ENUM_MINECRAFT_VERSION: &[&str] = &["latest_release", "latest_snapshot"];
const ENUM_TERRARIA_VERSION: &[&str] = &[
    "1453", "1452", "1451", "1450", "1449", "1448", "1447", "1436", "1435", "1434", "1423",
];
const ENUM_FACTORIO_VERSION: &[&str] = &["stable", "experimental"];

const EMPTY_PORTS: &[PortField] = &[];
const PORTS_MC_AND_TERRARIA: &[PortField] = &[PortField {
    key: "port",
    protocol: PortProtocol::Tcp,
}];
const PORTS_FACTORIO: &[PortField] = &[
    PortField {
        key: "port",
        protocol: PortProtocol::Udp,
    },
    PortField {
        key: "rcon_port",
        protocol: PortProtocol::Tcp,
    },
];
const PORTS_PAIR_UDP: &[PortField] = &[
    PortField {
        key: "port",
        protocol: PortProtocol::Udp,
    },
    PortField {
        key: "query_port",
        protocol: PortProtocol::Udp,
    },
];
const PORTS_SEVEN_DAYS: &[PortField] = &[
    PortField {
        key: "port",
        protocol: PortProtocol::Udp,
    },
    PortField {
        key: "query_port",
        protocol: PortProtocol::Udp,
    },
    PortField {
        key: "control_panel_port",
        protocol: PortProtocol::Tcp,
    },
];
const PORTS_DST: &[PortField] = &[
    PortField {
        key: "port",
        protocol: PortProtocol::Udp,
    },
    PortField {
        key: "master_port",
        protocol: PortProtocol::Udp,
    },
    PortField {
        key: "auth_port",
        protocol: PortProtocol::Udp,
    },
];

const fn template_param(
    key: &'static str,
    label: &'static str,
    kind: TemplateParamKind,
    required: bool,
    default_value: &'static str,
    enum_values: &'static [&'static str],
    placeholder: &'static str,
    help: &'static str,
    advanced: bool,
) -> AdapterTemplateParam {
    AdapterTemplateParam {
        key,
        label,
        kind,
        required,
        default_value,
        enum_values,
        placeholder,
        help,
        advanced,
    }
}

const PARAM_ACCEPT_EULA: AdapterTemplateParam = template_param(
    "accept_eula",
    "Accept EULA",
    TemplateParamKind::Bool,
    true,
    "false",
    EMPTY_ENUM,
    "",
    "Required to start Minecraft server. You must agree to Mojang's EULA.",
    false,
);
const PARAM_MC_VERSION: AdapterTemplateParam = template_param(
    "version",
    "Version",
    TemplateParamKind::String,
    false,
    "latest_release",
    ENUM_MINECRAFT_VERSION,
    "latest_release",
    "Minecraft version id (e.g. 1.20.4). Default is latest_release.",
    false,
);
const PARAM_MC_MEMORY_MB: AdapterTemplateParam = template_param(
    "memory_mb",
    "Memory (MiB)",
    TemplateParamKind::Int {
        min: 512,
        max: 65536,
    },
    false,
    "2048",
    EMPTY_ENUM,
    "2048",
    "Max heap size passed to Java (Xmx).",
    false,
);
const PARAM_MC_PORT: AdapterTemplateParam = template_param(
    "port",
    "Port",
    TemplateParamKind::Int { min: 0, max: 65535 },
    false,
    "0",
    EMPTY_ENUM,
    "25565 (leave blank for auto)",
    "TCP port to bind. Use 0 or leave blank to auto-assign a free port.",
    false,
);

const MINIMAL_GENERIC_TEMPLATE_PARAMS: &[AdapterTemplateParam] = &[
    template_param(
        "port",
        "port",
        TemplateParamKind::String,
        false,
        "0",
        EMPTY_ENUM,
        "0",
        "adapter param",
        false,
    ),
    template_param(
        "memory_mb",
        "memory_mb",
        TemplateParamKind::String,
        false,
        "2048",
        EMPTY_ENUM,
        "2048",
        "adapter param",
        false,
    ),
];

const MINECRAFT_MODRINTH_PARAMS: &[AdapterTemplateParam] = &[
    PARAM_ACCEPT_EULA,
    template_param(
        "mrpack",
        "Modpack (mrpack)",
        TemplateParamKind::String,
        true,
        "",
        EMPTY_ENUM,
        "https://modrinth.com/modpack/.../version/...",
        "Paste a Modrinth version URL or a direct .mrpack download URL.",
        false,
    ),
    PARAM_MC_MEMORY_MB,
    PARAM_MC_PORT,
];

const MINECRAFT_IMPORT_PARAMS: &[AdapterTemplateParam] = &[
    PARAM_ACCEPT_EULA,
    template_param(
        "pack",
        "Server pack (zip/path/url)",
        TemplateParamKind::String,
        true,
        "",
        EMPTY_ENUM,
        "uploads/pack.zip or https://example.com/pack.zip",
        "Provide a server pack .zip URL, or a path under /data (ALLOY_DATA_ROOT).",
        false,
    ),
    PARAM_MC_MEMORY_MB,
    PARAM_MC_PORT,
];

const MINECRAFT_CURSEFORGE_PARAMS: &[AdapterTemplateParam] = &[
    PARAM_ACCEPT_EULA,
    template_param(
        "curseforge",
        "Modpack (CurseForge file)",
        TemplateParamKind::String,
        true,
        "",
        EMPTY_ENUM,
        "https://www.curseforge.com/minecraft/modpacks/.../files/...",
        "Paste a CurseForge file URL, or modId:fileId. Server pack is preferred when available.",
        false,
    ),
    PARAM_MC_MEMORY_MB,
    PARAM_MC_PORT,
];

const TERRARIA_PARAMS: &[AdapterTemplateParam] = &[
    template_param(
        "version",
        "Version",
        TemplateParamKind::String,
        false,
        "1453",
        ENUM_TERRARIA_VERSION,
        "1453",
        "Terraria dedicated server package version id (e.g. 1453 = 1.4.5.3).",
        false,
    ),
    template_param(
        "port",
        "Port",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "0",
        EMPTY_ENUM,
        "7777 (leave blank for auto)",
        "TCP port to bind. Use 0 or leave blank to auto-assign a free port.",
        false,
    ),
    template_param(
        "max_players",
        "Max players",
        TemplateParamKind::Int { min: 1, max: 255 },
        false,
        "8",
        EMPTY_ENUM,
        "8",
        "Maximum number of players.",
        false,
    ),
    template_param(
        "world_name",
        "World name",
        TemplateParamKind::String,
        false,
        "world",
        EMPTY_ENUM,
        "world",
        "Used for world file name under worlds/ (letters, digits, '-' , '_' and '.' only).",
        false,
    ),
    template_param(
        "world_size",
        "World size",
        TemplateParamKind::Int { min: 1, max: 3 },
        false,
        "1",
        EMPTY_ENUM,
        "1",
        "1=Small, 2=Medium, 3=Large. Only used when auto-creating a new world.",
        false,
    ),
    template_param(
        "password",
        "Password",
        TemplateParamKind::SecretString,
        false,
        "",
        EMPTY_ENUM,
        "",
        "Optional server password for joining players.",
        false,
    ),
];

const DST_PARAMS: &[AdapterTemplateParam] = &[
    template_param(
        "cluster_token",
        "Cluster token",
        TemplateParamKind::SecretString,
        true,
        "",
        EMPTY_ENUM,
        "",
        "Required. Get it from Klei and paste it here (cluster_token.txt).",
        false,
    ),
    template_param(
        "cluster_name",
        "Cluster name",
        TemplateParamKind::String,
        false,
        "Alloy DST server",
        EMPTY_ENUM,
        "Alloy DST server",
        "Shown in the server list.",
        false,
    ),
    template_param(
        "max_players",
        "Max players",
        TemplateParamKind::Int { min: 1, max: 64 },
        false,
        "6",
        EMPTY_ENUM,
        "6",
        "Maximum number of players.",
        false,
    ),
    template_param(
        "password",
        "Password",
        TemplateParamKind::SecretString,
        false,
        "",
        EMPTY_ENUM,
        "",
        "Optional cluster password for joining players.",
        false,
    ),
    template_param(
        "port",
        "Server port (UDP)",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "10999",
        EMPTY_ENUM,
        "10999 (0 = auto)",
        "UDP port used by clients to connect. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "master_port",
        "Master port (UDP)",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "27016",
        EMPTY_ENUM,
        "27016 (0 = auto)",
        "Steam master server port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "auth_port",
        "Auth port (UDP)",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "8766",
        EMPTY_ENUM,
        "8766 (0 = auto)",
        "Steam authentication port. Use 0 to auto-assign.",
        false,
    ),
];

const PALWORLD_PARAMS: &[AdapterTemplateParam] = &[
    template_param(
        "port",
        "Port",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "8211",
        EMPTY_ENUM,
        "8211 (0 = auto)",
        "Game port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "query_port",
        "Query port",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "27015",
        EMPTY_ENUM,
        "27015 (0 = auto)",
        "Steam query port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "max_players",
        "Max players",
        TemplateParamKind::Int { min: 1, max: 128 },
        false,
        "32",
        EMPTY_ENUM,
        "32",
        "Maximum number of players.",
        false,
    ),
    template_param(
        "server_name",
        "Server name",
        TemplateParamKind::String,
        false,
        "Alloy Palworld server",
        EMPTY_ENUM,
        "Alloy Palworld server",
        "Shown in the server browser.",
        false,
    ),
    template_param(
        "server_description",
        "Server description",
        TemplateParamKind::String,
        false,
        "",
        EMPTY_ENUM,
        "",
        "Optional server description.",
        false,
    ),
    template_param(
        "password",
        "Password",
        TemplateParamKind::SecretString,
        false,
        "",
        EMPTY_ENUM,
        "",
        "Optional join password.",
        false,
    ),
    template_param(
        "admin_password",
        "Admin password",
        TemplateParamKind::SecretString,
        false,
        "",
        EMPTY_ENUM,
        "",
        "Optional admin password.",
        false,
    ),
    template_param(
        "public",
        "Public server",
        TemplateParamKind::Bool,
        false,
        "false",
        EMPTY_ENUM,
        "",
        "Enable public server listing when supported by network/NAT.",
        false,
    ),
];

const FACTORIO_PARAMS: &[AdapterTemplateParam] = &[
    template_param(
        "version",
        "Version",
        TemplateParamKind::String,
        false,
        "stable",
        ENUM_FACTORIO_VERSION,
        "stable",
        "Factorio headless channel or explicit version (e.g. 1.1.110).",
        false,
    ),
    template_param(
        "port",
        "Port",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "34197",
        EMPTY_ENUM,
        "34197 (0 = auto)",
        "UDP game port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "max_players",
        "Max players",
        TemplateParamKind::Int { min: 1, max: 1024 },
        false,
        "8",
        EMPTY_ENUM,
        "8",
        "Maximum number of players.",
        false,
    ),
    template_param(
        "server_name",
        "Server name",
        TemplateParamKind::String,
        false,
        "Alloy Factorio server",
        EMPTY_ENUM,
        "Alloy Factorio server",
        "Shown in the server list.",
        false,
    ),
    template_param(
        "server_description",
        "Server description",
        TemplateParamKind::String,
        false,
        "",
        EMPTY_ENUM,
        "",
        "Optional server description.",
        false,
    ),
    template_param(
        "public",
        "Public listing",
        TemplateParamKind::Bool,
        false,
        "false",
        EMPTY_ENUM,
        "",
        "Whether to list this server publicly.",
        false,
    ),
    template_param(
        "rcon_enabled",
        "Enable RCON",
        TemplateParamKind::Bool,
        false,
        "false",
        EMPTY_ENUM,
        "",
        "Enable RCON remote console.",
        false,
    ),
    template_param(
        "rcon_port",
        "RCON port",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "27015",
        EMPTY_ENUM,
        "27015 (0 = auto)",
        "RCON TCP port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "rcon_password",
        "RCON password",
        TemplateParamKind::SecretString,
        false,
        "",
        EMPTY_ENUM,
        "",
        "Required when RCON is enabled.",
        false,
    ),
];

const SEVEN_DAYS_PARAMS: &[AdapterTemplateParam] = &[
    template_param(
        "server_name",
        "Server name",
        TemplateParamKind::String,
        false,
        "Alloy 7 Days to Die server",
        EMPTY_ENUM,
        "Alloy 7 Days to Die server",
        "Shown in the server browser.",
        false,
    ),
    template_param(
        "world",
        "World",
        TemplateParamKind::String,
        false,
        "Navezgane",
        EMPTY_ENUM,
        "Navezgane",
        "World name (Navezgane or generated world id).",
        false,
    ),
    template_param(
        "game_name",
        "Save name",
        TemplateParamKind::String,
        false,
        "alloy",
        EMPTY_ENUM,
        "alloy",
        "Save game name (folder under save data).",
        false,
    ),
    template_param(
        "port",
        "Game port (UDP)",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "26900",
        EMPTY_ENUM,
        "26900 (0 = auto)",
        "Main game UDP port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "query_port",
        "Query port (UDP)",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "26901",
        EMPTY_ENUM,
        "26901 (0 = auto)",
        "Steam query UDP port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "control_panel_port",
        "Control panel port (TCP)",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "8080",
        EMPTY_ENUM,
        "8080 (0 = auto)",
        "Web control panel port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "max_players",
        "Max players",
        TemplateParamKind::Int { min: 1, max: 128 },
        false,
        "8",
        EMPTY_ENUM,
        "8",
        "Maximum number of players.",
        false,
    ),
    template_param(
        "password",
        "Password",
        TemplateParamKind::SecretString,
        false,
        "",
        EMPTY_ENUM,
        "",
        "Optional server password.",
        false,
    ),
];

const THE_FOREST_PARAMS: &[AdapterTemplateParam] = &[
    template_param(
        "server_name",
        "Server name",
        TemplateParamKind::String,
        false,
        "Alloy The Forest server",
        EMPTY_ENUM,
        "Alloy The Forest server",
        "Shown in the server browser.",
        false,
    ),
    template_param(
        "port",
        "Game port (UDP)",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "27015",
        EMPTY_ENUM,
        "27015 (0 = auto)",
        "Main game UDP port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "query_port",
        "Query port (UDP)",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "27016",
        EMPTY_ENUM,
        "27016 (0 = auto)",
        "Steam query UDP port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "max_players",
        "Max players",
        TemplateParamKind::Int { min: 1, max: 32 },
        false,
        "8",
        EMPTY_ENUM,
        "8",
        "Maximum number of players.",
        false,
    ),
    template_param(
        "password",
        "Password",
        TemplateParamKind::SecretString,
        false,
        "",
        EMPTY_ENUM,
        "",
        "Optional server password.",
        false,
    ),
];

const SONS_OF_THE_FOREST_PARAMS: &[AdapterTemplateParam] = &[
    template_param(
        "server_name",
        "Server name",
        TemplateParamKind::String,
        false,
        "Alloy Sons of the Forest server",
        EMPTY_ENUM,
        "Alloy Sons of the Forest server",
        "Shown in the server browser.",
        false,
    ),
    template_param(
        "port",
        "Game port (UDP)",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "8766",
        EMPTY_ENUM,
        "8766 (0 = auto)",
        "Main game UDP port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "query_port",
        "Query port (UDP)",
        TemplateParamKind::Int { min: 0, max: 65535 },
        false,
        "27016",
        EMPTY_ENUM,
        "27016 (0 = auto)",
        "Steam query UDP port. Use 0 to auto-assign.",
        false,
    ),
    template_param(
        "max_players",
        "Max players",
        TemplateParamKind::Int { min: 1, max: 16 },
        false,
        "8",
        EMPTY_ENUM,
        "8",
        "Maximum number of players.",
        false,
    ),
    template_param(
        "password",
        "Password",
        TemplateParamKind::SecretString,
        false,
        "",
        EMPTY_ENUM,
        "",
        "Optional server password.",
        false,
    ),
];

pub const MINIMAL_GENERIC_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "example:generic",
    display_name: "Example: Generic Server",
    startup_command: "/bin/sleep",
    startup_args: &["60"],
    params: MINIMAL_GENERIC_TEMPLATE_PARAMS,
    graceful_stdin: None,
    validator: None,
    ports: EMPTY_PORTS,
};

const MINECRAFT_VANILLA_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "minecraft:vanilla",
    display_name: "Minecraft: Vanilla",
    startup_command: "java",
    startup_args: &[],
    params: &[
        PARAM_ACCEPT_EULA,
        PARAM_MC_VERSION,
        PARAM_MC_MEMORY_MB,
        PARAM_MC_PORT,
    ],
    graceful_stdin: Some("stop\n"),
    validator: Some(validate_minecraft_vanilla),
    ports: PORTS_MC_AND_TERRARIA,
};

const MINECRAFT_MODRINTH_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "minecraft:modrinth",
    display_name: "Minecraft: Modrinth Pack",
    startup_command: "java",
    startup_args: &[],
    params: MINECRAFT_MODRINTH_PARAMS,
    graceful_stdin: Some("stop\n"),
    validator: Some(validate_minecraft_modrinth),
    ports: PORTS_MC_AND_TERRARIA,
};

const MINECRAFT_IMPORT_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "minecraft:import",
    display_name: "Minecraft: Import Pack",
    startup_command: "java",
    startup_args: &[],
    params: MINECRAFT_IMPORT_PARAMS,
    graceful_stdin: Some("stop\n"),
    validator: Some(validate_minecraft_import),
    ports: PORTS_MC_AND_TERRARIA,
};

const MINECRAFT_CURSEFORGE_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "minecraft:curseforge",
    display_name: "Minecraft: CurseForge Pack",
    startup_command: "java",
    startup_args: &[],
    params: MINECRAFT_CURSEFORGE_PARAMS,
    graceful_stdin: Some("stop\n"),
    validator: Some(validate_minecraft_curseforge),
    ports: PORTS_MC_AND_TERRARIA,
};

const TERRARIA_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "terraria:vanilla",
    display_name: "Terraria: Vanilla",
    startup_command: "./TerrariaServer.bin.x86_64",
    startup_args: &[],
    params: TERRARIA_PARAMS,
    graceful_stdin: Some("exit\n"),
    validator: Some(validate_terraria_vanilla),
    ports: PORTS_MC_AND_TERRARIA,
};

const DST_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "dst:vanilla",
    display_name: "Don't Starve Together",
    startup_command: "./dontstarve_dedicated_server_nullrenderer",
    startup_args: &[],
    params: DST_PARAMS,
    graceful_stdin: None,
    validator: Some(validate_dst_vanilla),
    ports: PORTS_DST,
};

const PALWORLD_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "palworld:vanilla",
    display_name: "Palworld: Vanilla",
    startup_command: "./PalServer.sh",
    startup_args: &[],
    params: PALWORLD_PARAMS,
    graceful_stdin: None,
    validator: Some(validate_palworld_vanilla),
    ports: PORTS_PAIR_UDP,
};

const FACTORIO_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "factorio:vanilla",
    display_name: "Factorio: Vanilla",
    startup_command: "./factorio",
    startup_args: &[],
    params: FACTORIO_PARAMS,
    graceful_stdin: Some("/quit\n"),
    validator: Some(validate_factorio_vanilla),
    ports: PORTS_FACTORIO,
};

const CORE_KEEPER_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "core_keeper:vanilla",
    display_name: "Core Keeper: Dedicated",
    startup_command: "./CoreKeeperServer",
    startup_args: &[],
    params: &[],
    graceful_stdin: None,
    validator: Some(validate_core_keeper_vanilla),
    ports: EMPTY_PORTS,
};

const SEVEN_DAYS_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "seven_days:vanilla",
    display_name: "7 Days to Die: Dedicated",
    startup_command: "./startserver.sh",
    startup_args: &[],
    params: SEVEN_DAYS_PARAMS,
    graceful_stdin: None,
    validator: Some(validate_seven_days_vanilla),
    ports: PORTS_SEVEN_DAYS,
};

const THE_FOREST_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "the_forest:vanilla",
    display_name: "The Forest: Dedicated",
    startup_command: "./TheForestDedicatedServer.x86_64",
    startup_args: &[],
    params: THE_FOREST_PARAMS,
    graceful_stdin: None,
    validator: Some(validate_the_forest_vanilla),
    ports: PORTS_PAIR_UDP,
};

const SONS_OF_THE_FOREST_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "sons_of_the_forest:vanilla",
    display_name: "Sons of the Forest: Dedicated",
    startup_command: "./SonsOfTheForestDS",
    startup_args: &[],
    params: SONS_OF_THE_FOREST_PARAMS,
    graceful_stdin: None,
    validator: Some(validate_sons_of_the_forest_vanilla),
    ports: PORTS_PAIR_UDP,
};

const ADAPTER_TEMPLATES: &[AdapterTemplate] = &[
    MINIMAL_GENERIC_TEMPLATE,
    MINECRAFT_VANILLA_TEMPLATE,
    MINECRAFT_MODRINTH_TEMPLATE,
    MINECRAFT_IMPORT_TEMPLATE,
    MINECRAFT_CURSEFORGE_TEMPLATE,
    TERRARIA_TEMPLATE,
    DST_TEMPLATE,
    PALWORLD_TEMPLATE,
    FACTORIO_TEMPLATE,
    CORE_KEEPER_TEMPLATE,
    SEVEN_DAYS_TEMPLATE,
    THE_FOREST_TEMPLATE,
    SONS_OF_THE_FOREST_TEMPLATE,
];

pub fn list_adapter_templates() -> &'static [AdapterTemplate] {
    ADAPTER_TEMPLATES
}

pub fn find_adapter_template(template_id: &str) -> Option<&'static AdapterTemplate> {
    ADAPTER_TEMPLATES
        .iter()
        .find(|t| t.template_id == template_id)
}

pub fn adapter_port_fields(template_id: &str) -> Option<&'static [PortField]> {
    find_adapter_template(template_id)
        .map(|t| t.ports)
        .filter(|ports| !ports.is_empty())
}

pub fn validate_required_params(
    template: &AdapterTemplate,
    params: &BTreeMap<String, String>,
) -> anyhow::Result<()> {
    for p in template.params {
        if !p.required {
            continue;
        }

        let value = params.get(p.key).map(|v| v.trim()).unwrap_or("");
        if value.is_empty() {
            anyhow::bail!("missing required param: {}", p.key);
        }
    }
    Ok(())
}

pub fn validate_template_params(
    template_id: &str,
    params: &BTreeMap<String, String>,
) -> anyhow::Result<bool> {
    let Some(template) = find_adapter_template(template_id) else {
        return Ok(false);
    };

    if let Some(validator) = template.validator {
        validator(params)?;
    } else {
        validate_required_params(template, params)?;
    }

    Ok(true)
}

fn validate_minecraft_vanilla(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::minecraft::validate_vanilla_params(params)?;
    Ok(())
}

fn validate_minecraft_modrinth(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::minecraft_modrinth::validate_params(params)?;
    Ok(())
}

fn validate_minecraft_import(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::minecraft_import::validate_params(params)?;
    Ok(())
}

fn validate_minecraft_curseforge(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::minecraft_curseforge::validate_params(params)?;
    Ok(())
}

fn validate_terraria_vanilla(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::terraria::validate_vanilla_params(params)?;
    Ok(())
}

fn validate_dst_vanilla(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::dst::validate_vanilla_params(params)?;
    Ok(())
}

fn validate_palworld_vanilla(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::palworld::validate_vanilla_params(params)?;
    Ok(())
}

fn validate_factorio_vanilla(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::factorio::validate_vanilla_params(params)?;
    Ok(())
}

fn validate_core_keeper_vanilla(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::core_keeper::validate_vanilla_params(params)?;
    Ok(())
}

fn validate_seven_days_vanilla(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::seven_days::validate_vanilla_params(params)?;
    Ok(())
}

fn validate_the_forest_vanilla(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::the_forest::validate_vanilla_params(params)?;
    Ok(())
}

fn validate_sons_of_the_forest_vanilla(params: &BTreeMap<String, String>) -> anyhow::Result<()> {
    let _ = crate::sons_of_the_forest::validate_vanilla_params(params)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_template_contract_unique_template_ids() {
        let mut ids = std::collections::HashSet::<&'static str>::new();
        for t in list_adapter_templates() {
            assert!(
                ids.insert(t.template_id),
                "duplicate template_id: {}",
                t.template_id
            );
        }
    }

    #[test]
    fn adapter_template_contract_params_are_well_formed() {
        for t in list_adapter_templates() {
            assert!(!t.template_id.trim().is_empty(), "empty template_id");
            assert!(
                !t.display_name.trim().is_empty(),
                "empty display_name for {}",
                t.template_id
            );
            assert!(
                !t.startup_command.trim().is_empty(),
                "empty startup_command for {}",
                t.template_id
            );

            if let Some(stdin) = t.graceful_stdin {
                assert!(
                    !stdin.is_empty(),
                    "empty graceful_stdin for {}",
                    t.template_id
                );
            }

            let mut keys = std::collections::HashSet::<&'static str>::new();
            for p in t.params {
                assert!(
                    keys.insert(p.key),
                    "duplicate param key {} in {}",
                    p.key,
                    t.template_id
                );
                assert!(
                    !p.key.trim().is_empty(),
                    "empty param key in {}",
                    t.template_id
                );
                assert!(
                    !p.label.trim().is_empty(),
                    "empty label for {}:{}",
                    t.template_id,
                    p.key
                );

                match p.kind {
                    TemplateParamKind::String | TemplateParamKind::SecretString => {
                        if !p.enum_values.is_empty() {
                            assert!(
                                p.enum_values.contains(&p.default_value),
                                "default_value not in enum for {}:{} (default={})",
                                t.template_id,
                                p.key,
                                p.default_value
                            );
                        }
                    }
                    TemplateParamKind::Bool => {
                        assert!(
                            p.default_value == "true" || p.default_value == "false",
                            "bool default must be \"true\" or \"false\" for {}:{} (default={})",
                            t.template_id,
                            p.key,
                            p.default_value
                        );
                    }
                    TemplateParamKind::Int { min, max } => {
                        assert!(
                            min <= max,
                            "int bounds invalid for {}:{}",
                            t.template_id,
                            p.key
                        );
                        if !p.default_value.trim().is_empty() {
                            let dv: i64 = p.default_value.trim().parse().unwrap_or_else(|_| {
                                panic!(
                                    "int default is not an integer for {}:{} (default={})",
                                    t.template_id, p.key, p.default_value
                                )
                            });
                            assert!(
                                (min..=max).contains(&dv),
                                "int default out of range for {}:{} (default={} range={}..={})",
                                t.template_id,
                                p.key,
                                dv,
                                min,
                                max
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn adapter_template_contract_port_fields_match_int_params() {
        for t in list_adapter_templates() {
            let params_by_key: std::collections::BTreeMap<&str, &AdapterTemplateParam> =
                t.params.iter().map(|p| (p.key, p)).collect();

            let mut seen = std::collections::HashSet::<&'static str>::new();
            for port in t.ports {
                assert!(
                    seen.insert(port.key),
                    "duplicate port field key {} in {}",
                    port.key,
                    t.template_id
                );

                let p = params_by_key.get(port.key).copied().unwrap_or_else(|| {
                    panic!(
                        "port field {} has no corresponding param in {}",
                        port.key, t.template_id
                    )
                });

                match p.kind {
                    TemplateParamKind::Int { min, max } => {
                        assert!(
                            min == 0 && max == 65535,
                            "port param kind must be Int {{min:0,max:65535}} for {}:{} (got min={}, max={})",
                            t.template_id,
                            p.key,
                            min,
                            max
                        );
                    }
                    _ => panic!(
                        "port field {} must map to an Int param in {}",
                        port.key, t.template_id
                    ),
                }
            }
        }
    }
}
