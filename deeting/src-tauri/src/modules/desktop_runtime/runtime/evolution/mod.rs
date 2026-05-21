//! # Evolution Signal Boundary
//!
//! Single API for all evolution-related inputs (explicit feedback, manual
//! revision, monitor reports, deeting_think preflight) and single output point
//! for the Cold-Start Packet that seeds cold-start chat sessions with prior +
//! case context.
//!
//! Only `ExplicitTraceFeedback` is allowed to promote into a `Case` — every
//! other source persists as an audit signal at most.

#![allow(dead_code)]

mod packet;
mod service;
mod store;
mod types;

pub(crate) use packet::{build_cold_start_packet, render_cold_start_packet_prompt};
pub(crate) use service::{list_evolution_signals_for_query, submit_evolution_signal};
pub(crate) use types::{
    EvolutionSignalClassification, EvolutionSignalDraft, EvolutionSignalSource,
};
