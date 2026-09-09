import type { CopyDict } from "./keys";

// M3.9 片 b —— English copy. **Hand-written, never machine-translated**（D42 白纸黑字：
// 机翻界面很难看，不假装支持 15 种）。这一份是**兜底**：回落链最后一定落到它，
// 所以它必须是完整的 —— 底下那行 `satisfies CopyDict` 就是那道闸门，漏一条编译不过。
//
// 写英文的时候注意：**不是逐字译中文**。中文那条「不对就去改」直译成
// "If it's wrong, go change it" 很生硬；英文界面里这种地方就该是
// "Not right? Change it"。语气对得上比字面对得上重要。

export const en = {
  // ── Native-language guess banner ───────────────────────────────────────
  "lang.guess.lead": (label: string) =>
    `Your native language is set to ${label} — filled in from your device's language.`,
  "lang.guess.cta": "Not right? Change it",
  "lang.guess.close": "Got it, stop asking",

  // ── Settings · Language ────────────────────────────────────────────────
  "settings.lang.title": "Language",
  "settings.lang.saved": "Saved",
  "settings.lang.native": "My native language",
  "settings.lang.nativeHint": "What the AI explains in, and what subtitles get translated into",
  "settings.lang.target": "Language I'm learning",
  "settings.lang.targetHint": "Leave empty = I just want to understand the content",
  // 短是有原因的：375px 的 `<select>` 里只放得下约 38 个英文字符，
  // 直译中文那条括号会被截在 "…once you open som"。**被截掉的半句等于没写。**
  "settings.lang.targetUnset": "Not set yet — we'll ask you later",
  "settings.lang.targetNone": "Not learning a language — just here for the content",
  "settings.lang.ui": "Interface language",
  "settings.lang.uiFollowNative": "Follow my native language",
  "settings.lang.uiHint": "The interface is hand-written in Simplified Chinese and English only.",
  "settings.lang.uiFollow": (label: string) => `Following your native language — currently ${label}.`,
  "settings.lang.uiFallback": (native: string, actual: string) =>
    `There's no interface copy in ${native} yet, so you're seeing ${actual}.`,
  "settings.lang.uiFixed": (label: string) => `Fixed to ${label}, regardless of your native language.`,
  // ⏳ 临时的，M3.9 片 f 做完要连同 zh.ts 那条一起删掉
  "settings.lang.uiPartial":
    "The interface is still being moved over page by page — for now only this card and the native-language notice follow this setting.",

  // ── Watch page · collapsible playback controls (2026-09-06) ────────────
  "watch.controls.label": "Playback controls",
  "watch.controls.hide": "Hide playback controls (speed, ±N s)",
  "watch.controls.show": "Show playback controls (speed, ±N s)",

  // ── Watch page · capture bar ───────────────────────────────────────────
  "watch.captures.aria": "Pause points and question points",
  "watch.captures.helpAria": "What are these dots?",
  "watch.captures.help":
    "Pause points and question points. Click one to jump straight to that moment in the video and to the matching place in the chat, and your last playback position is kept as you go. (Still being built.)",
  "watch.captures.count": (n: number) => (n === 1 ? "1 point" : `${n} points`),

  // ── 中 / EN toggle (founder, 2026-09-09) ───────────────────────────────
  "lang.toggle.aria": "Interface language",
  "lang.toggle.toZh": "Switch to Simplified Chinese",
  "lang.toggle.toEn": "Switch to English",
  "lang.toggle.saveFailed":
    "Switched on this device, but we couldn't save it to your account — another device may still show the old language.",

  // ── Bottom navigation ──────────────────────────────────────────────────
  "nav.aria": "Main navigation",
  "nav.watch": "Watch",
  "nav.library": "History & knowledge",
  "nav.live": "Live lab",

  // ── Common ─────────────────────────────────────────────────────────────
  "common.settings": "Settings",
  "common.home": "Fermata home",
  "common.signOut": "Sign out",
  "common.back": "Back",

  // ── Home ───────────────────────────────────────────────────────────────
  "home.title": "Knowledge, grown slowly.",
  "home.lede":
    "Watch videos, listen to podcasts — every moment you stopped is kept. Look back later and those moments are what you know.",
  "home.toLive": "Start a conversation",
  "home.toWatch": "Find something to watch",
  "home.toLibrary": "See what I've watched →",

  // ── 404 ────────────────────────────────────────────────────────────────
  "nf.title": "This page isn't here.",
  "nf.lede":
    "It was probably deleted, or the link is incomplete. Your pause points and vocabulary are all still safe.",
  "nf.toHome": "Back to home",
  "nf.toLibrary": "Go to history & knowledge",

  // ── Settings shell ─────────────────────────────────────────────────────
  "settings.title": "Settings",
  "settings.lede":
    "Your native language, and what you're here for. Changes take effect right away — no need to sign in again.",

  // ── Supabase not configured (developers only, but still not Chinese-only) ─
  "setup.title": "One step left: connect Supabase",
  "setup.step1": "Create a project at supabase.com, then open Project Settings → API Keys",
  "setup.step2a": "Copy",
  "setup.step2b": "in the project root to",
  "setup.step2c": ", and fill in the Project URL and anon public key",
  "setup.step3a": "Run this in the Supabase SQL Editor:",
  "setup.step4": "Restart npm run dev",
  "setup.more": "Full instructions are in README.md",

  // ── Back-arrow destinations (lib/nav.ts) ───────────────────────────────
  "back.libraryItem": "Back to this item's pause points and chats",
  "back.favorites": "Back to favorites",
  "back.vocab": "Back to all vocabulary",
  "back.watchList": "Back to the watch list",
  "back.lastContent": "Back to what you were watching",
  "back.watch": "Back to Watch",
  "back.live": "Back to Live lab",
  "back.library": "Back to history & knowledge",

  // ── History & knowledge (list page) ────────────────────────────────────
  "library.name": "History & knowledge",
  "library.title": "Everything you've watched is here.",
  "library.lede":
    "Every moment you stopped to think, every word you saved — each one stays with the thing it came from.",
  "library.atomsTitle": "Knowledge atoms",
  "library.atomsHint": "Words and ideas you save while watching collect here",
  "library.atomsAria": (n: number) => (n === 1 ? "Knowledge atoms: 1 item" : `Knowledge atoms: ${n} items`),
  "library.tabByDate": "By date",
  "library.tabFolders": "Auto-sorted",
  "library.migrationNotice":
    "“When you watched it” isn't enabled yet. In Supabase → SQL Editor, run",
  "library.migrationTail":
    ". Until then everything below lands in one “time unknown” group. Nothing else is affected.",

  // ── Item detail (replay page) ──────────────────────────────────────────
  "detail.openInWatch": "Open in the player →",
  "common.untitled": "Untitled",
  "common.openOrigin": (title: string) => `Open on the original site: ${title}`,

  // ── All vocabulary ─────────────────────────────────────────────────────
  "vocab.title": "The words and ideas you kept.",
  "vocab.lede":
    "Each one remembers where it came up and how the line was said — tap it to go back to that second.",
  "vocab.count": (n: number) => (n === 1 ? "1 item" : `${n} items`),

  // ── Watch list (/watch) ────────────────────────────────────────────────
  "watch.name": "Watch",
  "watch.title": "What are we watching?",
  "watch.lede":
    "Just paste a link. Fermata only remembers the seconds you stopped at — it never downloads or stores the video.",
  "watch.tabAll": "All",
  "watch.tabFavorites": "★ Favorites",
  "watch.migrationNotice": "Some features aren't enabled yet. In Supabase → SQL Editor, run",
  "watch.migrationTail": ". Nothing else is affected.",
  "detail.watchedTimes": (n: number) => (n === 1 ? "Watched once" : `Watched ${n} times`),

  // ── Login ──────────────────────────────────────────────────────────────
  "login.aria": "Sign in",
  "login.headline1": "Make every pause",
  "login.headline2": "leave something behind.",
  "login.lede":
    "While you watch and listen, Fermata turns your curiosity into something you actually remember.",
  "login.cardTitle": "Enter your study pod",
  "login.cardHintGoogle": "No password · Google or email, your call",
  "login.cardHintEmail": "No password · just your email to confirm it's you",
  "login.tagline": "Where you pause is where you learn.",
  "login.privacy": "Privacy Policy",
  "login.terms": "Terms of Service",
  "login.emailLabel": "Your email",
  "login.sendBtn": "Send me a sign-in email",
  "login.sending": "Sending…",
  "login.googleBtn": "Continue with Google",
  "login.googleGoing": "Taking you to Google…",
  "login.orEmail": "or use email",
  "login.sentTitle": "Confirmation email is on its way",
  "login.sentSameDevice": "On this device: tap the sign-in button in the email.",
  "login.sentOtherDevice":
    "Opened the email on another device? Type the numeric code from it below.",
  "login.codePlaceholder": "Code from the email",
  "login.verifySubmit": "Sign in with the code",
  "login.verifying": "Confirming…",
  "login.changeEmail": "Use another email / resend",

  // ── Sign-in errors (D44: name which failure it was) ────────────────────
  "login.errAuth": "That sign-in link is invalid or has expired. Send yourself a new one.",
  "login.errTooFrequent": "Too many sends: security rules require 60 seconds between emails.",
  "login.errTooFrequentWait": (s: string) =>
    `Too many sends: security rules require 60 seconds between emails (about ${s}s to go).`,
  "login.errRateLimit": "This hour's email quota is used up. Try again in a little while.",
  "login.errGoogleOff": "Google sign-in is unavailable right now — use the email option below.",
  "login.errSignupsOff": "This email can't sign up yet: new registrations are turned off.",
  "login.errBadEmail": "That email address doesn't look right — check for a missing character.",
  "login.errBadCode": "Wrong or expired code. Send a new email and try again.",
  "login.errSendFailed":
    "The email couldn't be sent — that's a failure on our sending side, not a mistake in your address. Try again shortly; if it keeps happening, send us a screenshot of this message.",
  "legal.updated": "Last updated",

  // ── Import form ────────────────────────────────────────────────────────
  "import.label": "Paste a link",
  "import.placeholder": "YouTube / Xiaoyuzhou / Apple Podcasts…",
  "import.submit": "Start watching",
  "import.busy": "Importing…",
  "import.failed": "Import failed. Please try again.",
  "import.offline": "No connection — check your network and try again",
  "import.hintA": "In Apple Podcasts, open the episode and tap",
  "import.hintB":
    ", then paste the URL here. In other apps it's “Share → Copy link”. A show page or RSS feed works too — that imports the latest episode.",

  // ── Content list (lower half of /watch) ────────────────────────────────
  "list.empty": "Nothing here yet. Paste a link above to try it.",
  "list.groupPinned": "Pinned",
  "list.groupUnknown": "Date unknown",
  "list.groupToday": "Added today",
  "list.groupYesterday": "Added yesterday",
  "list.groupWeek": "Added this week",
  "list.groupOlder": "Added earlier",
  "list.pinned": "Pinned",
  "list.favorited": "Favorited",
  "list.moreActions": (title: string) => `More actions for ${title}`,
  "list.actionsAria": "Item actions",
  "list.close": "Close",
  "list.pin": "Pin",
  "list.unpin": "Unpin",
  "list.favorite": "Add to favorites",
  "list.unfavorite": "Remove from favorites",
  "list.delete": "Delete",
  "list.cancel": "Cancel",
  "list.changeFailed": "Couldn't change that. Please try again.",
  "list.changeOffline": "No connection — the change didn't go through",
  "list.deleteFailed": "Delete failed. Please try again.",
  "list.deleteOffline": "No connection — nothing was deleted",
  "list.flagsMigration": "Pinning and favorites need one run in Supabase first:",

  // ── Watch history (/library list) ──────────────────────────────────────
  "history.empty":
    "Nothing watched yet. Go to Watch, paste a link, watch a few minutes — then it shows up here.",
  "history.emptyFolders":
    "Auto-sorting isn't ready yet. Once it ships, what you've watched gets grouped into folders here.",
  "history.watchedTo": (t: string) => `Up to ${t}`,
  "history.times": (n: number) => (n === 1 ? "Watched once" : `Watched ${n} times`),
  "history.pauses": (n: number) => (n === 1 ? "1 pause point" : `${n} pause points`),
  "history.bucketToday": "Watched today",
  "history.bucketYesterday": "Watched yesterday",
  "history.bucketWeek": "Watched this week",
  "history.bucketOlder": "Watched earlier",
  "history.bucketUnknown": "Date unknown",
  "history.unknownNote":
    "These were watched before migration 0007 — back then there was no field recording when you watched. Watch one again and it moves into place.",

  // ── Vocabulary list ────────────────────────────────────────────────────
  "vlist.empty":
    "No words saved yet. Pause while watching and tap a word in the subtitles to keep it; tap a second word to keep the whole span.",
  "vlist.emptyAll":
    "Your vocabulary is still empty. Pause inside any item and tap a word in the subtitles to save it.",
  "vlist.remove": "Remove from vocabulary",
  "vlist.removeAria": (term: string) => `Remove from vocabulary: ${term}`,
  "vlist.removeFailed": "Couldn't remove it. Please try again.",
  "vlist.jumpAria": (term: string) => `Jump back to the audio: ${term}`,
  "vlist.glossMissing": "Explanation not fetched yet",
  "vlist.glossRetry": "Try again",
  "vlist.glossBusy": "Fetching explanation…",
  "vlist.glossFailed": "Still didn't come through — try again in a bit",

  // ── Playback controls (speed, ±N s) ────────────────────────────────────
  "play.back": (n: number) => `Back ${n}s`,
  "play.forward": (n: number) => `Forward ${n}s`,
  "play.stepChip": (n: number) => `${n}s jump`,
  "play.stepMenu": "Change how far each jump goes",
  "play.rateMenu": "Change playback speed",
  "play.stepHint": "How many seconds one arrow tap jumps",
  "play.rateHint": "Playback speed (slow it down if it's hard to catch)",
  "play.notStarted": "Hit play first — then these two can jump",

  // ── Capture bar (the dots) ─────────────────────────────────────────────
  "dots.next": "Jump to the next capture point",
  "dots.prev": "Jump to the previous capture point",
  "dots.deleteFailed": "Couldn't delete it. Please try again.",
  "dots.empty":
    "When something stops you, tap the floating orb — a dot lands here, and you can come back to it any time.",
  "dots.loading": (n: number) =>
    n === 1 ? "Reading the duration — the 1 point shows up in a moment." : `Reading the duration — all ${n} points show up in a moment.`,
  "dots.clusterAria": (time: string, n: number) => `${n} capture points around ${time} — open to choose`,
  "dots.jumpAria": (time: string) => `Jump back to ${time}`,
  "dots.crowded": (n: number) => `${n} points are bunched up here — pick one:`,
  "dots.jumpHere": "Jump back here",
  "dots.deleteAria": (time: string) => `Delete the point at ${time}`,

  // ── Floating capture orb ───────────────────────────────────────────────
  "orb.immersive": "Immersive chat: press and hold to close",
  "orb.ready": "Capture orb: tap to mark this moment, hold for immersive chat",
  "orb.pending": "Capture orb: subtitles still loading, hold for immersive chat",

  // ── Save button at the end of a subtitle line ──────────────────────────
  "phrase.save": "Save to vocabulary",
  "phrase.unsave": "Remove from vocabulary",
  "phrase.saveLine": "Save what's marked on this line",
  "phrase.saved": "Already in your vocabulary",

  // ── Word bubble (D46) ──────────────────────────────────────────────────
  "bubble.loading": "Looking this up…",
  "bubble.failed": "Nothing found",
  "bubble.retry": "Try again",
  "bubble.otherSenses": "Other common meanings",
  "bubble.noOther": "No other common meanings",
  "bubble.close": "Close",
} as const satisfies CopyDict;
