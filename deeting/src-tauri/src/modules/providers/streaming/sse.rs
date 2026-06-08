#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseFrame {
    pub event: Option<String>,
    pub data: String,
    pub is_done: bool,
}

#[derive(Debug, Default)]
pub struct SseFramer {
    pending: String,
    event: Option<String>,
    data_lines: Vec<String>,
}

impl SseFramer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push_chunk(&mut self, chunk: &[u8]) -> Vec<SseFrame> {
        let text = String::from_utf8_lossy(chunk);
        self.pending.push_str(&text);

        let mut frames = Vec::new();
        while let Some((line, consumed)) = take_next_line(self.pending.as_str()) {
            self.pending.drain(..consumed);
            if let Some(frame) = self.push_line(line.as_str()) {
                frames.push(frame);
            }
        }
        frames
    }

    pub fn finish(&mut self) -> Option<SseFrame> {
        if !self.pending.is_empty() {
            let line = std::mem::take(&mut self.pending);
            if let Some(frame) = self.push_line(line.as_str()) {
                return Some(frame);
            }
        }
        self.dispatch_frame()
    }

    fn push_line(&mut self, line: &str) -> Option<SseFrame> {
        if line.is_empty() {
            return self.dispatch_frame();
        }
        if line.starts_with(':') {
            return None;
        }

        let (field, value) = split_sse_field(line);
        match field {
            "event" => {
                self.event = Some(value.to_string());
            }
            "data" => {
                self.data_lines.push(value.to_string());
            }
            _ => {}
        }
        None
    }

    fn dispatch_frame(&mut self) -> Option<SseFrame> {
        if self.data_lines.is_empty() {
            self.event = None;
            return None;
        }

        let data = std::mem::take(&mut self.data_lines).join("\n");
        let event = self.event.take();
        let is_done = data.trim() == "[DONE]";
        Some(SseFrame {
            event,
            data,
            is_done,
        })
    }
}

fn take_next_line(input: &str) -> Option<(String, usize)> {
    let newline_index = input.find('\n')?;
    let consumed = newline_index + 1;
    let mut line = &input[..newline_index];
    if let Some(stripped) = line.strip_suffix('\r') {
        line = stripped;
    }
    Some((line.to_string(), consumed))
}

fn split_sse_field(line: &str) -> (&str, &str) {
    let Some((field, value)) = line.split_once(':') else {
        return (line, "");
    };
    (field, value.strip_prefix(' ').unwrap_or(value))
}

#[cfg(test)]
mod tests {
    use super::SseFramer;

    #[test]
    fn sse_framer_handles_fragmented_lines() {
        let mut framer = SseFramer::new();

        assert!(framer.push_chunk(b"data: {\"a\"").is_empty());
        assert!(framer.push_chunk(b":1}\n").is_empty());
        let frames = framer.push_chunk(b"\n");

        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "{\"a\":1}");
        assert!(!frames[0].is_done);
    }

    #[test]
    fn sse_framer_dispatches_multi_line_data() {
        let mut framer = SseFramer::new();
        let frames =
            framer.push_chunk(b"event: response.output_text.delta\ndata: first\ndata: second\n\n");

        assert_eq!(frames.len(), 1);
        assert_eq!(
            frames[0].event.as_deref(),
            Some("response.output_text.delta")
        );
        assert_eq!(frames[0].data, "first\nsecond");
    }

    #[test]
    fn sse_framer_ignores_comments_and_marks_done() {
        let mut framer = SseFramer::new();
        let frames = framer.push_chunk(b": keepalive\ndata: [DONE]\n\n");

        assert_eq!(frames.len(), 1);
        assert!(frames[0].is_done);
    }

    #[test]
    fn sse_framer_flushes_final_unterminated_line() {
        let mut framer = SseFramer::new();

        assert!(framer.push_chunk(b"data: final").is_empty());
        let frame = framer.finish().expect("final frame");

        assert_eq!(frame.data, "final");
    }
}
