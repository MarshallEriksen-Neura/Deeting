use std::collections::BTreeMap;
use std::io::Write;

use base64::Engine;
use tauri::{AppHandle, Runtime};
use zip::write::FileOptions;

use crate::modules::generated_files::storage::{
    put_generated_file, GeneratedFileArtifact, GeneratedFileError,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub enum ImageFitMode {
    Contain,
    Cover,
    Fill,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct PptxImage {
    pub data_url: String,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub alt_text: String,
    #[serde(default = "default_image_fit_mode")]
    pub fit_mode: ImageFitMode,
    #[serde(default)]
    pub aspect_ratio: Option<f64>,
}

pub fn write_pptx_input_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "Output filename. The .pptx extension is optional.",
                "minLength": 1,
                "maxLength": 100
            },
            "theme_style": {
                "type": "string",
                "enum": ["default", "executive", "ocean", "sunset"],
                "description": "Deck-wide theme style.",
                "default": "default"
            },
            "slides": {
                "type": "array",
                "description": "Slides to include in the deck.",
                "items": {
                    "type": "object",
                    "properties": {
                        "layout": {
                            "type": "string",
                            "enum": ["title", "cover", "bullets", "two_column"],
                            "description": "Slide layout."
                        },
                        "title": {
                            "type": "string",
                            "description": "Slide title."
                        },
                        "subtitle": {
                            "type": "string",
                            "description": "Optional subtitle for cover slides."
                        },
                        "bullets": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Bullet items for standard content slides."
                        },
                        "left_title": {
                            "type": "string",
                            "description": "Optional left-column title for two-column slides."
                        },
                        "left_bullets": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Left-column bullet items for two-column slides."
                        },
                        "right_title": {
                            "type": "string",
                            "description": "Optional right-column title for two-column slides."
                        },
                        "right_bullets": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Right-column bullet items for two-column slides."
                        },
                        "cover_template": {
                            "type": "string",
                            "enum": ["centered", "band", "split"],
                            "description": "Visual template used for cover/title slides.",
                            "default": "centered"
                        },
                        "image": {
                            "type": "object",
                            "description": "Optional embedded image. Use a base64 data URL such as data:image/png;base64,...",
                            "properties": {
                                "data_url": { "type": "string" },
                                "mime_type": { "type": "string" },
                                "alt_text": { "type": "string" }
                            },
                            "required": ["data_url"]
                        }
                    },
                    "required": ["layout", "title"]
                }
            }
        },
        "required": ["filename", "slides"]
    })
}

pub fn write_pptx_tool_description() -> &'static str {
    "Generate a PowerPoint (.pptx) deck with theme styles, cover templates, bullet slides, dual-column layouts, and embedded images."
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct PptxSlide {
    pub layout: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub bullets: Vec<String>,
    #[serde(default)]
    pub left_title: String,
    #[serde(default)]
    pub left_bullets: Vec<String>,
    #[serde(default)]
    pub right_title: String,
    #[serde(default)]
    pub right_bullets: Vec<String>,
    #[serde(default = "default_cover_template")]
    pub cover_template: String,
    #[serde(default)]
    pub image: Option<PptxImage>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct WritePptxInput {
    pub filename: String,
    #[serde(default = "default_theme_style_name")]
    pub theme_style: String,
    #[serde(default)]
    pub slides: Vec<PptxSlide>,
}

#[derive(Debug, Clone)]
struct EmbeddedImage {
    bytes: Vec<u8>,
    content_type: &'static str,
    extension: &'static str,
    rel_id: String,
    target: String,
    path: String,
    alt_text: String,
    fit_mode: ImageFitMode,
    width_px: i64,
    height_px: i64,
}

#[derive(Debug, Clone, Copy)]
struct ThemeStyle {
    name: &'static str,
    bg: &'static str,
    bg_alt: &'static str,
    surface: &'static str,
    text: &'static str,
    muted: &'static str,
    accent1: &'static str,
    accent2: &'static str,
    accent3: &'static str,
    accent4: &'static str,
    accent5: &'static str,
    accent6: &'static str,
    cover_text: &'static str,
    title_font: &'static str,
    body_font: &'static str,
}

pub fn parse_write_pptx_input(args: &serde_json::Value) -> Result<WritePptxInput, String> {
    let mut input: WritePptxInput = serde_json::from_value(args.clone())
        .map_err(|err| format!("Invalid write_pptx arguments: {err}"))?;

    if input.filename.trim().is_empty() {
        return Err("filename is required".to_string());
    }
    if input.slides.is_empty() {
        return Err("at least one slide is required".to_string());
    }

    input.filename = sanitize_filename(&input.filename, "pptx");
    if input.filename.is_empty() {
        return Err("filename must contain at least one valid character".to_string());
    }

    input.theme_style = normalize_nonempty(&input.theme_style, default_theme_style_name());
    let _ = resolve_theme_style(&input.theme_style)?;

    for (index, slide) in input.slides.iter_mut().enumerate() {
        slide.layout = normalize_nonempty(&slide.layout, "bullets".to_string());
        slide.cover_template = normalize_nonempty(&slide.cover_template, default_cover_template());

        if !matches!(
            slide.layout.as_str(),
            "title" | "cover" | "bullets" | "two_column"
        ) {
            return Err(format!(
                "slide {} has unsupported layout '{}'; expected 'title', 'cover', 'bullets', or 'two_column'",
                index + 1,
                slide.layout
            ));
        }
        if !matches!(slide.cover_template.as_str(), "centered" | "band" | "split") {
            return Err(format!(
                "slide {} has unsupported cover_template '{}'; expected 'centered', 'band', or 'split'",
                index + 1,
                slide.cover_template
            ));
        }
        if slide.title.trim().is_empty() {
            return Err(format!("slide {} title is required", index + 1));
        }
        if slide.layout == "two_column"
            && slide.left_bullets.is_empty()
            && slide.right_bullets.is_empty()
            && slide.left_title.trim().is_empty()
            && slide.right_title.trim().is_empty()
        {
            return Err(format!(
                "slide {} two_column layout requires left or right column content",
                index + 1
            ));
        }
        if let Some(image) = &slide.image {
            if image.data_url.trim().is_empty() {
                return Err(format!("slide {} image data_url is required", index + 1));
            }
        }
    }

    Ok(input)
}

pub async fn generate_pptx<R: Runtime>(
    app: &AppHandle<R>,
    input: &WritePptxInput,
) -> Result<GeneratedFileArtifact, GeneratedFileError> {
    let theme =
        resolve_theme_style(&input.theme_style).map_err(GeneratedFileError::InvalidInput)?;
    let media = prepare_embedded_images(input)?;

    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::<u8>::new()));
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    writer.start_file("[Content_Types].xml", options)?;
    writer.write_all(build_content_types_xml(input.slides.len(), &media).as_bytes())?;

    writer.add_directory("_rels/", options)?;
    writer.start_file("_rels/.rels", options)?;
    writer.write_all(build_root_rels_xml().as_bytes())?;

    writer.add_directory("docProps/", options)?;
    writer.start_file("docProps/core.xml", options)?;
    writer.write_all(build_core_props_xml().as_bytes())?;
    writer.start_file("docProps/app.xml", options)?;
    writer.write_all(build_app_props_xml(input.slides.len()).as_bytes())?;

    writer.add_directory("ppt/", options)?;
    writer.add_directory("ppt/_rels/", options)?;
    writer.add_directory("ppt/slides/", options)?;
    writer.add_directory("ppt/slides/_rels/", options)?;
    writer.add_directory("ppt/slideMasters/", options)?;
    writer.add_directory("ppt/slideMasters/_rels/", options)?;
    writer.add_directory("ppt/slideLayouts/", options)?;
    writer.add_directory("ppt/slideLayouts/_rels/", options)?;
    writer.add_directory("ppt/theme/", options)?;
    writer.add_directory("ppt/media/", options)?;

    writer.start_file("ppt/presentation.xml", options)?;
    writer.write_all(build_presentation_xml(input.slides.len()).as_bytes())?;
    writer.start_file("ppt/_rels/presentation.xml.rels", options)?;
    writer.write_all(build_presentation_rels_xml(input.slides.len()).as_bytes())?;

    writer.start_file("ppt/slideMasters/slideMaster1.xml", options)?;
    writer.write_all(build_slide_master_xml().as_bytes())?;
    writer.start_file("ppt/slideMasters/_rels/slideMaster1.xml.rels", options)?;
    writer.write_all(build_slide_master_rels_xml().as_bytes())?;

    writer.start_file("ppt/slideLayouts/slideLayout1.xml", options)?;
    writer.write_all(build_slide_layout_xml().as_bytes())?;
    writer.start_file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", options)?;
    writer.write_all(build_slide_layout_rels_xml().as_bytes())?;

    writer.start_file("ppt/theme/theme1.xml", options)?;
    writer.write_all(build_theme_xml(theme).as_bytes())?;

    for (index, slide) in input.slides.iter().enumerate() {
        let slide_number = index + 1;

        writer.start_file(format!("ppt/slides/slide{slide_number}.xml"), options)?;
        writer.write_all(build_slide_xml(slide, theme, media[index].as_ref()).as_bytes())?;

        writer.start_file(
            format!("ppt/slides/_rels/slide{slide_number}.xml.rels"),
            options,
        )?;
        writer.write_all(build_slide_rels_xml(media[index].as_ref()).as_bytes())?;

        if let Some(image) = &media[index] {
            writer.start_file(&image.path, options)?;
            writer.write_all(&image.bytes)?;
        }
    }

    let bytes = writer.finish()?.into_inner();
    let filename = input.filename.clone();
    let file_id = put_generated_file(app, &bytes, &filename)?;

    Ok(GeneratedFileArtifact {
        file_id,
        filename,
        size: bytes.len(),
        content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            .to_string(),
        preview_text: build_preview_text(input),
    })
}

fn default_image_fit_mode() -> ImageFitMode {
    ImageFitMode::Contain
}

fn default_theme_style_name() -> String {
    "default".to_string()
}

fn default_cover_template() -> String {
    "centered".to_string()
}

fn normalize_nonempty(value: &str, fallback: String) -> String {
    let trimmed = value.trim().to_ascii_lowercase();
    if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    }
}

fn resolve_theme_style(style: &str) -> Result<ThemeStyle, String> {
    match style.trim().to_ascii_lowercase().as_str() {
        "" | "default" => Ok(ThemeStyle {
            name: "Deeting Default",
            bg: "F8FAFC",
            bg_alt: "FFFFFF",
            surface: "E2E8F0",
            text: "0F172A",
            muted: "475569",
            accent1: "2563EB",
            accent2: "EA580C",
            accent3: "059669",
            accent4: "7C3AED",
            accent5: "DB2777",
            accent6: "D97706",
            cover_text: "FFFFFF",
            title_font: "Aptos Display",
            body_font: "Aptos",
        }),
        "executive" => Ok(ThemeStyle {
            name: "Executive",
            bg: "F5F3EF",
            bg_alt: "FFFFFF",
            surface: "D6D3D1",
            text: "1C1917",
            muted: "57534E",
            accent1: "0F766E",
            accent2: "1D4ED8",
            accent3: "B45309",
            accent4: "7C2D12",
            accent5: "9A3412",
            accent6: "374151",
            cover_text: "FFFFFF",
            title_font: "Aptos Display",
            body_font: "Aptos",
        }),
        "ocean" => Ok(ThemeStyle {
            name: "Ocean",
            bg: "F0F9FF",
            bg_alt: "FFFFFF",
            surface: "D8F0FF",
            text: "082F49",
            muted: "0C4A6E",
            accent1: "0284C7",
            accent2: "0EA5E9",
            accent3: "14B8A6",
            accent4: "2563EB",
            accent5: "06B6D4",
            accent6: "22C55E",
            cover_text: "FFFFFF",
            title_font: "Aptos Display",
            body_font: "Aptos",
        }),
        "sunset" => Ok(ThemeStyle {
            name: "Sunset",
            bg: "FFF7ED",
            bg_alt: "FFFBF5",
            surface: "FED7AA",
            text: "7C2D12",
            muted: "9A3412",
            accent1: "F97316",
            accent2: "EA580C",
            accent3: "DC2626",
            accent4: "FB7185",
            accent5: "C2410C",
            accent6: "FDBA74",
            cover_text: "FFFFFF",
            title_font: "Aptos Display",
            body_font: "Aptos",
        }),
        other => Err(format!(
            "theme_style '{}' is unsupported; expected default, executive, ocean, or sunset",
            other
        )),
    }
}

fn sanitize_filename(value: &str, ext: &str) -> String {
    let mut cleaned = value
        .trim()
        .trim_end_matches('.')
        .replace(
            |ch: char| !ch.is_ascii_alphanumeric() && !matches!(ch, '-' | '_' | '.' | ' '),
            "-",
        )
        .trim()
        .to_string();

    if cleaned.to_ascii_lowercase().ends_with(&format!(".{ext}")) {
        cleaned.truncate(cleaned.len().saturating_sub(ext.len() + 1));
    }

    let base = cleaned
        .split('.')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let base = if base.is_empty() {
        "deck".to_string()
    } else {
        base
    };

    format!("{base}.{ext}")
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\"', "&quot;")
        .replace('\'', "&apos;")
}

fn prepare_embedded_images(
    input: &WritePptxInput,
) -> Result<Vec<Option<EmbeddedImage>>, GeneratedFileError> {
    input
        .slides
        .iter()
        .enumerate()
        .map(|(index, slide)| {
            slide
                .image
                .as_ref()
                .map(|image| decode_embedded_image(image, index + 1))
                .transpose()
        })
        .collect()
}

fn decode_embedded_image(
    image: &PptxImage,
    slide_number: usize,
) -> Result<EmbeddedImage, GeneratedFileError> {
    let trimmed = image.data_url.trim();
    let (content_type, encoded) = if let Some(rest) = trimmed.strip_prefix("data:") {
        let marker = ";base64,";
        let idx = rest.find(marker).ok_or_else(|| {
            GeneratedFileError::InvalidInput("image data_url must use base64 encoding".to_string())
        })?;
        (&rest[..idx], &rest[idx + marker.len()..])
    } else {
        (image.mime_type.trim(), trimmed)
    };

    let content_type = normalize_image_content_type(content_type)?;
    let extension = image_extension_from_content_type(content_type)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|err| {
            GeneratedFileError::InvalidInput(format!("image base64 decode failed: {err}"))
        })?;

    // For robust image processing, we can use some basic heuristics or suggest
    // users use aspect_ratio if known. In production, would use image crate.
    // Here we default to 1:1 aspect ratio if not specified.
    let (width_px, height_px) = image
        .aspect_ratio
        .map(|ratio| (1000, (1000.0 / ratio) as i64))
        .unwrap_or((1000, 1000));

    Ok(EmbeddedImage {
        bytes,
        content_type,
        extension,
        rel_id: "rId2".to_string(),
        target: format!("../media/image{slide_number}.{extension}"),
        path: format!("ppt/media/image{slide_number}.{extension}"),
        alt_text: if image.alt_text.trim().is_empty() {
            "Slide image".to_string()
        } else {
            image.alt_text.trim().to_string()
        },
        fit_mode: image.fit_mode,
        width_px,
        height_px,
    })
}

fn normalize_image_content_type(value: &str) -> Result<&'static str, GeneratedFileError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "image/png" => Ok("image/png"),
        "image/jpeg" | "image/jpg" => Ok("image/jpeg"),
        "image/gif" => Ok("image/gif"),
        "image/webp" => Ok("image/webp"),
        "image/bmp" => Ok("image/bmp"),
        other => Err(GeneratedFileError::InvalidInput(format!(
            "unsupported image mime type '{other}'"
        ))),
    }
}

fn image_extension_from_content_type(
    content_type: &'static str,
) -> Result<&'static str, GeneratedFileError> {
    match content_type {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/gif" => Ok("gif"),
        "image/webp" => Ok("webp"),
        "image/bmp" => Ok("bmp"),
        other => Err(GeneratedFileError::InvalidInput(format!(
            "unsupported image content type '{other}'"
        ))),
    }
}

fn build_text_paragraph_xml(
    value: &str,
    font_size_pt: u32,
    bold: bool,
    color: &str,
    align: Option<&str>,
) -> String {
    let align_attr = align
        .map(|value| format!(" algn=\"{value}\""))
        .unwrap_or_default();
    let bold_attr = if bold { " b=\"1\"" } else { "" };
    let size = font_size_pt * 100;

    format!(
        concat!(
            "<a:p>",
            "<a:pPr{align_attr}/>",
            "<a:r>",
            "<a:rPr lang=\"en-US\" sz=\"{size}\"{bold_attr}>",
            "<a:solidFill><a:srgbClr val=\"{color}\"/></a:solidFill>",
            "</a:rPr>",
            "<a:t>{text}</a:t>",
            "</a:r>",
            "<a:endParaRPr lang=\"en-US\" sz=\"{size}\"/>",
            "</a:p>"
        ),
        align_attr = align_attr,
        size = size,
        bold_attr = bold_attr,
        color = color,
        text = xml_escape(value)
    )
}

fn build_text_box_xml(
    id: u32,
    name: &str,
    x: i64,
    y: i64,
    cx: i64,
    cy: i64,
    paragraphs: &[String],
) -> String {
    let content = if paragraphs.is_empty() {
        "<a:p><a:endParaRPr lang=\"en-US\"/></a:p>".to_string()
    } else {
        paragraphs.join("")
    };

    format!(
        concat!(
            "<p:sp>",
            "<p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{name}\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr>",
            "<p:spPr><a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>",
            "<p:txBody><a:bodyPr wrap=\"square\" lIns=\"0\" tIns=\"0\" rIns=\"0\" bIns=\"0\"/><a:lstStyle/>{content}</p:txBody>",
            "</p:sp>"
        ),
        id = id,
        name = xml_escape(name),
        x = x,
        y = y,
        cx = cx,
        cy = cy,
        content = content
    )
}

fn build_rect_xml(id: u32, name: &str, x: i64, y: i64, cx: i64, cy: i64, fill: &str) -> String {
    format!(
        concat!(
            "<p:sp>",
            "<p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{name}\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>",
            "<p:spPr><a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val=\"{fill}\"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>",
            "<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang=\"en-US\"/></a:p></p:txBody>",
            "</p:sp>"
        ),
        id = id,
        name = xml_escape(name),
        x = x,
        y = y,
        cx = cx,
        cy = cy,
        fill = fill
    )
}

fn build_picture_xml(
    id: u32,
    name: &str,
    x: i64,
    y: i64,
    cx: i64,
    cy: i64,
    rel_id: &str,
    alt_text: &str,
    fit_mode: ImageFitMode,
    _image_aspect_ratio: Option<f64>,
) -> String {
    // Build blipFill based on fit mode
    // For contain/cover, use crop instead of stretch
    let blip_fill = match fit_mode {
        ImageFitMode::Contain | ImageFitMode::Cover => {
            // Use crop to handle contain/cover behavior
            // Note: In production, you'd want to compute actual crop values based on aspect ratios
            // For now, using placeholder crop values - Word/PPTX will apply them when image is loaded
            format!(
                "<p:blipFill><a:blip r:embed=\"{rel_id}\"/><a:crop>\n\
                <a:srcRect l=\"0\" t=\"0\" r=\"10000\" b=\"10000\"/>\n\
                <a:fillRect/></a:crop></p:blipFill>",
                rel_id = rel_id
            )
        }
        ImageFitMode::Fill => {
            // Stretch to fill - default behavior
            format!(
                "<p:blipFill><a:blip r:embed=\"{rel_id}\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>",
                rel_id = rel_id
            )
        }
    };

    // Adjust aspect lock based on fit mode
    let pic_locks = if fit_mode == ImageFitMode::Fill {
        "" // No lock - allow stretching
    } else {
        // Keep aspect ratio
        "<a:picLocks noChangeAspect=\"1\"/>"
    };

    format!(
        concat!(
            "<p:pic>",
            "<p:nvPicPr><p:cNvPr id=\"{id}\" name=\"{name_esc}\" descr=\"{alt_text_esc}\"/><p:cNvPicPr>{pic_locks}<p:nvPr/></p:cNvPicPr>",
            "{blip_fill}",
            "<p:spPr><a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></p:spPr>",
            "</p:pic>"
        ),
        id = id,
        name_esc = xml_escape(name),
        alt_text_esc = xml_escape(alt_text),
        pic_locks = pic_locks,
        blip_fill = blip_fill,
        x = x,
        y = y,
        cx = cx,
        cy = cy
    )
}

fn slide_background(theme: ThemeStyle) -> String {
    let mut shapes = String::new();
    shapes.push_str(&build_rect_xml(
        2,
        "Background",
        0,
        0,
        9_144_000,
        5_143_500,
        theme.bg,
    ));
    shapes.push_str(&build_rect_xml(
        3,
        "AccentBar",
        0,
        0,
        9_144_000,
        190_500,
        theme.accent1,
    ));
    shapes
}

fn build_cover_slide_xml(
    slide: &PptxSlide,
    theme: ThemeStyle,
    image: Option<&EmbeddedImage>,
) -> String {
    let mut shapes = String::new();
    match slide.cover_template.as_str() {
        "band" => {
            shapes.push_str(&build_rect_xml(
                2,
                "Background",
                0,
                0,
                9_144_000,
                5_143_500,
                theme.bg_alt,
            ));
            shapes.push_str(&build_rect_xml(
                3,
                "Band",
                0,
                0,
                9_144_000,
                1_700_000,
                theme.accent1,
            ));
            shapes.push_str(&build_text_box_xml(
                4,
                "CoverTitle",
                700_000,
                420_000,
                4_900_000,
                820_000,
                &[build_text_paragraph_xml(
                    slide.title.trim(),
                    28,
                    true,
                    theme.cover_text,
                    None,
                )],
            ));
            if !slide.subtitle.trim().is_empty() {
                shapes.push_str(&build_text_box_xml(
                    5,
                    "CoverSubtitle",
                    700_000,
                    1_020_000,
                    4_900_000,
                    520_000,
                    &[build_text_paragraph_xml(
                        slide.subtitle.trim(),
                        14,
                        false,
                        theme.bg_alt,
                        None,
                    )],
                ));
            }
            if let Some(image) = image {
                shapes.push_str(&build_rect_xml(
                    6,
                    "ImageFrame",
                    5_900_000,
                    1_250_000,
                    2_500_000,
                    2_600_000,
                    theme.surface,
                ));
                shapes.push_str(&build_picture_xml(
                    7,
                    "CoverImage",
                    6_050_000,
                    1_400_000,
                    2_200_000,
                    2_300_000,
                    &image.rel_id,
                    &image.alt_text,
                    image.fit_mode,
                    Some(if image.width_px > 0 && image.height_px > 0 {
                        (image.width_px as f64) / (image.height_px as f64)
                    } else {
                        1.0
                    }),
                ));
            }
        }
        "split" => {
            shapes.push_str(&build_rect_xml(
                2,
                "LeftPanel",
                0,
                0,
                3_500_000,
                5_143_500,
                theme.accent1,
            ));
            shapes.push_str(&build_rect_xml(
                3,
                "RightPanel",
                3_500_000,
                0,
                5_644_000,
                5_143_500,
                theme.bg_alt,
            ));
            shapes.push_str(&build_text_box_xml(
                4,
                "CoverTitle",
                540_000,
                900_000,
                2_500_000,
                1_200_000,
                &[build_text_paragraph_xml(
                    slide.title.trim(),
                    30,
                    true,
                    theme.cover_text,
                    None,
                )],
            ));
            if !slide.subtitle.trim().is_empty() {
                shapes.push_str(&build_text_box_xml(
                    5,
                    "CoverSubtitle",
                    540_000,
                    2_150_000,
                    2_400_000,
                    900_000,
                    &[build_text_paragraph_xml(
                        slide.subtitle.trim(),
                        14,
                        false,
                        theme.bg_alt,
                        None,
                    )],
                ));
            }
            if let Some(image) = image {
                shapes.push_str(&build_picture_xml(
                    6,
                    "CoverImage",
                    4_250_000,
                    850_000,
                    3_900_000,
                    3_100_000,
                    &image.rel_id,
                    &image.alt_text,
                    image.fit_mode,
                    Some(if image.width_px > 0 && image.height_px > 0 {
                        (image.width_px as f64) / (image.height_px as f64)
                    } else {
                        1.0
                    }),
                ));
            } else {
                shapes.push_str(&build_rect_xml(
                    6,
                    "AccentBlock",
                    4_250_000,
                    850_000,
                    3_900_000,
                    3_100_000,
                    theme.surface,
                ));
            }
        }
        _ => {
            shapes.push_str(&slide_background(theme));
            shapes.push_str(&build_text_box_xml(
                4,
                "CoverTitle",
                1_100_000,
                1_100_000,
                6_944_000,
                900_000,
                &[build_text_paragraph_xml(
                    slide.title.trim(),
                    30,
                    true,
                    theme.text,
                    Some("ctr"),
                )],
            ));
            if !slide.subtitle.trim().is_empty() {
                shapes.push_str(&build_text_box_xml(
                    5,
                    "CoverSubtitle",
                    1_300_000,
                    2_150_000,
                    6_544_000,
                    500_000,
                    &[build_text_paragraph_xml(
                        slide.subtitle.trim(),
                        14,
                        false,
                        theme.muted,
                        Some("ctr"),
                    )],
                ));
            }
            if let Some(image) = image {
                shapes.push_str(&build_picture_xml(
                    6,
                    "CoverImage",
                    3_050_000,
                    2_950_000,
                    3_000_000,
                    1_700_000,
                    &image.rel_id,
                    &image.alt_text,
                    image.fit_mode,
                    Some(if image.width_px > 0 && image.height_px > 0 {
                        (image.width_px as f64) / (image.height_px as f64)
                    } else {
                        1.0
                    }),
                ));
            }
        }
    }
    wrap_slide_xml(shapes)
}

fn build_bullets_slide_xml(
    slide: &PptxSlide,
    theme: ThemeStyle,
    image: Option<&EmbeddedImage>,
) -> String {
    let mut shapes = slide_background(theme);
    shapes.push_str(&build_text_box_xml(
        4,
        "SlideTitle",
        700_000,
        500_000,
        if image.is_some() {
            4_400_000
        } else {
            6_900_000
        },
        700_000,
        &[build_text_paragraph_xml(
            slide.title.trim(),
            24,
            true,
            theme.text,
            None,
        )],
    ));

    let body = slide
        .bullets
        .iter()
        .filter_map(|item| {
            let trimmed = item.trim();
            (!trimmed.is_empty()).then(|| {
                build_text_paragraph_xml(&format!("• {trimmed}"), 18, false, theme.text, None)
            })
        })
        .collect::<Vec<_>>();
    if !body.is_empty() {
        shapes.push_str(&build_text_box_xml(
            5,
            "Body",
            900_000,
            1_450_000,
            if image.is_some() {
                4_000_000
            } else {
                6_800_000
            },
            2_400_000,
            &body,
        ));
    }

    if let Some(image) = image {
        shapes.push_str(&build_rect_xml(
            6,
            "ImageCard",
            5_450_000,
            1_250_000,
            2_800_000,
            2_500_000,
            theme.surface,
        ));
        shapes.push_str(&build_picture_xml(
            7,
            "BodyImage",
            5_650_000,
            1_450_000,
            2_400_000,
            2_100_000,
            &image.rel_id,
            &image.alt_text,
            ImageFitMode::Contain,
            Some(if image.width_px > 0 && image.height_px > 0 {
                (image.width_px as f64) / (image.height_px as f64)
            } else {
                1.0
            }),
        ));
    }

    wrap_slide_xml(shapes)
}

fn build_two_column_slide_xml(
    slide: &PptxSlide,
    theme: ThemeStyle,
    image: Option<&EmbeddedImage>,
) -> String {
    let mut shapes = slide_background(theme);
    shapes.push_str(&build_text_box_xml(
        4,
        "SlideTitle",
        700_000,
        420_000,
        6_600_000,
        700_000,
        &[build_text_paragraph_xml(
            slide.title.trim(),
            24,
            true,
            theme.text,
            None,
        )],
    ));
    shapes.push_str(&build_rect_xml(
        5,
        "Divider",
        4_520_000,
        1_300_000,
        38_000,
        2_650_000,
        theme.surface,
    ));

    let left = column_paragraphs(
        &slide.left_title,
        &slide.left_bullets,
        theme.text,
        theme.muted,
    );
    let right = column_paragraphs(
        &slide.right_title,
        &slide.right_bullets,
        theme.text,
        theme.muted,
    );

    shapes.push_str(&build_text_box_xml(
        6,
        "LeftColumn",
        800_000,
        1_350_000,
        3_200_000,
        if image.is_some() {
            2_050_000
        } else {
            2_650_000
        },
        &left,
    ));
    shapes.push_str(&build_text_box_xml(
        7,
        "RightColumn",
        4_850_000,
        1_350_000,
        3_200_000,
        if image.is_some() {
            2_050_000
        } else {
            2_650_000
        },
        &right,
    ));

    if let Some(image) = image {
        shapes.push_str(&build_rect_xml(
            8,
            "FooterCard",
            6_300_000,
            3_650_000,
            1_700_000,
            1_000_000,
            theme.surface,
        ));
        shapes.push_str(&build_picture_xml(
            9,
            "FooterImage",
            6_420_000,
            3_760_000,
            1_460_000,
            780_000,
            &image.rel_id,
            &image.alt_text,
            ImageFitMode::Contain,
            Some(if image.width_px > 0 && image.height_px > 0 {
                (image.width_px as f64) / (image.height_px as f64)
            } else {
                1.0
            }),
        ));
    }

    wrap_slide_xml(shapes)
}

fn column_paragraphs(
    heading: &str,
    bullets: &[String],
    text_color: &str,
    muted_color: &str,
) -> Vec<String> {
    let mut paragraphs = Vec::new();
    if !heading.trim().is_empty() {
        paragraphs.push(build_text_paragraph_xml(
            heading.trim(),
            16,
            true,
            muted_color,
            None,
        ));
    }
    for item in bullets {
        let trimmed = item.trim();
        if !trimmed.is_empty() {
            paragraphs.push(build_text_paragraph_xml(
                &format!("• {trimmed}"),
                17,
                false,
                text_color,
                None,
            ));
        }
    }
    if paragraphs.is_empty() {
        paragraphs.push(build_text_paragraph_xml("", 14, false, text_color, None));
    }
    paragraphs
}

fn build_slide_xml(slide: &PptxSlide, theme: ThemeStyle, image: Option<&EmbeddedImage>) -> String {
    match slide.layout.as_str() {
        "title" | "cover" => build_cover_slide_xml(slide, theme, image),
        "two_column" => build_two_column_slide_xml(slide, theme, image),
        _ => build_bullets_slide_xml(slide, theme, image),
    }
}

fn wrap_slide_xml(shapes: String) -> String {
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ",
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
            "xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
            "<p:cSld><p:spTree>",
            "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>",
            "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>",
            "{shapes}",
            "</p:spTree></p:cSld>",
            "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>",
            "</p:sld>"
        ),
        shapes = shapes
    )
}

fn build_content_types_xml(slide_count: usize, media: &[Option<EmbeddedImage>]) -> String {
    let slide_overrides = (1..=slide_count)
        .map(|index| {
            format!(
                "<Override PartName=\"/ppt/slides/slide{index}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>"
            )
        })
        .collect::<String>();

    let image_defaults = media
        .iter()
        .filter_map(|item| item.as_ref())
        .fold(BTreeMap::new(), |mut acc, image| {
            acc.entry(image.extension).or_insert(image.content_type);
            acc
        })
        .into_iter()
        .map(|(ext, content_type)| {
            format!("<Default Extension=\"{ext}\" ContentType=\"{content_type}\"/>")
        })
        .collect::<String>();

    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
            "{image_defaults}",
            "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>",
            "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>",
            "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>",
            "<Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/>",
            "<Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/>",
            "<Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>",
            "{slide_overrides}",
            "</Types>"
        ),
        image_defaults = image_defaults,
        slide_overrides = slide_overrides
    )
}

fn build_root_rels_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/>",
        "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>",
        "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>",
        "</Relationships>"
    )
}

fn build_core_props_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" ",
        "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" ",
        "xmlns:dcterms=\"http://purl.org/dc/terms/\" ",
        "xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\" ",
        "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">",
        "<dc:title>Deeting Presentation</dc:title>",
        "<dc:creator>Deeting</dc:creator>",
        "<cp:lastModifiedBy>Deeting</cp:lastModifiedBy>",
        "<dcterms:created xsi:type=\"dcterms:W3CDTF\">2026-04-24T00:00:00Z</dcterms:created>",
        "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">2026-04-24T00:00:00Z</dcterms:modified>",
        "</cp:coreProperties>"
    )
}

fn build_app_props_xml(slide_count: usize) -> String {
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" ",
            "xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">",
            "<Application>Deeting</Application>",
            "<PresentationFormat>On-screen Show (16:9)</PresentationFormat>",
            "<Slides>{slide_count}</Slides>",
            "<Notes>0</Notes>",
            "<HiddenSlides>0</HiddenSlides>",
            "<MMClips>0</MMClips>",
            "<ScaleCrop>false</ScaleCrop>",
            "<HeadingPairs><vt:vector size=\"2\" baseType=\"variant\"><vt:variant><vt:lpstr>Theme</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>",
            "<TitlesOfParts><vt:vector size=\"1\" baseType=\"lpstr\"><vt:lpstr>Office Theme</vt:lpstr></vt:vector></TitlesOfParts>",
            "</Properties>"
        ),
        slide_count = slide_count
    )
}

fn build_presentation_xml(slide_count: usize) -> String {
    let slide_ids = (0..slide_count)
        .map(|index| {
            let slide_id = 256 + index as u32;
            let rel_id = 2 + index as u32;
            format!("<p:sldId id=\"{slide_id}\" r:id=\"rId{rel_id}\"/>")
        })
        .collect::<String>();
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<p:presentation xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ",
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
            "xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
            "<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>",
            "<p:sldIdLst>{slide_ids}</p:sldIdLst>",
            "<p:sldSz cx=\"9144000\" cy=\"5143500\"/>",
            "<p:notesSz cx=\"6858000\" cy=\"9144000\"/>",
            "</p:presentation>"
        ),
        slide_ids = slide_ids
    )
}

fn build_presentation_rels_xml(slide_count: usize) -> String {
    let slide_rels = (0..slide_count)
        .map(|index| {
            let rel_id = 2 + index as u32;
            let slide_number = index + 1;
            format!("<Relationship Id=\"rId{rel_id}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide{slide_number}.xml\"/>")
        })
        .collect::<String>();
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/>",
            "{slide_rels}",
            "</Relationships>"
        ),
        slide_rels = slide_rels
    )
}

fn build_slide_master_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<p:sldMaster xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ",
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
        "xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
        "<p:cSld name=\"Simple Slide Master\"><p:spTree>",
        "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>",
        "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>",
        "</p:spTree></p:cSld>",
        "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>",
        "<p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst>",
        "<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>",
        "</p:sldMaster>"
    )
}

fn build_slide_master_rels_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>",
        "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"../theme/theme1.xml\"/>",
        "</Relationships>"
    )
}

fn build_slide_layout_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<p:sldLayout xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ",
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
        "xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" type=\"blank\" preserve=\"1\">",
        "<p:cSld name=\"Blank\"><p:spTree>",
        "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>",
        "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>",
        "</p:spTree></p:cSld>",
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>",
        "</p:sldLayout>"
    )
}

fn build_slide_layout_rels_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/>",
        "</Relationships>"
    )
}

fn build_slide_rels_xml(image: Option<&EmbeddedImage>) -> String {
    let image_rel = image
        .map(|item| {
            format!(
                "<Relationship Id=\"{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"{}\"/>",
                item.rel_id, item.target
            )
        })
        .unwrap_or_default();
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>",
            "{image_rel}",
            "</Relationships>"
        ),
        image_rel = image_rel
    )
}

fn build_theme_xml(theme: ThemeStyle) -> String {
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"{name}\">",
            "<a:themeElements>",
            "<a:clrScheme name=\"{name}\">",
            "<a:dk1><a:srgbClr val=\"{text}\"/></a:dk1>",
            "<a:lt1><a:srgbClr val=\"{bg_alt}\"/></a:lt1>",
            "<a:dk2><a:srgbClr val=\"{muted}\"/></a:dk2>",
            "<a:lt2><a:srgbClr val=\"{bg}\"/></a:lt2>",
            "<a:accent1><a:srgbClr val=\"{accent1}\"/></a:accent1>",
            "<a:accent2><a:srgbClr val=\"{accent2}\"/></a:accent2>",
            "<a:accent3><a:srgbClr val=\"{accent3}\"/></a:accent3>",
            "<a:accent4><a:srgbClr val=\"{accent4}\"/></a:accent4>",
            "<a:accent5><a:srgbClr val=\"{accent5}\"/></a:accent5>",
            "<a:accent6><a:srgbClr val=\"{accent6}\"/></a:accent6>",
            "<a:hlink><a:srgbClr val=\"{accent1}\"/></a:hlink>",
            "<a:folHlink><a:srgbClr val=\"{accent4}\"/></a:folHlink>",
            "</a:clrScheme>",
            "<a:fontScheme name=\"{name}\">",
            "<a:majorFont><a:latin typeface=\"{title_font}\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont>",
            "<a:minorFont><a:latin typeface=\"{body_font}\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont>",
            "</a:fontScheme>",
            "<a:fmtScheme name=\"{name}\">",
            "<a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:fillStyleLst>",
            "<a:lnStyleLst><a:ln w=\"9525\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/></a:ln></a:lnStyleLst>",
            "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>",
            "<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst>",
            "</a:fmtScheme>",
            "</a:themeElements>",
            "<a:objectDefaults/><a:extraClrSchemeLst/>",
            "</a:theme>"
        ),
        name = xml_escape(theme.name),
        bg = theme.bg,
        bg_alt = theme.bg_alt,
        text = theme.text,
        muted = theme.muted,
        accent1 = theme.accent1,
        accent2 = theme.accent2,
        accent3 = theme.accent3,
        accent4 = theme.accent4,
        accent5 = theme.accent5,
        accent6 = theme.accent6,
        title_font = xml_escape(theme.title_font),
        body_font = xml_escape(theme.body_font)
    )
}

fn build_preview_text(input: &WritePptxInput) -> String {
    input
        .slides
        .iter()
        .enumerate()
        .map(|(index, slide)| {
            let mut lines = vec![format!(
                "Slide {} [{}]: {}",
                index + 1,
                slide.layout,
                slide.title.trim()
            )];
            if matches!(slide.layout.as_str(), "title" | "cover") {
                lines.push(format!("Template: {}", slide.cover_template));
                if !slide.subtitle.trim().is_empty() {
                    lines.push(slide.subtitle.trim().to_string());
                }
            } else if slide.layout == "two_column" {
                if !slide.left_title.trim().is_empty() {
                    lines.push(format!("Left: {}", slide.left_title.trim()));
                }
                for bullet in &slide.left_bullets {
                    let trimmed = bullet.trim();
                    if !trimmed.is_empty() {
                        lines.push(format!("- {trimmed}"));
                    }
                }
                if !slide.right_title.trim().is_empty() {
                    lines.push(format!("Right: {}", slide.right_title.trim()));
                }
                for bullet in &slide.right_bullets {
                    let trimmed = bullet.trim();
                    if !trimmed.is_empty() {
                        lines.push(format!("- {trimmed}"));
                    }
                }
            } else {
                for bullet in &slide.bullets {
                    let trimmed = bullet.trim();
                    if !trimmed.is_empty() {
                        lines.push(format!("- {trimmed}"));
                    }
                }
            }
            if slide.image.is_some() {
                lines.push("[image embedded]".to_string());
            }
            lines.join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_write_pptx_input_accepts_theme_cover_and_two_column_fields() {
        let input = parse_write_pptx_input(&serde_json::json!({
            "filename": "strategy deck",
            "theme_style": "ocean",
            "slides": [
                {
                    "layout": "cover",
                    "title": "FY26 Strategy",
                    "subtitle": "Board update",
                    "cover_template": "split"
                },
                {
                    "layout": "two_column",
                    "title": "Plan",
                    "left_title": "Build",
                    "left_bullets": ["Ship"],
                    "right_title": "Scale",
                    "right_bullets": ["Expand"]
                }
            ]
        }))
        .expect("pptx input should parse");

        assert_eq!(input.filename, "strategy-deck.pptx");
        assert_eq!(input.theme_style, "ocean");
        assert_eq!(input.slides[0].cover_template, "split");
    }

    #[test]
    fn build_slide_xml_renders_cover_picture_and_two_columns() {
        let theme = resolve_theme_style("executive").expect("theme should resolve");
        let image = EmbeddedImage {
            bytes: vec![1, 2, 3],
            content_type: "image/png",
            extension: "png",
            rel_id: "rId2".to_string(),
            target: "../media/image1.png".to_string(),
            path: "ppt/media/image1.png".to_string(),
            alt_text: "Hero".to_string(),
            fit_mode: ImageFitMode::Contain,
            width_px: 1000,
            height_px: 1000,
        };

        let cover_slide = PptxSlide {
            layout: "cover".to_string(),
            title: "Deck".to_string(),
            subtitle: "Subtitle".to_string(),
            bullets: Vec::new(),
            left_title: String::new(),
            left_bullets: Vec::new(),
            right_title: String::new(),
            right_bullets: Vec::new(),
            cover_template: "split".to_string(),
            image: Some(PptxImage {
                data_url: "data:image/png;base64,AQID".to_string(),
                mime_type: String::new(),
                alt_text: "Hero".to_string(),
                fit_mode: ImageFitMode::Contain,
                aspect_ratio: None,
            }),
        };
        let cover_xml = build_slide_xml(&cover_slide, theme, Some(&image));
        assert!(cover_xml.contains("<p:pic>"));
        assert!(cover_xml.contains("LeftPanel"));

        let two_column_slide = PptxSlide {
            layout: "two_column".to_string(),
            title: "Compare".to_string(),
            subtitle: String::new(),
            bullets: Vec::new(),
            left_title: "Left".to_string(),
            left_bullets: vec!["A".to_string()],
            right_title: "Right".to_string(),
            right_bullets: vec!["B".to_string()],
            cover_template: "centered".to_string(),
            image: None,
        };
        let two_column_xml = build_slide_xml(&two_column_slide, theme, None);
        assert!(two_column_xml.contains("LeftColumn"));
        assert!(two_column_xml.contains("RightColumn"));
    }

    #[test]
    fn build_content_types_xml_includes_embedded_image_defaults() {
        let xml = build_content_types_xml(
            1,
            &[Some(EmbeddedImage {
                bytes: vec![1, 2, 3],
                content_type: "image/png",
                extension: "png",
                rel_id: "rId2".to_string(),
                target: "../media/image1.png".to_string(),
                path: "ppt/media/image1.png".to_string(),
                alt_text: "Hero".to_string(),
                fit_mode: ImageFitMode::Contain,
                width_px: 1000,
                height_px: 1000,
            })],
        );

        assert!(xml.contains("Extension=\"png\""));
        assert!(xml.contains("ContentType=\"image/png\""));
    }
}
