# Fee → Buy → LP → Lock Backend — Design

**Date:** 2026-06-26
**Status:** Approved (DRY_RUN first)

## Goal

A single-wallet backend that, on a 10-minute schedule, recycles a pump.fun token's
**creator fees** into **locked liquidity**:

1. Claim creator fees from pump.fun (paid in SOL)
2. Split the claimed SOL (default 50/50), holding back a gas reserve
3. Buy the token on PumpSwap with the buy portion
4. Add liquidity (bought tokens + LP-portion SOL) on PumpSwap → receive LP tokens
5. Lock the LP tokens on Streamflow with a 999-year unlock (recipient = own wallet)
6. Record every step + tx signature so a frontend can display the history

Single token, single server-side keypair. Backend only.

## Scope decisions

- **One token you own** (not a multi-tenant service).
- **AMM = PumpSwap** (pump.fun's own AMM, where graduated tokens live).
- **"Lock forever" = 999-year Streamflow lock** (technically reclaimable at unlock,
  NOT a burn). Documented and accepted.
- **DRY_RUN default ON**: server + API + DB all run; on-chain calls are simulated.
  Live transaction paths are isolated and stubbed until validated against the real
  program IDLs with the real token mint, pool, RPC, and a funded wallet.

## Stack

- Node.js + Express + CORS
- `node-cron` — 10-minute schedule (`*/10 * * * *`)
- `mongodb` — cycle + step history (async; `cycles` + `steps` collections,
  numeric ids via a `counters` collection)
- `@solana/web3.js` — keypair / connection / balances
- `dotenv` — config
- (Live mode, later) pump.fun + PumpSwap program clients, `@streamflow/stream`

## Architecture

```
server.js              Express entry; mounts routes; inits DB; starts scheduler
src/config.js          Loads .env; derives wallet keypair; defaults
src/solana/
  connection.js        Connection + wallet keypair
  pumpfun.js           claimCreatorFees()
  pumpswap.js          buyToken(), addLiquidity()
  streamflow.js        lockLp()
src/jobs/
  cycle.js             runCycle() — orchestrates the 6 steps, records to DB
  scheduler.js         cron + overlap guard + pause/resume + next-run state
src/db/
  index.js             better-sqlite3 init + schema
  repository.js        insert/query helpers
src/routes/
  status.js            GET /api/status
  cycles.js            GET /api/cycles, /api/cycles/:id, /api/transactions
  control.js           POST /api/run, /api/pause, /api/resume
.env.example
```

## Graduation modes (pre-bond vs graduated)

The token may still be on the bonding curve. The cycle checks graduation each run
(`bondingCurve.complete`, corroborated by canonical-pool existence) and adapts:

- **Pre-bond** (not graduated): buy on the **bonding curve**, then create (first time)
  or deposit into **our own PumpSwap pool** — `poolPda(0, ourWallet, mint, WSOL)`,
  re-derived deterministically, no stored state — then lock that LP.
- **Graduated**: buy on the **canonical PumpSwap pool**, deposit there, lock that LP.

At graduation the pre-bond pool is **abandoned** (its locked LP stays locked forever —
explicitly accepted). `DRY_RUN` simulates pre-bond by default; `SIMULATE_GRADUATED=true`
exercises the graduated path. ⚠️ The PumpSwap AMM slippage convention (percent vs 0.01
fraction) is unresolved across SDK docs — `SLIPPAGE_PCT` must be verified on-chain.

## Fee distribution (2% dev / 98% liquidity)

After claiming, a `DEV_FEE_PCT` (default 2%) cut of the claimed SOL is transferred to
`DEV_WALLET` (tech development); the remaining 98% feeds the liquidity flow. Set
`DEV_FEE_PCT=0` to disable. Recorded as a `dev_fee` step + `dev_fee`/`dev_wallet` on
the cycle, and aggregated into `totals.devFeePaid`.

## Trigger (threshold, not time)

A cron *polls* the creator vault every `CRON_SCHEDULE` tick. A cycle fires only when
the claimable balance reaches `CLAIM_THRESHOLD_SOL` (default 1.0) — batching fees so
the fixed Streamflow lock cost (measured ≈0.1706 SOL/lock) is a small % of what's
deployed. Manual `/api/run` forces a run regardless.

## The cycle (runCycle)

- Insert a `cycles` row (status=running).
- Claim fees → `solClaimed`.
- Dev cut: `devCut = solClaimed × DEV_FEE_PCT%` → `DEV_WALLET`.
- Hold back the lock cost + gas: `spendable = solClaimed − devCut − LOCK_COST_SOL − SOL_RESERVE`. If `<= 0`, skip.
- `buyPortion = spendable * SOL_SPLIT_BUY`; `lpPortion = spendable - buyPortion`.
- Buy token → `tokensBought`.
- Add liquidity (`tokensBought`, `lpPortion`) → `lpReceived`, `lpMint`.
- Lock LP (`lpMint`, `lpReceived`, `LOCK_YEARS`) → `lockId`, `unlockDate`.
- Mark cycle **complete**; persist all amounts + signatures as `steps`.
- Any step throws → cycle **failed** with the error + failing step; server keeps running.

**Guards:** no overlapping cycles (skip if one is in flight); skip on dust fees;
never spend the gas reserve.

## API

- `GET  /api/status` — wallet pubkey, balances/aggregates, last cycle, next run, paused, dryRun
- `GET  /api/cycles?limit=&offset=` — paginated cycle history
- `GET  /api/cycles/:id` — one cycle with its steps + signatures
- `GET  /api/transactions` — flat feed of every on-chain tx signature
- `POST /api/run` — trigger a cycle now
- `POST /api/pause` / `POST /api/resume` — toggle the scheduler

## Config (.env)

`PORT`, `RPC_URL`, `DRY_RUN`, `WALLET_PRIVATE_KEY`, `TOKEN_MINT`, `PUMPSWAP_POOL_ID`,
`SOL_SPLIT_BUY` (0.5), `SOL_RESERVE` (0.02), `MIN_CLAIM_SOL` (0.01), `LOCK_YEARS` (999),
`CRON_SCHEDULE` (`*/10 * * * *`).

## Going live (future work, gated behind DRY_RUN=false)

- Validate pump.fun `collect_creator_fee` against the live program IDL + your creator PDA.
- Implement PumpSwap buy + deposit (add-liquidity) against the live pool state; confirm
  the pool's LP mint is a standard SPL token.
- Wire the Streamflow lock via `@streamflow/stream` with a 999-year unlock.
- Test on devnet / with a small real amount before unleashing the 10-min loop.
