use std::{path::PathBuf, sync::Arc};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use gpui_kit::{Image, ImageFormat, ImageSource};

/// Materialize only the image view. The document's original src, portable
/// image ID and offline/upload metadata are never rewritten by decoding.
pub(super) fn source(src: &str) -> Result<ImageSource, String> {
    if let Some(data) = src.strip_prefix("data:") {
        let (header, payload) = data.split_once(',').ok_or("Malformed embedded image URL")?;
        let mut parameters = header.split(';');
        let mime = parameters.next().unwrap_or("");
        let format = ImageFormat::from_mime_type(mime)
            .ok_or_else(|| format!("Unsupported embedded image type: {mime}"))?;
        let base64 = parameters.any(|parameter| parameter.eq_ignore_ascii_case("base64"));
        let bytes = if base64 {
            STANDARD
                .decode(payload)
                .map_err(|_| "Malformed embedded image encoding")?
        } else {
            percent_decode(payload)?
        };
        if bytes.is_empty() {
            return Err("The embedded image is empty".into());
        }
        return Ok(ImageSource::Image(Arc::new(Image::from_bytes(
            format, bytes,
        ))));
    }
    if let Some(path) = src.strip_prefix("file://") {
        let bytes = percent_decode(path)?;
        let path = String::from_utf8(bytes).map_err(|_| "Invalid image file path")?;
        return Ok(PathBuf::from(path).into());
    }
    Ok(src.to_owned().into())
}

fn percent_decode(payload: &str) -> Result<Vec<u8>, String> {
    let mut result = Vec::with_capacity(payload.len());
    let bytes = payload.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes[cursor] == b'%' {
            let from = cursor + 1;
            let to = cursor + 3;
            let value = bytes.get(from..to).ok_or("Malformed escaped image URL")?;
            let value = std::str::from_utf8(value).map_err(|_| "Malformed escaped image URL")?;
            result.push(u8::from_str_radix(value, 16).map_err(|_| "Malformed escaped image URL")?);
            cursor = to;
        } else {
            result.push(bytes[cursor]);
            cursor += 1;
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_image_is_native_bytes_and_svg_escapes_are_not_form_decoded() {
        let png = include_bytes!("../../fixtures/editor/offline-landscape.png");
        let data = format!("data:image/png;base64,{}", STANDARD.encode(png));
        let ImageSource::Image(image) = source(&data).unwrap() else {
            panic!("Native bytes required for offline data images");
        };
        assert_eq!(image.format, ImageFormat::Png);
        assert_eq!(image.bytes, png);
        let svg = "data:image/svg+xml,%3Csvg%3E+%3C/svg%3E";
        let ImageSource::Image(image) = source(svg).unwrap() else {
            panic!("SVG must stay offline");
        };
        assert_eq!(image.bytes, b"<svg>+</svg>");
        assert!(source("data:image/png;base64,not-valid!").is_err());
    }
}
