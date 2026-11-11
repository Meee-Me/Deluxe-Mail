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

1. Deluxe Main recognises Mail's key by its SHA-256 fingerprint, written in Deluxe Main's
   `worker/apps.js` (`keyHash` of `mail`). Nothing has to be set on Cloudflare. A new key means
   putting its new fingerprint there.
2. On Vercel (or Netlify), set environment variables:
   - `MAIN_APP_KEY`: the key (mark it sensitive; tick Production), then redeploy
   - `MAIN_URL`: only if the Deluxe data server is not at `https://deluxe-drive.deluxelordd.workers.dev/main`
   - optional: `RESEND_API_KEY` (sending outside), `INBOUND_SECRET` (receiving),
     `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENC_KEY`, `GOOGLE_REDIRECT_URI` (read-only Gmail)
3. Deploy. Vercel: import the repository, no build command. Netlify: publish `.`, functions `netlify/functions`.

## Mail from Gmail and everywhere else

Deluxe Mail users can always write to each other. For mail from **outside** (Gmail, Outlook, …) to
reach `name@deluxemail.com`, and for sending **to** outside addresses:

1. **Own the domain.** Mail for `deluxemail.com` goes wherever its owner's DNS says. If you don't own
   it, buy a domain (any registrar) and set `MAIL_DOMAIN` on Vercel to it (for example
   `deluxemail.app`); addresses become `name@<that domain>`.
2. **Receive with an inbound email service.** Any of these works; Resend is the easiest because it
   also sends:
   - **Resend** (resend.com): add the domain, turn on **Receiving**, add the MX record it shows at your
     registrar, and add a webhook for `email.received` pointing to
     `https://deluxe-mail.vercel.app/api/inbound?key=<INBOUND_SECRET>`.
   - **Postmark** (inbound stream), **Mailgun** (a route that forwards to the URL), or **SendGrid**
     (Inbound Parse): point them at the same URL.
3. **On Vercel** (deluxe-mail, Settings, Environment Variables), then Redeploy:
   - `INBOUND_SECRET`: any long random text, the same as in the webhook URL
   - `RESEND_API_KEY`: from Resend, for sending to outside addresses (and reading Resend message bodies)
   - `MAIL_DOMAIN`: only if the domain is not `deluxemail.com`

Mail to a name nobody has is dropped quietly (the service is told it arrived, so it does not retry).
Attachments are not kept yet.

## Older Deluxe Mail accounts

Accounts made here before Deluxe Main are closed for sign-in. After signing in with Deluxe Main, the
account menu has **Bring over an older Deluxe Mail inbox** (on the Netlify copy, where the old inboxes are): type the old name and password, and its
messages move into your Deluxe account (the old account is then removed). New mail arrives at your
Deluxe handle's address. The "Continue with Google (Gmail only)" sign-in is gone; Gmail can still be
connected (read only) once signed in.
