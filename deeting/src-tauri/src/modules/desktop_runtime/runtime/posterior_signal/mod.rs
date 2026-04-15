mod resolver;
mod rules;
mod types;

pub(crate) use resolver::{
    resolve_posterior_signal, should_apply_posterior_signal, HeuristicPosteriorSignalBackend,
};
pub(crate) use types::{
    PosteriorSignalBackend, PosteriorSignalDecision, PosteriorSignalInput, PosteriorSignalKind,
    PosteriorSignalSource,
};
