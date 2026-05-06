use serde_json::Value;

use crate::modules::generated_files::docx_generator::{
    DocxRichText, DocxSection, DocxTable, WriteDocxInput,
};
use crate::modules::generated_files::pptx_generator::{PptxSlide, WritePptxInput};

pub enum PatchedGeneratedArtifactSource {
    Docx(WriteDocxInput),
    Pptx(WritePptxInput),
}

impl PatchedGeneratedArtifactSource {
    pub fn filename(&self) -> &str {
        match self {
            PatchedGeneratedArtifactSource::Docx(input) => &input.filename,
            PatchedGeneratedArtifactSource::Pptx(input) => &input.filename,
        }
    }

    pub fn set_revision_context(
        &mut self,
        artifact_id: String,
        base_revision_id: String,
        change_summary: Option<String>,
    ) {
        match self {
            PatchedGeneratedArtifactSource::Docx(input) => {
                input.artifact_id = Some(artifact_id);
                input.base_revision_id = Some(base_revision_id);
                input.change_summary = change_summary;
            }
            PatchedGeneratedArtifactSource::Pptx(input) => {
                input.artifact_id = Some(artifact_id);
                input.base_revision_id = Some(base_revision_id);
                input.change_summary = change_summary;
            }
        }
    }

    pub fn clear_revision_context(&mut self) {
        match self {
            PatchedGeneratedArtifactSource::Docx(input) => {
                input.artifact_id = None;
                input.base_revision_id = None;
                input.change_summary = None;
            }
            PatchedGeneratedArtifactSource::Pptx(input) => {
                input.artifact_id = None;
                input.base_revision_id = None;
                input.change_summary = None;
            }
        }
    }
}

pub fn apply_generated_artifact_patch(
    artifact_kind: &str,
    source_json: &str,
    operations: &[Value],
) -> Result<PatchedGeneratedArtifactSource, String> {
    if operations.is_empty() {
        return Err("patch_generated_artifact requires at least one operation".to_string());
    }

    match artifact_kind {
        "docx" => {
            let mut input: WriteDocxInput = serde_json::from_str(source_json)
                .map_err(|err| format!("failed to parse stored docx source_json: {err}"))?;
            for operation in operations {
                apply_docx_operation(&mut input, operation)?;
            }
            Ok(PatchedGeneratedArtifactSource::Docx(input))
        }
        "pptx" => {
            let mut input: WritePptxInput = serde_json::from_str(source_json)
                .map_err(|err| format!("failed to parse stored pptx source_json: {err}"))?;
            for operation in operations {
                apply_pptx_operation(&mut input, operation)?;
            }
            Ok(PatchedGeneratedArtifactSource::Pptx(input))
        }
        other => Err(format!(
            "generated artifact kind '{other}' does not support patch operations"
        )),
    }
}

fn apply_docx_operation(input: &mut WriteDocxInput, operation: &Value) -> Result<(), String> {
    let op = operation_name(operation)?;
    match op {
        "rename_file" => {
            input.filename = required_string(operation, "filename")?;
        }
        "update_theme_style" => {
            input.theme_style = crate::modules::generated_files::docx_generator::DocxThemeStyle::from_str(
                &required_string(operation, "theme_style")?,
            )?;
        }
        "replace_title" => {
            input.title = required_string(operation, "title")?;
        }
        "replace_section" => {
            let index = one_based_index(operation, "section_index", input.sections.len())?;
            input.sections[index] = parse_field(operation, "section")?;
        }
        "insert_section_after" => {
            let section: DocxSection = parse_field(operation, "section")?;
            let index = insertion_index_after(operation, "section_index", input.sections.len())?;
            input.sections.insert(index, section);
        }
        "append_section" => {
            let section: DocxSection = parse_field(operation, "section")?;
            input.sections.push(section);
        }
        "delete_section" => {
            let index = one_based_index(operation, "section_index", input.sections.len())?;
            input.sections.remove(index);
        }
        "replace_section_heading" => {
            let index = one_based_index(operation, "section_index", input.sections.len())?;
            input.sections[index].heading = required_string(operation, "heading")?;
        }
        "replace_paragraphs" => {
            let index = one_based_index(operation, "section_index", input.sections.len())?;
            input.sections[index].paragraphs = parse_field::<Vec<DocxRichText>>(operation, "paragraphs")?;
        }
        "replace_bullets" => {
            let index = one_based_index(operation, "section_index", input.sections.len())?;
            input.sections[index].bullets = parse_field(operation, "bullets")?;
        }
        "replace_tables" => {
            let index = one_based_index(operation, "section_index", input.sections.len())?;
            input.sections[index].tables = parse_field::<Vec<DocxTable>>(operation, "tables")?;
        }
        other => return Err(format!("unsupported docx patch operation '{other}'")),
    }
    Ok(())
}

fn apply_pptx_operation(input: &mut WritePptxInput, operation: &Value) -> Result<(), String> {
    let op = operation_name(operation)?;
    match op {
        "rename_file" => {
            input.filename = required_string(operation, "filename")?;
        }
        "update_theme_style" => {
            input.theme_style = required_string(operation, "theme_style")?;
        }
        "replace_slide" => {
            let index = one_based_index(operation, "slide_index", input.slides.len())?;
            input.slides[index] = parse_field(operation, "slide")?;
        }
        "insert_slide_after" => {
            let slide: PptxSlide = parse_field(operation, "slide")?;
            let index = insertion_index_after(operation, "slide_index", input.slides.len())?;
            input.slides.insert(index, slide);
        }
        "append_slide" => {
            let slide: PptxSlide = parse_field(operation, "slide")?;
            input.slides.push(slide);
        }
        "delete_slide" => {
            let index = one_based_index(operation, "slide_index", input.slides.len())?;
            input.slides.remove(index);
        }
        "replace_slide_title" => {
            let index = one_based_index(operation, "slide_index", input.slides.len())?;
            input.slides[index].title = required_string(operation, "title")?;
        }
        "replace_slide_subtitle" => {
            let index = one_based_index(operation, "slide_index", input.slides.len())?;
            input.slides[index].subtitle = optional_string(operation, "subtitle").unwrap_or_default();
        }
        "replace_slide_bullets" => {
            let index = one_based_index(operation, "slide_index", input.slides.len())?;
            input.slides[index].bullets = parse_field(operation, "bullets")?;
        }
        "replace_two_column_bullets" => {
            let index = one_based_index(operation, "slide_index", input.slides.len())?;
            if let Some(left_title) = optional_string(operation, "left_title") {
                input.slides[index].left_title = left_title;
            }
            if let Some(right_title) = optional_string(operation, "right_title") {
                input.slides[index].right_title = right_title;
            }
            if operation.get("left_bullets").is_some() {
                input.slides[index].left_bullets = parse_field(operation, "left_bullets")?;
            }
            if operation.get("right_bullets").is_some() {
                input.slides[index].right_bullets = parse_field(operation, "right_bullets")?;
            }
        }
        "reorder_slides" => {
            input.slides = reorder_items(&input.slides, operation, "order")?;
        }
        other => return Err(format!("unsupported pptx patch operation '{other}'")),
    }
    Ok(())
}

fn operation_name(operation: &Value) -> Result<&str, String> {
    operation
        .get("op")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "patch operation requires non-empty op".to_string())
}

fn required_string(operation: &Value, field: &str) -> Result<String, String> {
    optional_string(operation, field)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("patch operation requires non-empty {field}"))
}

fn optional_string(operation: &Value, field: &str) -> Option<String> {
    operation
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(str::to_string)
}

fn parse_field<T>(operation: &Value, field: &str) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
{
    let value = operation
        .get(field)
        .ok_or_else(|| format!("patch operation requires {field}"))?;
    serde_json::from_value(value.clone())
        .map_err(|err| format!("invalid patch field {field}: {err}"))
}

fn one_based_index(operation: &Value, field: &str, len: usize) -> Result<usize, String> {
    if len == 0 {
        return Err(format!("{field} cannot target an empty list"));
    }
    let raw = operation
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("patch operation requires integer {field}"))?;
    if raw < 1 || raw > len as i64 {
        return Err(format!("{field} {raw} is out of range 1..={len}"));
    }
    Ok((raw - 1) as usize)
}

fn insertion_index_after(operation: &Value, field: &str, len: usize) -> Result<usize, String> {
    let raw = operation
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("patch operation requires integer {field}"))?;
    if raw < 0 || raw > len as i64 {
        return Err(format!("{field} {raw} is out of insertion range 0..={len}"));
    }
    Ok(raw as usize)
}

fn reorder_items<T: Clone>(items: &[T], operation: &Value, field: &str) -> Result<Vec<T>, String> {
    let order = operation
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("patch operation requires array {field}"))?;
    if order.len() != items.len() {
        return Err(format!(
            "{field} must include exactly {} one-based indexes",
            items.len()
        ));
    }
    let mut seen = vec![false; items.len()];
    let mut reordered = Vec::with_capacity(items.len());
    for value in order {
        let raw = value
            .as_i64()
            .ok_or_else(|| format!("{field} entries must be integers"))?;
        if raw < 1 || raw > items.len() as i64 {
            return Err(format!("{field} entry {raw} is out of range"));
        }
        let index = (raw - 1) as usize;
        if seen[index] {
            return Err(format!("{field} contains duplicate index {raw}"));
        }
        seen[index] = true;
        reordered.push(items[index].clone());
    }
    Ok(reordered)
}
