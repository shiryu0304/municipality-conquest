/*
 * 全国市町村制覇 v0.5
 * この試作品はサンプル自治体のみを収録しています。
 * 本格運用前に data/municipalities.json を全国の自治体データに置き換えてください。
 */
const SAMPLE_MUNICIPALITIES = [
  { code: "131016", prefecture: "東京都", name: "千代田区", type: "特別区" },
  { code: "131041", prefecture: "東京都", name: "新宿区", type: "特別区" },
  { code: "271004", prefecture: "大阪府", name: "大阪市", type: "市" },
  { code: "272117", prefecture: "大阪府", name: "茨木市", type: "市" },
  { code: "272132", prefecture: "大阪府", name: "八尾市", type: "市" },
  { code: "282014", prefecture: "兵庫県", name: "姫路市", type: "市" },
  { code: "312011", prefecture: "鳥取県", name: "鳥取市", type: "市" },
  { code: "312029", prefecture: "鳥取県", name: "米子市", type: "市" },
  { code: "332038", prefecture: "岡山県", name: "津山市", type: "市" },
  { code: "401005", prefecture: "福岡県", name: "北九州市", type: "市" }
];

const STORAGE_KEY = "municipality-conquest-records-v1";
let municipalities = [...SAMPLE_MUNICIPALITIES];
let municipalitiesReady = false;
let records = loadRecords();
let toastTimer;
let map;
let municipalityGeoLayer;
const municipalityByMapCode = new Map();

const $ = (id) => document.getElementById(id);
const prefectureFilter = $("prefectureFilter");
const searchInput = $("searchInput");
const statusFilter = $("statusFilter");
const municipalityList = $("municipalityList");
const dialog = $("recordDialog");

function setImportAvailability(ready, message) {
  municipalitiesReady = ready;
  $("importInput").disabled = !ready;
  $("importLabel").setAttribute("aria-disabled", String(!ready));
  $("importStatus").textContent = message;
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error("保存データを読み込めませんでした。", error);
    return {};
  }
}

function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    $("saveStatus").textContent = `この端末に保存済み · 最終保存 ${new Date().toLocaleString("ja-JP")}`;
  } catch (error) {
    $("saveStatus").textContent = "保存できませんでした。JSONバックアップをお試しください。";
    showToast("保存に失敗しました。");
  }
}

function getRecord(code) {
  return records[code] || { status: "unvisited", date: "", memo: "" };
}

function getStatusLabel(status) {
  return ({ visited: "訪問済み", want: "行きたい", unvisited: "未訪問" })[status] || "未訪問";
}

function getFilteredMunicipalities() {
  const pref = prefectureFilter.value;
  const query = searchInput.value.trim().toLocaleLowerCase("ja");
  const status = statusFilter.value;

  return municipalities.filter((m) => {
    const record = getRecord(m.code);
    const matchesPref = !pref || m.prefecture === pref;
    const matchesQuery = !query || `${m.name} ${m.prefecture} ${m.code}`.toLocaleLowerCase("ja").includes(query);
    const matchesStatus = status === "all" || record.status === status;
    return matchesPref && matchesQuery && matchesStatus;
  });
}

function renderStats() {
  const total = municipalities.length;
  const visited = municipalities.filter((m) => getRecord(m.code).status === "visited").length;
  const want = municipalities.filter((m) => getRecord(m.code).status === "want").length;
  const unvisited = total - visited - want;
  const percent = total ? visited / total * 100 : 0;

  $("overallPercent").textContent = `${percent.toFixed(1)}%`;
  $("overallBar").style.width = `${percent}%`;
  $("overallCount").textContent = `${visited} / ${total} 自治体`;
  $("visitedCount").textContent = visited;
  $("wantCount").textContent = want;
  $("unvisitedCount").textContent = unvisited;
}

function renderList() {
  const list = getFilteredMunicipalities();
  municipalityList.replaceChildren();
  $("resultSummary").textContent = `${list.length} 件を表示中`;

  list.forEach((m) => {
    const record = getRecord(m.code);
    const card = document.createElement("article");
    card.className = "municipality-card";

    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = m.name;
    const subtitle = document.createElement("p");
    subtitle.textContent = `${m.prefecture} · ${m.type} · コード ${m.code}`;
    info.append(title, subtitle);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const pill = document.createElement("span");
    pill.className = `status-pill status-${record.status}`;
    pill.textContent = getStatusLabel(record.status);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button secondary";
    button.textContent = "編集";
    button.addEventListener("click", () => openRecordDialog(m));
    actions.append(pill, button);
    card.append(info, actions);
    municipalityList.append(card);
  });

  $("emptyState").hidden = list.length !== 0;
}

function renderPrefectureProgress() {
  const host = $("prefectureProgressList");
  if (!host) return;
  host.replaceChildren();
  const prefectures = [...new Set(municipalities.map(m => m.prefecture))]
    .sort((a, b) => a.localeCompare(b, "ja"));
  $("prefectureProgressBadge").textContent = `${prefectures.length}都道府県`;

  prefectures.forEach(prefecture => {
    const items = municipalities.filter(m => m.prefecture === prefecture);
    const visited = items.filter(m => getRecord(m.code).status === "visited").length;
    const percent = items.length ? visited / items.length * 100 : 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `prefecture-progress-item${prefectureFilter.value === prefecture ? " is-active" : ""}`;
    button.setAttribute("aria-label", `${prefecture}、${visited} / ${items.length}自治体、制覇率${percent.toFixed(1)}パーセント。一覧をこの都道府県に絞り込む`);

    const top = document.createElement("span");
    top.className = "prefecture-progress-top";
    const name = document.createElement("strong");
    name.textContent = prefecture;
    const count = document.createElement("span");
    count.textContent = `${visited} / ${items.length}`;
    top.append(name, count);

    const track = document.createElement("span");
    track.className = "prefecture-progress-track";
    const fill = document.createElement("span");
    fill.className = "prefecture-progress-fill";
    fill.style.width = `${percent}%`;
    track.append(fill);

    const bottom = document.createElement("span");
    bottom.className = "prefecture-progress-bottom";
    bottom.textContent = `${percent.toFixed(1)}% 制覇`;
    button.append(top, track, bottom);
    button.addEventListener("click", () => {
      prefectureFilter.value = prefectureFilter.value === prefecture ? "" : prefecture;
      renderAll();
      $("municipalityList").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    host.append(button);
  });
}

function renderAll() {
  renderStats();
  renderPrefectureProgress();
  renderList();
  refreshMapStyles();
}

function populatePrefectures() {
  const prefectures = [...new Set(municipalities.map((m) => m.prefecture))].sort((a, b) => a.localeCompare(b, "ja"));
  prefectures.forEach((pref) => {
    const option = document.createElement("option");
    option.value = pref;
    option.textContent = pref;
    prefectureFilter.append(option);
  });
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function openRecordDialog(municipality) {
  const record = getRecord(municipality.code);
  $("recordCode").value = municipality.code;
  $("dialogTitle").textContent = `${municipality.name}の記録`;
  $("recordStatus").value = record.status;
  $("recordDate").value = record.date || (record.status === "visited" ? getLocalDateString() : "");
  $("recordMemo").value = record.memo || "";
  dialog.showModal();
}

function closeDialog() {
  dialog.close();
}

$("recordForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = $("recordCode").value;
  const status = $("recordStatus").value;
  records[code] = {
    status,
    date: status === "visited" ? $("recordDate").value : "",
    memo: $("recordMemo").value.trim()
  };
  saveRecords();
  closeDialog();
  renderAll();
  showToast("訪問記録を保存しました。");
});

$("closeDialog").addEventListener("click", closeDialog);
$("cancelDialog").addEventListener("click", closeDialog);
prefectureFilter.addEventListener("change", renderAll);
searchInput.addEventListener("input", renderList);
statusFilter.addEventListener("change", renderList);

$("exportButton").addEventListener("click", () => {
  const backup = {
    app: "municipality-conquest",
    version: 1,
    exportedAt: new Date().toISOString(),
    records
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `municipality-conquest-backup-${getLocalDateString()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("バックアップを書き出しました。");
});

$("importInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    // サンプル一覧で記録を絞り込むと、一覧外の記録が失われるため取り込まない。
    if (!municipalitiesReady) {
      alert("全国の自治体一覧を正常に読み込めていないため、バックアップは読み込めません。通信状態を確認して、ページを再読み込みしてください。現在の記録は変更していません。");
      return;
    }
    const parsed = JSON.parse(await file.text());
    const imported = parsed.records && typeof parsed.records === "object" ? parsed.records : parsed;
    if (!imported || typeof imported !== "object" || Array.isArray(imported)) {
      throw new Error("形式が正しくありません");
    }
    const allowed = new Set(municipalities.map((m) => m.code));
    const cleaned = {};
    for (const [code, value] of Object.entries(imported)) {
      if (allowed.has(code) && value && ["visited", "want", "unvisited"].includes(value.status)) {
        cleaned[code] = {
          status: value.status,
          date: typeof value.date === "string" ? value.date : "",
          memo: typeof value.memo === "string" ? value.memo.slice(0, 5000) : ""
        };
      }
    }
    if (!confirm(`${Object.keys(cleaned).length} 件の記録を読み込みます。現在の記録は読み込んだ内容で置き換わります。よろしいですか？`)) return;
    records = cleaned;
    saveRecords();
    renderAll();
    showToast("バックアップを読み込みました。");
  } catch (error) {
    alert("ファイルを読み込めませんでした。アプリのJSONバックアップを選んでください。");
  } finally {
    event.target.value = "";
  }
});

$("resetButton").addEventListener("click", () => {
  if (!confirm("このブラウザに保存されている訪問記録をすべて削除します。事前にバックアップしましたか？")) return;
  records = {};
  saveRecords();
  renderAll();
  showToast("記録をリセットしました。");
});

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

const DATA_URL = "https://code4fukui.github.io/localgovjp/localgovjp.json";

function normalizeMunicipalityData(data) {
  if (!Array.isArray(data)) throw new Error("データ形式が配列ではありません");
  const seen = new Set();
  return data.map((item) => {
    const name = String(item.city || item.name || "").trim();
    const prefecture = String(item.pref || item.prefecture || "").trim();
    const code = String(item.lgcode || item.code || item.cid || "").trim();
    if (!name || !prefecture || !code) return null;
    // 市・町・村に加え、東京都の特別区23区を対象に含める。
    // 政令指定都市の行政区（例：大阪市北区）は対象外。
    const isTokyoSpecialWard = prefecture === "東京都" && name.endsWith("区");
    if (!isTokyoSpecialWard && !/(市|町|村)$/.test(name)) return null;
    const type = isTokyoSpecialWard ? "特別区" : name.endsWith("市") ? "市" : name.endsWith("町") ? "町" : "村";
    return { code, prefecture, name, type };
  }).filter((m) => {
    if (!m || seen.has(m.code)) return false;
    seen.add(m.code);
    return true;
  }).sort((a, b) => a.prefecture.localeCompare(b.prefecture, "ja") || a.name.localeCompare(b.name, "ja"));
}


const MAP_DATA_URL = "https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0001/N03-21_210101_designated_city.json";
let mapGeoJSON = null;
const mapPrefectureFilter = $("mapPrefectureFilter");

function normalizeMapCode(value) {
  return String(value || "").trim().replace(/\D/g, "").slice(0, 5).padStart(5, "0");
}

function findMunicipalityForFeature(feature) {
  const props = feature?.properties || {};
  const code = normalizeMapCode(props.N03_007);
  const byCode = municipalityByMapCode.get(code);
  if (byCode) return byCode;
  // Code format differs between some public datasets; use prefecture/name as fallback.
  const pref = String(props.N03_001 || "").trim();
  const names = [props.N03_004, props.N03_003].map(v => String(v || "").trim()).filter(Boolean);
  return municipalities.find(m => m.prefecture === pref && names.includes(m.name)) || null;
}

function getMapStatusColor(feature) {
  const municipality = findMunicipalityForFeature(feature);
  if (!municipality) return { color: "#aab8af", weight: 0.7, fillColor: "#e8eeea", fillOpacity: 0.5 };
  const status = getRecord(municipality.code).status;
  if (status === "visited") return { color: "#ffffff", weight: 0.7, fillColor: "#21845f", fillOpacity: 0.92 };
  if (status === "want") return { color: "#ffffff", weight: 0.7, fillColor: "#e6a63b", fillOpacity: 0.94 };
  return { color: "#82958a", weight: 0.7, fillColor: "#dfe8e2", fillOpacity: 0.9 };
}

function refreshMapStyles() {
  if (municipalityGeoLayer) municipalityGeoLayer.setStyle(getMapStatusColor);
}

function populateMapPrefectures() {
  const prefectures = [...new Set(municipalities.map(m => m.prefecture))].sort((a, b) => a.localeCompare(b, "ja"));
  mapPrefectureFilter.replaceChildren(new Option("全国", ""));
  prefectures.forEach(pref => mapPrefectureFilter.add(new Option(pref, pref)));
}

function renderMapLayer(prefecture = "") {
  if (!mapGeoJSON || !map) return;
  const features = mapGeoJSON.features.filter(feature => {
    const municipality = findMunicipalityForFeature(feature);
    if (!municipality) return false;
    return !prefecture || municipality.prefecture === prefecture;
  });
  if (municipalityGeoLayer) map.removeLayer(municipalityGeoLayer);
  municipalityGeoLayer = L.geoJSON({ type: "FeatureCollection", features }, {
    style: getMapStatusColor,
    onEachFeature: (feature, layer) => {
      const municipality = findMunicipalityForFeature(feature);
      if (!municipality) return;
      const record = getRecord(municipality.code);
      layer.bindPopup(`<div class="map-popup-title">${escapeHtml(municipality.name)}</div><div class="map-popup-status">${escapeHtml(municipality.prefecture)} · ${escapeHtml(getStatusLabel(record.status))}</div><button class="map-popup-button" type="button" data-map-code="${escapeHtml(municipality.code)}">記録を編集</button>`);
      layer.on("popupopen", event => {
        const button = event.popup.getElement()?.querySelector("[data-map-code]");
        if (button) button.addEventListener("click", () => openRecordDialog(municipality), { once: true });
      });
      layer.bindTooltip(`${municipality.prefecture} ${municipality.name}`, { sticky: true, direction: "top" });
    }
  }).addTo(map);
  const bounds = municipalityGeoLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [14, 14], maxZoom: prefecture ? 8 : 5 });
  }
  const count = features.length;
  $("mapBadge").textContent = prefecture ? `${prefecture} · ${count.toLocaleString("ja-JP")} 区域` : `全国 · ${count.toLocaleString("ja-JP")} 区域`;
  $("mapBadge").style.color = "#12664f";
  $("mapBadge").style.background = "#dff4e9";
}

function initializeMap() {
  const mapElement = $("japanMap");
  if (!mapElement || !window.L) {
    $("mapBadge").textContent = "地図ライブラリを読み込めません";
    return;
  }
  map = L.map("japanMap", { scrollWheelZoom: true, preferCanvas: true }).setView([36.2, 138.2], 5);
  // Keep the raster basemap for geographic context; municipality boundaries are drawn as vector polygons.
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  mapPrefectureFilter.addEventListener("change", () => renderMapLayer(mapPrefectureFilter.value));
  $("resetMapView").addEventListener("click", () => {
    mapPrefectureFilter.value = "";
    renderMapLayer("");
  });

  fetch(MAP_DATA_URL)
    .then(response => {
      if (!response.ok) throw new Error(`地図データ HTTP ${response.status}`);
      return response.json();
    })
    .then(geojson => {
      if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
        throw new Error("地図データの形式が想定と異なります");
      }
      mapGeoJSON = geojson;
      municipalityByMapCode.clear();
      municipalities.forEach(m => municipalityByMapCode.set(normalizeMapCode(m.code), m));
      populateMapPrefectures();
      renderMapLayer("");
      if (!municipalityGeoLayer || municipalityGeoLayer.getLayers().length === 0) {
        throw new Error("自治体一覧と地図の境界データを対応付けできませんでした");
      }
    })
    .catch(error => {
      console.warn("地図データを読み込めませんでした。", error);
      $("mapBadge").textContent = "地図データの読み込み失敗";
      $("mapBadge").style.color = "#9b3f36";
      $("mapBadge").style.background = "#fbe8e5";
      $("saveStatus").textContent = "自治体一覧は使えますが、地図データの読み込みに失敗しました。インターネット接続を確認してください。";
    });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function initialize() {
  setImportAvailability(false, "全国の自治体一覧を確認中です。完了するまでバックアップは読み込めません。");
  try {
    const response = await fetch(DATA_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const normalized = normalizeMunicipalityData(data);
    if (normalized.length < 1000) throw new Error(`自治体数が想定より少ない: ${normalized.length}`);
    municipalities = normalized;
    $("dataBadge").textContent = `全国データ ${municipalities.length.toLocaleString("ja-JP")} 件`;
    $("dataBadge").style.color = "#12664f";
    $("dataBadge").style.background = "#dff4e9";
    setImportAvailability(true, "全国の自治体一覧を読み込みました。バックアップを読み込めます。");
  } catch (error) {
    console.warn("全国データを読み込めませんでした。サンプルデータで起動します。", error);
    $("dataBadge").textContent = "サンプルデータ";
    $("saveStatus").textContent = "全国データの読み込みに失敗しました。インターネット接続を確認してください。";
    setImportAvailability(false, "全国の自治体一覧を読み込めないため、バックアップの読み込みを停止しています。通信状態を確認して、ページを再読み込みしてください。JSONの書き出しは利用できます。");
  }
  populatePrefectures();
  renderAll();
  initializeMap();
}

initialize();
