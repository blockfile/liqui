# Deploy — Netlify (frontend) + DigitalOcean (backend)

```
domain.com         -> Netlify          (static frontend)
api.domain.com     -> DigitalOcean IP  (this Node backend, behind nginx + HTTPS)
```

The frontend (HTTPS on Netlify) calls `https://api.domain.com/api/...`. The backend
**must also be HTTPS** or the browser blocks the calls (mixed content). Steps below set that up.

---

## 1. DigitalOcean droplet (Ubuntu 22.04+)

SSH in, then:
```bash
# Node 22 + tools
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm i -g pm2
```

## 2. Get the code + configure
```bash
sudo mkdir -p /var/www/liqui && cd /var/www/liqui
# clone or scp the repo here, then:
npm install --omit=dev
```
Create `/var/www/liqui/.env` with **production** values:
```
PORT=3000
DRY_RUN=false
RPC_URL=<your paid RPC>
WALLET_PRIVATE_KEY=<creator wallet key>
TOKEN_MINT=9ziidL5...pump
TOKEN_SYMBOL=LIQUI
DEV_WALLET=<dev wallet>
DEV_FEE_PCT=2
CLAIM_THRESHOLD_SOL=1
LOCK_COST_SOL=0.18
SOL_RESERVE=0.02
LOCK_YEARS=999
MONGODB_URI=<Atlas SRV URI>
MONGODB_DB=liqui
CORS_ORIGINS=https://domain.com,https://www.domain.com
API_KEY=<long random string: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```
> Reset the test values: `DRY_RUN=false`, `CLAIM_THRESHOLD_SOL=1`, `LOCK_COST_SOL=0.18`.
> `CORS_ORIGINS` = your Netlify site origin(s). To allow Netlify **preview** builds too,
> add the site URL, e.g. `https://your-site.netlify.app`.

## 3. Run it 24/7 with pm2
```bash
cd /var/www/liqui
pm2 start server.js --name liqui
pm2 save
pm2 startup        # run the command it prints, so it restarts on reboot
pm2 logs liqui     # watch it
```

## 4. MongoDB Atlas
Atlas → Network Access → add the **droplet's public IP** to the allowlist
(or `0.0.0.0/0` temporarily for testing). Otherwise it refuses the connection.

## 5. nginx reverse proxy (SSE-aware) for api.domain.com
`sudo nano /etc/nginx/sites-available/liqui`:
```nginx
server {
  listen 80;
  server_name api.domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Required for SSE (/api/stream): don't buffer, keep the connection open
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 24h;
    chunked_transfer_encoding off;
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/liqui /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 6. DNS (in Netlify DNS, where the domain lives)
Add an **A record**: `api` -> the droplet's public IP. Wait for it to propagate.

## 7. HTTPS on the backend (the critical bit)
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.domain.com
```
Now `https://api.domain.com` works. certbot auto-renews.

## 8. Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # 80 + 443
sudo ufw enable
```
Port 3000 and Mongo are **not** public — nginx is the only door.

## 9. Point the frontend at the API
In the Netlify frontend, set the API base to `https://api.domain.com`
(e.g. a `VITE_API_URL` env var). It calls `https://api.domain.com/api/status`,
`/api/transactions`, and opens `https://api.domain.com/api/stream`.

---

## Verify
```bash
curl https://api.domain.com/api/status            # JSON
curl -N https://api.domain.com/api/stream         # 'event: hello', stays open
```
From the deployed frontend, the dashboard should load and update live via SSE.

## Gotchas checklist
- [ ] Backend is **HTTPS** (else the HTTPS frontend can't call it — mixed content).
- [ ] `CORS_ORIGINS` includes the exact Netlify origin(s) (custom domain + `*.netlify.app` if using previews).
- [ ] nginx `proxy_buffering off` (else `/api/stream` won't stream).
- [ ] Atlas allows the droplet IP.
- [ ] Production `.env`: `DRY_RUN=false`, `LOCK_COST_SOL=0.18`, `CLAIM_THRESHOLD_SOL=1`, `API_KEY` set.
- [ ] Rotate any secret that was ever committed/shared (e.g. the Atlas password).

## Updating later
```bash
cd /var/www/liqui && git pull && npm install --omit=dev && pm2 restart liqui
```
