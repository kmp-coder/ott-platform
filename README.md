# 🎭 RangManch OTT — Demo Platform

A multi-language OTT platform (songs, short movies, movies, web series) with three portals:

| Portal | Address | Who uses it |
|---|---|---|
| **Home / Viewer site** | http://localhost:4000 | Subscribers browse & watch |
| **Creator Studio** | http://localhost:4000/creator.html | Content creators upload & track earnings |
| **Admin Panel** | http://localhost:4000/admin.html | You — approve content, see all reports |

## How to run it (first time on any computer)

1. Install **Node.js** (LTS version) from https://nodejs.org — click Next, Next, Finish.
2. Download this project: on the GitHub page click the green **Code** button →
   **Download ZIP**, then unzip it anywhere (or clone it if you use Git).
3. Open the unzipped folder and double-click **`Start OTT Platform.bat`**.
   - The very first time it will fetch its two dependencies automatically if
     needed; if the window closes immediately, open Command Prompt in the folder
     and run `npm install` once, then use the .bat again.
4. Your browser opens at http://localhost:4000 with 20 demo titles pre-loaded
   and 2 waiting in the admin approval queue.

Keep the black window open while using the platform; close it to stop.
Everyone who runs it gets their own fresh demo data on their own computer.

## Try the demo in 5 minutes

1. **Home page** — browse, filter by language, search.
2. **Join as subscriber** — "Join Now": any e-mail + any 10-digit mobile + any
   12-digit number as Aadhaar (OTPs appear on screen in green), pick the ₹19 plan.
3. **Watch something fully** without skipping → your view is counted.
4. **Admin panel** (`/admin.html`, password `admin123`) — approve the 2 pending
   titles, set payment plans, download the Excel report.
5. **Creator Studio** (`/creator.html`) — sign up as a new creator (demo OTPs,
   any PAN like `ABCDE1234F`, any bank details), upload a video or paste a link,
   then approve it from the admin panel and watch earnings appear.

## Demo mode — important

- **OTPs are shown on screen** (green text next to the "Send OTP" button) instead of
  being sent by SMS/e-mail/UIDAI. Real Aadhaar KYC and SMS need licensed paid
  providers — this is a legal requirement in India before collecting real Aadhaar,
  PAN and bank details (a Privacy Policy / Terms page is also required).
- **Admin password:** `admin123` (change it in `data\settings.json`).
- 10 sample titles by "RangManch Studios (Demo)" are pre-loaded so the home page
  looks alive. Delete the files in the `data` folder (except settings.json) and
  restart to reset everything.

## How the rules work (as you specified)

**Creator sign-up** — e-mail/mobile OTP + Aadhaar OTP identity verification + PAN
(format checked) + full bank details (account holder, number, IFSC, bank, branch).

**Content flow** — creator uploads (file or link) → status *pending* → appears in
the Admin approval queue → admin watches it, picks a payment plan, approves or
rejects (with reason) → only approved content is telecast on the home page.

**Payment plans** (chosen by admin at approval time, per title):
1. **Upfront** — fixed ₹ amount, earned the moment content is approved.
2. **View-based** — ₹ rate × verified views. A view counts only if the video is
   watched **fully, without fast-forwarding** (rewinding is allowed), and each
   subscriber is counted **once per title** no matter how many times they re-watch.

**Earnings** — calculated automatically; creators see them live in Creator Studio,
you see the full payout liability per creator (with PAN + bank) in Admin → Payout Report.

**Subscribers** — sign up with e-mail/mobile OTP + Aadhaar OTP age verification
(date of birth as per Aadhaar). Under-13 cannot join; under-18 cannot watch
A-rated (18+) titles. Login is by e-mail or mobile OTP.

**Subscription plans** — chosen at sign-up: **₹19 for 1 month** or **₹30 for
12 months**. Payment is demo-only (no real money) until a payment gateway is
connected. Watching requires an active plan; expired members see a renew screen.
Renewing an active plan extends it from the current expiry date.

**Excel reports** — the Admin panel has a "Download Full Excel Report" button
(sheets: Overview, Creators, Subscribers, Content, Payouts) and each creator can
download their own earnings statement from Creator Studio.

## Files

- `server.js` — the whole backend (Node/Express)
- `public/` — the four pages (home, watch, creator, admin) + styles
- `data/` — all platform data as simple JSON files; uploaded videos in `data/uploads`
