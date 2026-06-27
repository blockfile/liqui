'use strict';

const express = require('express');
const { LAMPORTS_PER_SOL } = require('@solana/web3.js');
const config = require('../config');
const repo = require('../db/repository');
const scheduler = require('../jobs/scheduler');
const { connection, walletPubkey, wallet } = require('../solana/connection');
const { getUnclaimedSol } = require('../services/metrics');
const { getSolPriceUsd, toUsd } = require('../solana/price');

const router = express.Router();

const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || 'LIQUI';

// GET /api/status — everything the dashboard needs: cards, totals (with USD),
// live unclaimed fees, scheduler state, and the last cycle.
router.get('/status', async (req, res, next) => {
  try {
    const [stats, lastCycle, unclaimed, price] = await Promise.all([
      repo.getStats(),
      repo.getLastCycle(),
      getUnclaimedSol().catch(() => ({ sol: null, at: Date.now() })),
      getSolPriceUsd(),
    ]);

    let solBalance = null;
    let balanceSource = 'none';
    if (!config.dryRun) {
      try {
        const lamports = await connection.getBalance(wallet.publicKey);
        solBalance = lamports / LAMPORTS_PER_SOL;
        balanceSource = 'rpc';
      } catch (err) {
        balanceSource = `rpc_error: ${err.message}`;
      }
    }

    const usedForLiquiditySol = +(stats.total_sol_spent_buy + stats.total_sol_spent_lp).toFixed(6);

    res.json({
      dryRun: config.dryRun,
      tokenSymbol: TOKEN_SYMBOL,
      solPriceUsd: price,

      // top cards
      cards: {
        autoClaimEverySol: config.claimThresholdSol,
        unclaimedSol: unclaimed.sol == null ? null : +unclaimed.sol.toFixed(6),
        unclaimedUsd: toUsd(unclaimed.sol, price),
        devWallet: config.devWallet,
        totalClaimedSol: stats.total_sol_claimed,
        totalClaimedUsd: toUsd(stats.total_sol_claimed, price),
        totalForLiquiditySol: usedForLiquiditySol, // the 98%
        totalForLiquidityUsd: toUsd(usedForLiquiditySol, price),
        totalForDevSol: stats.total_dev_fee, // the 2%
        totalForDevUsd: toUsd(stats.total_dev_fee, price),
        totalLiquidityAddedSol: stats.total_sol_spent_lp, // SOL paired into pools
        totalLiquidityAddedUsd: toUsd(stats.total_sol_spent_lp, price),
        locksCount: stats.locks,
        liquidityPct: 100 - config.devFeePct,
        devPct: config.devFeePct,
      },

      wallet: {
        pubkey: walletPubkey(),
        ephemeral: config.walletIsEphemeral,
        solBalance,
        balanceSource,
      },
      token: {
        mint: config.tokenMint,
        pumpswapPoolId: config.pumpswapPoolId,
      },
      config: {
        solSplitBuy: config.solSplitBuy,
        solReserve: config.solReserve,
        claimThresholdSol: config.claimThresholdSol,
        lockCostSol: config.lockCostSol,
        lockYears: config.lockYears,
        devFeePct: config.devFeePct,
        devWallet: config.devWallet,
      },
      totals: {
        cycles: stats.cycles,
        completed: stats.completed,
        failed: stats.failed,
        skipped: stats.skipped,
        solClaimed: stats.total_sol_claimed,
        devFeePaid: stats.total_dev_fee,
        tokensBought: stats.total_tokens_bought,
        lpLocked: stats.total_lp_locked,
        locks: stats.locks,
      },
      scheduler: scheduler.getState(),
      lastCycle,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
