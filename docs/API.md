# liqui API — frontend reference

Base URL: `http://localhost:3000` (dev) · `https://api.yourdomain.com` (prod).
All responses are JSON.

## Auth & CORS
- **GET endpoints are public** (no key) — use them freely from the browser.
- **POST control endpoints** require a key **only if** `API_KEY` is set on the server.
  Send it as `x-api-key: <key>` or `Authorization: Bearer <key>`. Missing/wrong → `401`.
- The browser origin must be in the server's `CORS_ORIGINS` allowlist (your frontend domain).
- Build explorer links from any `txHash`: `https://solscan.io/tx/<txHash>`.
  Lock rows also have a Streamflow id (`lastCycle...lock_id` / cycle `lock_id`):
  `https://app.streamflow.finance/contract/solana/mainnet/<lock_id>`.

## Live updates: two options

### Option A (recommended): push via SSE — `GET /api/stream`
Open it **once** with `EventSource`; the server pushes updates the instant they happen
(no polling). Auto-reconnects. Public, like the other GET endpoints.
```js
const es = new EventSource('https://api.yourdomain.com/api/stream');
es.addEventListener('step',      e => prependActivityRow(JSON.parse(e.data)));   // new tx row
es.addEventListener('cycle',     e => refreshTotals(JSON.parse(e.data)));        // { id, status, mode }
es.addEventListener('unclaimed', e => updateFeesCard(JSON.parse(e.data)));       // unclaimed payload
es.addEventListener('scheduler', e => updatePausedState(JSON.parse(e.data)));    // on pause/resume
```
- `step` data = one **activity row** (same shape as `/api/transactions` items) → prepend to the table.
- `cycle` data = `{ id, status, mode }` when a cycle finishes → re-fetch `/api/status` for fresh totals (cheap, rare).
- `unclaimed` data = the unclaimed-fees payload (same as `/api/unclaimed`) → update the card.
- `scheduler` data = scheduler state → reflect paused/running.
- Do an initial `GET /api/status` + `/api/transactions` on load to populate, then let SSE keep it live.

### Option B: plain polling (if not using SSE)
- `GET /api/unclaimed` → every **15–30s** (server caches ~20s).
- `GET /api/transactions` + `GET /api/status` → every **30–60s** (cycles are infrequent).

Either way, **do NOT poll every second** — the fees creep slowly and the server caches.
"X sec ago" timestamps and a smooth count-up animation are **client-side only** (recompute
from `at` / `updatedAt`); no extra fetches.

---

## GET /api/unclaimed
Live unclaimed creator fees — drives the "UNCLAIMED FEES" card / progress ring.
```json
{
  "unclaimedSol": 0.5,
  "unclaimedUsd": 36.29,
  "thresholdSol": 1,
  "progressPct": 50,
  "readyToFire": false,
  "solPriceUsd": 72.58,
  "updatedAt": "2026-06-27T16:54:22.151Z"
}
```

## GET /api/status
Everything for the header cards + totals + live state.
```json
{
  "dryRun": false,
  "tokenSymbol": "LIQUI",
  "solPriceUsd": 72.58,
  "cards": {
    "autoClaimEverySol": 1,
    "unclaimedSol": 0.5, "unclaimedUsd": 36.29,
    "devWallet": "FMxp5cv...Hc47Q",
    "totalClaimedSol": 2.3324, "totalClaimedUsd": 169.29,
    "totalForLiquiditySol": 1.8857, "totalForLiquidityUsd": 136.87,
    "totalForDevSol": 0.0466, "totalForDevUsd": 3.39,
    "totalLiquidityAddedSol": 0.9428, "totalLiquidityAddedUsd": 68.44,
    "locksCount": 2,
    "liquidityPct": 98, "devPct": 2
  },
  "wallet": { "pubkey": "9fsC...RJQN", "solBalance": 0.7347, "balanceSource": "rpc" },
  "token": { "mint": "9ziid...pump", "pumpswapPoolId": null },
  "config": { "claimThresholdSol": 1, "lockCostSol": 0.18, "lockYears": 999, "devFeePct": 2, "devWallet": "..." },
  "totals": { "cycles": 2, "completed": 2, "failed": 0, "skipped": 0,
              "solClaimed": 2.3324, "devFeePaid": 0.0466, "tokensBought": 3.4e6,
              "lpLocked": 21.89, "locks": 2 },
  "scheduler": { "schedule": "*/10 * * * *", "claimThresholdSol": 1, "lastClaimable": 0.5,
                 "paused": false, "isRunning": false, "lastRunAt": "...", "lastResult": { "id": 2, "status": "complete" } },
  "lastCycle": { "...": "full cycle object with steps (same shape as GET /api/cycles/:id)" }
}
```
Card mapping: `autoClaimEverySol`→"AUTO CLAIM EVERY", `unclaimed*`→"UNCLAIMED FEES",
`devWallet`→"DEV WALLET", `totalClaimed*`→"TOTAL CREATOR FEES CLAIMED",
`totalForLiquidity*`→"TOTAL USED FOR LIQUIDITY (98%)", `totalForDev*`→"TOTAL FOR DEV/TECH (2%)",
`totalLiquidityAdded*`→"TOTAL LIQUIDITY ADDED". `*Usd` fields are null if the price feed is down.

## GET /api/transactions?limit=&offset=
The activity table feed. Newest first. `limit` default 50 (max 500).
```json
{
  "limit": 50, "offset": 0, "solPriceUsd": 72.58,
  "items": [
    { "id": 10, "cycleId": 2, "type": "Lock Liquidity", "rawType": "lock",
      "amountSol": null, "usdValue": null, "allocationPct": 98,
      "status": "Locked", "lockYears": 999, "txHash": "3TKH...gevFF", "at": "..." },
    { "id": 9, "cycleId": 2, "type": "Add Liquidity", "rawType": "add_liquidity",
      "amountSol": 0.5077, "usdValue": 36.85, "allocationPct": 98,
      "status": "Completed", "lockYears": null, "txHash": "22Qq...35Cra", "at": "..." },
    { "id": 8, "cycleId": 2, "type": "Buy $LIQUI", "rawType": "buy",
      "amountSol": 0.5077, "usdValue": 36.85, "allocationPct": 98, "status": "Completed", "txHash": "...", "at": "..." },
    { "id": 7, "cycleId": 2, "type": "Dev / Tech", "rawType": "dev_fee",
      "amountSol": 0.0248, "usdValue": 1.80, "allocationPct": 2, "status": "Completed", "txHash": "...", "at": "..." },
    { "id": 6, "cycleId": 2, "type": "Auto Claim", "rawType": "claim",
      "amountSol": 1.2403, "usdValue": 90.02, "allocationPct": null, "status": "Claimed", "txHash": "...", "at": "..." }
  ]
}
```
Column mapping: `type`→TYPE, `amountSol`→AMOUNT (SOL) (null shows "–"), `usdValue`→USD VALUE,
`allocationPct`→ALLOCATION (e.g. "98%"), `status`→STATUS (Claimed / Completed / Locked / Failed),
`txHash`→TX HASH link, `at`→TIME ("x sec ago"). `lockYears` (999) for the Locked sub-label.

## GET /api/cycles?limit=&offset=
Paginated cycle history (one row per full cycle, no steps).
```json
{ "total": 2, "limit": 25, "offset": 0, "items": [ { "id": 2, "status": "complete", "mode": "prebond", "pool": "BTrz...W2mp",
  "sol_claimed": 1.1972, "dev_fee": 0.0024, "lock_cost": 0.18, "sol_spent_buy": 0.0482, "sol_spent_lp": 0.0482,
  "tokens_bought": 1698213.7, "lp_received": 10.947, "lp_mint": "Hi2Z...bE7Z", "lock_id": "B3M7...HmP2E",
  "unlock_date": "3024-...", "started_at": "...", "finished_at": "..." } ] }
```

## GET /api/cycles/:id
One cycle plus its ordered `steps[]` (each step = `{ id, cycle_id, name, status, signature, detail, created_at }`;
`name` ∈ claim | dev_fee | buy | create_pool | add_liquidity | lock).

## POST /api/run | /api/pause | /api/resume  (auth)
- `run` → triggers a cycle now; returns the cycle, or `409 { skipped, reason }` if below threshold / already running.
- `pause` / `resume` → toggles the scheduler; returns scheduler state.
- Require the API key header when `API_KEY` is set (else `401`).

## Status / cycle vocabulary
- Cycle `status`: `running` | `complete` | `failed` | `skipped`.
- `mode`: `prebond` (our pool) | `graduated` (canonical PumpSwap pool).
- A `skipped` cycle means the vault was below threshold or too small after dev+lock+gas — normal.
