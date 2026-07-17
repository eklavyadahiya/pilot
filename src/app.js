import { kml as toGeoJsonKml } from "https://esm.sh/@tmcw/togeojson@6.0.0";
import JSZip from "https://esm.sh/jszip@3.10.1";
import {
  initWeightBalanceTool,
  refreshWeightBalanceChart
} from "./tools/weight-balance/ui.js";

const EHHV = [52.1906, 5.1469];
const MAX_REFERENCE_RADIUS_KM = 50;
const WIND_STORAGE_KEY = "pilot-training.wind-data.v1";
const AUDIO_STORAGE_KEY = "pilot-training.audio-data.v1";
const AUDIO_AUTOPLAY_DELAY_MS = 5000;
const KNOWLEDGE_PATH = "./data/dv20-knowledge.json";
const AUDIO_MANIFEST_PATH = "./data/audio-manifest.json";
const FORMULAS_PATH = "./data/ppl-formulas.json";

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
const formulasToolScreen = document.getElementById("formulas-tool-screen");
const wbToolScreen = document.getElementById("wb-tool-screen");
const audioToolScreen = document.getElementById("audio-tool-screen");
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
const formulasMetaEl = document.getElementById("formulas-meta");
const formulasContentEl = document.getElementById("formulas-content");
const windCodeInput = document.getElementById("wind-code-input");
const summaryEl = document.getElementById("wind-summary");
const readingsEl = document.getElementById("wind-readings");
const audioPlayerEl = document.getElementById("audio-player");
const audioPlaylistEl = document.getElementById("audio-playlist");
const audioNowPlayingEl = document.getElementById("audio-now-playing");
const audioPlayToggleBtn = document.getElementById("audio-play-toggle-btn");
const audioPrevBtn = document.getElementById("audio-prev-btn");
const audioNextBtn = document.getElementById("audio-next-btn");
const audioSpeedSelect = document.getElementById("audio-speed-select");
const audioAutoplayToggle = document.getElementById("audio-autoplay-toggle");
const audioRepeatSelect = document.getElementById("audio-repeat-select");
const audioShuffleBtn = document.getElementById("audio-shuffle-btn");
const mathJaxScriptEl = document.getElementById("mathjax-script");

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
let formulasData = null;
let wbToolInitialized = false;
let audioPlaylist = [];
let audioCurrentIndex = -1;
let audioAutoplayAll = true;
let audioRepeatMode = "off";
let audioPlaybackRate = 1;
let pendingAudioAutoplayTimeout = null;
const pendingMathTypesetElements = new Set();

if (mathJaxScriptEl) {
  mathJaxScriptEl.addEventListener("load", () => {
    flushQueuedMathTypeset();
  });
}

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

audioPlayToggleBtn.addEventListener("click", () => {
  toggleAudioPlayback();
});

audioPrevBtn.addEventListener("click", () => {
  const previousIndex = getPreviousAudioIndex();
  if (previousIndex === -1) {
    return;
  }
  playAudioTrack(previousIndex);
});

audioNextBtn.addEventListener("click", () => {
  const nextIndex = getNextAudioIndex();
  if (nextIndex === -1) {
    return;
  }
  playAudioTrack(nextIndex);
});

audioSpeedSelect.addEventListener("change", () => {
  const rate = Number(audioSpeedSelect.value);
  if (!Number.isFinite(rate) || rate <= 0) {
    return;
  }
  audioPlaybackRate = rate;
  audioPlayerEl.playbackRate = rate;
  updateAudioNowPlaying();
  saveAudioState();
});

audioAutoplayToggle.addEventListener("change", () => {
  audioAutoplayAll = Boolean(audioAutoplayToggle.checked);
  saveAudioState();
});

audioRepeatSelect.addEventListener("change", () => {
  const nextMode = audioRepeatSelect.value;
  if (nextMode === "off" || nextMode === "one" || nextMode === "all") {
    audioRepeatMode = nextMode;
    saveAudioState();
  }
});

audioShuffleBtn.addEventListener("click", () => {
  shuffleAudioPlaylist();
});

audioPlayerEl.addEventListener("play", () => {
  updateAudioPlayToggleButton();
  updateAudioNowPlaying();
});

audioPlayerEl.addEventListener("pause", () => {
  updateAudioPlayToggleButton();
  updateAudioNowPlaying();
});

audioPlayerEl.addEventListener("ended", () => {
  handleAudioEnded();
});

audioPlayerEl.addEventListener("loadedmetadata", () => {
  audioPlayerEl.playbackRate = audioPlaybackRate;
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
loadKnowledgeData();
loadFormulasData();
loadAudioPlaylist();
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

async function fetchAudioManifest() {
  try {
    const response = await fetch(AUDIO_MANIFEST_PATH);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

async function loadAudioPlaylist() {
  const manifest = await fetchAudioManifest();
  const files = manifest && Array.isArray(manifest.files) ? manifest.files : [];
  audioPlaylist = files
    .filter((filePath) => typeof filePath === "string" && filePath.trim())
    .map((filePath, index) => {
      const normalizedPath = filePath.trim();
      return {
        id: `audio-track-${index + 1}`,
        path: normalizedPath,
        title: toAudioTitle(normalizedPath)
      };
    });

  restoreAudioState();

  if (audioPlaylist.length === 0) {
    audioCurrentIndex = -1;
    audioPlaylistEl.textContent =
      "No audio files listed in data/audio-manifest.json. Add your MP3 paths there.";
    updateAudioNowPlaying();
    updateAudioPlayToggleButton();
    return;
  }

  if (audioCurrentIndex < 0 || audioCurrentIndex >= audioPlaylist.length) {
    audioCurrentIndex = 0;
  }

  syncAudioPlayerSource(false);
  renderAudioPlaylist();
  updateAudioNowPlaying();
  updateAudioPlayToggleButton();
}

function toAudioTitle(filePath) {
  const fileName = getFileName(filePath);
  const withoutExtension = fileName.replace(/\.mp3$/i, "");
  return withoutExtension
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderAudioPlaylist() {
  if (audioPlaylist.length === 0) {
    audioPlaylistEl.textContent = "No audio tracks available.";
    return;
  }

  audioPlaylistEl.innerHTML = audioPlaylist
    .map((track, index) => {
      const isActive = index === audioCurrentIndex;
      const activeClass = isActive ? " active" : "";
      return `
        <div class="audio-track-row${activeClass}" data-index="${index}">
          <div class="audio-track-main">
            <span class="audio-track-index">${index + 1}.</span>
            <button type="button" data-action="play">Play</button>
            <span class="audio-track-title">${escapeHtml(track.title)}</span>
          </div>
          <div class="audio-track-actions">
            <button type="button" data-action="up" ${index === 0 ? "disabled" : ""}>Up</button>
            <button type="button" data-action="down" ${index === audioPlaylist.length - 1 ? "disabled" : ""}>Down</button>
          </div>
        </div>
      `;
    })
    .join("");

  for (const row of audioPlaylistEl.querySelectorAll(".audio-track-row")) {
    const index = Number(row.dataset.index);
    const playBtn = row.querySelector('[data-action="play"]');
    const upBtn = row.querySelector('[data-action="up"]');
    const downBtn = row.querySelector('[data-action="down"]');

    playBtn.addEventListener("click", () => {
      if (index === audioCurrentIndex && !audioPlayerEl.paused) {
        audioPlayerEl.pause();
        return;
      }
      playAudioTrack(index);
    });
    upBtn.addEventListener("click", () => {
      moveAudioTrack(index, index - 1);
    });
    downBtn.addEventListener("click", () => {
      moveAudioTrack(index, index + 1);
    });
  }
}

function moveAudioTrack(fromIndex, toIndex) {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= audioPlaylist.length ||
    toIndex >= audioPlaylist.length ||
    fromIndex === toIndex
  ) {
    return;
  }

  const currentPath = audioPlaylist[audioCurrentIndex]?.path || null;
  const [moved] = audioPlaylist.splice(fromIndex, 1);
  audioPlaylist.splice(toIndex, 0, moved);

  if (currentPath) {
    audioCurrentIndex = audioPlaylist.findIndex((track) => track.path === currentPath);
  }

  renderAudioPlaylist();
  updateAudioNowPlaying();
  saveAudioState();
}

function shuffleAudioPlaylist() {
  if (audioPlaylist.length <= 1) {
    return;
  }

  const currentPath = audioPlaylist[audioCurrentIndex]?.path || null;
  audioPlaylist = shuffleArray(audioPlaylist);

  if (currentPath) {
    audioCurrentIndex = audioPlaylist.findIndex((track) => track.path === currentPath);
  }
  if (audioCurrentIndex < 0 && audioPlaylist.length > 0) {
    audioCurrentIndex = 0;
  }

  renderAudioPlaylist();
  updateAudioNowPlaying();
  saveAudioState();
}

function playAudioTrack(index) {
  clearPendingAudioAutoplay();
  if (index < 0 || index >= audioPlaylist.length) {
    return;
  }
  audioCurrentIndex = index;
  syncAudioPlayerSource(true);
}

function toggleAudioPlayback() {
  clearPendingAudioAutoplay();
  if (audioPlaylist.length === 0) {
    return;
  }

  if (audioCurrentIndex < 0 || audioCurrentIndex >= audioPlaylist.length) {
    audioCurrentIndex = 0;
    syncAudioPlayerSource(false);
  }

  if (audioPlayerEl.paused) {
    audioPlayerEl.play().catch((error) => {
      console.warn("Audio playback failed:", error);
    });
  } else {
    audioPlayerEl.pause();
  }
}

function syncAudioPlayerSource(autoplay) {
  const track = audioPlaylist[audioCurrentIndex];
  if (!track) {
    audioPlayerEl.removeAttribute("src");
    audioPlayerEl.dataset.trackPath = "";
    audioPlayerEl.load();
    updateAudioNowPlaying();
    updateAudioPlayToggleButton();
    return;
  }

  if (audioPlayerEl.dataset.trackPath !== track.path) {
    audioPlayerEl.src = track.path;
    audioPlayerEl.dataset.trackPath = track.path;
  }

  audioPlayerEl.playbackRate = audioPlaybackRate;
  renderAudioPlaylist();
  updateAudioNowPlaying();
  updateAudioPlayToggleButton();
  saveAudioState();

  if (autoplay) {
    audioPlayerEl.play().catch((error) => {
      console.warn("Audio playback failed:", error);
    });
  }
}

function getNextAudioIndex() {
  if (audioPlaylist.length === 0) {
    return -1;
  }

  const nextIndex = audioCurrentIndex + 1;
  if (nextIndex < audioPlaylist.length) {
    return nextIndex;
  }
  if (audioRepeatMode === "all") {
    return 0;
  }
  return -1;
}

function getPreviousAudioIndex() {
  if (audioPlaylist.length === 0) {
    return -1;
  }
  const previousIndex = audioCurrentIndex - 1;
  if (previousIndex >= 0) {
    return previousIndex;
  }
  if (audioRepeatMode === "all") {
    return audioPlaylist.length - 1;
  }
  return -1;
}

function handleAudioEnded() {
  if (audioRepeatMode === "one") {
    scheduleAudioAutoplay(() => {
      audioPlayerEl.currentTime = 0;
      audioPlayerEl.play().catch((error) => {
        console.warn("Audio replay failed:", error);
      });
    });
    return;
  }

  if (!audioAutoplayAll) {
    updateAudioPlayToggleButton();
    return;
  }

  const nextIndex = getNextAudioIndex();
  if (nextIndex === -1) {
    updateAudioPlayToggleButton();
    return;
  }
  scheduleAudioAutoplay(() => {
    playAudioTrack(nextIndex);
  });
}

function scheduleAudioAutoplay(callback) {
  clearPendingAudioAutoplay();
  pendingAudioAutoplayTimeout = window.setTimeout(() => {
    pendingAudioAutoplayTimeout = null;
    callback();
  }, AUDIO_AUTOPLAY_DELAY_MS);
}

function clearPendingAudioAutoplay() {
  if (pendingAudioAutoplayTimeout === null) {
    return;
  }
  window.clearTimeout(pendingAudioAutoplayTimeout);
  pendingAudioAutoplayTimeout = null;
}

function updateAudioPlayToggleButton() {
  if (audioPlaylist.length === 0 || audioCurrentIndex === -1) {
    audioPlayToggleBtn.textContent = "Play";
    audioPlayToggleBtn.disabled = true;
    audioPrevBtn.disabled = true;
    audioNextBtn.disabled = true;
    return;
  }

  audioPlayToggleBtn.textContent = audioPlayerEl.paused ? "Play" : "Pause";
  audioPlayToggleBtn.disabled = false;
  audioPrevBtn.disabled = false;
  audioNextBtn.disabled = false;
}

function updateAudioNowPlaying() {
  const track = audioPlaylist[audioCurrentIndex];
  if (!track) {
    audioNowPlayingEl.textContent = "No track selected.";
    return;
  }

  const status = audioPlayerEl.paused ? "Paused" : "Playing";
  audioNowPlayingEl.textContent = `${status}: ${track.title} (${audioPlaybackRate.toFixed(2)}x)`;
}

function saveAudioState() {
  try {
    const payload = {
      autoplayAll: audioAutoplayAll,
      repeatMode: audioRepeatMode,
      playbackRate: audioPlaybackRate,
      orderedPaths: audioPlaylist.map((track) => track.path),
      currentPath: audioPlaylist[audioCurrentIndex]?.path || null
    };
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Could not save audio state:", error);
  }
}

function restoreAudioState() {
  try {
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) {
      applyAudioControlValues();
      return;
    }

    const state = JSON.parse(raw);
    if (!state || typeof state !== "object") {
      applyAudioControlValues();
      return;
    }

    if (Array.isArray(state.orderedPaths) && state.orderedPaths.length > 0 && audioPlaylist.length > 0) {
      const byPath = new Map(audioPlaylist.map((track) => [track.path, track]));
      const reordered = [];
      for (const path of state.orderedPaths) {
        const track = byPath.get(path);
        if (track) {
          reordered.push(track);
          byPath.delete(path);
        }
      }
      for (const track of byPath.values()) {
        reordered.push(track);
      }
      audioPlaylist = reordered;
    }

    if (typeof state.autoplayAll === "boolean") {
      audioAutoplayAll = state.autoplayAll;
    }
    if (state.repeatMode === "off" || state.repeatMode === "one" || state.repeatMode === "all") {
      audioRepeatMode = state.repeatMode;
    }
    if (Number.isFinite(state.playbackRate) && state.playbackRate > 0) {
      audioPlaybackRate = state.playbackRate;
    }

    if (typeof state.currentPath === "string" && state.currentPath) {
      audioCurrentIndex = audioPlaylist.findIndex((track) => track.path === state.currentPath);
    }
    if (audioCurrentIndex < 0 && audioPlaylist.length > 0) {
      audioCurrentIndex = 0;
    }
  } catch (error) {
    console.warn("Could not restore audio state:", error);
  }

  applyAudioControlValues();
}

function applyAudioControlValues() {
  audioAutoplayToggle.checked = audioAutoplayAll;
  audioRepeatSelect.value = audioRepeatMode;
  audioSpeedSelect.value = String(audioPlaybackRate);
  audioPlayerEl.playbackRate = audioPlaybackRate;
}

function setActiveTool(toolId) {
  for (const button of toolNavButtons) {
    button.classList.toggle("active", button.dataset.tool === toolId);
  }

  homeToolScreen.classList.toggle("hidden", toolId !== "home");
  mapToolScreen.classList.toggle("hidden", toolId !== "map");
  quizToolScreen.classList.toggle("hidden", toolId !== "quiz");
  guideToolScreen.classList.toggle("hidden", toolId !== "guide");
  formulasToolScreen.classList.toggle("hidden", toolId !== "formulas");
  wbToolScreen.classList.toggle("hidden", toolId !== "wb");
  audioToolScreen.classList.toggle("hidden", toolId !== "audio");

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

  if (toolId === "formulas") {
    queueMathTypeset(formulasContentEl);
  }
}

async function loadFormulasData() {
  try {
    const response = await fetch(FORMULAS_PATH);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    formulasData = normalizeFormulasPayload(payload);
    renderFormulas();
    const formulaCount = formulasData.categories.reduce(
      (count, category) => count + category.formulas.length,
      0
    );
    formulasMetaEl.textContent = `Loaded ${formulaCount} formulas across ${formulasData.categories.length} sections from ${FORMULAS_PATH}.`;
  } catch (error) {
    console.error(`Could not load ${FORMULAS_PATH}:`, error);
    formulasData = null;
    formulasMetaEl.textContent = `Could not load ${FORMULAS_PATH}.`;
    formulasContentEl.textContent = "Fix the formulas JSON file, then reload the page.";
  }
}

function normalizeFormulasPayload(payload) {
  if (!payload || !Array.isArray(payload.categories)) {
    throw new Error("ppl-formulas.json must contain a categories array.");
  }

  return {
    title: String(payload.title || "Formula Reference").trim(),
    source: String(payload.source || "").trim(),
    categories: payload.categories
      .map((category, index) => normalizeFormulaCategory(category, index))
      .filter((category) => category.formulas.length > 0)
  };
}

function normalizeFormulaCategory(category, index) {
  const formulas = Array.isArray(category?.formulas)
    ? category.formulas
        .map((formula, formulaIndex) => normalizeFormulaItem(formula, formulaIndex))
        .filter((formula) => formula.name && formula.latex)
    : [];

  return {
    id: String(category?.id || `section-${index + 1}`),
    title: String(category?.title || `Section ${index + 1}`).trim(),
    formulas
  };
}

function normalizeFormulaItem(formula, index) {
  const variables = Array.isArray(formula?.variables)
    ? formula.variables
        .map((item) => ({
          symbol: String(item?.symbol || "").trim(),
          meaning: String(item?.meaning || "").trim()
        }))
        .filter((item) => item.symbol && item.meaning)
    : [];
  const variations = normalizeFormulaExpressionList(formula?.variations);
  const simplifications = normalizeFormulaExpressionList(formula?.simplifications);

  return {
    id: String(formula?.id || `formula-${index + 1}`),
    name: String(formula?.name || "").trim(),
    latex: String(formula?.latex || "").trim(),
    explanation: String(formula?.explanation || "").trim(),
    useCase: String(formula?.useCase || "").trim(),
    variations,
    simplifications,
    variables
  };
}

function normalizeFormulaExpressionList(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item, index) => ({
      id: String(item?.id || `expr-${index + 1}`),
      name: String(item?.name || "").trim(),
      latex: String(item?.latex || "").trim(),
      explanation: String(item?.explanation || "").trim()
    }))
    .filter((item) => item.latex);
}

function renderFormulas() {
  if (!formulasData || formulasData.categories.length === 0) {
    formulasContentEl.textContent = "No formulas available.";
    return;
  }

  const categoriesHtml = formulasData.categories
    .map((category) => {
      const formulasHtml = category.formulas
        .map((formula, formulaIndex) => {
          const openAttr = formulaIndex === 0 ? " open" : "";
          const variablesHtml = formula.variables.length
            ? `
              <div class="formula-variables">
                <h4>Variables</h4>
                <ul class="formula-variable-list">
                  ${formula.variables
                    .map(
                      (item) => `
                        <li>
                          <span class="formula-var-symbol">\\(${item.symbol}\\)</span>
                          <span>${escapeHtml(item.meaning)}</span>
                        </li>
                      `
                    )
                    .join("")}
                </ul>
              </div>
            `
            : "";

          const meaningHtml = formula.explanation
            ? `<p><strong>What it means:</strong> ${escapeHtml(formula.explanation)}</p>`
            : "";
          const useHtml = formula.useCase
            ? `<p><strong>How to use it:</strong> ${escapeHtml(formula.useCase)}</p>`
            : "";
          const variationsHtml = renderFormulaExpressionSection(
            "Rearrangements and Variations",
            formula.variations,
            "formula-variations"
          );
          const simplificationsHtml = renderFormulaExpressionSection(
            "Simplifications and Rules of Thumb",
            formula.simplifications,
            "formula-simplifications"
          );

          return `
            <details class="formula-item"${openAttr}>
              <summary>
                <span class="formula-item-title">${escapeHtml(formula.name)}</span>
                <span class="formula-item-inline">\\(${formula.latex}\\)</span>
              </summary>
              <div class="formula-item-body">
                <div class="formula-item-math">\\[${formula.latex}\\]</div>
                ${meaningHtml}
                ${useHtml}
                ${variationsHtml}
                ${simplificationsHtml}
                ${variablesHtml}
              </div>
            </details>
          `;
        })
        .join("");

      return `
        <article class="formula-category-card">
          <h3>${escapeHtml(category.title)}</h3>
          <div class="formula-category-list">
            ${formulasHtml}
          </div>
        </article>
      `;
    })
    .join("");

  formulasContentEl.innerHTML = categoriesHtml;
  queueMathTypeset(formulasContentEl);
}

function renderFormulaExpressionSection(title, items, className) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }

  const listHtml = items
    .map((item) => {
      const nameHtml = item.name
        ? `<div class="formula-expression-name">${escapeHtml(item.name)}</div>`
        : "";
      const explanationHtml = item.explanation
        ? `<div class="formula-expression-note">${escapeHtml(item.explanation)}</div>`
        : "";
      return `
        <li class="formula-expression-item">
          ${nameHtml}
          <div class="formula-expression-math">\\(${item.latex}\\)</div>
          ${explanationHtml}
        </li>
      `;
    })
    .join("");

  return `
    <div class="${className}">
      <h4>${title}</h4>
      <ul class="formula-expression-list">
        ${listHtml}
      </ul>
    </div>
  `;
}

function queueMathTypeset(targetEl) {
  if (!targetEl) {
    return;
  }
  if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
    window.MathJax.typesetPromise([targetEl]).catch((error) => {
      console.warn("Math typesetting failed:", error);
    });
    return;
  }
  pendingMathTypesetElements.add(targetEl);
}

function flushQueuedMathTypeset() {
  if (!window.MathJax || typeof window.MathJax.typesetPromise !== "function") {
    return;
  }
  if (pendingMathTypesetElements.size === 0) {
    return;
  }
  const targets = Array.from(pendingMathTypesetElements);
  pendingMathTypesetElements.clear();
  window.MathJax.typesetPromise(targets).catch((error) => {
    console.warn("Math typesetting failed:", error);
  });
}

async function loadKnowledgeData() {
  try {
    const response = await fetch(KNOWLEDGE_PATH);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const entries = parseKnowledgeJson(payload);
    questionBank = buildQuestionBankFromKnowledge(entries);
    guideData = buildGuideFromKnowledge(entries);
    selectedQuizCategory = "__all__";
    populateQuizCategoryOptions();
    updateQuizMeta();
    quizCardEl.textContent = "Choose Start Quiz (50) or Start Flashcards.";
    populateGuideSectionOptions();
    guideMetaEl.textContent = `Loaded ${guideData.sections.length} sections for ${guideData.aircraft}.`;
    renderGuide();
  } catch (error) {
    console.error(`Could not load ${KNOWLEDGE_PATH}:`, error);
    questionBank = [];
    quizState = null;
    selectedQuizCategory = "__all__";
    populateQuizCategoryOptions();
    quizMetaEl.textContent = `Could not load ${KNOWLEDGE_PATH}.`;
    quizCardEl.textContent = "Fix the knowledge JSON file, then reload the page.";
    guideData = null;
    guideSectionSelect.innerHTML = `<option value="__all__">All sections</option>`;
    guideMetaEl.textContent = `Could not load ${KNOWLEDGE_PATH}.`;
    guideContentEl.textContent = "Fix the knowledge JSON file, then reload the page.";
  }
}

function parseKnowledgeJson(payload) {
  let records = payload;
  if (payload && !Array.isArray(payload) && Array.isArray(payload.entries)) {
    records = payload.entries;
  }
  if (!Array.isArray(records)) {
    throw new Error("dv20-knowledge.json must be an array or { entries: [] }.");
  }
  return records
    .map((record, index) => normalizeKnowledgeEntry(record, index))
    .filter((entry) => isValidKnowledgeEntry(entry));
}

function normalizeKnowledgeEntry(record, index) {
  const distractors = Array.isArray(record?.distractors)
    ? record.distractors.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return {
    id: String(record?.id || index + 1),
    category: String(record?.category || "").trim(),
    type: String(record?.type || "").trim().toLowerCase(),
    label: String(record?.label || "").trim(),
    value: String(record?.value || "").trim(),
    note: String(record?.note || "").trim(),
    source: String(record?.source || "").trim(),
    question: String(record?.question || "").trim(),
    explanation: String(record?.explanation || "").trim(),
    distractors
  };
}

function isValidKnowledgeEntry(entry) {
  if (!entry || !entry.question || !entry.value) {
    return false;
  }
  return entry.distractors.length >= 3;
}

function buildQuestionBankFromKnowledge(entries) {
  return entries.map((entry, index) => {
    const optionPool = [
      { text: entry.value, isCorrect: true },
      ...entry.distractors.slice(0, 3).map((text) => ({ text, isCorrect: false }))
    ];
    const shuffledOptions = shuffleArray(optionPool);
    const options = { A: "", B: "", C: "", D: "" };
    let correct = "A";
    for (const [optionIndex, optionKey] of ["A", "B", "C", "D"].entries()) {
      const option = shuffledOptions[optionIndex];
      if (!option) {
        continue;
      }
      options[optionKey] = option.text;
      if (option.isCorrect) {
        correct = optionKey;
      }
    }
    return {
      id: entry.id || String(index + 1),
      category: entry.category,
      question: entry.question,
      options,
      correct,
      source: entry.source,
      explanation: entry.explanation
    };
  });
}

function buildGuideFromKnowledge(entries) {
  const sectionsByCategory = new Map();
  for (const entry of entries) {
    const category = entry.category || "General";
    if (!sectionsByCategory.has(category)) {
      sectionsByCategory.set(category, {
        id: toSectionId(category),
        title: category,
        items: []
      });
    }
    const section = sectionsByCategory.get(category);
    section.items.push({
      type: entry.type || "reference",
      label: entry.label || entry.question,
      value: entry.value,
      note: entry.note,
      source: entry.source
    });
  }
  return {
    aircraft: "DV20 Katana",
    sections: Array.from(sectionsByCategory.values())
  };
}

function toSectionId(value) {
  return String(value || "section")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function startQuizSession() {
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
    selectedChoice: null,
    reveal: false
  };
  renderQuizCard();
}

function startFlashcardSession() {
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
    quizCardEl.textContent = "No active quiz session.";
    return;
  }

  const question = quizState.questions[quizState.index];
  const header = `${quizState.mode === "quiz" ? "Quiz" : "Flashcard"} ${quizState.index + 1}/${quizState.questions.length}`;
  const category = question.category ? `Category: ${escapeHtml(question.category)}` : "";
  const options = Object.entries(question.options).filter(([, value]) => value && value.trim());

  if (quizState.mode === "flashcards") {
    let answerHtml = "";
    if (quizState.reveal) {
      const correctText = getFlashcardAnswerText(question);
      answerHtml = `<div class="quiz-feedback"><strong>Answer:</strong> ${escapeHtml(
        correctText
      )}</div>${renderExplanationHtml(question)}${renderSourceHtml(question)}`;
    }

    quizCardEl.innerHTML = `
      <div class="hint">${header}${category ? ` | ${category}` : ""}</div>
      <p class="quiz-question">${escapeHtml(question.question)}</p>
      ${answerHtml}
      <div class="control-row">
        <button id="flash-reveal-btn" type="button">${quizState.reveal ? "Hide Answer" : "Show Answer"}</button>
        <button id="flash-next-btn" type="button">${quizState.index + 1 >= quizState.questions.length ? "Restart Flashcards" : "Next Card"}</button>
      </div>
    `;

    document.getElementById("flash-reveal-btn").addEventListener("click", () => {
      quizState.reveal = !quizState.reveal;
      renderQuizCard();
    });
    document.getElementById("flash-next-btn").addEventListener("click", () => {
      if (quizState.index + 1 >= quizState.questions.length) {
        startFlashcardSession();
        return;
      }
      quizState.index += 1;
      quizState.reveal = false;
      renderQuizCard();
    });
    return;
  }

  const optionsHtml = options
    .map(([key, value]) => {
      const disabled = quizState.answered ? "disabled" : "";
      let stateClass = "";
      if (quizState.answered) {
        if (key === question.correct) {
          stateClass = " quiz-option-correct";
        } else if (key === quizState.selectedChoice) {
          stateClass = " quiz-option-incorrect";
        }
      }
      return `<button class="quiz-option-btn${stateClass}" data-opt="${key}" type="button" ${disabled}>${escapeHtml(
        key
      )}. ${escapeHtml(value)}</button>`;
    })
    .join("");

  let feedbackHtml = "";
  if (quizState.answered) {
    const correctText = question.options[question.correct] || "";
    const isCorrect = quizState.selectedChoice === question.correct;
    const selectedText = question.options[quizState.selectedChoice] || "";
    const resultLabel = isCorrect ? "Correct" : "Incorrect";
    feedbackHtml = `<div class="quiz-feedback quiz-feedback-${isCorrect ? "correct" : "incorrect"}"><strong>${resultLabel}.</strong> You chose ${escapeHtml(
      quizState.selectedChoice
    )} - ${escapeHtml(selectedText)}. The correct answer is ${escapeHtml(question.correct)} - ${escapeHtml(
      correctText
    )}.</div>${renderExplanationHtml(question)}${renderSourceHtml(question)}`;
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
      quizState.selectedChoice = choice;
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
    quizState.selectedChoice = null;
    renderQuizCard();
  });
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
  quizMetaEl.textContent = `Loaded ${questionBank.length} questions from ${KNOWLEDGE_PATH}. Selected: ${categoryLabel} (${filteredCount}).`;
}

function getFlashcardAnswerText(question) {
  const answer = question?.options?.[question?.correct];
  return answer && answer.trim() ? answer : String(question?.correct || "").trim();
}

function renderExplanationHtml(question) {
  const explanation = question?.explanation && String(question.explanation).trim();
  if (!explanation) {
    return "";
  }
  return `<div class="quiz-explanation"><strong>Explanation:</strong> ${escapeHtml(explanation)}</div>`;
}

function renderSourceHtml(question) {
  const source = question?.source && String(question.source).trim();
  if (!source) {
    return "";
  }
  return `<div class="quiz-source">Source: ${escapeHtml(source)}</div>`;
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
        const searchable = `${item.type} ${item.label} ${item.value} ${item.note} ${item.source}`.toLowerCase();
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
          const source = item.source
            ? `<div class="quiz-source">Source: ${escapeHtml(item.source)}</div>`
            : "";
          return `<li>${typeBadge}${label}${value}${note}${source}</li>`;
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
