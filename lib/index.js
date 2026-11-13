// src/host/index.mjs
import z from "@deepseek-ai/schemastery";

// src/host/runtime.mjs
import { randomUUID as randomUUID4, createHash as createHash3 } from "node:crypto";
import { join as join2, isAbsolute, win32 } from "node:path";

// src/core/store.mjs
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

// src/shared/contracts.mjs
var VERSION = "0.3.0";
var PROTOCOL = 1;
var FRONT_MS = 1e4;
var MAX_TITLE = 160;
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
var isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var safeInt = (x) => Number.isSafeInteger(x) && x >= 0;
function boundedString(x, max = 256) {
  return typeof x === "string" && x.length > 0 && x.length <= max && !/[\u0000-\u001f\u007f]/u.test(x);
}
function keyOf(key) {
  if (!isObject(key)) fail("INVALID_IDENTITY");
  const values = ["desktopAppGroupId", "hostInstanceId", "profileId", "sessionId"].map((k) => key[k]);
  if (!values.every((x) => boundedString(x))) fail("INVALID_IDENTITY");
  return JSON.stringify(values);
}
function completionId(fact) {
  if (!boundedString(fact.taskEpisodeId) || !safeInt(fact.terminalEventSeq) || !boundedString(fact.streamEpoch)) fail("INVALID_COMPLETION");
  return JSON.stringify([keyOf(fact.conversation), fact.streamEpoch, fact.taskEpisodeId, fact.terminalEventSeq]);
}
function cleanTitle(title) {
  return Array.from(typeof title === "string" ? title.replace(/[\u0000-\u001f\u007f]/gu, " ").trim() : "").slice(0, MAX_TITLE).join("") || "\u5BF9\u8BDD";
}
function validateFact(fact) {
  const id = completionId(fact);
  if (!Object.hasOwn(OUTCOMES, fact.outcome) || !safeInt(fact.endedAt)) fail("INVALID_COMPLETION");
  if (fact.startedAt != null && !safeInt(fact.startedAt) || fact.durationMs != null && !safeInt(fact.durationMs) || fact.workspaceId != null && !boundedString(fact.workspaceId) || fact.workspaceTitle != null && typeof fact.workspaceTitle !== "string" || fact.silenced != null && typeof fact.silenced !== "boolean") fail("INVALID_COMPLETION");
  return {
    id,
    conversation: { ...fact.conversation },
    taskEpisodeId: fact.taskEpisodeId,
    streamEpoch: fact.streamEpoch,
    terminalEventSeq: fact.terminalEventSeq,
    endedAt: fact.endedAt,
    outcome: fact.outcome,
    displayTitle: cleanTitle(fact.displayTitle),
    startedAt: fact.startedAt ?? null,
    durationMs: fact.durationMs ?? null,
    workspaceId: fact.workspaceId ?? null,
    workspaceTitle: typeof fact.workspaceTitle === "string" && fact.workspaceTitle.trim() ? Array.from(cleanTitle(fact.workspaceTitle)).slice(0, 80).join("") : "",
    silenced: fact.silenced ?? false
  };
}
function unreadCount(records) {
  return new Set(records.filter((r) => r.readState === "unread").map((r) => keyOf(r.conversation))).size;
}
function decodeSettings(raw = {}) {
  const read = (key) => typeof raw[key]?.get === "function" ? raw[key].get() : raw[key];
  const enabled = read("enabled") ?? true, diagnosticsEnabled = read("diagnosticsEnabled") ?? false;
  if (typeof enabled !== "boolean" || typeof diagnosticsEnabled !== "boolean") fail("CONFIG_UNAVAILABLE");
  const quietScheduleEnabled = read("quietScheduleEnabled") ?? false, quietStart = read("quietStart") ?? "22:00", quietEnd = read("quietEnd") ?? "08:00", quietDays = read("quietDays") ?? 127, quietUntil = read("quietUntil") ?? 0;
  if (typeof quietScheduleEnabled !== "boolean" || !validTime(quietStart) || !validTime(quietEnd) || !safeInt(quietDays) || quietDays > 127 || !safeInt(quietUntil) || quietUntil > 864e13) fail("CONFIG_UNAVAILABLE");
  return { enabled, diagnosticsEnabled, quietScheduleEnabled, quietStart, quietEnd, quietDays, quietUntil };
}
var validTime = (value) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
function capabilityStatus(c) {
  if (c.error || !c.events) return "faulted";
  if (c.initializing) return "initializing";
  if (!c.popup) return "faulted";
  if (!c.navigation && !c.badge) return "popup-only";
  if (!c.navigation) return "navigation-unavailable";
  if (!c.badge) return "badge-unavailable";
  return "supported";
}
function envelope(m, expected, maxBytes) {
  if (!isObject(m) || m.protocolVersion !== PROTOCOL || m.nonce !== expected.nonce || m.ownerInstance !== expected.ownerInstance || m.generation !== expected.generation || !safeInt(m.revision) || !boundedString(m.requestId, 80) || !boundedString(m.type, 64) || !isObject(m.payload)) fail("PROTOCOL_ERROR");
  if (new TextEncoder().encode(JSON.stringify(m)).length > maxBytes) fail("PROTOCOL_ERROR");
  return m;
}

// src/core/store.mjs
var FileStorage = class {
  constructor(file) {
    this.file = file;
  }
  async read() {
    try {
      if ((await stat(this.file)).size > 16 * 1024 * 1024) fail("STATE_UNAVAILABLE");
      return await readFile(this.file, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async write(text) {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = this.file + "." + randomUUID() + ".tmp";
    let handle;
    try {
      handle = await open(temp, "wx", 384);
      await handle.writeFile(text, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temp, this.file);
    } finally {
      await handle?.close();
      await unlink(temp).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
  }
};
var checksum = (data) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
var blank = () => ({ schemaVersion: 1, sourceId: randomUUID(), revision: 0, records: [], seen: [], boundaries: [] });
var CompletionStore = class {
  constructor(storage, { limit = 1e4 } = {}) {
    this.storage = storage;
    this.limit = limit;
    this.data = blank();
    this.chain = Promise.resolve();
    this.error = null;
    this.ready = false;
    this.dirty = false;
  }
  async load() {
    try {
      const text = await this.storage.read();
      if (text !== null) {
        const parsed = JSON.parse(text), d = parsed.data;
        if (!d || parsed.checksum !== checksum(d) || d.schemaVersion !== 1 || !boundedString(d.sourceId) || !safeInt(d.revision) || !Array.isArray(d.records) || !Array.isArray(d.seen) || !Array.isArray(d.boundaries)) fail("STATE_UNAVAILABLE");
        const ids = /* @__PURE__ */ new Set();
        for (const r of d.records) {
          if (validateFact(r).id !== r.id || !["unread", "acknowledged", "retired"].includes(r.readState) || ids.has(r.id)) fail("STATE_UNAVAILABLE");
          ids.add(r.id);
        }
        for (const s of d.seen) if (!Array.isArray(s) || s.length !== 3 || typeof s[0] !== "string" || !safeInt(s[1]) || !safeInt(s[2]) || s[2] < s[1]) fail("STATE_UNAVAILABLE");
        for (const b of d.boundaries) if (!b || typeof b.key !== "string" || !boundedString(b.streamEpoch) || !safeInt(b.throughSeq)) fail("STATE_UNAVAILABLE");
        this.data = d;
      } else {
        await this.persist();
      }
      this.ready = true;
      return this.snapshot();
    } catch {
      this.error = "STATE_UNAVAILABLE";
      fail("STATE_UNAVAILABLE");
    }
  }
  snapshot() {
    return { revision: this.data.revision, count: unreadCount(this.data.records), records: structuredClone(this.data.records), sourceId: this.data.sourceId, error: this.error, durable: !this.dirty };
  }
  transaction(fn) {
    const task = this.chain.catch(() => {
    }).then(async () => {
      if (!this.ready) fail("STATE_UNAVAILABLE");
      const value = fn();
      if (value?.changed) {
        this.data.revision++;
        this.dirty = true;
      }
      if (this.dirty) await this.persist();
      return value;
    });
    this.chain = task;
    return task;
  }
  async persist() {
    const data = structuredClone(this.data);
    const text = JSON.stringify({ data, checksum: checksum(data) });
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) {
      this.error = "QUEUE_CAPACITY_ERROR";
      fail(this.error);
    }
    try {
      await this.storage.write(text);
      this.dirty = false;
      this.error = null;
    } catch {
      this.dirty = true;
      this.error = "STATE_WRITE_FAILED";
      fail("STATE_WRITE_FAILED");
    }
  }
  streamKey(r) {
    return JSON.stringify([keyOf(r.conversation), r.streamEpoch]);
  }
  hasSeen(key, seq) {
    return this.data.seen.some(([k, a, b]) => k === key && a <= seq && seq <= b);
  }
  addSeen(key, seq) {
    const rest = this.data.seen.filter(([k]) => k !== key), ranges = this.data.seen.filter(([k]) => k === key).map(([, a, b]) => [a, b]);
    ranges.push([seq, seq]);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const p = merged.at(-1);
      if (p && r[0] <= p[1] + 1) p[1] = Math.max(p[1], r[1]);
      else merged.push([...r]);
    }
    this.data.seen = [...rest, ...merged.map(([a, b]) => [key, a, b])];
  }
  submit(fact) {
    const record = validateFact(fact);
    return this.transaction(() => {
      const existing = this.data.records.find((r) => r.id === record.id), stream = this.streamKey(record);
      if (existing || this.hasSeen(stream, record.terminalEventSeq)) return { changed: false, inserted: false, record: existing ? structuredClone(existing) : null };
      if (this.data.records.filter((r) => r.readState === "unread").length >= this.limit) {
        this.error = "QUEUE_CAPACITY_ERROR";
        fail(this.error);
      }
      const boundary = this.data.boundaries.find((b) => b.key === keyOf(record.conversation) && b.streamEpoch === record.streamEpoch);
      record.readState = boundary && record.terminalEventSeq <= boundary.throughSeq ? "acknowledged" : "unread";
      this.data.records.push(record);
      this.addSeen(stream, record.terminalEventSeq);
      return { changed: true, inserted: true, record: structuredClone(record) };
    });
  }
  acknowledge(conversation, streamEpoch, throughSeq) {
    const key = keyOf(conversation);
    if (!safeInt(throughSeq) || !boundedString(streamEpoch)) fail("INVALID_IDENTITY");
    return this.transaction(() => {
      let changed = false;
      for (const r of this.data.records) if (keyOf(r.conversation) === key && r.streamEpoch === streamEpoch && r.terminalEventSeq <= throughSeq && r.readState === "unread") {
        r.readState = "acknowledged";
        changed = true;
      }
      const b = this.data.boundaries.find((x) => x.key === key && x.streamEpoch === streamEpoch);
      if (!b) {
        this.data.boundaries.push({ key, streamEpoch, throughSeq });
        changed = true;
      } else if (b.throughSeq < throughSeq) {
        b.throughSeq = throughSeq;
        changed = true;
      }
      return { changed };
    });
  }
  retire(conversation) {
    const key = keyOf(conversation);
    return this.transaction(() => {
      let changed = false;
      for (const r of this.data.records) if (keyOf(r.conversation) === key && r.readState !== "retired") {
        r.readState = "retired";
        changed = true;
      }
      return { changed };
    });
  }
  compact() {
    return this.transaction(() => {
      const before = this.data.records.length;
      this.data.records = this.data.records.filter((r) => r.readState === "unread");
      return { changed: before !== this.data.records.length };
    });
  }
  markSilenced(id) {
    return this.transaction(() => {
      const r = this.data.records.find((r2) => r2.id === id);
      if (!r || r.silenced === true) return { changed: false };
      r.silenced = true;
      return { changed: true };
    });
  }
  pruneHistory(protectedIds = /* @__PURE__ */ new Set(), limit = 500) {
    return this.transaction(() => {
      const history = this.data.records.filter((r) => r.readState !== "unread" && !protectedIds.has(r.id)).sort((a, b) => b.endedAt - a.endedAt || b.id.localeCompare(a.id));
      const remove = new Set(history.slice(limit).map((r) => r.id));
      if (!remove.size) return { changed: false };
      this.data.records = this.data.records.filter((r) => !remove.has(r.id));
      return { changed: true, removed: remove.size };
    });
  }
  flush() {
    return this.transaction(() => ({ changed: false }));
  }
};

// src/core/queue.mjs
var ReminderQueue = class {
  constructor({ now = () => performance.now(), limit = 1e4 } = {}) {
    this.now = now;
    this.limit = limit;
    this.entries = [];
    this.ids = /* @__PURE__ */ new Set();
    this.order = 0;
    this.generation = 0;
    this.revision = 0;
    this.available = true;
    this.startedAt = null;
    this.enabled = true;
  }
  enqueue(record) {
    if (!this.enabled || this.ids.has(record.id)) return false;
    if (this.entries.length >= this.limit || !Number.isSafeInteger(this.order) || this.order >= Number.MAX_SAFE_INTEGER) fail("QUEUE_CAPACITY_ERROR");
    this.ids.add(record.id);
    this.entries.push({ record, cardId: record.id, receivedOrder: ++this.order, remainingFrontMs: FRONT_MS, state: "queued", displayGeneration: 0, hovered: false });
    if (this.entries.length === 1) this.promote();
    this.revision++;
    return true;
  }
  promote() {
    this.startedAt = null;
    if (this.front) {
      this.front.state = "painting";
      this.front.displayGeneration = ++this.generation;
    }
  }
  get front() {
    return this.entries[0];
  }
  elapsed(at = this.now()) {
    return this.startedAt === null ? 0 : Math.max(0, at - this.startedAt);
  }
  remaining() {
    return this.front ? Math.max(0, this.front.remainingFrontMs - this.elapsed()) : 0;
  }
  token() {
    return this.front ? { cardId: this.front.cardId, displayGeneration: this.front.displayGeneration } : null;
  }
  matches(token) {
    return !!this.front && token?.cardId === this.front.cardId && token.displayGeneration === this.front.displayGeneration;
  }
  painted(token) {
    if (!this.enabled || !this.available || !this.matches(token) || this.front.state !== "painting") return false;
    this.front.state = this.front.hovered ? "paused" : "front";
    this.startedAt = this.front.hovered ? null : this.now();
    this.revision++;
    return true;
  }
  setAvailable(value) {
    if (this.available === value) return;
    if (this.front && this.startedAt !== null) this.front.remainingFrontMs = this.remaining();
    this.startedAt = null;
    this.available = value;
    if (this.front) {
      this.front.state = value ? "painting" : "paused";
      this.front.displayGeneration = ++this.generation;
    }
    this.revision++;
  }
  rendererLost() {
    if (this.front) this.front.remainingFrontMs = this.remaining();
    this.promote();
    this.revision++;
  }
  remove(token, reason) {
    if (!this.matches(token)) return null;
    const old = this.entries.shift();
    old.remainingFrontMs = this.startedAt === null ? old.remainingFrontMs : Math.max(0, old.remainingFrontMs - this.elapsed());
    old.state = reason;
    this.promote();
    this.revision++;
    return old;
  }
  due(token) {
    if (!this.matches(token) || this.front.state !== "front" || this.remaining() > 0) return null;
    return this.remove(token, "expired");
  }
  click(token, pressedToken = token) {
    if (!this.available || !this.matches(token) || !this.matches(pressedToken) || !["front", "paused"].includes(this.front.state)) return null;
    if (this.remaining() <= 0) {
      this.remove(token, "expired");
      return null;
    }
    return this.remove(token, "opening");
  }
  dismiss(token) {
    return this.available && this.matches(token) && ["front", "paused"].includes(this.front.state) ? this.remove(token, "dismissed") : null;
  }
  /** Freeze the 10s budget while the pointer rests on the card (A2). */
  hover(token, paused) {
    if (!this.enabled || !this.available || !this.matches(token)) return false;
    if (this.front.state === "front" && this.remaining() <= 0) {
      this.remove(token, "expired");
      return false;
    }
    const changed = this.front.hovered !== paused;
    this.front.hovered = paused;
    if (this.front.state === "painting" || this.front.state === "opening") {
      if (changed) this.revision++;
      return changed;
    }
    if (paused) {
      if (this.front.state !== "front") return false;
      this.front.remainingFrontMs = this.remaining();
      this.front.state = "paused";
      this.startedAt = null;
    } else {
      if (this.front.state !== "paused") return false;
      this.front.state = "front";
      this.startedAt = this.now();
    }
    this.revision++;
    return true;
  }
  /** Keep the card while navigation is in flight so a failure can be shown in place. */
  beginOpen(token) {
    if (!this.available || !this.matches(token) || !["front", "paused"].includes(this.front.state)) return null;
    if (this.remaining() <= 0) {
      this.remove(token, "expired");
      return null;
    }
    this.front.remainingFrontMs = this.remaining();
    this.front.state = "opening";
    this.startedAt = null;
    this.revision++;
    return this.front;
  }
  completeOpen(token) {
    return this.matches(token) && this.front.state === "opening" ? this.remove(token, "opening") : null;
  }
  failOpen(token, code) {
    if (!this.matches(token) || this.front.state !== "opening") return null;
    this.front.state = this.front.hovered ? "paused" : "front";
    this.front.error = code;
    this.startedAt = this.front.hovered ? null : this.now();
    this.revision++;
    return this.front;
  }
  clearError(token) {
    if (!this.matches(token) || this.front.error === void 0) return false;
    delete this.front.error;
    this.revision++;
    return true;
  }
  retire(conversationKey, keyOf2) {
    const previous = this.front;
    this.entries = this.entries.filter((e) => keyOf2(e.record.conversation) !== conversationKey);
    if (previous !== this.front) this.promote();
    this.revision++;
  }
  removeWhere(predicate) {
    const before = this.front;
    this.entries = this.entries.filter((e) => !predicate(e));
    if (before !== this.front) this.promote();
    this.revision++;
  }
  disable() {
    this.enabled = false;
    this.entries = [];
    this.startedAt = null;
    this.generation++;
    this.revision++;
  }
  enable() {
    this.enabled = true;
    this.generation++;
    this.revision++;
  }
  view() {
    return {
      revision: this.revision,
      available: this.available,
      front: this.front ? this.display(this.front) : null,
      previews: this.entries.slice(1, 3).map((e) => ({ cardId: e.cardId, displayTitle: e.record.displayTitle, outcome: e.record.outcome })),
      queued: this.entries.length
    };
  }
  display(e) {
    return {
      cardId: e.cardId,
      displayGeneration: e.displayGeneration,
      remainingFrontMs: this.remaining(),
      outcome: e.record.outcome,
      displayTitle: e.record.displayTitle,
      endedAt: e.record.endedAt,
      state: e.state,
      receiptNumber: e.receivedOrder,
      workspaceTitle: e.record.workspaceTitle ?? "",
      durationMs: e.record.durationMs ?? null,
      currentlyRunning: e.record.currentlyRunning === true,
      ...e.error === void 0 ? {} : { error: e.error }
    };
  }
};

// src/host/events.mjs
var reasonMap = { completed: "ended", error: "error", aborted: "stopped", interrupted: "interrupted", "max-tokens": "limited", blocked: "blocked" };
var EventAdapter = class {
  constructor({ agents, identity, onFact, onError = () => {
  }, now = () => Date.now(), monoNow = () => performance.now(), timeoutMs = 5e3 }) {
    Object.assign(this, { agents, identity, onFact, onError, now, monoNow, timeoutMs });
    this.tasks = /* @__PURE__ */ new Map();
    this.candidates = /* @__PURE__ */ new Map();
    this.inboxes = /* @__PURE__ */ new Map();
    this.closed = false;
    this.epoch = 0;
  }
  accept(session, event) {
    if (this.closed || !session || !event || !safeInt(event.seq) || event.seq < session.firstLiveSeq || typeof session.isOwnSeq !== "function" || !session.isOwnSeq(event.seq) || session.header?.origin === "subagent") return;
    let task = this.tasks.get(session.id);
    if (event.type === "agent/inbox/spliced") this.trackInbox(session, event.data);
    if (event.type === "turn/start") {
      if (!safeInt(event.data?.turn)) return;
      const turnStartedAt = safeInt(event.time) ? event.time : this.now(), turnStartedMono = this.monoNow();
      task = {
        episodeId: task?.episodeId ?? "turn:" + event.data.turn,
        turn: event.data.turn,
        stepped: false,
        claimed: false,
        session,
        startedAt: task ? task.startedAt ?? null : turnStartedAt,
        startedMono: task ? task.startedMono ?? null : turnStartedMono,
        turnStartedAt,
        turnStartedMono,
        previousCandidate: this.candidates.get(session.id),
        startSeq: event.seq
      };
      this.tasks.set(session.id, task);
    } else if (event.type === "step/start" && task && event.data?.turn === task.turn) task.stepped = true;
    else if (event.type === "agent/inbox/spliced" && task && event.data?.removedCount > 0 && event.data?.outcome !== "canceled") task.claimed = true;
    else if (event.type === "turn/end") {
      const reason = event.data?.reason?.kind;
      if (reason === "forked") return;
      const runningAgent = this.agents.get(session.id);
      if (!task && runningAgent?.phase?.kind === "running" && runningAgent.phase.turn === event.data?.turn && runningAgent.phase.step > 0) {
        task = { episodeId: "turn:" + event.data.turn, turn: event.data.turn, stepped: true, claimed: false, session };
        this.tasks.set(session.id, task);
      }
      if (!task || event.data?.turn !== task.turn || !task.stepped && !(task.claimed && reason !== "completed")) return;
      const agent = this.agents.get(session.id);
      if (!agent || agent.session !== session || typeof agent.whenIdle !== "function") {
        this.onError("END_UNCONFIRMED");
        return;
      }
      this.cancelCandidate(session.id);
      const epoch = this.epoch, seq = event.seq;
      const candidate = {
        task: { ...task, previousCandidate: void 0 },
        event,
        timer: null,
        endedAt: safeInt(event.time) ? event.time : this.now(),
        durationMs: typeof task.startedMono === "number" ? Math.max(0, Math.round(this.monoNow() - task.startedMono)) : null
      };
      this.candidates.set(session.id, candidate);
      candidate.timer = setTimeout(() => {
        if (this.candidates.get(session.id) !== candidate) return;
        this.candidates.delete(session.id);
        this.onError("END_UNCONFIRMED");
      }, this.timeoutMs);
      Promise.resolve(agent.whenIdle()).then(async () => {
        if (this.closed || epoch !== this.epoch || this.candidates.get(session.id) !== candidate) return;
        if (this.agents.get(session.id) !== agent || agent.status !== "idle" || agent.session !== session) return;
        if (agent.inbox?.hasPending === true || agent.phase && agent.phase.kind !== "idle") return;
        this.cancelCandidate(session.id);
        this.tasks.delete(session.id);
        await this.emitFact(session, candidate);
      }).catch(() => this.onError("END_UNCONFIRMED"));
    }
  }
  trackInbox(session, data) {
    if (!data || !["next-step", "next-turn"].includes(data.target) || !safeInt(data.start) || !Array.isArray(data.inserted)) return;
    let inbox = this.inboxes.get(session.id);
    if (!inbox) {
      inbox = { "next-step": [], "next-turn": [], claimed: /* @__PURE__ */ new Map() };
      this.inboxes.set(session.id, inbox);
    }
    const list = inbox[data.target], remove = data.removedCount ?? 0;
    if (!safeInt(remove) || data.start > list.length || data.start + remove > list.length) return;
    const removed = list.splice(data.start, remove, ...data.inserted.map((m) => ({ id: m.id, human: m.source?.kind === "user" })));
    if (data.outcome !== "canceled") for (const m of removed) inbox.claimed.set(m.id, { ...m, target: data.target });
  }
  claim({ agent, message, turn }) {
    if (this.closed || !agent || this.agents.get(agent.id) !== agent || agent.session?.header?.origin === "subagent" || !safeInt(turn)) return;
    const session = agent.session;
    let task = this.tasks.get(session.id);
    if (!task) {
      task = { episodeId: "turn:" + turn, turn, stepped: false, claimed: true, session };
      this.tasks.set(session.id, task);
    }
    if (task.turn !== turn) return;
    task.claimed = true;
    const inbox = this.inboxes.get(session.id), hint = inbox?.claimed.get(message?.id);
    inbox?.claimed.delete(message?.id);
    if (hint?.human && hint.target === "next-turn" && task.previousCandidate && task.previousCandidate.event.data.turn < turn) {
      const previous = task.previousCandidate;
      task.previousCandidate = null;
      task.episodeId = "turn:" + turn;
      task.startedAt = task.turnStartedAt ?? null;
      task.startedMono = task.turnStartedMono ?? null;
      if (this.candidates.get(session.id) === previous) this.cancelCandidate(session.id);
      void this.emitFact(session, previous).catch(() => this.onError("END_UNCONFIRMED"));
    }
  }
  async emitFact(session, candidate) {
    if (this.closed) return;
    const identity = this.identity(session);
    if (!identity) {
      this.onError("END_UNCONFIRMED");
      return;
    }
    await this.onFact({
      ...identity,
      taskEpisodeId: candidate.task.episodeId,
      terminalEventSeq: candidate.event.seq,
      endedAt: candidate.endedAt,
      startedAt: candidate.task.startedAt ?? null,
      durationMs: candidate.durationMs,
      outcome: reasonMap[candidate.event.data?.reason?.kind] ?? "unknown",
      displayTitle: cleanTitle(identity.displayTitle)
    });
  }
  cancelCandidate(id) {
    const c = this.candidates.get(id);
    if (c) clearTimeout(c.timer);
    this.candidates.delete(id);
  }
  forget(sessionId) {
    this.cancelCandidate(sessionId);
    this.tasks.delete(sessionId);
    this.inboxes.delete(sessionId);
  }
  dispose() {
    this.closed = true;
    this.epoch++;
    for (const id of this.candidates.keys()) this.cancelCandidate(id);
    this.tasks.clear();
    this.inboxes.clear();
  }
};

// src/host/bridge.mjs
import { spawn } from "node:child_process";
import { randomUUID as randomUUID2 } from "node:crypto";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
var NativeBridge = class {
  constructor({ factory, onEvent = () => {
  }, onError = () => {
  } } = {}) {
    const helper = new URL(true ? "../native/Reminder.exe" : "../../native/Reminder.exe", import.meta.url);
    this.factory = factory ?? (() => spawn(
      fileURLToPath(helper),
      [String(process.pid)],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], shell: false }
    ));
    this.onEvent = onEvent;
    this.onError = onError;
    this.child = null;
    this.pending = /* @__PURE__ */ new Map();
    this.identity = { nonce: randomUUID2(), ownerInstance: randomUUID2(), generation: 1 };
    this.revision = 0;
    this.bytes = 0;
    this.line = "";
    this.decoder = new StringDecoder("utf8");
    this.closed = false;
  }
  start() {
    if (this.closed) fail("HELPER_EXITED");
    if (this.child) return;
    try {
      this.child = this.factory();
    } catch {
      this.broken("HELPER_EXITED");
      fail("HELPER_EXITED");
    }
    this.child.stdout.on("data", (c) => this.data(c));
    this.child.stderr.on("data", () => {
    });
    this.child.on("error", () => this.broken("HELPER_EXITED"));
    this.child.on("exit", () => this.broken("HELPER_EXITED"));
    this.child.stdin.on("error", () => this.broken("PROTOCOL_ERROR"));
  }
  data(chunk) {
    if (this.closed) return;
    try {
      for (let offset = 0; offset < chunk.length; ) {
        const lf = chunk.indexOf(10, offset), end = lf < 0 ? chunk.length : lf, piece = chunk.subarray(offset, end);
        this.bytes += piece.length;
        if (this.bytes > 32768) fail("PROTOCOL_ERROR");
        this.line += this.decoder.write(piece);
        if (lf < 0) break;
        const raw = JSON.parse(this.line);
        this.line = "";
        this.bytes = 0;
        this.message(envelope(raw, this.identity, 32768));
        offset = lf + 1;
      }
    } catch {
      this.broken("PROTOCOL_ERROR");
    }
  }
  message(m) {
    if (m.type === "event") {
      if (!["painted", "click", "dismiss", "availability", "hover"].includes(m.payload.kind)) fail("PROTOCOL_ERROR");
      if (m.payload.kind === "availability") {
        if (typeof m.payload.available !== "boolean") fail("PROTOCOL_ERROR");
      } else {
        if (typeof m.payload.cardId !== "string" || !Number.isSafeInteger(m.payload.displayGeneration)) fail("PROTOCOL_ERROR");
        if (m.payload.kind === "hover" && typeof m.payload.paused !== "boolean") fail("PROTOCOL_ERROR");
      }
      try {
        this.onEvent(m.payload);
      } catch {
      }
      return;
    }
    const p = this.pending.get(m.requestId);
    if (!p) return;
    if (m.type !== "response" || typeof m.payload.ok !== "boolean") fail("PROTOCOL_ERROR");
    if (m.payload.ok === false && (typeof m.payload.code !== "string" || !/^[A-Z_]{1,64}$/.test(m.payload.code))) fail("PROTOCOL_ERROR");
    if (m.payload.ok === true && !isObject(m.payload.value)) fail("PROTOCOL_ERROR");
    this.pending.delete(m.requestId);
    clearTimeout(p.timer);
    if (m.payload.ok) p.resolve(m.payload.value);
    else p.reject(new ReminderError(m.payload.code));
  }
  request(type, payload = {}, timeoutMs = 2e3) {
    if (this.closed) return Promise.reject(new ReminderError("HELPER_EXITED"));
    try {
      this.start();
    } catch (e) {
      return Promise.reject(e instanceof ReminderError ? e : new ReminderError("HELPER_EXITED"));
    }
    const requestId = randomUUID2();
    const m = { protocolVersion: PROTOCOL, ...this.identity, requestId, revision: ++this.revision, type, payload };
    const frame = JSON.stringify(m) + "\n";
    if (Buffer.byteLength(frame) > 131072) {
      this.broken("PROTOCOL_ERROR");
      return Promise.reject(new ReminderError("PROTOCOL_ERROR"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new ReminderError("HELPER_TIMEOUT"));
        this.broken("HELPER_TIMEOUT");
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.child.stdin.write(frame);
      } catch {
        this.broken("PROTOCOL_ERROR");
      }
    });
  }
  broken(code) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new ReminderError(code));
    }
    this.pending.clear();
    try {
      this.child?.kill();
    } catch {
    }
    try {
      this.onError(code);
    } catch {
    }
  }
  async dispose() {
    try {
      if (!this.closed && this.child) {
        try {
          await this.request("shutdown", {}, 1e3);
        } catch {
        }
      }
    } finally {
      try {
        this.broken("HELPER_EXITED");
      } catch {
      }
    }
  }
};

// src/host/group.mjs
import net from "node:net";
import os from "node:os";
import { createHash as createHash2, randomUUID as randomUUID3 } from "node:crypto";
import { StringDecoder as StringDecoder2 } from "node:string_decoder";
var servers = /* @__PURE__ */ new Map();
var hash = (x) => createHash2("sha256").update(x).digest("hex").slice(0, 32);
function groupPipe() {
  return "\\\\.\\pipe\\dsh-finish-reminder-v3-" + hash(os.homedir().toLowerCase() + "\0" + (process.env.SESSIONNAME ?? "Console") + "\0" + process.execPath.toLowerCase());
}
function wire(socket, onMessage, onClose, max = 131072) {
  let text = "", bytes = 0;
  const decoder = new StringDecoder2("utf8");
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      socket.destroy();
    } catch {
    }
    try {
      onClose();
    } catch {
    }
  };
  socket.on("data", (chunk) => {
    try {
      for (let at = 0; at < chunk.length; ) {
        const next = chunk.indexOf(10, at), end = next < 0 ? chunk.length : next, part = chunk.subarray(at, end);
        bytes += part.length;
        if (bytes > max) throw 0;
        text += decoder.write(part);
        if (next < 0) break;
        const m = JSON.parse(text);
        text = "";
        bytes = 0;
        onMessage(m);
        at = next + 1;
      }
    } catch {
      close();
    }
  });
  socket.on("error", close);
  socket.on("close", close);
  return { send: (m) => {
    if (closed) fail("PROTOCOL_ERROR");
    const line = JSON.stringify(m) + "\n";
    if (Buffer.byteLength(line) > max) fail("PROTOCOL_ERROR");
    socket.write(line);
  }, close };
}
var GroupServer = class {
  constructor(path, { nativeFactory } = {}) {
    this.path = path;
    this.peers = /* @__PURE__ */ new Set();
    this.sources = /* @__PURE__ */ new Map();
    this.queue = new ReminderQueue();
    this.timer = null;
    this.chain = Promise.resolve();
    this.generation = randomUUID3();
    this.closing = false;
    this.lastBadgeCount = null;
    this.clickTimers = /* @__PURE__ */ new Map();
    this.trackedCards = /* @__PURE__ */ new Map();
    this.silencedIds = /* @__PURE__ */ new Set();
    this.native = new NativeBridge({ factory: nativeFactory, onEvent: (e) => this.event(e), onError: (code) => {
      try {
        if (!this.closing) {
          for (const p of this.peers) this.push(p, { kind: "fault", code });
          void this.close().catch(() => {
          });
        }
      } catch {
      }
    } });
    this.server = net.createServer((socket) => this.connect(socket));
    this.server.on("error", () => {
    });
  }
  listen() {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen({ path: this.path, exclusive: true, readableAll: false, writableAll: false }, () => {
        this.server.off("error", reject);
        servers.set(this.path, this);
        resolve(this);
      });
    });
  }
  connect(socket) {
    const p = { source: null, nonce: null, wire: null, closed: false };
    this.peers.add(p);
    const timer = setTimeout(() => {
      if (!p.source) p.wire.close();
    }, 3e3);
    timer.unref?.();
    p.wire = wire(socket, (m) => {
      void Promise.resolve().then(async () => {
        if (!m || typeof m.id !== "string" || m.id.length > 80 || typeof m.method !== "string" || !m.payload || typeof m.payload !== "object") fail("PROTOCOL_ERROR");
        if (p.nonce !== null && m.nonce !== p.nonce) fail("PROTOCOL_ERROR");
        if (p.nonce === null) {
          if (m.method !== "register" || typeof m.nonce !== "string" || m.nonce.length < 32) fail("PROTOCOL_ERROR");
          p.nonce = m.nonce;
        }
        const value = await this.handle(p, m.method, m.payload);
        if (!p.closed) p.wire.send({ id: m.id, nonce: p.nonce, generation: this.generation, ok: true, value });
      }).catch((e) => {
        if (!p.closed) try {
          p.wire.send({ id: m?.id, nonce: p.nonce, generation: this.generation, ok: false, code: /^[A-Z_]+$/.test(e.code ?? "") ? e.code : "PROTOCOL_ERROR" });
        } catch {
          p.wire.close();
        }
      });
    }, () => {
      try {
        p.closed = true;
        clearTimeout(timer);
        this.peers.delete(p);
        if (p.source && this.sources.get(p.source.id) === p) this.sources.delete(p.source.id);
        if (p.source) {
          this.clearSourceCards(p);
          for (const token of p.source.tokens) void this.native.request("unbindWindow", { windowToken: token }).catch(() => {
          });
          const ids = [...p.source.knownIds];
          for (let i = 0; i < ids.length; i += 16) void this.native.request("forgetCompletion", { completionIds: ids.slice(i, i + 16) }).catch(() => {
          });
        }
        if (!this.closing) {
          if (this.peers.size === 0) void this.close().catch(() => {
          });
          else void this.render();
        }
      } catch {
      }
    });
  }
  async handle(p, method, data) {
    if (method === "register") {
      if (p.source || typeof data.sourceId !== "string" || data.sourceId.length > 80 || !safeInt(data.count) || !safeInt(data.revision) || !safeInt(data.hostPid)) fail("PROTOCOL_ERROR");
      if (this.sources.has(data.sourceId)) fail("SOURCE_OWNER_CONFLICT");
      p.source = { id: data.sourceId, count: data.count, revision: data.revision, hostPid: data.hostPid, dark: data.dark === true, quiet: data.quiet === true, running: /* @__PURE__ */ new Map(), tokens: /* @__PURE__ */ new Set(), knownIds: /* @__PURE__ */ new Set() };
      this.sources.set(data.sourceId, p);
      const caps = await this.native.request("hello");
      let desktop = null;
      try {
        desktop = await this.native.request("registerDesktop", { hostPid: data.hostPid });
      } catch {
      }
      p.source.desktop = !!desktop;
      this.lastBadgeCount = null;
      await this.render();
      return { ...caps, desktop: !!desktop, groupGeneration: this.generation, acceptance: "UNVERIFIED" };
    }
    if (!p.source) fail("PROTOCOL_ERROR");
    if (method === "snapshot") {
      if (!safeInt(data.count) || !safeInt(data.revision)) fail("PROTOCOL_ERROR");
      if (data.revision >= p.source.revision) {
        p.source.count = data.count;
        p.source.revision = data.revision;
        if (typeof data.dark === "boolean") p.source.dark = data.dark;
      }
      if (typeof data.quiet === "boolean" && data.quiet !== p.source.quiet) {
        p.source.quiet = data.quiet;
        if (data.quiet) this.clearSourceCards(p);
      }
      await this.render();
      return { applied: true, count: this.count(), queued: this.queue.entries.filter((e) => e.sourceId === p.source.id).length };
    }
    if (method === "submit") {
      if (!p.source.desktop) fail("DESKTOP_BRIDGE_UNAVAILABLE");
      const r = validateFact(data.record);
      r.id = data.record.id;
      if (r.id !== validateFact(data.record).id || r.conversation.hostInstanceId !== p.source.id) fail("INVALID_COMPLETION");
      await this.native.request("observeCompletion", { completionId: r.id });
      p.source.knownIds.add(r.id);
      if (p.source.quiet || r.silenced || this.silencedIds.has(r.id)) {
        this.queue.ids.add(r.id);
        this.silencedIds.add(r.id);
        await this.render();
        return { accepted: true, inserted: false, queued: false, silenced: true };
      }
      const running = p.source.running.get(keyOf(r.conversation));
      r.currentlyRunning = running && running.revision >= (data.runningRevision ?? 0) ? running.value : data.running === true;
      const inserted = this.queue.enqueue(r);
      const e = this.queue.entries.find((e2) => e2.record.id === r.id);
      if (e) {
        e.sourceId = p.source.id;
        this.trackedCards.set(r.id, p.source.id);
      }
      await this.render();
      return { accepted: true, inserted, queued: this.queue.entries.some((e2) => e2.record.id === r.id), silenced: false };
    }
    if (method === "running") {
      if (data.conversation?.hostInstanceId !== p.source.id || typeof data.running !== "boolean" || !safeInt(data.revision)) fail("PROTOCOL_ERROR");
      const key = keyOf(data.conversation), prior = p.source.running.get(key);
      if (!prior || data.revision >= prior.revision) {
        p.source.running.set(key, { revision: data.revision, value: data.running });
        for (const e of this.queue.entries) if (keyOf(e.record.conversation) === key) e.record.currentlyRunning = data.running;
      }
      await this.render();
      return { applied: true };
    }
    if (method === "retire") {
      const r = data.conversation;
      if (r?.hostInstanceId !== p.source.id) fail("INVALID_IDENTITY");
      this.queue.retire(keyOf(r), keyOf);
      await this.render();
      return { applied: true };
    }
    if (method === "bindWindow") {
      const result = await this.native.request(method, { ...data, hostPid: p.source.hostPid });
      if (!p.source.desktop) {
        this.lastBadgeCount = null;
        p.source.desktop = result.bound === true;
        void this.render();
      }
      if (result.windowToken) p.source.tokens.add(result.windowToken);
      return result;
    }
    if (["forgetCompletion", "observeCompletion"].includes(method)) {
      const result = await this.native.request(method, data);
      for (const id of data.completionIds ?? [data.completionId]) {
        if (method === "observeCompletion") p.source.knownIds.add(id);
        else p.source.knownIds.delete(id);
      }
      return result;
    }
    if (["foreground", "verifyForeground", "unbindWindow"].includes(method)) return await this.native.request(method, data);
    if (method === "clickDone") {
      if (typeof data.completionId !== "string" || typeof data.ok !== "boolean") fail("PROTOCOL_ERROR");
      const front = this.queue.front;
      if (front && front.record.id === data.completionId && front.state === "opening") {
        this.clearClick(data.completionId);
        const token = this.queue.token();
        if (data.ok) this.queue.completeOpen(token);
        else {
          const code = typeof data.code === "string" && /^[A-Z_]{1,64}$/.test(data.code) ? data.code : "NAVIGATION_UNCONFIRMED";
          this.queue.failOpen(token, code);
          const timer = setTimeout(() => {
            if (this.queue.clearError(token)) void this.render();
          }, 2e3);
          timer.unref?.();
        }
        await this.render();
      }
      return { applied: true };
    }
    if (method === "unregister") {
      p.wire.close();
      return {};
    }
    fail("PROTOCOL_ERROR");
  }
  count() {
    let count = 0;
    for (const p of this.sources.values()) count += p.source.count;
    if (!Number.isSafeInteger(count)) fail("QUEUE_CAPACITY_ERROR");
    return count;
  }
  clearSourceCards(p) {
    this.queue.removeWhere((e) => e.sourceId === p.source.id);
  }
  push(p, event) {
    try {
      p.wire.send({ event, nonce: p.nonce, generation: this.generation });
    } catch {
      p.wire.close();
    }
  }
  event(e) {
    const token = { cardId: e.cardId, displayGeneration: e.displayGeneration };
    if (e.kind === "painted") this.queue.painted(token);
    else if (e.kind === "availability") this.queue.setAvailable(e.available);
    else if (e.kind === "hover") {
      if (typeof e.paused === "boolean") {
        this.queue.hover(token, e.paused);
        void this.render();
      }
    } else if (e.kind === "dismiss") {
      const removed = this.queue.dismiss(token);
      const peer = removed && this.sources.get(removed.sourceId);
      if (peer) this.push(peer, { kind: "dismiss", cardId: removed.record.id, displayGeneration: e.displayGeneration, completionId: removed.record.id });
      void this.render();
    } else if (e.kind === "click") {
      const opening = this.queue.beginOpen(token);
      if (opening) {
        const peer = this.sources.get(opening.sourceId);
        if (peer) this.push(peer, { kind: "click", cardId: opening.record.id, displayGeneration: e.displayGeneration, completionId: opening.record.id });
        this.armClick(opening.record.id);
        void this.render();
      } else void this.render();
    }
  }
  armClick(id) {
    this.clearClick(id);
    const timer = setTimeout(() => {
      this.clickTimers.delete(id);
      const front = this.queue.front;
      if (front && front.record.id === id && front.state === "opening" && this.queue.completeOpen(this.queue.token())) void this.render();
    }, 4e3);
    timer.unref?.();
    this.clickTimers.set(id, timer);
  }
  clearClick(id) {
    const timer = this.clickTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.clickTimers.delete(id);
    }
  }
  render() {
    const work = this.chain.catch(() => {
    }).then(async () => {
      if (this.closing) return;
      clearTimeout(this.timer);
      this.timer = null;
      const active = new Set(this.queue.entries.map((e) => e.record.id));
      for (const [id, sourceId] of this.trackedCards) if (!active.has(id)) {
        const owner = this.sources.get(sourceId);
        if (owner) this.push(owner, { kind: "cardRemoved", completionId: id });
        this.trackedCards.delete(id);
        this.clearClick(id);
      }
      const view = this.queue.view(), peer = this.queue.front && this.sources.get(this.queue.front.sourceId);
      try {
        await this.native.request("syncView", { front: view.front, previews: view.previews, queued: view.queued, available: view.available, dark: peer?.source.dark ?? false });
      } catch (e) {
        if (e.code === "DISPLAY_UNAVAILABLE") this.queue.setAvailable(false);
        for (const p of this.peers) this.push(p, { kind: "fault", code: e.code ?? "HELPER_EXITED" });
      }
      try {
        if (this.sources.size && this.lastBadgeCount !== this.count()) {
          const count = this.count();
          await this.native.request("badge", { count });
          this.lastBadgeCount = count;
          for (const p of this.peers) if (p.source?.desktop) this.push(p, { kind: "badgeStatus", supported: true, code: null });
        }
      } catch (e) {
        for (const p of this.peers) this.push(p, { kind: "badgeStatus", code: e.code ?? "BADGE_PLACEMENT_UNSUPPORTED" });
      }
      for (const p of this.peers) if (p.source) this.push(p, { kind: "queueStatus", queued: this.queue.entries.filter((e) => e.sourceId === p.source.id).length, aggregateCount: this.count() });
      if (this.queue.front?.state === "front") {
        const token = this.queue.token();
        this.timer = setTimeout(() => {
          this.queue.due(token);
          void this.render();
        }, Math.ceil(this.queue.remaining()));
      }
    });
    this.chain = work;
    return work;
  }
  async close() {
    if (this.closing) return;
    this.closing = true;
    try {
      clearTimeout(this.timer);
      for (const t of this.clickTimers.values()) clearTimeout(t);
      this.clickTimers.clear();
      for (const p of this.peers) p.wire.close();
      this.peers.clear();
      this.sources.clear();
    } catch {
    }
    await this.chain.catch(() => {
    });
    try {
      await this.native.dispose();
    } catch {
    }
    try {
      this.server.close();
    } catch {
    }
    if (servers.get(this.path) === this) servers.delete(this.path);
  }
};
var GroupBridge = class {
  constructor({ onEvent = () => {
  }, onError = () => {
  }, path = groupPipe(), nativeFactory } = {}) {
    Object.assign(this, { onEvent, onError, path, nativeFactory });
    this.pending = /* @__PURE__ */ new Map();
    this.nonce = randomUUID3();
    this.wire = null;
    this.closed = false;
    this.ready = null;
    this.generation = null;
    this.group = true;
  }
  connect() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const server = new GroupServer(this.path, { nativeFactory: this.nativeFactory });
      try {
        await server.listen();
      } catch (e) {
        await server.native.dispose();
        if (e.code !== "EADDRINUSE" && e.code !== "EACCES") throw e;
      }
      await new Promise((resolve, reject) => {
        const socket = net.createConnection(this.path);
        const deadline = setTimeout(() => {
          socket.destroy();
          reject(new ReminderError("PROTOCOL_ERROR"));
        }, 2e3);
        socket.once("error", (e) => {
          clearTimeout(deadline);
          reject(e);
        });
        socket.once("connect", () => {
          clearTimeout(deadline);
          this.wire = wire(socket, (m) => this.message(m), () => this.broken());
          resolve();
        });
      });
    })();
    return this.ready;
  }
  message(m) {
    if (m.event) {
      if (m.nonce !== this.nonce || typeof m.generation !== "string" || this.generation && m.generation !== this.generation || !["click", "dismiss", "fault", "badgeStatus", "queueStatus", "cardRemoved"].includes(m.event.kind)) return this.broken();
      try {
        this.onEvent(m.event);
      } catch {
      }
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.nonce !== this.nonce || typeof m.ok !== "boolean" || typeof m.generation !== "string") return this.broken();
    if (this.generation && this.generation !== m.generation) return this.broken();
    this.generation = m.generation;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.value);
    else p.reject(new ReminderError(m.code ?? "PROTOCOL_ERROR"));
  }
  async request(method, payload = {}, timeoutMs = 3e3) {
    if (this.closed) fail("HELPER_EXITED");
    await this.connect();
    const id = randomUUID3();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ReminderError("HELPER_TIMEOUT"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.wire.send({ id, nonce: this.nonce, method, payload });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  broken() {
    if (this.closed) return;
    this.closed = true;
    this.wire?.close();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new ReminderError("HELPER_EXITED"));
    }
    this.pending.clear();
    try {
      this.onError("HELPER_EXITED");
    } catch {
    }
  }
  async dispose() {
    if (this.closed) return;
    this.closed = true;
    this.wire?.close();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new ReminderError("HELPER_EXITED"));
    }
    this.pending.clear();
  }
};

// src/host/clients.mjs
var ClientHub = class {
  constructor(runtime) {
    this.runtime = runtime;
    this.clients = /* @__PURE__ */ new Map();
    this.pending = /* @__PURE__ */ new Map();
    this.closed = false;
    this.snapshotGeneration = 0;
  }
  async update(data) {
    if (!boundedString(data.clientId, 80) || data.desktop !== true) fail("ACCESS_DENIED");
    let c = this.clients.get(data.clientId);
    if (!c) {
      if (this.clients.size >= 32) fail("QUEUE_CAPACITY_ERROR");
      c = { id: data.clientId, send: null, windowToken: null, sessionId: null, userIntent: 0, updatedAt: 0 };
      this.clients.set(c.id, c);
    }
    c.metadata = data;
    c.sessionId = typeof data.sessionId === "string" ? data.sessionId : null;
    c.focused = data.focused === true;
    c.updatedAt = performance.now();
    if (safeInt(data.userIntent)) c.userIntent = data.userIntent;
    for (const [id, p] of this.pending) if (p.client === c && p.expectedIntent !== c.userIntent) {
      this.pending.delete(id);
      p.detach();
      p.reject(Object.assign(new Error("NAVIGATION_CANCELLED"), { code: "NAVIGATION_CANCELLED" }));
      c.send?.("cancelNavigation", { requestId: id });
    }
    if (c.focused) c.lastFocusedAt = c.updatedAt;
    const geometry = JSON.stringify([data.x, data.y, data.width, data.height]);
    if (this.runtime.enabled && this.runtime.bridge?.group && (!c.windowToken || c.geometry !== geometry)) {
      try {
        const result = await this.runtime.bridge.request("bindWindow", { clientId: c.id, x: data.x, y: data.y, width: data.width, height: data.height });
        c.windowToken = result.windowToken;
        c.geometry = geometry;
        this.runtime.capabilities.navigation = true;
      } catch (e) {
        if (!c.windowToken) this.runtime.navigationError = e.code ?? "WINDOW_BINDING_AMBIGUOUS";
      }
    }
    this.runtime.publish();
    return { registered: true, bound: !!c.windowToken };
  }
  stream(clientId, signal) {
    if (!boundedString(clientId, 80)) fail("ACCESS_DENIED");
    const c = this.clients.get(clientId);
    if (!c) fail("ACCESS_DENIED");
    c.stop?.();
    const encoder = new TextEncoder();
    let timer, done = false;
    return new ReadableStream({ start: (controller) => {
      const stop = () => {
        if (done) return;
        done = true;
        clearInterval(timer);
        if (c.send === send) c.send = null;
        try {
          controller.close();
        } catch {
        }
        ;
      };
      const send = (type, data) => {
        if (done) return;
        try {
          const frame = "event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n";
          if (encoder.encode(frame).length > 32768) fail("PROTOCOL_ERROR");
          controller.enqueue(encoder.encode(frame));
        } catch {
          stop();
        }
      };
      c.send = send;
      this.publishTo(c);
      send("status", this.runtime.status());
      timer = setInterval(() => {
        if (this.closed) stop();
        else send("heartbeat", {});
      }, 15e3);
      timer.unref?.();
      signal?.addEventListener("abort", stop, { once: true });
      c.stop = () => {
        signal?.removeEventListener("abort", stop);
        stop();
      };
    }, cancel: () => {
      clearInterval(timer);
      done = true;
      c.send = null;
    } });
  }
  publishTo(c) {
    if (!c.send || c.targetsRevision === this.runtime.store?.data.revision) return;
    c.targetsRevision = this.runtime.store?.data.revision;
    const targets = /* @__PURE__ */ new Map();
    for (const r of this.runtime.store?.data.records ?? []) if (r.readState === "unread") {
      const key = JSON.stringify([r.conversation.sessionId, r.streamEpoch]);
      const prior = targets.get(key);
      if (!prior || prior.throughSeq < r.terminalEventSeq) targets.set(key, { sessionId: r.conversation.sessionId, streamEpoch: r.streamEpoch, throughSeq: r.terminalEventSeq, completionId: r.id });
    }
    const generation = ++this.snapshotGeneration, list = [...targets.values()];
    c.send("targetsStart", { generation });
    for (let i = 0; i < list.length; i += 8) c.send("targetsChunk", { generation, items: list.slice(i, i + 8) });
    c.send("targetsEnd", { generation });
  }
  publish() {
    for (const c of this.clients.values()) this.publishTo(c);
  }
  invalidate() {
    for (const c of this.clients.values()) {
      c.windowToken = null;
      c.targetsRevision = void 0;
    }
    this.runtime.capabilities.navigation = false;
  }
  async rebindAll() {
    for (const c of this.clients.values()) if (c.metadata) await this.update(c.metadata);
  }
  choose() {
    const clients = [...this.clients.values()].filter((c) => c.windowToken && c.send);
    if (clients.length === 1) return clients[0];
    clients.sort((a, b) => (b.lastFocusedAt ?? 0) - (a.lastFocusedAt ?? 0));
    if (clients.length && clients[0].lastFocusedAt && clients[0].lastFocusedAt !== (clients[1]?.lastFocusedAt ?? 0)) return clients[0];
    fail("WINDOW_BINDING_AMBIGUOUS");
  }
  async openAndObserve({ conversation, boundary, requestId, signal, clientId }) {
    const r = this.runtime.store.data.records.find((r2) => keyOf(r2.conversation) === keyOf(conversation) && r2.streamEpoch === boundary.streamEpoch && r2.terminalEventSeq === boundary.throughSeq);
    if (!r || r.readState === "retired") fail("TARGET_GONE");
    if (this.runtime.ctx.get("workspaceRegistry")?.archivedSessionIds?.includes(conversation.sessionId)) {
      await this.runtime.retire(conversation.sessionId);
      fail("TARGET_ARCHIVED");
    }
    const live = this.runtime.ctx.get("sessions")?.get?.(conversation.sessionId), persistence = this.runtime.ctx.get("sessionPersistence");
    let header = live?.header;
    if (!live && persistence?.stat) {
      try {
        const metadata = await persistence.stat(conversation.sessionId, { signal });
        if (!metadata) {
          await this.runtime.retire(conversation.sessionId);
          fail("TARGET_GONE");
        }
        header = metadata.header;
      } catch (e) {
        if (e.code === "TARGET_GONE") throw e;
        if (e.code === "EACCES" || e.code === "EPERM") fail("ACCESS_DENIED");
        fail("TARGET_STATE_UNCONFIRMED");
      }
    }
    if (header && String(header.createdAt) !== boundary.streamEpoch) {
      await this.runtime.retire(conversation.sessionId);
      fail("TARGET_GONE");
    }
    const c = clientId ? this.clients.get(clientId) : this.choose();
    if (!c?.windowToken || !c.send) fail("CLIENT_UNAVAILABLE");
    const expectedIntent = c.userIntent;
    signal.throwIfAborted();
    const result = new Promise((resolve, reject) => {
      const cancel = () => {
        this.pending.delete(requestId);
        c.send?.("cancelNavigation", { requestId });
        reject(Object.assign(new Error("NAVIGATION_TIMEOUT"), { code: "NAVIGATION_TIMEOUT" }));
      };
      signal.addEventListener("abort", cancel, { once: true });
      this.pending.set(requestId, { client: c, conversation, boundary, expectedIntent, resolve, reject, detach: () => signal.removeEventListener("abort", cancel) });
    });
    result.catch(() => {
    });
    try {
      let front = await this.runtime.bridge.request("foreground", { windowToken: c.windowToken });
      for (let i = 0; !front.foreground && i < 8; i++) {
        signal.throwIfAborted();
        await new Promise((resolve) => setTimeout(resolve, 25));
        front = await this.runtime.bridge.request("verifyForeground", { windowToken: c.windowToken });
      }
      if (!front.foreground) fail("FOREGROUND_DENIED");
      signal.throwIfAborted();
      if (c.userIntent !== expectedIntent || !this.pending.has(requestId)) fail("NAVIGATION_CANCELLED");
      c.send("navigate", { requestId, sessionId: conversation.sessionId, streamEpoch: boundary.streamEpoch, throughSeq: boundary.throughSeq, userIntent: expectedIntent });
    } catch (e) {
      const pending = this.pending.get(requestId);
      if (pending) {
        this.pending.delete(requestId);
        pending.detach();
        pending.reject(e);
      }
    }
    return await result;
  }
  async navigationResult(data) {
    const p = this.pending.get(data.requestId);
    if (!p || p.client.id !== data.clientId) return { ignored: true };
    if (data.ok !== true) {
      this.pending.delete(data.requestId);
      p.detach();
      p.reject(Object.assign(new Error("NAVIGATION_UNCONFIRMED"), { code: boundedString(data.code, 64) ? data.code : "NAVIGATION_UNCONFIRMED" }));
      return { received: true };
    }
    if (data.sessionId !== p.conversation.sessionId || data.streamEpoch !== p.boundary.streamEpoch || data.throughSeq !== p.boundary.throughSeq || data.mainView !== true || data.visible !== true || data.focused !== true || data.userIntent !== p.expectedIntent) return { ignored: true };
    const native = await this.runtime.bridge.request("verifyForeground", { windowToken: p.client.windowToken });
    if (this.pending.get(data.requestId) !== p) return { ignored: true };
    this.pending.delete(data.requestId);
    p.detach();
    p.resolve({
      conversation: p.conversation,
      foreground: native.foreground,
      interactive: native.interactive,
      mainView: true,
      userIntentValid: p.client.userIntent === p.expectedIntent,
      streamEpoch: p.boundary.streamEpoch,
      visibleThroughSeq: p.boundary.throughSeq
    });
    return { received: true };
  }
  async manualRead(data) {
    const c = this.clients.get(data.clientId);
    if (!c?.windowToken || c.sessionId !== data.sessionId || data.mainView !== true || data.visible !== true || data.focused !== true || !safeInt(data.throughSeq) || data.userIntent !== c.userIntent) fail("ACCESS_DENIED");
    if ([...this.pending.values()].some((p) => p.client === c)) fail("VIEW_UNCONFIRMED");
    const record = this.runtime.store.data.records.find((r) => r.id === data.completionId && r.conversation.sessionId === data.sessionId && r.streamEpoch === data.streamEpoch && r.terminalEventSeq === data.throughSeq);
    if (!record) fail("TARGET_GONE");
    const native = await this.runtime.bridge.request("verifyForeground", { windowToken: c.windowToken, completionId: record.id, requireUserInput: true });
    if (!native.foreground || native.userInput !== true) fail("VIEW_UNCONFIRMED");
    await this.runtime.store.acknowledge(record.conversation, record.streamEpoch, record.terminalEventSeq);
    await this.runtime.render();
    this.publish();
    this.runtime.publish();
    return { acknowledged: true };
  }
  remove(clientId) {
    const c = this.clients.get(clientId);
    c?.stop?.();
    this.clients.delete(clientId);
    if (c?.windowToken && this.runtime.bridge?.group) void this.runtime.bridge.request("unbindWindow", { windowToken: c.windowToken }).catch(() => {
    });
    for (const [id, p] of this.pending) if (p.client === c) {
      this.pending.delete(id);
      p.detach();
      p.reject(Object.assign(new Error("NAVIGATION_UNCONFIRMED"), { code: "NAVIGATION_UNCONFIRMED" }));
    }
  }
  dispose() {
    this.closed = true;
    for (const id of [...this.clients.keys()]) this.remove(id);
  }
};

// src/core/navigation.mjs
var NavigationController = class {
  constructor({ adapter, store, timeoutMs = 3e3, onError = () => {
  } }) {
    Object.assign(this, { adapter, store, timeoutMs, onError });
    this.pending = /* @__PURE__ */ new Map();
    this.completed = /* @__PURE__ */ new Map();
    this.epoch = 0;
    this.closed = false;
  }
  open(record, requestId, { clientId } = {}) {
    if (this.closed) return Promise.reject(new Error("NAVIGATION_UNAVAILABLE"));
    if (this.completed.has(requestId)) return this.completed.get(requestId);
    if (this.completed.size >= 1e4) return Promise.reject(new Error("QUEUE_CAPACITY_ERROR"));
    if (this.pending.has(requestId)) return this.pending.get(requestId).promise;
    for (const p of this.pending.values()) p.abort.abort();
    const abort = new AbortController(), generation = ++this.epoch;
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    const task = { abort, promise: null };
    const promise = (async () => {
      try {
        const boundary = { streamEpoch: record.streamEpoch, throughSeq: record.terminalEventSeq };
        let detach;
        const cancelled = new Promise((_, reject) => {
          const cancel = () => reject(Object.assign(new Error("NAVIGATION_TIMEOUT"), { code: "NAVIGATION_TIMEOUT" }));
          abort.signal.addEventListener("abort", cancel, { once: true });
          detach = () => abort.signal.removeEventListener("abort", cancel);
        });
        let e;
        try {
          e = await Promise.race([this.adapter.openAndObserve({ conversation: record.conversation, boundary, requestId, signal: abort.signal, clientId }), cancelled]);
        } finally {
          detach();
        }
        if (abort.signal.aborted || generation !== this.epoch || this.closed) fail("NAVIGATION_TIMEOUT");
        if (!e || keyOf(e.conversation) !== keyOf(record.conversation) || e.foreground !== true || e.interactive !== true || e.mainView !== true || e.userIntentValid !== true || e.streamEpoch !== boundary.streamEpoch || e.visibleThroughSeq < boundary.throughSeq) fail("NAVIGATION_UNCONFIRMED");
        await this.store.acknowledge(record.conversation, boundary.streamEpoch, boundary.throughSeq);
        return { acknowledged: true };
      } catch (e) {
        const code = abort.signal.aborted ? "NAVIGATION_TIMEOUT" : e.code ?? "NAVIGATION_UNCONFIRMED";
        this.onError(code);
        fail(code);
      } finally {
        clearTimeout(timer);
        if (this.pending.get(requestId) === task) this.pending.delete(requestId);
      }
    })();
    task.promise = promise;
    this.pending.set(requestId, task);
    this.completed.set(requestId, promise);
    return promise;
  }
  dispose() {
    this.closed = true;
    this.epoch++;
    for (const p of this.pending.values()) p.abort.abort();
    this.pending.clear();
  }
};

// src/core/quiet.mjs
var minuteOf = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
function quietState(raw, now = /* @__PURE__ */ new Date()) {
  const settings = decodeSettings(raw), time = now.getTime(), minute = now.getHours() * 60 + now.getMinutes(), day = now.getDay();
  const start = minuteOf(settings.quietStart), end = minuteOf(settings.quietEnd), chosen = (d) => (settings.quietDays & 1 << d) !== 0;
  const scheduled = settings.quietScheduleEnabled && (start === end ? chosen(day) : start < end ? chosen(day) && minute >= start && minute < end : minute >= start ? chosen(day) : minute < end && chosen((day + 6) % 7));
  const temporary = settings.quietUntil > time;
  return {
    active: temporary || scheduled,
    reason: temporary ? "temporary" : scheduled ? "schedule" : null,
    temporaryUntil: temporary ? settings.quietUntil : null,
    scheduleEnabled: settings.quietScheduleEnabled,
    start: settings.quietStart,
    end: settings.quietEnd,
    days: settings.quietDays
  };
}
function quietDelay(raw, now = Date.now()) {
  const settings = decodeSettings(raw), until = settings.quietUntil - now;
  if (!settings.quietScheduleEnabled && until <= 0) return null;
  const minute = 6e4 - now % 6e4;
  return Math.max(1, Math.min(minute, until > 0 ? until : Infinity));
}

// src/core/center.mjs
var HISTORY_LIMIT = 500;
function centerPage(records, query = {}, revision = 0, { now = Date.now(), running = () => false } = {}) {
  const state = query.state ?? "unread", outcome = query.outcome ?? "all", period = query.period ?? "all", workspace = query.workspace ?? "all";
  const offset = Number(query.offset ?? 0), limit = Number(query.limit ?? 25);
  if (!["unread", "acknowledged", "retired", "all"].includes(state) || outcome !== "all" && !Object.hasOwn(OUTCOMES, outcome) || !["all", "today", "7d", "30d"].includes(period) || !safeInt(offset) || !safeInt(limit) || limit < 1 || limit > 50 || typeof workspace !== "string" || workspace.length > 256) fail("INVALID_REQUEST");
  if (query.revision != null && Number(query.revision) !== revision) fail("CENTER_SNAPSHOT_CHANGED");
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const since = period === "today" ? midnight.getTime() : period === "7d" ? now - 7 * 864e5 : period === "30d" ? now - 30 * 864e5 : -Infinity;
  const workspaceChoices = /* @__PURE__ */ new Map();
  const sorted = [...records].sort((a, b) => b.endedAt - a.endedAt || b.id.localeCompare(a.id));
  for (const r of sorted) if (!workspaceChoices.has(r.workspaceId ?? "")) workspaceChoices.set(r.workspaceId ?? "", r.workspaceTitle || "\u672A\u5206\u7EC4 / \u65E7\u8BB0\u5F55");
  const filtered = sorted.filter((r) => (state === "all" || r.readState === state) && (outcome === "all" || r.outcome === outcome) && r.endedAt >= since && (workspace === "all" || (r.workspaceId ?? "") === workspace));
  const items = filtered.slice(offset, offset + limit).map((r) => {
    const clean = validateFact(r);
    return {
      id: clean.id,
      sessionId: clean.conversation.sessionId,
      displayTitle: clean.displayTitle,
      endedAt: clean.endedAt,
      startedAt: clean.startedAt,
      durationMs: clean.durationMs,
      workspaceId: clean.workspaceId,
      workspaceTitle: clean.workspaceTitle,
      outcome: clean.outcome,
      readState: r.readState,
      silenced: clean.silenced,
      currentlyRunning: running(r.conversation) === true
    };
  });
  return {
    revision,
    offset,
    limit,
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
    items,
    historyLimit: HISTORY_LIMIT,
    workspaces: [...workspaceChoices].map(([id, title]) => ({ id, title }))
  };
}

// src/host/runtime.mjs
var Runtime = class {
  constructor(ctx, { store, bridge, now, platform = process.platform } = {}) {
    this.ctx = ctx;
    this.platform = platform;
    this.injectedStore = store;
    this.queue = new ReminderQueue({ now });
    this.nativeFactory = bridge;
    this.store = null;
    this.bridge = null;
    this.events = null;
    this.timer = null;
    this.closed = false;
    this.enabled = false;
    this.epoch = 0;
    this.error = null;
    this.listeners = /* @__PURE__ */ new Set();
    this.tasks = Promise.resolve();
    this.renderTasks = Promise.resolve();
    this.outbox = /* @__PURE__ */ new Map();
    this.eventError = null;
    this.lastNative = null;
    this.dark = false;
    this.capabilities = { initializing: true, events: false, popup: false, navigation: false, badge: false };
    this.blocks = [];
    this.groupQueued = 0;
    this.aggregateCount = null;
    this.readBaselines = /* @__PURE__ */ new Set();
    this.deliveryAttempts = /* @__PURE__ */ new Map();
    this.recoveryTimer = null;
    this.recoveryAttempt = 0;
    this.archived = new Set(ctx.get("workspaceRegistry")?.archivedSessionIds ?? []);
    this.sweepTimer = null;
    this.sweepCursor = 0;
    this.sweepTask = null;
    this.sweepAbort = new AbortController();
    this.settings = decodeSettings();
    this.quietActive = false;
    this.quietTimer = null;
    this.pendingCards = /* @__PURE__ */ new Set();
    this.runningRevision = 0;
    this.historyDirty = false;
    this.historyWork = null;
  }
  async start() {
    const profile = this.ctx.get("profileContext");
    if (!this.injectedStore && (!profile || !isAbsolute(profile.dir ?? "") || typeof profile.name !== "string")) fail("PROFILE_CONTEXT_UNAVAILABLE");
    this.profile = profile ?? { name: "fixture", dir: "" };
    this.store = this.injectedStore ?? new CompletionStore(new FileStorage(join2(profile.dir, "data", "dsh-finish-reminder", "state.json")));
    await this.store.load();
    if (this.store.data.records.filter((r) => r.readState !== "unread").length > HISTORY_LIMIT) await this.store.pruneHistory(/* @__PURE__ */ new Set(), HISTORY_LIMIT);
    this.clients = new ClientHub(this);
    this.navigation = new NavigationController({ adapter: this.clients, store: this.store, onError: (code) => {
      this.eventError = code;
      this.publish();
    } });
    this.capabilities.initializing = false;
    this.capabilities.events = !!this.ctx.get("agents")?.get;
    this.publish();
  }
  async setEnabled(value) {
    if (this.closed || value === this.enabled) return;
    this.enabled = value;
    const epoch = ++this.epoch;
    clearTimeout(this.timer);
    this.timer = null;
    this.events?.dispose();
    this.events = null;
    this.queue.disable();
    if (!value) {
      clearTimeout(this.recoveryTimer);
      clearTimeout(this.sweepTimer);
      clearTimeout(this.quietTimer);
      this.quietTimer = null;
      this.pendingCards.clear();
      this.sweepTimer = null;
      this.sweepAbort.abort();
      this.navigation?.dispose();
      this.clients?.invalidate();
      try {
        await this.bridge?.dispose();
      } catch {
      }
      this.bridge = null;
      this.capabilities.popup = false;
      this.capabilities.navigation = false;
      this.capabilities.badge = false;
      this.publish();
      return;
    }
    this.queue.enable();
    this.error = null;
    this.quietActive = quietState(this.settings).active;
    this.scheduleQuiet();
    this.sweepAbort = new AbortController();
    if (!this.capabilities.events) {
      this.setError("END_UNCONFIRMED");
      return;
    }
    if (this.platform !== "win32" && !this.nativeFactory) {
      this.setError("UNSUPPORTED_PLATFORM");
      return;
    }
    this.events = new EventAdapter({ agents: this.ctx.get("agents"), identity: (s) => this.identity(s), onFact: (f) => this.commit(f), onError: (code) => {
      if (epoch === this.epoch) {
        this.eventError = code;
        this.publish();
      }
    } });
    if (this.navigation?.closed) this.navigation = new NavigationController({ adapter: this.clients, store: this.store, onError: (code) => {
      this.eventError = code;
      this.publish();
    } });
    this.bridge = this.nativeFactory?.({ onEvent: (e) => this.nativeEvent(e, epoch), onError: (c) => {
      if (epoch === this.epoch && this.enabled) this.setError(c);
    } }) ?? new GroupBridge({ onEvent: (e) => this.nativeEvent(e, epoch), onError: (c) => {
      if (epoch === this.epoch && this.enabled) {
        this.setError(c);
        this.recover();
      }
    } });
    try {
      const snapshot = this.store.snapshot();
      const caps = await this.bridge.request(this.bridge.group ? "register" : "hello", this.bridge.group ? { sourceId: snapshot.sourceId, count: snapshot.count, revision: snapshot.revision, hostPid: process.pid, dark: this.dark, quiet: this.quietActive } : {});
      if (epoch !== this.epoch || !this.enabled) return;
      this.lastNative = caps;
      this.capabilities.popup = caps.version === VERSION && caps.popup === true;
      if (this.bridge.group) {
        this.capabilities.badge = caps.desktop === true && caps.badge === true;
        if (!caps.desktop) this.setError("DESKTOP_BRIDGE_UNAVAILABLE");
        this.recoveryAttempt = 0;
        await this.clients.rebindAll();
        await this.syncBaselines();
      }
      this.publish();
      this.scheduleSweep();
    } catch (e) {
      if (epoch === this.epoch) this.setError(e.code ?? "HELPER_EXITED");
    }
  }
  identity(session) {
    if (!this.store?.ready || !safeInt(session.header?.createdAt)) return null;
    const sourceId = this.store.data.sourceId;
    let title = "\u5BF9\u8BDD";
    try {
      title = this.ctx.get("sessionProjections")?.snapshot(session, ["title"])?.values?.title ?? title;
    } catch {
    }
    let workspaceId = null, workspaceTitle = "\u672A\u5206\u7EC4";
    try {
      const workspaces = this.ctx.get("workspaceRegistry")?.list?.() ?? [];
      const workspace = workspaces.find((w) => w.sessionIds?.includes(session.id)) ?? workspaces.find((w) => typeof w.path === "string" && typeof session.header?.cwd === "string" && win32.normalize(w.path).toLowerCase() === win32.normalize(session.header.cwd).toLowerCase());
      if (workspace) {
        workspaceId = String(workspace.id);
        workspaceTitle = cleanTitle(workspace.title);
      }
    } catch {
    }
    return {
      conversation: { desktopAppGroupId: "dsh-desktop", hostInstanceId: sourceId, profileId: this.profile.name, sessionId: session.id },
      streamEpoch: String(session.header.createdAt),
      displayTitle: cleanTitle(title),
      workspaceId,
      workspaceTitle
    };
  }
  accept(session, event) {
    if (this.enabled && !this.closed && !this.archived.has(session.id)) this.events?.accept(session, event);
  }
  commit(fact) {
    const epoch = this.epoch;
    const work = this.tasks.catch(() => {
    }).then(async () => {
      if (this.closed || !this.enabled || epoch !== this.epoch) return;
      try {
        await this.reconcileQuiet();
        if (this.closed || !this.enabled || epoch !== this.epoch) return;
        const result = await this.store.submit({ ...fact, silenced: this.quietActive });
        if (result.inserted) this.outbox.set(result.record.id, result.record);
        if (!this.enabled || epoch !== this.epoch) {
          this.outbox.clear();
          return;
        }
        await this.drainOutbox();
        this.publish();
        await this.render();
        this.scheduleSweep();
      } catch (e) {
        const record = this.store.data.records.find((r) => r.terminalEventSeq === fact.terminalEventSeq && r.streamEpoch === fact.streamEpoch && keyOf(r.conversation) === keyOf(fact.conversation));
        if (record) this.outbox.set(record.id, record);
        this.setError(e.code ?? "STATE_WRITE_FAILED");
      }
    });
    this.tasks = work;
    return work;
  }
  async drainOutbox() {
    for (const [id, record] of this.outbox) {
      if (this.bridge?.group) {
        if (this.bridge.closed) fail("HELPER_EXITED");
        const attempted = this.deliveryAttempts.get(id);
        if (attempted && attempted !== this.bridge.generation) {
          this.outbox.delete(id);
          this.deliveryAttempts.delete(id);
          this.eventError = "DISPLAY_DELIVERY_UNCONFIRMED";
          continue;
        }
        this.deliveryAttempts.set(id, this.bridge.generation);
        const result = await this.bridge.request("submit", { record, running: this.isRunning(record.conversation), runningRevision: this.runningRevision });
        if (result.queued !== false && !result.silenced) this.pendingCards.add(id);
        if (result.silenced) await this.store.markSilenced(id);
        this.readBaselines.add(id);
        this.deliveryAttempts.delete(id);
      } else if (!record.silenced && !this.quietActive) this.queue.enqueue(record);
      this.outbox.delete(id);
    }
  }
  async retryStorage() {
    await this.store.flush();
    if (this.enabled) {
      await this.drainOutbox();
      this.error = null;
      await this.render();
    } else this.outbox.clear();
    this.publish();
  }
  nativeEvent(event, epoch) {
    if (this.closed || !this.enabled || epoch !== this.epoch) return;
    if (this.bridge?.group) {
      if (event.kind === "cardRemoved") {
        this.pendingCards.delete(event.completionId);
        this.scheduleHistoryPrune();
        return;
      }
      if (event.kind === "click") {
        const record = this.store.data.records.find((r) => r.id === event.completionId);
        if (record) void this.navigateCompletion(record);
      } else if (event.kind === "queueStatus") {
        this.groupQueued = event.queued;
        this.aggregateCount = event.aggregateCount;
      } else if (event.kind === "badgeStatus") {
        this.capabilities.badge = event.supported === true;
        this.badgeError = event.code ?? null;
      } else if (event.kind === "fault") {
        this.setError(event.code);
        this.recover();
      }
      this.publish();
      return;
    }
    const token = { cardId: event.cardId, displayGeneration: event.displayGeneration };
    if (event.kind === "painted") this.queue.painted(token);
    else if (event.kind === "availability") this.queue.setAvailable(event.available);
    else if (event.kind === "hover") {
      if (this.queue.hover(token, event.paused === true)) void this.render();
    } else if (event.kind === "dismiss") this.queue.dismiss(token);
    else if (event.kind === "click") {
      const entry = this.queue.click(token);
      if (entry) {
        this.eventError = "DESKTOP_BRIDGE_UNAVAILABLE";
      }
    }
    void this.render();
    this.publish();
  }
  async navigateCompletion(record) {
    let ok = true, code = null;
    try {
      await this.navigation.open(record, randomUUID4());
    } catch (e) {
      ok = false;
      code = e?.code ?? "NAVIGATION_UNCONFIRMED";
    }
    try {
      await this.bridge?.request("clickDone", ok ? { completionId: record.id, ok: true } : { completionId: record.id, ok: false, code });
    } catch {
    }
    await this.render();
    this.clients?.publish();
    this.publish();
  }
  async openCenterRecord(id, clientId) {
    if (!this.enabled) fail("PLUGIN_DISABLED");
    const record = this.store?.data.records.find((r) => r.id === id);
    if (!record || record.readState === "retired") fail("TARGET_GONE");
    if (!this.clients?.clients.get(clientId)?.windowToken) fail("CLIENT_UNAVAILABLE");
    await this.navigation.open(record, randomUUID4(), { clientId });
    await this.render();
    this.publish();
    return { opened: true };
  }
  render() {
    const epoch = this.epoch;
    const work = this.renderTasks.catch(() => {
    }).then(async () => {
      if (this.closed || !this.enabled || epoch !== this.epoch || !this.bridge || !this.capabilities.popup) return;
      const protect = this.bridge.group ? this.pendingCards : new Set(this.queue.entries.map((e) => e.record.id));
      if (this.store.data.records.filter((r) => r.readState !== "unread").length > HISTORY_LIMIT) await this.store.pruneHistory(protect, HISTORY_LIMIT);
      if (this.bridge.group) {
        const snapshot = this.store.snapshot();
        try {
          const result = await this.bridge.request("snapshot", { count: snapshot.count, revision: snapshot.revision, dark: this.dark, quiet: this.quietActive });
          this.groupQueued = result.queued ?? this.groupQueued;
          this.aggregateCount = result.count;
          await this.syncBaselines();
          this.clients?.publish();
        } catch (e) {
          this.setError(e.code ?? "HELPER_EXITED");
        }
        return;
      }
      clearTimeout(this.timer);
      this.timer = null;
      const view = this.queue.view();
      try {
        await this.bridge.request("syncView", { front: view.front, previews: view.previews, queued: view.queued, available: view.available, dark: this.dark });
      } catch (e) {
        if (epoch !== this.epoch) return;
        if (e.code === "DISPLAY_UNAVAILABLE") this.queue.setAvailable(false);
        this.setError(e.code ?? "HELPER_EXITED");
        return;
      }
      if (this.queue.front?.state === "front" && epoch === this.epoch) {
        const token = this.queue.token();
        this.timer = setTimeout(() => {
          this.queue.due(token);
          void this.render();
          this.publish();
        }, Math.ceil(this.queue.remaining()));
      }
    });
    this.renderTasks = work.catch((e) => this.setError(e.code ?? "STATE_WRITE_FAILED"));
    return this.renderTasks;
  }
  async retire(sessionId) {
    if (!this.store?.ready) return;
    const records = [...new Map(this.store.data.records.filter((r) => r.conversation.sessionId === sessionId).map((r) => [keyOf(r.conversation), r])).values()];
    for (const record of records) {
      await this.store.retire(record.conversation);
      if (this.bridge?.group) await this.bridge.request("retire", { conversation: record.conversation });
      else this.queue.retire(keyOf(record.conversation), keyOf);
    }
    for (const [id, r] of this.outbox) if (r.conversation.sessionId === sessionId) this.outbox.delete(id);
    this.events?.forget(sessionId);
    await this.render();
    this.publish();
  }
  updateTheme(dark) {
    if (typeof dark !== "boolean") fail("INVALID_REQUEST");
    if (this.dark !== dark) {
      this.dark = dark;
      void this.render();
    }
  }
  async configure(settings) {
    this.settings = decodeSettings(settings);
    await this.setEnabled(this.settings.enabled);
    await this.reconcileQuiet();
  }
  async reconcileQuiet() {
    const next = quietState(this.settings).active, changed = next !== this.quietActive;
    this.quietActive = next;
    if (changed && this.enabled) {
      if (!this.bridge?.group && next) this.queue.removeWhere(() => true);
      await this.render();
      this.publish();
    }
    this.scheduleQuiet();
  }
  scheduleQuiet() {
    clearTimeout(this.quietTimer);
    this.quietTimer = null;
    if (!this.enabled || this.closed) return;
    const delay = quietDelay(this.settings);
    if (delay === null) return;
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      void this.reconcileQuiet().catch((e) => this.setError(e.code ?? "CONFIG_UNAVAILABLE"));
    }, delay);
    this.quietTimer.unref?.();
  }
  isRunning(conversation) {
    const agent = this.ctx.get("agents")?.get?.(conversation.sessionId);
    return agent?.status === "running" && agent.session?.header?.origin !== "subagent";
  }
  taskStatus(agent) {
    if (this.closed || !this.enabled || !agent?.session || agent.session.header?.origin === "subagent") return;
    const identity = this.identity(agent.session);
    if (!identity) return;
    const revision = ++this.runningRevision;
    if (this.bridge?.group) void this.bridge.request("running", { conversation: identity.conversation, running: agent.status === "running", revision }).catch((e) => {
      this.eventError = e.code ?? "CONTEXT_UNAVAILABLE";
    });
  }
  center(query = {}) {
    if (!this.store?.ready) fail("STATE_UNAVAILABLE");
    return {
      ...centerPage(this.store.data.records, query, this.store.data.revision, { running: (c) => this.isRunning(c) }),
      enabled: this.enabled,
      count: this.store.snapshot().count,
      quiet: quietState(this.settings),
      durable: !this.store.dirty
    };
  }
  scheduleHistoryPrune() {
    if (this.closed || !this.enabled) return;
    this.historyDirty = true;
    if (this.historyWork) return;
    const epoch = this.epoch;
    this.historyWork = Promise.resolve().then(async () => {
      while (this.historyDirty && !this.closed && this.enabled && epoch === this.epoch) {
        this.historyDirty = false;
        await this.render();
      }
    }).finally(() => {
      this.historyWork = null;
      if (this.historyDirty && !this.closed && this.enabled) this.scheduleHistoryPrune();
    });
  }
  scheduleSweep() {
    if (this.sweepTimer || this.closed || !this.enabled || !this.ctx.get("sessionPersistence")?.stat || !this.store.data.records.some((r) => r.readState === "unread")) return;
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      this.sweepTask = this.sweepTargets().catch((e) => this.setError(e.code ?? "STATE_WRITE_FAILED")).finally(() => {
        this.sweepTask = null;
        this.scheduleSweep();
      });
    }, 3e4);
    this.sweepTimer.unref?.();
  }
  async sweepTargets() {
    const persistence = this.ctx.get("sessionPersistence");
    if (!persistence?.stat || this.sweepAbort.signal.aborted) return;
    const ids = [...new Set(this.store.data.records.filter((r) => r.readState === "unread").map((r) => r.conversation.sessionId))];
    if (!ids.length) return;
    for (let i = 0; i < Math.min(16, ids.length); i++) {
      if (this.sweepAbort.signal.aborted) return;
      const id = ids[this.sweepCursor++ % ids.length];
      if (this.archived.has(id)) {
        await this.retire(id);
        continue;
      }
      if (this.ctx.get("sessions")?.get?.(id)) continue;
      try {
        const metadata = await persistence.stat(id, { signal: AbortSignal.any([this.sweepAbort.signal, AbortSignal.timeout(1500)]) });
        if (this.sweepAbort.signal.aborted) return;
        if (metadata === void 0) await this.retire(id);
      } catch (e) {
        if (this.sweepAbort.signal.aborted) return;
        this.eventError = e.code === "EACCES" || e.code === "EPERM" ? "ACCESS_DENIED" : "TARGET_STATE_UNCONFIRMED";
      }
    }
  }
  async syncBaselines() {
    if (!this.bridge?.group) return;
    const unread = new Set(this.store.data.records.filter((r) => r.readState === "unread").map((r) => r.id));
    const add = [...unread].filter((id) => !this.readBaselines.has(id)), remove = [...this.readBaselines].filter((id) => !unread.has(id));
    for (let i = 0; i < add.length; i += 16) {
      const ids = add.slice(i, i + 16);
      await this.bridge.request("observeCompletion", { completionIds: ids });
      for (const id of ids) this.readBaselines.add(id);
    }
    for (let i = 0; i < remove.length; i += 16) {
      const ids = remove.slice(i, i + 16);
      await this.bridge.request("forgetCompletion", { completionIds: ids });
      for (const id of ids) this.readBaselines.delete(id);
    }
  }
  recover() {
    if (this.closed || !this.enabled || this.nativeFactory || this.recoveryTimer || this.recoveryAttempt >= 6) return;
    const epoch = this.epoch, delay = Math.min(4e3, 250 * 2 ** this.recoveryAttempt++);
    this.recoveryTimer = setTimeout(async () => {
      this.recoveryTimer = null;
      if (this.closed || !this.enabled || epoch !== this.epoch) return;
      try {
        await this.bridge?.dispose();
        this.readBaselines.clear();
        this.pendingCards.clear();
        this.clients?.invalidate();
        this.bridge = new GroupBridge({ onEvent: (e) => this.nativeEvent(e, epoch), onError: (c) => {
          if (epoch === this.epoch && this.enabled) {
            this.setError(c);
            this.recover();
          }
        } });
        const s = this.store.snapshot(), caps = await this.bridge.request("register", { sourceId: s.sourceId, count: s.count, revision: s.revision, hostPid: process.pid, dark: this.dark, quiet: this.quietActive });
        this.capabilities.popup = caps.popup === true;
        this.capabilities.badge = caps.desktop === true && caps.badge === true;
        this.recoveryAttempt = 0;
        this.error = null;
        await this.clients.rebindAll();
        await this.syncBaselines();
        await this.drainOutbox();
        await this.render();
        this.publish();
      } catch (e) {
        this.setError(e.code ?? "HELPER_EXITED");
        this.recover();
      }
    }, delay);
    this.recoveryTimer.unref?.();
  }
  status() {
    const snapshot = this.store?.ready ? this.store.snapshot() : null;
    const capabilities = { ...this.capabilities, error: this.error ?? snapshot?.error };
    return {
      version: VERSION,
      enabled: this.enabled,
      status: capabilityStatus(capabilities),
      capabilities,
      count: snapshot?.count ?? null,
      durable: snapshot?.durable ?? false,
      queued: this.bridge?.group ? this.groupQueued : this.queue.entries.length,
      aggregateCount: this.aggregateCount,
      revision: snapshot?.revision ?? 0,
      error: this.error,
      eventError: this.eventError,
      blockers: this.blocks,
      sourceTag: snapshot ? createHash3("sha256").update(snapshot.sourceId).digest("hex").slice(0, 12) : null,
      badgeError: this.badgeError ?? null,
      navigationError: this.navigationError ?? null,
      quiet: quietState(this.settings),
      acceptance: "USER_PENDING"
    };
  }
  publish() {
    for (const fn of this.listeners) fn();
    this.clients?.publish();
  }
  setError(code) {
    this.error = /^[A-Z_]{1,64}$/.test(code) ? code : "INTERNAL_ERROR";
    this.publish();
  }
  async dispose() {
    if (this.closed) return;
    this.enabled = false;
    this.closed = true;
    this.epoch++;
    this.events?.dispose();
    clearTimeout(this.timer);
    clearTimeout(this.recoveryTimer);
    clearTimeout(this.quietTimer);
    clearTimeout(this.sweepTimer);
    this.sweepAbort.abort();
    this.timer = null;
    this.queue.disable();
    this.navigation?.dispose();
    this.clients?.dispose();
    await this.tasks.catch(() => {
    });
    await this.renderTasks.catch(() => {
    });
    try {
      await this.bridge?.dispose();
    } catch {
    }
    await this.store?.chain.catch(() => {
    });
    this.listeners.clear();
    await this.sweepTask?.catch(() => {
    });
    await this.historyWork?.catch(() => {
    });
  }
};

// src/host/index.mjs
var name = "dsh-finish-reminder";
var inject = ["agents", "sessions", "profileContext", "connection"];
var Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  diagnosticsEnabled: z.boolean().default(false).volatile(),
  quietUntil: z.number().min(0).max(864e13).default(0).volatile(),
  quietScheduleEnabled: z.boolean().default(false).volatile(),
  quietStart: z.string().default("22:00").volatile(),
  quietEnd: z.string().default("08:00").volatile(),
  quietDays: z.number().min(0).max(127).step(1).default(127).volatile()
});
var response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
async function body(request) {
  if (request.headers.get("content-type") !== "application/json" || !request.body) throw Object.assign(new Error("INVALID_REQUEST"), { code: "INVALID_REQUEST" });
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let text = "", size = 0;
  try {
    for (; ; ) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 32768) {
        await reader.cancel();
        throw new Error("REQUEST_TOO_LARGE");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}
async function apply(ctx, raw = {}) {
  const runtime = new Runtime(ctx);
  let disposed = false;
  let configuration = Promise.resolve();
  ctx.effect(() => async () => {
    disposed = true;
    await configuration.catch(() => {
    });
    await runtime.dispose();
  });
  ctx.on("session/event", (session, event) => runtime.accept(session, event), { global: true });
  ctx.on("agent/inbox/claimed", (payload) => {
    if (!runtime.archived.has(payload?.agent?.id)) runtime.events?.claim(payload);
  }, { global: true });
  ctx.on("session/disposed", (session) => runtime.events?.forget(session.id), { global: true });
  ctx.on("agent/status", ({ agent }) => runtime.taskStatus(agent), { global: true });
  try {
    await runtime.start();
  } catch (e) {
    runtime.setError(e.code ?? "STATE_UNAVAILABLE");
  }
  const reconcile = () => {
    configuration = configuration.catch(() => {
    }).then(async () => {
      if (disposed) return;
      try {
        const settings = decodeSettings(raw);
        if (runtime.store?.ready) await runtime.configure(settings);
      } catch (e) {
        runtime.setError(e.code ?? "CONFIG_UNAVAILABLE");
        await runtime.setEnabled(false);
      }
    });
    return configuration;
  };
  await reconcile();
  ctx.on("loader/volatile-update", reconcile);
  const connection = ctx.get("connection");
  const post = (path, callback) => ctx.effect(() => connection.fetch.register({ path: "/api/dsh-finish-reminder/" + path, methods: ["POST"], requestBody: "streaming", fetch: async (request) => {
    try {
      return response(await callback(await body(request)));
    } catch (e) {
      return response({ error: /^[A-Z_]+$/.test(e.code ?? "") ? e.code : "INVALID_REQUEST" }, 400);
    }
  } }));
  post("client", (data) => runtime.clients.update(data));
  post("client-close", (data) => {
    runtime.clients.remove(data.clientId);
    return { closed: true };
  });
  post("navigation-result", (data) => runtime.clients.navigationResult(data));
  post("read", (data) => runtime.clients.manualRead(data));
  post("retry-native", () => {
    runtime.recoveryAttempt = 0;
    runtime.recover();
    return { requested: true };
  });
  post("notifications/open", (data) => runtime.openCenterRecord(data.completionId, data.clientId));
  ctx.effect(() => connection.fetch.register({ path: "/api/dsh-finish-reminder/notifications", methods: ["GET"], requestBody: "buffered", fetch: (request) => {
    try {
      return response(runtime.center(Object.fromEntries(new URL(request.url).searchParams)));
    } catch (e) {
      return response({ error: e.code ?? "INVALID_REQUEST" }, e.code === "CENTER_SNAPSHOT_CHANGED" ? 409 : 400);
    }
  } }));
  ctx.effect(() => connection.fetch.register({ path: "/api/dsh-finish-reminder/events", methods: ["GET"], requestBody: "buffered", fetch: (request) => {
    try {
      return new Response(runtime.clients.stream(new URL(request.url).searchParams.get("clientId"), request.signal), { headers: { "content-type": "text/event-stream", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    } catch {
      return response({ error: "ACCESS_DENIED" }, 403);
    }
  } }));
  ctx.on("domain/changed", (change) => {
    if (change?.domain === "workspace" && change.table === "" && change.operation === "put" && Array.isArray(change.value?.archivedSessionIds)) {
      const next = new Set(change.value.archivedSessionIds), previous = runtime.archived;
      runtime.archived = next;
      for (const id of next) if (!previous.has(id)) void runtime.retire(id).catch((e) => runtime.setError(e.code ?? "STATE_WRITE_FAILED"));
    }
  }, { global: true });
  ctx.effect(() => connection.fetch.register({ path: "/api/dsh-finish-reminder/status", methods: ["GET"], requestBody: "buffered", fetch: () => response(runtime.status()) }));
  ctx.effect(() => connection.fetch.register({ path: "/api/dsh-finish-reminder/theme", methods: ["POST"], requestBody: "streaming", fetch: async (request) => {
    if (request.headers.get("content-type") !== "application/json" || !request.body) return response({ error: "INVALID_REQUEST" }, 400);
    const reader = request.body.getReader();
    let text = "", bytes = 0;
    try {
      for (; ; ) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 128) {
          await reader.cancel();
          return response({ error: "INVALID_REQUEST" }, 413);
        }
        text += new TextDecoder().decode(part.value);
      }
      const data = JSON.parse(text);
      runtime.updateTheme(data.dark);
      return response({ ok: true });
    } catch {
      return response({ error: "INVALID_REQUEST" }, 400);
    } finally {
      reader.releaseLock();
    }
  } }));
  ctx.effect(() => connection.fetch.register({ path: "/api/dsh-finish-reminder/retry-storage", methods: ["POST"], requestBody: "buffered", fetch: async (request) => {
    if (request.headers.get("content-type") !== "application/json") return response({ error: "INVALID_REQUEST" }, 400);
    try {
      await runtime.retryStorage();
      return response(runtime.status());
    } catch (e) {
      return response({ error: e.code ?? "STATE_WRITE_FAILED" }, 503);
    }
  } }));
}
export {
  Config,
  apply,
  inject,
  name
};
