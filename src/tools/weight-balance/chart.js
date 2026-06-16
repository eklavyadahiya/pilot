const COLORS = {
  normal: "#2563eb",
  utility: "#16a34a",
  fullTank: "#ca8a04",
  operating: "#dc2626",
  grid: "#e2e8f0",
  axis: "#64748b",
  text: "#334155"
};

export function renderEnvelopeChart(canvas, chartPoints, envelopeMeta) {
  if (!canvas || !chartPoints) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth || 640;
  const height = canvas.clientHeight || 420;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const padding = { top: 24, right: 24, bottom: 48, left: 64 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const allPoints = [
    ...chartPoints.normalBoundary,
    ...(chartPoints.utilityBoundary || []),
    chartPoints.emptyTankZfw,
    chartPoints.fullTankRamp,
    chartPoints.takeoff,
    chartPoints.landing
  ].filter(Boolean);

  const xValues = allPoints.map((p) => p.x);
  const yValues = allPoints.map((p) => p.y);
  const minX = Math.min(...xValues) - 10;
  const maxX = Math.max(...xValues) + 10;
  const minY = Math.min(...yValues) - 20;
  const maxY = Math.max(envelopeMeta?.maxYAxisKg || 0, ...yValues) + 20;

  function xScale(x) {
    return padding.left + ((x - minX) / (maxX - minX)) * plotW;
  }
  function yScale(y) {
    return padding.top + plotH - ((y - minY) / (maxY - minY)) * plotH;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  const ySteps = 6;
  for (let i = 0; i <= ySteps; i += 1) {
    const yVal = minY + ((maxY - minY) * i) / ySteps;
    const y = yScale(yVal);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(Math.round(yVal)), padding.left - 8, y + 4);
  }

  const xSteps = 6;
  for (let i = 0; i <= xSteps; i += 1) {
    const xVal = minX + ((maxX - minX) * i) / xSteps;
    const x = xScale(xVal);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillText(String(Math.round(xVal)), x, height - padding.bottom + 16);
  }

  function drawPolyline(points, color, closePath = false) {
    if (!points || points.length === 0) {
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = xScale(point.x);
      const y = yScale(point.y);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    if (closePath) {
      ctx.closePath();
    }
    ctx.stroke();
  }

  function drawPoint(point, color, label) {
    if (!point) {
      return;
    }
    const x = xScale(point.x);
    const y = yScale(point.y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, x + 8, y - 8);
  }

  drawPolyline(chartPoints.normalBoundary, COLORS.normal, true);
  if (chartPoints.utilityBoundary?.length) {
    drawPolyline(chartPoints.utilityBoundary, COLORS.utility, true);
  }

  if (chartPoints.fullTankLine?.length === 2) {
    drawPolyline(chartPoints.fullTankLine, COLORS.fullTank);
  }

  drawPoint(chartPoints.emptyTankZfw, COLORS.operating, "ZFW");
  drawPoint(chartPoints.fullTankRamp, COLORS.fullTank, "Full fuel");
  drawPoint(chartPoints.takeoff, COLORS.operating, "TOW");
  drawPoint(chartPoints.landing, COLORS.operating, "LW");

  ctx.fillStyle = COLORS.axis;
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Moment (m·kg)", padding.left + plotW / 2, height - 8);
  ctx.save();
  ctx.translate(16, padding.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Mass (kg)", 0, 0);
  ctx.restore();

  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "left";
  const legendY = padding.top + 8;
  const legend = [
    ["Normal envelope", COLORS.normal],
    ["Utility envelope", COLORS.utility],
    ["Operating points", COLORS.operating]
  ];
  legend.forEach(([label, color], index) => {
    const y = legendY + index * 16;
    ctx.fillStyle = color;
    ctx.fillRect(padding.left + 8, y, 12, 12);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(label, padding.left + 26, y + 10);
  });
}
