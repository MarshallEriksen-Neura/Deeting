# 媒体资产上传与去重

用于前端上传图片/文件时的“全局去重 + 预签名直传”流程。仅用于上传流程内部调用。

## 鉴权
- 需要用户登录（Bearer Token）

## POST /media/assets/upload/init
初始化上传：检查去重，命中直接返回可展示 URL；未命中返回预签名上传地址。

请求体字段：
- `content_hash` string，SHA-256 hex（必填）
- `size_bytes` number，内容大小（必填）
- `content_type` string，内容类型（必填）
- `kind` string，资源类型前缀（可选）
- `expires_seconds` number，上传预签名有效期（可选）

响应示例（命中去重）：
```json
{
  "deduped": true,
  "object_key": "assets/demo/2026/01/15/hello.png",
  "asset_url": "https://api.example.com/api/v1/media/assets/assets/demo/2026/01/15/hello.png?expires=...&sig=...",
  "upload_url": null,
  "upload_headers": null,
  "expires_in": null
}
```

响应示例（未命中）：
```json
{
  "deduped": false,
  "object_key": "assets/demo/2026/01/15/new.png",
  "asset_url": null,
  "upload_url": "https://oss.example.com/...",
  "upload_headers": {
    "Content-Type": "image/png",
    "x-oss-meta-sha256": "..."
  },
  "expires_in": 600
}
```

## POST /media/assets/upload/complete
上传完成确认：校验元信息并写入去重索引。

请求体字段：
- `object_key` string，对象存储 Key（必填）
- `content_hash` string，SHA-256 hex（必填）
- `size_bytes` number，内容大小（必填）
- `content_type` string，内容类型（必填）

响应示例：
```json
{
  "object_key": "assets/demo/2026/01/15/new.png",
  "asset_url": "https://api.example.com/api/v1/media/assets/assets/demo/2026/01/15/new.png?expires=...&sig=..."
}
```

## GET /media/assets/{object_key}
通过网关短链签名访问资产（无需额外鉴权，需带 `expires` 与 `sig`）。

---

## 后续规划：AI 视频上传
当前仅提供通用文件直传 + 去重流程，AI 生成视频的完整上传链路将在后续补齐。计划包括：
- 分片/断点续传（multipart）
- 上传完成回调或服务端确认
- 视频后处理流水线（转码/抽帧/封面）
- 大小/时长/格式校验与安全策略
