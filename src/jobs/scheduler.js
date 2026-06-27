'use strict';

const cron = require('node-cron');
const config = require('../config');
const { runCycle } = require('./cycle');
const { getClaimableSol } = require('../solana/pumpfun');
const bus = require('../events');

const state = {
  task: null,
  paused: false,
  isRunning: false,
  lastRunAt: null,
  lastResult: null, // { id, status }
  lastClaimable: null,
  startedAt: null,
};

/**
 * Run a cycle now, guarding against overlap. Returns the cycle, or a skip notice.
 * @param {string} trigger 'schedule' | 'manual'
 */
async function runGuarded(trigger, { force = false } = {}) {
  if (state.isRunning) {
    console.log(`[scheduler] ${trigger} trigger ignored — a cycle is already running`);
    return { skipped: true, reason: 'cycle already running' };
  }

  // Threshold gate: only run when the creator vault has accumulated enough.
  // Manual triggers can force a run regardless (for testing).
  if (!force) {
    const claimable = await getClaimableSol();
    state.lastClaimable = claimable;
    bus.emit('unclaimed', claimable); // push to SSE clients
    if (claimable < config.claimThresholdSol) {
      console.log(
        `[scheduler] waiting — claimable ${claimable.toFixed(4)} / ${config.claimThresholdSol} SOL`
      );
      return { skipped: true, reason: 'below claim threshold', claimable };
    }
  }

  state.isRunning = true;
  state.lastRunAt = new Date().toISOString();
  try {
    const cycle = await runCycle();
    state.lastResult = { id: cycle.id, status: cycle.status };
    return cycle;
  } finally {
    state.isRunning = false;
  }
}

function start() {
  if (state.task) return;
  if (!cron.validate(config.cronSchedule)) {
    throw new Error(`Invalid CRON_SCHEDULE: ${config.cronSchedule}`);
  }
  state.startedAt = new Date().toISOString();
  state.task = cron.schedule(config.cronSchedule, () => {
    if (state.paused) return;
    runGuarded('schedule').catch((err) => console.error('[scheduler] cycle error:', err));
  });
  console.log(`[scheduler] started — schedule "${config.cronSchedule}" (dryRun=${config.dryRun})`);
}

function pause() {
  state.paused = true;
  const s = getState();
  bus.emit('scheduler', s);
  return s;
}

function resume() {
  state.paused = false;
  const s = getState();
  bus.emit('scheduler', s);
  return s;
}

/** Manual trigger from the API — forces a run, bypassing the threshold gate. */
function triggerNow() {
  return runGuarded('manual', { force: true });
}

function getState() {
  return {
    schedule: config.cronSchedule,
    claimThresholdSol: config.claimThresholdSol,
    lastClaimable: state.lastClaimable ?? null,
    paused: state.paused,
    isRunning: state.isRunning,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    startedAt: state.startedAt,
  };
}

module.exports = { start, pause, resume, triggerNow, getState };
