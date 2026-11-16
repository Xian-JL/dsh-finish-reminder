# Desktop适配实现说明

## 图标后端

首版采用独立原生Helper合成窗口基础图标：读取当前窗口图标，绘制右上角精确数字，通过 WM_SETICON 提交；多个已授权实例由单一协调者提供相同聚合值。保存原始句柄和自己的合成句柄，撤销前核对当前句柄归属，避免直接清空他人图标。

这条路线无需修改 app.asar、替换exe或向其他进程注入代码。标准 setOverlayIcon 的右下角位置不符合要求，未采用。Windows是否将合成图标用于固定/分组任务栏必须由用户后续实测；当前没有为该结果补PASS。数字上限999，超限报告 BADGE_RENDER_LIMIT。

## 窗口与会话导航

Host向协调者注册来源ID和宿主PID。原生层只沿可信进程祖先寻找DSH主进程，并校验进程创建身份；Client仅在实际 Desktop bridge 存在时注册自身窗口元数据。唯一匹配的原生窗口获得令牌，重合或未知身份拒绝绑定。全过程不依赖会话/窗口标题。

正文点击后原生请求恢复和前置该令牌对应窗口；Client通过正式 uiWorkspace.openSession 打开 sessionId，并观察 sessions.binding、mainView保留、layout.panelInfo、打开状态、访问许可及已加载终态envelope。只读取身份/序列字段，不转发对话内容。Host再次核验前景，NavigationController才提交点击前捕获的有限确认水位。

## 输入与查看确认

Client的可信交互/返回事件携带事件之前已接收的终态票据。原生组件仅保留最近输入的来源标志和递增序号，不记录具体按键、内容或鼠标坐标；用其排除已识别的注入输入。主视图证据、前景和票据边界必须同时成立。程序导航在途时，旧主视图因前置产生的focus不能顺便清除另一对话。

## 多来源协调及恢复

来源Profile仍持有各自持久记录。Windows用户会话及运行时分组对应本地命名管道，首个拥有者托管统一FIFO和一个Helper；后续来源连接并登记精确数量。没有开启HTTP端口，也没有将来源计数交给模型。源ID冲突拒绝覆盖。

原生失败会关闭失效协调者，仍活动的来源按有界退避重新选举并同步计数。已投递和未知投递区别处理；新代次不冒险把未知的旧卡片当新完成重播。最后来源退出时关闭Helper并释放自身图标和窗口。异常杀进程恢复效果仍属人工验收范围。

## 实际接口依据

源码基线为安装内嵌0.2.2-rc.1，并在0.3.1中重新核对0.2.2-rc.3。接缝包括 session/event、agent/inbox/claimed、ReactLoopAgent.whenIdle、profileContext.dir、connection.fetch.register、sessionProjections.snapshot、sessionPersistence.stat、workspace domain/changed、uiWorkspace.selection/openSession、sessions.binding及layout.panelInfo。

项目内部 GroupBridge、ClientHub、Desktop 和 NavigationController 均为本插件实现，不是虚构的宿主服务。原生 Win32 约束参考 [Microsoft SetOverlayIcon](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-itaskbarlist3-setoverlayicon)、[输入来源](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ne-winuser-input_message_origin_id)和[任务栏工作区](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shappbarmessage)。
