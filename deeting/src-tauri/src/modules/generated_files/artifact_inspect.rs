use serde_json::{json, Value};

use crate::modules::generated_files::artifact_types::{
    GeneratedArtifactRecord, GeneratedArtifactRevisionRecord,
};

pub fn build_generated_artifact_inspection(
    artifact: &GeneratedArtifactRecord,
    revision: &GeneratedArtifactRevisionRecord,
) -> Result<Value, String> {
    let outline = match artifact.artifact_kind.as_str() {
        "pptx" => pptx_outline(&revision.source_json)?,
        "docx" => docx_outline(&revision.source_json)?,
        other => {
            return Err(format!(
                "generated artifact kind '{other}' is not inspectable"
            ));
        }
    };

    Ok(json!({
        "artifact_id": artifact.artifact_id,
        "kind": artifact.artifact_kind,
        "title": artifact.title,
        "status": artifact.status,
        "current_revision": {
            "revision_id": artifact.current_revision_id,
        },
        "revision": {
            "revision_id": revision.revision_id,
            "revision_number": revision.revision_number,
            "parent_revision_id": revision.parent_revision_id,
            "created_at": revision.created_at,
            "creation_mode": revision.creation_mode,
            "change_summary": revision.change_summary,
        },
        "file": {
            "file_id": revision.file_id,
            "filename": revision.filename,
            "content_type": revision.content_type,
            "size": revision.size,
            "binary_status": revision.binary_status,
            "binary_pruned_at": revision.binary_pruned_at,
        },
        "outline": outline,
        "preview_text": revision.preview_text,
        "supported_operations": supported_operations(&artifact.artifact_kind),
        "source_available": true,
    }))
}

fn supported_operations(kind: &str) -> Vec<&'static str> {
    match kind {
        "pptx" => vec![
            "rename_file",
            "replace_slide",
            "insert_slide_after",
            "append_slide",
            "delete_slide",
            "replace_slide_title",
            "replace_slide_subtitle",
            "replace_slide_bullets",
            "replace_two_column_bullets",
            "reorder_slides",
            "update_theme_style",
        ],
        "docx" => vec![
            "rename_file",
            "replace_title",
            "replace_section",
            "insert_section_after",
            "append_section",
            "delete_section",
            "replace_section_heading",
            "replace_paragraphs",
            "replace_bullets",
            "replace_tables",
            "update_theme_style",
        ],
        _ => Vec::new(),
    }
}

fn pptx_outline(source_json: &str) -> Result<Value, String> {
    let input: crate::modules::generated_files::pptx_generator::WritePptxInput =
        serde_json::from_str(source_json)
            .map_err(|err| format!("failed to parse stored pptx source_json: {err}"))?;

    Ok(Value::Array(
        input
            .slides
            .iter()
            .enumerate()
            .map(|(index, slide)| {
                json!({
                    "index": index + 1,
                    "layout": slide.layout,
                    "title": slide.title,
                    "subtitle_present": !slide.subtitle.trim().is_empty(),
                    "bullet_count": slide.bullets.len()
                        + slide.left_bullets.len()
                        + slide.right_bullets.len(),
                    "image_present": slide.image.is_some(),
                })
            })
            .collect(),
    ))
}

fn docx_outline(source_json: &str) -> Result<Value, String> {
    let input: crate::modules::generated_files::docx_generator::WriteDocxInput =
        serde_json::from_str(source_json)
            .map_err(|err| format!("failed to parse stored docx source_json: {err}"))?;

    Ok(json!({
        "title": input.title,
        "theme_style": input.theme_style.as_str(),
        "sections": input.sections.iter().enumerate().map(|(index, section)| {
            json!({
                "index": index + 1,
                "heading": section.heading,
                "paragraph_count": section.paragraphs.len(),
                "bullet_count": section.bullets.len(),
                "table_count": section.tables.len(),
            })
        }).collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pptx_outline_summarizes_slides_without_binary_content() {
        let source = r#"{
            "filename": "deck.pptx",
            "theme_style": "default",
            "slides": [
                {"layout": "cover", "title": "Cover", "subtitle": "Q1"},
                {"layout": "two_column", "title": "Compare", "left_bullets": ["A"], "right_bullets": ["B", "C"]}
            ]
        }"#;

        let outline = pptx_outline(source).expect("build pptx outline");
        assert_eq!(outline[0]["index"], 1);
        assert_eq!(outline[0]["subtitle_present"], true);
        assert_eq!(outline[1]["bullet_count"], 3);
        assert!(outline.to_string().find("data:image").is_none());
    }

    #[test]
    fn docx_outline_summarizes_sections() {
        let source = r#"{
            "filename": "report.docx",
            "title": "Report",
            "sections": [
                {
                    "heading": "Summary",
                    "paragraphs": ["One"],
                    "bullets": ["A", "B"],
                    "tables": [{"headers": ["Metric"], "rows": [["42"]]}]
                }
            ]
        }"#;

        let outline = docx_outline(source).expect("build docx outline");
        assert_eq!(outline["title"], "Report");
        assert_eq!(outline["sections"][0]["heading"], "Summary");
        assert_eq!(outline["sections"][0]["bullet_count"], 2);
        assert_eq!(outline["sections"][0]["table_count"], 1);
    }
}
