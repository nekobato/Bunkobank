use std::fmt::{Display, Formatter};

pub type Result<T> = std::result::Result<T, Bec1Error>;

#[derive(Debug)]
pub struct Bec1Error {
    pub code: &'static str,
    pub message: String,
}

impl Bec1Error {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn authentication() -> Self {
        Self::new(
            "AUTHENTICATION_FAILED",
            "The password is incorrect or the container has been modified.",
        )
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("INVALID_CONTAINER", message)
    }

    pub fn unsafe_parameters(message: impl Into<String>) -> Self {
        Self::new("UNSAFE_PARAMETERS", message)
    }
}

impl Display for Bec1Error {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for Bec1Error {}

impl From<std::io::Error> for Bec1Error {
    fn from(error: std::io::Error) -> Self {
        Self::new("IO_ERROR", error.to_string())
    }
}

impl From<serde_json::Error> for Bec1Error {
    fn from(error: serde_json::Error) -> Self {
        Self::new("INVALID_INPUT", error.to_string())
    }
}
