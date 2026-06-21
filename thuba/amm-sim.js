// amm-sim.js — Interactive AMM Education Simulator
// Pure vanilla JS, no ES modules. All globals / IIFE-wrapped.

// ─────────────────────────────────────────────────────────────
// SECTION 1: Core Math Classes
// ─────────────────────────────────────────────────────────────

class AMMv2Simulator {
  constructor(reserveX, reserveY) {
    this.reserveX = reserveX; // ETH
    this.reserveY = reserveY; // USDC
    this.k = reserveX * reserveY;
  }

  spotPrice() {
    return this.reserveY / this.reserveX;
  }

  // Returns USDC received when swapping amountIn ETH (0.3% fee)
  quoteExactIn(amountIn) {
    const amountInWithFee = amountIn * 0.997;
    const amountOut = (this.reserveY * amountInWithFee) / (this.reserveX + amountInWithFee);
    const newReserveX = this.reserveX + amountIn;
    const newReserveY = this.reserveY - amountOut;
    const effectivePrice = amountIn > 0 ? amountOut / amountIn : this.spotPrice();
    const priceImpact = Math.abs((effectivePrice - this.spotPrice()) / this.spotPrice()) * 100;
    return { amountOut, newReserveX, newReserveY, effectivePrice, priceImpact };
  }

  // Convert reserve-space X value → SVG X pixel
  reserveToSVGX(x, xMin, xMax, svgWidth) {
    return ((x - xMin) / (xMax - xMin)) * svgWidth;
  }

  // Convert reserve-space Y value → SVG Y pixel (inverted: high Y = low pixel)
  reserveToSVGY(y, yMin, yMax, svgHeight) {
    return svgHeight - ((y - yMin) / (yMax - yMin)) * svgHeight;
  }

  // Returns array of {x, y} in SVG coordinates for the k-curve
  getCurvePoints(svgWidth, svgHeight, xMin, xMax, n) {
    n = n || 100;
    const yMin = this.k / xMax;
    const yMax = this.k / xMin;
    const points = [];
    for (let i = 0; i <= n; i++) {
      const rx = xMin + (i / n) * (xMax - xMin);
      const ry = this.k / rx;
      const sx = this.reserveToSVGX(rx, xMin, xMax, svgWidth);
      const sy = this.reserveToSVGY(ry, yMin, yMax, svgHeight);
      points.push({ x: sx, y: sy, rx: rx, ry: ry });
    }
    return { points, yMin, yMax };
  }
}

class AMMv3Simulator {
  priceToTick(price) {
    return Math.floor(Math.log(price) / Math.log(1.0001));
  }

  tickToPrice(tick) {
    return Math.pow(1.0001, tick);
  }

  // Capital efficiency multiplier vs V2
  // = sqrt(P_upper / P_lower) / (sqrt(P_upper / P_lower) - 1)
  capitalEfficiency(pLow, pHigh) {
    if (pLow <= 0 || pHigh <= pLow) return 1;
    const ratio = Math.sqrt(pHigh / pLow);
    if (ratio <= 1) return 1;
    return ratio / (ratio - 1);
  }

  isInRange(currentPrice, pLow, pHigh) {
    return currentPrice >= pLow && currentPrice <= pHigh;
  }

  // Round tick to nearest valid multiple of tickSpacing
  nearestTick(price, tickSpacing) {
    const tick = this.priceToTick(price);
    return Math.round(tick / tickSpacing) * tickSpacing;
  }

  // Fee tier → tick spacing
  feeToTickSpacing(feeTier) {
    const map = { '0.05': 10, '0.30': 60, '1.00': 200 };
    return map[String(feeTier)] || 60;
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 1.5: Chart.js instance registry (destroy-before-recreate)
// ─────────────────────────────────────────────────────────────

var _curveChart = null;
var _depthChart = null;

// ─────────────────────────────────────────────────────────────
// SECTION 2: Utility helpers
// ─────────────────────────────────────────────────────────────

function fmtNum(n, decimals) {
  if (!isFinite(n)) return '—';
  decimals = (decimals === undefined) ? 2 : decimals;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function fmtPrice(n) {
  if (!isFinite(n)) return '—';
  return '$' + fmtNum(n, 2);
}

function clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

function svgNS() {
  return 'http://www.w3.org/2000/svg';
}

function makeSVGEl(tag, attrs) {
  var el = document.createElementNS(svgNS(), tag);
  for (var key in attrs) {
    el.setAttribute(key, attrs[key]);
  }
  return el;
}

// ─────────────────────────────────────────────────────────────
// SECTION 3: Component 1 — AMM V2 Price Impact Calculator
// ─────────────────────────────────────────────────────────────

function initAMMCalculator() {
  var ids = [
    'c1-reserve-eth', 'c1-reserve-eth-slider',
    'c1-reserve-usdc', 'c1-reserve-usdc-slider',
    'c1-swap-amount', 'c1-swap-slider'
  ];

  // Slider ↔ input sync helpers
  function syncSliderToInput(sliderId, inputId) {
    var slider = document.getElementById(sliderId);
    var input  = document.getElementById(inputId);
    if (!slider || !input) return;
    slider.addEventListener('input', function () {
      input.value = slider.value;
      updateAMMCalculator();
    });
    input.addEventListener('input', function () {
      slider.value = input.value;
      updateAMMCalculator();
    });
  }

  syncSliderToInput('c1-reserve-eth-slider', 'c1-reserve-eth');
  syncSliderToInput('c1-reserve-usdc-slider', 'c1-reserve-usdc');
  syncSliderToInput('c1-swap-slider', 'c1-swap-amount');

  updateAMMCalculator();
}

function updateAMMCalculator() {
  var ethInput   = document.getElementById('c1-reserve-eth');
  var usdcInput  = document.getElementById('c1-reserve-usdc');
  var swapInput  = document.getElementById('c1-swap-amount');
  if (!ethInput || !usdcInput || !swapInput) return;

  var reserveETH  = parseFloat(ethInput.value)  || 1000;
  var reserveUSDC = parseFloat(usdcInput.value) || 2000000;
  var swapAmount  = parseFloat(swapInput.value) || 0;
  swapAmount = Math.max(0, swapAmount);

  var sim = new AMMv2Simulator(reserveETH, reserveUSDC);

  // Spot price display
  var spotEl = document.getElementById('c1-spot-price');
  if (spotEl) spotEl.textContent = fmtPrice(sim.spotPrice());

  if (swapAmount === 0) {
    var zero = function(id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    zero('c1-out-usdc', fmtNum(0));
    zero('c1-effective-price', fmtPrice(sim.spotPrice()));
    zero('c1-price-impact', '0.00%');
    zero('c1-new-eth', fmtNum(reserveETH));
    zero('c1-new-usdc', fmtNum(reserveUSDC));
    setPriceImpactBadge(0);
    drawAMMCurve(document.getElementById('c1-curve-chart'), sim, 0);
    drawDepthChart(reserveETH, reserveUSDC);
    return;
  }

  var result = sim.quoteExactIn(swapAmount);

  var setText = function(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setText('c1-out-usdc',       fmtNum(result.amountOut, 2));
  setText('c1-effective-price', fmtPrice(result.effectivePrice));
  setText('c1-price-impact',   fmtNum(result.priceImpact, 3) + '%');
  setText('c1-new-eth',        fmtNum(result.newReserveX, 4));
  setText('c1-new-usdc',       fmtNum(result.newReserveY, 2));

  setPriceImpactBadge(result.priceImpact);
  drawAMMCurve(document.getElementById('c1-curve-chart'), sim, swapAmount);
  drawDepthChart(reserveETH, reserveUSDC);
}

function setPriceImpactBadge(pct) {
  var badge = document.getElementById('c1-price-impact-badge');
  if (!badge) return;
  var label, bg, color;
  if (pct < 0.1) {
    label = 'Minimal'; bg = '#d1fae5'; color = '#065f46';
  } else if (pct < 1) {
    label = 'Low'; bg = '#dcfce7'; color = '#166534';
  } else if (pct < 3) {
    label = 'Moderate'; bg = '#fef9c3'; color = '#713f12';
  } else if (pct < 5) {
    label = 'High'; bg = '#fed7aa'; color = '#7c2d12';
  } else {
    label = 'Very High'; bg = '#fee2e2'; color = '#7f1d1d';
  }
  badge.textContent = label + ' (' + fmtNum(pct, 2) + '%)';
  badge.style.background = bg;
  badge.style.color = color;
  badge.style.padding = '3px 10px';
  badge.style.borderRadius = '9999px';
  badge.style.fontWeight = '600';
  badge.style.fontSize = '0.82rem';
  badge.style.display = 'inline-block';
}

function drawAMMCurve(canvasEl, sim, swapAmount) {
  if (!canvasEl || typeof Chart === 'undefined') return;

  var xCenter = sim.reserveX;
  var xMin = xCenter * 0.1;
  var xMax = xCenter * 3.5;

  // Generate hyperbola points
  var curveData = [];
  for (var i = 0; i <= 120; i++) {
    var rx = xMin + (i / 120) * (xMax - xMin);
    curveData.push({ x: rx, y: sim.k / rx });
  }

  var datasets = [
    {
      label: 'x·y = k',
      data: curveData,
      showLine: true,
      borderColor: '#3b82f6',
      backgroundColor: 'transparent',
      pointRadius: 0,
      borderWidth: 2.5,
      tension: 0.1,
      order: 3
    },
    {
      label: '当前位置',
      data: [{ x: sim.reserveX, y: sim.reserveY }],
      borderColor: '#22d3ee',
      backgroundColor: '#22d3ee',
      pointRadius: 8,
      pointHoverRadius: 10,
      showLine: false,
      order: 1
    }
  ];

  if (swapAmount > 0) {
    var result = sim.quoteExactIn(swapAmount);
    datasets.push({
      label: '成交后',
      data: [{ x: result.newReserveX, y: result.newReserveY }],
      borderColor: '#f59e0b',
      backgroundColor: '#f59e0b',
      pointRadius: 8,
      pointHoverRadius: 10,
      showLine: false,
      order: 2
    });
  }

  if (_curveChart) { _curveChart.destroy(); _curveChart = null; }

  _curveChart = new Chart(canvasEl, {
    type: 'scatter',
    data: { datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 4 / 3,
      animation: { duration: 0 },
      plugins: {
        legend: {
          labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 14, padding: 12 }
        },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              var y = ctx.parsed.y;
              var yStr = y >= 1e6 ? (y / 1e6).toFixed(2) + 'M' : y >= 1e3 ? (y / 1e3).toFixed(1) + 'K' : fmtNum(y, 0);
              return ctx.dataset.label + '  ETH: ' + fmtNum(ctx.parsed.x, 1) + '  USDC: ' + yStr;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'ETH Reserve', color: '#94a3b8', font: { size: 11 } },
          ticks: {
            color: '#64748b', font: { size: 10 }, maxTicksLimit: 6,
            callback: function (v) { return v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v; }
          },
          grid: { color: 'rgba(30,58,95,0.8)' }
        },
        y: {
          title: { display: true, text: 'USDC Reserve', color: '#94a3b8', font: { size: 11 } },
          ticks: {
            color: '#64748b', font: { size: 10 }, maxTicksLimit: 6,
            callback: function (v) { return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v; }
          },
          grid: { color: 'rgba(30,58,95,0.8)' }
        }
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────
// SECTION 4: Component 2 — Impermanent Loss Calculator
// ─────────────────────────────────────────────────────────────

function initILCalculator() {
  var ids = ['c2-initial-price', 'c2-new-price', 'c2-lp-amount'];
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', updateILCalculator);
  });
  updateILCalculator();
}

function updateILCalculator() {
  var initPriceEl = document.getElementById('c2-initial-price');
  var newPriceEl  = document.getElementById('c2-new-price');
  var lpAmtEl     = document.getElementById('c2-lp-amount');
  var resultEl    = document.getElementById('c2-il-result');
  if (!initPriceEl || !newPriceEl || !lpAmtEl) return;

  var P0    = parseFloat(initPriceEl.value) || 0;
  var P1    = parseFloat(newPriceEl.value)  || 0;
  var ethAmt = parseFloat(lpAmtEl.value)    || 0;

  if (P0 <= 0 || P1 <= 0 || ethAmt <= 0) {
    if (resultEl) resultEl.style.display = 'none';
    return;
  }

  // Initial portfolio: ethAmt ETH + equivalent USDC at P0
  var initialUSDC = ethAmt * P0; // same value in USDC
  // Total initial value = 2 * (ethAmt * P0)  (50/50 split)
  var totalInitialValue = 2 * ethAmt * P0;

  // Hold value: keep original tokens, value at P1
  var holdValue = ethAmt * P1 + initialUSDC; // hold eth + usdc

  // LP value: constant product maintains x * y = k
  // At P0: x0 = ethAmt, y0 = ethAmt * P0, k = x0 * y0
  // At P1: x1 = sqrt(k / P1), y1 = sqrt(k * P1)
  var k    = ethAmt * initialUSDC;
  var x1   = Math.sqrt(k / P1);
  var y1   = Math.sqrt(k * P1);
  var lpValue = x1 * P1 + y1; // value in USD

  // IL formula: IL = 2*sqrt(r)/(1+r) - 1, r = P1/P0
  var r  = P1 / P0;
  var il = (2 * Math.sqrt(r) / (1 + r)) - 1; // negative means loss
  var ilPct = il * 100;

  var holdEl = document.getElementById('c2-hold-value');
  var lpEl   = document.getElementById('c2-lp-value');
  var ilEl   = document.getElementById('c2-il-pct');

  if (holdEl) holdEl.textContent = fmtPrice(holdValue);
  if (lpEl)   lpEl.textContent   = fmtPrice(lpValue);
  if (ilEl) {
    ilEl.textContent = fmtNum(ilPct, 4) + '%';
    ilEl.style.color = ilPct < -0.01 ? '#f87171' : ilPct > 0.01 ? '#4ade80' : '#94a3b8';
  }

  if (resultEl) {
    resultEl.style.display = 'block';
    // Color the result block
    if (ilPct < -5) {
      resultEl.style.borderLeft = '4px solid #ef4444';
    } else if (ilPct < -1) {
      resultEl.style.borderLeft = '4px solid #f97316';
    } else {
      resultEl.style.borderLeft = '4px solid #22c55e';
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 5: Component 3 — V3 Concentrated Liquidity Visualizer
// ─────────────────────────────────────────────────────────────

var v3SimInterval = null;
var v3FeeCount    = 0;
var v3SimRunning  = false;

function initV3Visualizer() {
  var ids = ['c3-price-current', 'c3-range-low', 'c3-range-high', 'c3-fee-tier'];
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', onV3Change);
    if (el) el.addEventListener('change', onV3Change);
  });

  var btn = document.getElementById('c3-simulate-btn');
  if (btn) btn.addEventListener('click', startV3Simulation);

  onV3Change();
}

function onV3Change() {
  var sim        = new AMMv3Simulator();
  var priceEl    = document.getElementById('c3-price-current');
  var lowEl      = document.getElementById('c3-range-low');
  var highEl     = document.getElementById('c3-range-high');
  var feeEl      = document.getElementById('c3-fee-tier');
  var effEl      = document.getElementById('c3-efficiency');
  var tickCurEl  = document.getElementById('c3-tick-current');
  var tickLowEl  = document.getElementById('c3-tick-low');
  var tickHighEl = document.getElementById('c3-tick-high');

  if (!priceEl || !lowEl || !highEl) return;

  var currentPrice = parseFloat(priceEl.value)  || 2000;
  var rangeLow     = parseFloat(lowEl.value)    || 1800;
  var rangeHigh    = parseFloat(highEl.value)   || 2200;
  var feeTier      = feeEl ? feeEl.value : '0.30';

  // Guard: ensure valid range
  if (rangeLow >= rangeHigh) {
    rangeHigh = rangeLow * 1.1;
    if (highEl) highEl.value = rangeHigh.toFixed(0);
  }

  var tickSpacing = sim.feeToTickSpacing(feeTier);
  var tickCur  = sim.priceToTick(currentPrice);
  var tickLow  = sim.nearestTick(rangeLow, tickSpacing);
  var tickHigh = sim.nearestTick(rangeHigh, tickSpacing);
  var eff      = sim.capitalEfficiency(rangeLow, rangeHigh);

  if (tickCurEl)  tickCurEl.textContent  = tickCur.toLocaleString();
  if (tickLowEl)  tickLowEl.textContent  = tickLow.toLocaleString();
  if (tickHighEl) tickHighEl.textContent = tickHigh.toLocaleString();
  if (effEl)      effEl.textContent      = fmtNum(eff, 2) + '×';

  updateInRangeIndicator(currentPrice, rangeLow, rangeHigh);

  var svgEl  = document.getElementById('c3-svg');
  var priceMin = Math.min(rangeLow, currentPrice) * 0.7;
  var priceMax = Math.max(rangeHigh, currentPrice) * 1.3;
  drawV3Chart(svgEl, currentPrice, rangeLow, rangeHigh, priceMin, priceMax);
}

function updateInRangeIndicator(currentPrice, pLow, pHigh) {
  var el = document.getElementById('c3-in-range-indicator');
  if (!el) return;
  var inRange = currentPrice >= pLow && currentPrice <= pHigh;
  el.textContent = inRange ? 'In Range — Earning Fees' : 'Out of Range — Not Earning';
  el.style.background    = inRange ? '#052e16' : '#450a0a';
  el.style.color         = inRange ? '#4ade80' : '#f87171';
  el.style.border        = '1px solid ' + (inRange ? '#4ade80' : '#f87171');
  el.style.padding       = '5px 14px';
  el.style.borderRadius  = '6px';
  el.style.fontWeight    = '600';
  el.style.fontSize      = '0.85rem';
  el.style.display       = 'inline-block';
}

function drawV3Chart(svgEl, currentPrice, rangeLow, rangeHigh, priceMin, priceMax) {
  if (!svgEl) return;
  svgEl.innerHTML = '';

  var W = 800, H = 120;
  var PAD = { left: 50, right: 20, top: 20, bottom: 30 };
  var innerW = W - PAD.left - PAD.right;
  var innerH = H - PAD.top - PAD.bottom;

  svgEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svgEl.setAttribute('width', '100%');
  svgEl.setAttribute('height', H);

  // Background
  svgEl.appendChild(makeSVGEl('rect', {
    x: 0, y: 0, width: W, height: H,
    fill: '#0f172a', rx: 6
  }));

  function toX(price) {
    var pct = (Math.log(price) - Math.log(priceMin)) /
              (Math.log(priceMax) - Math.log(priceMin));
    return PAD.left + pct * innerW;
  }

  // Tick marks on axis
  var tickCount = 6;
  for (var ti = 0; ti <= tickCount; ti++) {
    var frac = ti / tickCount;
    var pVal = priceMin * Math.pow(priceMax / priceMin, frac);
    var tx   = PAD.left + frac * innerW;
    // Tick line
    svgEl.appendChild(makeSVGEl('line', {
      x1: tx, y1: PAD.top + innerH,
      x2: tx, y2: PAD.top + innerH + 4,
      stroke: '#475569', 'stroke-width': 1
    }));
    // Tick label
    svgEl.appendChild(makeSVGEl('text', {
      x: tx, y: H - 2,
      fill: '#64748b',
      'font-size': 9,
      'text-anchor': 'middle',
      'font-family': 'monospace'
    })).textContent = pVal >= 1000 ? '$' + (pVal / 1000).toFixed(1) + 'k' : '$' + fmtNum(pVal, 0);
  }

  // Axis line
  svgEl.appendChild(makeSVGEl('line', {
    x1: PAD.left, y1: PAD.top + innerH,
    x2: PAD.left + innerW, y2: PAD.top + innerH,
    stroke: '#334155', 'stroke-width': 1
  }));

  // "Other LP" preset bands (background context)
  var presetRanges = [
    { lo: priceMin * 1.05, hi: rangeLow * 0.95, color: '#1e293b', opacity: 0.5, label: 'Other LP' },
    { lo: rangeHigh * 1.05, hi: priceMax * 0.92, color: '#1e293b', opacity: 0.5, label: 'Other LP' }
  ];
  presetRanges.forEach(function (pr) {
    if (pr.lo >= pr.hi) return;
    var x1 = toX(pr.lo), x2 = toX(pr.hi);
    if (x2 <= x1) return;
    svgEl.appendChild(makeSVGEl('rect', {
      x: x1, y: PAD.top,
      width: x2 - x1, height: innerH,
      fill: pr.color, opacity: pr.opacity, rx: 3
    }));
  });

  // Active liquidity band
  var lx1 = clamp(toX(rangeLow),  PAD.left, PAD.left + innerW);
  var lx2 = clamp(toX(rangeHigh), PAD.left, PAD.left + innerW);

  var sim = new AMMv3Simulator();
  var inRange = sim.isInRange(currentPrice, rangeLow, rangeHigh);
  var bandColor = inRange ? '#1d4ed8' : '#4c1d95';
  var bandOpacity = inRange ? 0.45 : 0.25;

  svgEl.appendChild(makeSVGEl('rect', {
    x: lx1, y: PAD.top,
    width: Math.max(0, lx2 - lx1), height: innerH,
    fill: bandColor, opacity: bandOpacity, rx: 3
  }));
  // Band border
  svgEl.appendChild(makeSVGEl('rect', {
    x: lx1, y: PAD.top,
    width: Math.max(0, lx2 - lx1), height: innerH,
    fill: 'none',
    stroke: inRange ? '#3b82f6' : '#8b5cf6',
    'stroke-width': 1.5, rx: 3
  }));

  // Range boundary tick lines
  [lx1, lx2].forEach(function (bx, bi) {
    svgEl.appendChild(makeSVGEl('line', {
      x1: bx, y1: PAD.top,
      x2: bx, y2: PAD.top + innerH,
      stroke: inRange ? '#60a5fa' : '#a78bfa',
      'stroke-width': 1,
      'stroke-dasharray': '3,2'
    }));
    // Label
    var price = bi === 0 ? rangeLow : rangeHigh;
    svgEl.appendChild(makeSVGEl('text', {
      x: bx, y: PAD.top - 4,
      fill: inRange ? '#60a5fa' : '#a78bfa',
      'font-size': 9,
      'text-anchor': 'middle',
      'font-family': 'monospace'
    })).textContent = fmtPrice(price);
  });

  // Current price vertical line
  var cpx = clamp(toX(currentPrice), PAD.left, PAD.left + innerW);
  svgEl.appendChild(makeSVGEl('line', {
    x1: cpx, y1: PAD.top,
    x2: cpx, y2: PAD.top + innerH,
    stroke: '#22d3ee',
    'stroke-width': 2
  }));

  // Current price label
  svgEl.appendChild(makeSVGEl('text', {
    x: cpx, y: PAD.top - 4,
    fill: '#22d3ee',
    'font-size': 10,
    'text-anchor': 'middle',
    'font-family': 'monospace',
    'font-weight': 'bold'
  })).textContent = fmtPrice(currentPrice);

  // Y-axis label (liquidity)
  svgEl.appendChild(makeSVGEl('text', {
    x: PAD.left - 8,
    y: PAD.top + innerH / 2 + 3,
    fill: '#64748b',
    'font-size': 9,
    'text-anchor': 'end',
    'font-family': 'sans-serif',
    transform: 'rotate(-90, ' + (PAD.left - 8) + ', ' + (PAD.top + innerH / 2 + 3) + ')'
  })).textContent = 'Liquidity';

  // Legend
  svgEl.appendChild(makeSVGEl('rect', {
    x: W - 130, y: 8, width: 10, height: 10,
    fill: '#1d4ed8', opacity: 0.7, rx: 2
  }));
  svgEl.appendChild(makeSVGEl('text', {
    x: W - 116, y: 17, fill: '#94a3b8',
    'font-size': 9, 'font-family': 'sans-serif'
  })).textContent = 'Your Range';

  svgEl.appendChild(makeSVGEl('line', {
    x1: W - 130, y1: 28, x2: W - 120, y2: 28,
    stroke: '#22d3ee', 'stroke-width': 2
  }));
  svgEl.appendChild(makeSVGEl('text', {
    x: W - 116, y: 31, fill: '#94a3b8',
    'font-size': 9, 'font-family': 'sans-serif'
  })).textContent = 'Current Price';
}

function startV3Simulation() {
  if (v3SimRunning) {
    stopV3Simulation();
    return;
  }

  var btn = document.getElementById('c3-simulate-btn');

  var priceEl    = document.getElementById('c3-price-current');
  var lowEl      = document.getElementById('c3-range-low');
  var highEl     = document.getElementById('c3-range-high');
  var feeCountEl = document.getElementById('c3-fee-counter');

  if (!priceEl || !lowEl || !highEl) return;

  var basePrice  = parseFloat(priceEl.value)  || 2000;
  var rangeLow   = parseFloat(lowEl.value)    || 1800;
  var rangeHigh  = parseFloat(highEl.value)   || 2200;

  var amplitude    = (rangeHigh - rangeLow) * 0.8;
  var period       = 12000; // 12 seconds full cycle
  var startTime    = performance.now();
  var lastFeeCheck = false;

  v3FeeCount   = 0;
  v3SimRunning = true;
  if (feeCountEl) feeCountEl.textContent = '0';
  if (btn) {
    btn.textContent = 'Stop Simulation';
    btn.style.background = '#7f1d1d';
  }

  function tick(now) {
    if (!v3SimRunning) return;

    var elapsed     = now - startTime;
    var phase       = (elapsed / period) * 2 * Math.PI;
    var simPrice    = basePrice + amplitude * Math.sin(phase);

    // Update price input
    if (priceEl) priceEl.value = simPrice.toFixed(2);

    // Fee counter: increment when in range (detect rising edge)
    var sim = new AMMv3Simulator();
    var inRange = sim.isInRange(simPrice, rangeLow, rangeHigh);
    if (inRange && !lastFeeCheck) {
      // Each crossing of the range boundary triggers a fee notch
    }
    if (inRange) {
      // Accumulate fees every ~200ms while in range
      if ((elapsed % 200) < 20) {
        v3FeeCount++;
        if (feeCountEl) feeCountEl.textContent = v3FeeCount.toLocaleString();
      }
    }
    lastFeeCheck = inRange;

    updateInRangeIndicator(simPrice, rangeLow, rangeHigh);

    var svgEl    = document.getElementById('c3-svg');
    var priceMin = Math.min(rangeLow, simPrice) * 0.7;
    var priceMax = Math.max(rangeHigh, simPrice) * 1.3;
    drawV3Chart(svgEl, simPrice, rangeLow, rangeHigh, priceMin, priceMax);

    // Update tick display
    var tickCurEl = document.getElementById('c3-tick-current');
    if (tickCurEl) tickCurEl.textContent = sim.priceToTick(simPrice).toLocaleString();

    // Loop for ~12 seconds then auto-stop
    if (elapsed < period * 2) {
      v3SimInterval = requestAnimationFrame(tick);
    } else {
      stopV3Simulation();
    }
  }

  v3SimInterval = requestAnimationFrame(tick);
}

function stopV3Simulation() {
  v3SimRunning = false;
  if (v3SimInterval) {
    cancelAnimationFrame(v3SimInterval);
    v3SimInterval = null;
  }
  var btn = document.getElementById('c3-simulate-btn');
  if (btn) {
    btn.textContent = 'Simulate Price Movement';
    btn.style.background = '';
  }
  // Redraw with current (stopped) values
  onV3Change();
}

// ─────────────────────────────────────────────────────────────
// SECTION 6: StableSwap Curve Visualization (Component 0)
// ─────────────────────────────────────────────────────────────

// Solve for y in the 2-token StableSwap invariant:
// 4A(x+y) + D = 4AD + D^3/(4xy)
// Using Newton's method on the rearranged quadratic:
//   F(y) = 4A*y^2 + (4A*(x-D)+D)*y - D^3/(4x) = 0
//   y_new = (4A*y^2 + D^3/(4x)) / (8A*y + 4A*(x-D) + D)
function stableSwapSolveY(x, D, A) {
  if (x <= 0 || D <= 0 || A <= 0) return 0;
  var D3_4x = (D * D * D) / (4 * x);
  var y = D / 2;  // start at equilibrium guess
  for (var i = 0; i < 256; i++) {
    var yPrev = y;
    var num = 4 * A * y * y + D3_4x;
    var den = 8 * A * y + 4 * A * (x - D) + D;
    if (Math.abs(den) < 1e-12) break;
    y = num / den;
    if (Math.abs(y - yPrev) < 1e-9) break;
  }
  return y;
}

function initStableSwapViz() {
  var svgEl   = document.getElementById('c0-svg');
  var slider  = document.getElementById('c0-a-slider');
  var aValEl  = document.getElementById('c0-a-value');
  var tbody   = document.getElementById('c0-impact-table-body');
  if (!svgEl || !slider) return;

  var D = 2000;
  var ns = 'http://www.w3.org/2000/svg';
  var SVG_W = 400, SVG_H = 400, PAD = 48;
  var plotW = SVG_W - PAD * 2, plotH = SVG_H - PAD * 2;

  // Mild adaptive zoom: tick labels change as A grows, but never clips
  // past ±35% of half-range so the curve shape stays visible.
  function getViewport(A) {
    var t = Math.sqrt(Math.min(1, Math.log10(Math.max(1, A)) / Math.log10(2000)));
    var halfRange = Math.round(D * 0.5 * (1 - t * 0.35));
    return { lo: D / 2 - halfRange, hi: D / 2 + halfRange };
  }

  // These are reassigned per drawChart call
  var _vLo = 0, _vHi = D;
  function toSX(x) { return PAD + ((x - _vLo) / (_vHi - _vLo)) * plotW; }
  function toSY(y) { return (SVG_H - PAD) - ((y - _vLo) / (_vHi - _vLo)) * plotH; }

  function makeEl(tag, attrs) {
    var el = document.createElementNS(ns, tag);
    Object.keys(attrs).forEach(function(k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function buildPath(pts, color, width, dash) {
    if (!pts.length) return null;
    var d = pts.map(function(p, i) { return (i === 0 ? 'M' : 'L') + ' ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var attrs = { d: d, stroke: color, 'stroke-width': width || '2', fill: 'none' };
    if (dash) attrs['stroke-dasharray'] = dash;
    return makeEl('path', attrs);
  }

  function drawChart(A) {
    // Update adaptive viewport
    var vp = getViewport(A);
    _vLo = vp.lo;
    _vHi = vp.hi;
    var vRange = _vHi - _vLo;

    svgEl.innerHTML = '';

    // Background
    svgEl.appendChild(makeEl('rect', { width: SVG_W, height: SVG_H, fill: '#0a0e17', rx: '8' }));

    // Dynamic tick values: 5 evenly spaced across current viewport
    var ticks = [];
    for (var ti = 0; ti <= 4; ti++) ticks.push(_vLo + (ti / 4) * vRange);

    // Grid
    ticks.forEach(function(t) {
      var gx = toSX(t), gy = toSY(t);
      svgEl.appendChild(makeEl('line', { x1: gx, y1: PAD, x2: gx, y2: SVG_H - PAD, stroke: '#1c2535', 'stroke-width': '1' }));
      svgEl.appendChild(makeEl('line', { x1: PAD, y1: gy, x2: SVG_W - PAD, y2: gy, stroke: '#1c2535', 'stroke-width': '1' }));
    });

    // Axes
    svgEl.appendChild(makeEl('line', { x1: PAD, y1: SVG_H - PAD, x2: SVG_W - PAD, y2: SVG_H - PAD, stroke: '#4a5568', 'stroke-width': '1.5' }));
    svgEl.appendChild(makeEl('line', { x1: PAD, y1: PAD, x2: PAD, y2: SVG_H - PAD, stroke: '#4a5568', 'stroke-width': '1.5' }));

    // Tick labels
    ticks.forEach(function(t) {
      var label = Math.round(t).toString();
      var tx = makeEl('text', { x: toSX(t), y: SVG_H - PAD + 14, 'text-anchor': 'middle', fill: '#6b7280', 'font-size': '9' });
      tx.textContent = label;
      svgEl.appendChild(tx);
      var ty = makeEl('text', { x: PAD - 4, y: toSY(t) + 3, 'text-anchor': 'end', fill: '#6b7280', 'font-size': '9' });
      ty.textContent = label;
      svgEl.appendChild(ty);
    });

    // Axis labels
    var lx = makeEl('text', { x: SVG_W - PAD + 6, y: SVG_H - PAD + 4, fill: '#9ca3af', 'font-size': '12' });
    lx.textContent = 'x';
    svgEl.appendChild(lx);
    var ly = makeEl('text', { x: PAD - 22, y: PAD - 6, fill: '#9ca3af', 'font-size': '12' });
    ly.textContent = 'y';
    svgEl.appendChild(ly);

    if (_vLo > 0) {
      var vpLbl = makeEl('text', { x: SVG_W - PAD - 2, y: PAD - 6, 'text-anchor': 'end', fill: '#6366f1', 'font-size': '9', 'font-style': 'italic' });
      vpLbl.textContent = '⊕ 已放大 [' + Math.round(_vLo) + '–' + Math.round(_vHi) + ']';
      svgEl.appendChild(vpLbl);
    }

    // Curve generation — sample within extended range so curves fill the viewport
    var N = 300;
    var xMin = Math.max(D * 0.003, _vLo * 0.98);
    var xMax = Math.min(D * 0.997, _vHi * 1.02);
    var k = (D / 2) * (D / 2);

    var csmmPts = [], cpmmPts = [], ssPts = [];
    for (var i = 0; i <= N; i++) {
      var x = xMin + (i / N) * (xMax - xMin);

      // CSMM: y = D - x
      var yCS = D - x;
      if (yCS >= _vLo && yCS <= _vHi) csmmPts.push([toSX(x), toSY(yCS)]);

      // CPMM: y = k / x
      var yCPMM = k / x;
      if (yCPMM >= _vLo && yCPMM <= _vHi * 1.1) cpmmPts.push([toSX(x), toSY(yCPMM)]);

      // StableSwap
      var ySS = stableSwapSolveY(x, D, A);
      if (isFinite(ySS) && ySS >= _vLo && ySS <= _vHi * 1.1) ssPts.push([toSX(x), toSY(ySS)]);
    }

    var csmmPath = buildPath(csmmPts, '#ef4444', '1.5', '6,4');
    var cpmmPath = buildPath(cpmmPts, '#3b82f6', '1.5', '4,3');
    var ssPath   = buildPath(ssPts,   '#22d3ee', '2.5', null);
    if (csmmPath) svgEl.appendChild(csmmPath);
    if (cpmmPath) svgEl.appendChild(cpmmPath);
    if (ssPath)   svgEl.appendChild(ssPath);

    // Equilibrium point — always at (D/2, D/2) = (1000, 1000)
    var eqCx = toSX(D / 2), eqCy = toSY(D / 2);
    if (eqCx >= PAD && eqCx <= SVG_W - PAD && eqCy >= PAD && eqCy <= SVG_H - PAD) {
      svgEl.appendChild(makeEl('circle', { cx: eqCx, cy: eqCy, r: '5', fill: '#fbbf24', stroke: '#0a0e17', 'stroke-width': '1.5' }));
      var eqLbl = makeEl('text', { x: eqCx + 8, y: eqCy - 7, fill: '#fbbf24', 'font-size': '9' });
      eqLbl.textContent = '均衡 (1000,1000)';
      svgEl.appendChild(eqLbl);
    }
  }

  function updateTable(A) {
    var x0 = D / 2, k = x0 * x0;
    // Spot price at equilibrium = y0/x0 = 1.0
    var rows = [50, 100, 200, 400].map(function(dx) {
      var pctLabel = (dx / x0 * 100).toFixed(0) + '% (' + dx + ')';

      // CSMM: zero slippage (price always 1:1)
      var piCSSM = '0.00%';

      // CPMM (no fee for comparison clarity)
      var xNew = x0 + dx;
      var yOut_cpmm = x0 - k / xNew;
      var pi_cpmm = ((1 - yOut_cpmm / dx) * 100).toFixed(2) + '%';

      // StableSwap
      var yNew_ss = stableSwapSolveY(xNew, D, A);
      var yOut_ss = x0 - yNew_ss;
      var pi_ss_num = (1 - yOut_ss / dx) * 100;
      var pi_ss = pi_ss_num.toFixed(2) + '%';
      var piClass = pi_ss_num < parseFloat(pi_cpmm) ? 'good' : '';

      return '<tr><td>' + pctLabel + '</td><td class="good">' + piCSSM + '</td><td class="' + piClass + '">' + pi_ss + '</td><td class="bad">' + pi_cpmm + '</td></tr>';
    });
    tbody.innerHTML = rows.join('');
  }

  function sliderToA(s) {
    // 0–100 slider → exponential A in [1, 2000]
    return Math.max(1, Math.round(Math.pow(10, s / 100 * Math.log10(2000))));
  }

  function update() {
    var A = sliderToA(parseInt(slider.value, 10));
    aValEl.textContent = A;
    drawChart(A);
    updateTable(A);
  }

  slider.addEventListener('input', update);
  update();
}

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// SECTION 7: Price Impact Depth Chart (Chart.js bar)
// ─────────────────────────────────────────────────────────────

function drawDepthChart(reserveX, reserveY) {
  var canvas = document.getElementById('c1-depth-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  var pcts   = [0.5, 1, 2, 5, 10, 20, 50];
  var labels = ['0.5%', '1%', '2%', '5%', '10%', '20%', '50%'];

  var impacts = pcts.map(function (p) {
    var amIn  = reserveX * p / 100;
    var amOut = (reserveY * amIn * 0.997) / (reserveX + amIn * 0.997);
    var spot  = reserveY / reserveX;
    return Math.abs((spot - amOut / amIn) / spot * 100);
  });

  var colors = impacts.map(function (v) {
    return v < 1 ? 'rgba(34,197,94,0.8)' : v < 5 ? 'rgba(245,158,11,0.8)' : 'rgba(239,68,68,0.8)';
  });
  var borderColors = impacts.map(function (v) {
    return v < 1 ? '#22c55e' : v < 5 ? '#f59e0b' : '#ef4444';
  });

  // 5% reference line via annotation-free approach: use a hidden dataset
  var refLine = impacts.map(function () { return 5; });

  if (_depthChart) { _depthChart.destroy(); _depthChart = null; }

  _depthChart = new Chart(canvas, {
    data: {
      labels: labels,
      datasets: [
        {
          type: 'bar',
          label: '价格影响',
          data: impacts,
          backgroundColor: colors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 5,
          order: 2
        },
        {
          type: 'line',
          label: '5% 警戒线',
          data: refLine,
          borderColor: 'rgba(239,68,68,0.5)',
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180 },
      plugins: {
        legend: {
          labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 14, padding: 12 }
        },
        tooltip: {
          filter: function (item) { return item.datasetIndex === 0; },
          callbacks: {
            label: function (ctx) { return '价格影响: ' + ctx.parsed.y.toFixed(3) + '%'; }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: '交易量（占池子 ETH 储备 %）', color: '#6b7280', font: { size: 10 } },
          ticks: { color: '#9ca3af', font: { size: 11 } },
          grid: { color: 'rgba(28,37,53,0.9)' }
        },
        y: {
          title: { display: true, text: '价格影响 %', color: '#6b7280', font: { size: 10 } },
          ticks: {
            color: '#9ca3af', font: { size: 10 },
            callback: function (v) { return v + '%'; }
          },
          grid: { color: 'rgba(28,37,53,0.9)' }
        }
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────
// SECTION 8: Flash Swap Step Animator (Component 1b)
// ─────────────────────────────────────────────────────────────

function initFlashSwapDemo() {
  var btn   = document.getElementById('c1-flashswap-btn');
  var reset = document.getElementById('c1-flashswap-reset');
  var status = document.getElementById('c1-flashswap-status');
  if (!btn) return;

  var BORROW_ETH  = 10;
  var PRICE_UNI   = 2000;    // Uniswap price
  var PRICE_CEX   = 2050;    // Coinbase price
  var FEE_RATE    = 1.003;   // 0.3% Uniswap fee
  var GAS_COST    = 30;      // USD gas

  var revenue    = BORROW_ETH * PRICE_CEX;
  var repayment  = BORROW_ETH * PRICE_UNI * FEE_RATE;
  var profit     = revenue - repayment - GAS_COST;

  var STAGES = [
    { id: 'fs-stage-0', valId: 'fs-val-0', value: '请求 ' + BORROW_ETH + ' ETH', color: '#22d3ee' },
    { id: 'fs-stage-1', valId: 'fs-val-1', value: '+' + BORROW_ETH + ' ETH 已到账', color: '#22d3ee' },
    { id: 'fs-stage-2', valId: 'fs-val-2', value: '+$' + revenue.toLocaleString() + ' USDC', color: '#22c55e' },
    { id: 'fs-stage-3', valId: 'fs-val-3', value: '净利润 +$' + profit.toFixed(0), color: '#22c55e' }
  ];

  var running = false;

  function resetStages() {
    STAGES.forEach(function(s) {
      var el = document.getElementById(s.id);
      var valEl = document.getElementById(s.valId);
      if (el) { el.classList.remove('active', 'done'); }
      if (valEl) { valEl.textContent = '等待…'; valEl.style.color = ''; }
    });
    if (status) status.textContent = '点击「运行模拟」开始演示';
    if (btn) { btn.disabled = false; btn.textContent = '▶ 运行模拟'; }
    running = false;
  }

  function runSimulation() {
    if (running) return;
    running = true;
    btn.disabled = true;

    var msgs = [
      '第①步：调用 Uniswap swap()，请求 ' + BORROW_ETH + ' ETH 无抵押借款…',
      '第②步：' + BORROW_ETH + ' ETH 已打入合约，回调 uniswapV2Call() 中…',
      '第③步：在 Coinbase 以 $' + PRICE_CEX + '/ETH 卖出，收入 $' + revenue.toLocaleString() + '…',
      '第④步：还款 $' + repayment.toLocaleString() + ' USDC，扣 Gas $' + GAS_COST + '，净利润 $' + profit.toFixed(0) + '！'
    ];

    var delays = [0, 800, 1600, 2400];

    STAGES.forEach(function(s, i) {
      setTimeout(function() {
        // Mark previous done
        if (i > 0) {
          var prev = document.getElementById(STAGES[i-1].id);
          if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }
        }
        var el = document.getElementById(s.id);
        var valEl = document.getElementById(s.valId);
        if (el) el.classList.add('active');
        if (valEl) {
          valEl.textContent = s.value;
          valEl.style.color = s.color;
        }
        if (status) status.textContent = msgs[i];
      }, delays[i]);
    });

    // Finish
    setTimeout(function() {
      var last = document.getElementById(STAGES[STAGES.length-1].id);
      if (last) { last.classList.remove('active'); last.classList.add('done'); }
      if (status) {
        status.innerHTML = '✅ 整笔交易完成！若任意步骤失败（如 Coinbase 价格变动导致亏损），整笔交易 <strong>revert</strong>，本金零损失。';
      }
      btn.textContent = '已完成';
    }, 3200);
  }

  btn.addEventListener('click', runSimulation);
  reset.addEventListener('click', resetStages);
}

// ─────────────────────────────────────────────────────────────
// SECTION 9: Bootstrap — called from main.js after DOMContentLoaded
// ─────────────────────────────────────────────────────────────

function initAllAMMComponents() {
  initAMMCalculator();
  initILCalculator();
  initV3Visualizer();
}
