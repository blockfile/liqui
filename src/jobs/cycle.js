'use strict';

const config = require('../config');
const repo = require('../db/repository');
const { claimCreatorFees, isGraduated, buyOnCurve } = require('../solana/pumpfun');
const {
  resolveCanonicalPool,
  resolveOurPool,
  poolExists,
  buyOnAmm,
  createOurPool,
  depositToPool,
} = require('../solana/pumpswap');
const { lockLp } = require('../solana/streamflow');
const { sendDevFee } = require('../solana/devfee');

/**
 * Run one full cycle. The flow adapts to graduation state:
 *
 *   pre-bond  : claim → buy on bonding curve → create/deposit OUR pool → lock LP
 *   graduated : claim → buy on canonical PumpSwap → deposit canonical pool → lock LP
 *
 * The pool we feed pre-bond is abandoned at graduation (its locked LP stays locked,
 * by design). Each step is recorded; a thrown step fails the cycle without crashing.
 *
 * @returns {Promise<object>} the persisted cycle (with steps)
 */
async function runCycle() {
  const id = await repo.createCycle({ dryRun: config.dryRun });
  const log = (msg) => console.log(`[cycle ${id}] ${msg}`);

  try {
    // 1. Claim creator fees (works pre- and post-graduation)
    const claim = await claimCreatorFees();
    await repo.addStep({
      cycleId: id,
      name: 'claim',
      status: 'ok',
      signature: claim.signature,
      detail: { solClaimed: claim.solClaimed },
    });
    log(`claimed ${claim.solClaimed} SOL`);

    // 2. Distribution: dev cut (2%), then hold back the Streamflow lock cost + tx gas.
    const devCut = +(claim.solClaimed * (config.devFeePct / 100)).toFixed(6);
    const lockHold = config.lockCostSol; // reserved to pay the lock at step 4
    const gasHold = config.solReserve;
    const spendable = +(claim.solClaimed - devCut - lockHold - gasHold).toFixed(6);
    if (spendable <= 0) {
      await repo.finishCycle(id, {
        status: 'skipped',
        sol_claimed: claim.solClaimed,
        dev_fee: devCut,
        lock_cost: lockHold,
        note: `claim ${claim.solClaimed} too small after dev ${devCut} + lock ${lockHold} + gas ${gasHold}`,
      });
      log('skipped: claim too small to cover dev + lock + gas');
      return repo.getCycleWithSteps(id);
    }

    // Send the dev/tech cut (only when configured > 0)
    let devRecipient = null;
    if (config.devFeePct > 0 && devCut > 0) {
      const dev = await sendDevFee(devCut);
      devRecipient = dev.recipient;
      await repo.addStep({
        cycleId: id,
        name: 'dev_fee',
        status: 'ok',
        signature: dev.signature,
        detail: { amount: devCut, recipient: devRecipient, pct: config.devFeePct },
      });
      log(`dev fee ${devCut} SOL → ${devRecipient}`);
    }

    const buyPortion = +(spendable * config.solSplitBuy).toFixed(6);
    const lpPortion = +(spendable - buyPortion).toFixed(6);

    // 3. Which regime are we in?
    const grad = await isGraduated();
    log(`graduated=${grad.graduated} (${grad.source}); buy ${buyPortion} / lp ${lpPortion} SOL`);

    let buy;
    let lp;
    let mode;

    if (grad.graduated) {
      // ── GRADUATED: canonical pool ──────────────────────────────────────────
      mode = 'graduated';
      const pool = resolveCanonicalPool();
      buy = await buyOnAmm(buyPortion, pool);
      await recordBuy(id, buy, 'amm', buyPortion);
      lp = await depositToPool(pool, buy.tokensBought, lpPortion);
      await recordLiquidity(id, 'add_liquidity', lp, lpPortion);
    } else {
      // ── PRE-BOND: our own pool ─────────────────────────────────────────────
      mode = 'prebond';
      buy = await buyOnCurve(buyPortion);
      await recordBuy(id, buy, 'curve', buyPortion);
      const ourPool = resolveOurPool();
      if (!(await poolExists(ourPool))) {
        lp = await createOurPool(buy.tokensBought, lpPortion);
        await recordLiquidity(id, 'create_pool', lp, lpPortion);
      } else {
        lp = await depositToPool(ourPool, buy.tokensBought, lpPortion);
        await recordLiquidity(id, 'add_liquidity', lp, lpPortion);
      }
    }

    // 4. Lock the LP
    const lock = await lockLp(lp.lpMint, lp.lpReceivedRaw, lp.lpDecimals, config.lockYears);
    await repo.addStep({
      cycleId: id,
      name: 'lock',
      status: 'ok',
      signature: lock.signature,
      detail: { lpAmount: lp.lpReceived, lockId: lock.lockId, unlockDate: lock.unlockDate },
    });
    log(`locked LP until ${lock.unlockDate}`);

    // 5. Done
    await repo.finishCycle(id, {
      status: 'complete',
      mode,
      pool: lp.pool,
      sol_claimed: claim.solClaimed,
      dev_fee: devCut,
      dev_wallet: devRecipient,
      lock_cost: lockHold,
      sol_spent_buy: buyPortion,
      sol_spent_lp: lpPortion,
      tokens_bought: buy.tokensBought,
      lp_received: lp.lpReceived,
      lp_mint: lp.lpMint,
      lock_id: lock.lockId,
      unlock_date: lock.unlockDate,
    });
    log(`complete (${mode})`);
    return repo.getCycleWithSteps(id);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    await repo.addStep({ cycleId: id, name: 'error', status: 'failed', detail: { message } });
    await repo.finishCycle(id, { status: 'failed', error: message });
    log(`FAILED: ${message}`);
    return repo.getCycleWithSteps(id);
  }
}

function recordBuy(cycleId, buy, source, solSpent) {
  return repo.addStep({
    cycleId,
    name: 'buy',
    status: 'ok',
    signature: buy.signature,
    detail: { source, solSpent, tokensBought: buy.tokensBought },
  });
}

function recordLiquidity(cycleId, name, lp, solPaired) {
  return repo.addStep({
    cycleId,
    name,
    status: 'ok',
    signature: lp.signature,
    detail: { solPaired, lpReceived: lp.lpReceived, lpMint: lp.lpMint, pool: lp.pool },
  });
}

module.exports = { runCycle };
