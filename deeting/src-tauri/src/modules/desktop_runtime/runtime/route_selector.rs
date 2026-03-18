#[cfg(test)]
pub(crate) use mcp_runtime::route::select_local_route;
pub(crate) use mcp_runtime::route::{
    render_local_route_prompt, select_local_route_with_evidence, LocalRouteDecision, LocalRouteKind,
};
