use std::{io::ErrorKind, net::TcpListener};

use anyhow::Context;

pub fn allocate_tcp_port(preferred: u16) -> anyhow::Result<u16> {
    if preferred != 0 {
        // Validate availability.
        match TcpListener::bind(("0.0.0.0", preferred)) {
            Ok(l) => {
                l.set_nonblocking(true).ok();
            }
            Err(e) if e.kind() == ErrorKind::AddrInUse => {
                anyhow::bail!("port already in use: {preferred}");
            }
            Err(e) => {
                return Err(e).context(format!("bind port {preferred}"));
            }
        }
        return Ok(preferred);
    }

    // Ask OS for an ephemeral port.
    let listener = TcpListener::bind(("0.0.0.0", 0))?;
    let port = listener.local_addr()?.port();
    Ok(port)
}
