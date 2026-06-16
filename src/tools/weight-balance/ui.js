import {
  computeWeightBalance,
  DEFAULT_INPUTS,
  getWarningTargets,
  litersToKg
} from "./engine.js";
import { renderEnvelopeChart } from "./chart.js";
import { runAllParityCases, formatParityReport } from "./parity-check.js";

const WB_STORAGE_KEY = "pilot-training.wb-data.v1";
const AIRCRAFT_PATH = "./data/aircraft.json";
const TYPES_PATH = "./data/aircraft-types.json";
const PARITY_PATH = "./data/wb-parity-cases.json";

const NUMERIC_INPUT_KEYS = new Set([
  "pilotSeatPosition",
  "passengerSeatPosition",
  "pilotKg",
  "frontPassengerKg",
  "leftRearPassengerKg",
  "rightRearPassengerKg",
  "luggageArea1Kg",
  "luggageArea2Kg",
  "extraFuelKg",
  "manualRampFuelKg",
  "climbHours",
  "climbMinutes",
  "cruiseHours",
  "cruiseMinutes",
  "descentHours",
  "descentMinutes",
  "holdingHours",
  "holdingMinutes",
  "alternateHours",
  "alternateMinutes",
  "fuelDensityKgPerL"
]);

let aircraftData = null;
let typeData = null;
let parityCases = [];
let currentInputs = { ...DEFAULT_INPUTS };
let latestResults = null;

export async function initWeightBalanceTool(rootEl) {
  if (!rootEl) {
    return;
  }

  rootEl.innerHTML = `
    <div class="wb-tool">
      <div class="wb-header">
        <h2>Weight &amp; Balance</h2>
        <p class="hint">Converted from W_and_B_Versie_10.03_EFIS.xls — live calculations with envelope chart and EFIS outputs. Your inputs are saved in this browser.</p>
      </div>
      <div id="wb-status" class="hint">Loading aircraft data...</div>
      <div id="wb-content" class="wb-content hidden"></div>
    </div>
  `;

  const statusEl = rootEl.querySelector("#wb-status");
  const contentEl = rootEl.querySelector("#wb-content");

  try {
    const [aircraftRes, typesRes, parityRes] = await Promise.all([
      fetch(AIRCRAFT_PATH),
      fetch(TYPES_PATH),
      fetch(PARITY_PATH)
    ]);
    if (!aircraftRes.ok || !typesRes.ok) {
      throw new Error("Could not load aircraft datasets");
    }
    aircraftData = await aircraftRes.json();
    typeData = await typesRes.json();
    if (parityRes.ok) {
      const parityPayload = await parityRes.json();
      parityCases = Array.isArray(parityPayload.cases) ? parityPayload.cases : [];
    }
    restoreState();
    renderLayout(contentEl);
    recomputeAndRender(contentEl);
    saveState();
    statusEl.classList.add("hidden");
    contentEl.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    statusEl.textContent =
      "Could not load Weight & Balance data. Run a local server (see README) so JSON files can be fetched.";
    contentEl.classList.add("hidden");
  }
}

function normalizeSavedInputs(saved) {
  const merged = { ...DEFAULT_INPUTS, ...saved };
  for (const key of NUMERIC_INPUT_KEYS) {
    if (merged[key] !== undefined && merged[key] !== "") {
      merged[key] = Number(merged[key]);
    }
  }
  if (typeof merged.aircraftId === "string") {
    merged.aircraftId = merged.aircraftId.trim();
  }
  if (merged.fuelInputUnit !== "liters") {
    merged.fuelInputUnit = "kg";
  }
  if (merged.rampFuelMode !== "manual") {
    merged.rampFuelMode = "calculated";
  }
  return merged;
}

function restoreState() {
  try {
    const raw = localStorage.getItem(WB_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw);
    if (saved && typeof saved === "object") {
      currentInputs = normalizeSavedInputs(saved);
    }
  } catch (error) {
    console.warn("Could not restore WB state:", error);
  }
}

function saveState() {
  try {
    localStorage.setItem(WB_STORAGE_KEY, JSON.stringify(currentInputs));
  } catch (error) {
    console.warn("Could not save WB state:", error);
  }
}

function renderLayout(contentEl) {
  const selectable = aircraftData.aircraft.filter((a) => a.chooseIndex !== null);
  const aircraftOptions = selectable
    .map(
      (a) =>
        `<option value="${escapeAttr(a.id)}" ${a.id === currentInputs.aircraftId ? "selected" : ""}>${escapeHtml(a.registration)} (${escapeHtml(a.model)})</option>`
    )
    .join("");

  contentEl.innerHTML = `
    <div class="wb-grid">
      <section class="wb-panel">
        <h3>Flight Setup</h3>
        <div class="wb-form-grid">
          <label for="wb-aircraft">Aircraft</label>
          <select id="wb-aircraft">${aircraftOptions}</select>

          <label for="wb-pilot-seat">Pilot seat position</label>
          <select id="wb-pilot-seat">
            <option value="1">Front</option>
            <option value="2">Middle</option>
            <option value="3">Back</option>
          </select>

          <label for="wb-passenger-seat">Front passenger seat</label>
          <select id="wb-passenger-seat">
            <option value="1">Front</option>
            <option value="2">Middle</option>
            <option value="3">Back</option>
          </select>

          <label for="wb-pilot-kg">Pilot (kg)</label>
          <input id="wb-pilot-kg" type="number" min="0" step="0.1" />

          <label for="wb-front-kg">Front passenger (kg)</label>
          <input id="wb-front-kg" type="number" min="0" step="0.1" />

          <label for="wb-left-rear-kg">Left rear (kg)</label>
          <input id="wb-left-rear-kg" type="number" min="0" step="0.1" />

          <label for="wb-right-rear-kg">Right rear (kg)</label>
          <input id="wb-right-rear-kg" type="number" min="0" step="0.1" />

          <label for="wb-bag1-kg">Luggage area 1 (kg)</label>
          <input id="wb-bag1-kg" type="number" min="0" step="0.1" />

          <label for="wb-bag2-kg">Luggage area 2 (kg)</label>
          <input id="wb-bag2-kg" type="number" min="0" step="0.1" />
        </div>
      </section>

      <section class="wb-panel">
        <h3>Fuel</h3>
        <div class="wb-form-grid">
          <label for="wb-fuel-unit">Fuel input unit</label>
          <select id="wb-fuel-unit">
            <option value="kg">Kilograms (kg)</option>
            <option value="liters">Liters (l)</option>
          </select>

          <label for="wb-fuel-density">Fuel density (kg/l)</label>
          <input id="wb-fuel-density" type="number" min="0.1" step="0.01" />

          <label for="wb-ramp-mode">Ramp fuel</label>
          <select id="wb-ramp-mode">
            <option value="calculated">From endurance plan</option>
            <option value="manual">Enter manually</option>
          </select>

          <label for="wb-extra-fuel" id="wb-extra-fuel-label">Extra fuel</label>
          <input id="wb-extra-fuel" type="number" min="0" step="0.1" />

          <label for="wb-manual-ramp" id="wb-manual-ramp-label">Manual ramp fuel</label>
          <input id="wb-manual-ramp" type="number" min="0" step="0.1" />
        </div>
      </section>

      <section class="wb-panel">
        <h3>Endurance / Fuel Planning</h3>
        <div class="wb-form-grid">
          <label>Climb time (h:m)</label>
          <div class="wb-time-pair">
            <input id="wb-climb-h" type="number" min="0" step="1" />
            <input id="wb-climb-m" type="number" min="0" max="59" step="1" />
          </div>
          <label>Cruise time (h:m)</label>
          <div class="wb-time-pair">
            <input id="wb-cruise-h" type="number" min="0" step="1" />
            <input id="wb-cruise-m" type="number" min="0" max="59" step="1" />
          </div>
          <label>Descent time (h:m)</label>
          <div class="wb-time-pair">
            <input id="wb-descent-h" type="number" min="0" step="1" />
            <input id="wb-descent-m" type="number" min="0" max="59" step="1" />
          </div>
          <label>Holding time (h:m)</label>
          <div class="wb-time-pair">
            <input id="wb-hold-h" type="number" min="0" step="1" />
            <input id="wb-hold-m" type="number" min="0" max="59" step="1" />
          </div>
          <label>Alternate time (h:m)</label>
          <div class="wb-time-pair">
            <input id="wb-alt-h" type="number" min="0" step="1" />
            <input id="wb-alt-m" type="number" min="0" max="59" step="1" />
          </div>
        </div>
      </section>

      <section class="wb-panel wb-panel-wide">
        <h3>Take-off Summary</h3>
        <div id="wb-tow-summary" class="wb-tow-summary"></div>
      </section>

      <section class="wb-panel wb-panel-wide">
        <h3>Weight &amp; Balance Results</h3>
        <div id="wb-warnings" class="wb-warnings"></div>
        <div id="wb-results-table" class="wb-results-table"></div>
        <details class="wb-reference-details">
          <summary>Full-tank reference (informational)</summary>
          <div id="wb-full-fuel-ref" class="wb-full-fuel-ref"></div>
        </details>
        <p id="wb-endurance" class="wb-endurance"></p>
      </section>

      <section class="wb-panel wb-panel-wide">
        <h3>Envelope Chart</h3>
        <canvas id="wb-chart" class="wb-chart" width="900" height="480" aria-label="Weight and balance envelope chart"></canvas>
      </section>

      <section class="wb-panel wb-panel-wide">
        <h3>EFIS Export Values</h3>
        <div id="wb-efis" class="wb-efis-grid"></div>
      </section>

      <section class="wb-panel wb-panel-wide">
        <h3>Parity Check</h3>
        <div class="control-row">
          <button id="wb-run-parity" type="button">Run Parity Cases</button>
        </div>
        <pre id="wb-parity-output" class="wb-parity-output">Parity cases not run yet.</pre>
      </section>
    </div>
  `;

  bindInputs(contentEl);
  applyInputsToForm(contentEl);
}

function fuelUnitLabel(unit) {
  return unit === "liters" ? "l" : "kg";
}

function displayFuelKg(kg, unit, density) {
  if (unit === "liters") {
    return roundDisplay(kg / density, 1);
  }
  return roundDisplay(kg, 1);
}

function parseFuelInput(value, unit, density) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  if (unit === "liters") {
    return litersToKg(parsed, density);
  }
  return parsed;
}

function roundDisplay(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function updateFuelFieldLabels(contentEl) {
  const unit = currentInputs.fuelInputUnit === "liters" ? "liters" : "kg";
  const suffix = fuelUnitLabel(unit);
  const extraLabel = contentEl.querySelector("#wb-extra-fuel-label");
  const rampLabel = contentEl.querySelector("#wb-manual-ramp-label");
  if (extraLabel) {
    extraLabel.textContent = `Extra fuel (${suffix})`;
  }
  if (rampLabel) {
    rampLabel.textContent = `Manual ramp fuel (${suffix})`;
  }
  const manualRamp = contentEl.querySelector("#wb-manual-ramp");
  if (manualRamp) {
    manualRamp.disabled = currentInputs.rampFuelMode !== "manual";
  }
}

function bindInputs(contentEl) {
  const fields = [
    ["wb-aircraft", "aircraftId", "string"],
    ["wb-pilot-seat", "pilotSeatPosition", "number"],
    ["wb-passenger-seat", "passengerSeatPosition", "number"],
    ["wb-pilot-kg", "pilotKg", "number"],
    ["wb-front-kg", "frontPassengerKg", "number"],
    ["wb-left-rear-kg", "leftRearPassengerKg", "number"],
    ["wb-right-rear-kg", "rightRearPassengerKg", "number"],
    ["wb-bag1-kg", "luggageArea1Kg", "number"],
    ["wb-bag2-kg", "luggageArea2Kg", "number"],
    ["wb-fuel-density", "fuelDensityKgPerL", "number"],
    ["wb-climb-h", "climbHours", "number"],
    ["wb-climb-m", "climbMinutes", "number"],
    ["wb-cruise-h", "cruiseHours", "number"],
    ["wb-cruise-m", "cruiseMinutes", "number"],
    ["wb-descent-h", "descentHours", "number"],
    ["wb-descent-m", "descentMinutes", "number"],
    ["wb-hold-h", "holdingHours", "number"],
    ["wb-hold-m", "holdingMinutes", "number"],
    ["wb-alt-h", "alternateHours", "number"],
    ["wb-alt-m", "alternateMinutes", "number"]
  ];

  for (const [id, key, kind] of fields) {
    const el = contentEl.querySelector(`#${id}`);
    if (!el) {
      continue;
    }
    const syncFromField = () => {
      if (kind === "string") {
        currentInputs[key] = el.value;
      } else {
        const parsed = Number(el.value);
        currentInputs[key] = Number.isFinite(parsed) ? parsed : 0;
      }
      saveState();
      recomputeAndRender(contentEl);
    };
    el.addEventListener("input", syncFromField);
    el.addEventListener("change", syncFromField);
  }

  const fuelUnitEl = contentEl.querySelector("#wb-fuel-unit");
  fuelUnitEl?.addEventListener("change", () => {
    currentInputs.fuelInputUnit = fuelUnitEl.value === "liters" ? "liters" : "kg";
    updateFuelFieldLabels(contentEl);
    applyFuelInputsToForm(contentEl);
    saveState();
    recomputeAndRender(contentEl);
  });

  const rampModeEl = contentEl.querySelector("#wb-ramp-mode");
  rampModeEl?.addEventListener("change", () => {
    currentInputs.rampFuelMode = rampModeEl.value === "manual" ? "manual" : "calculated";
    updateFuelFieldLabels(contentEl);
    saveState();
    recomputeAndRender(contentEl);
  });

  const syncExtraFuel = () => {
    const el = contentEl.querySelector("#wb-extra-fuel");
    currentInputs.extraFuelKg = parseFuelInput(
      el?.value,
      currentInputs.fuelInputUnit,
      currentInputs.fuelDensityKgPerL
    );
    saveState();
    recomputeAndRender(contentEl);
  };
  contentEl.querySelector("#wb-extra-fuel")?.addEventListener("input", syncExtraFuel);
  contentEl.querySelector("#wb-extra-fuel")?.addEventListener("change", syncExtraFuel);

  const syncManualRamp = () => {
    const el = contentEl.querySelector("#wb-manual-ramp");
    currentInputs.manualRampFuelKg = parseFuelInput(
      el?.value,
      currentInputs.fuelInputUnit,
      currentInputs.fuelDensityKgPerL
    );
    saveState();
    recomputeAndRender(contentEl);
  };
  contentEl.querySelector("#wb-manual-ramp")?.addEventListener("input", syncManualRamp);
  contentEl.querySelector("#wb-manual-ramp")?.addEventListener("change", syncManualRamp);

  updateFuelFieldLabels(contentEl);

  contentEl.querySelector("#wb-run-parity")?.addEventListener("click", () => {
    runParity(contentEl);
  });
}

function applyFuelInputsToForm(contentEl) {
  const unit = currentInputs.fuelInputUnit === "liters" ? "liters" : "kg";
  const density = currentInputs.fuelDensityKgPerL;
  const extraEl = contentEl.querySelector("#wb-extra-fuel");
  const rampEl = contentEl.querySelector("#wb-manual-ramp");
  if (extraEl) {
    extraEl.value = displayFuelKg(currentInputs.extraFuelKg, unit, density);
  }
  if (rampEl) {
    rampEl.value = displayFuelKg(currentInputs.manualRampFuelKg, unit, density);
  }
}

function applyInputsToForm(contentEl) {
  const map = {
    "wb-aircraft": currentInputs.aircraftId,
    "wb-pilot-seat": currentInputs.pilotSeatPosition,
    "wb-passenger-seat": currentInputs.passengerSeatPosition,
    "wb-pilot-kg": currentInputs.pilotKg,
    "wb-front-kg": currentInputs.frontPassengerKg,
    "wb-left-rear-kg": currentInputs.leftRearPassengerKg,
    "wb-right-rear-kg": currentInputs.rightRearPassengerKg,
    "wb-bag1-kg": currentInputs.luggageArea1Kg,
    "wb-bag2-kg": currentInputs.luggageArea2Kg,
    "wb-fuel-unit": currentInputs.fuelInputUnit,
    "wb-fuel-density": currentInputs.fuelDensityKgPerL,
    "wb-ramp-mode": currentInputs.rampFuelMode,
    "wb-climb-h": currentInputs.climbHours,
    "wb-climb-m": currentInputs.climbMinutes,
    "wb-cruise-h": currentInputs.cruiseHours,
    "wb-cruise-m": currentInputs.cruiseMinutes,
    "wb-descent-h": currentInputs.descentHours,
    "wb-descent-m": currentInputs.descentMinutes,
    "wb-hold-h": currentInputs.holdingHours,
    "wb-hold-m": currentInputs.holdingMinutes,
    "wb-alt-h": currentInputs.alternateHours,
    "wb-alt-m": currentInputs.alternateMinutes
  };
  for (const [id, value] of Object.entries(map)) {
    const el = contentEl.querySelector(`#${id}`);
    if (el) {
      el.value = value;
    }
  }
  updateFuelFieldLabels(contentEl);
  applyFuelInputsToForm(contentEl);
}

function recomputeAndRender(contentEl) {
  if (!aircraftData || !typeData) {
    return;
  }
  latestResults = computeWeightBalance(
    currentInputs,
    aircraftData.aircraft,
    typeData.aircraftTypes,
    aircraftData.constants
  );
  renderTowSummary(contentEl, latestResults);
  renderResults(contentEl, latestResults);
  renderWarnings(contentEl, latestResults);
  renderEfis(contentEl, latestResults);
  const canvas = contentEl.querySelector("#wb-chart");
  renderEnvelopeChart(canvas, latestResults.chartPoints, latestResults.envelope);
}

function fmt(value, digits = 1) {
  return Number(value).toFixed(digits);
}

function renderTowSummary(contentEl, results) {
  const el = contentEl.querySelector("#wb-tow-summary");
  const s = results.takeoffSummary;
  const perf = s.performance;
  const statusClass = s.isOperational ? "wb-tow-ok" : "wb-tow-alert";

  el.innerHTML = `
    <div class="wb-tow-card ${statusClass}">
      <div class="wb-tow-metrics">
        <div>
          <span class="wb-tow-label">Take-off weight</span>
          <strong>${fmt(s.weightKg)} kg</strong>
          <span class="hint">max ${fmt(s.maxWeightKg)} kg · margin ${fmt(s.marginKg)} kg</span>
        </div>
        <div>
          <span class="wb-tow-label">Take-off arm</span>
          <strong>${fmt(s.armM, 3)} m</strong>
          <span class="hint">${fmt(s.minArmM, 3)} – ${fmt(s.maxArmM, 3)} m</span>
        </div>
        <div>
          <span class="wb-tow-label">Take-off fuel</span>
          <strong>${fmt(s.takeoffFuelKg)} kg</strong>
          <span class="hint">${fmt(s.takeoffFuelLiters, 1)} l</span>
        </div>
        <div>
          <span class="wb-tow-label">Landing weight</span>
          <strong>${fmt(s.landingWeightKg)} kg</strong>
        </div>
      </div>
      <div class="wb-tow-performance">
        <h4>Performance at take-off (type data)</h4>
        <ul>
          <li><strong>Climb:</strong> ${perf.climb.tasKts} kts · ${perf.climb.fuelKgHr} kg/hr · ${escapeHtml(perf.climb.setting)} · ${perf.climb.ftMin} ft/min</li>
          <li><strong>Cruise:</strong> ${perf.cruise.tasKts} kts · ${perf.cruise.fuelKgHr} kg/hr · ${escapeHtml(perf.cruise.setting)}</li>
          <li><strong>Descent:</strong> ${perf.descent.tasKts} kts · ${perf.descent.fuelKgHr} kg/hr · ${escapeHtml(perf.descent.setting)} · ${perf.descent.ftMin} ft/min</li>
        </ul>
      </div>
    </div>
  `;
}

function renderResults(contentEl, results) {
  const tableEl = contentEl.querySelector("#wb-results-table");
  const fullFuelEl = contentEl.querySelector("#wb-full-fuel-ref");
  const enduranceEl = contentEl.querySelector("#wb-endurance");
  const warningTargets = getWarningTargets(results.warnings);

  function cellClass(target) {
    const severity = warningTargets.get(target);
    if (severity === "danger") {
      return "wb-warn-danger";
    }
    if (severity === "caution") {
      return "wb-warn-caution";
    }
    return "";
  }

  const rows = [
    ["Empty weight", results.empty.weightKg, results.empty.armM, results.empty.momentMkg, "", ""],
    ["Pilot", results.pilot.weightKg, results.pilot.armM, results.pilot.momentMkg, "pilot.weightKg", ""],
    ["Front passenger", results.frontPassenger.weightKg, results.frontPassenger.armM, results.frontPassenger.momentMkg, "frontPassenger.weightKg", ""],
    ["Rear passengers", results.rearPassengers.weightKg, results.rearPassengers.armM, results.rearPassengers.momentMkg, "rearPassengers.weightKg", ""],
    ["Luggage area 1", results.luggageArea1.weightKg, results.luggageArea1.armM, results.luggageArea1.momentMkg, "luggageArea1.weightKg", ""],
    ["Luggage area 2", results.luggageArea2.weightKg, results.luggageArea2.armM, results.luggageArea2.momentMkg, "luggageArea2.weightKg", ""],
    ["Zero fuel weight", results.zeroFuel.weightKg, results.zeroFuel.armM, results.zeroFuel.momentMkg, "zeroFuel.weightKg", "zeroFuel.armM"],
    ["Ramp weight", results.ramp.weightKg, results.ramp.armM, results.ramp.momentMkg, "", ""],
    ["Take-off weight (TOW)", results.takeoff.weightKg, results.takeoff.armM, results.takeoff.momentMkg, "takeoff.weightKg", "takeoff.armM", true],
    ["Landing weight", results.landing.weightKg, results.landing.armM, results.landing.momentMkg, "landing.weightKg", "landing.armM"]
  ];

  const fuelRows = [
    ["Max tank capacity", results.fuel.maxKg, results.fuel.maxLiters],
    ["Planned ramp fuel", results.fuel.rampKg, results.fuel.rampLiters],
    ["Trip fuel", results.fuel.tripKg, results.fuel.tripLiters],
    ["Take-off fuel", results.fuel.takeoffKg, results.fuel.takeoffLiters],
    ["Remaining fuel", results.fuel.remainingKg, results.fuel.remainingLiters]
  ];

  tableEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Weight (kg)</th>
          <th>Arm (m)</th>
          <th>Moment (m·kg)</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            ([label, weight, arm, moment, weightTarget, armTarget, highlight]) => `
          <tr class="${highlight ? "wb-row-highlight" : ""}">
            <td>${escapeHtml(label)}</td>
            <td class="${cellClass(weightTarget)}">${weight === "" ? "—" : fmt(weight)}</td>
            <td class="${cellClass(armTarget)}">${arm === "" ? "—" : fmt(arm, 3)}</td>
            <td>${moment === "" ? "—" : fmt(moment, 2)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
    <h4 class="wb-fuel-heading">Fuel quantities</h4>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>kg</th>
          <th>liters</th>
        </tr>
      </thead>
      <tbody>
        ${fuelRows
          .map(
            ([label, kg, liters]) => `
          <tr>
            <td>${escapeHtml(label)}</td>
            <td class="${label.includes("Planned") ? cellClass("fuel.rampKg") : ""}">${fmt(kg)}</td>
            <td>${fmt(liters, 1)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
    <p class="hint">Aircraft: ${escapeHtml(results.metadata.registration)} · ${escapeHtml(results.metadata.model)} · Weigh date: ${escapeHtml(results.metadata.weighDate || "—")}${results.fuel.rampFromManualOverride ? " · Ramp fuel: manual entry" : ""}</p>
  `;

  fullFuelEl.innerHTML = `
    <p class="hint">What-if scenario if you filled the tanks at current zero-fuel loading.</p>
    <table>
      <tr><th>Full fuel weight</th><td>${fmt(results.fullFuel.weightKg)} kg</td></tr>
      <tr><th>Arm</th><td>${fmt(results.fullFuel.armM, 3)} m</td></tr>
      <tr><th>Moment</th><td>${fmt(results.fullFuel.momentMkg, 2)} m·kg</td></tr>
      <tr><th>Max ramp limit</th><td>${fmt(results.fullFuel.maxRampKg)} kg</td></tr>
    </table>
  `;

  enduranceEl.textContent = `Endurance: ${results.endurance.totalText} · Tank capacity: ${fmt(results.fuel.maxLiters, 1)} l (${fmt(results.fuel.maxGallons, 1)} gal)`;
}

function renderWarnings(contentEl, results) {
  const warningsEl = contentEl.querySelector("#wb-warnings");
  const operational = results.warnings.operational || [];
  const informational = results.warnings.informational || [];

  if (!operational.length && !informational.length) {
    warningsEl.innerHTML = `<div class="wb-warning-ok">Take-off weight and balance are within limits.</div>`;
    return;
  }

  let html = "";
  if (operational.length) {
    html += `<div class="wb-warning-group"><h4>Operational limits</h4>${operational
      .map(
        (warning) =>
          `<div class="wb-warning wb-warning-${warning.severity}">${escapeHtml(warning.message)}</div>`
      )
      .join("")}</div>`;
  } else {
    html += `<div class="wb-warning-ok">Take-off weight and balance are within limits.</div>`;
  }
  if (informational.length) {
    html += `<div class="wb-warning-group wb-warning-group-info"><h4>Reference notes</h4>${informational
      .map(
        (warning) =>
          `<div class="wb-warning wb-warning-info">${escapeHtml(warning.message)}</div>`
      )
      .join("")}</div>`;
  }
  warningsEl.innerHTML = html;
}

function renderEfis(contentEl, results) {
  const efis = results.efis;
  const efisEl = contentEl.querySelector("#wb-efis");
  efisEl.innerHTML = `
    <div><strong>Registration</strong><span>${escapeHtml(efis.registration)}</span></div>
    <div><strong>Type/Model</strong><span>${escapeHtml(efis.model)}</span></div>
    <div><strong>Start/taxi (kg)</strong><span>${efis.startTaxiKg}</span></div>
    <div><strong>Climb TAS / cons</strong><span>${efis.performance.climbTasKts} kts / ${efis.performance.climbConsKgHr} kg/hr</span></div>
    <div><strong>Cruise TAS / cons</strong><span>${efis.performance.cruiseTasKts} kts / ${efis.performance.cruiseConsKgHr} kg/hr</span></div>
    <div><strong>Descent TAS / cons</strong><span>${efis.performance.descentTasKts} kts / ${efis.performance.descentConsKgHr} kg/hr</span></div>
    <div><strong>Ramp (kg)</strong><span>${efis.schedule.rampKg}</span></div>
    <div><strong>Take-off (kg)</strong><span>${efis.schedule.takeoffKg}</span></div>
    <div><strong>Landing (kg)</strong><span>${efis.schedule.landingKg}</span></div>
    <div><strong>Zero fuel (kg)</strong><span>${efis.schedule.zeroFuelKg}</span></div>
    <div><strong>APS (cm)</strong><span>${efis.stations.apsCm}</span></div>
    <div><strong>Fuel arm (cm)</strong><span>${efis.stations.fuelCm}</span></div>
    <div><strong>Row1 (cm)</strong><span>${efis.stations.row1Cm}</span></div>
    <div><strong>Row2 (cm)</strong><span>${efis.stations.row2Cm}</span></div>
    <div><strong>Bag1 (cm)</strong><span>${efis.stations.bag1Cm}</span></div>
    <div><strong>Bag2 (cm)</strong><span>${efis.stations.bag2Cm}</span></div>
    <div><strong>Graph min weight</strong><span>${efis.graph.minWeightKg}</span></div>
    <div><strong>Graph weight interval</strong><span>${efis.graph.weightGridInterval}</span></div>
    <div><strong>Graph min arm (cm)</strong><span>${efis.graph.minArmCm}</span></div>
    <div><strong>Graph arm interval</strong><span>${efis.graph.armGridInterval}</span></div>
  `;
}

function runParity(contentEl) {
  const outputEl = contentEl.querySelector("#wb-parity-output");
  if (!parityCases.length) {
    outputEl.textContent = "No parity cases loaded.";
    return;
  }
  const results = runAllParityCases(
    parityCases,
    aircraftData.aircraft,
    typeData.aircraftTypes,
    aircraftData.constants
  );
  outputEl.textContent = formatParityReport(results);
}

export function refreshWeightBalanceChart() {
  const canvas = document.querySelector("#wb-chart");
  if (canvas && latestResults) {
    renderEnvelopeChart(canvas, latestResults.chartPoints, latestResults.envelope);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
