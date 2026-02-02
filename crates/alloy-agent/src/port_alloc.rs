use std::net::TcpListener;

pub fn allocate_tcp_port(preferred: u16) -> anyhow::Result<u16> {
    if preferred != 0 {
        // Validate availability.
        TcpListener::bind(("0.0.0.0", preferred))?
            .set_nonblocking(true)
            .ok();
        return Ok(preferred);
    }

    // Ask OS for an ephemeral port.
    let listener = TcpListener::bind(("0.0.0.0", 0))?;
    let port = listener.local_addr()?.port();
    Ok(port)
}
