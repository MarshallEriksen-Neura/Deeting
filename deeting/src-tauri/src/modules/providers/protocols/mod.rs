pub mod bridge;
pub mod canonical;
pub mod content;
pub mod profile;

pub use bridge::{
    build_canonical_request_from_value, build_protocol_profile, infer_protocol_family,
    template_matches_family,
};
pub use canonical::{
    CanonicalClientContext, CanonicalInputItem, CanonicalMessage, CanonicalRequest,
    CanonicalToolCall,
};
pub(crate) use content::parse_structured_message_content;
pub use profile::{
    ProfileAuthConfig, ProfileDefaults, ProfileFeatureFlags, ProfileRequestConfig,
    ProfileResponseConfig, ProfileStreamConfig, ProfileTransport, ProtocolProfile, RuntimeHook,
};
