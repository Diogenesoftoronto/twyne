use std::error::Error;
use std::ffi::OsStr;
use std::fmt;
use std::num::ParseIntError;

pub const MIN_CAPTURE_WIDTH: u32 = 320;
pub const MAX_CAPTURE_WIDTH: u32 = 3840;
pub const MIN_CAPTURE_HEIGHT: u32 = 360;
pub const MAX_CAPTURE_HEIGHT: u32 = 2160;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureSizeError {
    MissingSeparator,
    InvalidWidth(ParseIntError),
    InvalidHeight(ParseIntError),
    OutOfBounds,
}

impl fmt::Display for CaptureSizeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            CaptureSizeError::MissingSeparator => "--capture-size needs WIDTHxHEIGHT",
            CaptureSizeError::InvalidWidth(_) => "Invalid capture width",
            CaptureSizeError::InvalidHeight(_) => "Invalid capture height",
            CaptureSizeError::OutOfBounds => "Capture size must be 320–3840 by 360–2160 pixels.",
        };
        formatter.write_str(message)
    }
}

impl Error for CaptureSizeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidWidth(error) | Self::InvalidHeight(error) => Some(error),
            Self::MissingSeparator | Self::OutOfBounds => None,
        }
    }
}

pub fn parse_capture_size(value: &OsStr) -> Result<(u32, u32), CaptureSizeError> {
    let text = value.to_string_lossy();
    let (width_text, height_text) = text
        .split_once('x')
        .ok_or(CaptureSizeError::MissingSeparator)?;
    let width = width_text
        .parse::<u32>()
        .map_err(CaptureSizeError::InvalidWidth)?;
    let height = height_text
        .parse::<u32>()
        .map_err(CaptureSizeError::InvalidHeight)?;
    if !(MIN_CAPTURE_WIDTH..=MAX_CAPTURE_WIDTH).contains(&width)
        || !(MIN_CAPTURE_HEIGHT..=MAX_CAPTURE_HEIGHT).contains(&height)
    {
        return Err(CaptureSizeError::OutOfBounds);
    }
    Ok((width, height))
}
