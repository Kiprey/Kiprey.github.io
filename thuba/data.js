// ============================================================
// AMM & MEV Attack Presentation — Data Layer
// Tsinghua University Blockchain Club (THUBA)
// ============================================================

// ------------------------------------------------------------------
// Attack Case Studies
// ------------------------------------------------------------------
const ATTACK_CASES = [
  {
    id: 'balancer',
    title: 'Balancer V2 精度损失漏洞',
    date: '2025年11月3日',
    amount: '$1.28亿',
    amountUSD: 128000000,
    chains: ['Ethereum', 'Arbitrum', 'Polygon', 'Optimism', 'Gnosis', 'Avalanche'],
    rootCause: '精度损失 (Precision Loss)',
    description:
      'Balancer V2 Composable Stable Pool 中，_upscale() 函数在 GIVEN_OUT 场景下错误地使用了 mulDown()（向下取整），导致代币数量被低估。攻击者利用这一精度损失操纵池子不变量 D，以极低价格回购 BPT，最终在 6 条链上合计窃取约 1.28 亿美元。',
    technicalDetail:
      '在 Composable Stable Pool 中，代币进出池时需要通过 scalingFactor 进行比例换算（例如 cbETH 的 scalingFactor ≈ 1.114e18）。当金额极小时（如 8 wei），mulDown(8, 1.114e18) = floor(8 × 1.114e18 / 1e18) = floor(8.912) = 8，产生约 10% 的精度损失。攻击者先将池子流动性抽至约 1e11 量级，使小金额交易频繁触发精度损失，导致不变量 D 被压缩，进而以贬值后的价格大量买入 BPT，最后恢复流动性后套现。',
    vulnerableCode:
`// VULNERABLE: 使用 mulDown 在 GIVEN_OUT 场景下向下取整
function _upscale(
    uint256 amount,
    uint256 scalingFactor
) internal pure returns (uint256) {
    // mulDown 向零取整，GIVEN_OUT 时应向上保护协议
    return FixedPoint.mulDown(amount, scalingFactor);
}

// FixedPoint.mulDown 实现
function mulDown(uint256 a, uint256 b)
    internal pure returns (uint256)
{
    uint256 product = a * b;
    return product / ONE;   // floor division — 损失精度
}`,
    fixedCode:
`// FIXED: 在 GIVEN_OUT 上下文中改用 mulUp 向上取整
function _upscaleGivenOut(
    uint256 amount,
    uint256 scalingFactor
) internal pure returns (uint256) {
    // mulUp 确保协议不会少收代币
    return FixedPoint.mulUp(amount, scalingFactor);
}

// FixedPoint.mulUp 实现
function mulUp(uint256 a, uint256 b)
    internal pure returns (uint256)
{
    uint256 product = a * b;
    // 向上取整: (product + ONE - 1) / ONE
    return (product + ONE - 1) / ONE;
}`,
    attackSteps: [
      '1. 通过闪电贷借入大量目标代币（cbETH / stETH 等）',
      '2. 将 Composable Stable Pool 流动性抽至极低水平（~1e11 wei）',
      '3. 反复执行小金额 GIVEN_OUT swap，每次触发 _upscale 精度损失',
      '4. 精度误差累积导致不变量 D 被压缩，池子价格严重失真',
      '5. 以极低价格批量买入 BPT（池份额代币）',
      '6. 归还流动性后，BPT 价值恢复，攻击者套取差价',
      '7. 整个攻击链在 6 条链上同步发生，耗时约 30 分钟'
    ],
    lessonLearned:
      '取整方向必须与业务语义一致：协议收取代币时应向上取整（mulUp）以保护协议；用户收到代币时可向下取整（mulDown）。审计必须区分 GIVEN_IN 和 GIVEN_OUT 两种上下文，对每处取整方向单独验证。此外，极低流动性状态下的精度行为需要专项 fuzz 测试覆盖。'
  },

  {
    id: 'kyberswap',
    title: 'KyberSwap Elastic 整数溢出漏洞',
    date: '2023年11月23日',
    amount: '$4,700万',
    amountUSD: 47000000,
    chains: ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'Base', 'Avalanche', 'Fantom'],
    rootCause: '边界条件错误 (Tick Crossing Bug)',
    description:
      'KyberSwap Elastic（集中流动性 AMM）的 computeSwapStep() 函数存在一个 tick 边界计算错误：当 swap 金额恰好等于 amountSwapToCrossTick - 1 时，合约会错误地将 tick 向反方向穿越，导致流动性被重复计算，产生价格估算与最终结算之间的巨大差异。攻击者精心构造 swap 参数，在空 tick 区间上多次触发该 bug，最终提取了远超正常应得的代币。',
    technicalDetail:
      '在 Uniswap V3 风格的集中流动性模型中，每个 tick 代表一个价格边界，穿越 tick 时流动性会增减。KyberSwap 的 computeSwapStep() 在计算剩余金额是否足以穿越下一个 tick 时，使用了不等式 `amountRemaining >= amountSwapToCrossTick` 判断，但当 amountRemaining == amountSwapToCrossTick - 1 时，代码中存在另一个分支错误地触发了 tick 穿越逻辑，并将流动性加了两次（base liquidity doubled）。攻击者在流动性几乎为零的空 tick 区间反复操作，每次获得超额代币，累计抽走约 4700 万美元。',
    vulnerableCode:
`// VULNERABLE: computeSwapStep 中的 tick 穿越判断
function computeSwapStep(
    uint160 sqrtRatioCurrentX96,
    uint160 sqrtRatioTargetX96,
    uint128 liquidity,
    int256 amountRemaining,
    uint24 feePips
) internal pure returns (...) {
    ...
    // BUG: 当 amountRemaining == amountSwapToCrossTick - 1 时
    // 满足此条件的分支错误地执行了 tick 穿越
    if (amountRemaining >= int256(amountSwapToCrossTick) - 1) {
        // 错误地将 nextLiquidity 加回 baseLiquidity（重复计算）
        liquidity = LiquidityMath.addDelta(
            liquidity, liquidityNet
        );
    }
}`,
    fixedCode:
`// FIXED: 严格使用 >= 判断，不允许 off-by-one 触发穿越
function computeSwapStep(...) internal pure returns (...) {
    ...
    // 修复：必须 >= amountSwapToCrossTick 才穿越 tick
    if (amountRemaining >= int256(amountSwapToCrossTick)) {
        liquidity = LiquidityMath.addDelta(
            liquidity, liquidityNet
        );
    }
    // 同时增加对空 tick 区间的流动性保护
}`,
    attackSteps: [
      '1. 攻击者找到流动性极低（接近为零）的 tick 区间',
      '2. 精心计算 swap 金额，使其恰好等于 amountSwapToCrossTick - 1',
      '3. 触发 tick 穿越 bug，流动性被错误地加倍',
      '4. 后续价格计算基于虚假的双倍流动性，输出代币量远超实际储备',
      '5. 在多条链上的多个池子中重复此操作',
      '6. 攻击者曾与项目方进行漫长谈判，最终仍保留大部分获利'
    ],
    lessonLearned:
      '边界条件（off-by-one）是 DeFi 合约中最危险的漏洞之一，因为它只在特定参数组合下才会触发，普通测试难以覆盖。集中流动性 AMM 的 tick 穿越逻辑尤其复杂，需要专门的形式化验证（Formal Verification）或完整的 fuzz 测试套件，覆盖所有边界值（amountSwapToCrossTick - 1, amountSwapToCrossTick, amountSwapToCrossTick + 1）。'
  },

  {
    id: 'curve',
    title: 'Curve Finance 重入漏洞',
    date: '2023年7月30日',
    amount: '~$7,000万',
    amountUSD: 70000000,
    chains: ['Ethereum'],
    rootCause: 'Vyper 编译器 Bug (重入锁失效)',
    description:
      'Vyper 编译器版本 0.2.15、0.2.16 和 0.3.0 存在一个编译器级 bug：使用 @nonreentrant 装饰器时，命名重入锁会被分配到错误的存储槽（storage slot），导致重入保护实际上无法生效。多个使用这些版本编译的 Curve 稳定币池（alETH-ETH、CRV/ETH、pETH-ETH、msETH-ETH）遭到重入攻击，损失约 7000 万美元，但白帽黑客抢先复现并归还了约 70% 的资金。',
    technicalDetail:
      '在 Vyper 0.2.15-0.3.0 中，当一个合约使用多个命名 @nonreentrant 锁时（如 @nonreentrant("lock") 和 @nonreentrant("lock2")），编译器错误地将所有命名锁映射到同一个存储槽或错误的槽位。这意味着不同名称的锁实际上共享状态，或者锁的检查/设置发生在错误的槽上，完全无法阻止重入调用。攻击者在 remove_liquidity() 执行 ETH 转账时，通过 fallback 函数重新进入合约的 add_liquidity() 或其他关键函数，在余额更新前操纵池子状态。',
    vulnerableCode:
`# Vyper 0.2.15-0.3.0 — @nonreentrant 编译 bug
# 编译器错误：命名锁被分配到错误的存储槽

@nonreentrant("lock")
@external
def remove_liquidity(
    _amount: uint256,
    _min_amounts: uint256[N_COINS]
) -> uint256[N_COINS]:
    # ... 计算 amounts ...
    for i in range(N_COINS):
        if coins[i] == ETH_ADDRESS:
            # ETH 转账触发 fallback，重入锁此时已失效！
            raw_call(msg.sender, b"", value=amounts[i])
        # 余额更新在转账之后 —— CEI 违反
        self.balances[i] -= amounts[i]`,
    fixedCode:
`# Fix 1: 升级 Vyper 编译器到 >= 0.3.1（锁分配已修复）
# Fix 2: 遵循 CEI（Checks-Effects-Interactions）模式

@nonreentrant("lock")
@external
def remove_liquidity(
    _amount: uint256,
    _min_amounts: uint256[N_COINS]
) -> uint256[N_COINS]:
    # Effects 先于 Interactions
    for i in range(N_COINS):
        self.balances[i] -= amounts[i]   # 先更新余额
    for i in range(N_COINS):
        if coins[i] == ETH_ADDRESS:
            raw_call(msg.sender, b"", value=amounts[i])  # 后转账`,
    attackSteps: [
      '1. 识别使用 Vyper 0.2.15-0.3.0 编译的 Curve 池（可通过链上字节码指纹识别）',
      '2. 调用 remove_liquidity()，触发 ETH 转账',
      '3. 在 ETH fallback 中重新调用 add_liquidity() 或其他函数',
      '4. 由于 @nonreentrant 锁失效，重入成功',
      '5. 在余额未更新前操纵 K 值，套取超额代币',
      '6. 白帽黑客（如 c0ffeebabe.eth）发现后迅速复现并归还约 70% 资金'
    ],
    lessonLearned:
      '编译器安全与合约代码安全同等重要。使用高级语言（如 Vyper、Solidity）时，必须关注编译器版本的安全公告。即使逻辑正确的源代码，经过有 bug 的编译器后也可能产生不安全的字节码。建议：锁定编译器版本、使用多版本交叉验证、对生成字节码进行审计，以及遵循 CEI 模式作为额外安全层。'
  },

  {
    id: 'beanstalk',
    title: 'Beanstalk 闪电贷治理攻击',
    date: '2022年4月17日',
    amount: '$1.82亿',
    amountUSD: 182000000,
    chains: ['Ethereum'],
    rootCause: '闪电贷治理攻击 (Flash Loan Governance)',
    description:
      'Beanstalk 是一个算法稳定币协议，使用持仓快照（snapshot）治理模型。攻击者通过在 Aave、Uniswap V2 和 SushiSwap 上借入约 10 亿美元的闪电贷，在单笔交易中获得超过 67% 的治理投票权，立即执行恶意提案 BIP-18，将协议约 1.82 亿美元资产转出，归还闪电贷后净利约 $8,000 万。',
    technicalDetail:
      'Beanstalk 的治理设计允许在同一区块内完成"提案提交 → 投票 → 执行"的完整流程（使用 emergencyCommit）。协议未对治理代币的快照时间与可用于投票的时间之间设置延迟。攻击者在单笔交易中：① 借入约 10 亿美元资产；② 转换为 BEAN/3CRV LP 等治理代币；③ 获得 67% 投票权；④ 调用 emergencyCommit(BIP-18) 立即执行提案（提案内容是将所有资金转给攻击者）；⑤ 归还闪电贷。整个攻击发生在一个区块内，无法被人工干预。',
    vulnerableCode:
`// VULNERABLE: Beanstalk 治理合约 (简化)
// 无时间锁，无快照延迟，支持 emergencyCommit

function vote(uint32 bip) external {
    // 直接使用当前余额计票，未用历史快照
    uint256 votingPower = s.a[msg.sender].roots;
    s.v[bip].roots = s.v[bip].roots.add(votingPower);
}

function emergencyCommit(uint32 bip) external {
    // 任何人只要获得 2/3 票数即可立即执行
    require(
        s.v[bip].roots >= s.f.roots.mul(2).div(3),
        "not enough votes"
    );
    // 执行任意提案内容 — 无时间锁！
    executeProposal(s.bips[bip].facetCuts, s.bips[bip].diamondCut);
}`,
    fixedCode:
`// FIXED: 增加时间锁和快照机制

// 1. 治理代币余额快照（使用区块号延迟）
mapping(uint256 => mapping(address => uint256)) snapshots;

function vote(uint32 bip) external {
    // 使用提案创建区块之前的余额快照
    uint256 snapshotBlock = proposals[bip].createdAt - 1;
    uint256 votingPower = snapshots[snapshotBlock][msg.sender];
    ...
}

// 2. 强制时间锁（至少 24 小时）
function commit(uint32 bip) external {
    require(
        block.timestamp >= proposals[bip].createdAt + TIMELOCK,
        "timelock not expired"
    );
    ...
}`,
    attackSteps: [
      '1. 提前部署恶意提案 BIP-18（内容：将所有协议资产转给攻击者）',
      '2. 在攻击交易中，通过 Aave/Uniswap/Sushi 借入约 $10 亿闪电贷',
      '3. 将资产存入 Beanstalk，获得 ~67% 治理投票权（超过 2/3 门槛）',
      '4. 对 BIP-18 投票并立即调用 emergencyCommit()',
      '5. 协议执行提案，将全部资金（~$1.82亿）转出',
      '6. 归还闪电贷，净赚约 $8,000 万（扣除借贷成本）',
      '7. 全程在 1 个以太坊区块（~12秒）内完成'
    ],
    lessonLearned:
      '治理系统必须对闪电贷攻击免疫。核心防御：① 时间锁（Timelock）：提案通过后必须等待至少 24-72 小时才能执行；② 历史快照：投票权必须基于提案创建前的余额快照，而非当前余额；③ 紧急功能应极其谨慎，或需要多签而非单纯票数。Compound、Aave 等协议的 Governor Bravo 模式是行业标准参考。'
  }
];

// ------------------------------------------------------------------
// Quiz Questions
// ------------------------------------------------------------------
const QUIZ_QUESTIONS = [
  {
    id: 1,
    question: 'Uniswap V2 中，如果池子有 100 ETH 和 200,000 USDC，1 ETH 的即时价格是多少？',
    options: [
      'A) $1,000',
      'B) $2,000',
      'C) $3,000',
      'D) 取决于滑点'
    ],
    correctIndex: 1,
    explanation:
      '在 Uniswap V2 中，即时价格由储备量之比决定：price = reserveUSDC / reserveETH = 200,000 / 100 = $2,000。注意这是边际价格（marginal price），实际大额兑换时会因滑点而偏离。恒积公式 x·y = k 保证了这一比值关系。'
  },
  {
    id: 2,
    question: '你向一个有 1,000 ETH / 2,000,000 USDC 的池中投入 10 ETH 买 USDC，价格影响约为多少？',
    options: [
      'A) 约 0%',
      'B) 约 1%',
      'C) 约 5%',
      'D) 约 10%'
    ],
    correctIndex: 1,
    explanation:
      '根据恒积公式（不含手续费）：输出 USDC = 2,000,000 × 10 / (1,000 + 10) ≈ 19,802 USDC。期望价格下的输出为 10 × 2,000 = 20,000 USDC。价格影响 = (20,000 - 19,802) / 20,000 ≈ 0.99%，约 1%。这也是为什么大池子能降低价格影响。'
  },
  {
    id: 3,
    question: '三明治攻击（Sandwich Attack）中，MEV bot 的利润来自于？',
    options: [
      'A) 新铸造的代币奖励',
      'B) 受害者被迫接受的更差成交价',
      'C) 矿工/验证者的区块补贴',
      'D) LP 手续费分成'
    ],
    correctIndex: 1,
    explanation:
      'MEV bot 通过"前置买入"推高价格，使受害者以更高价格成交，再"后置卖出"获利。受害者实际承担的滑点损失，就是 bot 的净利润来源。例如：bot 花 $2,000 买入后，受害者被迫以 $2,050 成交，bot 再以 $2,048 卖出，净赚约 $48（扣除手续费）。'
  },
  {
    id: 4,
    question: 'Uniswap V3 集中流动性（Concentrated Liquidity）的主要优势是？',
    options: [
      'A) 更低的 gas 费用',
      'B) 更高的资本效率（相同资本提供更深的流动性）',
      'C) 完全消除无常损失',
      'D) 原生支持 ETH（不需要 WETH）'
    ],
    correctIndex: 1,
    explanation:
      'V3 允许 LP 将资金集中在特定价格区间（如 $1,800 - $2,200），而非均匀分布在 [0, ∞)。在价格处于区间内时，资本效率理论上可达 V2 的 4,000 倍（取决于区间宽度）。代价是：LP 需要主动管理仓位，且价格出界时完全停止赚取手续费，无常损失可能更集中。'
  }
];

// ------------------------------------------------------------------
// AMM Simulator Defaults
// ------------------------------------------------------------------
const AMM_DEFAULTS = {
  v2: {
    reserveETH: 1000,
    reserveUSDC: 2000000,
    swapAmount: 10
  },
  v3: {
    priceMin: 1000,
    priceMax: 4000,
    currentPrice: 2000,
    rangeLow: 1800,
    rangeHigh: 2200
  },
  sandwich: {
    poolETH: 1000,
    poolUSDC: 2000000,
    victimETH: 50,
    victimSlippage: 0.01
  }
};

// ------------------------------------------------------------------
// V3 Tick Spacing by Fee Tier
// ------------------------------------------------------------------
const TICK_SPACING = {
  '0.05': 10,
  '0.30': 60,
  '1.00': 200
};

// ------------------------------------------------------------------
// AMM Math Utilities
// ------------------------------------------------------------------

/**
 * Uniswap V2: compute output given input (with fee)
 * @param {number} amountIn
 * @param {number} reserveIn
 * @param {number} reserveOut
 * @param {number} feeBps  e.g. 30 for 0.30%
 * @returns {number} amountOut
 */
function v2GetAmountOut(amountIn, reserveIn, reserveOut, feeBps = 30) {
  const amountInWithFee = amountIn * (10000 - feeBps);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 10000 + amountInWithFee;
  return numerator / denominator;
}

/**
 * Uniswap V2: compute price impact as a fraction (0-1)
 */
function v2PriceImpact(amountIn, reserveIn, reserveOut, feeBps = 30) {
  const spotPrice = reserveOut / reserveIn;
  const amountOut = v2GetAmountOut(amountIn, reserveIn, reserveOut, feeBps);
  const effectivePrice = amountOut / amountIn;
  return Math.abs((spotPrice - effectivePrice) / spotPrice);
}

/**
 * Sandwich attack simulation
 * Returns { botProfit, victimSlippagePct, midReserveETH, midReserveUSDC }
 */
function simulateSandwich(poolETH, poolUSDC, victimETH, victimMaxSlippage, botETH) {
  const k = poolETH * poolUSDC;

  // Bot front-run buy
  const botUSDCOut = v2GetAmountOut(botETH, poolETH, poolUSDC, 30);
  const midETH = poolETH + botETH;
  const midUSDC = poolUSDC - botUSDCOut;

  // Victim swap at inflated price
  const victimUSDCOut = v2GetAmountOut(victimETH, midETH, midUSDC, 30);
  const postBotETH = midETH + victimETH;
  const postBotUSDC = midUSDC - victimUSDCOut;

  // Bot back-run sell (sell botETH worth of USDC back to pool)
  const botUSDCIn = (botETH * postBotUSDC) / postBotETH;
  // Approximation: bot sells back same ETH amount
  const botETHBack = v2GetAmountOut(botUSDCIn, postBotUSDC, postBotETH, 30);

  const botProfit = botETHBack - botETH;
  const victimExpected = v2GetAmountOut(victimETH, poolETH, poolUSDC, 30);
  const victimActual = victimUSDCOut;
  const victimSlippagePct = (victimExpected - victimActual) / victimExpected;

  return {
    botProfit,
    victimSlippagePct,
    midReserveETH: midETH,
    midReserveUSDC: midUSDC,
    victimUSDCOut,
    victimExpected
  };
}

/**
 * Uniswap V3: approximate virtual liquidity ratio vs V2
 * given a symmetric price range [p_low, p_high] around p_current
 */
function v3CapitalEfficiency(pCurrent, pLow, pHigh) {
  // Real liquidity in range vs full-range liquidity
  // Ratio = sqrt(p_current/p_low) * sqrt(p_high/p_current) / (sqrt(p_high) - sqrt(p_low)) * ...
  // Simplified: efficiency = full_range_virtual / range_virtual
  const sqrtC = Math.sqrt(pCurrent);
  const sqrtL = Math.sqrt(pLow);
  const sqrtH = Math.sqrt(pHigh);
  // Capital needed in full range (0->inf) normalized to 1
  // Capital in [pLow, pHigh] proportional to 1/(sqrtH - sqrtL) relative to 1/(sqrtH_full - sqrtL_full)
  const rangeWidth = sqrtH - sqrtL;
  const approxFullWidth = Math.sqrt(pHigh * 4) - Math.sqrt(pLow / 4);
  return approxFullWidth / rangeWidth;
}

/**
 * Precision loss demo (Balancer bug)
 * @param {number} amount  small integer (wei)
 * @param {number} scalingFactor  e.g. 1.114e18
 */
function precisionLossDemo(amount, scalingFactor) {
  const ONE = 1e18;
  const exact = (amount * scalingFactor) / ONE;
  const mulDown = Math.floor(exact);
  const mulUp = Math.ceil(exact);
  const loss = ((mulUp - mulDown) / mulUp) * 100;
  return { exact, mulDown, mulUp, lossPct: loss };
}

// ------------------------------------------------------------------
// Presentation Flow Config
// ------------------------------------------------------------------
const PRESENTATION_CONFIG = {
  totalSections: 8,
  estimatedMinutes: 50,
  sections: [
    { id: 0, title: '开场 & 概览',      slug: 'hero',       minutes: 3  },
    { id: 1, title: 'AMM 基础原理',     slug: 'amm-basics', minutes: 8  },
    { id: 2, title: 'AMM 模拟器',       slug: 'simulator',  minutes: 7  },
    { id: 3, title: 'Uniswap V3',       slug: 'v3',         minutes: 7  },
    { id: 4, title: 'MEV 介绍',         slug: 'mev-intro',  minutes: 5  },
    { id: 5, title: '三明治攻击',       slug: 'sandwich',   minutes: 8  },
    { id: 6, title: '案例分析',         slug: 'cases',      minutes: 8  },
    { id: 7, title: '知识问答',         slug: 'quiz',       minutes: 4  }
  ]
};

// ------------------------------------------------------------------
// Color palette for chain badges
// ------------------------------------------------------------------
const CHAIN_COLORS = {
  'Ethereum':  '#627EEA',
  'Arbitrum':  '#28A0F0',
  'Polygon':   '#8247E5',
  'Optimism':  '#FF0420',
  'Gnosis':    '#048848',
  'Avalanche': '#E84142',
  'Fantom':    '#1969FF',
  'Base':      '#0052FF'
};

// ------------------------------------------------------------------
// Key Takeaways (rendered by initTakeaways in main.js)
// ------------------------------------------------------------------
const TAKEAWAYS = [
  {
    num: 1,
    text: 'AMM 用 <strong>x·y=k</strong> 实现了 permissionless 流动性',
    detail: '任何人都可以创建交易对、提供流动性、进行交换，无需许可，24/7 运行，无法被关停。这是 DeFi 最重要的基础设施创新：一个数学公式替代了整个做市商行业。Uniswap V2 代码不到 500 行，管理着数十亿美元流动性——简洁是安全的先决条件。'
  },
  {
    num: 2,
    text: 'V3 集中流动性提升资本效率 10–4000×，代价是主动管理与放大的 IL',
    detail: '集中流动性让 LP 从"被动持有"变成"主动做市"。精准的区间可以达到 200× 以上的效率提升，但价格走出区间后头寸立即"停工"，且集中程度越高，无常损失越剧烈。V3 LP 的最优策略本质上是一个金融工程问题，不是简单存入就有收益。'
  },
  {
    num: 3,
    text: 'V4 Hooks 让 AMM 变成可编程平台，但每个 Hook 都是新的攻击面',
    detail: 'Hook 可以实现动态手续费、限价单、自动再投资——这是巨大的创新空间。但可编程性与安全性是张力关系：每一个新的回调点都是潜在的注入点。V4 的安全审计难度远高于 V2/V3，因为需要审计 PoolManager + 所有已部署的 Hook 合约。'
  },
  {
    num: 4,
    text: 'MEV 是 DeFi 的隐形税，累计已从以太坊提取 $1.8B+',
    detail: 'Mempool 的公开透明性是双刃剑：它让网络可验证，也让每一笔待确认交易对 MEV bot 完全可见。三明治攻击者每年提取数亿美元，这些收益来自普通用户的交易损耗。Flashbots、私有 RPC、CoW Protocol 等方案已保护了超过 $60B 交易，但问题尚未根除。'
  },
  {
    num: 5,
    text: '最贵的 bug 往往是 1 bit 的方向错误或编译器问题，不是大逻辑',
    detail: 'Balancer $128M 源于 <code>mulDown</code> vs <code>mulUp</code>，KyberSwap $47M 源于"差 1"的边界判断，Curve $70M 源于编译器存储槽分配错误——这些都不是"想错了"，而是"差了一点点"。智能合约运行在确定性的执行环境中：任何可重现的偏差都可以被反复利用。<strong>形式化验证和 Fuzz Testing 是必选项，不是加分项。</strong>'
  }
];

// ------------------------------------------------------------------
// Open Discussion Questions (rendered by initDiscussion in main.js)
// ------------------------------------------------------------------
const DISCUSSION_QUESTIONS = [
  {
    color: 'orange',
    topic: '问题 1 · MEV 伦理',
    title: 'MEV 是公平的吗？',
    desc: '套利者通过捕捉跨 DEX 价差来维护链上价格一致性——这对市场是有益的。但三明治攻击者只是在普通用户的交易前后插队薅羊毛，并不创造任何价值。',
    bullets: ['两者的道德边界在哪里？', '如果你是 MEV bot 的运营者，你会做哪些？', '如果 Flashbots 消除了所有 MEV，谁会受益，谁会受损？']
  },
  {
    color: 'cyan',
    topic: '问题 2 · AMM 设计',
    title: '如果你来设计一个新 AMM？',
    desc: '资本效率（集中流动性 = 更多手续费）、无常损失（集中 = 损失更大）、用户体验（V3 LP 需要主动管理）三者之间存在根本性的张力。',
    bullets: ['V4 的 Hook 机制是一种解答——把权衡交给开发者。', '但这是否会导致流动性碎片化？', '你会选择哪个维度优先，为什么？']
  },
  {
    color: 'purple',
    topic: '问题 3 · Code is Law？',
    title: '"代码就是法律" vs "代码有 Bug"',
    desc: 'Euler Finance 攻击者最终归还了 $197M；Curve 白帽黑客抢先提走资金后归还。前者是法律压力还是道德选择？后者是攻击还是救援？',
    bullets: ['如果"代码就是法律"，利用 bug 是否合法？', '链上协商（"你归还，我不追究"）属于合同吗？', '去中心化精神与现实法律的冲突如何化解？']
  }
];

// ------------------------------------------------------------------
// References (rendered by initReferences in main.js)
// ------------------------------------------------------------------
const REFERENCES = [
  {
    color: 'blue',
    topic: 'AMM 原理',
    items: [
      { text: 'Uniswap V2 Whitepaper',      url: 'https://uniswap.org/whitepaper.pdf',                                              author: 'Hayden Adams et al., 2020' },
      { text: 'Uniswap V3 Core Whitepaper', url: 'https://uniswap.org/whitepaper-v3.pdf',                                           author: 'Adams et al., 2021'        },
      { text: 'StableSwap Whitepaper',       url: 'https://curve.fi/files/stableswap-paper.pdf',                                    author: 'Egorov, 2019'              },
      { text: 'Balancer Whitepaper',         url: 'https://balancer.fi/whitepaper.pdf',                                             author: 'Fernando Martinelli, 2019' },
      { text: 'Uniswap V4 Specification',   url: null,                                                                               author: 'Uniswap Labs, 2024'        }
    ]
  },
  {
    color: 'orange',
    topic: 'MEV 研究',
    items: [
      { text: 'Flash Boys 2.0',             url: 'https://arxiv.org/abs/1904.05234',                                                author: 'Daian et al., 2019'        },
      { text: 'Ethereum is a Dark Forest',  url: 'https://www.paradigm.xyz/2020/08/ethereum-is-a-dark-forest',                      author: 'Dan Robinson, 2020'        },
      { text: 'Flashbots Research',         url: 'https://flashbots.net',                                                           author: 'MEV-Boost, MEV-Share'      },
      { text: 'MEV-Explore Dashboard',      url: 'https://explore.flashbots.net',                                                   author: '实时数据'                  },
      { text: 'EIP-1559 与 MEV 生态变化',  url: null,                                                                               author: 'Tim Roughgarden, 2021'     }
    ]
  },
  {
    color: 'red',
    topic: '安全事故分析',
    items: [
      { text: 'Balancer V2 Incident Post-Mortem', url: null,                                                                         author: 'Balancer Labs, 2025'       },
      { text: 'KyberSwap Elastic Post-Mortem',    url: 'https://blog.kyberswap.com/kyberswap-elastic-security-incident-final-analysis/', author: 'KyberSwap, 2023'       },
      { text: 'Curve Vyper Bug Analysis',         url: 'https://hackmd.io/@LlamaRisk/curve-vyper',                                  author: 'LlamaRisk, 2023'           },
      { text: 'Euler Finance Post-Mortem',        url: 'https://www.euler.finance/blog/post-mortem',                                author: 'Euler Labs, 2023'          },
      { text: 'rekt.news',                        url: 'https://rekt.news',                                                         author: 'DeFi 安全事故档案库'       },
      { text: 'DefiLlama Hacks',                  url: 'https://defillama.com/hacks',                                               author: '历史攻击数据汇总'          }
    ]
  }
];

const MEV_TYPE_BARS = [
  { label: '三明治攻击（占比最高）', color: '#f97316', colorEnd: '#fb923c', width: 52 },
  { label: '套利（Arbitrage）',      color: '#16a34a', colorEnd: '#22c55e', width: 36 },
  { label: '清算（Liquidations）',   color: '#2563eb', colorEnd: '#60a5fa', width: 12 }
];

const ATTACK_TABLE = [
  { name: 'Balancer V2',  badgeColor: 'red',    date: '2025-11-03', loss: '$128M', type: '精度操纵',  cause: 'mulDown 舍入方向错误',         outcome: '未追回',              outcomeColor: 'red'   },
  { name: 'KyberSwap',    badgeColor: 'orange', date: '2023-11-23', loss: '$47M',  type: '逻辑 Bug',  cause: 'tick 边界 off-by-one',         outcome: '谈判中',              outcomeColor: 'orange'},
  { name: 'Curve',        badgeColor: 'cyan',   date: '2023-07-30', loss: '$70M',  type: '重入攻击',  cause: 'Vyper 编译器重入锁失效',       outcome: '~70% 白帽追回',       outcomeColor: 'green' },
  { name: 'Euler Finance',badgeColor: 'blue',   date: '2023-03-13', loss: '$197M', type: '逻辑 Bug',  cause: '缺失偿付能力检查',             outcome: '$197M 近全额追回',    outcomeColor: 'green' },
  { name: 'Beanstalk',    badgeColor: 'purple', date: '2022-04-17', loss: '$182M', type: '治理攻击',  cause: '实时投票权 + Flash Loan',      outcome: '未追回',              outcomeColor: 'red'   },
  { name: 'Ronin Bridge', badgeColor: 'orange', date: '2022-03-29', loss: '$625M', type: '私钥泄露',  cause: '9/9 多签仅 4 个独立节点',      outcome: '部分追回（OFAC）',    outcomeColor: 'orange'}
];

const QUICK_CASES = [
  {
    badge: 'badge-purple', name: 'Beanstalk', amount: '$182M', date: '2022年4月',
    body: `<p><strong>Flash Loan 治理攻击</strong>：攻击者用闪电贷借入 ~$10 亿稳定币，在同一区块内获得 67% 的投票权重，立即执行一个"紧急提案"——把协议金库全部转给自己，交易结束时还掉闪电贷，净赚 $182M。</p>
<p class="text-secondary my-1"><strong>技术细节：</strong>Beanstalk 的投票权基于代币持有量的当前区块快照（而非历史快照）。Flash Loan 让攻击者在一个区块内拥有绝对多数，通过治理提案不需要等待时间锁（timelock）。</p>
<p class="text-secondary my-1"><em>教训：链上治理必须使用历史快照（历史区块余额）计算投票权，并设置足够长的时间锁（≥48h），使 Flash Loan 的单块操作失效。</em></p>`
  },
  {
    badge: 'badge-blue', name: 'Euler Finance', amount: '$197M', date: '2023年3月',
    body: `<p><strong>缺失流动性检查</strong>：<code>donateToReserves()</code> 函数允许用户把资金"捐给"协议储备金，但未检查捐款后账户的<em>偿付能力</em>（health factor）。结合 Euler 的自担保（self-collateral）机制——用借来的钱给自己做抵押——攻击者通过一系列存款-借款-自抵押-捐款操作制造出坏账，进而榨干协议。</p>
<p class="text-secondary my-1"><em>结局：Euler 团队通过链上协商（发送含条件的 ETH 转账）和 FBI 追查，三周内追回全部 $197M，是 DeFi 史上最成功的资产追回案例。攻击者最终以"道德黑客"身份归还，免于起诉。</em></p>`
  }
];
