include!("../../src/launch_arguments.rs");

#[derive(Debug, PartialEq, Eq)]
enum Failure {
    MissingSeparator,
    InvalidWidth,
    InvalidHeight,
    OutOfBounds,
}

fn classify(error: CaptureSizeError) -> Failure {
    match error {
        CaptureSizeError::MissingSeparator => Failure::MissingSeparator,
        CaptureSizeError::InvalidWidth(_) => Failure::InvalidWidth,
        CaptureSizeError::InvalidHeight(_) => Failure::InvalidHeight,
        CaptureSizeError::OutOfBounds => Failure::OutOfBounds,
    }
}

fn parse(input: &str) -> Result<(u32, u32), Failure> {
    parse_capture_size(OsStr::new(input)).map_err(classify)
}

#[test]
fn accepts_inclusive_lower_bounds() {
    assert_eq!(parse("320x360"), Ok((320, 360)));
}

#[test]
fn accepts_inclusive_upper_bounds() {
    assert_eq!(parse("3840x2160"), Ok((3840, 2160)));
}

#[test]
fn accepts_mixed_corner_bounds() {
    assert_eq!(parse("320x2160"), Ok((320, 2160)));
    assert_eq!(parse("3840x360"), Ok((3840, 360)));
}

#[test]
fn accepts_plus_signs_like_u32_parse() {
    assert_eq!(parse("+320x+360"), Ok((320, 360)));
    assert_eq!(parse("+3840x+2160"), Ok((3840, 2160)));
}

#[test]
fn rejects_negative_signs_as_parse_errors() {
    assert_eq!(parse("-320x360"), Err(Failure::InvalidWidth));
    assert_eq!(parse("320x-360"), Err(Failure::InvalidHeight));
}

#[test]
fn rejects_surrounding_whitespace() {
    assert_eq!(parse(" 320x360"), Err(Failure::InvalidWidth));
    assert_eq!(parse("320 x360"), Err(Failure::InvalidWidth));
    assert_eq!(parse("320x 360"), Err(Failure::InvalidHeight));
    assert_eq!(parse("320x360 "), Err(Failure::InvalidHeight));
}

#[test]
fn rejects_uppercase_separator() {
    assert_eq!(parse("320X360"), Err(Failure::MissingSeparator));
}

#[test]
fn rejects_missing_separator() {
    assert_eq!(parse("320"), Err(Failure::MissingSeparator));
    assert_eq!(parse(""), Err(Failure::MissingSeparator));
    assert_eq!(parse("320:360"), Err(Failure::MissingSeparator));
}

#[test]
fn treats_extra_separator_as_height_parse_error() {
    assert_eq!(parse("320x360x2"), Err(Failure::InvalidHeight));
}

#[test]
fn rejects_overflow() {
    assert_eq!(parse("4294967296x2160"), Err(Failure::InvalidWidth));
    assert_eq!(parse("320x4294967296"), Err(Failure::InvalidHeight));
    assert_eq!(
        parse("99999999999999999999x2160"),
        Err(Failure::InvalidWidth)
    );
}

#[test]
fn width_parse_precedes_height_parse() {
    assert_eq!(parse("abcxdef"), Err(Failure::InvalidWidth));
}

#[test]
fn width_parse_precedes_bounds() {
    assert_eq!(parse("abcx5000"), Err(Failure::InvalidWidth));
}

#[test]
fn height_parse_precedes_bounds() {
    assert_eq!(parse("100xabc"), Err(Failure::InvalidHeight));
}

#[test]
fn rejects_out_of_bounds() {
    assert_eq!(parse("319x360"), Err(Failure::OutOfBounds));
    assert_eq!(parse("3841x2160"), Err(Failure::OutOfBounds));
    assert_eq!(parse("320x359"), Err(Failure::OutOfBounds));
    assert_eq!(parse("320x2161"), Err(Failure::OutOfBounds));
    assert_eq!(parse("0x0"), Err(Failure::OutOfBounds));
}

#[test]
fn missing_separator_precedes_parse_errors() {
    assert_eq!(parse("abc"), Err(Failure::MissingSeparator));
}

#[test]
fn displays_exact_messages() {
    for (input, expected) in [
        ("missing", "--capture-size needs WIDTHxHEIGHT"),
        ("badx360", "Invalid capture width"),
        ("320xbad", "Invalid capture height"),
        (
            "319x360",
            "Capture size must be 320–3840 by 360–2160 pixels.",
        ),
    ] {
        assert_eq!(
            parse_capture_size(OsStr::new(input))
                .unwrap_err()
                .to_string(),
            expected
        );
    }
}

#[test]
fn parse_errors_keep_the_original_context_cause() {
    for (input, raw) in [
        ("badx360", "bad"),
        ("320xbad", "bad"),
        ("4294967296x360", "4294967296"),
        ("320x4294967296", "4294967296"),
    ] {
        let error = parse_capture_size(OsStr::new(input)).unwrap_err();
        assert_eq!(
            error.source().unwrap().to_string(),
            raw.parse::<u32>().unwrap_err().to_string()
        );
    }
    for input in ["missing", "319x360"] {
        assert!(
            parse_capture_size(OsStr::new(input))
                .unwrap_err()
                .source()
                .is_none()
        );
    }
}

#[test]
fn implements_std_error() {
    fn assert_error<E: std::error::Error>(_: &E) {}
    assert_error(&CaptureSizeError::OutOfBounds);
}

#[cfg(unix)]
#[test]
fn unix_non_utf8_width_is_lossy_parse_error() {
    use std::os::unix::ffi::OsStrExt;
    let value = OsStr::from_bytes(b"\xFFx360");
    assert_eq!(
        parse_capture_size(value).map_err(classify),
        Err(Failure::InvalidWidth)
    );
}

#[cfg(unix)]
#[test]
fn unix_non_utf8_height_is_lossy_parse_error() {
    use std::os::unix::ffi::OsStrExt;
    let value = OsStr::from_bytes(b"320x\xFF");
    assert_eq!(
        parse_capture_size(value).map_err(classify),
        Err(Failure::InvalidHeight)
    );
}
