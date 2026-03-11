pub(crate) use crate::modules::ai_upstream::LocalModelConnection;

pub(crate) fn to_string<T: std::fmt::Display>(err: T) -> String {
    err.to_string()
}
