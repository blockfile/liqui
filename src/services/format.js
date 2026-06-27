'use strict';

const config = require('../config');
const { toUsd } = require('../solana/price');

const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || 'LIQUI';

// Map a stored step to the activity-row shape the dashboard renders.
function toActivityRow(s, price) {
  const d = s.detail || {};
  let type;
  let amountSol = null;
  let allocationPct = null;
  let status;

  switch (s.name) {
    case 'claim':
      type = 'Auto Claim';
      amountSol = d.solClaimed ?? null;
      status = 'Claimed';
      break;
    case 'dev_fee':
      type = 'Dev / Tech';
      amountSol = d.amount ?? null;
      allocationPct = d.pct ?? config.devFeePct;
      status = 'Completed';
      break;
    case 'buy':
      type = `Buy $${TOKEN_SYMBOL}`;
      amountSol = d.solSpent ?? null;
      allocationPct = 100 - config.devFeePct;
      status = 'Completed';
      break;
    case 'create_pool':
    case 'add_liquidity':
      type = 'Add Liquidity';
      amountSol = d.solPaired ?? null;
      allocationPct = 100 - config.devFeePct;
      status = 'Completed';
      break;
    case 'lock':
      type = 'Lock Liquidity';
      amountSol = null; // shown as "-"; it's LP, not SOL
      allocationPct = 100 - config.devFeePct;
      status = 'Locked';
      break;
    default:
      type = s.name;
      status = s.status === 'failed' ? 'Failed' : 'Completed';
  }
  if (s.status === 'failed') status = 'Failed';

  return {
    id: s.id ?? null,
    cycleId: s.cycle_id,
    type,
    rawType: s.name,
    amountSol,
    usdValue: toUsd(amountSol, price),
    allocationPct,
    status,
    lockYears: s.name === 'lock' ? config.lockYears : null,
    txHash: s.signature ?? null,
    at: s.created_at,
  };
}

// ── Public (frontend-facing) shapes — match LiquiToken's API_SPEC.md exactly ──
// These power GET /activity and GET /stats, consumed by the LiquiToken site.

// rawType (stored step name) -> the frontend's lowercase activity enum.
const PUBLIC_TYPE = {
  claim: 'claim',
  dev_fee: 'devTech',
  buy: 'buy',
  create_pool: 'addLiquidity',
  add_liquidity: 'addLiquidity',
  lock: 'lock',
};

// Map a stored step to the exact ActivityRow shape the LiquiToken table renders.
// Caller passes steps newest-first (repo.getAllSteps already sorts desc).
function toPublicActivityRow(s, price) {
  const d = s.detail || {};
  const liquidityPct = 100 - config.devFeePct;

  let amountSol = null;
  let allocationPct = null;
  let status = 'completed';
  switch (s.name) {
    case 'claim':
      amountSol = d.solClaimed ?? null;
      status = 'claimed';
      break;
    case 'dev_fee':
      amountSol = d.amount ?? null;
      allocationPct = d.pct ?? config.devFeePct;
      break;
    case 'buy':
      amountSol = d.solSpent ?? null;
      allocationPct = liquidityPct;
      break;
    case 'create_pool':
    case 'add_liquidity':
      amountSol = d.solPaired ?? null;
      allocationPct = liquidityPct;
      break;
    case 'lock':
      amountSol = null; // LP, not SOL — rendered as "-"
      allocationPct = liquidityPct;
      status = 'locked';
      break;
    default:
      break;
  }
  if (s.status === 'failed') status = 'failed';

  return {
    id: s.id != null ? String(s.id) : s.signature ?? null,
    type: PUBLIC_TYPE[s.name] ?? s.name,
    amountSol,
    // usdtValue MUST be a number — the frontend table calls .toLocaleString()
    // on it with no null guard (e.g. the lock step has no SOL value -> 0).
    usdtValue: toUsd(amountSol, price) ?? 0,
    allocation: allocationPct != null ? `${allocationPct}%` : null,
    status,
    statusNote: s.name === 'lock' ? `${config.lockYears} yrs` : null,
    txHash: s.signature ?? null,
    timestamp: Date.parse(s.created_at) || null, // ISO -> epoch ms
  };
}

// Map the backend aggregates to LiquiToken's flat /stats object. liquiInLp and
// marketCap have no backend source yet -> null (frontend shows its placeholder).
function toPublicStats({ stats, unclaimedSol, operatingWallet }) {
  const usedForLiquidity = +(stats.total_sol_spent_buy + stats.total_sol_spent_lp).toFixed(6);
  return {
    liquiInLp: null,
    marketCap: null,
    unclaimedFeesSol: unclaimedSol == null ? null : +unclaimedSol.toFixed(6),
    autoClaimThresholdSol: config.claimThresholdSol,
    totalCreatorFeesClaimed: stats.total_sol_claimed,
    totalUsedForLiquidity: usedForLiquidity,
    totalForDevTech: stats.total_dev_fee,
    totalLiquidityAdded: stats.total_sol_spent_lp,
    // The dashboard header shows the operating wallet — the signer that performs
    // claim/buy/LP/lock (whose activity the table lists) — NOT the 2% recipient.
    devWalletAddress: operatingWallet ?? config.devWallet,
  };
}

// The unclaimed-fees card payload (used by /api/unclaimed and the SSE stream).
function buildUnclaimedPayload(sol, thresholdSol, price) {
  return {
    unclaimedSol: sol == null ? null : +sol.toFixed(6),
    unclaimedUsd: toUsd(sol, price),
    thresholdSol,
    progressPct:
      thresholdSol > 0 && sol != null ? Math.min(100, +((sol / thresholdSol) * 100).toFixed(1)) : null,
    readyToFire: sol != null && sol >= thresholdSol,
    solPriceUsd: price,
  };
}

module.exports = {
  toActivityRow,
  toPublicActivityRow,
  toPublicStats,
  buildUnclaimedPayload,
  TOKEN_SYMBOL,
};
