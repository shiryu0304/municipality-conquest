// Run with: node --test tests/import-safety.test.cjs
// The real application runs against fake DOM, storage, files and network only.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = readFileSync(path.join(root, "app.js"), "utf8");
const html = readFileSync(path.join(root, "index.html"), "utf8");
const storageKey = "municipality-conquest-records-v1";
const beforeImportKey = "municipality-conquest-before-import-v1";
const originalRecords = {
  "131016": { status: "visited", date: "2025-01-02", memo: "Sample municipality" },
  "700001": { status: "visited", date: "2026-02-03", memo: "Outside the sample list" }
};
const originalRaw = JSON.stringify(originalRecords);
const nationalData = [
  { lgcode: "131016", pref: "東京都", city: "千代田区" },
  ...Array.from({ length: 999 }, (_, index) => ({
    lgcode: String(700000 + index), pref: "北海道", city: `テスト${index}市`
  }))
];
const importedRecords = {
  "700002": { status: "visited", date: "2026-03-04", memo: "Imported visit" },
  "700003": { status: "want", date: "", memo: "Imported wish" }
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Allow initialization's fetch/json promise chain (including map failure) to settle.
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = data => ({ ok: true, json: async () => data });

class Element {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.style = {};
    this.attributes = {};
    this.children = [];
    this.listeners = new Map();
    this.classList = { add() {}, remove() {} };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  add(child) { this.append(child); }
  remove() {}
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  async dispatch(name) {
    for (const listener of this.listeners.get(name) || []) {
      await listener({ target: this, preventDefault() {} });
    }
  }
  click() { return this.dispatch("click"); }
}

function createApp({
  fetchList, initialRaw = originalRaw, confirm = true, mapFailure = false,
  initialBackupRaw = null, failSetItemFor = null
} = {}) {
  const elements = new Map();
  for (const match of html.matchAll(/<\w+\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element();
    element.disabled = /\sdisabled(?:\s|>|=)/.test(match[0]);
    for (const attribute of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) {
      element.setAttribute(attribute[1], attribute[2]);
    }
    elements.set(match[1], element);
  }
  elements.get("statusFilter").value = "all";
  const storage = new Map([[storageKey, initialRaw]]);
  if (initialBackupRaw !== null) storage.set(beforeImportKey, initialBackupRaw);
  const writes = [];
  const alerts = [];
  const confirmations = [];
  const downloads = [];
  const fetches = [];
  const fakeLeaflet = {
    map: () => ({ setView() { return this; } }),
    tileLayer: () => ({ addTo() {} })
  };
  const context = vm.createContext({
    document: {
      getElementById: id => elements.get(id) || null,
      createElement: () => new Element(),
      body: new Element()
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        if (key === failSetItemFor) throw new Error("Simulated storage full");
        writes.push({ key, value });
        storage.set(key, value);
      }
    },
    fetch: async url => {
      fetches.push(url);
      if (fetches.length === 1) return fetchList ? fetchList() : response(nationalData);
      throw new Error("Simulated unavailable map data");
    },
    window: mapFailure ? { L: fakeLeaflet } : {},
    L: fakeLeaflet,
    Option: function(text, value) { return Object.assign(new Element(), { textContent: text, value }); },
    Blob,
    URL: {
      createObjectURL(blob) { downloads.push(blob); return `blob:test-${downloads.length}`; },
      revokeObjectURL() {}
    },
    alert: message => alerts.push(message),
    confirm: message => { confirmations.push(message); return confirm; },
    console: { error() {}, warn() {} },
    setTimeout: () => 1,
    clearTimeout() {}
  });
  vm.runInContext(source, context, { filename: "app.js" });
  return {
    elements, writes, alerts, confirmations, fetches,
    stored: () => storage.get(storageKey),
    savedSnapshot: () => storage.get(beforeImportKey) ?? null,
    async restore() { await elements.get("restoreBeforeImportButton").dispatch("click"); },
    async importJSON(data) {
      let reads = 0;
      const input = elements.get("importInput");
      input.files = [{ text: async () => { reads += 1; return JSON.stringify(data); } }];
      input.value = "C:\\fakepath\\backup.json";
      // Deliberately dispatch even when disabled: the handler must defend itself.
      await input.dispatch("change");
      return reads;
    },
    async exportJSON() {
      await elements.get("exportButton").dispatch("click");
      return JSON.parse(await downloads.at(-1).text());
    }
  };
}

function assertAvailability(app, ready) {
  assert.equal(app.elements.get("importInput").disabled, !ready);
  assert.equal(app.elements.get("importLabel").getAttribute("aria-disabled"), String(!ready));
  assert.ok(app.elements.get("importStatus").textContent.length > 0);
}

async function assertBlockedAndPreserved(app) {
  assertAvailability(app, false);
  assert.equal(await app.importJSON({ records: importedRecords }), 0, "must not read the file");
  assert.equal(app.confirmations.length, 0, "must not offer replacement");
  assert.equal(app.alerts.length, 1);
  assert.equal(app.elements.get("importInput").value, "");
  assert.equal(app.stored(), originalRaw, "stored bytes must be unchanged");
  assert.equal(app.writes.length, 0);
  const backup = await app.exportJSON();
  assert.deepEqual(backup.records, originalRecords, "export must retain records outside the sample list");
  assert.equal(backup.app, "municipality-conquest");
  assert.equal(backup.version, 1);
}

test("HTML disables import before JavaScript runs and associates its explanation", () => {
  const input = html.match(/<input\b[^>]*\bid="importInput"[^>]*>/)?.[0];
  assert.ok(input);
  assert.match(input, /\sdisabled(?:\s|>|=)/);
  assert.match(input, /aria-describedby="importStatus"/);
  assert.match(html, /<label\b[^>]*\bid="importLabel"[^>]*\baria-disabled="true"/);
  assert.match(html, /<p\b[^>]*\bid="importStatus"[^>]*\brole="status"/);
});

test("pending municipality request blocks forced import and preserves export", async () => {
  const request = deferred();
  const app = createApp({ fetchList: () => request.promise });
  await assertBlockedAndPreserved(app);
});

test("pending response body stays blocked until the full list is validated", async () => {
  const body = deferred();
  const app = createApp({ fetchList: () => ({ ok: true, json: () => body.promise }) });
  await settle();
  await assertBlockedAndPreserved(app);
  body.resolve(nationalData);
  await settle();
  assertAvailability(app, true);
  assert.equal(app.writes.length, 0);
});

const loadFailures = [
  ["network rejection", () => Promise.reject(new Error("Offline"))],
  ["HTTP error", () => ({ ok: false, status: 503, json: async () => nationalData })],
  ["invalid JSON", () => ({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } })],
  ["non-array data", () => response({ municipalities: nationalData })],
  ["too few municipalities", () => response(nationalData.slice(0, 999))],
  ["duplicates leaving fewer than 1000 unique municipalities", () => response([...nationalData.slice(0, 999), nationalData[0]])],
  ["invalid rows leaving fewer than 1000 municipalities", () => response([...nationalData.slice(0, 999), { city: "Missing code市", pref: "北海道" }])]
];

for (const [name, fetchList] of loadFailures) {
  test(`${name} blocks forced import without losing saved records`, async () => {
    const app = createApp({ fetchList });
    await settle();
    assert.equal(app.elements.get("dataBadge").textContent, "サンプルデータ");
    await assertBlockedAndPreserved(app);
  });
}

for (const format of ["wrapped backup", "records-only backup"]) {
  test(`successful list load allows ${format} and keeps replacement behavior`, async () => {
    const app = createApp();
    await settle();
    assertAvailability(app, true);
    assert.equal(app.writes.length, 0);
    const data = format === "wrapped backup"
      ? { app: "municipality-conquest", version: 1, records: importedRecords }
      : importedRecords;
    assert.equal(await app.importJSON(data), 1);
    assert.equal(app.alerts.length, 0);
    assert.equal(app.confirmations.length, 1);
    assert.match(app.confirmations[0], /2 件/);
    assert.equal(app.writes.length, 2);
    assert.equal(app.writes[0].key, beforeImportKey, "snapshot must be saved before replacement");
    assert.equal(app.writes[1].key, storageKey);
    assert.equal(JSON.parse(app.savedSnapshot()).recordsRaw, originalRaw);
    assert.deepEqual(JSON.parse(app.stored()), importedRecords);
    assert.equal(app.elements.get("importInput").value, "");
    assert.deepEqual((await app.exportJSON()).records, importedRecords);
  });
}

test("cancelling confirmed import leaves saved records intact", async () => {
  const app = createApp({ confirm: false });
  await settle();
  assert.equal(await app.importJSON({ records: importedRecords }), 1);
  assert.equal(app.confirmations.length, 1);
  assert.equal(app.alerts.length, 0);
  assert.equal(app.writes.length, 0);
  assert.equal(app.stored(), originalRaw);
  assert.equal(app.elements.get("importInput").value, "");
  assert.deepEqual((await app.exportJSON()).records, originalRecords);
});

test("a fresh page can recover from list failure using the unchanged storage", async () => {
  const failed = createApp({ fetchList: () => Promise.reject(new Error("Offline")) });
  await settle();
  await assertBlockedAndPreserved(failed);
  const reloaded = createApp({ initialRaw: failed.stored() });
  await settle();
  assertAvailability(reloaded, true);
  assert.deepEqual((await reloaded.exportJSON()).records, originalRecords);
  await reloaded.importJSON({ records: importedRecords });
  assert.deepEqual(JSON.parse(reloaded.stored()), importedRecords);
});

test("map data failure does not block import when the municipality list succeeded", async () => {
  const app = createApp({ mapFailure: true });
  await settle();
  assert.equal(app.fetches.length, 2);
  assert.equal(app.elements.get("mapBadge").textContent, "地図データの読み込み失敗");
  assertAvailability(app, true);
  await app.importJSON({ records: importedRecords });
  assert.equal(app.alerts.length, 0);
  assert.deepEqual(JSON.parse(app.stored()), importedRecords);
});

// 安全強化：不正なファイルにより現在の記録が消えないことを確認する。
const rejectedBackups = [
  ["empty backup", { app: "municipality-conquest", version: 1, records: {} }],
  ["unknown municipality codes", { records: { "999999": { status: "visited", date: "", memo: "Unknown code" } } }],
  ["mixed known and unknown municipality codes", { records: {
    ...importedRecords, "999999": { status: "visited", date: "", memo: "Unknown code" }
  } }],
  ["invalid record status mixed with valid records", { records: {
    ...importedRecords, "700004": { status: "invalid", date: "", memo: "Wrong status" }
  } }]
];

for (const [name, backup] of rejectedBackups) {
  test(`${name} must not replace existing records`, async () => {
    const app = createApp();
    await settle();
    assertAvailability(app, true);
    assert.equal(await app.importJSON(backup), 1);
    assert.equal(app.confirmations.length, 0, "unsafe backup must not offer replacement");
    assert.equal(app.alerts.length, 1, "must show a warning");
    assert.equal(app.writes.length, 0, "must not write to storage");
    assert.equal(app.stored(), originalRaw, "saved records must remain untouched");
    assert.deepEqual((await app.exportJSON()).records, originalRecords);
  });
}

// 追加テスト：読み込み直前の自動保存と復元の安全性。
test("restore button starts disabled and is enabled only after a valid import", async () => {
  const app = createApp();
  await settle();
  assert.equal(app.elements.get("restoreBeforeImportButton").disabled, true);
  assert.equal(app.savedSnapshot(), null);
  await app.importJSON({ records: importedRecords });
  assert.equal(app.elements.get("restoreBeforeImportButton").disabled, false);
  assert.equal(JSON.parse(app.savedSnapshot()).recordsRaw, originalRaw);
});

test("import automatically saves exact original data, then restore recovers it", async () => {
  const app = createApp();
  await settle();
  await app.importJSON({ records: importedRecords });
  assert.deepEqual(JSON.parse(app.stored()), importedRecords);
  assert.match(app.elements.get("restoreBeforeImportStatus").textContent, /2件/);
  await app.restore();
  assert.equal(app.stored(), originalRaw, "restored storage must exactly match old data");
  assert.deepEqual((await app.exportJSON()).records, originalRecords);
  assert.equal(app.confirmations.length, 2);
  assert.match(app.confirmations[1], /追加・変更/);
});

test("the saved pre-import data survives a page reload", async () => {
  const first = createApp();
  await settle();
  await first.importJSON({ records: importedRecords });
  const second = createApp({ initialRaw: first.stored(), initialBackupRaw: first.savedSnapshot() });
  await settle();
  assert.equal(second.elements.get("restoreBeforeImportButton").disabled, false);
  await second.restore();
  assert.equal(second.stored(), originalRaw);
});

test("no snapshot is written if the user cancels the import", async () => {
  const app = createApp({ confirm: false });
  await settle();
  await app.importJSON({ records: importedRecords });
  assert.equal(app.savedSnapshot(), null);
  assert.equal(app.stored(), originalRaw);
  assert.equal(app.elements.get("restoreBeforeImportButton").disabled, true);
});

test("a failure to save the safety copy blocks import without changing records", async () => {
  const app = createApp({ failSetItemFor: beforeImportKey });
  await settle();
  await app.importJSON({ records: importedRecords });
  assert.equal(app.stored(), originalRaw);
  assert.equal(app.savedSnapshot(), null);
  assert.equal(app.writes.length, 0);
  assert.equal(app.alerts.length, 1);
  assert.match(app.alerts[0], /自動保存できなかった/);
});

test("a failure to save imported records rolls back in-memory records", async () => {
  const app = createApp({ failSetItemFor: storageKey });
  await settle();
  await app.importJSON({ records: importedRecords });
  assert.equal(app.stored(), originalRaw);
  assert.equal(JSON.parse(app.savedSnapshot()).recordsRaw, originalRaw);
  assert.deepEqual((await app.exportJSON()).records, originalRecords);
  assert.equal(app.alerts.length, 1);
});

test("a cancelled restore does not alter imported records", async () => {
  // Confirmation returns false for the restore, but import happened in a previous session.
  const first = createApp();
  await settle();
  await first.importJSON({ records: importedRecords });
  const second = createApp({
    initialRaw: first.stored(), initialBackupRaw: first.savedSnapshot(), confirm: false
  });
  await settle();
  await second.restore();
  assert.deepEqual(JSON.parse(second.stored()), importedRecords);
  assert.equal(second.writes.length, 0);
});

test("invalid/corrupted restore data cannot overwrite records", async () => {
  const app = createApp({
    initialRaw: JSON.stringify(importedRecords),
    initialBackupRaw: JSON.stringify({ version: 1, savedAt: new Date().toISOString(), recordsRaw: "not-json" })
  });
  await settle();
  assert.equal(app.elements.get("restoreBeforeImportButton").disabled, true);
  await app.restore();
  assert.deepEqual(JSON.parse(app.stored()), importedRecords);
  assert.equal(app.writes.length, 0);
  assert.equal(app.alerts.length, 1);
});

test("the next successful import updates the safety copy to the latest pre-import records", async () => {
  const app = createApp();
  await settle();
  await app.importJSON({ records: importedRecords });
  const anotherRecord = { "700004": { status: "visited", date: "2026-04-01", memo: "New" } };
  await app.importJSON({ records: anotherRecord });
  assert.deepEqual(JSON.parse(JSON.parse(app.savedSnapshot()).recordsRaw), importedRecords);
  await app.restore();
  assert.deepEqual(JSON.parse(app.stored()), importedRecords);
});

test("restore refuses to replace records if the browser cannot save", async () => {
  const first = createApp();
  await settle();
  await first.importJSON({ records: importedRecords });
  const second = createApp({
    initialRaw: first.stored(), initialBackupRaw: first.savedSnapshot(), failSetItemFor: storageKey
  });
  await settle();
  await second.restore();
  assert.deepEqual(JSON.parse(second.stored()), importedRecords);
  assert.deepEqual((await second.exportJSON()).records, importedRecords);
  assert.equal(second.alerts.length, 1);
});
