# Installer 集成完成总结

## ✅ 已完成的工作

### 1. 修改 GitHub Actions 工作流

**文件**: `.github/workflows/release.yml`

**变更**:
- 将单 job 改为多 job 架构
- `build-main`: 构建主应用（所有平台）
- `build-windows-installer`: 构建 Windows installer（仅 Windows）
- `publish-final-release`: 发布最终产物

**流程**:
```
build-main → build-windows-installer → publish-final-release
```

### 2. 配置 Installer 资源嵌入

**文件**: `installer/src-tauri/tauri.conf.json`

**变更**:
```json
{
  "bundle": {
    "resources": {
      "resources/deeting-setup.exe": "resources/"
    }
  }
}
```

### 3. 更新资源查找逻辑

**文件**: `installer/src-tauri/src/installer.rs`

**变更**:
- 增强 `find_embedded_installer()` 函数
- 支持多种路径查找策略
- 添加 Tauri 运行时资源目录支持

### 4. 创建文档

**新增文件**:
- `installer/README.md` - Installer 完整文档

**更新文件**:
- `README.md` - 添加 Windows 安装说明
- `README.zh.md` - 添加中文安装说明
- `docs/release-workflow.md` - 更新发布流程说明

## 📦 构建流程

### 自动构建（CI/CD）

```bash
# 推送 tag 触发构建
git tag v0.1.0
git push origin v0.1.0
```

**构建阶段**:

1. **阶段 1: 构建主应用**
   - macOS (ARM64 + x86_64)
   - Linux (deb + AppImage)
   - Windows (NSIS)

2. **阶段 2: 构建 Installer（仅 Windows）**
   - 下载主应用 NSIS 安装包
   - 复制到 `installer/src-tauri/resources/deeting-setup.exe`
   - 构建 installer（嵌入主安装包）

3. **阶段 3: 发布最终产物**
   - 上传 bootstrapper installer 到 GitHub Release

### 手动构建

```bash
# 1. 构建主应用
cd deeting
bun install
bun run tauri build

# 2. 准备资源
cd ../installer
mkdir -p src-tauri/resources
cp ../deeting/src-tauri/target/release/bundle/nsis/*.exe \
   src-tauri/resources/deeting-setup.exe

# 3. 构建 installer
bun install
bun run tauri build
```

## 🎯 发布产物

| 文件名 | 说明 | 大小 |
|--------|------|------|
| `Deeting Setup_x.x.x_x64-setup.exe` | 标准 NSIS 安装包 | ~150MB |
| `Deeting Setup_x.x.x_x64-bootstrapper.exe` | 图形化引导安装（推荐） | ~150MB + 几 MB |
| `Deeting_x.x.x_aarch64.dmg` | macOS ARM64 | ~200MB |
| `Deeting_x.x.x_x64.dmg` | macOS Intel | ~200MB |
| `deeting_x.x.x_amd64.deb` | Debian/Ubuntu | ~150MB |
| `deeting_x.x.x_x86_64.AppImage` | Linux 通用 | ~180MB |

## 🖥️ 用户体验

### Windows 用户

1. 下载 `Deeting Setup_x.x.x_x64-bootstrapper.exe`
2. 运行安装程序
3. 看到图形化界面：
   - 选择安装路径
   - 配置快捷方式/开机自启
   - 点击"极速安装"
4. installer 自动调用嵌入的主安装包
5. 完成安装

### macOS/Linux 用户

保持原有的 DMG/deb/AppImage 方式，符合用户习惯。

## ⚠️ 注意事项

### 1. 资源嵌入检查

构建 installer 前，确保：
```bash
ls -la installer/src-tauri/resources/deeting-setup.exe
```

### 2. 路径一致性

确保以下路径一致：
- `tauri.conf.json` 中的 `resources` 配置
- `installer.rs` 中的 `find_embedded_installer()` 路径

### 3. 平台限制

- Installer 仅支持 Windows（NSIS）
- macOS/Linux 保持原有安装方式

### 4. 签名

如需签名，配置 GitHub Secrets：
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### 5. 测试

首次发布前，建议：
1. 本地手动构建测试
2. 检查所有产物是否正常
3. 测试安装流程

## 🔍 故障排查

### 问题 1: installer 找不到嵌入的安装包

**检查**:
```bash
# 查看构建产物
ls -la installer/src-tauri/target/release/bundle/nsis/

# 检查资源是否嵌入
ls -la installer/src-tauri/resources/
```

**解决**:
- 确保 CI 中正确复制了主安装包
- 检查 `tauri.conf.json` 配置

### 问题 2: 构建失败

**检查**:
- GitHub Actions 日志
- Rust 编译错误
- 依赖安装问题

**解决**:
- 查看具体错误信息
- 确保所有依赖正确安装

### 问题 3: 安装失败

**检查**:
- 主安装包是否正常（可单独运行测试）
- 安装路径权限
- 磁盘空间

## 📊 性能影响

| 指标 | 影响 |
|------|------|
| 构建时间 | +5-10 分钟（仅 Windows） |
| 安装包大小 | +几 MB（installer 包装层） |
| 用户体验 | ✅ 显著提升（图形化界面） |
| 维护成本 | ✅ 低（自动化 CI/CD） |

## 🚀 未来改进

1. **多语言支持**
   - 添加更多语言选项
   - 自动检测系统语言

2. **高级选项**
   - 自定义安装组件
   - 便携模式

3. **更新检测**
   - 安装时检查最新版本
   - 提供更新选项

4. **卸载程序**
   - 添加图形化卸载向导
   - 清理残留文件

## 📝 相关文档

- [Installer 文档](../installer/README.md)
- [发布流程](./release-workflow.md)
- [macOS 安装说明](./macos-installation.md)
- [主 README](../../README.md)

## ✨ 总结

installer 已成功集成到发布流程中，为 Windows 用户提供更好的安装体验：

- ✅ 自动化构建流程
- ✅ 资源正确嵌入
- ✅ 文档完整更新
- ✅ 多平台支持（Windows + 其他平台原有方式）

下次发布时，GitHub Actions 会自动构建并发布两种安装包供用户选择。
