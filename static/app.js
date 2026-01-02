mapboxgl.accessToken = window.MAPBOX_TOKEN || "";

const VIEW_KEY = "openEVmap:view";
function saveView() {
  if (!state.mapReady) return;
  const center = map.getCenter();
  const view = {
    lng: center.lng,
    lat: center.lat,
    zoom: map.getZoom(),
  };
  localStorage.setItem(VIEW_KEY, JSON.stringify(view));
}

function loadView() {
  const raw = localStorage.getItem(VIEW_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (typeof data.lng === "number" && typeof data.lat === "number") {
      return data;
    }
  } catch (err) {
    return null;
  }
  return null;
}

const savedView = loadView();
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: savedView ? [savedView.lng, savedView.lat] : [13.405, 52.52],
  zoom: savedView ? savedView.zoom : 12,
});

map.addControl(new mapboxgl.NavigationControl());

const state = {
  selection: null,
  queue: new Map(),
  elements: [],
  mapReady: false,
};

const QUEUE_KEY = "openEVmap:queue";

let loadTimer = null;
let currentAbort = null;
let lastBboxKey = null;
let lastZoomLevel = null;
let isLoading = false;

const authArea = document.getElementById("authArea");
const modal = document.getElementById("infoModal");
const modalTitle = document.getElementById("modalTitle");
const closeModalBtn = document.getElementById("closeModal");
const geoBtn = document.getElementById("geoBtn");
const searchInput = document.getElementById("searchInput");
const searchClearBtn = document.getElementById("searchClearBtn");
const searchBtn = document.getElementById("searchBtn");
const editForm = document.getElementById("editForm");
const modalHint = document.getElementById("modalHint");
const uploadBtn = document.getElementById("uploadBtn");
const filtersBtn = document.getElementById("filtersBtn");
const filtersModal = document.getElementById("filtersModal");
const filtersOverlay = document.getElementById("filtersOverlay");
const closeFiltersBtn = document.getElementById("closeFilters");
const saveFiltersBtn = document.getElementById("saveFiltersBtn");
const menuBtn = document.getElementById("menuBtn");
const menuOverlay = document.getElementById("menuOverlay");
const menuDrawer = document.getElementById("menuDrawer");
const closeMenuBtn = document.getElementById("closeMenu");
const projectInfoBtn = document.getElementById("projectInfoBtn");
const infoOverlay = document.getElementById("infoOverlay");
const infoModalCard = document.getElementById("infoModalCard");
const closeInfoBtn = document.getElementById("closeInfo");
const filterAll = document.getElementById("filterAll");
const filterType1 = document.getElementById("filter_socket_type1");
const filterType2 = document.getElementById("filter_socket_type2");
const filterCHAdeMO = document.getElementById("filter_socket_chademo");
const filterCCS1 = document.getElementById("filter_socket_ccs1");
const filterCCS = document.getElementById("filter_socket_ccs");
const filterGBT = document.getElementById("filter_socket_gbt");
const feeCheckbox = document.getElementById("fee");
const costRow = document.getElementById("costRow");
const costInput = document.getElementById("cost");
const filterSocketButtons = document.querySelectorAll(
  ".socket-btn[data-scope='filter']"
);
const editSocketButtons = document.querySelectorAll(
  ".socket-btn[data-scope='edit']"
);
const loadingStatus = document.getElementById("loadingStatus");
const zoomHint = document.getElementById("zoomHint");
const tray = document.getElementById("shell-tray");
const trayCard = document.getElementById("shell-tray-card-container");
const trayHandle = document.querySelector(".mw-card-handle");

const FILTERS_KEY = "openEVmap:filters";

function setHint(text, isError = false) {
  modalHint.textContent = text;
  modalHint.style.color = isError ? "#fca5a5" : "#94a3b8";
}

function saveQueueState() {
  const items = Array.from(state.queue.values());
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  uploadBtn.textContent = `Upload (${state.queue.size})`;
}

function loadQueueState() {
  const raw = localStorage.getItem(QUEUE_KEY);
  if (!raw) return;
  try {
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return;
    state.queue.clear();
    items.forEach((item) => {
      if (!item || !item.type || !item.id) return;
      const key = `${item.type}/${item.id}`;
      state.queue.set(key, item);
    });
    uploadBtn.textContent = `Upload (${state.queue.size})`;
  } catch (err) {
    return;
  }
}

function updateZoomHint() {
  if (!zoomHint) return;
  const show = map.getZoom() < 12 && !isLoading;
  zoomHint.classList.toggle("hidden", !show);
}

function setLoadingState(nextLoading) {
  isLoading = nextLoading;
  if (loadingStatus) {
    loadingStatus.classList.toggle("hidden", !nextLoading);
  }
  if (nextLoading && zoomHint) {
    zoomHint.classList.add("hidden");
    return;
  }
  updateZoomHint();
}

function initBottomTray() {
  if (!tray || !trayCard) return;
  const dragTarget = tray;
  const header = trayCard.querySelector(".mw-search-header-title");
  const search = trayCard.querySelector(".mw-search-bar-container");
  const handle = trayCard.querySelector(".mw-card-handle");
  let expanded = 0;
  let maxTranslate = 0;
  let startY = 0;
  let startTranslate = 0;
  let currentTranslate = 0;
  let dragging = false;

  const setTranslate = (value) => {
    const clamped = Math.min(maxTranslate, Math.max(0, value));
    currentTranslate = clamped;
    tray.style.transform = `translateY(${clamped}px)`;
  };

  const recomputeSizes = () => {
    expanded = Math.round(window.innerHeight * 0.9);
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const searchHeight = search ? search.getBoundingClientRect().height : 0;
    const handleHeight = handle ? handle.getBoundingClientRect().height : 0;
    const collapsedVisible = Math.max(
      140,
      Math.round(headerHeight + searchHeight + handleHeight + 32)
    );
    maxTranslate = Math.max(0, expanded - collapsedVisible);
    tray.style.height = `${expanded}px`;
  };

  recomputeSizes();
  setTranslate(maxTranslate);

  const onPointerMove = (event) => {
    if (!dragging) return;
    event.preventDefault();
    const delta = event.clientY - startY;
    setTranslate(startTranslate + delta);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    tray.style.transition = "transform 0.25s ease";
    const snap = currentTranslate > maxTranslate / 2 ? maxTranslate : 0;
    setTranslate(snap);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  dragTarget.addEventListener("pointerdown", (event) => {
    if (event.target.closest("input, button, textarea, select, a")) {
      return;
    }
    dragging = true;
    startY = event.clientY;
    startTranslate = currentTranslate;
    tray.style.transition = "none";
    dragTarget.setPointerCapture(event.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });

  window.addEventListener("resize", () => {
    recomputeSizes();
    setTranslate(maxTranslate);
  });
}

function tagsFromForm() {
  const data = new FormData(editForm);
  const tags = {};
  for (const [key, value] of data.entries()) {
    if (value === "") continue;
    tags[key] = value;
  }
  const checkboxFields = ["fee"];
  checkboxFields.forEach((key) => {
    const input = editForm.querySelector(`[name='${key}']`);
    const wasPresent = state.selection?.tags?.[key] !== undefined;
    if (input && input.type === "checkbox") {
      if (input.checked) {
        tags[key] = "yes";
      } else if (wasPresent) {
        tags[key] = "no";
      } else {
        delete tags[key];
      }
    }
  });
  const socketRowMap = {
    "socket:type1": "socket_row_type1",
    "socket:type2": "socket_row_type2",
    "socket:chademo": "socket_row_chademo",
    "socket:ccs1": "socket_row_ccs1",
    "socket:ccs": "socket_row_ccs",
    "socket:gbt": "socket_row_gbt",
  };
  const socketCounts = [
    "socket:type1",
    "socket:type2",
    "socket:chademo",
    "socket:ccs1",
    "socket:ccs",
    "socket:gbt",
  ];
  socketCounts.forEach((key) => {
    const input = editForm.querySelector(`[name='${key}']`);
    if (!input) return;
    const rowId = socketRowMap[key];
    if (rowId) {
      const row = document.getElementById(rowId);
      if (row && row.classList.contains("hidden")) {
        delete tags[key];
        return;
      }
    }
    const raw = input.value.trim();
    const value = parseInt(raw, 10);
    if (!raw || Number.isNaN(value) || value <= 0) {
      delete tags[key];
      return;
    }
    tags[key] = String(value);
  });
  const socketOutputs = [
    "socket:type1:output",
    "socket:type2:output",
    "socket:chademo:output",
    "socket:ccs1:output",
    "socket:ccs:output",
    "socket:gbt:output",
  ];
  socketOutputs.forEach((key) => {
    const input = editForm.querySelector(`[name='${key}']`);
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) {
      delete tags[key];
      return;
    }
    const baseKey = key.replace(":output", "");
    const countValue = tags[baseKey];
    if (!countValue) {
      delete tags[key];
      return;
    }
    tags[key] = raw;
  });
  if (feeCheckbox.checked) {
    const cost = costInput.value.trim();
    if (cost) {
      tags.cost = cost;
    } else {
      delete tags.cost;
    }
  } else {
    delete tags.cost;
  }
  delete tags.source;
  return tags;
}

function fillForm(tags = {}) {
  const socketRowMap = {
    "socket:type1": "socket_row_type1",
    "socket:type2": "socket_row_type2",
    "socket:chademo": "socket_row_chademo",
    "socket:ccs1": "socket_row_ccs1",
    "socket:ccs": "socket_row_ccs",
    "socket:gbt": "socket_row_gbt",
  };
  const fields = [
    "name",
    "operator",
    "brand",
    "capacity",
    "opening_hours",
    "access",
  ];
  fields.forEach((field) => {
    const el = editForm.querySelector(`[name='${field}']`);
    if (el) {
      el.value = tags[field] || "";
    }
  });
  const checkboxFields = ["fee"];
  checkboxFields.forEach((field) => {
    const el = editForm.querySelector(`[name='${field}']`);
    if (!el) return;
    const raw = tags[field];
    el.checked = raw && String(raw).toLowerCase() !== "no";
  });
  refreshEditButtonsFromRows();
  const socketCounts = [
    "socket:type1",
    "socket:type2",
    "socket:chademo",
    "socket:ccs1",
    "socket:ccs",
    "socket:gbt",
  ];
  socketCounts.forEach((field) => {
    const el = editForm.querySelector(`[name='${field}']`);
    if (!el) return;
    const raw = tags[field];
    const value = parseInt(raw, 10);
    const normalized = Number.isNaN(value) ? "" : String(value);
    el.value = normalized;
    const rowId = socketRowMap[field];
    if (rowId) {
      setSocketRowVisible(rowId, Boolean(normalized), true);
    }
  });
  const socketOutputs = [
    "socket:type1:output",
    "socket:type2:output",
    "socket:chademo:output",
    "socket:ccs1:output",
    "socket:ccs:output",
    "socket:gbt:output",
  ];
  socketOutputs.forEach((field) => {
    const el = editForm.querySelector(`[name='${field}']`);
    if (!el) return;
    el.value = tags[field] || "";
    if (el.value) {
      const baseKey = field.replace(":output", "");
      const rowId = socketRowMap[baseKey];
      if (rowId) {
        setSocketRowVisible(rowId, true, false);
      }
    }
  });
  if (tags.cost) {
    costInput.value = tags.cost || "";
    if (!feeCheckbox.checked) {
      feeCheckbox.checked = true;
    }
  } else {
    costInput.value = "";
  }
  toggleCostRow();
  refreshEditButtonsFromRows();
}

async function fetchMe() {
  const res = await fetch("/api/me");
  const json = await res.json();
  if (json.authenticated) {
    const user = json.user?.display_name || "OSM User";
    authArea.innerHTML = `<span class="muted">${user}</span><button id="logoutBtn">Logout</button>`;
    document.getElementById("logoutBtn").onclick = async () => {
      await fetch("/auth/logout", { method: "POST" });
      location.reload();
    };
  } else {
    authArea.innerHTML = `<button id="loginBtn">Login with OSM</button>`;
    document.getElementById("loginBtn").onclick = () => {
      window.location.href = "/auth/osm";
    };
  }
}

function openModal(el) {
  state.selection = el;
  modalTitle.textContent = el.tags?.name || "Charging station";
  fillForm(el.tags || {});
  setHint("");
  modal.classList.remove("hidden");
}

function refreshFilterButtons() {
  filterSocketButtons.forEach((btn) => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;
    const checked = input.checked;
    const disabled = input.disabled;
    btn.classList.toggle("active", checked);
    btn.setAttribute("aria-pressed", checked ? "true" : "false");
    btn.disabled = disabled;
    btn.classList.toggle("disabled", disabled);
  });
}

function initFilterButtons() {
  filterSocketButtons.forEach((btn) => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;
    btn.addEventListener("click", () => {
      input.checked = !input.checked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      refreshFilterButtons();
    });
  });
  refreshFilterButtons();
}

function setSocketRowVisible(rowId, visible, clear = false) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.classList.toggle("hidden", !visible);
  if (clear && !visible) {
    row.querySelectorAll("input").forEach((input) => {
      input.value = "";
    });
  }
}

function refreshEditButtonsFromRows() {
  editSocketButtons.forEach((btn) => {
    const rowId = btn.dataset.row;
    const row = document.getElementById(rowId);
    const active = row ? !row.classList.contains("hidden") : false;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function initEditSocketButtons() {
  editSocketButtons.forEach((btn) => {
    const rowId = btn.dataset.row;
    if (!rowId) return;
    btn.addEventListener("click", () => {
      const row = document.getElementById(rowId);
      if (!row) return;
      const willShow = row.classList.contains("hidden");
      setSocketRowVisible(rowId, willShow, true);
      if (willShow) {
        const first = row.querySelector("input");
        if (first) {
          first.focus();
        }
      }
      refreshEditButtonsFromRows();
    });
  });
  refreshEditButtonsFromRows();
}

function closeModal() {
  modal.classList.add("hidden");
  state.selection = null;
  editForm.reset();
  setHint("");
  toggleCostRow();
  refreshEditButtonsFromRows();
}

function openFilters() {
  if (!filtersModal) return;
  filtersModal.classList.remove("hidden");
  if (filtersOverlay) {
    filtersOverlay.classList.remove("hidden");
  }
}

function closeFilters() {
  if (!filtersModal) return;
  filtersModal.classList.add("hidden");
  if (filtersOverlay) {
    filtersOverlay.classList.add("hidden");
  }
}

function openMenu() {
  if (!menuDrawer || !menuOverlay) return;
  menuDrawer.classList.remove("hidden");
  menuOverlay.classList.remove("hidden");
}

function closeMenu() {
  if (!menuDrawer || !menuOverlay) return;
  menuDrawer.classList.add("hidden");
  menuOverlay.classList.add("hidden");
}

function openInfoModal() {
  if (!infoModalCard) return;
  infoModalCard.classList.remove("hidden");
  if (infoOverlay) {
    infoOverlay.classList.remove("hidden");
  }
}

function closeInfoModal() {
  if (!infoModalCard) return;
  infoModalCard.classList.add("hidden");
  if (infoOverlay) {
    infoOverlay.classList.add("hidden");
  }
}

function loadFiltersState() {
  const raw = localStorage.getItem(FILTERS_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch (err) {
    return null;
  }
}

function saveFiltersState() {
  const data = {
    all: filterAll.checked,
    type1: filterType1.checked,
    type2: filterType2.checked,
    ccs: filterCCS.checked,
    chademo: filterCHAdeMO.checked,
    ccs1: filterCCS1.checked,
    gbt: filterGBT.checked,
  };
  localStorage.setItem(FILTERS_KEY, JSON.stringify(data));
}

function applyFiltersState(data) {
  if (!data) return;
  if (typeof data.all === "boolean") filterAll.checked = data.all;
  if (typeof data.type1 === "boolean") filterType1.checked = data.type1;
  if (typeof data.type2 === "boolean") filterType2.checked = data.type2;
  if (typeof data.ccs === "boolean") filterCCS.checked = data.ccs;
  if (typeof data.chademo === "boolean") filterCHAdeMO.checked = data.chademo;
  if (typeof data.ccs1 === "boolean") filterCCS1.checked = data.ccs1;
  if (typeof data.gbt === "boolean") filterGBT.checked = data.gbt;
}

async function loadPOIs(options = {}) {
  if (!state.mapReady) return;
  if (map.getZoom() < 12) {
    state.elements = [];
    lastBboxKey = null;
    lastZoomLevel = null;
    updateSource();
    setLoadingState(false);
    return;
  }
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  const bboxArray = [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth(),
  ];
  const bbox = bboxArray.join(",");
  const bboxKey = bboxArray.map((value) => value.toFixed(4)).join(",");
  if (!options.force && bboxKey === lastBboxKey && zoom === lastZoomLevel) {
    setLoadingState(false);
    return;
  }
  setLoadingState(true);
  if (currentAbort) {
    currentAbort.abort();
  }
  currentAbort = new AbortController();
  try {
    const res = await fetch(`/api/pois?bbox=${bbox}`, {
      signal: currentAbort.signal,
    });
    if (!res.ok) {
      return;
    }
    const json = await res.json();
    state.elements = json.elements || [];
    lastBboxKey = bboxKey;
    lastZoomLevel = zoom;
    updateSource();
  } catch (err) {
    if (err && err.name === "AbortError") {
      return;
    }
    throw err;
  } finally {
    setLoadingState(false);
  }
}

function scheduleLoad() {
  if (loadTimer) {
    clearTimeout(loadTimer);
  }
  loadTimer = setTimeout(() => {
    loadPOIs();
  }, 500);
}

function hasSocket(tags, key) {
  const raw = tags?.[key];
  if (!raw) return false;
  const value = parseInt(raw, 10);
  if (Number.isNaN(value)) return false;
  return value >= 1;
}

function passesFilter(el) {
  const tags = el.tags || {};
  if (filterAll.checked) {
    return true;
  }
  const wantType1 = filterType1.checked;
  const wantType2 = filterType2.checked;
  const wantCHAdeMO = filterCHAdeMO.checked;
  const wantCCS1 = filterCCS1.checked;
  const wantCCS = filterCCS.checked;
  const wantGBT = filterGBT.checked;
  if (
    !wantType1 &&
    !wantType2 &&
    !wantCHAdeMO &&
    !wantCCS1 &&
    !wantCCS &&
    !wantGBT
  ) {
    return false;
  }
  return (
    (wantType1 && hasSocket(tags, "socket:type1")) ||
    (wantType2 && hasSocket(tags, "socket:type2")) ||
    (wantCHAdeMO && hasSocket(tags, "socket:chademo")) ||
    (wantCCS1 && hasSocket(tags, "socket:ccs1")) ||
    (wantCCS && hasSocket(tags, "socket:ccs")) ||
    (wantGBT && hasSocket(tags, "socket:gbt"))
  );
}

function buildGeoJSON() {
  const features = [];
  state.elements.forEach((el) => {
    if (!passesFilter(el)) return;
    const lat = el.lat || el.center?.lat;
    const lon = el.lon || el.center?.lon;
    if (lat == null || lon == null) return;
    const props = {
      id: el.id,
      type: el.type,
      version: el.version,
      lat,
      lon,
      tags_json: JSON.stringify(el.tags || {}),
    };
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
      properties: props,
    });
  });
  return {
    type: "FeatureCollection",
    features,
  };
}

function updateSource() {
  if (!map.getSource("ev")) return;
  const data = buildGeoJSON();
  map.getSource("ev").setData(data);
}

async function geolocate() {
  if (!navigator.geolocation) {
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.setCenter([longitude, latitude]);
      map.setZoom(14);
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function searchPlace() {
  const q = searchInput.value.trim();
  if (!q) return;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { "Accept-Language": "en" },
  });
  if (!res.ok) return;
  const data = await res.json();
  if (!data.length) return;
  const first = data[0];
  map.setCenter([parseFloat(first.lon), parseFloat(first.lat)]);
  map.setZoom(14);
}

map.on("load", () => {
  state.mapReady = true;
  map.addSource("ev", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 50,
  });

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "ev",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "#0ea5e9",
        30,
        "#22c55e",
        100,
        "#f59e0b",
      ],
      "circle-radius": [
        "step",
        ["get", "point_count"],
        16,
        30,
        22,
        100,
        28,
      ],
    },
  });

  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "ev",
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
      "text-size": 12,
    },
    paint: {
      "text-color": "#fefefe",
    },
  });

  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "ev",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#00a2ff",
      "circle-radius": 6,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#fefefe",
      "text-color": "#fefefe",
    },
  });

  map.on("click", "clusters", (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ["clusters"],
    });
    const clusterId = features[0].properties.cluster_id;
    map.getSource("ev").getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({
        center: features[0].geometry.coordinates,
        zoom,
      });
    });
  });

  map.on("click", "unclustered-point", (e) => {
    const feature = e.features[0];
    const props = feature.properties || {};
    let tags = {};
    try {
      tags = JSON.parse(props.tags_json || "{}");
    } catch (err) {
      tags = {};
    }
    const el = {
      id: props.id,
      type: props.type,
      version: props.version,
      lat: props.lat,
      lon: props.lon,
      tags,
    };
    openModal(el);
  });

  map.on("mouseenter", "clusters", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "clusters", () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("mouseenter", "unclustered-point", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "unclustered-point", () => {
    map.getCanvas().style.cursor = "";
  });

  loadPOIs();
});

map.on("moveend", scheduleLoad);
map.on("zoomend", scheduleLoad);
map.on("moveend", saveView);
map.on("zoomend", saveView);
map.on("zoomend", updateZoomHint);

closeModalBtn.onclick = closeModal;
geoBtn.onclick = geolocate;
if (searchClearBtn) {
  searchClearBtn.onclick = () => {
    searchInput.value = "";
    searchInput.focus();
  };
}
if (searchBtn) {
  searchBtn.onclick = searchPlace;
}
if (filtersBtn) {
  filtersBtn.onclick = openFilters;
}
if (closeFiltersBtn) {
  closeFiltersBtn.onclick = closeFilters;
}
if (filtersOverlay) {
  filtersOverlay.onclick = closeFilters;
}
if (saveFiltersBtn) {
  saveFiltersBtn.onclick = closeFilters;
}
if (menuBtn) {
  menuBtn.onclick = openMenu;
}
if (closeMenuBtn) {
  closeMenuBtn.onclick = closeMenu;
}
if (menuOverlay) {
  menuOverlay.onclick = closeMenu;
}
if (projectInfoBtn) {
  projectInfoBtn.onclick = openInfoModal;
}
if (closeInfoBtn) {
  closeInfoBtn.onclick = closeInfoModal;
}
if (infoOverlay) {
  infoOverlay.onclick = closeInfoModal;
}
function syncFilterState() {
  const allChecked = filterAll.checked;
  filterType1.disabled = allChecked;
  filterType2.disabled = allChecked;
  filterCHAdeMO.disabled = allChecked;
  filterCCS1.disabled = allChecked;
  filterCCS.disabled = allChecked;
  filterGBT.disabled = allChecked;
  if (allChecked) {
    filterType1.checked = false;
    filterType2.checked = false;
    filterCHAdeMO.checked = false;
    filterCCS1.checked = false;
    filterCCS.checked = false;
    filterGBT.checked = false;
  }
  saveFiltersState();
  updateSource();
  refreshFilterButtons();
}

const filterInputs = [
  filterType1,
  filterType2,
  filterCHAdeMO,
  filterCCS1,
  filterCCS,
  filterGBT,
];
filterInputs.forEach((input) => {
  if (!input) return;
  input.onchange = () => {
    saveFiltersState();
    updateSource();
  };
});
if (filterAll) {
  filterAll.onchange = syncFilterState;
}
feeCheckbox.onchange = toggleCostRow;
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    searchPlace();
  }
});
searchInput.addEventListener("input", () => {
  if (!searchBtn) return;
  const hasValue = searchInput.value.trim().length > 0;
  searchBtn.classList.toggle("is-hidden", !hasValue);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeFilters();
    closeMenu();
    closeInfoModal();
  }
});

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.selection) {
    setHint("Select a station first", true);
    return;
  }
  if (state.selection.type !== "node") {
    setHint("Editing only supported for nodes", true);
    return;
  }
  const comment = "Update EV charger details";
  const sourceInput = editForm.querySelector("[name='source']");
  const source = sourceInput ? sourceInput.value.trim() || "survey" : "survey";
  const lat = state.selection.lat ?? state.selection.center?.lat;
  const lon = state.selection.lon ?? state.selection.center?.lon;
  if (lat == null || lon == null) {
    setHint("Missing coordinates. Reload the map.", true);
    return;
  }
  const item = {
    comment,
    source,
    tags: tagsFromForm(),
    type: state.selection.type,
    id: state.selection.id,
    version: state.selection.version,
    lat,
    lon,
  };
  if (!item.version) {
    setHint("Missing version. Reload the map and try again.", true);
    return;
  }
  const key = `${item.type}/${item.id}`;
  state.queue.set(key, item);
  saveQueueState();
  setHint("Saved locally. Use Upload to commit.", false);
  closeModal();
});

uploadBtn.addEventListener("click", async () => {
  if (state.queue.size === 0) {
    return;
  }
  const items = Array.from(state.queue.values());
  const first = items[0];
  const sameMeta = items.every(
    (item) => item.comment === first.comment && item.source === first.source
  );
  if (!sameMeta) {
    alert("All staged edits must use the same comment and source.");
    return;
  }
  try {
    const res = await fetch("/api/changeset/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comment: first.comment,
        source: first.source,
        updates: items,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(`Upload failed: ${err.error || res.status}`);
      return;
    }
    state.queue.clear();
    saveQueueState();
    await loadPOIs({ force: true });
  } catch (err) {
    alert("Upload failed");
  }
});

fetchMe();
applyFiltersState(loadFiltersState());
syncFilterState();
initFilterButtons();
initEditSocketButtons();
if (searchBtn) {
  const hasValue = searchInput.value.trim().length > 0;
  searchBtn.classList.toggle("is-hidden", !hasValue);
}
updateZoomHint();
initBottomTray();
loadQueueState();

function toggleCostRow() {
  if (!feeCheckbox || !costRow) return;
  costRow.style.display = feeCheckbox.checked ? "block" : "none";
}

toggleCostRow();
