import crypto from "node:crypto";

// Deluxe Mail's server.
//
// Accounts belong to Deluxe Main: people "Sign in with Deluxe Main", and every
// request carries the key Deluxe Main gave this site, which is checked with
// Deluxe Main. Nobody signs up here. A person's address is their Deluxe handle
// (shown on Deluxe Main), e.g. shivad.sujith@deluxemail.com.
//
// Mail (and the Gmail connection) is saved in Deluxe Main, under the "mail"
// website, using this site's key for Deluxe Main (MAIN_APP_KEY). Nothing is
// kept by the host, so the same code runs on Netlify (netlify/functions) and
// on Vercel (api/[...path].js).
//
// Folders: inbox, sent, drafts and trash (keys "<folder>/<newest-first id>");
// "starred" lists starred mail from inbox and sent.
//
// Environment: MAIN_URL (default below), MAIN_APP_KEY (the same value as
// APP_KEY_MAIL on Deluxe Main), and optionally RESEND_API_KEY, INBOUND_SECRET,
// GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENC_KEY, GOOGLE_REDIRECT_URI.

export const config = { path: "/api/*" };

const DOMAIN = "deluxemail.com";
const MAIN = String(process.env.MAIN_URL || "https://deluxe-drive.deluxelordd.workers.dev/main").replace(/\/+$/, "");
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const clean = (s, max) => String(s ?? "").slice(0, max);

/* ---------- Deluxe Main ---------- */

class MainError extends Error {}

async function mainFetch(path, init = {}) {
  let r;
  try {
    r = await fetch(MAIN + path, init);
  } catch (e) {
    throw new MainError("Deluxe Main could not be reached. Try again in a moment.");
  }
  return r;
}

// Who a Deluxe Main key belongs to (cached for a minute).
const seen = new Map();
async function auth(req) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const hit = seen.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const r = await mainFetch("/api/auth/me", { headers: { Authorization: "Bearer " + token } });
  if (r.status >= 500) throw new MainError("Deluxe Main could not be reached. Try again in a moment.");
  const d = r.ok ? await r.json() : null;
  const user = d && d.user && (d.app === "mail" || d.app === "main") ? d.user : null;
  if (seen.size > 2000) seen.clear();
  seen.set(token, { user, until: Date.now() + (user ? 60000 : 5000) });
  return user;
}

function appHeaders(accountId, extra = {}) {
  if (!process.env.MAIN_APP_KEY) throw new MainError("Deluxe Mail is not connected to Deluxe Main yet (set MAIN_APP_KEY).");
  return { Authorization: "App " + process.env.MAIN_APP_KEY, "X-Deluxe-App": "mail", ...(accountId ? { "X-Deluxe-Account": accountId } : {}), ...extra };
}

async function findAccount(handle) {
  const r = await mainFetch("/api/server/account?handle=" + encodeURIComponent(handle), { headers: appHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new MainError("Deluxe Main could not look that address up.");
  return (await r.json()).user;
}

// This account's saved mail in Deluxe Main.
function mainData(accountId) {
  const base = "/api/data/mail";
  const key = (k) => base + "/" + encodeURIComponent(k);
  const call = async (path, init = {}) => {
    const r = await mainFetch(path, { ...init, headers: appHeaders(accountId, init.body ? { "Content-Type": "application/json" } : {}) });
    if (!r.ok && r.status !== 404) throw new MainError("Deluxe Main could not save that (" + r.status + ").");
    return r;
  };
  return {
    async list(prefix, { limit = 100 } = {}) {
      const r = await call(`${base}?prefix=${encodeURIComponent(prefix)}&order=asc&limit=${limit}`);
      return (await r.json()).items || [];
    },
    async get(k) {
      const r = await call(key(k));
      return r.status === 404 ? null : (await r.json()).value;
    },
    async set(k, value) {
      await call(key(k), { method: "PUT", body: JSON.stringify({ value }) });
    },
    async del(k) {
      await call(key(k), { method: "DELETE" });
    },
  };
}

const addressOf = (user) => `${user.handle}@${DOMAIN}`;
const FOLDERS = ["inbox", "sent", "drafts", "trash"];
const KEY = /^(inbox|sent|drafts|trash)\/[0-9]{13}-[0-9A-Za-z-]{1,64}$/;
const newKey = (folder) => `${folder}/${String(9999999999999 - Date.now()).padStart(13, "0")}-${crypto.randomUUID()}`;
const summary = ({ body, ...rest }) => ({ ...rest, preview: String(body || "").slice(0, 90) });

async function deliver(account, folder, msg) {
  const key = newKey(folder);
  const id = key.split("-").slice(1).join("-");
  await mainData(account.id).set(key, { id, key, folder, date: Date.now(), read: folder !== "inbox", starred: false, ...msg });
  return key;
}

async function sendExternal(from, to, subject, body) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "Sending to outside addresses isn't configured yet (set RESEND_API_KEY)." };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text: body }),
  });
  if (!r.ok) return { ok: false, error: "Outside delivery failed: " + (await r.text()).slice(0, 200) };
  return { ok: true };
}

/* ---------- old Deluxe Mail accounts (before Deluxe Main) ---------- */

function checkOldPassword(pw, { salt, hash }) {
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

// ---------- Gmail (read-only, per-user OAuth) ----------
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const gConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.TOKEN_ENC_KEY);
const encKey = () => crypto.createHash("sha256").update(String(process.env.TOKEN_ENC_KEY)).digest();
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}
function decrypt(o) {
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(o.iv, "base64"));
  d.setAuthTag(Buffer.from(o.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(o.data, "base64")), d.final()]).toString("utf8");
}
async function gAccessToken(account) {
  const rec = await mainData(account.id).get("gmail");
  if (!rec) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: decrypt(rec.token),
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return null;
  return (await r.json()).access_token;
}
async function gGet(at, path) {
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, {
    headers: { Authorization: "Bearer " + at },
  });
  if (!r.ok) throw new Error("Gmail error " + r.status);
  return r.json();
}
const hdr = (p, n) => ((p && p.headers) || []).find((h) => h.name.toLowerCase() === n)?.value || "";
const dec = (s) =>
  String(s || "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const b64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
function gBody(payload) {
  let plain = "", html = "";
  (function walk(p) {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data) plain += b64u(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data) html += b64u(p.body.data);
    (p.parts || []).forEach(walk);
  })(payload);
  if (plain) return plain;
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  const method = req.method;

  try {
    // Accounts are made and signed in on Deluxe Main now.
    if (["signup", "login", "google/start"].includes(route)) {
      return json({ error: "Deluxe Mail uses your Deluxe account. Sign in with Deluxe Main." }, 410);
    }

    // ---------- Inbound mail webhook (Postmark/Mailgun-style JSON) ----------
    if (route === "inbound" && method === "POST") {
      if (!process.env.INBOUND_SECRET || url.searchParams.get("key") !== process.env.INBOUND_SECRET)
        return json({ error: "Forbidden" }, 403);
      const b = await req.json();
      const toRaw = clean(b.OriginalRecipient || b.To || b.to || b.recipient, 300).toLowerCase();
      const m = toRaw.match(/([a-z0-9._-]+)@deluxemail\.com/);
      if (!m) return json({ error: "No deluxemail recipient" }, 200);
      const rcpt = await findAccount(m[1]);
      if (!rcpt) return json({ error: "Unknown user" }, 200);
      await deliver(rcpt, "inbox", {
        from: clean(b.From || b.from || b.sender, 300),
        to: addressOf(rcpt),
        subject: clean(b.Subject || b.subject || "(no subject)", 300),
        body: clean(b.TextBody || b["body-plain"] || b.text || "", 50000),
      });
      return json({ ok: true });
    }

    // ---------- Gmail OAuth callback (browser redirect from Google, no login header) ----------
    if (route === "gmail/callback" && method === "GET") {
      const st = url.searchParams.get("state"), code = url.searchParams.get("code");
      const back = (r) => new Response(null, { status: 302, headers: { Location: "/?gmail=" + r } });
      if (!gConfigured() || !st || !code) return back("error");
      // state is "<account id>.<random>"; the random part is saved in that account.
      const [accountId, nonce] = st.split(".");
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(accountId || "") || !/^[0-9a-f]{48}$/.test(nonce || "")) return back("error");
      const pending = mainData(accountId);
      const rec = await pending.get("oauth:" + nonce);
      if (rec) await pending.del("oauth:" + nonce);
      if (!rec || rec.expires < Date.now()) return back("error");
      rec.accountId = accountId;
      const tr = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: rec.redirect,
          grant_type: "authorization_code",
        }),
      });
      if (!tr.ok) return back("error");
      const tok = await tr.json();
      if (!tok.refresh_token) return back("error");
      const prof = await gGet(tok.access_token, "profile");
      await mainData(rec.accountId).set("gmail", { email: prof.emailAddress, token: encrypt(tok.refresh_token), connected: Date.now() });
      return back("connected");
    }

    // ---------- Everything below needs a Deluxe account ----------
    const me = await auth(req);
    if (!me) return json({ error: "Please sign in with Deluxe Main." }, 401);
    const store = mainData(me.id);

    if (route === "me" && method === "GET") {
      // The first visit gets a welcome message.
      const welcomed = await store.get("welcomed");
      if (!welcomed) {
        await store.set("welcomed", Date.now());
        await deliver(me, "inbox", {
          from: `Deluxe Mail <welcome@${DOMAIN}>`,
          to: addressOf(me),
          subject: "Welcome to Deluxe Mail ✦",
          body: `Hi ${me.name},\n\nYour deluxe address is ${addressOf(me)}.\nShare it with anyone – messages land right here.\n\n— The Deluxe Mail team`,
        });
      }
      return json({ address: addressOf(me), displayName: me.name });
    }

    if (route === "list" && method === "GET") {
      const folder = url.searchParams.get("folder") || "inbox";
      if (folder === "starred") {
        const both = [...(await store.list("inbox/", { limit: 300 })), ...(await store.list("sent/", { limit: 300 }))];
        const starred = both.map((x) => x.value).filter((m) => m && m.starred).sort((x, y) => y.date - x.date);
        return json({ messages: starred.slice(0, 100).map(summary) });
      }
      if (!FOLDERS.includes(folder)) return json({ error: "No such folder." }, 400);
      const items = await store.list(`${folder}/`, { limit: 100 });
      const unread = folder === "inbox" ? items.filter((x) => x.value && !x.value.read).length : undefined;
      return json({ messages: items.map((x) => x.value).filter(Boolean).map(summary), unread });
    }

    if (route === "message" && method === "GET") {
      const key = url.searchParams.get("key") || "";
      if (!KEY.test(key)) return json({ error: "Not found" }, 404);
      const msg = await store.get(key);
      if (!msg) return json({ error: "Not found" }, 404);
      if (!msg.read) await store.set(key, { ...msg, read: true });
      return json({ ...msg, read: true });
    }

    // Star / unstar, read / unread.
    if (route === "update" && method === "POST") {
      const b = await req.json();
      if (!KEY.test(String(b.key))) return json({ error: "Not found" }, 404);
      const msg = await store.get(b.key);
      if (!msg) return json({ error: "Not found" }, 404);
      const next = { ...msg };
      if (typeof b.starred === "boolean") next.starred = b.starred;
      if (typeof b.read === "boolean") next.read = b.read;
      await store.set(b.key, next);
      return json({ ok: true, message: summary(next) });
    }

    // Delete moves mail to Trash; deleting from Trash (or a draft) is for good.
    if (route === "delete" && method === "POST") {
      const { key } = await req.json();
      if (!KEY.test(String(key))) return json({ error: "Not found" }, 404);
      const msg = await store.get(key);
      if (!msg) return json({ ok: true });
      await store.del(key);
      if (!/^(trash|drafts)\//.test(key)) {
        const to = newKey("trash");
        await store.set(to, { ...msg, key: to, folder: "trash", fromFolder: msg.folder || key.split("/")[0], trashedAt: Date.now() });
        return json({ ok: true, movedTo: to });
      }
      return json({ ok: true });
    }

    if (route === "restore" && method === "POST") {
      const { key } = await req.json();
      if (!/^trash\//.test(String(key)) || !KEY.test(String(key))) return json({ error: "Not found" }, 404);
      const msg = await store.get(key);
      if (!msg) return json({ error: "Not found" }, 404);
      const folder = ["inbox", "sent"].includes(msg.fromFolder) ? msg.fromFolder : "inbox";
      const to = `${folder}/${key.slice("trash/".length)}`;
      const { fromFolder, trashedAt, ...rest } = msg;
      await store.set(to, { ...rest, key: to, folder });
      await store.del(key);
      return json({ ok: true, key: to });
    }

    if (route === "empty-trash" && method === "POST") {
      const items = await store.list("trash/", { limit: 1000 });
      for (const x of items) await store.del(x.key);
      return json({ ok: true, deleted: items.length });
    }

    // Drafts are saved while writing; a draft key may be passed to update it.
    if (route === "draft" && method === "POST") {
      const b = await req.json();
      const key = KEY.test(String(b.key || "")) && String(b.key).startsWith("drafts/") ? b.key : newKey("drafts");
      const draft = {
        id: key.split("-").slice(1).join("-"), key, folder: "drafts", read: true, date: Date.now(),
        from: addressOf(me), to: clean(b.to, 200), subject: clean(b.subject, 300), body: clean(b.body, 50000),
      };
      await store.set(key, draft);
      return json({ ok: true, key });
    }

    if (route === "send" && method === "POST") {
      const b = await req.json();
      const to = clean(b.to, 200).toLowerCase().trim();
      const subject = clean(b.subject || "(no subject)", 300);
      const text = clean(b.body, 50000);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: "Enter a valid recipient address." }, 400);
      const from = addressOf(me);

      if (to.endsWith(`@${DOMAIN}`)) {
        const rcpt = await findAccount(to.split("@")[0]);
        if (!rcpt) return json({ error: "No Deluxe Mail account with that name." }, 404);
        await deliver(rcpt, "inbox", { from: `${me.name} <${from}>`, to, subject, body: text });
      } else {
        const r = await sendExternal(`${me.name} <${from}>`, to, subject, text);
        if (!r.ok) return json({ error: r.error }, 501);
      }
      await deliver(me, "sent", { from, to, subject, body: text });
      if (b.draftKey && /^drafts\//.test(String(b.draftKey)) && KEY.test(String(b.draftKey))) await store.del(b.draftKey);
      return json({ ok: true });
    }

    // ---------- Bring over an inbox from before Deluxe Main ----------
    if (route === "import" && method === "POST") {
      const b = await req.json();
      const oldName = clean(b.username, 60).toLowerCase().trim().replace(`@${DOMAIN}`, "");
      // Old accounts lived in Netlify Blobs, so this only works on Netlify.
      let getStore;
      try {
        ({ getStore } = await import("@netlify/blobs"));
      } catch (e) {
        return json({ error: "Older Deluxe Mail inboxes can only be brought over on the Netlify copy of Deluxe Mail." }, 501);
      }
      const users = getStore("users");
      const old = oldName ? await users.get(oldName, { type: "json" }) : null;
      if (!old || old.google || !old.hash || !checkOldPassword(clean(b.password, 200), old))
        return json({ error: "That old Deluxe Mail name and password don't match." }, 401);
      const mail = getStore("mail");
      const { blobs } = await mail.list({ prefix: `${oldName}/` });
      let moved = 0;
      for (const x of blobs) {
        const msg = await mail.get(x.key, { type: "json" });
        if (!msg) continue;
        const key = x.key.slice(oldName.length + 1);
        await store.set(key, { ...msg, key });
        await mail.delete(x.key);
        moved += 1;
      }
      await users.delete(oldName);
      return json({ ok: true, moved });
    }

    // ---------- Gmail (signed-in users) ----------
    if (route === "gmail/status" && method === "GET") {
      const rec = await store.get("gmail");
      return json({ configured: gConfigured(), connected: !!rec, email: rec?.email || null });
    }
    if (route === "gmail/start" && method === "POST") {
      if (!gConfigured()) return json({ error: "Gmail isn't set up on this site yet." }, 501);
      const nonce = crypto.randomBytes(24).toString("hex");
      const st = `${me.id}.${nonce}`;
      const redirect = process.env.GOOGLE_REDIRECT_URI || `${url.origin}/api/gmail/callback`;
      await store.set("oauth:" + nonce, { redirect, expires: Date.now() + 10 * 60 * 1000 });
      const q = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirect,
        response_type: "code",
        scope: GMAIL_SCOPE,
        access_type: "offline",
        prompt: "consent",
        state: st,
      });
      return json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + q });
    }
    if (route === "gmail/disconnect" && method === "POST") {
      const rec = await store.get("gmail");
      if (rec) {
        try {
          await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(decrypt(rec.token)), { method: "POST" });
        } catch (e) { /* best effort */ }
        await store.del("gmail");
      }
      return json({ ok: true });
    }
    if (route === "gmail/list" && method === "GET") {
      const at = await gAccessToken(me);
      if (!at) return json({ error: "Gmail connection expired. Please reconnect Gmail." }, 409);
      const l = await gGet(at, "messages?maxResults=25&labelIds=INBOX");
      const msgs = await Promise.all(
        (l.messages || []).map((m) =>
          gGet(at, `messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`)
        )
      );
      return json({
        messages: msgs.map((m) => ({
          id: m.id,
          from: hdr(m.payload, "from"),
          to: hdr(m.payload, "to"),
          subject: hdr(m.payload, "subject") || "(no subject)",
          preview: dec(m.snippet),
          date: Number(m.internalDate),
          read: !(m.labelIds || []).includes("UNREAD"),
        })),
      });
    }
    if (route === "gmail/message" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      if (!/^[a-zA-Z0-9]+$/.test(id)) return json({ error: "Not found" }, 404);
      const at = await gAccessToken(me);
      if (!at) return json({ error: "Gmail connection expired. Please reconnect Gmail." }, 409);
      const m = await gGet(at, `messages/${id}?format=full`);
      return json({
        id: m.id,
        from: hdr(m.payload, "from"),
        to: hdr(m.payload, "to"),
        subject: hdr(m.payload, "subject") || "(no subject)",
        date: Number(m.internalDate),
        body: gBody(m.payload).slice(0, 50000) || dec(m.snippet),
      });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof MainError) return json({ error: e.message }, 503);
    return json({ error: "Server error: " + e.message }, 500);
  }
};
