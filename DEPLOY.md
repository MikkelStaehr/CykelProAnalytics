# Deployment Guide — CykelPro Analytics

## Prerequisites

- App is deployed to Vercel (via GitHub import or `vercel deploy`)
- Domain purchased and managed at One.com

---

## Step 1 — Add environment variables in Vercel

Before your first deploy, add these environment variables in the Vercel dashboard:

**Project → Settings → Environment Variables**

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `HOLDET_EMAIL` | Your Holdet.dk login email |
| `HOLDET_PASSWORD` | Your Holdet.dk password |
| `AUTH_PASSWORD` | Password to protect the app (choose a strong one) |
| `AUTH_SECRET` | A random secret string used to sign the auth cookie — generate with `openssl rand -hex 32` |

---

## Step 2 — Add custom domain in Vercel

1. Open your project in the [Vercel dashboard](https://vercel.com)
2. Go to **Project → Settings → Domains**
3. Click **Add**
4. Type your domain name, e.g. `cykelproanalytics.dk`
5. Click **Add**

Vercel will show you the DNS record(s) you need to create. Keep this page open.

---

## Step 3 — Add DNS record in One.com

Log in to [One.com](https://www.one.com) → **My Products** → your domain → **DNS settings**

### Option A — Subdomain (e.g. `www.cykelproanalytics.dk` or `app.cykelproanalytics.dk`)

Add a **CNAME** record:

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name / Host | `www` (or `app`, etc.) |
| Value / Points to | `cname.vercel-dns.com` |
| TTL | 3600 (or leave default) |

### Option B — Apex / root domain (e.g. `cykelproanalytics.dk` without www)

One.com does not support CNAME on apex domains. Use an **A record** instead:

| Field | Value |
|---|---|
| Type | `A` |
| Name / Host | `@` (or leave blank) |
| Value / IP address | `76.76.21.21` |
| TTL | 3600 |

> **Tip:** Vercel recommends adding both: an A record for the apex (`@`) and a CNAME for `www`, then setting up a redirect in Vercel from `www` → apex (or vice versa).

---

## Step 4 — Wait for DNS propagation

DNS changes take **15 minutes to 2 hours** in most cases, and up to **48 hours** in rare cases.

You can check propagation status at [dnschecker.org](https://dnschecker.org).

Once propagated, Vercel automatically provisions a free **TLS/HTTPS certificate** via Let's Encrypt. This happens within a few minutes of DNS resolving.

---

## Step 5 — Verify

1. Visit your domain in a browser
2. You should see the login page
3. Enter the password you set in `AUTH_PASSWORD`
4. Confirm the app loads correctly

---

## Useful commands (run locally or in Vercel shell)

```bash
# Fetch mountain stage results to populate GT climber data
bash scripts/fetch_all_results.sh mountain

# Fetch cobbled + mixed classics data
bash scripts/fetch_all_results.sh cobbled mixed

# Score riders for a specific race
python scripts/score_riders.py --race strade-bianche
```

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Domain shows "Invalid Configuration" in Vercel | DNS not propagated yet | Wait and retry |
| App shows blank page | Missing env variables | Check Vercel → Settings → Environment Variables |
| Login doesn't work | `AUTH_PASSWORD` or `AUTH_SECRET` not set | Add them in Vercel env vars |
| Admin fetch buttons fail | `HOLDET_EMAIL` / `HOLDET_PASSWORD` missing | Add Holdet credentials |
| `supabase` Python error | Missing pip package | `pip install supabase httpx beautifulsoup4` |
