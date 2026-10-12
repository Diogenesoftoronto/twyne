//! Local counterpart of the web's explicit offline image upload adapter.
//!
//! Imported files become original-byte data URLs. Reading does not mutate a
//! folio: the application owns active-document guards, insertion and undo.
//! GIF/WebP/APNG frames are validated but never flattened or re-encoded here.

use crate::editor::ImageAttributes;
use anyhow::{Context, Result, ensure};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{
    AnimationDecoder, DynamicImage, Frames, ImageDecoder, ImageFormat, ImageReader, Limits,
    codecs::{gif::GifDecoder, png::PngDecoder, webp::WebPDecoder},
    metadata::Orientation,
};
use std::{
    fs::File,
    io::{Cursor, Read},
    path::Path,
};
use uuid::Uuid;

/// Exact public boundary from `src/utils/image-upload.ts`.
pub const MAX_IMAGE_UPLOAD_BYTES: usize = 10 * 1024 * 1024;
pub const ACCEPTED_IMAGE_TYPES: &[&str] = &["image/gif", "image/jpeg", "image/png", "image/webp"];

/// Additional native decoded-resource boundaries. The web upload adapter only
/// limits compressed bytes. Decoder allocation limits are best effort; edge,
/// pixel, frame-count and cumulative-frame limits are explicitly enforced.
pub const MAX_IMAGE_EDGE_PX: u32 = 16_384;
pub const MAX_IMAGE_PIXELS: u64 = 32_000_000;
pub const MAX_IMAGE_DECODE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_IMAGE_FRAMES: usize = 256;
pub const MAX_ANIMATION_PIXELS: u64 = 128_000_000;

#[derive(Clone, Debug, PartialEq)]
pub struct ImportedImage {
    pub attributes: ImageAttributes,
    /// Actual successfully decoded MIME type, independent of the filename.
    pub content_type: &'static str,
    pub byte_len: usize,
    /// Natural display dimensions after EXIF orientation, as for browser img.
    pub width_px: u32,
    pub height_px: u32,
    pub frame_count: usize,
}

/// Read and validate on a background worker, then insert these attributes only
/// if the application's active folio/revision guard still matches.
pub fn load_image_file(path: &Path) -> Result<ImageAttributes> {
    Ok(load_image_file_with_metadata(path)?.attributes)
}

pub fn load_image_file_with_metadata(path: &Path) -> Result<ImportedImage> {
    let file = File::open(path).context("The selected image could not be opened.")?;
    let metadata = file
        .metadata()
        .context("The selected image could not be read.")?;
    ensure!(metadata.is_file(), "Choose a local image file.");
    ensure!(metadata.len() > 0, "The selected image is empty.");
    ensure!(
        metadata.len() <= MAX_IMAGE_UPLOAD_BYTES as u64,
        "Images must be 10 MB or smaller."
    );
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_IMAGE_UPLOAD_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .context("The selected image could not be read.")?;
    // Recheck actual bytes: a selected file can grow or shrink after metadata.
    ensure!(!bytes.is_empty(), "The selected image is empty.");
    ensure!(
        bytes.len() <= MAX_IMAGE_UPLOAD_BYTES,
        "Images must be 10 MB or smaller."
    );
    let decoded = validate_image(&bytes)?;
    let filename = path
        .file_name()
        .context("Choose a local image file.")?
        .to_string_lossy();
    let attributes = ImageAttributes {
        src: format!(
            "data:{};base64,{}",
            decoded.content_type,
            STANDARD.encode(&bytes)
        ),
        alt: original_alt(&filename),
        aspect_ratio: Some(f64::from(decoded.width_px) / f64::from(decoded.height_px)),
        offline: true,
        upload_id: Some(Uuid::new_v4().to_string()),
        ..ImageAttributes::default()
    };
    Ok(ImportedImage {
        attributes,
        content_type: decoded.content_type,
        byte_len: bytes.len(),
        width_px: decoded.width_px,
        height_px: decoded.height_px,
        frame_count: decoded.frame_count,
    })
}

struct DecodedImage {
    content_type: &'static str,
    width_px: u32,
    height_px: u32,
    frame_count: usize,
}
fn validate_image(bytes: &[u8]) -> Result<DecodedImage> {
    let format = image::guess_format(bytes).context("Choose a PNG, JPEG, GIF, or WebP image.")?;
    let content_type = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Gif => "image/gif",
        ImageFormat::WebP => "image/webp",
        _ => anyhow::bail!("Choose a PNG, JPEG, GIF, or WebP image."),
    };
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(decoder_limits());
    let mut decoder = reader
        .into_decoder()
        .map_err(decoder_error)
        .context("The selected image could not be decoded.")?;
    let (width, height) = decoder.dimensions();
    validate_dimensions(width, height)?;
    ensure!(
        decoder.total_bytes() <= MAX_IMAGE_DECODE_BYTES,
        "The image needs more than 256 MiB of decoded memory."
    );
    let orientation = decoder
        .orientation()
        .context("The image orientation could not be read.")?;
    // Reserve output in the decoder budget, matching ImageReader::decode.
    let mut limits = decoder_limits();
    limits
        .reserve(decoder.total_bytes())
        .context("The image needs more than 256 MiB of decoded memory.")?;
    decoder
        .set_limits(limits)
        .context("The selected image exceeds the native decoder limits.")?;
    // Successful header parsing is insufficient: decode real pixels as well.
    let decoded =
        DynamicImage::from_decoder(decoder).context("The selected image could not be decoded.")?;
    ensure!(
        decoded.width() == width && decoded.height() == height,
        "The image decoder returned inconsistent dimensions."
    );
    drop(decoded);
    let (width_px, height_px) = oriented_dimensions(width, height, orientation);
    let frame_count = validate_animation(bytes, format)?;
    Ok(DecodedImage {
        content_type,
        width_px,
        height_px,
        frame_count,
    })
}
fn decoder_error(error: image::ImageError) -> anyhow::Error {
    if matches!(&error, image::ImageError::Limits(limit) if limit.kind() == image::error::LimitErrorKind::DimensionError)
    {
        anyhow::anyhow!("Images must be 16,384 pixels or smaller on each edge.")
    } else {
        error.into()
    }
}
fn decoder_limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_EDGE_PX);
    limits.max_image_height = Some(MAX_IMAGE_EDGE_PX);
    limits.max_alloc = Some(MAX_IMAGE_DECODE_BYTES);
    limits
}
fn validate_dimensions(width: u32, height: u32) -> Result<()> {
    ensure!(
        width > 0 && height > 0,
        "The image has no readable dimensions."
    );
    ensure!(
        width <= MAX_IMAGE_EDGE_PX && height <= MAX_IMAGE_EDGE_PX,
        "Images must be 16,384 pixels or smaller on each edge."
    );
    ensure!(
        u64::from(width) * u64::from(height) <= MAX_IMAGE_PIXELS,
        "Images must be 32 megapixels or smaller."
    );
    Ok(())
}
fn oriented_dimensions(width: u32, height: u32, orientation: Orientation) -> (u32, u32) {
    match orientation {
        Orientation::Rotate90
        | Orientation::Rotate270
        | Orientation::Rotate90FlipH
        | Orientation::Rotate270FlipH => (height, width),
        _ => (width, height),
    }
}
fn validate_animation(bytes: &[u8], format: ImageFormat) -> Result<usize> {
    match format {
        ImageFormat::Gif => {
            let mut decoder = GifDecoder::new(Cursor::new(bytes))?;
            decoder.set_limits(decoder_limits())?;
            validate_frames(decoder.into_frames())
        }
        ImageFormat::WebP => {
            let mut decoder = WebPDecoder::new(Cursor::new(bytes))?;
            decoder.set_limits(decoder_limits())?;
            if decoder.has_animation() {
                validate_frames(decoder.into_frames())
            } else {
                Ok(1)
            }
        }
        ImageFormat::Png => {
            let decoder = PngDecoder::with_limits(Cursor::new(bytes), decoder_limits())?;
            if decoder.is_apng()? {
                validate_frames(decoder.apng()?.into_frames())
            } else {
                Ok(1)
            }
        }
        _ => Ok(1),
    }
    .context("The image animation could not be decoded.")
}
fn validate_frames(frames: Frames<'_>) -> Result<usize> {
    let mut frame_count = 0;
    let mut pixels = 0_u64;
    for frame in frames {
        ensure!(
            frame_count < MAX_IMAGE_FRAMES,
            "Animations must have 256 frames or fewer."
        );
        let frame = frame.context("An image animation frame is damaged.")?;
        let (width, height) = frame.buffer().dimensions();
        validate_dimensions(width, height)?;
        pixels += u64::from(width) * u64::from(height);
        ensure!(
            pixels <= MAX_ANIMATION_PIXELS,
            "Animations must have 128 megapixels or fewer across their frames."
        );
        frame_count += 1;
    }
    ensure!(
        frame_count > 0,
        "The image animation has no readable frames."
    );
    Ok(frame_count)
}
/// Exact `file.name.replace(/\.[^.]+$/, "")`, including dotfiles/trailing dots.
fn original_alt(filename: &str) -> String {
    filename
        .rsplit_once('.')
        .filter(|(_, suffix)| !suffix.is_empty())
        .map_or(filename, |(stem, _)| stem)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::{ImageAlignment, RichDocument};
    use image::{Frame, Rgba, RgbaImage, codecs::gif::GifEncoder};
    use serde_json::{Value, json};
    use std::{fs, sync::Arc};

    fn fixture_path(name: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures/image-import")
            .join(name)
    }
    fn imported_as(bytes: &[u8], filename: &str) -> ImportedImage {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(filename);
        fs::write(&path, bytes).unwrap();
        load_image_file_with_metadata(&path).unwrap()
    }
    fn payload(image: &ImageAttributes) -> Vec<u8> {
        STANDARD
            .decode(image.src.split_once(',').unwrap().1)
            .unwrap()
    }
    #[test]
    fn ready_metadata_and_original_data_urls_match_actual_browser_offline_imports() {
        let reference: Value =
            serde_json::from_str(include_str!("../fixtures/image-import/web-reference.json"))
                .unwrap();
        assert_eq!(reference["blockedNetworkRequests"], 0);
        for case in reference["cases"].as_array().unwrap() {
            let bytes = fs::read(fixture_path(case["fixture"].as_str().unwrap())).unwrap();
            let imported = imported_as(&bytes, case["filename"].as_str().unwrap());
            let expected = &case["result"];
            let attrs = &imported.attributes;
            assert_eq!(
                json!({"src":attrs.src,"alt":attrs.alt,"caption":attrs.caption,
                "alignment":"center","width":attrs.width,"aspectRatio":attrs.aspect_ratio,"imageId":attrs.image_id,
                "offline":attrs.offline,"uploadId":"<upload-id>","uploadStatus":attrs.upload_status,"uploadError":attrs.upload_error}),
                {
                    let mut attributes = expected["attrs"].clone();
                    attributes.as_object_mut().unwrap().remove("uploadProgress");
                    attributes
                }
            );
            assert_eq!(attrs.alignment, ImageAlignment::Center);
            assert!(attrs.extra_attributes.is_empty());
            Uuid::parse_str(attrs.upload_id.as_deref().unwrap()).unwrap();
            assert_eq!(
                imported.content_type,
                expected["uploaded"]["contentType"].as_str().unwrap()
            );
            assert_eq!(
                imported.byte_len as u64,
                expected["uploaded"]["size"].as_u64().unwrap()
            );
            assert_eq!(
                imported.width_px as u64,
                expected["width"].as_u64().unwrap()
            );
            assert_eq!(
                imported.height_px as u64,
                expected["height"].as_u64().unwrap()
            );
            assert_eq!(attrs.src, expected["uploaded"]["src"].as_str().unwrap());
            assert_eq!(payload(attrs), bytes);
            // The original figure defaults and original bytes survive the
            // actual native HTML projection round trip, without a file URI.
            let document = RichDocument::new(vec![attrs.node()]);
            let html = document.to_html();
            assert!(html.contains("data-image-offline=\"true\""));
            assert!(html.contains("data-upload-status=\"ready\""));
            assert_eq!(RichDocument::from_html(&html).unwrap().to_html(), html);
            assert!(!html.contains("file://"));
        }
    }
    #[test]
    fn real_decoded_format_wins_over_filename_and_later_file_changes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("An image.jpg");
        let bytes = include_bytes!("../fixtures/image-import/plate.png");
        fs::write(&path, bytes).unwrap();
        let imported = load_image_file_with_metadata(&path).unwrap();
        assert_eq!(imported.content_type, "image/png");
        assert!(
            imported
                .attributes
                .src
                .starts_with("data:image/png;base64,")
        );
        fs::write(&path, b"changed after import").unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(payload(&imported.attributes), bytes);
        let jpeg = imported_as(
            include_bytes!("../fixtures/image-import/plate.jpg"),
            "Photograph.png",
        );
        assert_eq!(jpeg.content_type, "image/jpeg");
        assert!(jpeg.attributes.src.starts_with("data:image/jpeg;base64,"));
    }
    #[test]
    fn empty_unsupported_corrupt_and_oversized_files_return_explicit_errors() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("plate.png");
        fs::write(&path, []).unwrap();
        assert!(format!("{:#}", load_image_file(&path).unwrap_err()).contains("image is empty"));
        fs::write(
            &path,
            b"<svg xmlns='http://www.w3.org/2000/svg' width='3' height='2'/>",
        )
        .unwrap();
        assert!(
            format!("{:#}", load_image_file(&path).unwrap_err())
                .contains("PNG, JPEG, GIF, or WebP")
        );
        fs::write(
            &path,
            &include_bytes!("../fixtures/image-import/plate.png")[..25],
        )
        .unwrap();
        assert!(
            format!("{:#}", load_image_file(&path).unwrap_err()).contains("could not be decoded")
        );
        File::create(&path)
            .unwrap()
            .set_len(MAX_IMAGE_UPLOAD_BYTES as u64 + 1)
            .unwrap();
        assert!(format!("{:#}", load_image_file(&path).unwrap_err()).contains("10 MB or smaller"));
        assert!(load_image_file(directory.path()).is_err());
        assert!(load_image_file(&directory.path().join("missing.png")).is_err());
    }
    fn png_with_dimensions(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = include_bytes!("../fixtures/image-import/plate.png").to_vec();
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        bytes[20..24].copy_from_slice(&height.to_be_bytes());
        let mut crc = u32::MAX;
        for byte in &bytes[12..29] {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ if crc & 1 != 0 { 0xedb88320 } else { 0 };
            }
        }
        bytes[29..33].copy_from_slice(&(crc ^ u32::MAX).to_be_bytes());
        bytes
    }
    #[test]
    fn compressed_headers_cannot_bypass_dimension_and_pixel_bounds() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("header.png");
        fs::write(&path, png_with_dimensions(MAX_IMAGE_EDGE_PX + 1, 1)).unwrap();
        assert!(format!("{:#}", load_image_file(&path).unwrap_err()).contains("16,384"));
        fs::write(&path, png_with_dimensions(8000, 4001)).unwrap();
        assert!(format!("{:#}", load_image_file(&path).unwrap_err()).contains("32 megapixels"));
        fs::write(&path, png_with_dimensions(0, 2)).unwrap();
        assert!(load_image_file(&path).is_err());
    }
    #[test]
    fn animations_are_fully_validated_and_original_frames_remain_embedded() {
        for name in ["animated.gif", "animated.webp", "animated.png"] {
            let bytes = fs::read(fixture_path(name)).unwrap();
            let imported = imported_as(&bytes, name);
            assert_eq!(imported.frame_count, 2, "{name}");
            assert_eq!(payload(&imported.attributes), bytes);
        }
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("many.gif");
        let mut bytes = Vec::new();
        {
            let mut encoder = GifEncoder::new(&mut bytes);
            for index in 0..=MAX_IMAGE_FRAMES {
                encoder
                    .encode_frame(Frame::new(RgbaImage::from_pixel(
                        1,
                        1,
                        Rgba([index as u8, 0, 0, 255]),
                    )))
                    .unwrap();
            }
        }
        fs::write(&path, &bytes).unwrap();
        assert!(
            format!("{:#}", load_image_file(&path).unwrap_err()).contains("256 frames or fewer")
        );
        // A valid first GIF frame must not hide a truncated later frame.
        let mut damaged = include_bytes!("../fixtures/image-import/animated.gif").to_vec();
        damaged.truncate(damaged.len() - 4);
        fs::write(&path, damaged).unwrap();
        assert!(format!("{:#}", load_image_file(&path).unwrap_err()).contains("frame is damaged"));
    }
    #[test]
    fn pinned_gpui_matches_browser_exif_dimensions_and_reports_animation_scope() {
        let renderer = gpui_kit::SvgRenderer::new(Arc::new(crate::assets::TwyneAssets));
        for (fixture, format, native_frames) in [
            ("rotated.jpg", gpui_kit::ImageFormat::Jpeg, 1),
            ("animated.gif", gpui_kit::ImageFormat::Gif, 2),
            ("animated.webp", gpui_kit::ImageFormat::Webp, 1),
            ("animated.png", gpui_kit::ImageFormat::Png, 1),
        ] {
            let imported = load_image_file_with_metadata(&fixture_path(fixture)).unwrap();
            let original = payload(&imported.attributes);
            let rendered = gpui_kit::Image::from_bytes(format, original.clone())
                .to_image_data(renderer.clone())
                .unwrap();
            assert_eq!(u32::from(rendered.size(0).width), imported.width_px);
            assert_eq!(u32::from(rendered.size(0).height), imported.height_px);
            assert_eq!(rendered.frame_count(), native_frames);
            if fixture == "rotated.jpg" {
                assert_eq!((imported.width_px, imported.height_px), (2, 3));
                let mut decoder =
                    ImageReader::with_format(Cursor::new(&original), ImageFormat::Jpeg)
                        .into_decoder()
                        .unwrap();
                let orientation = decoder.orientation().unwrap();
                let mut decoded = DynamicImage::from_decoder(decoder).unwrap();
                decoded.apply_orientation(orientation);
                let mut bgra = decoded.into_rgba8().into_raw();
                for pixel in bgra.as_chunks_mut::<4>().0 {
                    pixel.swap(0, 2);
                }
                assert_eq!(rendered.as_bytes(0).unwrap(), bgra);
            }
        }
    }

    #[test]
    fn exact_ten_mib_html_reopens_but_original_source_limit_rejects_conversion() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Full boundary.png");
        // The PNG remains valid: padding after IEND exercises the original
        // compressed-byte boundary without allocating a huge decoded bitmap.
        fs::write(&path, include_bytes!("../fixtures/image-import/plate.png")).unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(MAX_IMAGE_UPLOAD_BYTES as u64)
            .unwrap();
        let imported = load_image_file_with_metadata(&path).unwrap();
        assert_eq!(imported.byte_len, MAX_IMAGE_UPLOAD_BYTES);
        assert_eq!((imported.width_px, imported.height_px), (3, 2));
        let original = fs::read(&path).unwrap();
        assert_eq!(payload(&imported.attributes), original);
        let html = RichDocument::new(vec![imported.attributes.node()]).to_html();
        assert_eq!(RichDocument::from_html(&html).unwrap().to_html(), html);

        // Existing browser figures duplicate the URL as a raw src mirror.
        // Test preservation without adding that stale mirror to native inserts.
        let mirrored = html.replacen(
            "<figure ",
            &format!("<figure src=\"{}\" ", imported.attributes.src),
            1,
        );
        assert_eq!(
            RichDocument::from_html(&mirrored).unwrap().to_html(),
            mirrored
        );
        // The upload boundary is separate from the original canonical-source
        // limit. Actual conversion must reject before application mutation.
        let bridge = crate::semantic_bridge::SemanticBridge::discover().unwrap();
        let error = format!("{:#}", bridge.from_html(&html).unwrap_err());
        assert!(error.contains("Typst document exceeds the 5 MB editing limit."));
        fs::remove_file(&path).unwrap();
        assert_eq!(payload(&imported.attributes), original);
        eprintln!(
            "10 MiB image: native HTML={} browser mirrored HTML={} original converter rejects at5MB source limit",
            html.len(),
            mirrored.len()
        );
    }

    #[test]
    fn accepted_payload_survives_original_semantics_and_native_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Accepted boundary.png");
        fs::write(&path, include_bytes!("../fixtures/image-import/plate.png")).unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(1024 * 1024)
            .unwrap();
        let imported = load_image_file_with_metadata(&path).unwrap();
        let original = fs::read(&path).unwrap();
        let html = RichDocument::new(vec![imported.attributes.node()]).to_html();
        let bridge = crate::semantic_bridge::SemanticBridge::discover().unwrap();
        let generated = bridge.from_html(&html).unwrap();
        assert!(generated.html.contains(&imported.attributes.src));
        let request_bytes = serde_json::to_vec(&json!({"command":"reconcile",
            "source":generated.source,"html":generated.html}))
        .unwrap()
        .len();
        assert!(request_bytes <= 64 * 1024 * 1024);
        let reconciled = bridge
            .reconcile(&generated.source, &generated.html)
            .unwrap();
        assert_eq!(reconciled.source, generated.source);
        let projected = bridge.project(&reconciled.source).unwrap();
        let reopened = RichDocument::from_html(&projected.html).unwrap().to_html();
        assert!(reopened.contains(&imported.attributes.src));
        assert!(reopened.contains("data-image-offline=\"true\""));
        fs::remove_file(&path).unwrap();
        assert_eq!(payload(&imported.attributes), original);
        eprintln!(
            "1 MiB image: native HTML={} source={} projected HTML={} reconcile JSON={request_bytes}",
            html.len(),
            reconciled.source.len(),
            projected.html.len()
        );
    }
}
