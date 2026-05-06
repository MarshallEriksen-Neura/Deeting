use std::io::Write;

use tauri::{AppHandle, Runtime};
use zip::write::FileOptions;

use crate::modules::generated_files::storage::{
    put_generated_file, GeneratedFileArtifact, GeneratedFileError,
};

pub fn write_docx_input_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "Output filename. The .docx extension is optional.",
                "minLength": 1,
                "maxLength": 100
            },
            "title": {
                "type": "string",
                "description": "Document title.",
                "minLength": 1,
                "maxLength": 200
            },
            "theme_style": {
                "type": "string",
                "enum": ["default", "executive", "ocean", "sunset"],
                "description": "Theme style for document styling.",
                "default": "default"
            },
            "sections": {
                "type": "array",
                "description": "Document sections.",
                "items": {
                    "type": "object",
                    "properties": {
                        "heading": { "type": "string", "description": "Section heading text." },
                        "paragraphs": {
                            "type": "array",
                            "description": "Paragraphs. Each item can be a plain string, a bold paragraph, or rich runs.",
                            "items": rich_text_schema("Paragraph content.")
                        },
                        "bullets": {
                            "type": "array",
                            "description": "Bullet list items using native Word numbering (levels 1-2). Level 2 creates nested sub-bullets with proper numbering.",
                            "items": bullet_item_schema()
                        },
                        "tables": {
                            "type": "array",
                            "description": "Simple section tables.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {
                                        "type": "string",
                                        "description": "Optional table title shown above the table."
                                    },
                                    "headers": {
                                        "type": "array",
                                        "description": "Optional header cells.",
                                        "items": rich_text_schema("Table header cell.")
                                    },
                                    "rows": {
                                        "type": "array",
                                        "description": "Table rows.",
                                        "items": {
                                            "type": "array",
                                            "items": rich_text_schema("Table body cell.")
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "required": ["heading"]
                }
            },
            "artifact_id": {
                "type": "string",
                "description": "Existing generated artifact id to append a new revision instead of creating a new artifact."
            },
            "base_revision_id": {
                "type": "string",
                "description": "Expected current revision id for stale-edit protection when artifact_id is provided."
            },
            "change_summary": {
                "type": "string",
                "description": "Concise description of what changed in this revision."
            }
        },
        "required": ["filename", "title", "sections"]
    })
}

pub fn write_docx_tool_description() -> &'static str {
    "Generate or revise a Microsoft Word (.docx) document with native Word numbering (levels 1-2), titles, rich-text paragraphs, and simple tables. Pass artifact_id and base_revision_id to append a revision to an existing generated artifact."
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct DocxTextRun {
    pub text: String,
    #[serde(default)]
    pub bold: bool,
}

#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
pub struct DocxTextBlock {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub runs: Vec<DocxTextRun>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(untagged)]
pub enum DocxRichText {
    Plain(String),
    Structured(DocxTextBlock),
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct DocxListItemBlock {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default = "default_list_level")]
    pub level: u8,
    #[serde(default)]
    pub runs: Vec<DocxTextRun>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(untagged)]
pub enum DocxListItem {
    Plain(String),
    Structured(DocxListItemBlock),
}

#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
pub struct DocxTable {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub headers: Vec<DocxRichText>,
    #[serde(default)]
    pub rows: Vec<Vec<DocxRichText>>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct DocxSection {
    pub heading: String,
    #[serde(default)]
    pub paragraphs: Vec<DocxRichText>,
    #[serde(default)]
    pub bullets: Vec<DocxListItem>,
    #[serde(default)]
    pub tables: Vec<DocxTable>,
}

#[derive(Debug, Clone, Copy)]
pub enum DocxThemeStyle {
    Default,
    Executive,
    Ocean,
    Sunset,
}

impl DocxThemeStyle {
    pub fn as_str(&self) -> &'static str {
        match self {
            DocxThemeStyle::Default => "default",
            DocxThemeStyle::Executive => "executive",
            DocxThemeStyle::Ocean => "ocean",
            DocxThemeStyle::Sunset => "sunset",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "" | "default" => Ok(DocxThemeStyle::Default),
            "executive" => Ok(DocxThemeStyle::Executive),
            "ocean" => Ok(DocxThemeStyle::Ocean),
            "sunset" => Ok(DocxThemeStyle::Sunset),
            other => Err(format!(
                "theme_style '{}' is unsupported; expected default, executive, ocean, or sunset",
                other
            )),
        }
    }

    pub fn to_hex(&self) -> String {
        match self {
            DocxThemeStyle::Default => "0F172A",   // Slate 900
            DocxThemeStyle::Executive => "1C1917", // Stone 900
            DocxThemeStyle::Ocean => "082F49",     // Blue 950
            DocxThemeStyle::Sunset => "7C2D12",    // Red 950
        }
        .to_string()
    }

    pub fn to_surface_hex(&self) -> String {
        match self {
            DocxThemeStyle::Default => "F1F5F9",   // Slate 100
            DocxThemeStyle::Executive => "FAFAF9", // Stone 50
            DocxThemeStyle::Ocean => "E0F2FE",     // Sky 100
            DocxThemeStyle::Sunset => "FFEDD5",    // Orange 100
        }
        .to_string()
    }
}

impl Default for DocxThemeStyle {
    fn default() -> Self {
        DocxThemeStyle::Default
    }
}

// Manual serde impls for DocxThemeStyle
impl serde::Serialize for DocxThemeStyle {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> serde::Deserialize<'de> for DocxThemeStyle {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::de::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Self::from_str(&s).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct WriteDocxInput {
    pub filename: String,
    pub title: String,
    #[serde(default = "default_theme_style")]
    pub theme_style: DocxThemeStyle,
    #[serde(default)]
    pub sections: Vec<DocxSection>,
    #[serde(default)]
    pub artifact_id: Option<String>,
    #[serde(default)]
    pub base_revision_id: Option<String>,
    #[serde(default)]
    pub change_summary: Option<String>,
}

fn default_theme_style() -> DocxThemeStyle {
    DocxThemeStyle::Default
}

pub fn parse_write_docx_input(args: &serde_json::Value) -> Result<WriteDocxInput, String> {
    let mut input: WriteDocxInput = serde_json::from_value(args.clone())
        .map_err(|err| format!("Invalid write_docx arguments: {err}"))?;

    if input.filename.trim().is_empty() {
        return Err("filename is required".to_string());
    }
    if input.title.trim().is_empty() {
        return Err("title is required".to_string());
    }

    input.filename = sanitize_filename(&input.filename, "docx");
    if input.filename.is_empty() {
        return Err("filename must contain at least one valid character".to_string());
    }

    for (section_index, section) in input.sections.iter().enumerate() {
        for (bullet_index, bullet) in section.bullets.iter().enumerate() {
            let level = match bullet {
                DocxListItem::Plain(_) => 1,
                DocxListItem::Structured(item) => item.level,
            };
            if !(1..=2).contains(&level) {
                return Err(format!(
                    "section {} bullet {} level must be 1 or 2",
                    section_index + 1,
                    bullet_index + 1
                ));
            }
        }

        for (table_index, table) in section.tables.iter().enumerate() {
            if table.headers.is_empty() && table.rows.is_empty() {
                return Err(format!(
                    "section {} table {} must contain headers or rows",
                    section_index + 1,
                    table_index + 1
                ));
            }
        }
    }

    Ok(input)
}

pub async fn generate_docx<R: Runtime>(
    app: &AppHandle<R>,
    input: &WriteDocxInput,
) -> Result<GeneratedFileArtifact, GeneratedFileError> {
    let document_xml = build_document_xml(input);
    let content_types_xml = build_content_types_xml();
    let relationships_xml = build_relationships_xml();

    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::<u8>::new()));
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    writer.start_file("[Content_Types].xml", options)?;
    writer.write_all(content_types_xml.as_bytes())?;

    writer.add_directory("_rels/", options)?;
    writer.start_file("_rels/.rels", options)?;
    writer.write_all(relationships_xml.as_bytes())?;

    writer.add_directory("word/", options)?;
    writer.start_file("word/document.xml", options)?;
    writer.write_all(document_xml.as_bytes())?;

    writer.start_file("word/numbering.xml", options)?;
    writer.write_all(build_numbering_xml().as_bytes())?;

    writer.start_file("word/styles.xml", options)?;
    writer.write_all(build_styles_xml().as_bytes())?;

    let bytes = writer.finish()?.into_inner();
    let filename = input.filename.clone();
    let file_id = put_generated_file(app, &bytes, &filename)?;

    Ok(GeneratedFileArtifact {
        file_id,
        filename,
        size: bytes.len(),
        content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            .to_string(),
        preview_text: build_preview_text(input),
    })
}

fn rich_text_schema(description: &str) -> serde_json::Value {
    serde_json::json!({
        "description": description,
        "oneOf": [
            { "type": "string" },
            {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Plain text content."
                    },
                    "bold": {
                        "type": "boolean",
                        "description": "Apply bold to the whole text field."
                    },
                    "runs": {
                        "type": "array",
                        "description": "Optional rich-text runs. When present, `runs` wins over `text`.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": { "type": "string" },
                                "bold": { "type": "boolean" }
                            },
                            "required": ["text"]
                        }
                    }
                }
            }
        ]
    })
}

fn bullet_item_schema() -> serde_json::Value {
    serde_json::json!({
        "oneOf": [
            { "type": "string" },
            {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "bold": { "type": "boolean" },
                    "level": {
                        "type": "integer",
                        "enum": [1, 2],
                        "description": "Numbering level. Level 1 shows '1.', level 2 shows '2.1', '2.2', etc. Level 2 creates nested sub-bullets with proper Word numbering."
                    },
                    "runs": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": { "type": "string" },
                                "bold": { "type": "boolean" }
                            },
                            "required": ["text"]
                        }
                    }
                }
            }
        ]
    })
}

fn default_list_level() -> u8 {
    1
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
        "document".to_string()
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

fn run_xml(
    value: &str,
    preserve_spaces: bool,
    bold: bool,
    size_half_points: Option<u32>,
) -> String {
    let escaped = xml_escape(value);
    let space_attr = if preserve_spaces && (value.starts_with(' ') || value.ends_with(' ')) {
        " xml:space=\"preserve\""
    } else {
        ""
    };

    let mut props = String::new();
    if bold || size_half_points.is_some() {
        props.push_str("<w:rPr>");
        if bold {
            props.push_str("<w:b/>");
        }
        if let Some(size) = size_half_points {
            props.push_str(&format!("<w:sz w:val=\"{size}\"/>"));
        }
        props.push_str("</w:rPr>");
    }

    format!("<w:r>{props}<w:t{space_attr}>{escaped}</w:t></w:r>")
}

fn normalize_runs(block: &DocxRichText) -> Vec<DocxTextRun> {
    match block {
        DocxRichText::Plain(text) => vec![DocxTextRun {
            text: text.clone(),
            bold: false,
        }],
        DocxRichText::Structured(value) => normalize_text_block(value),
    }
}

fn normalize_text_block(block: &DocxTextBlock) -> Vec<DocxTextRun> {
    if !block.runs.is_empty() {
        block.runs.clone()
    } else {
        vec![DocxTextRun {
            text: block.text.clone(),
            bold: block.bold,
        }]
    }
}

fn normalize_list_item(item: &DocxListItem) -> (u8, Vec<DocxTextRun>) {
    match item {
        DocxListItem::Plain(text) => (
            1,
            vec![DocxTextRun {
                text: text.clone(),
                bold: false,
            }],
        ),
        DocxListItem::Structured(value) => (
            value.level,
            if !value.runs.is_empty() {
                value.runs.clone()
            } else {
                vec![DocxTextRun {
                    text: value.text.clone(),
                    bold: value.bold,
                }]
            },
        ),
    }
}

fn render_runs_xml(runs: &[DocxTextRun], size_half_points: Option<u32>) -> String {
    runs.iter()
        .filter_map(|run| {
            let text = run.text.as_str();
            (!text.is_empty()).then(|| run_xml(text, true, run.bold, size_half_points))
        })
        .collect::<String>()
}

fn paragraph_xml(block: &DocxRichText) -> Option<String> {
    let runs = normalize_runs(block);
    let content = render_runs_xml(&runs, None);
    (!content.is_empty()).then(|| format!("<w:p>{content}</w:p>"))
}

fn heading_xml(value: &str, level: u8) -> String {
    let style = if level <= 1 { "Heading1" } else { "Heading2" };
    format!(
        "<w:p><w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>{}</w:p>",
        run_xml(
            value,
            true,
            true,
            if level <= 1 { Some(32) } else { Some(28) }
        )
    )
}

fn bullet_xml(item: &DocxListItem) -> Option<String> {
    let (level, runs) = normalize_list_item(item);
    if level > 2 {
        return None;
    }

    let content = render_runs_xml(&runs, None);
    if content.is_empty() {
        return None;
    }

    // Word numbering format: level 1 uses abstractNum/numId 1, level 2 inherits with different lvl
    let num_id = 1u32;
    let level_val = level as u32;

    Some(format!(
        "<w:p w:rsidR=\"00A6E342\" w:rsidRDefault=\"00A6E342\">\
        <w:pPr><w:pStyle w:val=\"NumberedList\"/><w:numPr><w:ilvl w:val=\"{}\"/><w:numId w:val=\"{}\"/></w:numPr></w:pPr>{}</w:p>",
        level_val - 1,
        num_id,
        content
    ))
}

fn build_numbering_xml() -> String {
    // Abstract numbering definition with two levels
    // Level 1: "1." (Arabic, 1 digit)
    // Level 2: "a)" (Lowercase Letter, 1 char)
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<w:numbering xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:abstractNum w:abstractNumId=\"0\">",
            "<w:nsid w:val=\"48675734\"/>",
            "<w:multiLevelType w:val=\"hybridMultilevel\"/>",
            "<w:lvl w:ilvl=\"0\">",
            "<w:start w:val=\"1\"/>",
            "<w:numFmt w:val=\"arabic\"/>",
            "<w:pStyle w:val=\"NumberedList\"/>",
            "<w:lvlText w:val=\"{}\"/>",
            "<w:lvlJc w:val=\"left\"/>",
            "<w:pPr><w:ind w:left=\"720\" w:hanging=\"360\"/></w:pPr>",
            "<w:rPr><w:rStyle w:val=\"NumberedListLevel1\"/></w:rPr>",
            "</w:lvl>",
            "<w:lvl w:ilvl=\"1\">",
            "<w:start w:val=\"1\"/>",
            "<w:numFmt w:val=\"letterLower\"/>",
            "<w:lvlText w:val=\"{}\"/>",
            "<w:lvlJc w:val=\"left\"/>",
            "<w:pPr><w:ind w:left=\"1440\" w:hanging=\"360\"/></w:pPr>",
            "<w:rPr><w:rStyle w:val=\"NumberedListLevel2\"/></w:rPr>",
            "</w:lvl>",
            "</w:abstractNum>",
            "<w:num w:numId=\"1\"><w:abstractNumId w:val=\"0\"/></w:num>",
            "</w:numbering>"
        ),
        "{0}.",
        "{0}."
    )
}

fn build_styles_xml() -> String {
    // Base styles with configurable theme colors
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault></w:docDefaults>",
            // Default theme colors (can be overridden by theme-specific styles)
            "<w:style w:type=\"paragraph\" w:styleId=\"NumberedList\">",
            "<w:name w:val=\"Numbered List\"/>",
            "<w:rPr/></w:style>",
            "<w:style w:type=\"paragraph\" w:styleId=\"NumberedListLevel1\">",
            "<w:name w:val=\"Numbered List Level 1\"/>",
            "<w:rPr><w:rStyle w:val=\"BodyTextParagraphStyle\"/></w:rPr></w:style>",
            "<w:style w:type=\"paragraph\" w:styleId=\"NumberedListLevel2\">",
            "<w:name w:val=\"Numbered List Level 2\"/>",
            "<w:rPr><w:rStyle w:val=\"BodyTextParagraphStyle\"/></w:rPr></w:style>",
            "<w:style w:type=\"paragraph\" w:styleId=\"BodyTextParagraphStyle\">",
            "<w:name w:val=\"Body Text\"/>",
            "<w:rPr><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr></w:style>",
            // Default body text style with theme-compatible colors
            "<w:style w:type=\"paragraph\" w:styleId=\"Normal\">",
            "<w:name w:val=\"Normal\"/>",
            "<w:rPr>",
            "<w:color w:val=\"0F172A\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr>",
            "</w:style>",
            // Theme color styles
            "<w:style w:type=\"character\" w:styleId=\"Title\">",
            "<w:name w:val=\"Title\"/>",
            "<w:rPr><w:b/><w:color w:val=\"0F172A\"/><w:sz w:val=\"44\"/><w:szCs w:val=\"44\"/></w:rPr></w:style>",
            "<w:style w:type=\"character\" w:styleId=\"Heading1\">",
            "<w:name w:val=\"Heading 1\"/>",
            "<w:rPr><w:b/><w:color w:val=\"1C1917\"/><w:sz w:val=\"32\"/><w:szCs w:val=\"32\"/></w:rPr></w:style>",
            "<w:style w:type=\"character\" w:styleId=\"Heading2\">",
            "<w:name w:val=\"Heading 2\"/>",
            "<w:rPr><w:b/><w:color w:val=\"082F49\"/><w:sz w:val=\"28\"/><w:szCs w:val=\"28\"/></w:rPr></w:style>",
            "</w:styles>"
        )
    )
}

fn build_table_xml(table: &DocxTable) -> String {
    let column_count = std::cmp::max(
        table.headers.len(),
        table.rows.iter().map(|row| row.len()).max().unwrap_or(0),
    )
    .max(1);
    let cell_width = 9000 / column_count as u32;

    let grid = (0..column_count)
        .map(|_| format!("<w:gridCol w:w=\"{cell_width}\"/>"))
        .collect::<String>();

    let mut rows_xml = String::new();
    if !table.headers.is_empty() {
        rows_xml.push_str(&table_row_xml(
            &table.headers,
            column_count,
            cell_width,
            true,
        ));
    }
    for row in &table.rows {
        rows_xml.push_str(&table_row_xml(row, column_count, cell_width, false));
    }

    format!(
        concat!(
            "<w:tbl>",
            "<w:tblPr>",
            "<w:tblW w:w=\"0\" w:type=\"auto\"/>",
            "<w:tblBorders>",
            "<w:top w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"C7CEDB\"/>",
            "<w:left w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"C7CEDB\"/>",
            "<w:bottom w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"C7CEDB\"/>",
            "<w:right w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"C7CEDB\"/>",
            "<w:insideH w:val=\"single\" w:sz=\"6\" w:space=\"0\" w:color=\"D1D5DB\"/>",
            "<w:insideV w:val=\"single\" w:sz=\"6\" w:space=\"0\" w:color=\"D1D5DB\"/>",
            "</w:tblBorders>",
            "</w:tblPr>",
            "<w:tblGrid>{grid}</w:tblGrid>",
            "{rows_xml}",
            "</w:tbl>"
        ),
        grid = grid,
        rows_xml = rows_xml
    )
}

fn table_row_xml(
    row: &[DocxRichText],
    column_count: usize,
    cell_width: u32,
    is_header: bool,
) -> String {
    let cells = (0..column_count)
        .map(|index| {
            let content = row
                .get(index)
                .cloned()
                .unwrap_or_else(|| DocxRichText::Plain(String::new()));
            table_cell_xml(&content, cell_width, is_header)
        })
        .collect::<String>();

    format!("<w:tr>{cells}</w:tr>")
}

fn table_cell_xml(content: &DocxRichText, cell_width: u32, is_header: bool) -> String {
    let mut runs = normalize_runs(content);
    if is_header {
        for run in &mut runs {
            run.bold = true;
        }
    }
    let paragraph = if runs.is_empty() {
        "<w:p/>".to_string()
    } else {
        format!("<w:p>{}</w:p>", render_runs_xml(&runs, None))
    };
    let shading = if is_header {
        "<w:shd w:val=\"clear\" w:fill=\"EEF2FF\"/>"
    } else {
        ""
    };

    format!(
        "<w:tc><w:tcPr><w:tcW w:w=\"{cell_width}\" w:type=\"dxa\"/>{shading}</w:tcPr>{paragraph}</w:tc>"
    )
}

fn build_document_xml(input: &WriteDocxInput) -> String {
    let mut body = String::new();
    body.push_str(&heading_xml(&input.title, 1));

    for section in &input.sections {
        let heading = section.heading.trim();
        if !heading.is_empty() {
            body.push_str(&heading_xml(heading, 2));
        }

        for paragraph in &section.paragraphs {
            if let Some(xml) = paragraph_xml(paragraph) {
                body.push_str(&xml);
            }
        }

        for bullet in &section.bullets {
            if let Some(xml) = bullet_xml(bullet) {
                body.push_str(&xml);
            }
        }

        for table in &section.tables {
            if !table.title.trim().is_empty() {
                body.push_str(&format!(
                    "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{}</w:t></w:r></w:p>",
                    xml_escape(table.title.trim())
                ));
            }
            body.push_str(&build_table_xml(table));
        }
    }

    body.push_str(
        "<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/></w:sectPr>",
    );

    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:body>{body}</w:body>",
            "</w:document>"
        ),
        body = body
    )
}

fn build_content_types_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
        "<Default Extension=\"png\" ContentType=\"image/png\"/>",
        "<Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>",
        "<Default Extension=\"gif\" ContentType=\"image/gif\"/>",
        "<Default Extension=\"webp\" ContentType=\"image/webp\"/>",
        "<Default Extension=\"bmp\" ContentType=\"image/bmp\"/>",
        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>",
        "<Override PartName=\"/word/numbering.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml\"/>",
        "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>",
        "</Types>"
    )
}

fn build_relationships_xml() -> &'static str {
    concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>",
        "</Relationships>"
    )
}

fn preview_runs_text(block: &DocxRichText) -> String {
    normalize_runs(block)
        .into_iter()
        .map(|run| {
            let trimmed = run.text.trim();
            if trimmed.is_empty() {
                String::new()
            } else if run.bold {
                format!("**{trimmed}**")
            } else {
                trimmed.to_string()
            }
        })
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("")
}

fn preview_list_item_text(item: &DocxListItem) -> String {
    let (level, runs) = normalize_list_item(item);
    let text = runs
        .into_iter()
        .map(|run| {
            let trimmed = run.text.trim();
            if trimmed.is_empty() {
                String::new()
            } else if run.bold {
                format!("**{trimmed}**")
            } else {
                trimmed.to_string()
            }
        })
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("");
    if text.is_empty() {
        String::new()
    } else if level <= 1 {
        format!("- {text}")
    } else {
        format!("  - {text}")
    }
}

fn build_preview_text(input: &WriteDocxInput) -> String {
    let mut parts = vec![input.title.trim().to_string()];
    for section in &input.sections {
        if !section.heading.trim().is_empty() {
            parts.push(format!("\n# {}", section.heading.trim()));
        }
        for paragraph in &section.paragraphs {
            let text = preview_runs_text(paragraph);
            if !text.is_empty() {
                parts.push(text);
            }
        }
        for bullet in &section.bullets {
            let text = preview_list_item_text(bullet);
            if !text.is_empty() {
                parts.push(text);
            }
        }
        for table in &section.tables {
            if !table.title.trim().is_empty() {
                parts.push(format!("Table: {}", table.title.trim()));
            }
            if !table.headers.is_empty() {
                parts.push(format!(
                    "| {} |",
                    table
                        .headers
                        .iter()
                        .map(preview_runs_text)
                        .collect::<Vec<_>>()
                        .join(" | ")
                ));
            }
            for row in &table.rows {
                parts.push(format!(
                    "| {} |",
                    row.iter()
                        .map(preview_runs_text)
                        .collect::<Vec<_>>()
                        .join(" | ")
                ));
            }
        }
    }
    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_write_docx_input_accepts_rich_text_tables_and_nested_bullets() {
        let input = parse_write_docx_input(&serde_json::json!({
            "filename": "Q2 brief",
            "title": "Q2 Briefing",
            "sections": [{
                "heading": "Highlights",
                "paragraphs": [
                    {"runs": [{"text": "Launch status: "}, {"text": "green", "bold": true}]}
                ],
                "bullets": [
                    "Top-level",
                    {"text": "Nested item", "level": 2}
                ],
                "tables": [{
                    "title": "KPIs",
                    "headers": ["Metric", "Value"],
                    "rows": [["Activation", "42%"]]
                }]
            }]
        }))
        .expect("rich docx input should parse");

        assert_eq!(input.filename, "Q2-brief.docx");
        assert_eq!(input.sections[0].bullets.len(), 2);
        assert_eq!(input.sections[0].tables.len(), 1);
    }

    #[test]
    fn build_document_xml_renders_bold_runs_tables_and_native_numbering() {
        let input = WriteDocxInput {
            filename: "report.docx".to_string(),
            title: "Report".to_string(),
            theme_style: DocxThemeStyle::Default,
            sections: vec![DocxSection {
                heading: "Section".to_string(),
                paragraphs: vec![DocxRichText::Structured(DocxTextBlock {
                    text: String::new(),
                    bold: false,
                    runs: vec![
                        DocxTextRun {
                            text: "Status: ".to_string(),
                            bold: false,
                        },
                        DocxTextRun {
                            text: "On track".to_string(),
                            bold: true,
                        },
                    ],
                })],
                bullets: vec![DocxListItem::Structured(DocxListItemBlock {
                    text: "Main item".to_string(),
                    bold: false,
                    level: 1,
                    runs: Vec::new(),
                })],
                tables: vec![DocxTable {
                    title: "Summary".to_string(),
                    headers: vec![
                        DocxRichText::Plain("Metric".to_string()),
                        DocxRichText::Plain("Value".to_string()),
                    ],
                    rows: vec![vec![
                        DocxRichText::Plain("Velocity".to_string()),
                        DocxRichText::Plain("Fast".to_string()),
                    ]],
                }],
            }],
            artifact_id: None,
            base_revision_id: None,
            change_summary: None,
        };

        let xml = build_document_xml(&input);

        assert!(xml.contains("<w:b/>"));
        assert!(xml.contains("<w:tbl>"));
        assert!(xml.contains("<w:ilvl w:val=\"0\"/>"));
        assert!(xml.contains("<w:numId w:val=\"1\"/>"));
        assert!(xml.contains("<w:numPr>"));
        assert!(xml.contains("Summary"));
    }

    #[test]
    fn build_document_xml_renders_nested_numbering() {
        let input = WriteDocxInput {
            filename: "nested.docx".to_string(),
            title: "Nested Test".to_string(),
            theme_style: DocxThemeStyle::Default,
            sections: vec![DocxSection {
                heading: "Test".to_string(),
                paragraphs: Vec::new(),
                bullets: vec![
                    DocxListItem::Structured(DocxListItemBlock {
                        text: "Level 1 Item A".to_string(),
                        bold: false,
                        level: 1,
                        runs: Vec::new(),
                    }),
                    DocxListItem::Structured(DocxListItemBlock {
                        text: "Level 1 Item B".to_string(),
                        bold: false,
                        level: 1,
                        runs: Vec::new(),
                    }),
                    DocxListItem::Structured(DocxListItemBlock {
                        text: "Level 2 Sub Item".to_string(),
                        bold: false,
                        level: 2,
                        runs: Vec::new(),
                    }),
                ],
                tables: Vec::new(),
            }],
            artifact_id: None,
            base_revision_id: None,
            change_summary: None,
        };

        let xml = build_document_xml(&input);

        // Verify numbering markers for level 1 and level 2
        assert!(xml.contains("<w:ilvl w:val=\"0\"/>")); // Level 1 (1., 2., 3., etc.)
        assert!(xml.contains("<w:ilvl w:val=\"1\"/>")); // Level 2 (a), b), c), etc.)
        assert!(xml.contains("<w:numFmt w:val=\"arabic\"/>"));
        assert!(xml.contains("<w:numFmt w:val=\"letterLower\"/>"));
    }
}
