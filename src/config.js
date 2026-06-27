'use strict';

require('dotenv').config();

const { Keypair } = require('@solana/web3.js');
// bs58 v6 is ESM-only; under CommonJS require() the API is on `.default`.
const bs58lib = require('bs58');
const bs58 = bs58lib.default || bs58lib;

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function num(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const DRY_RUN = bool(process.env.DRY_RUN, true);

/**
 * Load the signing wallet.
 * Accepts either a base58 secret key or a JSON array of bytes.
 * In DRY_RUN with no key configured, an ephemeral keypair is generated so the
 * server runs out of the box (no funds are ever touched in dry run).
 */
function loadWallet() {
  const raw = process.env.WALLET_PRIVATE_KEY;
  if (!raw) {
    if (!DRY_RUN) {
      throw new Error('WALLET_PRIVATE_KEY is required when DRY_RUN=false');
    }
    return { keypair: Keypair.generate(), ephemeral: true };
  }
  try {
    if (raw.trim().startsWith('[')) {
      const bytes = Uint8Array.from(JSON.parse(raw));
      return { keypair: Keypair.fromSecretKey(bytes), ephemeral: false };
    }
    return { keypair: Keypair.fromSecretKey(bs58.decode(raw.trim())), ephemeral: false };
  } catch (err) {
    throw new Error(`Could not parse WALLET_PRIVATE_KEY: ${err.message}`);
  }
}

const { keypair: wallet, ephemeral: walletIsEphemeral } = loadWallet();

const config = {
  port: num(process.env.PORT, 3000),
  dryRun: DRY_RUN,

  rpcUrl: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',

  wallet,
  walletIsEphemeral,

  // Target token + its PumpSwap pool
  tokenMint: process.env.TOKEN_MINT || null,
  pumpswapPoolId: process.env.PUMPSWAP_POOL_ID || null,

  // Economics
  solSplitBuy: num(process.env.SOL_SPLIT_BUY, 0.5), // fraction of spendable SOL used to buy
  solReserve: num(process.env.SOL_RESERVE, 0.02), // SOL kept back for tx gas, never spent
  lockYears: num(process.env.LOCK_YEARS, 999),

  // Threshold trigger: only run a cycle once the creator vault reaches this much SOL
  // (batches fees so the fixed lock cost is a small % of what's deployed).
  claimThresholdSol: num(process.env.CLAIM_THRESHOLD_SOL, 1),
  // SOL held back from each claim to pay the Streamflow lock (measured ≈0.1706/lock).
  lockCostSol: num(process.env.LOCK_COST_SOL, 0.18),

  // Fee distribution: a cut of each claim goes to a separate wallet (e.g. tech dev);
  // the remainder feeds the liquidity flow. 2% dev / 98% liquidity by default.
  devFeePct: num(process.env.DEV_FEE_PCT, 2), // percent of claimed SOL sent to devWallet
  devWallet: process.env.DEV_WALLET || null,

  // On-chain execution (live mode only)
  slippagePct: num(process.env.SLIPPAGE_PCT, 1), // PumpSwap AMM slippage (convention TBD — verify live)
  curveSlippagePct: num(process.env.CURVE_SLIPPAGE_PCT, 5), // bonding-curve buy slippage, percent
  priorityFeeMicroLamports: num(process.env.PRIORITY_FEE_MICROLAMPORTS, 50000),
  computeUnitLimit: num(process.env.COMPUTE_UNIT_LIMIT, 200000),

  // DRY_RUN-only: simulate a graduated token to exercise the post-bond path.
  simulateGraduated: bool(process.env.SIMULATE_GRADUATED, false),

  // Schedule
  cronSchedule: process.env.CRON_SCHEDULE || '*/10 * * * *',

  // Storage (MongoDB)
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongoDb: process.env.MONGODB_DB || 'liqui',

  // CORS allowlist (comma-separated). Default: localhost dev origins. Set to your
  // frontend domain(s) in production, or "*" to allow any origin.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Secret protecting the POST control endpoints. Blank = open (dev); set in prod.
  apiKey: process.env.API_KEY || null,
};

module.exports = config;
