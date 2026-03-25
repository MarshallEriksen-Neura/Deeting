# Desktop TTS Provider Config Reference

Date: 2026-03-25

## Scope

This reference matches the current desktop-local pure TTS runtime only.

Supported phase-one adapters:

- `openai_tts`
- `minimax_tts`
- `volcengine_tts`

Out of scope for this reference:

- voice cloning
- reference-audio upload
- speech-to-text

## Dispatch rules

Desktop runtime resolves TTS adapter in this order:

1. `model.config_override.voice_runtime`
2. `instance.meta.voice_runtime`
3. `preset.provider`
4. `instance.meta.protocol`

Recommended values:

- `openai_tts`
- `minimax_tts`
- `volcengine_tts`

## OpenAI-compatible

### Preset

- `provider`: `openai`
- `base_url`: provider root, for example `https://api.openai.com/v1`
- `auth_type`: `bearer`
- `protocol_profiles`: use your existing `text_to_speech` OpenAI-compatible profile

### Instance meta

Usually empty. Add only if that provider needs custom protocol metadata.

### Model

- capability: `text_to_speech`
- `upstream_path`: `audio/speech` if base URL already includes `/v1`
- `upstream_path`: `v1/audio/speech` if base URL does not include `/v1`

### model.config_override

Optional:

```json
{
  "voice_runtime": "openai_tts"
}
```

### Task-agent `text_to_speech` config

```json
{
  "text_to_speech": {
    "voice": "alloy",
    "response_format": "mp3",
    "speed": 1.0
  }
}
```

## MiniMax

### Preset

- `provider`: `minimax`
- `base_url`: `https://api.minimaxi.com`
- `auth_type`: `bearer`

MiniMax does not use the OpenAI-compatible TTS adapter in this runtime.

### Instance meta

Optional:

```json
{
  "voice_runtime": "minimax_tts"
}
```

### Model

- capability: `text_to_speech`
- `upstream_path`: may be left as a descriptive value for admin clarity, but runtime dispatch currently calls MiniMax through its dedicated adapter rather than the generic provider request runtime

Recommended:

```json
{
  "voice_runtime": "minimax_tts"
}
```

### model.config_override

```json
{
  "voice_runtime": "minimax_tts"
}
```

### Task-agent `text_to_speech` config

Use `voice` as the MiniMax `voice_id`.

```json
{
  "text_to_speech": {
    "voice": "Chinese (Mandarin)_Reliable_Executive",
    "response_format": "mp3",
    "speed": 1.0,
    "extra_params": {
      "output_format": "hex",
      "sample_rate": 32000
    }
  }
}
```

Supported MiniMax-oriented `extra_params` currently preserved by the adapter:

- `voice_id`
- `speaker`
- `speed`
- `vol`
- `pitch`
- `emotion`
- `sample_rate`
- `audio_sample_rate`
- `bitrate`
- `channel`
- `output_format`
- `pronunciation_dict`
- `language_boost`
- `voice_modify`
- `timbre_weights`
- `stream_options`
- `subtitle_enable`
- `aigc_watermark`

Notes:

- `voice` is mapped to `voice_setting.voice_id`
- `output_format = "url"` is treated as URL-return mode
- default assumption is hex audio in `data.audio`

## Volcengine

### Preset

- `provider`: `volcengine_tts` recommended
- `base_url`: `https://sami.bytedance.com`
- `auth_type`: `bearer`

### Instance meta

Required:

```json
{
  "voice_runtime": "volcengine_tts",
  "app_id": "123456789",
  "resource_id": "seed-tts-2.0"
}
```

### Model

- capability: `text_to_speech`
- `upstream_path`: informational only for now; the dedicated Volcengine adapter does not rely on the generic provider request runtime

Recommended:

```json
{
  "voice_runtime": "volcengine_tts"
}
```

### model.config_override

```json
{
  "voice_runtime": "volcengine_tts"
}
```

### Task-agent `text_to_speech` config

Use `voice` as the Volcengine `voice_type`.

```json
{
  "text_to_speech": {
    "voice": "zh_female_qingxin",
    "response_format": "wav",
    "extra_params": {
      "sample_rate": 24000,
      "speech_rate": 10,
      "loudness_rate": 100
    }
  }
}
```

Supported Volcengine-oriented `extra_params` currently preserved by the adapter:

- `model`
- `emotion`
- `emotion_scale`
- `speech_rate`
- `loudness_rate`
- `enable_timestamp`
- `bit_rate`
- `sample_rate`
- `ssml`
- `context_texts`
- `mix_speaker`

Notes:

- `voice` is mapped to request `speaker`
- `app_id` is expected from provider instance metadata and is sent as `X-Api-App-Id`
- `resource_id` is expected from provider instance metadata and is sent as `X-Api-Resource-Id`
- instance credential secret is sent as `X-Api-Access-Key`
- audio is expected in response `data` as base64
- runtime uses `/api/v3/tts/unidirectional`

## Recommended admin naming

Preset names:

- `OpenAI TTS`
- `MiniMax TTS`
- `Volcengine TTS`

Recommended slugs:

- `openai-tts`
- `minimax-tts`
- `volcengine-tts`

Recommended model-level `voice_runtime`:

- OpenAI model: `openai_tts`
- MiniMax model: `minimax_tts`
- Volcengine model: `volcengine_tts`
