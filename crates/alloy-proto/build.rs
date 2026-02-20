fn main() -> Result<(), Box<dyn std::error::Error>> {
    let protoc = protoc_bin_vendored::protoc_bin_path()?;
    unsafe {
        std::env::set_var("PROTOC", protoc);
    }

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile_protos(
            &[
                "proto/alloy/agent/v1/agent.proto",
                "proto/alloy/agent/v1/filesystem.proto",
                "proto/alloy/agent/v1/instance.proto",
                "proto/alloy/agent/v1/logs.proto",
                "proto/alloy/agent/v1/process.proto",
            ],
            &["proto"],
        )?;

    println!("cargo:rerun-if-changed=proto/alloy/agent/v1/agent.proto");
    println!("cargo:rerun-if-changed=proto/alloy/agent/v1/filesystem.proto");
    println!("cargo:rerun-if-changed=proto/alloy/agent/v1/instance.proto");
    println!("cargo:rerun-if-changed=proto/alloy/agent/v1/logs.proto");
    println!("cargo:rerun-if-changed=proto/alloy/agent/v1/process.proto");
    println!("cargo:rerun-if-changed=proto");

    Ok(())
}
