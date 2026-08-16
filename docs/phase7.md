# Phase 7 — 公开发布准备 进展

状态：发布物料已就绪；npm pack 验证通过。尚未实际执行 `npm publish`（等待发布账号与目标仓库/组织信息）。

## 已完成

- `README.md` / `README.zh-CN.md`：支持平台、DSH 版本、Windows/WSL 范围、权限、隐私、安装、卸载、故障排查。
- `LICENSE`（MIT）、`SECURITY.md`、`CONTRIBUTING.md`。
- `package.json`：移除 `private`；`publishConfig.access=public`；`files` 发布清单；`prepare` 支持 git 安装构建；`prepublishOnly` 质量门禁。
- `build` 先清理 `lib/`，避免把历史 chunk 打进 npm 包。
- CI：`.github/workflows/ci.yml`（ubuntu + windows：typecheck/unit/UI/build，Windows 只读 smoke）。
- Release：`.github/workflows/release.yml`（manual dispatch → npm publish，使用 `NPM_TOKEN`）。
- `npm pack --dry-run`：通过；发布包仅 12 个文件，unpacked 182.9 kB。

## 发布前仅剩的人工项

1. 确认最终 git 仓库地址并填入 `package.json` 的 `repository/homepage/bugs`。
2. 确认首个版本号（当前 `0.1.0`）。
3. 配置 npm `NPM_TOKEN` 与 GitHub Actions 权限。
4. 实际 `npm publish` 后，向 Awesome DSH Plugins 提交条目。
