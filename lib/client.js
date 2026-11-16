window.__ModuleLoader__.load({id:"dsh-finish-reminder",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.mjs
var index_exports = {};
__export(index_exports, {
  Settings: () => Settings,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var React3 = __toESM(require("react"), 1);

// src/client/navigation.mjs
var base = "/api/dsh-finish-reminder";
var safeId = (x) => typeof x === "string" && x.length > 0 && x.length <= 256;
var activeClientId = null;
var prepareActiveClient = async () => null;
var prepareClient = () => prepareActiveClient();
function mountNavigation(ctx) {
  if (typeof window === "undefined" || typeof window.dshDesktop?.deviceInfo !== "function") return () => {
  };
  const sessions = ctx.get("sessions"), workspace = ctx.get("uiWorkspace"), layout = ctx.get("layout");
  if (!sessions?.binding || !workspace?.selection?.subscribe || !layout?.panelInfo?.subscribe) return () => {
  };
  const lifetime = new AbortController(), clientId = crypto.randomUUID();
  let closed = false, intent = 0, targets = /* @__PURE__ */ new Map(), staged = null, stagedGeneration = 0, gesture = null;
  activeClientId = clientId;
  let navigation = null, reconnect = null, retry = 0, metadataChain = Promise.resolve(), geometryTimer = null, reading = false;
  const post = async (path, data, signal = lifetime.signal) => {
    const r = await fetch(base + path, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, ...data }), signal });
    const body = await r.json();
    if (!r.ok) throw Object.assign(new Error(body.error ?? "REQUEST_FAILED"), { code: body.error });
    return body;
  };
  const current = () => workspace.selection.getSnapshot().sessionId;
  const visible = (id) => {
    const state = sessions.binding(id)?.session.getSnapshot();
    const access = ctx.get("remoteAccess");
    return document.visibilityState === "visible" && document.hasFocus() && current() === id && layout.panelInfo.getSnapshot().activePanelId === null && (sessions.list.getSnapshot().byId[id]?.retainedBy?.mainView ?? 0) > 0 && state?.openState === "open" && state.removed !== true && state.openError === null && (!access?.source || access.source("session", id, "session/follow").getSnapshot() === true);
  };
  const metadata = () => {
    const data = {
      desktop: true,
      sessionId: current() ?? null,
      focused: document.hasFocus() && document.visibilityState === "visible",
      userIntent: intent,
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight
    };
    const task = metadataChain.catch(() => {
    }).then(() => post("/client", data));
    metadataChain = task;
    return task;
  };
  prepareActiveClient = async () => {
    await metadata();
    return closed ? null : clientId;
  };
  const hasBoundary = (id, seq) => {
    const binding = sessions.binding(id);
    if (!binding) return false;
    return binding.eventSource.getSnapshot().entries.some((entry) => entry.type !== "transient" && entry.event?.seq === seq && entry.event?.type === "turn/end");
  };
  const twoFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const attemptRead = async () => {
    if (closed || reading || navigation || !gesture || performance.now() - gesture.at > 5e3) return;
    const id = current(), ticket = gesture.map.get(id);
    if (!ticket || !visible(id) || !hasBoundary(id, ticket.throughSeq)) return;
    const activeIntent = intent;
    reading = true;
    try {
      await metadata();
      await twoFrames();
      if (closed || navigation || activeIntent !== intent || !visible(id)) return;
      await post("/read", { ...ticket, sessionId: id, userIntent: activeIntent, mainView: true, visible: true, focused: true });
    } catch {
    } finally {
      reading = false;
    }
  };
  const human = (e) => {
    if (!e.isTrusted) return;
    intent++;
    gesture = { at: performance.now(), map: targets };
    if (navigation) {
      navigation.abort.abort();
      navigation = null;
    }
    void metadata().catch(() => {
    });
    queueMicrotask(() => void attemptRead());
  };
  const focus = (e) => {
    if (!e.isTrusted) return;
    gesture = { at: performance.now(), map: targets };
    void metadata().then(() => attemptRead()).catch(() => {
    });
  };
  const selection = () => {
    void metadata().then(() => attemptRead()).catch(() => {
    });
  };
  const resize = () => {
    clearTimeout(geometryTimer);
    geometryTimer = setTimeout(() => {
      void metadata().catch(() => {
      });
    }, 100);
  };
  async function navigate(message) {
    if (!safeId(message.sessionId) || !safeId(message.requestId) || !Number.isSafeInteger(message.throughSeq)) return;
    if (message.userIntent !== intent) {
      await post("/navigation-result", { requestId: message.requestId, ok: false, code: "NAVIGATION_CANCELLED" }).catch(() => {
      });
      return;
    }
    navigation?.abort.abort();
    const abort = new AbortController(), transaction = { id: message.requestId, abort };
    navigation = transaction;
    const stop = [];
    let timeout;
    const result = { requestId: message.requestId, sessionId: message.sessionId, streamEpoch: message.streamEpoch, throughSeq: message.throughSeq, userIntent: message.userIntent };
    try {
      const row = sessions.list.getSnapshot().byId[message.sessionId];
      if (row?.archived === true) throw Object.assign(new Error("TARGET_ARCHIVED"), { code: "TARGET_ARCHIVED" });
      const observed = new Promise((resolve, reject) => {
        let opened = false;
        const check = () => {
          if (closed || abort.signal.aborted || intent !== message.userIntent) {
            reject(Object.assign(new Error("NAVIGATION_CANCELLED"), { code: "NAVIGATION_CANCELLED" }));
            return;
          }
          if (opened && current() !== message.sessionId) {
            reject(Object.assign(new Error("NAVIGATION_CANCELLED"), { code: "NAVIGATION_CANCELLED" }));
            return;
          }
          if (!visible(message.sessionId)) return;
          if (hasBoundary(message.sessionId, message.throughSeq)) resolve();
        };
        stop.push(workspace.selection.subscribe(check), sessions.list.subscribe(check), layout.panelInfo.subscribe(check));
        window.addEventListener("focus", check);
        document.addEventListener("visibilitychange", check);
        stop.push(() => window.removeEventListener("focus", check), () => document.removeEventListener("visibilitychange", check));
        const access = ctx.get("remoteAccess")?.source?.("session", message.sessionId, "session/follow");
        if (access?.subscribe) stop.push(access.subscribe(check));
        const onAbort = () => reject(Object.assign(new Error("NAVIGATION_CANCELLED"), { code: "NAVIGATION_CANCELLED" }));
        abort.signal.addEventListener("abort", onAbort, { once: true });
        stop.push(() => abort.signal.removeEventListener("abort", onAbort));
        timeout = setTimeout(() => reject(Object.assign(new Error("NAVIGATION_TIMEOUT"), { code: "NAVIGATION_TIMEOUT" })), 2800);
        workspace.openSession(message.sessionId);
        opened = true;
        const binding = sessions.binding(message.sessionId);
        if (binding) {
          stop.push(binding.eventSource.subscribe(check));
          if (binding.session?.subscribe) stop.push(binding.session.subscribe(check));
          if (!hasBoundary(message.sessionId, message.throughSeq) && binding.session?.loadThrough) void binding.session.loadThrough(message.throughSeq).then(check).catch(reject);
        }
        requestAnimationFrame(check);
        check();
      });
      await observed;
      await twoFrames();
      if (abort.signal.aborted || intent !== message.userIntent || current() !== message.sessionId || !visible(message.sessionId)) throw new Error("NAVIGATION_CANCELLED");
      await post("/navigation-result", { ...result, ok: true, mainView: true, visible: true, focused: true }, abort.signal);
    } catch (e) {
      if (!closed) await post("/navigation-result", { ...result, ok: false, code: /^[A-Z_]+$/.test(e.code ?? "") ? e.code : "NAVIGATION_UNCONFIRMED" }).catch(() => {
      });
    } finally {
      clearTimeout(timeout);
      for (const f of stop) try {
        f();
      } catch {
      }
      if (navigation === transaction) navigation = null;
    }
  }
  function receive(type, data) {
    if (type === "navigate") {
      void navigate(data);
      return;
    }
    if (type === "cancelNavigation") {
      if (navigation?.id === data.requestId) navigation.abort.abort();
      return;
    }
    if (type === "targetsStart") {
      staged = /* @__PURE__ */ new Map();
      stagedGeneration = data.generation;
    } else if (type === "targetsChunk" && data.generation === stagedGeneration && staged) {
      for (const item of data.items ?? []) if (safeId(item.sessionId) && Number.isSafeInteger(item.throughSeq) && safeId(item.streamEpoch) && typeof item.completionId === "string") {
        const previous = staged.get(item.sessionId);
        if (!previous || previous.throughSeq < item.throughSeq) staged.set(item.sessionId, item);
      }
      if (staged.size > 1e4) throw new Error("QUEUE_CAPACITY_ERROR");
    } else if (type === "targetsEnd" && data.generation === stagedGeneration && staged) {
      targets = staged;
      staged = null;
    }
  }
  async function connect() {
    try {
      await metadata();
      if (closed) return;
      const response = await fetch(base + "/events?clientId=" + encodeURIComponent(clientId), { credentials: "same-origin", cache: "no-store", signal: lifetime.signal });
      if (!response.ok || !response.body) throw new Error("CLIENT_CHANNEL_UNAVAILABLE");
      retry = 0;
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "";
      try {
        for (; ; ) {
          const part = await reader.read();
          if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true });
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (frame.length > 32768) throw new Error("PROTOCOL_ERROR");
            const type = frame.match(/^event: ([a-zA-Z]+)$/m)?.[1], json = frame.match(/^data: (.*)$/m)?.[1];
            if (type && json) receive(type, JSON.parse(json));
          }
          if (buffer.length > 32768) throw new Error("PROTOCOL_ERROR");
        }
      } finally {
        await reader.cancel().catch(() => {
        });
        reader.releaseLock();
      }
    } catch {
    } finally {
      if (!closed) reconnect = setTimeout(() => void connect(), Math.min(5e3, 500 * 2 ** retry++));
    }
  }
  document.addEventListener("pointerdown", human, true);
  document.addEventListener("keydown", human, true);
  window.addEventListener("focus", focus);
  window.addEventListener("resize", resize);
  const unsubscribe = workspace.selection.subscribe(selection);
  void connect();
  return () => {
    closed = true;
    if (activeClientId === clientId) {
      activeClientId = null;
      prepareActiveClient = async () => null;
    }
    lifetime.abort();
    navigation?.abort.abort();
    clearTimeout(reconnect);
    clearTimeout(geometryTimer);
    unsubscribe();
    document.removeEventListener("pointerdown", human, true);
    document.removeEventListener("keydown", human, true);
    window.removeEventListener("focus", focus);
    window.removeEventListener("resize", resize);
    void fetch(base + "/client-close", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId }), keepalive: true }).catch(() => {
    });
  };
}

// src/client/center.mjs
var React = __toESM(require("react"), 1);

// src/shared/contracts.mjs
var VERSION = "0.3.1";
var OUTCOMES = Object.freeze({
  ended: "\u5BF9\u8BDD\u4EFB\u52A1\u5DF2\u7ED3\u675F",
  error: "\u5BF9\u8BDD\u4EFB\u52A1\u5DF2\u7ED3\u675F\uFF08\u5931\u8D25\uFF09",
  stopped: "\u5BF9\u8BDD\u4EFB\u52A1\u5DF2\u505C\u6B62",
  interrupted: "\u5BF9\u8BDD\u4EFB\u52A1\u5DF2\u4E2D\u65AD",
  limited: "\u672C\u8F6E\u5DF2\u7ED3\u675F\uFF08\u8FBE\u5230\u9650\u5236\uFF09",
  blocked: "\u672C\u8F6E\u5DF2\u7ED3\u675F\uFF08\u53D7\u963B\uFF09",
  unknown: "\u672C\u8F6E\u5DF2\u7ED3\u675F\uFF08\u539F\u56E0\u672A\u77E5\uFF09"
});
var ReminderError = class extends Error {
  constructor(code) {
    super(code);
    this.name = "ReminderError";
    this.code = code;
  }
};
var fail = (code) => {
  throw new ReminderError(code);
};
var safeInt = (x) => Number.isSafeInteger(x) && x >= 0;
function decodeSettings(raw = {}) {
  const read = (key) => typeof raw[key]?.get === "function" ? raw[key].get() : raw[key];
  const enabled = read("enabled") ?? true, diagnosticsEnabled = read("diagnosticsEnabled") ?? false;
  if (typeof enabled !== "boolean" || typeof diagnosticsEnabled !== "boolean") fail("CONFIG_UNAVAILABLE");
  const quietScheduleEnabled = read("quietScheduleEnabled") ?? false, quietStart = read("quietStart") ?? "22:00", quietEnd = read("quietEnd") ?? "08:00", quietDays = read("quietDays") ?? 127, quietUntil = read("quietUntil") ?? 0;
  if (typeof quietScheduleEnabled !== "boolean" || !validTime(quietStart) || !validTime(quietEnd) || !safeInt(quietDays) || quietDays > 127 || !safeInt(quietUntil) || quietUntil > 864e13) fail("CONFIG_UNAVAILABLE");
  return { enabled, diagnosticsEnabled, quietScheduleEnabled, quietStart, quietEnd, quietDays, quietUntil };
}
var validTime = (value) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
function formatDuration(ms) {
  if (!safeInt(ms)) return "\u5386\u65F6\u672A\u77E5";
  if (ms < 1e3) return "\u4E0D\u8DB31\u79D2";
  const seconds = Math.floor(ms / 1e3);
  if (seconds < 60) return seconds + "\u79D2";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "\u5206" + (seconds % 60 ? seconds % 60 + "\u79D2" : "");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "\u5C0F\u65F6" + (minutes % 60 ? minutes % 60 + "\u5206" : "");
  return Math.floor(hours / 24) + "\u5929" + (hours % 24 ? hours % 24 + "\u5C0F\u65F6" : "");
}

// src/client/center.mjs
var h = React.createElement;
var base2 = "/api/dsh-finish-reminder";
var stateLabels = { unread: "\u672A\u67E5\u770B", acknowledged: "\u5DF2\u67E5\u770B", retired: "\u5DF2\u9000\u4F11" };
var control = { font: "inherit", padding: "6px 9px", borderRadius: 6 };
var timeText = (ms) => new Date(ms).toLocaleString("zh-CN", { hour12: false });
function NotificationRow({ item, enabled, busy, onOpen }) {
  return h(
    "tr",
    null,
    h(
      "td",
      { style: { padding: 10, minWidth: 190 } },
      h("div", { style: { fontWeight: 600, overflowWrap: "anywhere" } }, item.displayTitle),
      h("div", { style: { fontSize: 12, marginTop: 4 } }, item.workspaceTitle || "\u65E7\u8BB0\u5F55\uFF1A\u672A\u8BB0\u5F55\u5DE5\u4F5C\u533A"),
      item.currentlyRunning ? h("div", { role: "status", style: { fontSize: 12, marginTop: 4 } }, "\u5F53\u524D\u6709\u65B0\u4EFB\u52A1\u8FD0\u884C\uFF0C\u672C\u6761\u8BB0\u5F55\u5BF9\u5E94\u8F83\u65E9\u7684\u7ED3\u675F") : null
    ),
    h(
      "td",
      { style: { padding: 10, minWidth: 140 } },
      OUTCOMES[item.outcome] ?? "\u539F\u56E0\u672A\u77E5",
      h("div", { style: { fontSize: 12, marginTop: 4 } }, stateLabels[item.readState]),
      item.silenced ? h("div", { style: { fontSize: 12, marginTop: 4 } }, "\u9759\u9ED8\u6536\u5F55") : null
    ),
    h("td", { style: { padding: 10, whiteSpace: "nowrap" } }, timeText(item.endedAt), h("div", { style: { fontSize: 12, marginTop: 4 } }, "\u5386\u65F6\uFF1A" + formatDuration(item.durationMs))),
    h("td", { style: { padding: 10 } }, h("button", {
      type: "button",
      style: control,
      disabled: busy || !enabled || item.readState === "retired",
      onClick: () => onOpen(item.id),
      "aria-label": "\u8FD4\u56DE\u5BF9\u8BDD\uFF1A" + item.displayTitle
    }, busy ? "\u6B63\u5728\u8FD4\u56DE\u2026" : item.readState === "retired" ? "\u4E0D\u53EF\u6253\u5F00" : "\u8FD4\u56DE\u539F\u5BF9\u8BDD"))
  );
}
function NotificationCenter() {
  const [filters, setFilters] = React.useState({ state: "unread", period: "all", outcome: "all", workspace: "all" }), [offset, setOffset] = React.useState(0), [refresh, setRefresh] = React.useState(0);
  const [data, setData] = React.useState(null), [loading, setLoading] = React.useState(true), [message, setMessage] = React.useState(""), [opening, setOpening] = React.useState(null);
  const mounted = React.useRef(true), revision = React.useRef(null), prefix = React.useId();
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  React.useEffect(() => {
    const abort = new AbortController();
    let live = true;
    setLoading(true);
    const query = new URLSearchParams({ ...filters, offset: String(offset), limit: "25" });
    if (offset > 0 && revision.current !== null) query.set("revision", String(revision.current));
    void fetch(base2 + "/notifications?" + query, { credentials: "same-origin", cache: "no-store", signal: abort.signal }).then(async (r) => {
      const value = await r.json();
      if (!live) return;
      if (r.status === 409) {
        setOffset(0);
        setMessage("\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u5DF2\u8FD4\u56DE\u7B2C\u4E00\u9875\u3002");
        return;
      }
      if (!r.ok) throw new Error(value.error ?? "STATE_UNAVAILABLE");
      revision.current = value.revision;
      setData(value);
    }).catch((e) => {
      if (live && !abort.signal.aborted) setMessage("\u901A\u77E5\u8BFB\u53D6\u5931\u8D25\uFF1A" + (e.message ?? "STATE_UNAVAILABLE"));
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => {
      live = false;
      abort.abort();
    };
  }, [filters, offset, refresh]);
  React.useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible" && offset === 0) setRefresh((n) => n + 1);
    };
    const timer = setInterval(update, 15e3);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [offset]);
  const choose = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setOffset(0);
    setMessage("");
  };
  const open = async (completionId) => {
    setOpening(completionId);
    setMessage("\u6B63\u5728\u8FD4\u56DE\u539F\u5BF9\u8BDD\u2026");
    try {
      const clientId = await prepareClient();
      if (!clientId) throw new Error("\u7A97\u53E3\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
      const r = await fetch(base2 + "/notifications/open", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, completionId }) });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? "NAVIGATION_UNCONFIRMED");
      if (mounted.current) {
        setMessage("\u5DF2\u8FD4\u56DE\u539F\u5BF9\u8BDD\u3002");
        setRefresh((n) => n + 1);
      }
    } catch (e) {
      if (mounted.current) setMessage("\u8FD4\u56DE\u5931\u8D25\uFF1A" + e.message + "\uFF1B\u672A\u63D0\u524D\u786E\u8BA4\u65B0\u8BB0\u5F55\u3002");
    } finally {
      if (mounted.current) setOpening(null);
    }
  };
  const select = (key, label, options) => h(
    "label",
    { htmlFor: prefix + key, style: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12 } },
    label,
    h("select", { id: prefix + key, value: filters[key], style: control, onChange: (e) => choose(key, e.currentTarget.value) }, options.map(([v, t]) => h("option", { key: v, value: v }, t)))
  );
  return h(
    "section",
    { "aria-label": "\u7ED3\u675F\u901A\u77E5\u4E2D\u5FC3", style: { marginTop: 16 } },
    h("h4", null, "\u901A\u77E5\u4E2D\u5FC3"),
    h("p", null, "\u6BCF\u6B21\u7ED3\u675F\u72EC\u7ACB\u4FDD\u7559\uFF1B\u6D4F\u89C8\u5217\u8868\u4E0D\u4F1A\u6807\u8BB0\u5DF2\u67E5\u770B\u3002\u901A\u8FC7\u539F\u5BF9\u8BDD\u7684\u5B9E\u9645\u5448\u73B0\u786E\u8BA4\u540E\uFF0C\u8BA1\u6570\u624D\u4F1A\u51CF\u5C11\u3002"),
    data ? h("p", { role: "status" }, "\u5F85\u67E5\u770B\u5BF9\u8BDD " + data.count + " \u4E2A\uFF1B" + (!data.enabled ? "\u63D0\u9192\u5DF2\u505C\u7528\u3002" : data.quiet.active ? "\u9759\u9ED8\u4E2D\uFF0C\u7ED3\u675F\u8BB0\u5F55\u7EE7\u7EED\u6536\u5F55\u3002" : "\u6B63\u5E38\u63D0\u9192\u3002") + (!data.durable ? " \u72B6\u6001\u5C1A\u672A\u786E\u8BA4\u5199\u5165\u78C1\u76D8\u3002" : "")) : null,
    h(
      "div",
      { style: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" } },
      select("state", "\u67E5\u770B\u72B6\u6001", [["unread", "\u672A\u67E5\u770B"], ["acknowledged", "\u5DF2\u67E5\u770B"], ["retired", "\u5DF2\u9000\u4F11"], ["all", "\u5168\u90E8"]]),
      select("period", "\u7ED3\u675F\u65F6\u95F4", [["all", "\u5168\u90E8\u65F6\u95F4"], ["today", "\u4ECA\u5929"], ["7d", "\u6700\u8FD17\u5929"], ["30d", "\u6700\u8FD130\u5929"]]),
      select("outcome", "\u7ED3\u675F\u72B6\u6001", [["all", "\u5168\u90E8\u7ED3\u675F\u72B6\u6001"], ...Object.entries(OUTCOMES)]),
      select("workspace", "\u5DE5\u4F5C\u533A", [["all", "\u5168\u90E8\u5DE5\u4F5C\u533A"], ...(data?.workspaces ?? []).map((w) => [w.id, w.title])]),
      h("button", { type: "button", style: control, onClick: () => {
        setOffset(0);
        setRefresh((n) => n + 1);
      }, disabled: loading }, loading ? "\u6B63\u5728\u8BFB\u53D6\u2026" : "\u5237\u65B0")
    ),
    h("p", { "aria-live": "polite" }, message),
    data?.items.length ? h("div", { style: { overflowX: "auto" } }, h(
      "table",
      { style: { borderCollapse: "collapse", width: "100%", fontSize: 13 } },
      h("thead", null, h("tr", null, ...["\u5BF9\u8BDD\u4E0E\u5DE5\u4F5C\u533A", "\u7ED3\u675F\u72B6\u6001", "\u65F6\u95F4\u4E0E\u5386\u65F6", "\u64CD\u4F5C"].map((t) => h("th", { key: t, scope: "col", style: { textAlign: "left", padding: 10, borderBottom: "1px solid #8b95a555" } }, t)))),
      h("tbody", null, ...data.items.map((item) => h(NotificationRow, { key: item.id, item, enabled: data.enabled, busy: opening === item.id, onOpen: open })))
    )) : !loading ? h("p", { role: "status" }, "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u7ED3\u675F\u8BB0\u5F55\u3002") : null,
    data ? h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 12, marginTop: 12 } },
      h("button", { type: "button", style: control, disabled: loading || offset === 0, onClick: () => setOffset((n) => Math.max(0, n - 25)) }, "\u4E0A\u4E00\u9875"),
      h("span", null, "\u7B2C " + (Math.floor(offset / 25) + 1) + " \u9875\uFF0C\u5171 " + data.total + " \u6761"),
      h("button", { type: "button", style: control, disabled: loading || !data.hasMore, onClick: () => setOffset((n) => n + 25) }, "\u4E0B\u4E00\u9875")
    ) : null,
    h("p", { style: { fontSize: 12, marginTop: 12 } }, "\u4FDD\u7559\u5168\u90E8\u672A\u67E5\u770B\u8BB0\u5F55\u548C\u6700\u8FD1500\u6761\u5DF2\u67E5\u770B/\u5DF2\u9000\u4F11\u5386\u53F2\uFF1B\u4ECD\u5728\u5C55\u793A\u961F\u5217\u4E2D\u7684\u8BB0\u5F55\u6682\u4E0D\u6E05\u7406\u3002\u65E7\u8BB0\u5F55\u6CA1\u6709\u5DE5\u4F5C\u533A\u6216\u5386\u65F6\u65F6\u663E\u793A\u672A\u77E5\u3002")
  );
}

// src/client/quiet.mjs
var React2 = __toESM(require("react"), 1);
var h2 = React2.createElement;
function QuietSettings({ settings, writable, save }) {
  const [minutes, setMinutes] = React2.useState(60), [start, setStart] = React2.useState(settings.quietStart), [end, setEnd] = React2.useState(settings.quietEnd), [days, setDays] = React2.useState(settings.quietDays), [error, setError] = React2.useState("");
  const [now, setNow] = React2.useState(Date.now());
  React2.useEffect(() => {
    setStart(settings.quietStart);
    setEnd(settings.quietEnd);
    setDays(settings.quietDays);
  }, [settings.quietStart, settings.quietEnd, settings.quietDays]);
  React2.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15e3);
    return () => clearInterval(timer);
  }, []);
  const prefix = React2.useId();
  const commit = () => {
    if (!validTime(start) || !validTime(end)) {
      setError("\u8BF7\u9009\u62E9\u6709\u6548\u7684\u5F00\u59CB\u548C\u7ED3\u675F\u65F6\u95F4\u3002");
      return;
    }
    setError("");
    void save({ quietStart: start, quietEnd: end, quietDays: days });
  };
  return h2(
    "section",
    { "aria-label": "\u514D\u6253\u6270\u4E0E\u5B9A\u65F6\u9759\u9ED8", style: { marginTop: 20 } },
    h2("h4", null, "\u514D\u6253\u6270\u4E0E\u5B9A\u65F6\u9759\u9ED8"),
    h2("p", null, "\u5BF9\u5F53\u524DProfile\u751F\u6548\u3002\u9759\u9ED8\u4EC5\u64A4\u4E0B\u5F39\u7A97\uFF1B\u7ED3\u675F\u8BB0\u5F55\u548C\u89D2\u6807\u7EE7\u7EED\u4FDD\u7559\u3002\u89E3\u9664\u540E\u4E0D\u8865\u5F39\u65E7\u8BB0\u5F55\uFF0C\u53EF\u5728\u901A\u77E5\u4E2D\u5FC3\u67E5\u770B\u3002"),
    h2(
      "div",
      { style: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" } },
      h2("label", { htmlFor: prefix + "duration" }, "\u4E34\u65F6\u9759\u9ED8"),
      h2("select", { id: prefix + "duration", value: minutes, disabled: !writable, onChange: (e) => setMinutes(Number(e.currentTarget.value)) }, [15, 30, 60, 120].map((n) => h2("option", { key: n, value: n }, n + "\u5206\u949F"))),
      h2("button", { type: "button", disabled: !writable, onClick: () => void save({ quietUntil: Date.now() + minutes * 6e4 }) }, "\u5F00\u59CB\u9759\u9ED8"),
      h2("button", { type: "button", disabled: !writable || settings.quietUntil <= now, onClick: () => void save({ quietUntil: 0 }) }, "\u53D6\u6D88\u4E34\u65F6\u9759\u9ED8")
    ),
    settings.quietUntil > now ? h2("p", { role: "status" }, "\u4E34\u65F6\u9759\u9ED8\u81F3 " + new Date(settings.quietUntil).toLocaleString("zh-CN", { hour12: false }) + "\uFF1B\u53D6\u6D88\u540E\u82E5\u4ECD\u5728\u6392\u7A0B\u65F6\u6BB5\uFF0C\u5B9A\u65F6\u9759\u9ED8\u7EE7\u7EED\u751F\u6548\u3002") : null,
    h2("p", null, h2("label", { htmlFor: prefix + "enabled" }, h2("input", { id: prefix + "enabled", type: "checkbox", checked: settings.quietScheduleEnabled, disabled: !writable, onChange: (e) => void save({ quietScheduleEnabled: e.currentTarget.checked }) }), " \u542F\u7528\u5B9A\u65F6\u9759\u9ED8")),
    h2(
      "div",
      { style: { display: "flex", gap: 12, flexWrap: "wrap" } },
      h2("label", { htmlFor: prefix + "start" }, "\u5F00\u59CB ", h2("input", { id: prefix + "start", type: "time", value: start, disabled: !writable, onChange: (e) => setStart(e.currentTarget.value) })),
      h2("label", { htmlFor: prefix + "end" }, "\u7ED3\u675F ", h2("input", { id: prefix + "end", type: "time", value: end, disabled: !writable, onChange: (e) => setEnd(e.currentTarget.value) }))
    ),
    h2(
      "fieldset",
      { disabled: !writable, style: { margin: "12px 0", padding: 10 } },
      h2("legend", null, "\u91CD\u590D\u65E5\u671F"),
      ...[[1, "\u5468\u4E00"], [2, "\u5468\u4E8C"], [3, "\u5468\u4E09"], [4, "\u5468\u56DB"], [5, "\u5468\u4E94"], [6, "\u5468\u516D"], [0, "\u5468\u65E5"]].map(([day, label]) => h2("label", { key: day, style: { marginRight: 12, display: "inline-block" } }, h2("input", { type: "checkbox", checked: (days & 1 << day) !== 0, onChange: (e) => {
        const checked = e.currentTarget.checked;
        setDays((value) => checked ? value | 1 << day : value & ~(1 << day));
      } }), " " + label))
    ),
    h2("button", { type: "button", disabled: !writable, onClick: commit }, "\u4FDD\u5B58\u6392\u7A0B"),
    h2("p", { role: "alert" }, error),
    h2("p", { style: { fontSize: 12 } }, "\u4F7F\u7528\u7CFB\u7EDF\u672C\u5730\u65F6\u95F4\u3002\u8DE8\u5348\u591C\u7684\u65F6\u6BB5\u6309\u5F00\u59CB\u65E5\u671F\u8BA1\u7B97\uFF1B\u8D77\u6B62\u76F8\u540C\u65F6\u4E3A\u6240\u9009\u65E5\u671F\u5168\u5929\uFF0C\u672A\u9009\u65E5\u671F\u5219\u4E0D\u6267\u884C\u5B9A\u65F6\u9759\u9ED8\u3002\u7CFB\u7EDF\u65F6\u533A\u6216\u65F6\u949F\u53D8\u5316\u6700\u591A\u4E00\u5206\u949F\u5185\u91CD\u65B0\u8BA1\u7B97\u3002")
  );
}

// src/client/index.mjs
var inject = ["slots", "configForms", "uiWorkspace", "sessions", "layout"];
var h3 = React3.createElement;
var endpoint = "/api/dsh-finish-reminder/status";
function readable(s) {
  if (s?.status !== "ready" || !s.value) return false;
  try {
    decodeSettings(s.value);
    return true;
  } catch {
    return false;
  }
}
function Settings({ form }) {
  const snapshot = React3.useSyncExternalStore(React3.useCallback((f) => form.subscribe(f), [form]), React3.useCallback(() => form.getSnapshot(), [form]));
  const [tab, setTab] = React3.useState("center"), [status, setStatus] = React3.useState(null), [message, setMessage] = React3.useState(""), [busy, setBusy] = React3.useState(false);
  const epoch = React3.useRef(0), id = React3.useId(), ready = readable(snapshot), settings = ready ? decodeSettings(snapshot.value) : null;
  const refresh = React3.useCallback(async (signal) => {
    const r = await fetch(endpoint, { credentials: "same-origin", cache: "no-store", signal });
    if (!r.ok) throw new Error("\u72B6\u6001\u8BFB\u53D6\u5931\u8D25");
    return await r.json();
  }, []);
  React3.useEffect(() => {
    const abort = new AbortController(), current = ++epoch.current;
    refresh(abort.signal).then((s) => {
      if (current === epoch.current) setStatus(s);
    }).catch(() => {
      if (!abort.signal.aborted) setMessage("\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u5237\u65B0\u3002");
    });
    return () => {
      ++epoch.current;
      abort.abort();
    };
  }, [form, refresh]);
  const save = async (patch) => {
    const current = epoch.current;
    setBusy(true);
    setMessage("\u6B63\u5728\u4FDD\u5B58\u2026");
    try {
      if (!ready || snapshot.writable !== true) throw new Error("\u914D\u7F6E\u4E0D\u53EF\u5199");
      decodeSettings({ ...snapshot.value, ...patch });
      if (await form.mutate(Object.entries(patch).map(([key, value]) => ({ op: "set", path: [key], value }))) !== true) throw new Error("\u5BBF\u4E3B\u672A\u786E\u8BA4\u4FDD\u5B58");
      if (current === epoch.current) {
        setMessage("\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002");
        const latest = await refresh();
        if (current === epoch.current) setStatus(latest);
      }
    } catch {
      if (current === epoch.current) setMessage("\u4FDD\u5B58\u672A\u786E\u8BA4\uFF0C\u8BF7\u68C0\u67E5\u8BBE\u7F6E\u548C\u72B6\u6001\u540E\u91CD\u8BD5\u3002");
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };
  const labels = { initializing: "\u6B63\u5728\u521D\u59CB\u5316", supported: "\u8FD0\u884C\u6B63\u5E38", faulted: "\u5B58\u5728\u6545\u969C", "popup-only": "\u4EC5\u5F39\u7A97\u53EF\u7528", "badge-unavailable": "\u89D2\u6807\u4E0D\u53EF\u7528", "navigation-unavailable": "\u8FD4\u56DE\u5BF9\u8BDD\u4E0D\u53EF\u7528" };
  const writable = ready && snapshot.writable === true && !busy;
  return h3(
    "section",
    { "aria-label": "\u5BF9\u8BDD\u7ED3\u675F\u63D0\u9192", style: { maxWidth: 980, padding: 16, fontSize: 14 } },
    h3("h3", null, "\u5BF9\u8BDD\u7ED3\u675F\u63D0\u9192 ", h3("small", { style: { fontWeight: 400, fontSize: 12 } }, VERSION)),
    h3("p", null, "\u6BCF\u6B21\u7ED3\u675F\u72EC\u7ACB\u8BB0\u5F55\u3002\u5173\u95ED\u6216\u5230\u671F\u53EA\u6536\u8D77\u5F39\u7A97\uFF0C\u4E0D\u6E05\u9664\u672A\u67E5\u770B\u8BB0\u5F55\u3002"),
    h3(
      "div",
      { role: "tablist", "aria-label": "\u7ED3\u675F\u63D0\u9192\u9875\u9762", style: { display: "flex", gap: 8, flexWrap: "wrap" } },
      ...[["center", "\u901A\u77E5\u4E2D\u5FC3"], ["quiet", "\u9759\u9ED8\u8BBE\u7F6E"], ["settings", "\u8FD0\u884C\u8BBE\u7F6E"]].map(([key, label]) => h3("button", {
        key,
        id: id + key,
        role: "tab",
        type: "button",
        "aria-selected": tab === key,
        "aria-controls": id + "panel",
        onClick: () => setTab(key),
        style: { font: "inherit", padding: "7px 14px", borderRadius: 7, fontWeight: tab === key ? 600 : 400 }
      }, label))
    ),
    h3(
      "div",
      { id: id + "panel", role: "tabpanel", "aria-labelledby": id + tab },
      tab === "center" ? h3(NotificationCenter) : tab === "quiet" ? settings ? h3(QuietSettings, { settings, writable, save }) : h3("p", null, "\u6B63\u5728\u8BFB\u53D6\u914D\u7F6E\u2026") : h3(
        "section",
        { "aria-label": "\u8FD0\u884C\u8BBE\u7F6E" },
        h3("h4", null, "\u8FD0\u884C\u8BBE\u7F6E"),
        ...Object.entries({ enabled: "\u542F\u7528\u7ED3\u675F\u63D0\u9192", diagnosticsEnabled: "\u5F00\u542F\u8131\u654F\u8BCA\u65AD" }).map(([key, label]) => h3("p", { key }, h3(
          "label",
          { htmlFor: id + key },
          h3("input", { id: id + key, type: "checkbox", checked: settings?.[key] ?? false, disabled: !writable, onChange: (e) => void save({ [key]: e.currentTarget.checked }) }),
          " " + label
        ))),
        h3("p", { role: "status" }, status ? (status.enabled ? "\u5DF2\u542F\u7528\uFF1B" : "\u5DF2\u505C\u7528\uFF1B") + (labels[status.status] ?? status.status) + "\uFF1B\u672CProfile\u5F85\u67E5\u770B\uFF1A" + (status.count ?? "\u672A\u77E5") + "\uFF1B\u4EFB\u52A1\u680F\u6C47\u603B\uFF1A" + (status.aggregateCount ?? "\u672A\u77E5") + "\uFF1B\u6392\u961F\uFF1A" + status.queued : "\u6B63\u5728\u8BFB\u53D6\u72B6\u6001\u2026"),
        ...["error", "eventError", "badgeError", "navigationError"].filter((key) => status?.[key]).map((key) => h3("p", { key, role: "alert" }, status[key])),
        h3("button", { type: "button", disabled: busy, onClick: () => void refresh().then((s) => setStatus(s)).catch(() => setMessage("\u72B6\u6001\u5237\u65B0\u5931\u8D25\u3002")) }, "\u5237\u65B0\u72B6\u6001")
      )
    ),
    h3("p", { "aria-live": "polite" }, message)
  );
}
function apply(ctx) {
  const form = ctx.get("configForms").get("dsh-finish-reminder");
  ctx.effect(() => {
    let stop = null;
    const reconcile = () => {
      const s = form.getSnapshot(), enabled = readable(s) && decodeSettings(s.value).enabled;
      if (enabled && !stop) stop = mountNavigation(ctx);
      else if (!enabled && stop) {
        stop();
        stop = null;
      }
    };
    const unsubscribe = form.subscribe(reconcile);
    reconcile();
    return () => {
      unsubscribe();
      stop?.();
    };
  });
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") ctx.effect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)"), abort = new AbortController();
    const send = () => fetch("/api/dsh-finish-reminder/theme", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ dark: media.matches }), signal: abort.signal }).catch(() => {
    });
    void send();
    media.addEventListener("change", send);
    return () => {
      media.removeEventListener("change", send);
      abort.abort();
    };
  });
  ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "dsh-finish-reminder-settings", order: 66, label: () => "\u5BF9\u8BDD\u7ED3\u675F\u63D0\u9192", inject: () => ({ form }) }, Settings));
}

return module.exports;}});
