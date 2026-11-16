# 宿主兼容性

## 0.3.1与DSH 0.2.2-rc.3

日期：2026-11-16。0.3.0的engines.dsh为精确版本0.2.2-rc.1，升级到rc.3后被宿主按元数据判为不兼容。0.3.1改为明确的“0.2.2-rc.1 || 0.2.2-rc.3”，没有无条件扩大到所有0.2.x或未来版本。

当前安装内嵌dsh、dsh-session、dsh-agent-loop和相关Client包均核对为0.2.2-rc.3。root status/whenIdle、turn/end、inbox claim与rc.1的相关源码区域一致。Client产物的打包格式发生变化，但openSession、replaceMain、mainView绑定与事件窗口接口继续存在，原导航适配可继续使用。

## 开发证据

probe:compatibility使用当前Desktop内嵌的semver实际判断发布包范围，确认rc.1/rc.3可接受，rc.2、rc.4及正式版等未核对版本仍被排除。它用真实SDK的脱离业务Session及合成根Agent产生结束事件，检查首次实时边界、结束分类和恢复历史不重发；同时记录必要源码接口指纹。

probe:host及确切tarball的解包加载检查会在实际Cordis上验证兼容范围、配置生命周期和路由清理。检查结果含宿主版本及插件版本，位于本地.verification，不提交宿主源码或真实Profile。

这些检查不登录、不调用模型、不操作真实对话。原rc.1用户验收结论保持；rc.3真实业务/桌面操作仍由用户在加载新版后观察。0.3.1不修改提醒、纸张UI、计数或持久化格式。

## 升级

使用0.3.1预构建包升级即可，无需手工修改DSH安装文件或删除记录。若安装时Desktop仍在运行，安装完成与进程加载是两个状态；重新启动DSH后使用新版本，不强制结束进行中的任务。
