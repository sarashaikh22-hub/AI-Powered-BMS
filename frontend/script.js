
"use strict";

/* =========================================================
   POWERAI - BATTERY INTELLIGENCE DASHBOARD
   API: FastAPI at http://127.0.0.1:8000
========================================================= */

const API_BASE = "https://ai-powered-bms.onrender.com";
const BATTERY_IDS = ["B0005", "B0006", "B0007", "B0018"];

let dashboardData = null;
let advancedData = null;
let advisorData = null;
let comparisonData = null;

let charts = {
  capacity: null,
  voltage: null,
  temperature: null,
  forecast: null,
  comparison: null,
  cycleComparison: null,
  twin: null
};

/* =========================================================
   HELPERS
========================================================= */

const $ = (id) => document.getElementById(id);

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value ?? "—";
}

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" &&
    Number.isFinite(number) ? number.toFixed(decimals) : "—";
}

function formatPercent(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" &&
    Number.isFinite(number) ? `${number.toFixed(1)}%` : "—";
}

function getFirst(object, keys, fallback = null) {
  if (!object || typeof object !== "object") return fallback;

  for (const key of keys) {
    if (
      object[key] !== undefined &&
      object[key] !== null &&
      object[key] !== ""
    ) {
      return object[key];
    }
  }

  return fallback;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return replacements[character];
  });
}

function getSelectedBattery() {
  return $("batterySelect")?.value || "B0005";
}

function setMessage(id, message, type = "") {
  const element = $(id);
  if (!element) return;

  element.textContent = message;
  element.className = `form-message ${type}`.trim();
}

function setLoading(buttonId, loading, normalText) {
  const button = $(buttonId);
  if (!button) return;

  button.disabled = loading;
  button.textContent = loading ? "Please wait..." : normalText;
}

function showConnection(connected) {
  const label = connected ? "Backend Connected" : "Backend Offline";

  setText("connectionStatus", label);
  setText("systemStatus", connected ? "System Online" : "Connection Error");

  const status = $("systemStatus");
  if (status) {
    status.style.color = connected ? "#4bd6a0" : "#ff7185";
  }
}

async function apiRequest(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  let result;

  try {
    result = await response.json();
  } catch {
    result = {};
  }

  if (!response.ok) {
    throw new Error(
      result.detail || result.message || `Request failed (${response.status})`
    );
  }

  return result;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCycle(cycle, index) {
  return {
    cycle: Number(
      getFirst(cycle, ["cycle", "cycle_number", "cycle_id"], index + 1)
    ),
    capacity: Number(
      getFirst(cycle, [
        "capacity",
        "discharge_capacity",
        "capacity_ah",
        "measured_capacity"
      ])
    ),
    voltage: Number(
      getFirst(cycle, [
        "avg_voltage",
        "average_voltage",
        "voltage",
        "mean_voltage"
      ])
    ),
    temperature: Number(
      getFirst(cycle, [
        "avg_temperature",
        "average_temperature",
        "temperature",
        "mean_temperature"
      ])
    )
  };
}

function getCycles(data) {
  const raw = getFirst(data, [
    "cycles",
    "chart_data",
    "cycle_data",
    "readings"
  ], []);

  return normalizeArray(raw)
    .map(normalizeCycle)
    .filter((item) => Number.isFinite(item.cycle));
}

function destroyChart(name) {
  if (charts[name]) {
    charts[name].destroy();
    charts[name] = null;
  }
}

function chartOptions(yTitle = "") {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
      mode: "index"
    },
    plugins: {
      legend: {
        labels: {
          color: "#a6b7ce",
          usePointStyle: true,
          boxWidth: 8,
          padding: 17,
          font: { family: "Inter", size: 10 }
        }
      },
      tooltip: {
        backgroundColor: "#142239",
        titleColor: "#ffffff",
        bodyColor: "#c8d5e7",
        borderColor: "rgba(64,217,232,0.2)",
        borderWidth: 1,
        padding: 12
      }
    },
    scales: {
      x: {
        grid: { color: "rgba(148,173,211,0.07)" },
        ticks: {
          color: "#8496b1",
          maxTicksLimit: 9,
          font: { size: 9 }
        },
        title: {
          display: true,
          text: "Cycle Number",
          color: "#8496b1",
          font: { size: 10 }
        }
      },
      y: {
        grid: { color: "rgba(148,173,211,0.08)" },
        ticks: {
          color: "#8496b1",
          font: { size: 9 }
        },
        title: {
          display: Boolean(yTitle),
          text: yTitle,
          color: "#8496b1",
          font: { size: 10 }
        }
      }
    }
  };
}

/* =========================================================
   CHART RENDERING
========================================================= */

function createLineChart(canvasId, chartName, labels, datasets, yTitle) {
  const canvas = $(canvasId);
  if (!canvas || typeof Chart === "undefined") return;

  destroyChart(chartName);

  charts[chartName] = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: datasets.map((dataset) => ({
        ...dataset,
        fill: false,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 5,
        borderWidth: 2
      }))
    },
    options: chartOptions(yTitle)
  });
}

function renderDashboardCharts(cycles) {
  const validCapacity = cycles.filter((c) => Number.isFinite(c.capacity));
  const validVoltage = cycles.filter((c) => Number.isFinite(c.voltage));
  const validTemperature = cycles.filter((c) => Number.isFinite(c.temperature));

  createLineChart(
    "capacityChart",
    "capacity",
    validCapacity.map((c) => c.cycle),
    [{
      label: "Discharge Capacity",
      data: validCapacity.map((c) => c.capacity),
      borderColor: "#40d9e8",
      backgroundColor: "rgba(64,217,232,0.10)"
    }],
    "Capacity (Ah)"
  );

  createLineChart(
    "voltageChart",
    "voltage",
    validVoltage.map((c) => c.cycle),
    [{
      label: "Average Voltage",
      data: validVoltage.map((c) => c.voltage),
      borderColor: "#8b9fff",
      backgroundColor: "rgba(139,159,255,0.10)"
    }],
    "Voltage (V)"
  );

  createLineChart(
    "temperatureChart",
    "temperature",
    validTemperature.map((c) => c.cycle),
    [{
      label: "Average Temperature",
      data: validTemperature.map((c) => c.temperature),
      borderColor: "#ffad66",
      backgroundColor: "rgba(255,173,102,0.10)"
    }],
    "Temperature (°C)"
  );
}

/* =========================================================
   OVERVIEW AND HEALTH
========================================================= */

function renderOverview(data) {
  const metrics = getFirst(data, ["metrics", "summary"], {}) || {};
  const cycles = getCycles(data);

  const totalCycles = getFirst(data, [
    "total_cycles",
    "cycle_count",
    "number_of_cycles"
  ], cycles.length);

  const records = getFirst(data, [
    "total_records",
    "records_processed",
    "record_count",
    "total_readings",
    "records"
  ], getFirst(metrics, [
    "total_records",
    "records_processed",
    "record_count"
  ], "—"));

  const retention = getFirst(data, [
    "capacity_retention",
    "capacity_retention_percent",
    "retention_percent"
  ], getFirst(metrics, [
    "capacity_retention",
    "capacity_retention_percent",
    "retention_percent"
  ]));

  const initialCapacity = getFirst(data, [
    "initial_capacity",
    "initial_capacity_ah"
  ], getFirst(metrics, ["initial_capacity", "initial_capacity_ah"]));

  const latestCapacity = getFirst(data, [
    "latest_capacity",
    "latest_capacity_ah"
  ], getFirst(metrics, ["latest_capacity", "latest_capacity_ah"]));

  const averageVoltage = getFirst(data, [
    "average_voltage",
    "avg_voltage"
  ], getFirst(metrics, ["average_voltage", "avg_voltage"]));

  const averageTemperature = getFirst(data, [
    "average_temperature",
    "avg_temperature"
  ], getFirst(metrics, ["average_temperature", "avg_temperature"]));

  const health = Number(retention);
  const degradation = Number.isFinite(Number(retention))
    ? 100 - Number(retention)
    : null;

  setText("healthValue", formatPercent(retention));
  setText("cycleValue", totalCycles);
  setText("voltageValue", `${formatNumber(averageVoltage, 3)} V`);
  setText("temperatureValue", `${formatNumber(averageTemperature, 2)} °C`);

  setText(
    "recordsValue",
    records !== "—" && Number.isFinite(Number(records))
      ? Number(records).toLocaleString("en-IN")
      : records
  );

  setText("selectedBattery", getSelectedBattery());
  setText("initialCapacity", `${formatNumber(initialCapacity)} Ah`);
  setText("latestCapacity", `${formatNumber(latestCapacity)} Ah`);
  setText("degradationValue", formatPercent(degradation));
  setText("healthRingValue", formatPercent(retention));

  const ring = $("healthRing");
  if (ring && Number.isFinite(health)) {
    const bounded = Math.max(0, Math.min(100, health));
    ring.style.background =
      `conic-gradient(#40d9e8 ${bounded * 3.6}deg, #25344a ${bounded * 3.6}deg)`;
  }

  setText("datasetStatus", "Loaded");

  renderDashboardCharts(cycles);
}

/* =========================================================
   AI PREDICTION
========================================================= */

function renderPrediction(data) {
  const prediction = getFirst(data, [
    "prediction",
    "ml_prediction",
    "model_prediction"
  ], {}) || {};

  const capacity = getFirst(data, [
    "predicted_capacity_ah",
    "estimated_capacity_ah"
  ], getFirst(prediction, [
    "predicted_capacity_ah",
    "predicted_capacity",
    "capacity"
  ]));

  const retention = getFirst(data, [
    "predicted_retention",
    "predicted_retention_percent",
    "estimated_retention"
  ], getFirst(prediction, [
    "predicted_retention",
    "retention_percent",
    "predicted_retention_percent"
  ]));

  const modelStatus = getFirst(data, [
    "model_status",
    "prediction_status"
  ], getFirst(prediction, ["status"], null));

  const message = getFirst(data, [
    "model_message",
    "prediction_message"
  ], getFirst(prediction, ["message"], null));

  if (capacity !== null) {
    setText("mlCapacity", `${formatNumber(capacity, 4)} Ah`);
    setText("mlStatus", modelStatus || "Available");
    setText("mlMessage", message || "Model returned an estimate");
  } else {
    setText("mlCapacity", "Unavailable");
    setText("mlStatus", modelStatus || "Not Available");
    setText(
      "mlMessage",
      message || "No ML capacity prediction returned by the backend."
    );
  }

  setText("mlRetention", retention !== null
    ? formatPercent(retention)
    : "Not available");

  setText(
    "mlDisclaimer",
    "The ML estimate is based on the connected model and available input features. It should not be treated as a validated SOH or RUL prediction."
  );
}

/* =========================================================
   ADVANCED ANALYSIS / FORECAST / ANOMALIES
========================================================= */

function renderForecast(data) {
  const healthScore = getFirst(data, [
    "health_score",
    "capacity_retention",
    "capacity_retention_percent"
  ]);

  setText("forecastHealthScore", formatPercent(healthScore));

  const forecast = normalizeArray(getFirst(data, [
    "forecast",
    "predictions",
    "future_capacity"
  ], []));

  const historical = normalizeArray(getFirst(data, [
    "historical",
    "historical_data",
    "capacity_history"
  ], []));

  const historicalPoints = historical.map((item, index) => {
    if (typeof item === "number") {
      return { x: index + 1, y: item };
    }

    return {
      x: Number(getFirst(item, ["cycle", "cycle_number", "x"], index + 1)),
      y: Number(getFirst(item, ["capacity", "value", "y"]))
    };
  }).filter((point) => Number.isFinite(point.y));

  const forecastPoints = forecast.map((item, index) => {
    if (typeof item === "number") {
      return {
        x: historicalPoints.length + index + 1,
        y: item
      };
    }

    return {
      x: Number(getFirst(item, ["cycle", "cycle_number", "x"], historicalPoints.length + index + 1)),
      y: Number(getFirst(item, ["capacity", "predicted_capacity", "value", "y"]))
    };
  }).filter((point) => Number.isFinite(point.y));

  if (!historicalPoints.length && dashboardData) {
    historicalPoints.push(
      ...getCycles(dashboardData)
        .filter((c) => Number.isFinite(c.capacity))
        .map((c) => ({ x: c.cycle, y: c.capacity }))
    );
  }

  const canvas = $("forecastChart");

  if (canvas && typeof Chart !== "undefined") {
    destroyChart("forecast");

    const datasets = [];

    if (historicalPoints.length) {
      datasets.push({
        label: "Measured Capacity",
        data: historicalPoints,
        parsing: false,
        borderColor: "#40d9e8",
        backgroundColor: "rgba(64,217,232,0.08)",
        pointRadius: 2,
        tension: 0.3
      });
    }

    if (forecastPoints.length) {
      datasets.push({
        label: "Estimated Trend",
        data: forecastPoints,
        parsing: false,
        borderColor: "#a78bfa",
        backgroundColor: "rgba(167,139,250,0.08)",
        borderDash: [6, 5],
        pointRadius: 3,
        tension: 0.2
      });
    }

    charts.forecast = new Chart(canvas, {
      type: "line",
      data: { datasets },
      options: {
        ...chartOptions("Capacity (Ah)"),
        parsing: false,
        scales: {
          x: {
            type: "linear",
            grid: { color: "rgba(148,173,211,0.07)" },
            ticks: { color: "#8496b1", font: { size: 9 } },
            title: {
              display: true,
              text: "Cycle Number",
              color: "#8496b1"
            }
          },
          y: {
            grid: { color: "rgba(148,173,211,0.08)" },
            ticks: { color: "#8496b1", font: { size: 9 } },
            title: {
              display: true,
              text: "Capacity (Ah)",
              color: "#8496b1"
            }
          }
        }
      }
    });
  }

  const note = getFirst(data, ["forecast_note", "note", "message"]);
  setText(
    "forecastNote",
    note || "Future points are simple trend extrapolations, not validated RUL predictions."
  );

  setText("healthBasis", "Calculated from measured capacity retention, not a validated SOH model.");
}

function renderAnomalies(data) {
  const anomalies = normalizeArray(getFirst(data, [
    "anomalies",
    "flagged_cycles",
    "alerts"
  ], []));

  const count = getFirst(data, [
    "anomaly_count",
    "total_anomalies",
    "flagged_count"
  ], anomalies.length);

  const checked = getFirst(data, [
    "checked_cycles",
    "total_checked",
    "cycles_checked"
  ], getCycles(dashboardData || {}).length);

  setText("anomalyCount", count);
  setText("checkedCycles", checked);

  const body = $("anomalyTableBody");
  if (!body) return;

  if (!anomalies.length) {
    body.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          No flagged observations returned by the analysis.
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = anomalies.map((item) => {
    const cycle = getFirst(item, ["cycle", "cycle_number"], "—");
    const temperature = getFirst(item, ["temperature", "avg_temperature"], "—");
    const voltage = getFirst(item, ["voltage", "avg_voltage"], "—");
    const capacity = getFirst(item, ["capacity", "discharge_capacity"], "—");
    const reason = getFirst(item, ["reason", "message", "type"], "Rule triggered");

    return `
      <tr>
        <td>${escapeHTML(cycle)}</td>
        <td>${escapeHTML(temperature)}</td>
        <td>${escapeHTML(voltage)}</td>
        <td>${escapeHTML(capacity)}</td>
        <td>${escapeHTML(reason)}</td>
      </tr>
    `;
  }).join("");

  setText(
    "anomalyMethod",
    getFirst(data, ["method_note", "note", "disclaimer"]) ||
    "These are rule-based flags and statistical checks, not confirmed battery faults."
  );
}

/* =========================================================
   ADVISOR
========================================================= */

function renderAdvisor(data) {
  const insights = normalizeArray(getFirst(data, [
    "insights",
    "key_insights",
    "observations"
  ], []));

  const recommendations = normalizeArray(getFirst(data, [
    "recommendations",
    "actions",
    "suggestions"
  ], []));

  setText(
    "advisorStatus",
    getFirst(data, ["status_message", "summary", "message"]) ||
    "Analysis based on available battery measurements."
  );

  const insightContainer = $("advisorInsights");
  const recommendationContainer = $("advisorRecommendations");

  function renderItems(container, items, fallback) {
    if (!container) return;

    if (!items.length) {
      container.innerHTML = `<div class="advisor-item">${escapeHTML(fallback)}</div>`;
      return;
    }

    container.innerHTML = items.map((item) => {
      const value = typeof item === "object"
        ? getFirst(item, ["message", "text", "description", "insight"], JSON.stringify(item))
        : item;

      return `<div class="advisor-item">${escapeHTML(value)}</div>`;
    }).join("");
  }

  renderItems(
    insightContainer,
    insights,
    "No additional insights were returned."
  );

  renderItems(
    recommendationContainer,
    recommendations,
    "No recommendations were returned."
  );
}

/* =========================================================
   BATTERY COMPARISON
========================================================= */

function normalizeComparisonItem(item) {
  const metrics = getFirst(item, ["metrics", "summary"], {}) || {};

  const initial = getFirst(
    item,
    ["initial_capacity", "initial_capacity_ah"],
    getFirst(metrics, ["initial_capacity", "initial_capacity_ah"])
  );

  const latest = getFirst(
    item,
    ["latest_capacity", "latest_capacity_ah"],
    getFirst(metrics, ["latest_capacity", "latest_capacity_ah"])
  );

  let retention = getFirst(
    item,
    [
      "capacity_retention",
      "capacity_retention_percent",
      "retention_percent"
    ],
    getFirst(metrics, [
      "capacity_retention",
      "capacity_retention_percent",
      "retention_percent"
    ])
  );

  // Calculate retention from initial and latest capacity if missing.
  if (
    (retention === null || !Number.isFinite(Number(retention))) &&
    Number(initial) > 0 &&
    Number.isFinite(Number(latest))
  ) {
    retention = (Number(latest) / Number(initial)) * 100;
  }

  return {
    id: getFirst(item, ["battery_id", "battery", "id"], "Unknown"),
    cycles: getFirst(item, ["total_cycles", "cycle_count", "cycles"], "—"),
    initial,
    latest,
    retention,
    voltage: getFirst(
      item,
      ["average_voltage", "avg_voltage"],
      getFirst(metrics, ["average_voltage", "avg_voltage"])
    ),
    temperature: getFirst(
      item,
      ["average_temperature", "avg_temperature"],
      getFirst(metrics, ["average_temperature", "avg_temperature"])
    )
  };
}

function renderComparison(data) {
  let items = normalizeArray(getFirst(data, [
    "batteries",
    "comparison",
    "results",
    "data"
  ], []));

  if (!items.length && Array.isArray(data)) {
    items = data;
  }

  const normalized = items.map(normalizeComparisonItem);
  const body = $("comparisonTableBody");

  if (body) {
    if (!normalized.length) {
      body.innerHTML = `
        <tr><td colspan="8" class="empty-state">
          No comparison results returned.
        </td></tr>
      `;
    } else {
      body.innerHTML = normalized.map((item) => `
        <tr>
          <td><strong>${escapeHTML(item.id)}</strong></td>
          <td>${escapeHTML(item.cycles)}</td>
          <td>${formatNumber(item.initial)}</td>
          <td>${formatNumber(item.latest)}</td>
          <td>${formatPercent(item.retention)}</td>
          <td>${formatNumber(item.voltage, 3)}</td>
          <td>${formatNumber(item.temperature)}</td>
          <td><span class="status-text">Loaded</span></td>
        </tr>
      `).join("");
    }
  }

  if (!normalized.length) return;

  const labels = normalized.map((item) => item.id);

  destroyChart("comparison");
  destroyChart("cycleComparison");

  if ($("comparisonChart") && typeof Chart !== "undefined") {
    charts.comparison = new Chart($("comparisonChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Capacity Retention (%)",
          data: normalized.map((item) =>
            Number.isFinite(Number(item.retention)) ? Number(item.retention) : null
          ),
          backgroundColor: [
            "rgba(64,217,232,0.75)",
            "rgba(100,136,255,0.75)",
            "rgba(167,139,250,0.75)",
            "rgba(255,173,102,0.75)"
          ],
          borderRadius: 7
        }]
      },
      options: {
        ...chartOptions("Retention (%)"),
        scales: {
          ...chartOptions("Retention (%)").scales,
          y: {
            ...chartOptions("Retention (%)").scales.y,
            beginAtZero: true
          }
        }
      }
    });
  }

  if ($("cycleComparisonChart") && typeof Chart !== "undefined") {
    charts.cycleComparison = new Chart($("cycleComparisonChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Recorded Cycles",
          data: normalized.map((item) => Number(item.cycles)),
          backgroundColor: "rgba(100,136,255,0.7)",
          borderRadius: 7
        }]
      },
      options: {
        ...chartOptions("Cycles"),
        scales: {
          ...chartOptions("Cycles").scales,
          y: {
            ...chartOptions("Cycles").scales.y,
            beginAtZero: true
          }
        }
      }
    });
  }
}

/* =========================================================
   API DATA LOADING
========================================================= */

async function loadDashboard() {
  const battery = getSelectedBattery();

  setText("datasetStatus", "Loading...");
  setText("healthValue", "—");
  setText("cycleValue", "—");

  try {
    const data = await apiRequest(
      `/api/dashboard?battery=${encodeURIComponent(battery)}`
    );

    dashboardData = data;
    showConnection(true);

    renderOverview(data);
    renderPrediction(data);

    await loadAdvancedAnalysis();
    await loadAdvisor();
  } catch (error) {
    console.error("Dashboard loading error:", error);
    showConnection(false);
    setText("datasetStatus", "Unable to load");
    setText("healthValue", "—");
    setText("cycleValue", "—");
    setText("mlStatus", "Unavailable");
    setText("mlMessage", error.message);
    showToast(`Dashboard error: ${error.message}`);
  }
}

async function loadAdvancedAnalysis() {
  try {
    const data = await apiRequest(
      `/api/advanced-analysis?battery=${encodeURIComponent(getSelectedBattery())}`
    );

    advancedData = data;
    renderForecast(data);
    renderAnomalies(data);
  } catch (error) {
    console.error("Advanced analysis error:", error);

    setText("forecastNote", `Forecast unavailable: ${error.message}`);
    setText("anomalyMethod", `Anomaly analysis unavailable: ${error.message}`);
  }
}

async function loadAdvisor() {
  try {
    const data = await apiRequest(
      `/api/advisor?battery=${encodeURIComponent(getSelectedBattery())}`
    );

    advisorData = data;
    renderAdvisor(data);
  } catch (error) {
    console.error("Advisor error:", error);
    setText("advisorStatus", `Advisor unavailable: ${error.message}`);
  }
}

async function loadComparison() {
  const body = $("comparisonTableBody");

  if (body) {
    body.innerHTML = `
      <tr><td colspan="8" class="empty-state">Loading comparison...</td></tr>
    `;
  }

  try {
    const data = await apiRequest(
      `/api/compare?batteries=${encodeURIComponent(BATTERY_IDS.join(","))}`
    );

    comparisonData = data;
    renderComparison(data);
  } catch (error) {
    console.error("Comparison error:", error);

    if (body) {
      body.innerHTML = `
        <tr><td colspan="8" class="empty-state">
          Comparison unavailable: ${escapeHTML(error.message)}
        </td></tr>
      `;
    }
  }
}

/* =========================================================
   MANUAL BATTERY ANALYSIS
========================================================= */

function renderManualResults(data) {
  const container = $("manualResults");
  if (!container) return;

  const retention = getFirst(data, [
    "capacity_retention",
    "retention_percent",
    "health_percentage"
  ]);

  const degradation = getFirst(data, [
    "capacity_degradation",
    "degradation_percent"
  ]);

  const warnings = normalizeArray(getFirst(data, [
    "warnings",
    "alerts",
    "issues"
  ], []));

  const recommendations = normalizeArray(getFirst(data, [
    "recommendations",
    "suggestions",
    "actions"
  ], []));

  const rated = getFirst(data, ["rated_capacity_ah", "rated_capacity"]);
  const measured = getFirst(data, ["measured_capacity_ah", "measured_capacity"]);

  const status = getFirst(data, ["status", "battery_status", "health_status"], "Analysis completed");

  container.innerHTML = `
    <div class="result-content">
      <div class="result-main">
        <span>Calculated Capacity Retention</span>
        <strong>${escapeHTML(formatPercent(retention))}</strong>
      </div>

      <div class="result-line">
        <span>Battery Status</span>
        <strong>${escapeHTML(status)}</strong>
      </div>

      <div class="result-line">
        <span>Rated Capacity</span>
        <strong>${escapeHTML(rated ?? "—")} Ah</strong>
      </div>

      <div class="result-line">
        <span>Measured Capacity</span>
        <strong>${escapeHTML(measured ?? "—")} Ah</strong>
      </div>

      <div class="result-line">
        <span>Capacity Degradation</span>
        <strong>${escapeHTML(formatPercent(degradation))}</strong>
      </div>

      <h4 style="margin-top:17px;font-size:11px;">Warnings</h4>
      <ul class="result-list">
        ${
          warnings.length
            ? warnings.map((item) => `<li>${escapeHTML(item)}</li>`).join("")
            : "<li>No warnings returned by the analysis.</li>"
        }
      </ul>

      <h4 style="margin-top:17px;font-size:11px;">Recommendations</h4>
      <ul class="result-list">
        ${
          recommendations.length
            ? recommendations.map((item) => `<li>${escapeHTML(item)}</li>`).join("")
            : "<li>No recommendations were returned.</li>"
        }
      </ul>
    </div>
  `;
}

async function handleManualAnalysis(event) {
  event.preventDefault();

  const form = $("manualForm");
  if (!form) return;

  const formData = new FormData(form);

  const payload = {
    battery_type: String(formData.get("battery_type") || "").trim(),
    rated_capacity_ah: Number(formData.get("rated_capacity_ah")),
    measured_capacity_ah: Number(formData.get("measured_capacity_ah")),
    voltage_v: Number(formData.get("voltage_v")),
    current_a: Number(formData.get("current_a")),
    temperature_c: Number(formData.get("temperature_c")),
    cycle_count: Number(formData.get("cycle_count"))
  };

  const numericValues = [
    payload.rated_capacity_ah,
    payload.measured_capacity_ah,
    payload.voltage_v,
    payload.current_a,
    payload.temperature_c,
    payload.cycle_count
  ];

  if (!payload.battery_type || numericValues.some((v) => !Number.isFinite(v))) {
    setMessage("manualMessage", "Please enter valid values in all fields.", "error");
    return;
  }

  if (payload.rated_capacity_ah <= 0 || payload.measured_capacity_ah < 0 ||
      payload.voltage_v <= 0 || payload.cycle_count < 0) {
    setMessage("manualMessage", "Please check capacity, voltage and cycle values.", "error");
    return;
  }

  setLoading("manualAnalyzeButton", true, "Analyze Battery");

  try {
    const data = await apiRequest("/api/manual-analysis", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    renderManualResults(data);
    function renderManualResults(data) {
  const container = $("manualResults");
  if (!container) return;

  const retention = getFirst(data, [
    "capacity_retention_percent",
    "capacity_retention",
    "retention_percent",
    "health_percentage"
  ]);

  const degradation = getFirst(data, [
    "capacity_degradation_percent",
    "capacity_degradation",
    "degradation_percent"
  ]);

  const warnings = normalizeArray(getFirst(data, [
    "warnings",
    "alerts",
    "issues"
  ], []));

  const recommendations = normalizeArray(getFirst(data, [
    "recommendations",
    "suggestions",
    "actions"
  ], []));

  const rated = getFirst(data, [
    "rated_capacity_ah",
    "rated_capacity"
  ]);

  const measured = getFirst(data, [
    "measured_capacity_ah",
    "measured_capacity"
  ]);

  const status = getFirst(data, [
    "status",
    "battery_status",
    "health_status"
  ], "Analysis completed");

  container.innerHTML = `
    <div class="result-content">
      <div class="result-main">
        <span>Calculated Capacity Retention</span>
        <strong>${escapeHTML(formatPercent(retention))}</strong>
      </div>

      <div class="result-line">
        <span>Battery Status</span>
        <strong>${escapeHTML(status)}</strong>
      </div>

      <div class="result-line">
        <span>Rated Capacity</span>
        <strong>${escapeHTML(rated ?? "—")} Ah</strong>
      </div>

      <div class="result-line">
        <span>Measured Capacity</span>
        <strong>${escapeHTML(measured ?? "—")} Ah</strong>
      </div>

      <div class="result-line">
        <span>Capacity Degradation</span>
        <strong>${escapeHTML(formatPercent(degradation))}</strong>
      </div>

      <h4 style="margin-top:17px;font-size:11px;">Warnings</h4>
      <ul class="result-list">
        ${
          warnings.length
            ? warnings.map((item) => `<li>${escapeHTML(item)}</li>`).join("")
            : "<li>No warnings returned by the analysis.</li>"
        }
      </ul>

      <h4 style="margin-top:17px;font-size:11px;">Recommendations</h4>
      <ul class="result-list">
        ${
          recommendations.length
            ? recommendations.map((item) => `<li>${escapeHTML(item)}</li>`).join("")
            : "<li>No recommendations were returned.</li>"
        }
      </ul>
    </div>
  `;
}
    setMessage("manualMessage", "Analysis completed successfully.", "success");
  } catch (error) {
    console.error("Manual analysis error:", error);
    setMessage("manualMessage", error.message, "error");
  } finally {
    setLoading("manualAnalyzeButton", false, "Analyze Battery →");
  }
}

/* =========================================================
   DIGITAL TWIN
========================================================= */

function renderTwinResults(data) {
  const container = $("twinResults");
  if (!container) return;

  const currentRetention = getFirst(data, [
    "current_retention",
    "current_retention_percent",
    "original_retention"
  ]);

  const scenarioRetention = getFirst(data, [
    "scenario_retention",
    "predicted_retention",
    "scenario_retention_percent"
  ]);

  const scenarioCapacity = getFirst(data, [
    "scenario_capacity",
    "predicted_capacity",
    "scenario_capacity_ah"
  ]);

  const currentCapacity = getFirst(data, [
    "current_capacity",
    "measured_capacity_ah",
    "measured_capacity"
  ]);

  container.innerHTML = `
    <div class="result-content">
      <div class="result-main">
        <span>Scenario Capacity</span>
        <strong>${escapeHTML(formatNumber(scenarioCapacity))} Ah</strong>
      </div>

      <div class="result-line">
        <span>Current Retention</span>
        <strong>${escapeHTML(formatPercent(currentRetention))}</strong>
      </div>

      <div class="result-line">
        <span>Scenario Retention</span>
        <strong>${escapeHTML(formatPercent(scenarioRetention))}</strong>
      </div>

      <div class="result-line">
        <span>Current Capacity</span>
        <strong>${escapeHTML(formatNumber(currentCapacity))} Ah</strong>
      </div>

      <p class="disclaimer">
        Illustrative what-if calculation. Not a calibrated electrochemical battery model.
      </p>
    </div>
  `;

  setText("twinCurrentRetention", formatPercent(currentRetention));
  setText("twinScenarioRetention", formatPercent(scenarioRetention));
  setText("twinScenarioCapacity", `${formatNumber(scenarioCapacity)} Ah`);

  const canvas = $("twinChart");

  if (canvas && typeof Chart !== "undefined") {
    destroyChart("twin");

    charts.twin = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Current", "Scenario"],
        datasets: [{
          label: "Capacity (Ah)",
          data: [
            Number(currentCapacity),
            Number(scenarioCapacity)
          ],
          backgroundColor: [
            "rgba(64,217,232,0.75)",
            "rgba(167,139,250,0.75)"
          ],
          borderRadius: 8
        }]
      },
      options: {
        ...chartOptions("Capacity (Ah)"),
        scales: {
          ...chartOptions("Capacity (Ah)").scales,
          x: {
            grid: { display: false },
            ticks: { color: "#a6b7ce" }
          },
          y: {
            ...chartOptions("Capacity (Ah)").scales.y,
            beginAtZero: true
          }
        }
      }
    });
  }
}

async function handleTwinSimulation(event) {
  event.preventDefault();

  const payload = {
    rated_capacity_ah: Number($("twinRatedCapacity")?.value),
    measured_capacity_ah: Number($("twinMeasuredCapacity")?.value),
    voltage_v: Number($("twinVoltage")?.value),
    temperature_c: Number($("twinTemperature")?.value),
    extra_temperature_c: Number($("extraTemperature")?.value),
    extra_cycles: Number($("extraCycles")?.value)
  };

  if (Object.values(payload).some((value) => !Number.isFinite(value))) {
    setMessage("twinMessage", "Please enter valid simulation values.", "error");
    return;
  }

  if (payload.rated_capacity_ah <= 0 ||
      payload.measured_capacity_ah < 0 ||
      payload.voltage_v <= 0 ||
      payload.extra_cycles < 0) {
    setMessage("twinMessage", "Please check the capacity, voltage and cycle inputs.", "error");
    return;
  }

  setLoading("simulateButton", true, "Run Scenario");

  try {
    const data = await apiRequest("/api/digital-twin", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    renderTwinResults(data);
    setMessage("twinMessage", "Scenario completed.", "success");
  } catch (error) {
    console.error("Digital twin error:", error);
    setMessage("twinMessage", error.message, "error");
  } finally {
    setLoading("simulateButton", false, "Run Scenario →");
  }
}

/* =========================================================
   PDF REPORT
========================================================= */

async function exportPDF() {
  const button = $("exportPdfButton");

  if (typeof window.jspdf === "undefined") {
    setMessage("reportMessage", "PDF library did not load. Check your internet connection.", "error");
    return;
  }

  if (!dashboardData) {
    setMessage("reportMessage", "Load battery data before exporting.", "error");
    return;
  }

  if (button) button.disabled = true;
  setMessage("reportMessage", "Generating your report...");

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const battery = getSelectedBattery();
    const metrics = getFirst(dashboardData, ["metrics", "summary"], {}) || {};

    const retention = getFirst(dashboardData, [
      "capacity_retention",
      "capacity_retention_percent",
      "retention_percent"
    ], getFirst(metrics, ["capacity_retention", "retention_percent"]));

    const initialCapacity = getFirst(dashboardData, [
      "initial_capacity",
      "initial_capacity_ah"
    ], getFirst(metrics, ["initial_capacity"]));

    const latestCapacity = getFirst(dashboardData, [
      "latest_capacity",
      "latest_capacity_ah"
    ], getFirst(metrics, ["latest_capacity"]));

    const cycles = getFirst(dashboardData, [
      "total_cycles",
      "cycle_count"
    ], getCycles(dashboardData).length);

    const voltage = getFirst(dashboardData, [
      "average_voltage",
      "avg_voltage"
    ], getFirst(metrics, ["average_voltage", "avg_voltage"]));

    const temperature = getFirst(dashboardData, [
      "average_temperature",
      "avg_temperature"
    ], getFirst(metrics, ["average_temperature", "avg_temperature"]));

    doc.setFillColor(8, 14, 27);
    doc.rect(0, 0, 210, 297, "F");

    doc.setTextColor(64, 217, 232);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(25);
    doc.text("POWERAI", 18, 24);

    doc.setTextColor(230, 240, 255);
    doc.setFontSize(16);
    doc.text("Battery Intelligence Report", 18, 43);

    doc.setTextColor(145, 164, 190);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Selected Dataset: ${battery}`, 18, 54);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 18, 62);

    doc.setDrawColor(64, 217, 232);
    doc.line(18, 70, 192, 70);

    doc.setTextColor(64, 217, 232);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("PERFORMANCE SUMMARY", 18, 84);

    const reportRows = [
      ["Battery Dataset", battery],
      ["Total Discharge Cycles", String(cycles)],
      ["Capacity Retention", formatPercent(retention)],
      ["Initial Capacity", `${formatNumber(initialCapacity)} Ah`],
      ["Latest Capacity", `${formatNumber(latestCapacity)} Ah`],
      ["Average Voltage", `${formatNumber(voltage, 3)} V`],
      ["Average Temperature", `${formatNumber(temperature)} °C`]
    ];

    let y = 98;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    for (const [label, value] of reportRows) {
      doc.setTextColor(150, 170, 195);
      doc.text(label, 20, y);

      doc.setTextColor(235, 244, 255);
      doc.text(value, 188, y, { align: "right" });

      doc.setDrawColor(39, 57, 80);
      doc.line(20, y + 5, 190, y + 5);

      y += 15;
    }

    y += 7;

    doc.setTextColor(64, 217, 232);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("ANALYSIS NOTES", 18, y);

    y += 12;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(175, 190, 210);

    const notes = [
      "Capacity retention is calculated from measured capacity relative to the first valid cycle.",
      "The ML capacity estimate is only available when returned by the connected model.",
      "Trend extrapolation is not a validated Remaining Useful Life prediction.",
      "Anomaly flags are rule-based checks and do not confirm battery faults.",
      "The Digital Twin is an illustrative what-if calculation, not a calibrated electrochemical model."
    ];

    for (const note of notes) {
      const lines = doc.splitTextToSize(`• ${note}`, 170);
      doc.text(lines, 20, y);
      y += lines.length * 5 + 4;
    }

    y += 12;

    doc.setTextColor(110, 135, 164);
    doc.setFontSize(8);
    doc.text(
      "POWERAI | AI-Powered Predictive Battery Management System",
      18,
      Math.min(y, 280)
    );

    doc.save(`POWERAI_${battery}_Report.pdf`);

    setMessage("reportMessage", "PDF report generated successfully.", "success");
  } catch (error) {
    console.error("PDF export error:", error);
    setMessage("reportMessage", `PDF export failed: ${error.message}`, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

/* =========================================================
   TOAST
========================================================= */

let toastTimeout = null;

function showToast(message) {
  let toast = $("poweraiToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "poweraiToast";

    Object.assign(toast.style, {
      position: "fixed",
      right: "22px",
      bottom: "22px",
      zIndex: "9999",
      maxWidth: "340px",
      padding: "13px 17px",
      background: "#142239",
      color: "#eaf4ff",
      border: "1px solid rgba(64,217,232,0.3)",
      borderRadius: "11px",
      boxShadow: "0 10px 35px rgba(0,0,0,0.35)",
      fontSize: "11px",
      lineHeight: "1.6",
      opacity: "0",
      transform: "translateY(10px)",
      transition: "0.25s"
    });

    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.opacity = "1";
  toast.style.transform = "translateY(0)";

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
  }, 4000);
}

/* =========================================================
   NAVIGATION AND EVENTS
========================================================= */

function setupNavigation() {
  const links = document.querySelectorAll(".nav-link");

  links.forEach((link) => {
    link.addEventListener("click", () => {
      links.forEach((item) => item.classList.remove("active"));
      link.classList.add("active");

      $("sidebar")?.classList.remove("open");
    });
  });

  const sections = document.querySelectorAll(".dashboard-section");

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const activeId = entry.target.id;

        links.forEach((link) => {
          link.classList.toggle(
            "active",
            link.getAttribute("href") === `#${activeId}`
          );
        });
      });
    }, {
      rootMargin: "-20% 0px -65% 0px"
    });

    sections.forEach((section) => observer.observe(section));
  }

  $("menuToggle")?.addEventListener("click", () => {
    $("sidebar")?.classList.toggle("open");
  });
}

function setupEvents() {
  $("batterySelect")?.addEventListener("change", () => {
    loadDashboard();
    loadComparison();
  });

  $("refreshButton")?.addEventListener("click", () => {
    loadDashboard();
    loadComparison();
    showToast("Refreshing battery dashboard...");
  });

  $("compareRefresh")?.addEventListener("click", loadComparison);
  $("advisorRefresh")?.addEventListener("click", loadAdvisor);

  $("manualForm")?.addEventListener("submit", handleManualAnalysis);
  $("twinForm")?.addEventListener("submit", handleTwinSimulation);

  $("exportPdfButton")?.addEventListener("click", exportPDF);
}

/* =========================================================
   START APPLICATION
========================================================= */

async function initializePowerAI() {
  setupNavigation();
  setupEvents();

  if (typeof Chart === "undefined") {
    showToast("Chart.js did not load. Check your internet connection.");
  }

  await loadDashboard();
  await loadComparison();
}

document.addEventListener("DOMContentLoaded", initializePowerAI);
