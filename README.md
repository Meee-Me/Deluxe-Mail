# Deluxe Mail

An inbox at `yourname@deluxemail.com`, signed in with your **Deluxe account** from
[Deluxe Main](https://deluxe-main.vercel.app). Nobody signs up here: accounts are only
made on Deluxe Main, and your address is your Deluxe handle (shown on Deluxe Main's account page).

- `index.html` is the whole app. It loads `deluxe.js` from Deluxe Main for **Sign in with Deluxe Main**.
- `netlify/functions/api.mjs` is the `/api/*` function. It checks each request's key with Deluxe Main,
  and saves mail (and the Gmail connection) **in Deluxe Main**, under the `mail` website.
- `api/[...path].js` runs the same function on **Vercel** (import the repository on Vercel; no build).

## Features

- Inbox, **Starred**, Sent, **Drafts** and **Trash**, plus a read-only Gmail folder.
- Reply, **Forward**, **Star**, **Mark unread**, Delete (to Trash), **Restore** and **Empty trash**.
- Drafts save themselves while you type and open again from Drafts; sending removes the draft.
- **Guest mode**: "Continue as guest" opens Deluxe Mail without an account. Drafts are kept in that
  browser; sending needs a Deluxe account, and signing in moves the guest drafts into it.
- Signing in is saved (180 days, renewed on each visit), so the inbox opens straight away.

## Setup

1. On the Deluxe server (the `deluxe-drive` Cloudflare Worker, which runs Deluxe Main): add this site's
   address (`https://deluxe-mail.vercel.app` is already allowed), and set a secret
   `APP_KEY_MAIL` (Workers & Pages, deluxe-drive, Settings, Variables and Secrets; any long random text).
2. On Vercel (or Netlify), set environment variables:
   - `MAIN_APP_KEY`: the same text as `APP_KEY_MAIL` (secret)
   - `MAIN_URL`: only if the Deluxe data server is not at `https://deluxe-drive.deluxelordd.workers.dev/main`
   - optional: `RESEND_API_KEY` (sending outside), `INBOUND_SECRET` (receiving),
     `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENC_KEY`, `GOOGLE_REDIRECT_URI` (read-only Gmail)
3. Deploy. Vercel: import the repository, no build command. Netlify: publish `.`, functions `netlify/functions`.

## Older Deluxe Mail accounts

Accounts made here before Deluxe Main are closed for sign-in. After signing in with Deluxe Main, the
account menu has **Bring over an older Deluxe Mail inbox** (on the Netlify copy, where the old inboxes are): type the old name and password, and its
messages move into your Deluxe account (the old account is then removed). New mail arrives at your
Deluxe handle's address. The "Continue with Google (Gmail only)" sign-in is gone; Gmail can still be
connected (read only) once signed in.
