# Deeting

Deeting 主仓库。

## 子模块

当前主仓包含以下 Git submodule：

- deeting-relay - Relay 中转服务仓库
- scout - Scout 仓库

首次克隆建议使用：

`ash
git clone --recurse-submodules https://github.com/MarshallEriksen-Neura/Deeting.git
`

如果已经克隆过主仓，再执行：

`ash
git submodule update --init --recursive
`

更新子模块时：

1. 先进入子仓库目录，在子仓里提交并推送变更。
2. 回到主仓。
3. 执行 git add <submodule-path>，然后提交主仓里的子模块指针更新。