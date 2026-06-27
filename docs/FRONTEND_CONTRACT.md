# liqui — Frontend Data Contract

Everything the frontend needs. **3 endpoints:** two fetched once on load to populate
the page, one SSE stream that keeps it live (no polling).

```
ON LOAD:   GET /api/status        -> top cards + totals
           GET /api/transactions  -> activity table (existing history)
THEN:      GET /api/stream  (SSE) -> live push updates, no polling
```

> SSE only pushes events from the moment you connect — it does not replay history.
> So you must do the two load fetches first, then let the stream keep things current.

- Base URL: `http://localhost:3000` (dev) · `https://api.yourdomain.com` (prod)
- All GET endpoints are public (no key). Explorer link: `https://solscan.io/tx/<txHash>`.
- Do **not** poll every second. The stream handles live updates; for the slowly
  rising fees number, animate client-side between `unclaimed` events.

---

## 1) GET /api/status  — header cards + totals (call once on load)

```json
{
  "dryRun": false,
  "tokenSymbol": "LIQUI",
  "solPriceUsd": 72.58,
  "cards": {
    "autoClaimEverySol": 1,
    "unclaimedSol": 0.0002,
    "unclaimedUsd": 0.01,
    "devWallet": "FMxp5cvNVxTemBvqJzSGAa9Yp4R5EBGJ2V6YZ3EHc47Q",
    "totalClaimedSol": 2.3324, "totalClaimedUsd": 169.29,
    "totalForLiquiditySol": 1.8857, "totalForLiquidityUsd": 136.87,
    "totalForDevSol": 0.0466, "totalForDevUsd": 3.39,
    "totalLiquidityAddedSol": 0.9428, "totalLiquidityAddedUsd": 68.44,
    "locksCount": 2,
    "liquidityPct": 98,
    "devPct": 2
  },
  "wallet": {
    "pubkey": "9fsCWUQJL1RBHQ34c56gMn5bzdAWrUoV1Urz2oBFRJQN",
    "ephemeral": false,
    "solBalance": 0.7347,
    "balanceSource": "rpc"
  },
  "token": { "mint": "9ziidL5...pump", "pumpswapPoolId": null },
  "config": {
    "solSplitBuy": 0.5, "solReserve": 0.02,
    "claimThresholdSol": 1, "lockCostSol": 0.18,
    "lockYears": 999, "devFeePct": 2, "devWallet": "FMxp5cv...Hc47Q"
  },
  "totals": {
    "cycles": 4, "completed": 2, "failed": 0, "skipped": 2,
    "solClaimed": 2.3324, "devFeePaid": 0.0466,
    "tokensBought": 3400000, "lpLocked": 21.89, "locks": 2
  },
  "scheduler": {
    "schedule": "*/10 * * * *",
    "claimThresholdSol": 1,
    "lastClaimable": 0.0002,
    "paused": false, "isRunning": false,
    "lastRunAt": "2026-06-26T16:39:42Z",
    "lastResult": { "id": 4, "status": "skipped" },
    "startedAt": "2026-06-26T16:30:00Z"
  },
  "lastCycle": { "id": 2, "status": "complete", "steps": [ "...same as /api/cycles/:id..." ] }
}
```

**Card mapping (mockup -> field):**

| Mockup card | Field(s) |
|---|---|
| AUTO CLAIM EVERY | `cards.autoClaimEverySol` (+ " SOL") |
| UNCLAIMED FEES | `cards.unclaimedSol` / `cards.unclaimedUsd` |
| DEV WALLET | `cards.devWallet` |
| TOTAL CREATOR FEES CLAIMED | `cards.totalClaimedSol` / `...Usd` |
| TOTAL USED FOR LIQUIDITY (98%) | `cards.totalForLiquiditySol` / `...Usd` (`liquidityPct`) |
| TOTAL FOR DEV / TECH (2%) | `cards.totalForDevSol` / `...Usd` (`devPct`) |
| TOTAL LIQUIDITY ADDED | `cards.totalLiquidityAddedSol` / `...Usd` |

`*Usd` fields are `null` if the price feed is momentarily down — render "—".

---

## 2) GET /api/transactions?limit=50&offset=0  — activity table (call once on load)

Newest first. `limit` default 50, max 500.

```json
{
  "limit": 50,
  "offset": 0,
  "solPriceUsd": 72.58,
  "items": [
    {
      "id": 10, "cycleId": 2,
      "type": "Lock Liquidity", "rawType": "lock",
      "amountSol": null, "usdValue": null, "allocationPct": 98,
      "status": "Locked", "lockYears": 999,
      "txHash": "3TKHmNAS...gevFF", "at": "2026-06-26T16:39:58Z"
    },
    {
      "id": 9, "cycleId": 2,
      "type": "Add Liquidity", "rawType": "add_liquidity",
      "amountSol": 0.5077, "usdValue": 36.85, "allocationPct": 98,
      "status": "Completed", "lockYears": null,
      "txHash": "22QqwDUq...35Cra", "at": "2026-06-26T16:39:53Z"
    },
    {
      "id": 8, "cycleId": 2,
      "type": "Buy $LIQUI", "rawType": "buy",
      "amountSol": 0.5077, "usdValue": 36.85, "allocationPct": 98,
      "status": "Completed", "lockYears": null,
      "txHash": "5TKXuzHK...8wBX", "at": "2026-06-26T16:39:50Z"
    },
    {
      "id": 7, "cycleId": 2,
      "type": "Dev / Tech", "rawType": "dev_fee",
      "amountSol": 0.0248, "usdValue": 1.80, "allocationPct": 2,
      "status": "Completed", "lockYears": null,
      "txHash": "2TYKMkMD...1zcwt", "at": "2026-06-26T16:39:47Z"
    },
    {
      "id": 6, "cycleId": 2,
      "type": "Auto Claim", "rawType": "claim",
      "amountSol": 1.2403, "usdValue": 90.02, "allocationPct": null,
      "status": "Claimed", "lockYears": null,
      "txHash": "m44Ci2Fb...2kkC", "at": "2026-06-26T16:39:45Z"
    }
  ]
}
```

**Column mapping (mockup -> field):**

| Column | Field | Notes |
|---|---|---|
| TIME | `at` | render "x sec ago" client-side from this ISO timestamp |
| TYPE | `type` | Auto Claim / Dev / Tech / Buy $LIQUI / Add Liquidity / Lock Liquidity |
| AMOUNT (SOL) | `amountSol` | `null` -> show "–" (lock rows) |
| USD VALUE | `usdValue` | `null` -> show "—" |
| ALLOCATION | `allocationPct` | e.g. "98%" / "2%"; `null` -> "–" (claim row) |
| STATUS | `status` | Claimed / Completed / Locked / Failed |
| TX HASH | `txHash` | link `https://solscan.io/tx/<txHash>` |
| (lock sub-label) | `lockYears` | 999 -> "(999 yrs)" |

---

## 3) GET /api/stream  — Server-Sent Events (live, no polling)

Open once with `EventSource`. Auto-reconnects. Public. Event types:

```
event: hello
data: {"ok":true,"at":"2026-06-26T16:39:42Z"}
```
```
event: step
data: {"id":11,"cycleId":3,"type":"Buy $LIQUI","rawType":"buy","amountSol":0.5077,
       "usdValue":36.85,"allocationPct":98,"status":"Completed","lockYears":null,
       "txHash":"...","at":"2026-06-26T16:50:01Z"}
```
```
event: cycle
data: {"id":3,"status":"complete","mode":"prebond"}
```
```
event: unclaimed
data: {"unclaimedSol":0.0002,"unclaimedUsd":0.01,"thresholdSol":1,"progressPct":0.02,
       "readyToFire":false,"solPriceUsd":72.58,"updatedAt":"2026-06-26T16:50:00Z"}
```
```
event: scheduler
data: {"schedule":"*/10 * * * *","claimThresholdSol":1,"lastClaimable":0.0002,
       "paused":true,"isRunning":false}
```

**Handling:**

| Event | data | Frontend does |
|---|---|---|
| `hello` | connection ack | mark stream "live" |
| `step` | **one activity row** (same shape as `/api/transactions` items) | `unshift` onto the table |
| `cycle` | `{ id, status, mode }` | re-fetch `GET /api/status` to refresh totals |
| `unclaimed` | unclaimed-fees payload | update the UNCLAIMED FEES card |
| `scheduler` | scheduler state | reflect paused/running |

---

## Complete frontend logic

```js
const API = 'http://localhost:3000'; // '' for same-origin behind a proxy

// 1) populate once
const status = await fetch(`${API}/api/status`).then(r => r.json());
const txs    = await fetch(`${API}/api/transactions?limit=50`).then(r => r.json());
renderCards(status.cards);
renderTable(txs.items);

// 2) keep live
const es = new EventSource(`${API}/api/stream`);
es.addEventListener('step',      e => addRowToTop(JSON.parse(e.data)));
es.addEventListener('unclaimed', e => updateFeesCard(JSON.parse(e.data)));
es.addEventListener('cycle',     () =>
  fetch(`${API}/api/status`).then(r => r.json()).then(s => renderCards(s.cards)));
es.addEventListener('scheduler', e => setPaused(JSON.parse(e.data).paused));

// "x sec ago" ticks client-side — no network
function timeAgo(iso){ const s=(Date.now()-new Date(iso))/1000|0;
  return s<60?`${s} sec ago`:s<3600?`${s/60|0} min ago`:`${s/3600|0} hr ago`; }
setInterval(rerenderTimes, 1000);
```

## Optional / admin
- `GET /api/unclaimed` — same payload as the `unclaimed` SSE event (poll 15–30s if not using SSE).
- `GET /api/cycles?limit=&offset=` — paginated cycle history (one row per cycle).
- `GET /api/cycles/:id` — one cycle with its `steps[]`.
- `POST /api/run | /api/pause | /api/resume` — admin only; require header `x-api-key: <key>`
  when `API_KEY` is set on the server. Never ship the key in public frontend code.

## Vocabulary
- Cycle `status`: `running` | `complete` | `failed` | `skipped`.
- `mode`: `prebond` (our pool) | `graduated` (canonical PumpSwap pool).
- A `skipped` cycle = vault below threshold, or too small after dev + lock + gas. Normal.
