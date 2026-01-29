fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile_protos(&["proto/alloy/agent/v1/agent.proto"], &["proto"])?;

    println!("cargo:rerun-if-changed=proto/alloy/agent/v1/agent.proto");
    println!("cargo:rerun-if-changed=proto");

    Ok(())
}
