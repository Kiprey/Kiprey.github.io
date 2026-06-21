// ============================================================
// main.js  –  Navigation Controller & Presenter Mode
// AMM/MEV Education Website
// Pure vanilla JS, no ES modules, everything global
// ============================================================

// ─────────────────────────────────────────────────────────────
// 1.  Presenter-mode detection
// ─────────────────────────────────────────────────────────────

var isPresenterMode = (function () {
  try {
    return new URLSearchParams(window.location.search).get('mode') === 'present';
  } catch (e) {
    return false;
  }
})();

// Slide tracking state (used in presenter mode)
var _presenter = {
  sections    : [],   // NodeList converted to Array of section elements
  slides      : [],   // 2-D array: slides[sectionIdx][slideIdx]
  curSection  : 0,
  curSlide    : 0,
  fullscreen  : false
};

// Active nav section (used outside presenter mode too)
var _activeSection = null;


// ─────────────────────────────────────────────────────────────
// 2.  DOMContentLoaded entry point
// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  buildSideNav();
  initScrollObserver();
  initScrollAnimations();
  initHeroCanvas();

  if (isPresenterMode) {
    initPresenterMode();
  }

  // Init sub-components (defined in their respective files)
  if (typeof initStableSwapViz  === 'function') initStableSwapViz();
  if (typeof initAMMCalculator  === 'function') initAMMCalculator();
  if (typeof initFlashSwapDemo  === 'function') initFlashSwapDemo();
  if (typeof initILCalculator   === 'function') initILCalculator();
  if (typeof initV3Visualizer   === 'function') initV3Visualizer();
  initV3SliderSync();
  if (typeof initSandwichSim    === 'function') initSandwichSim();
  if (typeof initCaseStudies    === 'function') initCaseStudies();
  if (typeof initQuiz           === 'function') initQuiz();
  initTakeaways();
  initDiscussion();
  initReferences();
  initMEVBars();
  initAttackTable();
  initQuickCases();
  initKeyboardHelp();
});


// ─────────────────────────────────────────────────────────────
// 3.  Side navigation
// ─────────────────────────────────────────────────────────────

function buildSideNav() {
  var nav = document.getElementById('side-nav');
  if (!nav) return;

  var sections = document.querySelectorAll('.section');
  nav.innerHTML = '';

  sections.forEach(function (section, i) {
    var sectionId    = section.id || ('section-' + i);
    var sectionLabel = section.dataset.sectionLabel || section.dataset.section || sectionId;

    var dot = document.createElement('button');
    dot.className          = 'side-nav-dot';
    dot.dataset.target     = sectionId;
    dot.setAttribute('aria-label', sectionLabel);
    dot.setAttribute('title', sectionLabel);

    // Tooltip element
    var tooltip = document.createElement('span');
    tooltip.className   = 'side-nav-tooltip';
    tooltip.textContent = sectionLabel;
    dot.appendChild(tooltip);

    dot.addEventListener('click', function () {
      scrollToSection(sectionId);
    });

    nav.appendChild(dot);
  });
}

function scrollToSection(sectionId) {
  var el = document.getElementById(sectionId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function updateActiveNav(sectionId) {
  if (_activeSection === sectionId) return;
  _activeSection = sectionId;

  var dots = document.querySelectorAll('.side-nav-dot');
  dots.forEach(function (dot) {
    if (dot.dataset.target === sectionId) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}


// ─────────────────────────────────────────────────────────────
// 4.  Intersection observer for section tracking
// ─────────────────────────────────────────────────────────────

function initScrollObserver() {
  var sections = document.querySelectorAll('.section');
  if (!sections.length) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        var sectionId = entry.target.id || entry.target.dataset.section;
        if (sectionId) updateActiveNav(sectionId);
      }
    });
  }, { threshold: 0.3 });

  sections.forEach(function (section) {
    observer.observe(section);
  });
}


// ─────────────────────────────────────────────────────────────
// 5.  Scroll animations (fade-in on scroll)
// ─────────────────────────────────────────────────────────────

function initScrollAnimations() {
  var animObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        // Once visible, no need to keep observing
        animObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.animate-on-scroll').forEach(function (el) {
    animObserver.observe(el);
  });
}


// ─────────────────────────────────────────────────────────────
// 6.  Hero canvas – animated AMM curve particles
// ─────────────────────────────────────────────────────────────

function initHeroCanvas() {
  var canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Resize canvas to match its CSS size
  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  var W = function () { return canvas.width; };
  var H = function () { return canvas.height; };

  // ── Particle definition ────────────────────────────────────
  // Each particle traces the k/x hyperbola (the AMM curve).
  // We parametrize by t ∈ [0, 1] where x = tW, y = k / x.
  // k is chosen so the curve runs from top-right to bottom-left.

  var PARTICLE_COUNT = 55;
  var particles = [];

  function makeParticle() {
    var t     = Math.random();            // position along curve
    var speed = 0.0003 + Math.random() * 0.0006;
    var size  = 1.5 + Math.random() * 2.5;
    return { t: t, speed: speed, size: size, opacity: 0.08 + Math.random() * 0.12 };
  }

  for (var i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(makeParticle());
  }

  // Map t → canvas (x, y) along the curve
  function curveXY(t, w, h) {
    // Use a soft hyperbola: x from 0.05w to 0.95w
    var margin = 0.05;
    var xFrac  = margin + t * (1 - 2 * margin);
    var x      = xFrac * w;
    // y = k / x, normalised so it fills vertically within [0.05h, 0.95h]
    // When xFrac = margin → yFrac = 1 - margin (bottom)
    // When xFrac = 1 - margin → yFrac = margin (top)
    var yFrac  = margin + (1 - 2 * margin) * (1 - xFrac / (1 - margin));
    // Correct with true hyperbola shape
    var k      = (margin * w) * ((1 - margin) * h); // constant product
    var yRaw   = k / x;
    // clamp
    var yMin   = 0.02 * h, yMax = 0.98 * h;
    var y      = Math.min(yMax, Math.max(yMin, yRaw));
    return { x: x, y: y };
  }

  // ── Draw curve outline ─────────────────────────────────────
  function drawCurve(w, h) {
    ctx.beginPath();
    var steps = 120;
    for (var s = 0; s <= steps; s++) {
      var t  = s / steps;
      var pt = curveXY(t, w, h);
      if (s === 0) ctx.moveTo(pt.x, pt.y);
      else         ctx.lineTo(pt.x, pt.y);
    }
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.08)'; // very faint purple
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }

  // ── Animation loop ─────────────────────────────────────────
  var raf;
  function draw() {
    var w = W(), h = H();
    ctx.clearRect(0, 0, w, h);

    drawCurve(w, h);

    particles.forEach(function (p) {
      // Advance particle along the curve
      p.t += p.speed;
      if (p.t > 1) p.t -= 1; // wrap around

      var pt = curveXY(p.t, w, h);

      // Draw glowing dot
      var grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, p.size * 3);
      grad.addColorStop(0,   'rgba(139, 92, 246, ' + (p.opacity * 1.5).toFixed(3) + ')');
      grad.addColorStop(0.5, 'rgba(99, 102, 241, ' + p.opacity.toFixed(3) + ')');
      grad.addColorStop(1,   'rgba(99, 102, 241, 0)');

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, p.size * 3, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    });

    raf = requestAnimationFrame(draw);
  }

  draw();

  // Stop animation when hero is not visible (performance)
  if ('IntersectionObserver' in window) {
    var heroObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          if (!raf) raf = requestAnimationFrame(draw);
        } else {
          if (raf) { cancelAnimationFrame(raf); raf = null; }
        }
      });
    }, { threshold: 0 });
    heroObserver.observe(canvas);
  }
}


// ─────────────────────────────────────────────────────────────
// 7.  Presenter mode
// ─────────────────────────────────────────────────────────────

function initPresenterMode() {
  document.body.classList.add('presenter-mode');

  // Build slide index
  var sectionEls = Array.prototype.slice.call(document.querySelectorAll('.section'));
  _presenter.sections = sectionEls;

  _presenter.slides = sectionEls.map(function (sec) {
    var slideEls = sec.querySelectorAll('.slide');
    // If no .slide children, treat the whole section as a single slide
    if (!slideEls.length) return [sec];
    return Array.prototype.slice.call(slideEls);
  });

  // Create presenter bar
  injectPresenterBar();

  // Show first slide
  showSlide(0, 0);

  // Keyboard navigation
  document.addEventListener('keydown', function (e) {
    if (!isPresenterMode) return;
    switch (e.key) {
      case 'ArrowRight':
      case ' ':
        e.preventDefault();
        nextSlide();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        prevSlide();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'Escape':
        exitPresenterMode();
        break;
    }
  });
}

function injectPresenterBar() {
  if (document.getElementById('presenter-bar')) return;

  var bar = document.createElement('div');
  bar.id = 'presenter-bar';
  bar.innerHTML = [
    '<button id="pres-prev" title="上一步 (←)">&#8592;</button>',
    '<span id="pres-counter">1 / 1</span>',
    '<button id="pres-next" title="下一步 (→ / Space)">&#8594;</button>',
    '<button id="pres-fs"   title="全屏 (F)">&#9974;</button>',
    '<button id="pres-exit" title="退出演示模式 (Esc)">&#10005;</button>'
  ].join('');
  document.body.appendChild(bar);

  document.getElementById('pres-prev').addEventListener('click', prevSlide);
  document.getElementById('pres-next').addEventListener('click', nextSlide);
  document.getElementById('pres-fs').addEventListener('click', toggleFullscreen);
  document.getElementById('pres-exit').addEventListener('click', exitPresenterMode);
}

function showSlide(sectionIdx, slideIdx) {
  var secs = _presenter.sections;

  // Clamp
  sectionIdx = Math.max(0, Math.min(sectionIdx, secs.length - 1));
  var slideArr = _presenter.slides[sectionIdx] || [];
  slideIdx = Math.max(0, Math.min(slideIdx, slideArr.length - 1));

  _presenter.curSection = sectionIdx;
  _presenter.curSlide   = slideIdx;

  // Show/hide sections and slides
  secs.forEach(function (sec, si) {
    var isCurSec = (si === sectionIdx);
    sec.style.display = isCurSec ? '' : 'none';

    if (!isCurSec) return;

    var slidesInSec = _presenter.slides[si];
    // If section itself is the single slide (no .slide children)
    if (slidesInSec.length === 1 && slidesInSec[0] === sec) return;

    slidesInSec.forEach(function (slide, sli) {
      if (sli === slideIdx) {
        slide.classList.add('slide-active');
        slide.classList.remove('slide-hidden');
        slide.style.display = '';
      } else {
        slide.classList.remove('slide-active');
        slide.classList.add('slide-hidden');
        slide.style.display = 'none';
      }
    });
  });

  // Scroll section into view
  secs[sectionIdx].scrollIntoView({ behavior: 'auto', block: 'start' });

  updatePresenterCounter();
  updateActiveNav(secs[sectionIdx].id || '');
}

function nextSlide() {
  var si  = _presenter.curSection;
  var sli = _presenter.curSlide;
  var slides = _presenter.slides[si] || [];

  if (sli < slides.length - 1) {
    showSlide(si, sli + 1);
  } else if (si < _presenter.sections.length - 1) {
    showSlide(si + 1, 0);
  }
}

function prevSlide() {
  var si  = _presenter.curSection;
  var sli = _presenter.curSlide;

  if (sli > 0) {
    showSlide(si, sli - 1);
  } else if (si > 0) {
    var prevSec    = si - 1;
    var lastSlide  = (_presenter.slides[prevSec] || []).length - 1;
    showSlide(prevSec, Math.max(0, lastSlide));
  }
}

function updatePresenterCounter() {
  var counter = document.getElementById('pres-counter');
  if (!counter) return;

  // Compute global slide number
  var global   = 0;
  var totalAll = 0;
  _presenter.slides.forEach(function (arr, si) {
    totalAll += arr.length;
    if (si < _presenter.curSection) global += arr.length;
  });
  global += _presenter.curSlide + 1;

  counter.textContent = global + ' / ' + totalAll;
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function () {});
    _presenter.fullscreen = true;
  } else {
    document.exitFullscreen().catch(function () {});
    _presenter.fullscreen = false;
  }
}

function exitPresenterMode() {
  isPresenterMode = false;
  document.body.classList.remove('presenter-mode');

  // Restore all sections/slides
  _presenter.sections.forEach(function (sec) {
    sec.style.display = '';
  });
  _presenter.slides.forEach(function (arr) {
    arr.forEach(function (slide) {
      slide.style.display = '';
      slide.classList.remove('slide-active', 'slide-hidden');
    });
  });

  var bar = document.getElementById('presenter-bar');
  if (bar) bar.remove();

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(function () {});
  }
}


// ─────────────────────────────────────────────────────────────
// 8.  Quiz (initQuiz)
// ─────────────────────────────────────────────────────────────

function initQuiz() {
  var questions = (typeof QUIZ_QUESTIONS !== 'undefined') ? QUIZ_QUESTIONS : [];
  if (!questions.length) return;

  var container = document.getElementById('quiz-container');
  if (!container) return;

  container.innerHTML = '';

  questions.forEach(function (q, qi) {
    var card = document.createElement('div');
    card.className = 'quiz-card';
    card.id = 'quiz-card-' + qi;

    var front = document.createElement('div');
    front.className = 'quiz-card-front';

    var qTitle = document.createElement('div');
    qTitle.className   = 'quiz-question';
    qTitle.textContent = 'Q' + (qi + 1) + '. ' + q.question;
    front.appendChild(qTitle);

    // Q2 (index 1) has free input; others have multiple choice
    if (q.type === 'input') {
      var inputWrap = document.createElement('div');
      inputWrap.className = 'quiz-input-wrap';

      var inp = document.createElement('input');
      inp.type        = 'text';
      inp.className   = 'quiz-input';
      inp.placeholder = q.placeholder || '输入你的答案…';
      inputWrap.appendChild(inp);

      var submitBtn = document.createElement('button');
      submitBtn.className   = 'quiz-submit-btn';
      submitBtn.textContent = '提交';
      inputWrap.appendChild(submitBtn);

      front.appendChild(inputWrap);

      submitBtn.addEventListener('click', function () {
        flipQuizCard(card, qi, inp.value.trim());
      });

      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitBtn.click();
      });

    } else {
      // Multiple choice
      var optList = document.createElement('ul');
      optList.className = 'quiz-options';

      (q.options || []).forEach(function (opt, oi) {
        var li = document.createElement('li');
        li.className   = 'quiz-option';
        li.textContent = opt;
        li.addEventListener('click', function () {
          flipQuizCard(card, qi, oi);
        });
        optList.appendChild(li);
      });
      front.appendChild(optList);
    }

    // Back (answer side)
    var back = document.createElement('div');
    back.className = 'quiz-card-back';
    back.id        = 'quiz-back-' + qi;

    var ansTitle = document.createElement('div');
    ansTitle.className   = 'quiz-answer-title';
    ansTitle.textContent = '答案';
    back.appendChild(ansTitle);

    var ansBody = document.createElement('div');
    ansBody.className   = 'quiz-answer-body';
    ansBody.textContent = q.answer || '';
    back.appendChild(ansBody);

    if (q.explanation) {
      var exp = document.createElement('div');
      exp.className   = 'quiz-explanation';
      exp.textContent = q.explanation;
      back.appendChild(exp);
    }

    var flipBackBtn = document.createElement('button');
    flipBackBtn.className   = 'quiz-flip-back-btn';
    flipBackBtn.textContent = '再看一遍';
    flipBackBtn.addEventListener('click', function () {
      card.classList.remove('flipped');
    });
    back.appendChild(flipBackBtn);

    card.appendChild(front);
    card.appendChild(back);
    container.appendChild(card);
  });
}

function flipQuizCard(card, qi, userAnswer) {
  // Optionally evaluate answer
  var questions = (typeof QUIZ_QUESTIONS !== 'undefined') ? QUIZ_QUESTIONS : [];
  var q = questions[qi];

  if (q && q.correctIndex !== undefined && typeof userAnswer === 'number') {
    var back = card.querySelector('.quiz-card-back');
    if (back) {
      var isCorrect = userAnswer === q.correctIndex;
      back.classList.toggle('quiz-correct',   isCorrect);
      back.classList.toggle('quiz-incorrect', !isCorrect);
    }
  }

  card.classList.add('flipped');
}


// ─────────────────────────────────────────────────────────────
// 9.  Case study interactions (initCaseStudies)
// ─────────────────────────────────────────────────────────────

function initCaseStudies() {
  initPrecisionDemo();
  initReentrancyDemo();
}

// ── Balancer precision loss demo ───────────────────────────────
function initPrecisionDemo() {
  var inputA    = document.getElementById('precision-input-a');
  var inputB    = document.getElementById('precision-input-b');
  var output    = document.getElementById('precision-output');
  var dviz      = document.getElementById('precision-d-viz');
  var iterSlider = document.getElementById('prec-iter-slider');
  var iterLabel  = document.getElementById('prec-iter-value');

  if (!inputA || !output) return;

  var currentN = 10;

  function fmtUSD(n) {
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  }

  function run() {
    var a = parseFloat(inputA.value) || 0;
    var b = inputB ? (parseFloat(inputB.value) || 1) : 1;
    if (b === 0) b = 1;

    // mulDown(a, b) in 1e18 fixed-point = floor(a * b / 1e18)
    var exact     = a * b / 1e18;
    var truncated = Math.floor(exact);
    var err       = exact - truncated;
    var errPct    = exact > 0 ? err / exact * 100 : 0;

    output.innerHTML = [
      '<div class="precision-row">',
      '  <span class="precision-label">mulUp &nbsp;精确值</span>',
      '  <span class="precision-value">' + exact.toFixed(4) + ' scaled wei</span>',
      '</div>',
      '<div class="precision-row">',
      '  <span class="precision-label">mulDown 截断结果</span>',
      '  <span class="precision-value precision-trunc">' + truncated + ' scaled wei</span>',
      '</div>',
      '<div class="precision-row precision-row--error">',
      '  <span class="precision-label">单次损失</span>',
      '  <span class="precision-value">' + err.toFixed(4) + ' &nbsp;= <strong>' + errPct.toFixed(2) + '%</strong> per op</span>',
      '</div>',
    ].join('');

    if (!dviz) return;
    var N            = currentN;
    var POOL         = 128e6;  // $128M reference (matches Balancer attack)
    var remaining    = Math.pow(Math.max(0, 1 - errPct / 100), N);
    var dApparent    = POOL * remaining;
    var profit       = POOL - dApparent;
    var profitPct    = (1 - remaining) * 100;
    var apparentPct  = remaining * 100;
    var barW         = Math.max(0.5, apparentPct).toFixed(1);

    dviz.innerHTML = [
      '<div class="prec-d-bar-row">',
      '  <div class="prec-d-bar-meta">',
      '    <span>真实池子价值 D_real</span>',
      '    <span style="color:var(--accent-green)">$128,000,000</span>',
      '  </div>',
      '  <div class="prec-d-bar-track">',
      '    <div class="prec-d-bar-fill real" style="width:100%">真实价值</div>',
      '  </div>',
      '</div>',
      '<div class="prec-d-bar-row" style="margin-top:8px">',
      '  <div class="prec-d-bar-meta">',
      '    <span>N=' + N + ' 次循环后，攻击者"看见"的 D_apparent</span>',
      '    <span style="color:var(--accent-red)">' + fmtUSD(dApparent) + '</span>',
      '  </div>',
      '  <div class="prec-d-bar-track">',
      '    <div class="prec-d-bar-fill apparent" style="width:' + barW + '%">',
      '      ' + (apparentPct > 12 ? ('剩余 ' + apparentPct.toFixed(1) + '%') : ''),
      '    </div>',
      '  </div>',
      '</div>',
      '<div class="prec-profit-callout">',
      '  <div>',
      '    <div class="prec-profit-label">攻击者可套利（简化模型）</div>',
      '    <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">',
      '      复合误差 ' + errPct.toFixed(2) + '% × ' + N + ' 次 = 池子压缩 ' + profitPct.toFixed(1) + '%',
      '    </div>',
      '  </div>',
      '  <span class="prec-profit-value">+' + fmtUSD(profit) + '</span>',
      '</div>',
      '<div class="prec-simplified-note">',
      '  * 简化演示：以 amount=' + a + '、scalingFactor=' + b.toExponential(3) + ' 的单次误差率 ' + errPct.toFixed(2) + '% 按复利累积。',
      '  真实攻击中单次误差远小于此，但配合 flash loan 可在数千次操作内完成。',
      '</div>',
    ].join('');
  }

  if (iterSlider) {
    iterSlider.addEventListener('input', function () {
      currentN = parseInt(this.value, 10);
      if (iterLabel) iterLabel.textContent = currentN;
      run();
    });
  }
  inputA.addEventListener('input', run);
  if (inputB) inputB.addEventListener('input', run);
  run();
}

// ── Curve reentrancy step demo ─────────────────────────────────
function initReentrancyDemo() {
  var container = document.getElementById('reentrancy-demo');
  if (!container) return;

  var STEPS = [
    {
      title : '步骤 1：攻击者调用 remove_liquidity()',
      code  : 'attacker.remove_liquidity(lp_amount, min_amounts)',
      highlight : 0,
      note  : '攻击者调用 Curve 的 remove_liquidity，发起流动性撤出。'
    },
    {
      title : '步骤 2：Curve 发送 ETH（触发 fallback）',
      code  : 'raw_call(msg.sender, amount_eth)  # ← ETH 转账触发 attacker.fallback()',
      highlight : 1,
      note  : 'Curve 向攻击者合约转账 ETH 时，触发攻击者合约的 receive() 函数。此时 Curve 的内部状态尚未更新！'
    },
    {
      title : '步骤 3：重入——攻击者合约调用 get_virtual_price()',
      code  : '# attacker fallback:\ncurve_pool.get_virtual_price()  # ← 此时读到的是旧状态！',
      highlight : 2,
      note  : '攻击者在 fallback 中重新调用 Curve，读取虚拟价格。由于 Curve 状态未更新，get_virtual_price() 返回错误（偏高）的价格。'
    },
    {
      title : '步骤 4：攻击者以错误价格操纵下游协议',
      code  : '# 使用错误的虚拟价格作为预言机\nlending_protocol.borrow(collateral, curve_virtual_price)',
      highlight : 3,
      note  : '使用读到的偏高虚拟价格作为抵押品价值，在借贷协议中借出超额资金。'
    },
    {
      title : '步骤 5：Curve 继续执行，更新状态（为时已晚）',
      code  : '# 回到 remove_liquidity 继续执行\nself.balances[i] -= amounts[i]  # ← 现在才更新',
      highlight : 4,
      note  : 'Curve 在 ETH 转账完成后才更新内部余额，但损害已经发生。这就是检查-效果-交互（Checks-Effects-Interactions）模式应该防止的情况。'
    }
  ];

  var currentStep = 0;

  // Render into container; attach listeners only once via event delegation
  function renderStep(idx) {
    var step = STEPS[idx];
    container.innerHTML = [
      '<div class="reentrancy-step-header">',
      '  <div class="reentrancy-step-title">' + escapeHtml(step.title) + '</div>',
      '  <div class="reentrancy-step-counter">' + (idx + 1) + ' / ' + STEPS.length + '</div>',
      '</div>',
      '<pre class="reentrancy-code"><code>' + escapeHtml(step.code) + '</code></pre>',
      '<div class="reentrancy-note">' + escapeHtml(step.note) + '</div>',
      '<div class="reentrancy-controls">',
      '  <button id="reent-prev" class="reent-btn"' + (idx === 0 ? ' disabled' : '') + '>&#8592; 上一步</button>',
      '  <button id="reent-next" class="reent-btn"' + (idx === STEPS.length - 1 ? ' disabled' : '') + '>下一步 &#8594;</button>',
      '</div>',
      '<div class="reentrancy-track">',
      STEPS.map(function (s, i) {
        return '<div class="reent-track-dot' + (i === idx ? ' active' : (i < idx ? ' done' : '')) + '"></div>';
      }).join(''),
      '</div>'
    ].join('');
  }

  // Use event delegation on the container — only one listener, no duplicates
  container.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'reent-prev' && currentStep > 0) {
      currentStep--;
      renderStep(currentStep);
    } else if (btn.id === 'reent-next' && currentStep < STEPS.length - 1) {
      currentStep++;
      renderStep(currentStep);
    }
  });

  renderStep(0);
}

// ─────────────────────────────────────────────────────────────
// 10. Utilities
// ─────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// ─────────────────────────────────────────────────────────────
// 11. Inline CSS injection (self-contained styling)
// ─────────────────────────────────────────────────────────────

(function injectMainStyles() {
  if (document.getElementById('main-js-styles')) return;
  var style = document.createElement('style');
  style.id  = 'main-js-styles';
  style.textContent = [
    /* ── animate-on-scroll ───────────────────────────── */
    '.animate-on-scroll { opacity: 0; transition: opacity 0.5s ease; }',
    '.animate-on-scroll.visible { opacity: 1; }',

    /* ── Side nav ─────────────────────────────────────── */
    '#side-nav { position: fixed; right: 18px; top: 50%; transform: translateY(-50%); z-index: 100; display: flex; flex-direction: column; gap: 10px; }',
    '.side-nav-dot { position: relative; width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,0.25); border: none; cursor: pointer; padding: 0; transition: background 0.2s, transform 0.2s; }',
    '.side-nav-dot.active { background: #8b5cf6; transform: scale(1.4); }',
    '.side-nav-dot:hover { background: rgba(255,255,255,0.6); }',
    '.side-nav-tooltip { position: absolute; right: calc(100% + 10px); top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.8); color: #fff; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity 0.2s; }',
    '.side-nav-dot:hover .side-nav-tooltip { opacity: 1; }',

    /* ── Presenter mode ───────────────────────────────── */
    '#presenter-bar { position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999; background: rgba(0,0,0,0.85); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; gap: 16px; padding: 10px 20px; }',
    '#presenter-bar button { background: rgba(255,255,255,0.12); border: none; color: #fff; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; }',
    '#presenter-bar button:hover { background: rgba(255,255,255,0.25); }',
    '#pres-counter { color: rgba(255,255,255,0.7); font-size: 0.9rem; min-width: 60px; text-align: center; }',
    '.slide-hidden { display: none !important; }',
    '.slide-active  { display: block; }',
    '@keyframes slideFadeIn { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }',
    '.slide-active { animation: slideFadeIn 0.3s ease; }',

    /* ── Quiz ──────────────────────────────────────────── */
    '.quiz-card { position: relative; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; margin-bottom: 20px; overflow: hidden; transition: box-shadow 0.2s; }',
    '.quiz-card:hover { box-shadow: 0 4px 20px rgba(139,92,246,0.15); }',
    '.quiz-card-front, .quiz-card-back { padding: 20px 24px; }',
    '.quiz-card-back { display: none; background: rgba(139,92,246,0.06); border-top: 1px solid rgba(139,92,246,0.2); }',
    '.quiz-card.flipped .quiz-card-front { display: none; }',
    '.quiz-card.flipped .quiz-card-back  { display: block; }',
    '.quiz-question { font-weight: 600; font-size: 1rem; margin-bottom: 14px; line-height: 1.5; }',
    '.quiz-options { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }',
    '.quiz-option { padding: 10px 14px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; font-size: 0.9rem; transition: background 0.15s; border: 1px solid transparent; }',
    '.quiz-option:hover { background: rgba(139,92,246,0.15); border-color: rgba(139,92,246,0.4); }',
    '.quiz-input-wrap { display: flex; gap: 10px; margin-top: 10px; }',
    '.quiz-input { flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.3); color: #fff; font-size: 0.9rem; }',
    '.quiz-submit-btn { padding: 8px 18px; border-radius: 6px; background: #7c3aed; border: none; color: #fff; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; }',
    '.quiz-submit-btn:hover { background: #6d28d9; }',
    '.quiz-answer-title { font-weight: 700; color: #a78bfa; margin-bottom: 8px; }',
    '.quiz-answer-body  { font-size: 0.95rem; line-height: 1.6; }',
    '.quiz-explanation  { margin-top: 10px; font-size: 0.85rem; color: rgba(255,255,255,0.6); line-height: 1.6; }',
    '.quiz-flip-back-btn { margin-top: 14px; padding: 6px 14px; border-radius: 6px; background: rgba(255,255,255,0.08); border: none; color: #fff; cursor: pointer; font-size: 0.82rem; }',
    '.quiz-correct   { border-top-color: #22c55e !important; }',
    '.quiz-incorrect { border-top-color: #ef4444 !important; }',

    /* ── Precision demo ────────────────────────────────── */
    '.precision-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.85rem; }',
    '.precision-label { color: rgba(255,255,255,0.6); }',
    '.precision-value { font-family: monospace; }',
    '.precision-trunc { color: #f59e0b; }',
    '.precision-row--error .precision-value { color: #ef4444; }',
    '.precision-note { margin-top: 12px; font-size: 0.8rem; color: rgba(255,255,255,0.5); line-height: 1.6; padding: 8px 12px; background: rgba(239,68,68,0.06); border-radius: 6px; border-left: 3px solid #ef4444; }',

    /* ── Reentrancy demo ───────────────────────────────── */
    '.reentrancy-step-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }',
    '.reentrancy-step-title  { font-weight: 600; font-size: 0.95rem; }',
    '.reentrancy-step-counter { color: rgba(255,255,255,0.45); font-size: 0.8rem; }',
    '.reentrancy-code { background: rgba(0,0,0,0.4); border-radius: 8px; padding: 14px 16px; font-size: 0.82rem; overflow-x: auto; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.08); }',
    '.reentrancy-note { font-size: 0.85rem; color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 16px; padding: 10px 14px; background: rgba(139,92,246,0.07); border-radius: 6px; border-left: 3px solid #7c3aed; }',
    '.reentrancy-controls { display: flex; gap: 12px; }',
    '.reent-btn { padding: 7px 18px; border-radius: 6px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; cursor: pointer; font-size: 0.85rem; transition: background 0.15s; }',
    '.reent-btn:hover:not(:disabled) { background: rgba(139,92,246,0.25); }',
    '.reent-btn:disabled { opacity: 0.35; cursor: not-allowed; }',
    '.reentrancy-track { display: flex; gap: 8px; margin-top: 14px; align-items: center; }',
    '.reent-track-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.2); transition: background 0.2s, transform 0.2s; }',
    '.reent-track-dot.done   { background: rgba(139,92,246,0.5); }',
    '.reent-track-dot.active { background: #8b5cf6; transform: scale(1.4); }',

    /* ── V3 slider groups ─────────────────────────────── */
    '.v3-slider-group { min-width: 160px; }',
    '.v3-slider-group .sim-slider { margin: 4px 0 2px; }',
    '.v3-input-val { float: right; font-family: monospace; color: #8b5cf6; font-size: 0.82rem; }',

    /* ── Keyboard help overlay ────────────────────────── */
    '#kbd-help-overlay { position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; }',
    '#kbd-help-overlay.visible { display: flex; }',
    '#kbd-help-box { background: #1a1f2e; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 28px 36px; max-width: 480px; width: 90%; }',
    '#kbd-help-box h3 { margin: 0 0 18px; font-size: 1.1rem; color: #a78bfa; }',
    '.kbd-table { width: 100%; border-collapse: collapse; }',
    '.kbd-table td { padding: 6px 8px; font-size: 0.88rem; color: rgba(255,255,255,0.8); }',
    '.kbd-table td:first-child { width: 40%; }',
    'kbd { display: inline-block; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 7px; font-family: monospace; font-size: 0.8rem; }',
    '#kbd-close-btn { margin-top: 20px; display: block; width: 100%; padding: 8px; border-radius: 8px; border: none; background: rgba(139,92,246,0.3); color: #fff; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; }',
    '#kbd-close-btn:hover { background: rgba(139,92,246,0.5); }'
  ].join('\n');
  document.head.appendChild(style);
})();

// ─────────────────────────────────────────────────────────────
// 10.  Slider ↔ Number Input Sync (V3 range + IL calc)
// ─────────────────────────────────────────────────────────────

function initV3SliderSync() {
  var pairs = [
    // V3 visualizer
    ['c3-price-current-slider', 'c3-price-current', 'c3-price-current-display'],
    ['c3-range-low-slider',     'c3-range-low',     'c3-range-low-display'],
    ['c3-range-high-slider',    'c3-range-high',    'c3-range-high-display'],
    // IL calculator
    ['c2-initial-price-slider', 'c2-initial-price', 'c2-init-display'],
    ['c2-new-price-slider',     'c2-new-price',     'c2-new-display']
  ];
  pairs.forEach(function (pair) {
    var slider  = document.getElementById(pair[0]);
    var num     = document.getElementById(pair[1]);
    var display = document.getElementById(pair[2]);
    if (!slider || !num) return;

    function updateDisplay(val) {
      if (display) display.textContent = '$' + Number(val).toLocaleString();
    }
    updateDisplay(num.value);

    slider.addEventListener('input', function () {
      num.value = slider.value;
      updateDisplay(slider.value);
      num.dispatchEvent(new Event('input', { bubbles: true }));
    });
    num.addEventListener('input', function () {
      slider.value = num.value;
      updateDisplay(num.value);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// 11.  Keyboard help overlay  (press ?)
// ─────────────────────────────────────────────────────────────

function initKeyboardHelp() {
  var overlay = document.createElement('div');
  overlay.id  = 'kbd-help-overlay';
  overlay.innerHTML = [
    '<div id="kbd-help-box">',
    '  <h3>键盘快捷键</h3>',
    '  <table class="kbd-table">',
    '    <tr><td><kbd>?</kbd></td><td>显示/隐藏此帮助</td></tr>',
    '    <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>Presenter 模式：上/下一张幻灯片</td></tr>',
    '    <tr><td><kbd>↑</kbd> / <kbd>↓</kbd></td><td>Presenter 模式：上/下一节</td></tr>',
    '    <tr><td><kbd>F</kbd></td><td>Presenter 模式：全屏切换</td></tr>',
    '    <tr><td><kbd>Home</kbd></td><td>滚动回顶部</td></tr>',
    '    <tr><td><kbd>P</kbd></td><td>切换至 Presenter 模式 (?mode=present)</td></tr>',
    '    <tr><td><kbd>Esc</kbd></td><td>关闭此帮助 / 退出全屏</td></tr>',
    '  </table>',
    '  <button id="kbd-close-btn">关闭</button>',
    '</div>'
  ].join('');
  document.body.appendChild(overlay);

  function toggle() { overlay.classList.toggle('visible'); }
  function hide()   { overlay.classList.remove('visible'); }

  document.getElementById('kbd-close-btn').addEventListener('click', hide);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) hide(); });

  document.addEventListener('keydown', function (e) {
    if (e.key === '?') { toggle(); return; }
    if (e.key === 'Escape') { hide(); }
    if (e.key === 'p' || e.key === 'P') {
      if (!isPresenterMode && !overlay.classList.contains('visible')) {
        window.location.href = window.location.pathname + '?mode=present';
      }
    }
    if (e.key === 'Home' && !isPresenterMode) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}


// ─────────────────────────────────────────────────────────────
// Data-driven section renderers
// ─────────────────────────────────────────────────────────────

function initTakeaways() {
  var el = document.getElementById('takeaways-container');
  if (!el || typeof TAKEAWAYS === 'undefined') return;
  el.innerHTML = TAKEAWAYS.map(function(t) {
    return '<div class="takeaway-card">' +
      '<div class="tk-num">' + t.num + '</div>' +
      '<div class="tk-body">' +
        '<div class="tk-text">' + t.text + '</div>' +
        '<p class="tk-detail">' + t.detail + '</p>' +
      '</div>' +
    '</div>';
  }).join('');
}

function initDiscussion() {
  var el = document.getElementById('discussion-container');
  if (!el || typeof DISCUSSION_QUESTIONS === 'undefined') return;
  el.innerHTML = DISCUSSION_QUESTIONS.map(function(q) {
    return '<div class="card card-top-' + q.color + '">' +
      '<div class="badge badge-' + q.color + ' mb-3">' + q.topic + '</div>' +
      '<h3 class="card-title">' + q.title + '</h3>' +
      '<p class="text-secondary mt-3">' + q.desc + '</p>' +
      '<div class="info-box mt-3 fs-sm">' + q.bullets.join('<br/>') + '</div>' +
    '</div>';
  }).join('');
}

function initReferences() {
  var el = document.getElementById('references-container');
  if (!el || typeof REFERENCES === 'undefined') return;
  el.innerHTML = REFERENCES.map(function(col) {
    var items = col.items.map(function(item) {
      if (item.url) {
        return '<li><a href="' + item.url + '" class="link-subtle" target="_blank">' +
          item.text + '</a> — ' + item.author + '</li>';
      }
      return '<li><span class="text-muted">' + item.text + '</span> — ' + item.author + '</li>';
    }).join('');
    return '<div class="card">' +
      '<div class="badge badge-' + col.color + ' mb-3">' + col.topic + '</div>' +
      '<ul class="ref-list">' + items + '</ul>' +
    '</div>';
  }).join('');
}

function initMEVBars() {
  var el = document.getElementById('mev-bars-container');
  if (!el || typeof MEV_TYPE_BARS === 'undefined') return;
  el.innerHTML = '<div class="mev-breakdown-label">MEV 类型构成（按占比高低）</div>' +
    MEV_TYPE_BARS.map(function(b) {
      return '<div class="mev-stat-bar-wrap">' +
        '<div class="mev-stat-bar-label"><span><span style="color:' + b.color + '">■</span> ' + b.label + '</span></div>' +
        '<div class="mev-stat-bar-track"><div class="mev-stat-bar-fill" style="width:' + b.width + '%;background:linear-gradient(90deg,' + b.color + ',' + b.colorEnd + ')"></div></div>' +
      '</div>';
    }).join('');
}

function initAttackTable() {
  var el = document.getElementById('attack-table-body');
  if (!el || typeof ATTACK_TABLE === 'undefined') return;
  el.innerHTML = ATTACK_TABLE.map(function(r) {
    return '<tr>' +
      '<td><span class="badge badge-' + r.badgeColor + ' badge-sm">' + r.name + '</span></td>' +
      '<td class="text-secondary">' + r.date + '</td>' +
      '<td class="text-red font-mono">' + r.loss + '</td>' +
      '<td>' + r.type + '</td>' +
      '<td>' + r.cause + '</td>' +
      '<td class="text-' + r.outcomeColor + '">' + r.outcome + '</td>' +
    '</tr>';
  }).join('');
}

function initQuickCases() {
  var el = document.getElementById('quick-cases-container');
  if (!el || typeof QUICK_CASES === 'undefined') return;
  el.innerHTML = QUICK_CASES.map(function(c) {
    return '<div class="quick-case">' +
      '<div class="qc-header">' +
        '<span class="badge ' + c.badge + '">' + c.name + '</span>' +
        '<span class="qc-amount text-red">' + c.amount + '</span>' +
        '<span class="text-secondary">' + c.date + '</span>' +
      '</div>' +
      c.body +
    '</div>';
  }).join('');
}
