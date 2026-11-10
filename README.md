# Deluxe Mail

An inbox at `yourname@deluxemail.com`, signed in with your **Deluxe account** from
[Deluxe Main](https://deluxe-main.deluxelordd.workers.dev). Nobody signs up here: accounts are only
made on Deluxe Main, and your address is your Deluxe handle (shown on Deluxe Main's account page).

- `index.html` is the whole app. It loads `deluxe.js` from Deluxe Main for **Sign in with Deluxe Main**.
- `netlify/functions/api.mjs` is the `/api/*` function. It checks each request's key with Deluxe Main,
  and saves mail (and the Gmail connection) **in Deluxe Main**, under the `mail` website.

## Setup

1. On Deluxe Main (Cloudflare): add this site's address to `APP_ORIGINS`, e.g.
   `{"mail": ["https://your-mail-site.netlify.app"]}`, and set a secret `APP_KEY_MAIL`
   (`npx wrangler secret put APP_KEY_MAIL`, any long random text).
2. On Netlify, set environment variables:
   - `MAIN_APP_KEY`: the same text as `APP_KEY_MAIL` (secret)
   - `MAIN_URL`: only if Deluxe Main is not at `https://deluxe-main.deluxelordd.workers.dev`
   - optional: `RESEND_API_KEY` (sending outside), `INBOUND_SECRET` (receiving),
     `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENC_KEY`, `GOOGLE_REDIRECT_URI` (read-only Gmail)
3. Deploy (publish directory `.`, functions `netlify/functions`).

## Older Deluxe Mail accounts

Accounts made here before Deluxe Main are closed for sign-in. After signing in with Deluxe Main, the
account menu has **Bring over an older Deluxe Mail inbox**: type the old name and password, and its
messages move into your Deluxe account (the old account is then removed). New mail arrives at your
Deluxe handle's address. The "Continue with Google (Gmail only)" sign-in is gone; Gmail can still be
connected (read only) once signed in.
