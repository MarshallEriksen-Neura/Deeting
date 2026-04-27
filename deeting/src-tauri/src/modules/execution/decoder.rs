#[cfg(target_os = "windows")]
use encoding_rs::GB18030;

#[derive(Debug, Clone)]
pub struct DecodedText {
    pub text: String,
    pub encoding_used: String,
    pub warnings: Vec<String>,
}

pub fn decode_output(bytes: &[u8]) -> DecodedText {
    #[cfg(target_os = "windows")]
    {
        decode_windows_text(bytes)
    }

    #[cfg(not(target_os = "windows"))]
    {
        decode_utf8_text(bytes)
    }
}

#[cfg(not(target_os = "windows"))]
fn decode_utf8_text(bytes: &[u8]) -> DecodedText {
    match String::from_utf8(bytes.to_vec()) {
        Ok(text) => DecodedText {
            text,
            encoding_used: "utf-8".to_string(),
            warnings: Vec::new(),
        },
        Err(_) => DecodedText {
            text: String::from_utf8_lossy(bytes).into_owned(),
            encoding_used: "utf-8-lossy".to_string(),
            warnings: vec!["output was not valid utf-8; used lossy decoding".to_string()],
        },
    }
}

#[cfg(target_os = "windows")]
fn decode_windows_text(bytes: &[u8]) -> DecodedText {
    if bytes.is_empty() {
        return DecodedText {
            text: String::new(),
            encoding_used: "utf-8".to_string(),
            warnings: Vec::new(),
        };
    }

    if let Some(text) = decode_utf16_with_bom(bytes) {
        return DecodedText {
            text,
            encoding_used: "utf-16".to_string(),
            warnings: Vec::new(),
        };
    }

    if should_decode_as_utf16le(bytes) {
        let mut units = Vec::with_capacity(bytes.len() / 2);
        for chunk in bytes.chunks_exact(2) {
            units.push(u16::from_le_bytes([chunk[0], chunk[1]]));
        }
        return DecodedText {
            text: String::from_utf16_lossy(&units)
                .trim_matches(char::from(0))
                .to_string(),
            encoding_used: "utf-16le".to_string(),
            warnings: Vec::new(),
        };
    }

    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
        return DecodedText {
            text,
            encoding_used: "utf-8".to_string(),
            warnings: Vec::new(),
        };
    }

    let (decoded, _, had_errors) = GB18030.decode(bytes);
    if !had_errors {
        return DecodedText {
            text: decoded.into_owned(),
            encoding_used: "gb18030".to_string(),
            warnings: Vec::new(),
        };
    }

    DecodedText {
        text: String::from_utf8_lossy(bytes).into_owned(),
        encoding_used: "utf-8-lossy".to_string(),
        warnings: vec!["output was not valid utf-8 or gb18030; used lossy decoding".to_string()],
    }
}

#[cfg(target_os = "windows")]
fn decode_utf16_with_bom(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 2 {
        return None;
    }

    if bytes.starts_with(&[0xFF, 0xFE]) {
        let mut units = Vec::with_capacity((bytes.len() - 2) / 2);
        for chunk in bytes[2..].chunks_exact(2) {
            units.push(u16::from_le_bytes([chunk[0], chunk[1]]));
        }
        return Some(
            String::from_utf16_lossy(&units)
                .trim_matches(char::from(0))
                .to_string(),
        );
    }

    if bytes.starts_with(&[0xFE, 0xFF]) {
        let mut units = Vec::with_capacity((bytes.len() - 2) / 2);
        for chunk in bytes[2..].chunks_exact(2) {
            units.push(u16::from_be_bytes([chunk[0], chunk[1]]));
        }
        return Some(
            String::from_utf16_lossy(&units)
                .trim_matches(char::from(0))
                .to_string(),
        );
    }

    None
}

#[cfg(target_os = "windows")]
fn should_decode_as_utf16le(bytes: &[u8]) -> bool {
    if bytes.len() < 2 || bytes.len() % 2 != 0 {
        return false;
    }
    let zero_bytes = bytes
        .iter()
        .skip(1)
        .step_by(2)
        .filter(|byte| **byte == 0)
        .count();
    zero_bytes * 2 >= bytes.len() / 2
}

#[cfg(test)]
mod tests {
    use super::decode_output;

    #[cfg(target_os = "windows")]
    #[test]
    fn decode_output_supports_utf16le() {
        let bytes: Vec<u8> = "Get-ChildItem"
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect();
        let decoded = decode_output(&bytes);
        assert_eq!(decoded.text, "Get-ChildItem");
        assert_eq!(decoded.encoding_used, "utf-16le");
    }

    #[test]
    fn decode_output_handles_utf8() {
        let decoded = decode_output("hello".as_bytes());
        assert_eq!(decoded.text, "hello");
    }
}
