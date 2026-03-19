# 发布流程说明

## 自动发布

本项目使用 GitHub Actions 自动构建和发布应用。

### 触发发布

#### 方式 1：手动触发（推荐）

1. 进入 GitHub 仓库的 **Actions** 页面
2. 选择 **Release** workflow
3. 点击 **Run workflow**
4. 输入版本号（如 `v0.2.0`）
5. 点击 **Run workflow**

#### 方式 2：推送 tag

```bash
# 更新版本号
# package.json 和 tauri.conf.json 中的版本

# 创建并推送 tag
git tag v0.2.0
git push origin v0.2.0
```

### 自动构建内容

GitHub Actions 会自动：

#### 阶段 1: 构建主应用
- ✅ 构建 Windows 安装包（NSIS）
- ✅ 构建 macOS 安装包（DMG，未签名）
- ✅ 构建 Linux 安装包（deb、AppImage）
- ✅ 生成签名文件（`.sig`）
- ✅ 创建 GitHub Release
- ✅ 上传所有安装包
- ✅ 生成 `latest.json`（用于自动更新）

#### 阶段 2: 构建 Windows Installer（仅 Windows）
- ✅ 将主应用 NSIS 安装包嵌入 installer
- ✅ 构建图形化安装引导程序
- ✅ 上传 bootstrapper 安装包

#### 阶段 3: 发布最终产物
- ✅ 将 bootstrapper 上传到 Release
- ✅ 用户可选择标准安装包或引导式安装

### 发布产物说明

| 文件名 | 说明 | 适用平台 |
|--------|------|---------|
| `Deeting Setup_x.x.x_x64-setup.exe` | 标准 NSIS 安装包 | Windows |
| `Deeting Setup_x.x.x_x64-bootstrapper.exe` | 图形化引导安装程序（推荐） | Windows |
| `Deeting_x.x.x_aarch64.dmg` | macOS ARM64 安装包 | macOS |
| `Deeting_x.x.x_x64.dmg` | macOS Intel 安装包 | macOS |
| `deeting_x.x.x_amd64.deb` | Debian/Ubuntu 安装包 | Linux |
| `deeting_x.x.x_x86_64.AppImage` | 通用 Linux 安装包 | Linux |

## 签名配置

### 更新包签名（必需）

用于验证更新包完整性，防止篡改。

#### 生成密钥对

```bash
# 安装 Tauri CLI（如果还没有）
cargo install tauri-cli

# 生成密钥对
tauri signer generate -w ~/.tauri/deeting.key
```

输出示例：
```
Your keypair was generated successfully!
Private key: dW50cnVzdGVkLWNvbW1lbnQ6... (保存到 GitHub Secrets)
Public key: dW50cnVzdGVkLWNvbW1lbnQ6c... (保存到 tauri.conf.json)
Password: [你输入的密码] (保存到 GitHub Secrets)
```

#### 配置 GitHub Secrets

在 **Settings → Secrets and variables → Actions** 添加：

| Secret Name | 说明 |
|------------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | 私钥内容（base64 格式） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 密钥密码 |

#### 更新 tauri.conf.json

```json
{
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkLWNvbW1lbnQ6c...",  // 填入公钥
      "endpoints": [
        "https://github.com/MarshallEriksen-Neura/Deeting/releases/latest/download/latest.json"
      ]
    }
  }
}
```

### macOS 代码签名（可选）

由于本项目为开源项目，暂未购买 Apple 开发者账号（$99/年），macOS 版本未经签名。

- 用户首次打开需要：右键 → 打开
- 详细说明见：[macOS 安装指南](./macos-installation.md)

如果未来获得 Apple 开发者账号，可添加以下 Secrets：

| Secret Name | 说明 |
|------------|------|
| `APPLE_CERTIFICATE` | Apple 开发者证书（base64） |
| `APPLE_CERTIFICATE_PASSWORD` | 证书密码 |
| `KEYCHAIN_PASSWORD` | 钥匙串密码 |
| `APPLE_SIGNING_IDENTITY` | 签名身份 |
| `APPLE_ID` | Apple ID 邮箱 |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Team ID |

## 更新流程

### 用户端

1. 应用启动时自动检查更新
2. 发现新版本时弹出更新对话框
3. 用户点击更新 → 下载安装包
4. 验证签名 → 安装并重启

### 开发端

1. 更新版本号（`package.json`、`tauri.conf.json`）
2. 提交代码并推送
3. 触发 GitHub Actions 发布
4. 等待构建完成（约 20-30 分钟）
5. 检查 GitHub Releases 页面

## 版本号规范

遵循语义化版本（SemVer）：

- `v1.0.0` - 主版本.次版本.修订版本
- `v1.0.0-beta.1` - 预发布版本
- `v1.0.0-rc.1` - 候选版本

## 常见问题

### Q: 为什么 macOS 提示"无法验证开发者"？

A: 因为未购买 Apple 开发者账号，应用未经公证。用户需要右键 → 打开，或在系统设置中允许。

### Q: 更新包的签名是必需的吗？

A: 是的，即使应用未经 macOS 公证，更新包仍需要签名以验证完整性。

### Q: 如何支持 macOS 官方签名？

A: 需要购买 Apple 开发者账号（$99/年）。可通过 GitHub Sponsors 等方式筹集资金。

## 相关文档

- [Tauri Updater 文档](https://tauri.app/v1/guides/distribute/updater/)
- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [macOS 安装指南](./macos-installation.md)
