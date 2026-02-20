use std::collections::{BTreeMap, HashSet};

use tonic::Status;

use crate::port_alloc;
use crate::game_adapter_template::PortProtocol;

pub fn ensure_adapter_ports(
    template_id: &str,
    params: &mut BTreeMap<String, String>,
) -> Result<bool, Status> {
    let Some(port_fields) = crate::game_adapter_template::adapter_port_fields(template_id) else {
        return Ok(false);
    };

    let mut used_tcp = HashSet::<u16>::new();
    let mut used_udp = HashSet::<u16>::new();

    for field in port_fields {
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
    for field in port_fields {
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
