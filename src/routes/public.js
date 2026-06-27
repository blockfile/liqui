'use strict';

// Public, frontend-shaped endpoints for the LiquiToken site. These emit the
// exact shapes in LiquiToken/API_SPEC.md (GET /activity, GET /stats) so the
// frontend only has to point at these URLs — no field remapping on its side.

const express = require('express');
const repo = require('../db/repository');
const { getUnclaimedSol } = require('../services/metrics');
const { getSolPriceUsd } = require('../solana/price');
const { toPublicActivityRow, toPublicStats } = require('../services/format');

const router = express.Router();

// Tiny in-memory TTL cache. The frontend polls activity ~4s and stats ~20s and
// the spec asks the backend to cache; this also de-dupes concurrent requests.
function cached(ttlMs, fn) {
  let value;
  let expires = 0;
  let inflight = null;
  return async () => {
    if (Date.now() < expires) return value;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        value = await fn();
        expires = Date.now() + ttlMs;
        return value;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}

const loadActivity = cached(3000, async () => {
  const [steps, price] = await Promise.all([repo.getAllSteps(100, 0), getSolPriceUsd()]);
  return steps.map((s) => toPublicActivityRow(s, price)); // repo returns newest-first
});

const loadStats = cached(15000, async () => {
  const [stats, unclaimed] = await Promise.all([
    repo.getStats(),
    getUnclaimedSol().catch(() => ({ sol: null })),
  ]);
  return toPublicStats({ stats, unclaimedSol: unclaimed.sol });
});

// GET /activity — array of transactions, newest first (API_SPEC.md §1)
router.get('/activity', async (req, res, next) => {
  try {
    res.json(await loadActivity());
  } catch (err) {
    next(err);
  }
});

// GET /stats — single object of live numbers (API_SPEC.md §2)
router.get('/stats', async (req, res, next) => {
  try {
    res.json(await loadStats());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
