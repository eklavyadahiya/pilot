import { kml as toGeoJsonKml } from "https://esm.sh/@tmcw/togeojson@6.0.0";
import JSZip from "https://esm.sh/jszip@3.10.1";
import {
  initWeightBalanceTool,
  refreshWeightBalanceChart
} from "./tools/weight-balance/ui.js";

const EHHV = [52.1906, 5.1469];
const MAX_REFERENCE_RADIUS_KM = 50;
const WIND_STORAGE_KEY = "pilot-training.wind-data.v1";
const QUIZ_BANK_PATH = "./quiz/questions.json";
const GUIDE_PATH = "./guide/dv20-guide.json";
const KITTEN_TTS_MODEL_ID = "onnx-community/KittenTTS-Nano-v0.8-ONNX";
const KITTEN_TTS_VOICE = "Luna";

const map = L.map("map").setView(EHHV, 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const airportLatLng = L.latLng(EHHV[0], EHHV[1]);
L.marker(airportLatLng).addTo(map).bindPopup("EHHV (Hilversum)");
L.circle(airportLatLng, {
  radius: MAX_REFERENCE_RADIUS_KM * 1000,
  color: "#64748b",
  weight: 1.5,
  fill: false,
  dashArray: "5,5"
}).addTo(map).bindPopup("50 km reference radius");

const kmzLayerGroup = L.layerGroup().addTo(map);
const windLayerGroup = L.layerGroup().addTo(map);
const measureLayerGroup = L.layerGroup().addTo(map);

const kmzButtonsEl = document.getElementById("kmz-file-buttons");
const toolNavButtons = Array.from(document.querySelectorAll(".tool-nav-btn"));
const homeToolScreen = document.getElementById("home-tool-screen");
const mapToolScreen = document.getElementById("map-tool-screen");
const quizToolScreen = document.getElementById("quiz-tool-screen");
const guideToolScreen = document.getElementById("guide-tool-screen");
const wbToolScreen = document.getElementById("wb-tool-screen");
const wbToolRoot = document.getElementById("wb-tool-root");
const addWindBtn = document.getElementById("add-wind-btn");
const clearWindBtn = document.getElementById("clear-wind-btn");
const resetWindDataBtn = document.getElementById("reset-wind-data-btn");
const toggleMeasureBtn = document.getElementById("toggle-measure-btn");
const undoMeasureBtn = document.getElementById("undo-measure-btn");
const clearMeasureBtn = document.getElementById("clear-measure-btn");
const measureSpeedKtInput = document.getElementById("measure-speed-kt-input");
const measureSummaryEl = document.getElementById("measure-summary");
const startQuizBtn = document.getElementById("start-quiz-btn");
const startFlashcardsBtn = document.getElementById("start-flashcards-btn");
const quizCategorySelect = document.getElementById("quiz-category-select");
const quizMetaEl = document.getElementById("quiz-meta");
const quizCardEl = document.getElementById("quiz-card");
const guideSectionSelect = document.getElementById("guide-section-select");
const guideSearchInput = document.getElementById("guide-search-input");
const guideMetaEl = document.getElementById("guide-meta");
const guideContentEl = document.getElementById("guide-content");
const windCodeInput = document.getElementById("wind-code-input");
const summaryEl = document.getElementById("wind-summary");
const readingsEl = document.getElementById("wind-readings");

const winds = [];
let placeWindMode = false;
let resultantLayer = null;
let resultantArrowHead = null;
let nextWindId = 1;
let manifestKmzFiles = [];
const kmzLayersByFile = new Map();
let measureMode = false;
const measurePoints = [];
const measureMarkers = [];
const measureSegmentLabels = [];
let measureLine = null;
let measureTotalMarker = null;
let questionBank = [];
let quizState = null;
let selectedQuizCategory = "__all__";
let guideData = null;
let wbToolInitialized = false;
const flashcardStudyState = {
  running: false,
  questionToAnswerDelayMs: 2500,
  betweenQuestionsDelayMs: 2000,
  speechRate: 1,
  localTtsStatus: "idle",
  localTtsError: "",
  currentAudioContext: null,
  currentAudioSource: null,
  currentAudioResolve: null,
  kittenModulePromise: null,
  kittenEnginePromise: null,
  kittenEngine: null,
  runToken: 0,
  ttsAvailable:
    typeof window !== "undefined" &&
    (typeof window.AudioContext !== "undefined" || typeof window.webkitAudioContext !== "undefined")
};

for (const button of toolNavButtons) {
  button.addEventListener("click", () => {
    setActiveTool(button.dataset.tool || "home");
  });
}

addWindBtn.addEventListener("click", () => {
  measureMode = false;
  toggleMeasureBtn.textContent = "Start Measuring";
  placeWindMode = true;
  addWindBtn.textContent = "Click map for reading...";
});

clearWindBtn.addEventListener("click", () => {
  clearWindReadings();
  saveWindState();
});

resetWindDataBtn.addEventListener("click", () => {
  clearWindReadings();
  windCodeInput.value = "31004KT";
  removeWindState();
});

toggleMeasureBtn.addEventListener("click", () => {
  measureMode = !measureMode;
  placeWindMode = false;
  addWindBtn.textContent = "Select Point On Map";
  toggleMeasureBtn.textContent = measureMode ? "Stop Measuring" : "Start Measuring";
});

clearMeasureBtn.addEventListener("click", () => {
  clearMeasurement();
});

measureSpeedKtInput.addEventListener("input", () => {
  updateMeasurementOverlays();
});

startQuizBtn.addEventListener("click", () => {
  startQuizSession();
});

startFlashcardsBtn.addEventListener("click", () => {
  startFlashcardSession();
});

quizCategorySelect.addEventListener("change", () => {
  selectedQuizCategory = quizCategorySelect.value || "__all__";
  updateQuizMeta();
});

guideSectionSelect.addEventListener("change", () => {
  renderGuide();
});

guideSearchInput.addEventListener("input", () => {
  renderGuide();
});

undoMeasureBtn.addEventListener("click", () => {
  if (measurePoints.length === 0) {
    return;
  }
  measurePoints.pop();
  renderMeasurement();
});

map.on("click", (event) => {
  if (measureMode) {
    addMeasurePoint(event.latlng);
    return;
  }

  if (!placeWindMode) {
    return;
  }

  const parsed = parseWindCode(windCodeInput.value.trim());
  if (!parsed.ok) {
    window.alert(parsed.error);
    return;
  }

  placeWindMode = false;
  addWindBtn.textContent = "Select Point On Map";
  addWindIndicator(event.latlng, parsed.directionFrom, parsed.speedKt, parsed.code);
  saveWindState();
});

refreshManifestKmzButtons();
restoreWindState();
updateWindSummary();
renderWindReadings();
updateMeasureSummary();
loadQuestionBank();
loadGuideData();
setActiveTool("home");

function clearWindReadings() {
  winds.length = 0;
  windLayerGroup.clearLayers();
  placeWindMode = false;
  addWindBtn.textContent = "Select Point On Map";
  if (resultantLayer) {
    map.removeLayer(resultantLayer);
    resultantLayer = null;
  }
  if (resultantArrowHead) {
    map.removeLayer(resultantArrowHead);
    resultantArrowHead = null;
  }
  updateWindSummary();
  renderWindReadings();
}

async function fetchManifest() {
  try {
    const response = await fetch("./data/kmz-manifest.json");
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

async function addKmzFromArrayBuffer(arrayBuffer, label) {
  const geoJson = await parseKmzToGeoJson(arrayBuffer);
  if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
    throw new Error(`No features parsed from ${label}`);
  }

  return L.geoJSON(geoJson, {
    style: {
      color: "#f97316",
      weight: 3,
      opacity: 0.9
    },
    pointToLayer: (feature, latlng) => {
      return L.circleMarker(latlng, {
        radius: 5,
        color: "#ea580c",
        weight: 2,
        fillColor: "#fdba74",
        fillOpacity: 0.95
      });
    },
    onEachFeature: (feature, featureLayer) => {
      const name = feature?.properties?.name || label;
      featureLayer.bindPopup(name);
    }
  });
}

function fitLayerBounds(layer) {
  const bounds = layer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.2));
  }
}

async function refreshManifestKmzButtons() {
  const manifest = await fetchManifest();
  const files = manifest && Array.isArray(manifest.files) ? manifest.files : [];
  manifestKmzFiles = files;

  for (const filePath of Array.from(kmzLayersByFile.keys())) {
    if (!manifestKmzFiles.includes(filePath)) {
      const layer = kmzLayersByFile.get(filePath);
      if (layer) {
        kmzLayerGroup.removeLayer(layer);
      }
      kmzLayersByFile.delete(filePath);
    }
  }

  renderKmzButtons();
}

function renderKmzButtons() {
  if (manifestKmzFiles.length === 0) {
    kmzButtonsEl.textContent = "No KMZ files listed in data/kmz-manifest.json.";
    return;
  }

  kmzButtonsEl.innerHTML = manifestKmzFiles
    .map((filePath) => {
      const name = getFileName(filePath);
      const activeClass = kmzLayersByFile.has(filePath) ? "active" : "";
      return `<button type="button" class="kmz-toggle-btn ${activeClass}" data-file="${filePath}">${name}</button>`;
    })
    .join("");

  for (const button of kmzButtonsEl.querySelectorAll(".kmz-toggle-btn")) {
    button.addEventListener("click", async () => {
      await toggleKmzFile(button.dataset.file);
    });
  }
}

async function toggleKmzFile(filePath) {
  if (!filePath) {
    return;
  }

  if (kmzLayersByFile.has(filePath)) {
    const existingLayer = kmzLayersByFile.get(filePath);
    kmzLayerGroup.removeLayer(existingLayer);
    kmzLayersByFile.delete(filePath);
    renderKmzButtons();
    return;
  }

  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const layer = await addKmzFromArrayBuffer(arrayBuffer, filePath);
    layer.addTo(kmzLayerGroup);
    kmzLayersByFile.set(filePath, layer);
    fitLayerBounds(layer);
  } catch (error) {
    console.error(`Failed loading ${filePath}:`, error);
    window.alert(`Could not load ${getFileName(filePath)}.`);
  }

  renderKmzButtons();
}

function getFileName(path) {
  const parts = String(path).split("/");
  return parts[parts.length - 1] || path;
}

function addMeasurePoint(latlng) {
  measurePoints.push(latlng);
  renderMeasurement();
}

function clearMeasurement() {
  measureMode = false;
  toggleMeasureBtn.textContent = "Start Measuring";
  measurePoints.length = 0;
  measureMarkers.length = 0;
  measureSegmentLabels.length = 0;
  measureLayerGroup.clearLayers();
  measureLine = null;
  measureTotalMarker = null;
  updateMeasureSummary();
}

function renderMeasurement() {
  measureLayerGroup.clearLayers();
  measureMarkers.length = 0;
  measureSegmentLabels.length = 0;
  measureLine = null;
  measureTotalMarker = null;

  for (let index = 0; index < measurePoints.length; index += 1) {
    const point = measurePoints[index];
    const marker = L.marker(point, {
      icon: L.divIcon({
        html: "<div class='measure-point-icon'></div>",
        className: "",
        iconSize: [10, 10],
        iconAnchor: [5, 5]
      }),
      draggable: true
    });
    marker.on("drag", (event) => {
      measurePoints[index] = event.target.getLatLng();
      updateMeasurementOverlays();
    });
    marker.on("dragend", (event) => {
      measurePoints[index] = event.target.getLatLng();
      updateMeasurementOverlays();
    });
    marker.addTo(measureLayerGroup);
    measureMarkers.push(marker);
  }

  if (measurePoints.length >= 2) {
    measureLine = L.polyline(measurePoints, {
      color: "#0f766e",
      weight: 3
    }).addTo(measureLayerGroup);

    for (let i = 1; i < measurePoints.length; i += 1) {
      const label = L.marker(segmentMidpoint(measurePoints[i - 1], measurePoints[i]), {
        icon: createMeasureSegmentLabelIcon(getSegmentDistanceText(i - 1)),
        interactive: false,
        keyboard: false
      }).addTo(measureLayerGroup);
      measureSegmentLabels.push(label);
    }
  }

  if (measurePoints.length > 0) {
    const lastPoint = measurePoints[measurePoints.length - 1];
    measureTotalMarker = L.marker(lastPoint, {
      icon: createMeasureTotalLabelIcon(getTotalDistanceText()),
      interactive: false,
      keyboard: false
    }).addTo(measureLayerGroup);
  }

  updateMeasureSummary();
}

function getTotalMeasuredKm() {
  let meters = 0;
  for (let i = 1; i < measurePoints.length; i += 1) {
    meters += map.distance(measurePoints[i - 1], measurePoints[i]);
  }
  return meters / 1000;
}

function updateMeasurementOverlays() {
  if (measureLine) {
    measureLine.setLatLngs(measurePoints);
  }

  for (let i = 1; i < measurePoints.length; i += 1) {
    const label = measureSegmentLabels[i - 1];
    if (!label) {
      continue;
    }
    label.setLatLng(segmentMidpoint(measurePoints[i - 1], measurePoints[i]));
    label.setIcon(createMeasureSegmentLabelIcon(getSegmentDistanceText(i - 1)));
  }

  if (measureTotalMarker && measurePoints.length > 0) {
    const lastPoint = measurePoints[measurePoints.length - 1];
    measureTotalMarker.setLatLng(lastPoint);
    measureTotalMarker.setIcon(createMeasureTotalLabelIcon(getTotalDistanceText()));
  }

  updateMeasureSummary();
}

function getSegmentDistanceText(startIndex) {
  const meters = map.distance(measurePoints[startIndex], measurePoints[startIndex + 1]);
  const km = meters / 1000;
  const nm = km / 1.852;
  return `${km.toFixed(2)} km / ${nm.toFixed(2)} nm`;
}

function getTotalDistanceText() {
  const totalKm = getTotalMeasuredKm();
  const totalNm = totalKm / 1.852;
  return `${totalKm.toFixed(2)} km / ${totalNm.toFixed(2)} nm`;
}

function getSpeedKt() {
  const value = Number(measureSpeedKtInput.value);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function getEstimatedTimeText() {
  const speedKt = getSpeedKt();
  if (speedKt === null) {
    return "ETA: --";
  }

  const totalNm = getTotalMeasuredKm() / 1.852;
  const hours = totalNm / speedKt;
  return `ETA: ${formatDurationFromHours(hours)} @ ${Math.round(speedKt)} kt`;
}

function formatDurationFromHours(hours) {
  const totalSeconds = Math.max(0, Math.round(hours * 3600));
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function segmentMidpoint(pointA, pointB) {
  return L.latLng(
    (pointA.lat + pointB.lat) / 2,
    (pointA.lng + pointB.lng) / 2
  );
}

function createMeasureSegmentLabelIcon(text) {
  return L.divIcon({
    html: `<div class="measure-segment-label">${text}</div>`,
    className: "",
    iconSize: [132, 24],
    iconAnchor: [66, 12]
  });
}

function createMeasureTotalLabelIcon(text) {
  return L.divIcon({
    html: `<div class="measure-total-label">Total: ${text}<br/>${getEstimatedTimeText()}</div>`,
    className: "",
    iconSize: [190, 40],
    iconAnchor: [0, 30]
  });
}

function updateMeasureSummary() {
  if (measurePoints.length === 0) {
    measureSummaryEl.textContent = "No measurement points yet.";
    return;
  }

  measureSummaryEl.textContent = `Measure points: ${measurePoints.length}. Total distance: ${getTotalDistanceText()}. ${getEstimatedTimeText()}.`;
}

async function parseKmzToGeoJson(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const kmlFileName = Object.keys(zip.files).find((name) =>
    name.toLowerCase().endsWith(".kml")
  );

  if (!kmlFileName) {
    throw new Error("No KML file found in KMZ archive");
  }

  const kmlText = await zip.files[kmlFileName].async("text");
  const parser = new DOMParser();
  const kmlDoc = parser.parseFromString(kmlText, "application/xml");
  return toGeoJsonKml(kmlDoc);
}

function addWindIndicator(latlng, directionFrom, speedKt, code) {
  const marker = L.marker(latlng, {
    icon: L.divIcon({
      html: "<div class='wind-icon'>W</div>",
      className: "",
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    })
  });

  const line = L.polyline([latlng, latlng], {
    color: "#1d4ed8",
    weight: 3
  });
  const arrowHead = L.marker(latlng, {
    icon: createArrowHeadIcon("#1d4ed8", 0),
    interactive: false,
    keyboard: false
  });

  marker.addTo(windLayerGroup);
  line.addTo(windLayerGroup);
  arrowHead.addTo(windLayerGroup);

  const wind = {
    id: nextWindId,
    latlng,
    directionFrom,
    speedKt,
    code,
    distanceToAirportKm: map.distance(latlng, airportLatLng) / 1000,
    marker,
    line,
    arrowHead
  };
  nextWindId += 1;

  refreshWindVisual(wind);
  winds.push(wind);

  updateResultantVector();
  updateWindSummary();
  renderWindReadings();
}

function updateResultantVector() {
  if (resultantLayer) {
    map.removeLayer(resultantLayer);
    resultantLayer = null;
  }
  if (resultantArrowHead) {
    map.removeLayer(resultantArrowHead);
    resultantArrowHead = null;
  }

  if (winds.length === 0) {
    return;
  }

  let u = 0;
  let v = 0;
  for (const wind of winds) {
    const toDeg = normalizeDeg(wind.directionFrom + 180);
    const rad = (toDeg * Math.PI) / 180;
    u += wind.speedKt * Math.sin(rad);
    v += wind.speedKt * Math.cos(rad);
  }

  const resultSpeed = Math.sqrt(u * u + v * v);
  const resultTo = normalizeDeg((Math.atan2(u, v) * 180) / Math.PI);
  const end = offsetLatLng(airportLatLng, resultTo, resultSpeed * 0.1);

  resultantLayer = L.polyline([airportLatLng, end], {
    color: "#dc2626",
    weight: 4,
    dashArray: "8,6"
  }).addTo(map);
  resultantArrowHead = L.marker(end, {
    icon: createArrowHeadIcon("#dc2626", resultTo),
    interactive: false,
    keyboard: false
  }).addTo(map);

  const fromDirection = normalizeDeg(resultTo + 180);
  resultantLayer.bindPopup(
    `Resultant: ${resultSpeed.toFixed(1)} kt from ${Math.round(fromDirection)}°`
  );
  resultantArrowHead.bindPopup(
    `Resultant points to ${Math.round(resultTo)}°`
  );
}

function updateWindSummary() {
  if (winds.length === 0) {
    summaryEl.textContent = "No wind indicators yet.";
    return;
  }

  let u = 0;
  let v = 0;
  for (const wind of winds) {
    const toDeg = normalizeDeg(wind.directionFrom + 180);
    const rad = (toDeg * Math.PI) / 180;
    u += wind.speedKt * Math.sin(rad);
    v += wind.speedKt * Math.cos(rad);
  }

  const speed = Math.sqrt(u * u + v * v);
  const toDeg = normalizeDeg((Math.atan2(u, v) * 180) / Math.PI);
  const fromDeg = normalizeDeg(toDeg + 180);
  const outOfRangeCount = winds.filter(
    (wind) => wind.distanceToAirportKm > MAX_REFERENCE_RADIUS_KM
  ).length;

  summaryEl.textContent = `Winds: ${winds.length}. Resultant wind: ${speed.toFixed(
    1
  )} kt from ${Math.round(fromDeg)}° (to ${Math.round(
    toDeg
  )}°) at EHHV. Out of 50km radius: ${outOfRangeCount}.`;
}

function refreshWindVisual(wind) {
  const directionTo = normalizeDeg(wind.directionFrom + 180);
  const end = offsetLatLng(wind.latlng, directionTo, wind.speedKt * 0.06);
  wind.line.setLatLngs([wind.latlng, end]);
  wind.arrowHead.setLatLng(end);
  wind.arrowHead.setIcon(createArrowHeadIcon("#1d4ed8", directionTo));
  wind.distanceToAirportKm = map.distance(wind.latlng, airportLatLng) / 1000;

  wind.marker.bindPopup(
    `${wind.code} (${Math.round(wind.directionFrom)}°/${wind.speedKt.toFixed(
      1
    )} kt from)<br/>${wind.distanceToAirportKm.toFixed(1)} km from EHHV`
  );
  wind.line.bindPopup(`Vector points to ${Math.round(directionTo)}°`);
  wind.arrowHead.bindPopup(`Wind blows to ${Math.round(directionTo)}°`);
}

function renderWindReadings() {
  if (winds.length === 0) {
    readingsEl.textContent = "No saved readings yet.";
    return;
  }

  readingsEl.innerHTML = winds
    .map(
      (wind, index) => `
      <div class="wind-reading-row" data-id="${wind.id}">
        <span>#${index + 1}</span>
        <input type="text" value="${wind.code}" spellcheck="false" />
        <span>${wind.distanceToAirportKm.toFixed(1)}km</span>
        <button type="button" data-action="update">Update</button>
        <button type="button" data-action="delete">Delete</button>
      </div>
    `
    )
    .join("");

  for (const row of readingsEl.querySelectorAll(".wind-reading-row")) {
    const id = Number(row.dataset.id);
    const input = row.querySelector("input");
    const updateBtn = row.querySelector('[data-action="update"]');
    const deleteBtn = row.querySelector('[data-action="delete"]');

    updateBtn.addEventListener("click", () => {
      const wind = winds.find((item) => item.id === id);
      if (!wind) {
        return;
      }

      const parsed = parseWindCode(input.value.trim());
      if (!parsed.ok) {
        window.alert(parsed.error);
        return;
      }

      wind.code = parsed.code;
      wind.directionFrom = parsed.directionFrom;
      wind.speedKt = parsed.speedKt;
      refreshWindVisual(wind);
      updateResultantVector();
      updateWindSummary();
      renderWindReadings();
      saveWindState();
    });

    deleteBtn.addEventListener("click", () => {
      const index = winds.findIndex((item) => item.id === id);
      if (index === -1) {
        return;
      }

      map.removeLayer(winds[index].marker);
      map.removeLayer(winds[index].line);
      map.removeLayer(winds[index].arrowHead);
      winds.splice(index, 1);
      updateResultantVector();
      updateWindSummary();
      renderWindReadings();
      saveWindState();
    });
  }
}

function createArrowHeadIcon(color, bearingDeg) {
  return L.divIcon({
    html: `<div class="wind-arrowhead" style="border-left-color:${color};transform:rotate(${bearingDeg}deg)"></div>`,
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function offsetLatLng(origin, bearingDeg, distanceKm) {
  const earthRadiusKm = 6371;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lon1 = (origin.lng * Math.PI) / 180;
  const angularDistance = distanceKm / earthRadiusKm;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAd = Math.sin(angularDistance);
  const cosAd = Math.cos(angularDistance);

  const lat2 = Math.asin(sinLat1 * cosAd + cosLat1 * sinAd * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * sinAd * cosLat1,
    cosAd - sinLat1 * Math.sin(lat2)
  );

  return L.latLng((lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI);
}

function normalizeDeg(value) {
  return ((value % 360) + 360) % 360;
}

function parseWindCode(text) {
  const match = /^(\d{3})(\d{2,3})KT$/i.exec(text.toUpperCase());
  if (!match) {
    return {
      ok: false,
      error: "Wind code must look like 31004KT or 12015KT."
    };
  }

  const directionFrom = Number(match[1]);
  const speedKt = Number(match[2]);
  if (!Number.isFinite(directionFrom) || !Number.isFinite(speedKt)) {
    return {
      ok: false,
      error: "Invalid wind code values."
    };
  }

  return {
    ok: true,
    code: `${match[1]}${match[2]}KT`,
    directionFrom: normalizeDeg(directionFrom),
    speedKt
  };
}

function saveWindState() {
  try {
    const payload = {
      windCodeInput: windCodeInput.value.trim() || "31004KT",
      winds: winds.map((wind) => ({
        lat: wind.latlng.lat,
        lng: wind.latlng.lng,
        code: wind.code,
        directionFrom: wind.directionFrom,
        speedKt: wind.speedKt
      }))
    };
    localStorage.setItem(WIND_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Could not save wind state:", error);
  }
}

function restoreWindState() {
  try {
    const raw = localStorage.getItem(WIND_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const state = JSON.parse(raw);
    if (state && typeof state.windCodeInput === "string" && state.windCodeInput.trim()) {
      windCodeInput.value = state.windCodeInput.trim();
    }

    if (!state || !Array.isArray(state.winds)) {
      return;
    }

    for (const item of state.winds) {
      if (!item || !Number.isFinite(item.lat) || !Number.isFinite(item.lng)) {
        continue;
      }

      const code = typeof item.code === "string" ? item.code.trim() : "";
      let parsed = parseWindCode(code);
      if (!parsed.ok && Number.isFinite(item.directionFrom) && Number.isFinite(item.speedKt)) {
        parsed = {
          ok: true,
          code: `${String(Math.round(item.directionFrom)).padStart(3, "0")}${String(
            Math.round(item.speedKt)
          ).padStart(2, "0")}KT`,
          directionFrom: normalizeDeg(item.directionFrom),
          speedKt: item.speedKt
        };
      }

      if (!parsed.ok) {
        continue;
      }

      addWindIndicator(L.latLng(item.lat, item.lng), parsed.directionFrom, parsed.speedKt, parsed.code);
    }
  } catch (error) {
    console.warn("Could not restore wind state:", error);
  }
}

function removeWindState() {
  try {
    localStorage.removeItem(WIND_STORAGE_KEY);
  } catch (error) {
    console.warn("Could not clear wind state:", error);
  }
}

function setActiveTool(toolId) {
  if (toolId !== "quiz") {
    stopFlashcardStudyMode();
  }

  for (const button of toolNavButtons) {
    button.classList.toggle("active", button.dataset.tool === toolId);
  }

  homeToolScreen.classList.toggle("hidden", toolId !== "home");
  mapToolScreen.classList.toggle("hidden", toolId !== "map");
  quizToolScreen.classList.toggle("hidden", toolId !== "quiz");
  guideToolScreen.classList.toggle("hidden", toolId !== "guide");
  wbToolScreen.classList.toggle("hidden", toolId !== "wb");

  if (toolId === "wb") {
    if (!wbToolInitialized) {
      wbToolInitialized = true;
      initWeightBalanceTool(wbToolRoot).catch((error) => {
        console.error("Weight & Balance init failed:", error);
        wbToolInitialized = false;
      });
    }
    setTimeout(() => {
      refreshWeightBalanceChart();
    }, 0);
  }

  if (toolId === "map") {
    // Leaflet needs resize after hidden->visible transition.
    setTimeout(() => {
      map.invalidateSize();
    }, 0);
  }
}

async function loadQuestionBank() {
  try {
    const response = await fetch(QUIZ_BANK_PATH);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    questionBank = parseQuestionsJson(data);
    populateQuizCategoryOptions();
    updateQuizMeta();
    quizCardEl.textContent = "Choose Start Quiz (50) or Start Flashcards.";
  } catch (error) {
    console.error(`Could not load ${QUIZ_BANK_PATH}:`, error);
    questionBank = [];
    selectedQuizCategory = "__all__";
    populateQuizCategoryOptions();
    quizMetaEl.textContent = `Could not load ${QUIZ_BANK_PATH}.`;
    quizCardEl.textContent = "Fix the JSON file, then reload the page.";
  }
}

function startQuizSession() {
  stopFlashcardStudyMode();
  const filteredBank = getFilteredQuestionBank();
  if (filteredBank.length === 0) {
    quizCardEl.textContent = "No questions available for the selected category.";
    return;
  }

  const questions = shuffleArray(filteredBank).slice(0, Math.min(50, filteredBank.length));
  quizState = {
    mode: "quiz",
    questions,
    index: 0,
    score: 0,
    answered: false,
    reveal: false
  };
  renderQuizCard();
}

function startFlashcardSession() {
  stopFlashcardStudyMode();
  const filteredBank = getFilteredQuestionBank();
  if (filteredBank.length === 0) {
    quizCardEl.textContent = "No questions available for the selected category.";
    return;
  }

  quizState = {
    mode: "flashcards",
    questions: shuffleArray(filteredBank),
    index: 0,
    score: 0,
    answered: false,
    reveal: false
  };
  renderQuizCard();
}

function renderQuizCard() {
  if (!quizState || quizState.questions.length === 0) {
    stopFlashcardStudyMode();
    quizCardEl.textContent = "No active quiz session.";
    return;
  }

  const question = quizState.questions[quizState.index];
  const header = `${quizState.mode === "quiz" ? "Quiz" : "Flashcard"} ${quizState.index + 1}/${quizState.questions.length}`;
  const category = question.category ? `Category: ${escapeHtml(question.category)}` : "";
  const options = Object.entries(question.options).filter(([, value]) => value && value.trim());

  if (quizState.mode === "flashcards") {
    const isStudyRunning = flashcardStudyState.running;
    const isLocalTtsLoading = flashcardStudyState.localTtsStatus === "loading";
    const localTtsFailed = flashcardStudyState.localTtsStatus === "error";
    const localTtsHint = isLocalTtsLoading
      ? "Loading local Kitten TTS model (first run downloads ~25MB)..."
      : localTtsFailed
        ? `Local TTS failed: ${escapeHtml(flashcardStudyState.localTtsError || "unknown error")}`
        : "Study mode uses local Kitten TTS in your browser.";
    const questionAnswerDelaySeconds = (flashcardStudyState.questionToAnswerDelayMs / 1000).toFixed(1);
    const betweenQuestionsDelaySeconds = (flashcardStudyState.betweenQuestionsDelayMs / 1000).toFixed(1);
    const speechRate = clampSpeechRate(flashcardStudyState.speechRate);
    const speechRateLabel = speechRate.toFixed(2);
    const ttsDisabledAttr = flashcardStudyState.ttsAvailable ? "" : "disabled";
    const studyToggleDisabledAttr =
      flashcardStudyState.ttsAvailable && !isLocalTtsLoading ? "" : "disabled";
    const studyToggleLabel = isLocalTtsLoading
      ? "Loading Study Mode..."
      : isStudyRunning
        ? "Stop Study Mode"
        : "Start Study Mode";
    let answerHtml = "";
    if (quizState.reveal) {
      const correctText = getFlashcardAnswerText(question);
      answerHtml = `<div class="quiz-feedback"><strong>Answer:</strong> ${escapeHtml(
        correctText
      )}</div>`;
    }

    quizCardEl.innerHTML = `
      <div class="hint">${header}${category ? ` | ${category}` : ""}</div>
      <p class="quiz-question">${escapeHtml(question.question)}</p>
      <div class="flash-study-card">
        <div class="hint">
          ${flashcardStudyState.ttsAvailable ? localTtsHint : "TTS is not available in this browser."}
        </div>
        <div class="flash-delay-row">
          <label for="flash-speech-rate">Speech speed: <span id="flash-speech-rate-value">${speechRateLabel}x</span></label>
          <input
            id="flash-speech-rate"
            type="range"
            min="0.7"
            max="1.4"
            step="0.05"
            value="${speechRateLabel}"
            ${ttsDisabledAttr}
          />
        </div>
        <div class="flash-delay-row">
          <label for="flash-question-answer-delay">Question → Answer delay: <span id="flash-question-answer-delay-value">${questionAnswerDelaySeconds}s</span></label>
          <input
            id="flash-question-answer-delay"
            type="range"
            min="0.5"
            max="15"
            step="0.5"
            value="${questionAnswerDelaySeconds}"
          />
        </div>
        <div class="flash-delay-row">
          <label for="flash-between-questions-delay">Between questions: <span id="flash-between-questions-delay-value">${betweenQuestionsDelaySeconds}s</span></label>
          <input
            id="flash-between-questions-delay"
            type="range"
            min="0.5"
            max="15"
            step="0.5"
            value="${betweenQuestionsDelaySeconds}"
          />
        </div>
      </div>
      ${answerHtml}
      <div class="control-row">
        <button id="flash-reveal-btn" type="button" ${isStudyRunning ? "disabled" : ""}>${quizState.reveal ? "Hide Answer" : "Show Answer"}</button>
        <button id="flash-next-btn" type="button" ${isStudyRunning ? "disabled" : ""}>${quizState.index + 1 >= quizState.questions.length ? "Restart Flashcards" : "Next Card"}</button>
        <button id="flash-study-toggle-btn" type="button" ${studyToggleDisabledAttr}>${studyToggleLabel}</button>
      </div>
    `;

    const revealBtn = document.getElementById("flash-reveal-btn");
    const nextBtn = document.getElementById("flash-next-btn");
    const studyToggleBtn = document.getElementById("flash-study-toggle-btn");
    const speechRateInput = document.getElementById("flash-speech-rate");
    const speechRateValueEl = document.getElementById("flash-speech-rate-value");
    const questionAnswerDelayInput = document.getElementById("flash-question-answer-delay");
    const questionAnswerDelayValueEl = document.getElementById("flash-question-answer-delay-value");
    const betweenQuestionsDelayInput = document.getElementById("flash-between-questions-delay");
    const betweenQuestionsDelayValueEl = document.getElementById("flash-between-questions-delay-value");
    revealBtn.addEventListener("click", () => {
      quizState.reveal = !quizState.reveal;
      renderQuizCard();
    });
    nextBtn.addEventListener("click", () => {
      if (quizState.index + 1 >= quizState.questions.length) {
        startFlashcardSession();
        return;
      }
      quizState.index += 1;
      quizState.reveal = false;
      renderQuizCard();
    });
    studyToggleBtn.addEventListener("click", () => {
      toggleFlashcardStudyMode();
    });
    speechRateInput.addEventListener("input", () => {
      const rate = clampSpeechRate(Number(speechRateInput.value));
      flashcardStudyState.speechRate = rate;
      speechRateValueEl.textContent = `${rate.toFixed(2)}x`;
      if (flashcardStudyState.currentAudioSource) {
        flashcardStudyState.currentAudioSource.playbackRate.value = rate;
      }
    });
    questionAnswerDelayInput.addEventListener("input", () => {
      const seconds = Number(questionAnswerDelayInput.value);
      flashcardStudyState.questionToAnswerDelayMs = Math.round(seconds * 1000);
      questionAnswerDelayValueEl.textContent = `${seconds.toFixed(1)}s`;
    });
    betweenQuestionsDelayInput.addEventListener("input", () => {
      const seconds = Number(betweenQuestionsDelayInput.value);
      flashcardStudyState.betweenQuestionsDelayMs = Math.round(seconds * 1000);
      betweenQuestionsDelayValueEl.textContent = `${seconds.toFixed(1)}s`;
    });
    return;
  }

  stopFlashcardStudyMode();
  const optionsHtml = options
    .map(([key, value]) => {
      const disabled = quizState.answered ? "disabled" : "";
      return `<button class="quiz-option-btn" data-opt="${key}" type="button" ${disabled}>${escapeHtml(
        key
      )}. ${escapeHtml(value)}</button>`;
    })
    .join("");

  let feedbackHtml = "";
  if (quizState.answered) {
    const correctText = question.options[question.correct] || "";
    feedbackHtml = `<div class="quiz-feedback"><strong>Correct:</strong> ${escapeHtml(question.correct)} - ${escapeHtml(
      correctText
    )}</div>`;
  }

  quizCardEl.innerHTML = `
    <div class="hint">${header}${category ? ` | ${category}` : ""} | Score: ${quizState.score}</div>
    <p class="quiz-question">${escapeHtml(question.question)}</p>
    <div class="quiz-options">${optionsHtml || "<div>No options parsed for this question.</div>"}</div>
    ${feedbackHtml}
    <div class="control-row">
      <button id="quiz-next-btn" type="button" ${quizState.answered ? "" : "disabled"}>${quizState.index + 1 >= quizState.questions.length ? "Finish" : "Next Question"}</button>
    </div>
  `;

  for (const btn of quizCardEl.querySelectorAll(".quiz-option-btn")) {
    btn.addEventListener("click", () => {
      if (quizState.answered) {
        return;
      }
      const choice = btn.dataset.opt;
      if (choice === question.correct) {
        quizState.score += 1;
      }
      quizState.answered = true;
      renderQuizCard();
    });
  }

  const nextBtn = document.getElementById("quiz-next-btn");
  nextBtn.addEventListener("click", () => {
    if (!quizState.answered) {
      return;
    }
    if (quizState.index + 1 >= quizState.questions.length) {
      const finalScore = quizState.score;
      const total = quizState.questions.length;
      quizCardEl.innerHTML = `
        <div class="quiz-feedback"><strong>Quiz complete.</strong> Score: ${finalScore}/${total}</div>
        <div class="control-row">
          <button id="quiz-restart-btn" type="button">Start New Quiz</button>
        </div>
      `;
      document.getElementById("quiz-restart-btn").addEventListener("click", () => {
        startQuizSession();
      });
      return;
    }
    quizState.index += 1;
    quizState.answered = false;
    renderQuizCard();
  });
}

function parseQuestionsJson(payload) {
  let records = payload;
  if (payload && !Array.isArray(payload) && Array.isArray(payload.questions)) {
    records = payload.questions;
  }
  if (!Array.isArray(records)) {
    throw new Error("questions.json must be an array or { questions: [] }.");
  }
  return records
    .map((record, index) => normalizeQuestion(record, index))
    .filter((question) => isValidQuestion(question));
}

function normalizeQuestion(record, index) {
  const options = record && typeof record === "object" ? record.options || {} : {};
  return {
    id: String(record?.id || index + 1),
    category: String(record?.category || "").trim(),
    question: String(record?.question || "").trim(),
    options: {
      A: String(options.A || "").trim(),
      B: String(options.B || "").trim(),
      C: String(options.C || "").trim(),
      D: String(options.D || "").trim()
    },
    correct: String(record?.correct || "")
      .trim()
      .toUpperCase()
  };
}

function populateQuizCategoryOptions() {
  const previousSelection = selectedQuizCategory;
  const categories = Array.from(
    new Set(
      questionBank
        .map((question) => question.category)
        .filter((category) => category && category.trim())
    )
  ).sort((a, b) => a.localeCompare(b));

  quizCategorySelect.innerHTML = `
    <option value="__all__">All categories</option>
    ${categories
      .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
      .join("")}
  `;

  if (previousSelection !== "__all__" && categories.includes(previousSelection)) {
    selectedQuizCategory = previousSelection;
  } else {
    selectedQuizCategory = "__all__";
  }
  quizCategorySelect.value = selectedQuizCategory;
}

function getFilteredQuestionBank() {
  if (selectedQuizCategory === "__all__") {
    return questionBank;
  }
  return questionBank.filter((question) => question.category === selectedQuizCategory);
}

function updateQuizMeta() {
  const filteredCount = getFilteredQuestionBank().length;
  const categoryLabel =
    selectedQuizCategory === "__all__" ? "All categories" : selectedQuizCategory;
  quizMetaEl.textContent = `Loaded ${questionBank.length} questions from ${QUIZ_BANK_PATH}. Selected: ${categoryLabel} (${filteredCount}).`;
}

async function toggleFlashcardStudyMode() {
  if (!quizState || quizState.mode !== "flashcards") {
    return;
  }
  if (flashcardStudyState.running) {
    stopFlashcardStudyMode();
    renderQuizCard();
    return;
  }
  const ready = await ensureLocalKittenTtsReady();
  if (!ready || !quizState || quizState.mode !== "flashcards") {
    renderQuizCard();
    return;
  }
  flashcardStudyState.running = true;
  flashcardStudyState.runToken += 1;
  const currentToken = flashcardStudyState.runToken;
  void runFlashcardStudyLoop(currentToken);
  renderQuizCard();
}

function stopFlashcardStudyMode() {
  if (!flashcardStudyState.running) {
    stopCurrentFlashcardAudio();
    return;
  }
  flashcardStudyState.running = false;
  flashcardStudyState.runToken += 1;
  stopCurrentFlashcardAudio();
}

async function runFlashcardStudyLoop(token) {
  while (isFlashcardStudyRunCurrent(token)) {
    const question = quizState.questions[quizState.index];
    quizState.reveal = false;
    renderQuizCard();
    await speakFlashcardText(question.question, token);
    if (!isFlashcardStudyRunCurrent(token)) {
      break;
    }
    await waitMs(flashcardStudyState.questionToAnswerDelayMs);
    if (!isFlashcardStudyRunCurrent(token)) {
      break;
    }
    const answerText = getFlashcardAnswerText(question);
    quizState.reveal = true;
    renderQuizCard();
    await speakFlashcardText(`Answer: ${answerText}`, token);
    if (!isFlashcardStudyRunCurrent(token)) {
      break;
    }
    await waitMs(flashcardStudyState.betweenQuestionsDelayMs);
    if (!isFlashcardStudyRunCurrent(token)) {
      break;
    }
    if (quizState.index + 1 >= quizState.questions.length) {
      quizState.index = 0;
    } else {
      quizState.index += 1;
    }
    quizState.reveal = false;
    renderQuizCard();
  }
  if (flashcardStudyState.runToken === token) {
    flashcardStudyState.running = false;
    renderQuizCard();
  }
}

function isFlashcardStudyRunCurrent(token) {
  return (
    flashcardStudyState.running &&
    flashcardStudyState.runToken === token &&
    quizState &&
    quizState.mode === "flashcards" &&
    quizState.questions.length > 0
  );
}

function getFlashcardAnswerText(question) {
  const answer = question?.options?.[question?.correct];
  return answer && answer.trim() ? answer : String(question?.correct || "").trim();
}

async function speakFlashcardText(text, token) {
  if (!isFlashcardStudyRunCurrent(token) || !flashcardStudyState.ttsAvailable) {
    return;
  }
  if (!text || !text.trim()) {
    return;
  }
  const engine = await ensureLocalKittenTtsReady();
  if (!engine || !isFlashcardStudyRunCurrent(token)) {
    return;
  }
  const trimmed = String(text || "").replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return;
  }
  stopCurrentFlashcardAudio();
  await new Promise(async (resolve) => {
    let finished = false;
    const finalize = () => {
      if (finished) {
        return;
      }
      finished = true;
      if (flashcardStudyState.currentAudioResolve === finalize) {
        flashcardStudyState.currentAudioResolve = null;
      }
      if (flashcardStudyState.currentAudioSource) {
        flashcardStudyState.currentAudioSource.onended = null;
        flashcardStudyState.currentAudioSource = null;
      }
      resolve();
    };
    flashcardStudyState.currentAudioResolve = finalize;
    try {
      const generated = await engine.generate(trimmed, { voice: KITTEN_TTS_VOICE });
      if (!isFlashcardStudyRunCurrent(token)) {
        finalize();
        return;
      }
      const audioContext = getFlashcardAudioContext();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      const source = audioContext.createBufferSource();
      source.buffer = generated.toAudioBuffer(audioContext);
      source.playbackRate.value = clampSpeechRate(flashcardStudyState.speechRate);
      source.connect(audioContext.destination);
      source.onended = finalize;
      flashcardStudyState.currentAudioSource = source;
      source.start(0);
    } catch (error) {
      console.error("Local Kitten TTS playback failed:", error);
      flashcardStudyState.localTtsStatus = "error";
      flashcardStudyState.localTtsError = error?.message || "synthesis failed";
      finalize();
      if (quizState?.mode === "flashcards") {
        renderQuizCard();
      }
    }
  });
}

function stopCurrentFlashcardAudio() {
  const source = flashcardStudyState.currentAudioSource;
  const resolvePlayback = flashcardStudyState.currentAudioResolve;
  flashcardStudyState.currentAudioSource = null;
  flashcardStudyState.currentAudioResolve = null;
  if (source) {
    source.onended = null;
    try {
      source.stop(0);
    } catch {
      // ignore media teardown failures
    }
  }
  if (typeof resolvePlayback === "function") {
    resolvePlayback();
  }
}

function getFlashcardAudioContext() {
  if (
    flashcardStudyState.currentAudioContext &&
    flashcardStudyState.currentAudioContext.state !== "closed"
  ) {
    return flashcardStudyState.currentAudioContext;
  }
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  flashcardStudyState.currentAudioContext = new AudioContextCtor();
  return flashcardStudyState.currentAudioContext;
}

async function ensureLocalKittenTtsReady() {
  if (!flashcardStudyState.ttsAvailable) {
    return null;
  }
  if (flashcardStudyState.kittenEngine) {
    flashcardStudyState.localTtsStatus = "ready";
    return flashcardStudyState.kittenEngine;
  }
  if (flashcardStudyState.kittenEnginePromise) {
    return flashcardStudyState.kittenEnginePromise;
  }

  flashcardStudyState.localTtsStatus = "loading";
  flashcardStudyState.localTtsError = "";
  if (quizState?.mode === "flashcards") {
    renderQuizCard();
  }

  flashcardStudyState.kittenEnginePromise = (async () => {
    try {
      if (!flashcardStudyState.kittenModulePromise) {
        flashcardStudyState.kittenModulePromise = import("https://esm.sh/kitten-tts-js");
      }
      const kittenModule = await flashcardStudyState.kittenModulePromise;
      const KittenTTS = kittenModule?.KittenTTS;
      if (!KittenTTS || typeof KittenTTS.from_pretrained !== "function") {
        throw new Error("KittenTTS package did not load correctly.");
      }

      const preferredRuntime =
        typeof navigator !== "undefined" && "gpu" in navigator ? "gpu" : "cpu";
      let engine;
      try {
        engine = await KittenTTS.from_pretrained(KITTEN_TTS_MODEL_ID, {
          runtime: preferredRuntime
        });
      } catch (runtimeError) {
        if (preferredRuntime !== "cpu") {
          engine = await KittenTTS.from_pretrained(KITTEN_TTS_MODEL_ID, {
            runtime: "cpu"
          });
        } else {
          throw runtimeError;
        }
      }

      flashcardStudyState.kittenEngine = engine;
      flashcardStudyState.localTtsStatus = "ready";
      flashcardStudyState.localTtsError = "";
      return engine;
    } catch (error) {
      console.error("Local Kitten TTS init failed:", error);
      flashcardStudyState.localTtsStatus = "error";
      flashcardStudyState.localTtsError = error?.message || "model load failed";
      return null;
    } finally {
      flashcardStudyState.kittenEnginePromise = null;
      if (quizState?.mode === "flashcards") {
        renderQuizCard();
      }
    }
  })();

  return flashcardStudyState.kittenEnginePromise;
}

function clampSpeechRate(rate) {
  if (!Number.isFinite(rate)) {
    return 1;
  }
  return Math.min(1.4, Math.max(0.7, rate));
}

function waitMs(ms) {
  const duration = Number(ms) > 0 ? Number(ms) : 0;
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

async function loadGuideData() {
  try {
    const response = await fetch(GUIDE_PATH);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    guideData = normalizeGuideData(payload);
    populateGuideSectionOptions();
    guideMetaEl.textContent = `Loaded ${guideData.sections.length} sections for ${guideData.aircraft}.`;
    renderGuide();
  } catch (error) {
    console.error(`Could not load ${GUIDE_PATH}:`, error);
    guideData = null;
    guideSectionSelect.innerHTML = `<option value="__all__">All sections</option>`;
    guideMetaEl.textContent = `Could not load ${GUIDE_PATH}.`;
    guideContentEl.textContent = "Fix the guide JSON file, then reload the page.";
  }
}

function normalizeGuideData(payload) {
  const aircraft = String(payload?.aircraft || "Unknown aircraft").trim();
  const sections = Array.isArray(payload?.sections)
    ? payload.sections
        .map((section, index) => ({
          id: String(section?.id || `section-${index + 1}`).trim(),
          title: String(section?.title || `Section ${index + 1}`).trim(),
          items: Array.isArray(section?.items)
            ? section.items
                .map((item) => ({
                  type: String(item?.type || "note").trim(),
                  label: String(item?.label || "").trim(),
                  value: String(item?.value || "").trim(),
                  note: String(item?.note || "").trim()
                }))
                .filter((item) => item.label || item.value || item.note)
            : []
        }))
        .filter((section) => section.items.length > 0)
    : [];
  return { aircraft, sections };
}

function populateGuideSectionOptions() {
  if (!guideData) {
    guideSectionSelect.innerHTML = `<option value="__all__">All sections</option>`;
    guideSectionSelect.value = "__all__";
    return;
  }
  guideSectionSelect.innerHTML = `
    <option value="__all__">All sections</option>
    ${guideData.sections
      .map((section) => `<option value="${escapeHtml(section.id)}">${escapeHtml(section.title)}</option>`)
      .join("")}
  `;
  guideSectionSelect.value = "__all__";
}

function renderGuide() {
  if (!guideData) {
    guideContentEl.textContent = "No guide loaded.";
    return;
  }

  const sectionFilter = guideSectionSelect.value || "__all__";
  const searchFilter = guideSearchInput.value.trim().toLowerCase();
  const sections = sectionFilter === "__all__"
    ? guideData.sections
    : guideData.sections.filter((section) => section.id === sectionFilter);

  const sectionCards = sections
    .map((section) => {
      const items = section.items.filter((item) => {
        if (!searchFilter) {
          return true;
        }
        const searchable = `${item.type} ${item.label} ${item.value} ${item.note}`.toLowerCase();
        return searchable.includes(searchFilter);
      });

      if (items.length === 0) {
        return "";
      }

      const itemsHtml = items
        .map((item) => {
          const typeBadge = item.type
            ? `<span class="guide-item-type">${escapeHtml(item.type)}</span> `
            : "";
          const label = item.label ? `<strong>${escapeHtml(item.label)}:</strong> ` : "";
          const value = item.value ? `${escapeHtml(item.value)} ` : "";
          const note = item.note ? `<span class="hint">${escapeHtml(item.note)}</span>` : "";
          return `<li>${typeBadge}${label}${value}${note}</li>`;
        })
        .join("");

      return `
        <article class="guide-section-card">
          <h3>${escapeHtml(section.title)}</h3>
          <ul class="guide-list">${itemsHtml}</ul>
        </article>
      `;
    })
    .filter(Boolean);

  if (sectionCards.length === 0) {
    guideContentEl.innerHTML = `<div class="quiz-feedback">No guide entries match your current filters.</div>`;
    return;
  }

  guideContentEl.innerHTML = sectionCards.join("");
}

function isValidQuestion(question) {
  if (!question || !question.question || !question.correct) {
    return false;
  }
  return ["A", "B", "C", "D"].includes(question.correct);
}

function shuffleArray(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
