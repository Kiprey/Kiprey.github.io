// ============================================================
// mev-sim.js  –  Sandwich Attack Step-by-Step Simulator
// Component 4 for the AMM/MEV Education Website
// Pure vanilla JS, no ES modules, everything global
// ============================================================

// ─────────────────────────────────────────────────────────────
// 1.  Core Math: SandwichSimulator
// ─────────────────────────────────────────────────────────────

var SandwichSimulator = (function () {
  function SandwichSimulator(poolETH, poolUSDC, victimETH, slippage) {
    this.poolETH   = poolETH;
    this.poolUSDC  = poolUSDC;
    this.victimETH = victimETH;
    this.slippage  = slippage; // 0.01 = 1%
    this.k         = poolETH * poolUSDC;
  }

  SandwichSimulator.prototype.spotPrice = function (eth, usdc) {
    return usdc / eth;
  };

  // ETH → USDC with 0.3% fee (AMM constant-product)
  SandwichSimulator.prototype.swapETHforUSDC = function (ethIn, reserveETH, reserveUSDC) {
    var amountInFee = ethIn * 0.997;
    var amountOut   = (reserveUSDC * amountInFee) / (reserveETH + amountInFee);
    return {
      usdcOut : amountOut,
      newETH  : reserveETH  + ethIn,
      newUSDC : reserveUSDC - amountOut
    };
  };

  // USDC → ETH with 0.3% fee
  SandwichSimulator.prototype.swapUSDCforETH = function (usdcIn, reserveETH, reserveUSDC) {
    var amountInFee = usdcIn * 0.997;
    var amountOut   = (reserveETH * amountInFee) / (reserveUSDC + amountInFee);
    return {
      ethOut  : amountOut,
      newETH  : reserveETH  - amountOut,
      newUSDC : reserveUSDC + usdcIn
    };
  };

  // Victim's naively expected output at pre-attack spot price
  SandwichSimulator.prototype.victimExpected = function () {
    return this.victimETH * this.spotPrice(this.poolETH, this.poolUSDC);
  };

  // Victim's minimum acceptable USDC output
  SandwichSimulator.prototype.victimMinOutput = function () {
    return this.victimExpected() * (1 - this.slippage);
  };

  // Binary search for the largest front-run ETH amount such that
  // the victim still receives >= their minimum acceptable output.
  SandwichSimulator.prototype.computeOptimalFrontRun = function () {
    var minOutput = this.victimMinOutput();
    var lo = 0;
    var hi = this.poolETH * 0.5;

    for (var i = 0; i < 64; i++) {
      var mid      = (lo + hi) / 2;
      var afterBot = this.swapETHforUSDC(mid, this.poolETH, this.poolUSDC);
      var victimResult = this.swapETHforUSDC(
        this.victimETH, afterBot.newETH, afterBot.newUSDC
      );
      if (victimResult.usdcOut >= minOutput) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return lo;
  };

  // Run full simulation; return array of 6 step-state objects (steps 0-5).
  SandwichSimulator.prototype.simulate = function () {
    var self = this;

    // ── Step 0: Initial state ──────────────────────────────
    var initPrice = self.spotPrice(self.poolETH, self.poolUSDC);

    // ── Step 1: Calculate optimal front-run ───────────────
    var botFrontETH     = self.computeOptimalFrontRun();
    var victimExpected  = self.victimExpected();
    var victimMin       = self.victimMinOutput();
    var worstPrice      = victimMin / self.victimETH;

    // ── Step 2: Bot front-runs ─────────────────────────────
    var afterFront      = self.swapETHforUSDC(botFrontETH, self.poolETH, self.poolUSDC);
    var priceAfterFront = self.spotPrice(afterFront.newETH, afterFront.newUSDC);
    var botUSDC         = afterFront.usdcOut; // USDC bot now holds

    // ── Step 3: Victim trades ──────────────────────────────
    var afterVictim     = self.swapETHforUSDC(
      self.victimETH, afterFront.newETH, afterFront.newUSDC
    );
    var victimActual    = afterVictim.usdcOut;
    var victimLoss      = victimExpected - victimActual;
    var victimLossPct   = (victimLoss / victimExpected) * 100;
    var priceAfterVic   = self.spotPrice(afterVictim.newETH, afterVictim.newUSDC);

    // ── Step 4: Bot back-runs ──────────────────────────────
    var afterBack       = self.swapUSDCforETH(botUSDC, afterVictim.newETH, afterVictim.newUSDC);
    var botETHOut       = afterBack.ethOut;
    var botProfit       = botUSDC - botFrontETH * initPrice; // simplified profit in USDC terms
    // More precise: bot spent botFrontETH ETH, got botUSDC USDC, then spent botUSDC, got botETHOut ETH
    // Bot net in ETH = botETHOut - botFrontETH
    var botNetETH       = botETHOut - botFrontETH;
    var botNetUSDC      = botNetETH * priceAfterBack(afterBack, afterVictim);

    function priceAfterBack(ab, av) {
      return self.spotPrice(ab.newETH, ab.newUSDC);
    }
    var finalPrice = self.spotPrice(afterBack.newETH, afterBack.newUSDC);

    // ── Package step states ────────────────────────────────
    return [
      // Step 0 – Initial state
      {
        step      : 0,
        label     : '初始状态',
        narrative : '受害者准备在 Uniswap 上出售 ' + fmt(self.victimETH) + ' ETH 换取 USDC。\n池子当前状态：ETH 储备 ' + fmt(self.poolETH) + '，USDC 储备 ' + fmtUSDC(self.poolUSDC) + '，现货价格 ' + fmtUSDC(initPrice) + ' USDC/ETH。\n受害者的交易已广播到 mempool，正在等待矿工打包。',
        poolETH   : self.poolETH,
        poolUSDC  : self.poolUSDC,
        spotPrice : initPrice,
        mempoolState : { victim: true, bot: false },
        blockState   : [],
        botBalance   : { eth: 0, usdc: 0 },
        victimBalance: { expectedUSDC: victimExpected, actualUSDC: null },
        highlight    : 'victim-mempool'
      },

      // Step 1 – MEV Bot 检测
      {
        step      : 1,
        label     : 'MEV Bot 检测',
        narrative : 'MEV bot 在 mempool 中发现了这笔交易！\n受害者最大滑点是 ' + fmtPct(self.slippage * 100) + '%，意味着他们能接受的最差价格约为 ' + fmtUSDC(worstPrice) + ' USDC/ETH（最低收到 ' + fmtUSDC(victimMin) + ' USDC）。\nBot 计算出最优前跑量为 ' + fmt(botFrontETH) + ' ETH，这恰好将池子价格推到受害者滑点容忍的边界。',
        poolETH   : self.poolETH,
        poolUSDC  : self.poolUSDC,
        spotPrice : initPrice,
        mempoolState : { victim: true, bot: true },
        blockState   : [],
        botBalance   : { eth: 0, usdc: 0 },
        victimBalance: { expectedUSDC: victimExpected, actualUSDC: null },
        highlight    : 'bot-mempool',
        botCalc      : { frontRunETH: botFrontETH, worstPrice: worstPrice, victimMin: victimMin }
      },

      // Step 2 – Bot 前跑
      {
        step      : 2,
        label     : 'Bot 前跑（Front-run）',
        narrative : 'Bot 以更高 gas 价格将 ' + fmt(botFrontETH) + ' ETH 换为 USDC，优先被矿工打包。\n池子价格从 ' + fmtUSDC(initPrice) + ' 上涨至 ' + fmtUSDC(priceAfterFront) + ' USDC/ETH。\nBot 获得 ' + fmtUSDC(botUSDC) + ' USDC，当前持有该 USDC 头寸等待后续操作。',
        poolETH   : afterFront.newETH,
        poolUSDC  : afterFront.newUSDC,
        spotPrice : priceAfterFront,
        mempoolState : { victim: true, bot: false },
        blockState   : [{ id: 'bot-front', label: 'Bot 买入 ' + fmt(botFrontETH) + ' ETH', type: 'bot' }],
        botBalance   : { eth: -botFrontETH, usdc: botUSDC },
        victimBalance: { expectedUSDC: victimExpected, actualUSDC: null },
        highlight    : 'bot-confirmed'
      },

      // Step 3 – 受害者成交
      {
        step      : 3,
        label     : '受害者成交',
        narrative : '受害者的交易在更差的价格成交。\n预期收到约 ' + fmtUSDC(victimExpected) + ' USDC，实际仅收到 ' + fmtUSDC(victimActual) + ' USDC。\n损失约 ' + fmtUSDC(victimLoss) + ' USDC（' + fmtPct(victimLossPct) + '% 额外滑点）。\n注意：此损失恰好在受害者设定的滑点容忍范围内，受害者无法撤销。',
        poolETH   : afterVictim.newETH,
        poolUSDC  : afterVictim.newUSDC,
        spotPrice : priceAfterVic,
        mempoolState : { victim: false, bot: false },
        blockState   : [
          { id: 'bot-front',    label: 'Bot 买入 ' + fmt(botFrontETH) + ' ETH',   type: 'bot' },
          { id: 'victim-trade', label: '受害者 卖出 ' + fmt(self.victimETH) + ' ETH', type: 'victim' }
        ],
        botBalance   : { eth: -botFrontETH, usdc: botUSDC },
        victimBalance: { expectedUSDC: victimExpected, actualUSDC: victimActual, loss: victimLoss, lossPct: victimLossPct },
        highlight    : 'victim-confirmed'
      },

      // Step 4 – Bot 后跑
      {
        step      : 4,
        label     : 'Bot 后跑（Back-run）',
        narrative : 'Bot 将持有的 ' + fmtUSDC(botUSDC) + ' USDC 全部卖回 ETH。\n由于受害者的大额 ETH 卖出压低了 ETH 价格（即推高了 USDC 相对 ETH 的价格），bot 以更优惠的价格买回 ETH。\nBot 卖出 ' + fmtUSDC(botUSDC) + ' USDC，收回 ' + fmt(botETHOut) + ' ETH，净赚 ' + fmt(botNetETH) + ' ETH。',
        poolETH   : afterBack.newETH,
        poolUSDC  : afterBack.newUSDC,
        spotPrice : finalPrice,
        mempoolState : { victim: false, bot: false },
        blockState   : [
          { id: 'bot-front',    label: 'Bot 买入 ' + fmt(botFrontETH) + ' ETH',      type: 'bot' },
          { id: 'victim-trade', label: '受害者 卖出 ' + fmt(self.victimETH) + ' ETH', type: 'victim' },
          { id: 'bot-back',     label: 'Bot 卖出 ' + fmtUSDC(botUSDC) + ' USDC',    type: 'bot' }
        ],
        botBalance   : { eth: botNetETH, usdc: botNetETH * finalPrice },
        victimBalance: { expectedUSDC: victimExpected, actualUSDC: victimActual, loss: victimLoss, lossPct: victimLossPct },
        highlight    : 'bot-backrun',
        backrun      : { botETHOut: botETHOut, botNetETH: botNetETH }
      },

      // Step 5 – 结果总结
      {
        step      : 5,
        label     : '结果总结',
        narrative : '攻击完成，整个过程在同一个区块内完成。\nBot 净赚约 ' + fmt(botNetETH) + ' ETH（折合约 ' + fmtUSDC(botNetETH * finalPrice) + ' USDC）。\n受害者多损失了 ' + fmtUSDC(victimLoss) + ' USDC（' + fmtPct(victimLossPct) + '% 额外滑点）。\n这一切发生时，受害者甚至没有意识到自己成为了三明治攻击的目标。',
        poolETH   : afterBack.newETH,
        poolUSDC  : afterBack.newUSDC,
        spotPrice : finalPrice,
        mempoolState : { victim: false, bot: false },
        blockState   : [
          { id: 'bot-front',    label: 'Bot 买入 ' + fmt(botFrontETH) + ' ETH',      type: 'bot' },
          { id: 'victim-trade', label: '受害者 卖出 ' + fmt(self.victimETH) + ' ETH', type: 'victim' },
          { id: 'bot-back',     label: 'Bot 卖出 ' + fmtUSDC(botUSDC) + ' USDC',    type: 'bot' }
        ],
        botBalance   : { eth: botNetETH, usdc: botNetETH * finalPrice },
        victimBalance: { expectedUSDC: victimExpected, actualUSDC: victimActual, loss: victimLoss, lossPct: victimLossPct },
        highlight    : 'summary',
        summary: {
          initPrice     : initPrice,
          finalPrice    : finalPrice,
          botFrontETH   : botFrontETH,
          botUSDC       : botUSDC,
          botETHOut     : botETHOut,
          botNetETH     : botNetETH,
          botNetUSDC    : botNetETH * finalPrice,
          victimExpected: victimExpected,
          victimActual  : victimActual,
          victimLoss    : victimLoss,
          victimLossPct : victimLossPct
        }
      }
    ];
  };

  return SandwichSimulator;
})();


// ─────────────────────────────────────────────────────────────
// 2.  Formatting helpers
// ─────────────────────────────────────────────────────────────

function fmt(n) {
  if (n === null || n === undefined) return '-';
  return parseFloat(n.toFixed(4)).toString();
}

function fmtUSDC(n) {
  if (n === null || n === undefined) return '-';
  return parseFloat(n.toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (n === null || n === undefined) return '-';
  return parseFloat(n.toFixed(3)).toString();
}


// ─────────────────────────────────────────────────────────────
// 3.  Module-level state
// ─────────────────────────────────────────────────────────────

var _sandwich = {
  sim         : null,
  steps       : [],
  currentStep : 0,
  autoInterval: null,
  isPlaying   : false
};


// ─────────────────────────────────────────────────────────────
// 4.  Public init function
// ─────────────────────────────────────────────────────────────

function initSandwichSim() {
  var stepBtn  = document.getElementById('sandwich-step-btn');
  var autoBtn  = document.getElementById('sandwich-auto-btn');
  var resetBtn = document.getElementById('sandwich-reset-btn');

  if (!stepBtn || !autoBtn || !resetBtn) return;

  // Wire up controls
  stepBtn.addEventListener('click', function () {
    sandwichStepForward();
  });

  autoBtn.addEventListener('click', function () {
    if (_sandwich.isPlaying) {
      sandwichStopAuto();
    } else {
      sandwichStartAuto();
    }
  });

  resetBtn.addEventListener('click', function () {
    sandwichReset();
  });

  // Also allow re-running when input params change
  var inputIds = ['sandwich-pool-eth', 'sandwich-pool-usdc', 'sandwich-victim-eth', 'sandwich-slippage'];
  inputIds.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', function () {
        sandwichReset();
      });
    }
  });

  // Initial build
  sandwichReset();
}


// ─────────────────────────────────────────────────────────────
// 5.  Build / reset simulation from current input values
// ─────────────────────────────────────────────────────────────

function sandwichReset() {
  sandwichStopAuto();

  var poolETH    = parseFloat(document.getElementById('sandwich-pool-eth')   ? document.getElementById('sandwich-pool-eth').value   : 1000)  || 1000;
  var poolUSDC   = parseFloat(document.getElementById('sandwich-pool-usdc')  ? document.getElementById('sandwich-pool-usdc').value  : 2000000) || 2000000;
  var victimETH  = parseFloat(document.getElementById('sandwich-victim-eth') ? document.getElementById('sandwich-victim-eth').value : 10)    || 10;
  var slippagePct= parseFloat(document.getElementById('sandwich-slippage')   ? document.getElementById('sandwich-slippage').value   : 1)     || 1;
  var slippage   = slippagePct / 100;

  _sandwich.sim         = new SandwichSimulator(poolETH, poolUSDC, victimETH, slippage);
  _sandwich.steps       = _sandwich.sim.simulate();
  _sandwich.currentStep = 0;

  // Reset all tx card positions
  sandwichResetTxCards();

  // Render step 0
  updateSandwichDisplay(_sandwich.steps[0]);
  updateStepIndicator();

  var stepBtn = document.getElementById('sandwich-step-btn');
  if (stepBtn) { stepBtn.disabled = false; stepBtn.textContent = '下一步 →'; }
}


// ─────────────────────────────────────────────────────────────
// 6.  Step forward
// ─────────────────────────────────────────────────────────────

function sandwichStepForward() {
  if (_sandwich.currentStep >= _sandwich.steps.length - 1) {
    sandwichStopAuto();
    var stepBtn = document.getElementById('sandwich-step-btn');
    if (stepBtn) { stepBtn.disabled = true; stepBtn.textContent = '已完成 — 点击重置继续'; }
    return;
  }

  _sandwich.currentStep++;
  var state = _sandwich.steps[_sandwich.currentStep];

  updateSandwichDisplay(state);
  updateStepIndicator();

  // Trigger animation for this step
  sandwichAnimateStep(state);

  if (_sandwich.currentStep === _sandwich.steps.length - 1) {
    sandwichStopAuto();
    var sb = document.getElementById('sandwich-step-btn');
    if (sb) { sb.disabled = true; sb.textContent = '已完成 — 点击重置继续'; }
  }
}


// ─────────────────────────────────────────────────────────────
// 7.  Auto-play
// ─────────────────────────────────────────────────────────────

function sandwichStartAuto() {
  if (_sandwich.isPlaying) return;
  _sandwich.isPlaying = true;

  var autoBtn = document.getElementById('sandwich-auto-btn');
  if (autoBtn) {
    autoBtn.textContent = '⏸ 暂停';
    autoBtn.classList.add('active');
  }

  // If already at end, reset first
  if (_sandwich.currentStep >= _sandwich.steps.length - 1) {
    _sandwich.currentStep = 0;
    sandwichResetTxCards();
    updateSandwichDisplay(_sandwich.steps[0]);
    updateStepIndicator();
    var sb = document.getElementById('sandwich-step-btn');
    if (sb) sb.disabled = false;
  }

  _sandwich.autoInterval = setInterval(function () {
    if (_sandwich.currentStep >= _sandwich.steps.length - 1) {
      sandwichStopAuto();
      return;
    }
    sandwichStepForward();
  }, 3000);
}

function sandwichStopAuto() {
  _sandwich.isPlaying = false;
  if (_sandwich.autoInterval) {
    clearInterval(_sandwich.autoInterval);
    _sandwich.autoInterval = null;
  }
  var autoBtn = document.getElementById('sandwich-auto-btn');
  if (autoBtn) {
    autoBtn.textContent = '▶ 自动播放';
    autoBtn.classList.remove('active');
  }
}


// ─────────────────────────────────────────────────────────────
// 8.  Step indicator
// ─────────────────────────────────────────────────────────────

function updateStepIndicator() {
  var indicator = document.getElementById('sandwich-step-indicator');
  if (indicator) {
    indicator.textContent = '步骤 ' + (_sandwich.currentStep + 1) + ' / ' + _sandwich.steps.length;
  }
}


// ─────────────────────────────────────────────────────────────
// 9.  Main display update
// ─────────────────────────────────────────────────────────────

function updateSandwichDisplay(state) {
  if (!state) return;

  // ── Narrative ──────────────────────────────────────────────
  var narrativeEl = document.getElementById('sandwich-narrative');
  if (narrativeEl) {
    narrativeEl.innerHTML = '';
    // Convert newlines to <br>
    var lines = state.narrative.split('\n');
    lines.forEach(function (line, i) {
      var span = document.createElement('span');
      span.textContent = line;
      narrativeEl.appendChild(span);
      if (i < lines.length - 1) narrativeEl.appendChild(document.createElement('br'));
    });
    narrativeEl.classList.remove('narrative-fade');
    void narrativeEl.offsetWidth; // reflow
    narrativeEl.classList.add('narrative-fade');
  }

  // ── Pool state display ─────────────────────────────────────
  updatePoolStateDisplay(state);

  // ── Mempool lane ───────────────────────────────────────────
  updateMempoolDisplay(state);

  // ── Block lane ─────────────────────────────────────────────
  updateBlockDisplay(state);

  // ── Step-specific extras ───────────────────────────────────
  updateStepExtras(state);

  // ── Result table (step 5) ──────────────────────────────────
  if (state.step === 5) {
    renderResultTable(state);
  } else {
    var tbl = document.getElementById('sandwich-result-table');
    if (tbl) tbl.style.display = 'none';
  }
}


// ─────────────────────────────────────────────────────────────
// 10. Pool state display
// ─────────────────────────────────────────────────────────────

function updatePoolStateDisplay(state) {
  var el = document.getElementById('pool-state-display');
  if (!el) return;

  el.innerHTML = [
    '<div class="pool-stat">',
    '  <span class="pool-stat-label">ETH 储备</span>',
    '  <span class="pool-stat-value">' + fmt(state.poolETH) + ' ETH</span>',
    '</div>',
    '<div class="pool-stat">',
    '  <span class="pool-stat-label">USDC 储备</span>',
    '  <span class="pool-stat-value">' + fmtUSDC(state.poolUSDC) + ' USDC</span>',
    '</div>',
    '<div class="pool-stat pool-stat--price">',
    '  <span class="pool-stat-label">现货价格</span>',
    '  <span class="pool-stat-value">' + fmtUSDC(state.spotPrice) + ' USDC/ETH</span>',
    '</div>'
  ].join('');
}


// ─────────────────────────────────────────────────────────────
// 11. Mempool lane
// ─────────────────────────────────────────────────────────────

function updateMempoolDisplay(state) {
  var victimCard = document.getElementById('mempool-victim-tx');
  var botCard    = document.getElementById('mempool-bot-tx');

  if (victimCard) {
    if (state.mempoolState.victim) {
      victimCard.style.display = '';
      victimCard.classList.remove('tx-confirmed', 'tx-in-block');
    } else {
      victimCard.style.display = 'none';
    }
  }

  if (botCard) {
    if (state.mempoolState.bot) {
      botCard.style.display = '';
      botCard.classList.remove('tx-confirmed', 'tx-in-block');
      // Update bot card text if calculation available
      if (state.botCalc) {
        var inner = botCard.querySelector('.tx-card-body');
        if (inner) {
          inner.textContent = 'Bot 计算前跑量: ' + fmt(state.botCalc.frontRunETH) + ' ETH\n最差价格: ' + fmtUSDC(state.botCalc.worstPrice) + ' USDC/ETH';
        }
      }
    } else {
      botCard.style.display = 'none';
    }
  }
}


// ─────────────────────────────────────────────────────────────
// 12. Block lane
// ─────────────────────────────────────────────────────────────

function updateBlockDisplay(state) {
  var blockList = document.getElementById('block-tx-list');
  if (!blockList) return;

  blockList.innerHTML = '';
  state.blockState.forEach(function (tx) {
    var div = document.createElement('div');
    div.className = 'block-tx-item block-tx-item--' + tx.type;
    div.id        = 'block-item-' + tx.id;

    var icon = document.createElement('span');
    icon.className = 'block-tx-icon';
    icon.textContent = tx.type === 'bot' ? '🤖' : '👤';

    var label = document.createElement('span');
    label.className   = 'block-tx-label';
    label.textContent = tx.label;

    var badge = document.createElement('span');
    badge.className   = 'block-tx-badge';
    badge.textContent = '已确认';

    div.appendChild(icon);
    div.appendChild(label);
    div.appendChild(badge);
    blockList.appendChild(div);
  });
}


// ─────────────────────────────────────────────────────────────
// 13. Step-specific extra info (bot calc panel, victim loss etc.)
// ─────────────────────────────────────────────────────────────

function updateStepExtras(state) {
  // Remove previous extras
  var prevExtra = document.getElementById('sandwich-step-extra');
  if (prevExtra) prevExtra.remove();

  var container = document.getElementById('sandwich-narrative');
  if (!container) return;

  var extra = document.createElement('div');
  extra.id = 'sandwich-step-extra';
  extra.className = 'step-extra';

  if (state.step === 1 && state.botCalc) {
    extra.innerHTML = [
      '<div class="calc-box calc-box--bot">',
      '  <div class="calc-box-title">🤖 Bot 计算结果</div>',
      '  <div class="calc-row"><span>最优前跑量</span><strong>' + fmt(state.botCalc.frontRunETH) + ' ETH</strong></div>',
      '  <div class="calc-row"><span>受害者最差成交价</span><strong>' + fmtUSDC(state.botCalc.worstPrice) + ' USDC/ETH</strong></div>',
      '  <div class="calc-row"><span>受害者最低收到</span><strong>' + fmtUSDC(state.botCalc.victimMin) + ' USDC</strong></div>',
      '</div>'
    ].join('');
    container.parentNode.insertBefore(extra, container.nextSibling);

  } else if (state.step === 3 && state.victimBalance.actualUSDC !== null) {
    var v = state.victimBalance;
    extra.innerHTML = [
      '<div class="calc-box calc-box--victim">',
      '  <div class="calc-box-title">👤 受害者交易结果</div>',
      '  <div class="calc-row"><span>预期收到</span><strong>' + fmtUSDC(v.expectedUSDC) + ' USDC</strong></div>',
      '  <div class="calc-row calc-row--loss"><span>实际收到</span><strong class="loss">' + fmtUSDC(v.actualUSDC) + ' USDC</strong></div>',
      '  <div class="calc-row calc-row--loss"><span>损失金额</span><strong class="loss">-' + fmtUSDC(v.loss) + ' USDC</strong></div>',
      '  <div class="calc-row calc-row--loss"><span>额外滑点</span><strong class="loss">' + fmtPct(v.lossPct) + '%</strong></div>',
      '</div>'
    ].join('');
    container.parentNode.insertBefore(extra, container.nextSibling);

  } else if (state.step === 4 && state.backrun) {
    var b = state.backrun;
    var bot = state.botBalance;
    extra.innerHTML = [
      '<div class="calc-box calc-box--bot">',
      '  <div class="calc-box-title">🤖 Bot 后跑结果</div>',
      '  <div class="calc-row"><span>卖出 USDC</span><strong>' + fmtUSDC(-bot.usdc / b.botNetETH * b.botETHOut) + ' USDC</strong></div>',
      '  <div class="calc-row"><span>收回 ETH</span><strong>' + fmt(b.botETHOut) + ' ETH</strong></div>',
      '  <div class="calc-row calc-row--profit"><span>净赚 ETH</span><strong class="profit">+' + fmt(b.botNetETH) + ' ETH</strong></div>',
      '</div>'
    ].join('');
    container.parentNode.insertBefore(extra, container.nextSibling);
  }
}


// ─────────────────────────────────────────────────────────────
// 14. Result table (step 5)
// ─────────────────────────────────────────────────────────────

function renderResultTable(state) {
  var tbl = document.getElementById('sandwich-result-table');
  if (!tbl) return;

  tbl.style.display = '';
  var s = state.summary;

  tbl.innerHTML = [
    '<table class="result-table">',
    '  <caption>三明治攻击完整复盘</caption>',
    '  <thead>',
    '    <tr><th>阶段</th><th>操作</th><th>Bot 余额变化</th><th>受害者余额变化</th><th>池子现货价格</th></tr>',
    '  </thead>',
    '  <tbody>',
    '    <tr>',
    '      <td>初始</td>',
    '      <td>-</td>',
    '      <td>0</td>',
    '      <td>持有 ' + fmt(_sandwich.sim.victimETH) + ' ETH</td>',
    '      <td>' + fmtUSDC(s.initPrice) + ' USDC/ETH</td>',
    '    </tr>',
    '    <tr class="row-bot">',
    '      <td>Bot 前跑</td>',
    '      <td>买入 ' + fmt(s.botFrontETH) + ' ETH → USDC</td>',
    '      <td>-' + fmt(s.botFrontETH) + ' ETH / +' + fmtUSDC(s.botUSDC) + ' USDC</td>',
    '      <td>-</td>',
    '      <td>↑ 推高至 ' + fmtUSDC(_sandwich.steps[2].spotPrice) + ' USDC/ETH</td>',
    '    </tr>',
    '    <tr class="row-victim">',
    '      <td>受害者成交</td>',
    '      <td>卖出 ' + fmt(_sandwich.sim.victimETH) + ' ETH</td>',
    '      <td>-</td>',
    '      <td class="loss">实收 ' + fmtUSDC(s.victimActual) + ' USDC（预期 ' + fmtUSDC(s.victimExpected) + '）</td>',
    '      <td>' + fmtUSDC(_sandwich.steps[3].spotPrice) + ' USDC/ETH</td>',
    '    </tr>',
    '    <tr class="row-bot">',
    '      <td>Bot 后跑</td>',
    '      <td>卖出 ' + fmtUSDC(s.botUSDC) + ' USDC → ETH</td>',
    '      <td>+' + fmt(s.botETHOut) + ' ETH / -' + fmtUSDC(s.botUSDC) + ' USDC</td>',
    '      <td>-</td>',
    '      <td>' + fmtUSDC(s.finalPrice) + ' USDC/ETH</td>',
    '    </tr>',
    '    <tr class="row-summary">',
    '      <td><strong>最终结果</strong></td>',
    '      <td>-</td>',
    '      <td class="profit"><strong>净赚 ' + fmt(s.botNetETH) + ' ETH (≈ ' + fmtUSDC(s.botNetUSDC) + ' USDC)</strong></td>',
    '      <td class="loss"><strong>多损失 ' + fmtUSDC(s.victimLoss) + ' USDC (' + fmtPct(s.victimLossPct) + '%)</strong></td>',
    '      <td>恢复至 ' + fmtUSDC(s.finalPrice) + ' USDC/ETH</td>',
    '    </tr>',
    '  </tbody>',
    '</table>'
  ].join('');
}


// ─────────────────────────────────────────────────────────────
// 15. Animation helpers
// ─────────────────────────────────────────────────────────────

function animateTxToBlock(txCardId) {
  var card = document.getElementById(txCardId);
  if (!card) return;

  // Compute distance from mempool card to block lane
  var blockList = document.getElementById('block-tx-list');
  if (!blockList) {
    card.classList.add('tx-confirmed', 'tx-in-block');
    return;
  }

  var cardRect  = card.getBoundingClientRect();
  var blockRect = blockList.getBoundingClientRect();

  var dx = blockRect.left + 24  - cardRect.left;
  var dy = blockRect.top  + 8   - cardRect.top;

  card.style.transition = 'transform 0.6s ease, opacity 0.6s ease';
  card.style.transform  = 'translateX(' + dx + 'px) translateY(' + dy + 'px)';
  card.style.opacity    = '0';

  setTimeout(function () {
    card.style.display = 'none';
    card.style.transform  = '';
    card.style.transition = '';
    card.style.opacity    = '';
  }, 650);
}

function sandwichAnimateStep(state) {
  switch (state.step) {
    case 2:
      // Bot front-run tx moves to block
      animateTxToBlock('mempool-bot-tx');
      break;
    case 3:
      // Victim tx moves to block
      animateTxToBlock('mempool-victim-tx');
      break;
    case 4:
      // Pulse the block list to indicate back-run
      var bl = document.getElementById('block-tx-list');
      if (bl) {
        bl.classList.remove('block-pulse');
        void bl.offsetWidth;
        bl.classList.add('block-pulse');
      }
      break;
    default:
      break;
  }
}

function sandwichResetTxCards() {
  var victimCard = document.getElementById('mempool-victim-tx');
  var botCard    = document.getElementById('mempool-bot-tx');

  [victimCard, botCard].forEach(function (card) {
    if (!card) return;
    card.style.display    = '';
    card.style.transform  = '';
    card.style.transition = '';
    card.style.opacity    = '';
    card.classList.remove('tx-confirmed', 'tx-in-block');
  });

  var blockList = document.getElementById('block-tx-list');
  if (blockList) blockList.innerHTML = '';

  // Reset bot card text to default
  if (botCard) {
    var inner = botCard.querySelector('.tx-card-body');
    if (inner) inner.textContent = 'Bot 正在计算最优前跑量...';
  }
}


// ─────────────────────────────────────────────────────────────
// 16. Inline CSS injection (so mev-sim.js is self-contained)
// ─────────────────────────────────────────────────────────────

(function injectMevSimStyles() {
  if (document.getElementById('mev-sim-styles')) return;
  var style = document.createElement('style');
  style.id  = 'mev-sim-styles';
  style.textContent = [
    /* Pool state */
    '.pool-stat { display: flex; justify-content: space-between; padding: 4px 0; }',
    '.pool-stat-label { color: #888; font-size: 0.88rem; }',
    '.pool-stat-value { font-weight: 600; font-size: 0.88rem; }',
    '.pool-stat--price .pool-stat-value { color: #f59e0b; }',

    /* Narrative fade-in */
    '@keyframes narrativeFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }',
    '.narrative-fade { animation: narrativeFadeIn 0.4s ease; }',

    /* Calc boxes */
    '.step-extra { margin-top: 12px; }',
    '.calc-box { border-radius: 8px; padding: 12px 16px; font-size: 0.85rem; background: rgba(255,255,255,0.04); }',
    '.calc-box--bot  { border-left: 3px solid #f97316; }',
    '.calc-box--victim { border-left: 3px solid #3b82f6; }',
    '.calc-box-title { font-weight: 700; margin-bottom: 8px; }',
    '.calc-row { display: flex; justify-content: space-between; padding: 3px 0; }',
    '.calc-row--loss { color: #ef4444; }',
    '.calc-row--profit { color: #22c55e; }',
    '.loss   { color: #ef4444 !important; }',
    '.profit { color: #22c55e !important; }',

    /* Block tx items */
    '.block-tx-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 6px; margin-bottom: 6px; font-size: 0.82rem; background: rgba(255,255,255,0.05); }',
    '.block-tx-item--bot    { border-left: 3px solid #f97316; }',
    '.block-tx-item--victim { border-left: 3px solid #3b82f6; }',
    '.block-tx-label { flex: 1; }',
    '.block-tx-badge { background: #22c55e22; color: #22c55e; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }',

    /* Block pulse */
    '@keyframes blockPulse { 0%,100%{ box-shadow: none; } 50%{ box-shadow: 0 0 0 3px #22c55e66; } }',
    '.block-pulse { animation: blockPulse 0.5s ease; }',

    /* Tx card animation */
    '.tx-confirmed { opacity: 0.4; }',
    '.tx-in-block  { border-color: #22c55e !important; }',

    /* Result table */
    '.result-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 16px; }',
    '.result-table caption { font-weight: 700; font-size: 1rem; margin-bottom: 8px; text-align: left; }',
    '.result-table th, .result-table td { padding: 8px 10px; border: 1px solid rgba(255,255,255,0.1); text-align: left; }',
    '.result-table thead th { background: rgba(255,255,255,0.06); font-weight: 600; }',
    '.row-bot    td { background: rgba(249,115,22,0.06); }',
    '.row-victim td { background: rgba(59,130,246,0.06); }',
    '.row-summary td { background: rgba(255,255,255,0.04); font-weight: 500; }'
  ].join('\n');
  document.head.appendChild(style);
})();
