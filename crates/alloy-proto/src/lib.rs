// Re-export compiled gRPC protos.
//
// We keep all `.proto` files within this crate so other crates can depend on a
// single Rust type source.

pub mod alloy {
    pub mod agent {
        pub mod v1 {
            tonic::include_proto!("alloy.agent.v1");
        }
    }
}

pub use alloy::agent::v1 as agent_v1;
