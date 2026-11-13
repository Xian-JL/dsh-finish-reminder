# 仓库结构与本地清理

## 公开仓库

src、helper、assets、scripts、tests为当前工程。lib和native/Reminder.exe是预构建运行组件；dist保存当前可安装包、SHA256和版本收据。README、开发文档与人工用例说明对应当前版本，历史设计位于docs/history。

公开仓库不包含真实Profile、凭据、账户配置、桌面对话内容、沙箱数据、私有安装备份或宿主源码提取文件。开发生成的.verification、artifacts和node_modules均由.gitignore排除。

## 本地归档

首次整理时，旧.verification与旧artifacts已移出项目目录，作为本地私有归档保留。归档目录不属于本仓库，不上传。原已安装版本引用的本地tgz及校验文件仍保留在原artifacts位置，避免破坏现有Profile的file依赖。

npm run package默认输出dist，不覆盖本地已安装包的artifacts路径。可以通过DSH_REMINDER_PACKAGE_DIR显式改输出目录；除非明确准备升级并更新锁文件，不应覆盖已被Profile引用的旧tgz。

## 维护

更改源码后重新构建lib和native，执行开发检查，再重新生成dist。源码哈希、生成文件哈希和安装包哈希分别记录，不能只改二进制或沿用旧收据。自动测试、离屏图与用户反馈分别记录，不把单项反馈编造成全部人工用例已执行。
