use std::collections::{BTreeMap, HashSet};

use tonic::Status;

use crate::port_alloc;

#[derive(Clone, Copy, Debug)]
enum PortProtocol {
    Tcp,
    Udp,
}

#[derive(Clone, Copy, Debug)]
struct PortField {
    key: &'static str,
    protocol: PortProtocol,
}

const PORTS_MC_AND_TERRARIA: &[PortField] = &[PortField {
    key: "port",
    protocol: PortProtocol::Tcp,
}];

const PORTS_FACTORIO: &[PortField] = &[PortField {
    key: "port",
    protocol: PortProtocol::Udp,
}];

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

const ADAPTERS: &[(&str, &[PortField])] = &[
    ("minecraft:vanilla", PORTS_MC_AND_TERRARIA),
    ("minecraft:modrinth", PORTS_MC_AND_TERRARIA),
    ("minecraft:import", PORTS_MC_AND_TERRARIA),
    ("minecraft:curseforge", PORTS_MC_AND_TERRARIA),
    ("terraria:vanilla", PORTS_MC_AND_TERRARIA),
    ("factorio:vanilla", PORTS_FACTORIO),
    ("palworld:vanilla", PORTS_PAIR_UDP),
    ("the_forest:vanilla", PORTS_PAIR_UDP),
    ("sons_of_the_forest:vanilla", PORTS_PAIR_UDP),
    ("seven_days:vanilla", PORTS_SEVEN_DAYS),
    ("dst:vanilla", PORTS_DST),
];

pub fn ensure_adapter_ports(
    template_id: &str,
    params: &mut BTreeMap<String, String>,
) -> Result<bool, Status> {
    let Some((_, port_fields)) = ADAPTERS.iter().find(|(id, _)| *id == template_id) else {
        return Ok(false);
    };

    let mut used_tcp = HashSet::<u16>::new();
    let mut used_udp = HashSet::<u16>::new();

    for field in *port_fields {
        let current = params.get(field.key).map(|v| v.trim()).unwrap_or("");
        if current.is_empty() || current == "0" {
            continue;
        }
        if let Ok(port) = current.parse::<u16>()
            && port != 0
        {
            match field.protocol {
                PortProtocol::Tcp => {
                    used_tcp.insert(port);
                }
                PortProtocol::Udp => {
                    used_udp.insert(port);
                }
            }
        }
    }

    let mut changed = false;
    for field in *port_fields {
        let current = params.get(field.key).map(|v| v.trim()).unwrap_or("");
        if !current.is_empty() && current != "0" {
            continue;
        }

        let mut picked: Option<u16> = None;
        for _ in 0..16 {
            let candidate = match field.protocol {
                PortProtocol::Tcp => port_alloc::allocate_tcp_port(0),
                PortProtocol::Udp => port_alloc::allocate_udp_port(0),
            }
            .map_err(|e| Status::internal(format!("failed to allocate port: {e}")))?;

            if candidate == 0 {
                continue;
            }

            let is_conflict = match field.protocol {
                PortProtocol::Tcp => used_tcp.contains(&candidate),
                PortProtocol::Udp => used_udp.contains(&candidate),
            };
            if is_conflict {
                continue;
            }

            match field.protocol {
                PortProtocol::Tcp => {
                    used_tcp.insert(candidate);
                }
                PortProtocol::Udp => {
                    used_udp.insert(candidate);
                }
            }
            picked = Some(candidate);
            break;
        }

        let Some(port) = picked else {
            return Err(Status::internal("failed to allocate unique ports"));
        };

        params.insert(field.key.to_string(), port.to_string());
        changed = true;
    }

    Ok(changed)
}
