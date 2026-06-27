'use strict';

const { LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const config = require('../config');
const { connection, wallet } = require('./connection');
const { sendIxs, unwrapWsol, readTokenBalance, getMintInfo, NATIVE_MINT } = require('./tokens');

// pump.fun main program (mainnet).
const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// pump.fun tokens are 6 decimals.
const PUMP_TOKEN_DECIMALS = 6;

function fakeSig(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function requireTokenMint() {
  if (!config.tokenMint) throw new Error('TOKEN_MINT is required for live mode');
  return new PublicKey(config.tokenMint);
}

/**
 * Claim creator fees from pump.fun (works pre- and post-graduation).
 * @returns {Promise<{signature, solClaimed, simulated, note?}>}
 */
/**
 * Read the claimable creator-fee balance WITHOUT claiming (gates the threshold trigger).
 * @returns {Promise<number>} claimable SOL
 */
async function getClaimableSol() {
  if (config.dryRun) {
    // Simulate a vault at/above the threshold so dry-run exercises the full cycle.
    return +(config.claimThresholdSol * (1 + Math.random() * 0.3)).toFixed(6);
  }
  const { OnlinePumpSdk } = require('@pump-fun/pump-sdk');
  const sdk = new OnlinePumpSdk(connection);
  const lamports = await sdk.getCreatorVaultBalanceBothPrograms(wallet.publicKey);
  return lamports.toNumber() / LAMPORTS_PER_SOL;
}

async function claimCreatorFees() {
  if (config.dryRun) {
    // Batched model: a claim is ~the threshold's worth of accumulated fees.
    const solClaimed = +(config.claimThresholdSol * (1 + Math.random() * 0.3)).toFixed(6);
    return { signature: fakeSig('claim'), solClaimed, simulated: true };
  }

  const { OnlinePumpSdk } = require('@pump-fun/pump-sdk');
  const sdk = new OnlinePumpSdk(connection);

  const claimable = await sdk.getCreatorVaultBalanceBothPrograms(wallet.publicKey);
  if (claimable.isZero()) {
    return { signature: null, solClaimed: 0, simulated: false, note: 'nothing to claim' };
  }

  const ixs = await sdk.collectCoinCreatorFeeInstructions(wallet.publicKey);
  const signature = await sendIxs(connection, wallet, ixs, { label: 'claim creator fees' });
  await unwrapWsol(connection, wallet); // AMM-side fees pay WSOL → unwrap to native SOL

  return { signature, solClaimed: claimable.toNumber() / LAMPORTS_PER_SOL, simulated: false };
}

/**
 * Has the token graduated (bonding curve complete / migrated to PumpSwap)?
 * @returns {Promise<{graduated: boolean, source: string}>}
 */
async function isGraduated() {
  if (config.dryRun) {
    return { graduated: config.simulateGraduated, source: 'simulated' };
  }

  const { OnlinePumpSdk, canonicalPumpPoolPda } = require('@pump-fun/pump-sdk');
  const mint = requireTokenMint();
  const sdk = new OnlinePumpSdk(connection);

  // Primary: the bonding curve's `complete` flag.
  try {
    const { bondingCurve } = await sdk.fetchBuyState(mint, wallet.publicKey);
    if (bondingCurve && bondingCurve.complete === true) {
      return { graduated: true, source: 'bondingCurve.complete' };
    }
    if (bondingCurve) return { graduated: false, source: 'bondingCurve.complete' };
  } catch (_err) {
    // Curve account missing — fall through to pool-existence check.
  }

  // Corroborating: does the canonical PumpSwap pool exist?
  const poolInfo = await connection.getAccountInfo(canonicalPumpPoolPda(mint));
  return { graduated: poolInfo !== null, source: 'canonicalPool' };
}

/**
 * Buy the token on its bonding curve, spending `solAmount` SOL.
 * @returns {Promise<{signature, tokensBought, tokensBoughtRaw, baseDecimals, simulated}>}
 */
async function buyOnCurve(solAmount) {
  if (config.dryRun) {
    const tokensBought = +(solAmount * 1_000_000 * (0.97 + Math.random() * 0.06)).toFixed(0);
    return {
      signature: fakeSig('curvebuy'),
      tokensBought,
      tokensBoughtRaw: String(Math.floor(tokensBought * 10 ** PUMP_TOKEN_DECIMALS)),
      baseDecimals: PUMP_TOKEN_DECIMALS,
      simulated: true,
    };
  }

  const BN = require('bn.js');
  const { OnlinePumpSdk, PumpSdk, getBuyTokenAmountFromSolAmount } = require('@pump-fun/pump-sdk');
  const mint = requireTokenMint();
  const user = wallet.publicKey;
  const online = new OnlinePumpSdk(connection);
  const offline = new PumpSdk();

  // Detect the mint's actual token program — pump.fun issues some tokens as Token-2022.
  const { decimals: baseDecimals, programId: tokenProgram } = await getMintInfo(connection, mint);

  const [global, feeConfig, buyState] = await Promise.all([
    online.fetchGlobal(),
    online.fetchFeeConfig(),
    online.fetchBuyState(mint, user),
  ]);
  const { bondingCurve, bondingCurveAccountInfo, associatedUserAccountInfo } = buyState;
  if (bondingCurve.complete) {
    throw new Error('token already graduated — use the AMM buy, not the curve');
  }

  const solLamports = new BN(Math.floor(solAmount * LAMPORTS_PER_SOL));
  const expectedTokens = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: global.tokenTotalSupply,
    bondingCurve,
    amount: solLamports,
    quoteMint: NATIVE_MINT,
  });

  const balBefore = await readTokenBalance(connection, mint, user, tokenProgram);
  const ixs = await offline.buyInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo,
    mint,
    user,
    amount: expectedTokens,
    solAmount: solLamports,
    slippage: config.curveSlippagePct, // percent
    tokenProgram,
  });
  const signature = await sendIxs(connection, wallet, ixs, { label: 'buy on bonding curve' });

  const balAfter = await readTokenBalance(connection, mint, user, tokenProgram);
  const boughtRaw = balAfter - balBefore;
  return {
    signature,
    tokensBought: Number(boughtRaw) / 10 ** baseDecimals,
    tokensBoughtRaw: boughtRaw.toString(),
    baseDecimals,
    simulated: false,
  };
}

module.exports = { claimCreatorFees, getClaimableSol, isGraduated, buyOnCurve, PUMP_PROGRAM_ID };
