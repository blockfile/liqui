# Frontend integration example

Pattern: **fetch once to populate, then open `/api/stream` (SSE) for live push updates.**
No polling needed. Works with any stack — vanilla JS and React shown below.

```js
const API = 'https://api.yourdomain.com'; // '' for same-origin (Netlify proxy)
```

---

## Vanilla JS (framework-agnostic)

```js
// 1) INITIAL LOAD — populate the page once
async function load() {
  const [status, txs] = await Promise.all([
    fetch(`${API}/api/status`).then(r => r.json()),
    fetch(`${API}/api/transactions?limit=50`).then(r => r.json()),
  ]);
  renderCards(status.cards);     // top cards
  renderActivity(txs.items);     // activity table (newest first)
}

// 2) LIVE UPDATES — open the stream once
function connectStream() {
  const es = new EventSource(`${API}/api/stream`);

  // a new transaction landed → add it to the top of the table
  es.addEventListener('step', (e) => prependActivityRow(JSON.parse(e.data)));

  // a cycle finished → totals changed; refetch the cards (cheap, infrequent)
  es.addEventListener('cycle', () => {
    fetch(`${API}/api/status`).then(r => r.json()).then(s => renderCards(s.cards));
  });

  // unclaimed fees ticked → update the "UNCLAIMED FEES" card
  es.addEventListener('unclaimed', (e) => updateFeesCard(JSON.parse(e.data)));

  // paused/resumed
  es.addEventListener('scheduler', (e) => setPaused(JSON.parse(e.data).paused));

  // EventSource auto-reconnects on drop; this is just for a UI hint
  es.onerror = () => console.warn('stream reconnecting…');
  return es;
}

load();
connectStream();
```

`step` event data is identical to a `/api/transactions` row:
`{ type, amountSol, usdValue, allocationPct, status, lockYears, txHash, at }`.

---

## React hook

```jsx
import { useEffect, useState } from 'react';
const API = import.meta.env.VITE_API_URL || '';

export function useLiqui() {
  const [cards, setCards] = useState(null);
  const [activity, setActivity] = useState([]);
  const [unclaimed, setUnclaimed] = useState(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let alive = true;

    // initial load
    fetch(`${API}/api/status`).then(r => r.json()).then(s => alive && setCards(s.cards));
    fetch(`${API}/api/transactions?limit=50`).then(r => r.json()).then(t => alive && setActivity(t.items));

    // live stream
    const es = new EventSource(`${API}/api/stream`);
    es.addEventListener('step', e => {
      const row = JSON.parse(e.data);
      setActivity(prev => [row, ...prev].slice(0, 100)); // keep last 100
    });
    es.addEventListener('cycle', () => {
      fetch(`${API}/api/status`).then(r => r.json()).then(s => setCards(s.cards));
    });
    es.addEventListener('unclaimed', e => setUnclaimed(JSON.parse(e.data)));
    es.addEventListener('scheduler', e => setPaused(JSON.parse(e.data).paused));

    return () => { alive = false; es.close(); };
  }, []);

  return { cards, activity, unclaimed, paused };
}
```

```jsx
function Dashboard() {
  const { cards, activity, unclaimed } = useLiqui();
  if (!cards) return <div>Loading…</div>;
  return (
    <>
      <FeesCard sol={unclaimed?.unclaimedSol ?? cards.unclaimedSol}
                usd={unclaimed?.unclaimedUsd ?? cards.unclaimedUsd}
                pct={unclaimed?.progressPct} />
      <Card title="Total Creator Fees Claimed" sol={cards.totalClaimedSol} usd={cards.totalClaimedUsd} />
      {/* …other cards… */}
      <ActivityTable rows={activity} />
    </>
  );
}
```

---

## The "live" feel is client-side (no network)

```js
// "4 sec ago" — recompute from row.at every second, no fetch
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s} sec ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} hr ago`;
}
setInterval(() => rerenderTimes(), 1000); // pure render, zero requests
```

Smooth count-up for the fees number: when an `unclaimed` event arrives, animate the
displayed value from the previous to the new one over ~1–2s with `requestAnimationFrame`.

## Rendering notes
- `amountSol === null` → render "–" (lock rows).
- `usdValue === null` → price feed was momentarily down; render "—" or hide.
- TX link: `https://solscan.io/tx/${txHash}`. Lock id link: `https://app.streamflow.finance`.
- Empty state: if `activity` is empty, the bot just hasn't run a cycle yet.

## Admin actions (optional, needs the API key)
```js
fetch(`${API}/api/run`,  { method: 'POST', headers: { 'x-api-key': KEY } });
fetch(`${API}/api/pause`,{ method: 'POST', headers: { 'x-api-key': KEY } });
```
Never ship the API key in public frontend code — only use these from an authenticated admin panel.
