# Deeting Installer

现代图形化安装引导程序，基于 Tauri 2.0 构建。

## 功能特性

- ✨ 精美的图形化安装界面
- 🎯 自定义安装路径
- 🖥️ 创建桌面快捷方式选项
- 🚀 开机自启动选项
- 📦 嵌入式安装包（无需额外下载）
- 🌐 多语言支持（中文/英文）

## 构建流程

### 自动构建（推荐）

Installer 已集成到 CI/CD 流程中。推送 tag 或手动触发 GitHub Actions 即可自动构建：

```bash
git tag v0.1.0
git push origin v0.1.0
```

构建流程：
1. 构建主应用 → 生成 `Deeting Setup_x.x.x_x64-setup.exe`
2. 将主安装包复制到 `installer/src-tauri/resources/deeting-setup.exe`
3. 构建 installer → 嵌入主安装包
4. 发布 installer bootstrapper 作为最终安装包

### 手动构建

#### 前置条件

1. 安装 [Rust](https://rustup.rs/)
2. 安装 [Bun](https://bun.sh/)
3. 安装 Tauri CLI: `cargo install tauri-cli`

#### 步骤

1. **构建主应用**

```bash
cd ../deeting
bun install
bun run tauri build
```

生成的安装包位于：`deeting/src-tauri/target/release/bundle/nsis/`

2. **准备 installer 资源**

```bash
mkdir -p src-tauri/resources
cp ../deeting/src-tauri/target/release/bundle/nsis/*.exe \
   src-tauri/resources/deeting-setup.exe
```

3. **构建 installer**

```bash
cd ../installer
bun install
bun run tauri build
```

生成的安装包位于：`installer/src-tauri/target/release/bundle/nsis/`

## 开发模式

```bash
# 启动开发服务器（需要先构建主应用）
bun install
bun run tauri:dev
```

开发模式下，如果没有嵌入的安装包，installer 会模拟安装流程。

## 目录结构

```
installer/
├── app/                    # Next.js 前端应用
│   ├── page.tsx           # 主页面
│   └── globals.css        # 全局样式
├── components/            # React 组件
│   ├── steps/            # 安装步骤组件
│   │   ├── welcome.tsx   # 欢迎页
│   │   ├── installing.tsx # 安装进度页
│   │   └── complete.tsx  # 完成页
│   ├── logo.tsx          # Logo 组件
│   ├── neural-background.tsx # 神经网络背景
│   └── title-bar.tsx     # 标题栏
├── src-tauri/            # Tauri 后端
│   ├── src/
│   │   ├── lib.rs       # Tauri 命令注册
│   │   └── installer.rs # 安装核心逻辑
│   ├── resources/       # 嵌入的资源（构建时生成）
│   │   └── deeting-setup.exe
│   └── tauri.conf.json  # Tauri 配置
└── package.json
```

## 技术栈

- **前端**: Next.js 15 + React 19 + Tailwind CSS 4
- **后端**: Tauri 2 + Rust
- **构建工具**: Bun

## 安装流程

用户运行 installer 后的流程：

1. **欢迎页**
   - 显示品牌信息
   - 选择安装路径
   - 配置安装选项（快捷方式、开机自启）

2. **安装进度页**
   - 准备安装环境
   - 解压应用文件
   - 安装核心组件
   - 配置系统组件
   - 创建快捷方式

3. **完成页**
   - 显示安装结果
   - 提供启动应用选项

## 资源嵌入原理

Tauri 允许将文件嵌入到应用包中：

```json
// tauri.conf.json
{
  "bundle": {
    "resources": {
      "resources/deeting-setup.exe": "resources/"
    }
  }
}
```

构建时，Tauri 会：
1. 将 `resources/deeting-setup.exe` 嵌入到应用二进制文件
2. 运行时提取到临时目录或应用资源目录
3. Rust 代码通过路径访问：`resources/deeting-setup.exe`

## 自定义配置

### 修改安装选项默认值

编辑 `app/page.tsx`：

```typescript
const [options, setOptions] = useState<InstallOptions>({
  installPath: "",
  createShortcut: true,  // 默认创建快捷方式
  autoStart: false,      // 默认不开机自启
});
```

### 修改窗口大小

编辑 `src-tauri/tauri.conf.json`：

```json
{
  "app": {
    "windows": [{
      "width": 680,
      "height": 480
    }]
  }
}
```

### 修改安装阶段消息

编辑 `src-tauri/src/installer.rs` 中的 `run_install` 函数：

```rust
send_progress(&tx, "installing", 35, "正在安装核心框架...").await;
```

## 注意事项

1. **资源路径**: 确保在构建 installer 前，主应用安装包已复制到 `src-tauri/resources/`
2. **签名**: 如需签名，配置 GitHub Secrets（参考主应用发布流程）
3. **平台限制**: 当前仅支持 Windows（NSIS）
4. **安装模式**: 默认使用 `currentUser` 模式，无需管理员权限

## 故障排查

### 找不到嵌入的安装包

检查：
1. `src-tauri/resources/deeting-setup.exe` 是否存在
2. `tauri.conf.json` 中的 `resources` 配置是否正确
3. Rust 代码中的路径是否匹配

### 安装失败

检查：
1. 主安装包是否正常（可单独运行测试）
2. 安装路径权限
3. 磁盘空间是否充足

## 相关文档

- [Tauri 资源嵌入](https://tauri.app/v2/guides/building/resources/)
- [Tauri Bundler](https://tauri.app/v2/guides/building/)
- [项目发布流程](../../docs/release-workflow.md)
