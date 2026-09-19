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

  // ── Watch page · the three right-rail tabs (M3.15 slice a, D61) ───────
  // Wide screens only (≥1024px). Nothing on phones changed.
  "watch.rail.aria": "Q&A workbench",
  "watch.rail.tab.chat": "Ask",
  // M3.15 slice c0 (D71): the old “Questions” tab folded in and renamed — its list is now the “Questions” filter
  "watch.rail.tab.activity": "Activity",
  "watch.rail.tab.takeaway": "Takeaway",
  "watch.rail.empty.chat":
    "Pausing no longer pops open the ask panel on wide screens — ask in the box below instead. Every question you send leaves a dot on the timeline.",
  "watch.rail.empty.takeaway":
    "Key points from each answer show up here; tick one to add it to your notes. Generated only when you open this tab, so ignoring it costs nothing (not built yet).",
  "watch.rail.capture": "Just mark this moment",
  "watch.rail.capturing": "Marking…",

  // ── Watch page · the Ask rail itself (M3.15 slice b, D61/D62) ──────────
  "watch.qa.placeholder": "Ask about this moment…",
  "watch.qa.send": "Send",
  "watch.qa.thinking": "Thinking…",
  "watch.qa.jumpTo": (at: string) => `Jump to ${at}`,
  "watch.qa.followUpAria": "Follow-up",
  "watch.qa.backTo": (at: string) => `Back to ${at}`,
  "watch.qa.backDismiss": "No need to go back",
  "watch.qa.toLatest": "Back to latest",
  "watch.qa.retry": "Try again",
  "watch.qa.why": "Why is that",
  "watch.qa.whyQ": "Why is that?",
  "watch.qa.relation": "How does it relate",
  "watch.qa.relationQ": "How does this relate to the part he just covered?",
  "watch.qa.shorter": "Say it shorter",
  "watch.qa.shorterGoing": "Shortening…",
  "watch.qa.shorterBack": "Show the long one",
  "watch.qa.shorterTag": "Short",
  "watch.qa.shorterFailed": "The short version didn't come through — tap to try again",
  "watch.qa.look": "Look at the video",
  "watch.qa.lookTitle":
    "Let the AI watch the ~12 seconds around this moment and answer again — costs a little more, takes a few seconds",
  "watch.qa.lookGoing": (s: number) => `Watching the video… ${s}s`,
  "watch.qa.lookTag": (from: string, to: string) => `Looked at the video · ${from}–${to}`,
  "watch.qa.captionsTag": "Subtitles only",
  "watch.qa.lookShowCaptions": "Show the subtitles-only answer",
  "watch.qa.lookShowVisual": "Show the video answer",
  "watch.qa.lookFailed": "The video answer didn't come through — tap to try again",
  "watch.qa.refsAria": "Elsewhere in this video",
  "watch.qa.refLater": "Later",
  "watch.qa.refEarlier": "Earlier",
  "watch.qa.refJump": (at: string) => `Jump to ${at} (summary card)`,
  "watch.qa.refUnverified": "I couldn't find this line in the captions — the AI may have misremembered it.",
  "watch.qa.oldTitle": "From your earlier immersive chats",
  "watch.qa.oldHint": "Read-only — these predate this rail, so you can't follow up on them here.",

  // ── Watch page · the “Activity” tab (M3.15 slice c0, D71) ─────────────
  "act.watched": (watched: string, total: string, pct: number) => `Watched ${watched} of ${total} (${pct}%)`,
  "act.watchedUnknown": "Watched: duration not known yet",
  "act.filterAria": "Show",
  "act.filter.all": "All",
  "act.filter.asks": "Questions",
  "act.most": "Rewatched most",
  "act.times": (n: number) => ` (${n}×)`,
  "act.skipped": "Skipped",
  "act.listSep": ", ",
  "act.segWatched": (n: number) => (n === 1 ? "watched once" : `watched ${n}×`),
  "act.segUnwatched": "not watched",
  "act.legend1": "1×",
  "act.legend2": "2×",
  "act.legend3": "3×+",
  "act.legendNow": "now",
  "act.momentAria": (at: string, n: number) => (n === 1 ? `1 question asked at ${at}` : `${n} questions asked at ${at}`),
  "act.orderAria": "Order questions",
  "act.order.video": "By video time",
  "act.order.asked": "By time asked",
  "act.visitNow": "this visit",
  "act.earlier": "Earlier · before activity was recorded",
  "act.watchedFor": (d: string) => `watched ${d}`,
  "act.rate": (r: string) => ` (${r}×)`,
  "act.bg": " (in the background)",
  "act.pausedAt": "Paused at",
  "act.pausedFor": (d: string) => `paused ${d}`,
  "act.left": (d: string) => `Left the page for ${d}`,
  "act.via.playerYoutube": "on the YouTube player",
  "act.via.playerPodcast": "on the podcast player",
  "act.via.atLink": (at: string) => `tapped @${at} in Ask`,
  "act.via.back": (at: string) => `tapped “Back to ${at}”`,
  "act.via.dots": "tapped a point on the capture bar",
  "act.via.dotsNav": (n: number) => (n > 1 ? `◀ ▶ on the capture bar ×${n}` : "◀ ▶ on the capture bar"),
  "act.via.caption": "tapped a caption line",
  "act.via.step": (step: string, n: number) => (n > 1 ? `${step}s ×${n}` : `${step}s`),
  "act.via.record": "tapped a time in Activity",
  "act.via.card": "tapped a summary card",
  "act.quote": (q: string) => `“${q}”`,
  "act.noAnswer": "(this question wasn't answered)",
  "act.openTurn": (q: string) => `Open this turn in Ask: ${q}`,
  "act.captured": "marked this moment",
  "act.dur": (h: number, m: number, s: number) =>
    h > 0 ? `${h}h ${m}m` : m > 0 ? (s > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${m} min`) : `${s}s`,
  "act.empty":
    "From now on, every play, jump, pause and question in this video is logged here in order — every time is clickable. Earlier viewing can't be recovered.",
  "act.emptyAsks": "No questions asked in this video yet.",
  "act.unsaved": (n: number) => `${n} not saved yet — retrying automatically`,
  "act.unsavedAuth": (n: number) => `Your session expired — ${n} can't be saved. Reload the page and sign in again.`,
  "act.missingTable":
    "Activity can't be saved yet: the database table is missing (migration 0012 hasn't been run). This visit's log lives only on this page and is gone when you close it.",
  "act.dropped": (n: number) => `${n} entries were malformed and not saved (a bug on our side, not yours)`,
  "act.loadFailed": "Couldn't load earlier activity — this visit is still being recorded.",
  "act.capped": (n: number) => `Too many entries — showing the latest ${n}`,
  "err.watchEventsMissing":
    "Activity can't be saved: the database table doesn't exist yet (migration 0012 hasn't been run)",
  // ── 中 / EN toggle (founder, 2026-09-09) ───────────────────────────────
  "lang.toggle.aria": "Interface language",
  "lang.toggle.toZh": "Switch to Simplified Chinese",
  "lang.toggle.toEn": "Switch to English",
  "lang.toggle.saveFailed":
    "Switched on this device, but we couldn't save it to your account — another device may still show the old language.",
  "lang.toggle.switching": "Switching interface language…",

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

  // ── Settings · Account ─────────────────────────────────────────
  "settings.account.title": "Account",
  "settings.account.signedInAs": "Signed in as",
  "settings.account.switch": "Switch account",
  "settings.account.switching": "Signing out…",
  "settings.account.google": "Use a Google account",
  "settings.account.googleGoing": "Opening Google…",
  "settings.account.hint":
    "“Switch account” signs you out and takes you back to the sign-in page — that is also how you sign out. Your pause points and vocabulary stay with the account you left; sign back in and they are all there.",
  "settings.account.errSignOut": "Couldn't sign you out — you may be offline. Tap it once more.",
  "settings.account.errGoogle":
    "Couldn't reach Google — you may be offline, or Google sign-in was just switched off in the back office. “Switch account” still gets you in by email.",

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

  // ── Pause-point replay ─────────────────────────────────────────────────
  "pause.tagAsked": "Asked",
  "pause.tagAnswered": "Answered",
  "pause.tagStoppedAt": "Stopped on",
  "pause.justStopped": "Just paused here",
  "pause.deleteFailed": "Couldn't delete it. Please try again.",
  "pause.heading": "replay / pause points",
  "pause.collapse": "Collapse ⌃",
  "pause.expand": (n: number) => `Expand ⌄ ${n}`,
  "pause.chatRow": (n: number) => (n === 1 ? "1 exchange about this" : `${n} exchanges about this`),
  "pause.chatOpen": "Open →",
  "pause.empty":
    "You haven't paused on this one yet. While watching, tap the orb at the bottom right — every moment you stop lands here.",
  "pause.jumpAria": (time: string) => `Jump back to ${time}`,
  "pause.toggleAria": (open: string, time: string) => `${open} the full exchange at ${time}`,
  "pause.toggleOpen": "Expand",
  "pause.toggleClose": "Collapse",
  "pause.deleteAria": (time: string) => `Delete the pause point at ${time}`,
  "pause.youAsked": "You asked:",

  // ── Item detail (replay) ───────────────────────────────────────────────
  "detail.tabPauses": "Pauses & chats",
  "detail.tabVocab": "Vocabulary",
  "detail.emptyPauses":
    "You haven't paused on this one yet. Open it in the player and tap the orb at the bottom right — every moment you stop lands here.",
  "detail.dayToday": "Today · that session",
  "detail.dayYesterday": "Yesterday · that session",
  "detail.dayUnknown": "Date unknown · that session",
  "detail.dayOn": (date: string) => `${date} · that session`,

  // ── Tap-to-select a span (D45 / M3.10) ─────────────────────────────────
  "sel.take": "Save it",
  "sel.drop": "In vocabulary · remove",
  "sel.cancel": "Cancel",
  "sel.hint": "Tap another word to select all the way to it",
  "sel.word": (word: string) => `Selected “${word}”`,
  "sel.saved": "Saved to vocabulary",
  "sel.glossBusy": "Looking up what this means…",
  "sel.glossFailed": "Couldn't find a meaning",
  "sel.glossRetry": "Try again",
  "sel.glossDismiss": "Dismiss",

  // ── Caption layer ──────────────────────────────────────────────────────
  "cap.title": "captions",
  "cap.pickHint":
    "Tap a word to save it (then hover or long-press to see what it means) · tap the timestamp to jump to that line",
  "cap.follow": "Following",
  "cap.noFollow": "Not following",
  "cap.hide": "Hide",
  "cap.show": "Show",
  "cap.jumpAria": (time: string) => `Jump to ${time}`,

  "cap.ytStep1a": "Open this video in a desktop browser → below the video, “",
  "cap.ytStep1b": "” → “",
  "cap.ytStep1More": "...more",
  "cap.ytStep1Show": "Show transcript",
  "cap.ytStep1c": "”",
  "cap.ytStep2a": "In the transcript panel that opens,",
  "cap.ytStep2Copy": "select all and copy",
  "cap.ytStep3a": "Come back here and",
  "cap.ytStep3Paste": "paste",
  "cap.ytStep3b": "the whole thing into the “Paste subtitles” box",

  "cap.retryAnyway": "Retry anyway",
  "cap.retry": "Retry",
  "cap.resume": "Resume",
  "cap.generate": "Generate subtitles",
  "cap.pasteYt": "Paste subtitles",
  "cap.pasteManual": "Paste manually",
  "cap.generating": (pct: string) => `Generating${pct}`,
  "cap.generatingLong": (pct: string) => `Generating subtitles${pct}The first stretch lands in about twenty seconds.`,
  "cap.cancel": "Cancel",
  "cap.saving": "Saving…",
  "cap.save": "Save these subtitles",
  "cap.none": "No subtitles yet.",
  "cap.tailNote": "There's still an untranscribed stretch after this.",

  "cap.pasteYtLead":
    "If it has captions (CC), pasting them in is free. (There's no “Show transcript” on mobile — do this on a computer.)",
  "cap.pasteYtTail":
    "Takes YouTube's “timestamp + text” format, and .srt / .vtt too. On a phone, just use “Generate subtitles”.",
  "cap.pasteManualLeadA": "Paste the whole .srt or .vtt contents here (it needs timings like",
  "cap.pasteManualLeadB": "). When auto-transcription won't cooperate, this is always the last road that works.",
  "cap.pastePlaceholderYt": "0:00\nFirst line\n0:04\nSecond line",
  "cap.pastePlaceholderSrt": "1\n00:00:00,000 --> 00:00:03,200\nFirst line",
  "cap.parseFailed":
    "Couldn't recognise a single subtitle line. It can be what you copied from YouTube's “Show transcript” (timestamps + text), or the contents of a .srt / .vtt file.",
  "cap.saveFailed": "Nothing was saved. Please try again.",
  "cap.deadEndLead":
    "But if you can open this video, the subtitles are right there — fetch them yourself and they work just the same. (No “Show transcript” on mobile — do this on a computer.)",
  "cap.hintGenerateA": "Tap",
  "cap.hintGenerateBtn": "“Generate subtitles”",
  "cap.hintGenerateB":
    " to make them automatically (about twenty seconds). On a computer, if the video has CC, “Paste subtitles” gets them for free.",

  "cap.scanLabel": "AI word marking",
  "cap.scanOn": "Turn on AI word marking and scan this one now",
  "cap.scanOff": "Turn off AI word marking",
  "cap.scanRunning": "Scanning this one…",
  "cap.scanIsOn": "On — worthwhile words get marked for you",
  "cap.scanIsOff": "Off (turning it on costs money; each item is scanned once)",

  "cap.size": "Size",
  "cap.sizeAria": "Subtitle text size",
  "cap.translation": "Translation",
  "cap.translationAria": "Translation language",
  "cap.translationOff": "Off",
  "cap.sameLangSuffix": " (original — nothing to translate)",
  "cap.flipAria": "Swap which of original and translation is larger",
  "cap.flipToTr": "Translation larger ⇅",
  "cap.flipToOrig": "Original larger ⇅",
  "cap.trOnlyCurrent": "Current line only",
  "cap.trEveryLine": "Every line",
  "cap.translating": (pct: string) => `Translating${pct}`,
  "cap.trNoResponse": "The translation service didn't respond",
  "cap.trSameLang": "This content is already in that language.",
  "cap.trFailed": "Translation didn't go through. Try again shortly.",
  "cap.trReload": "Reload translation",
  "cap.trPartial": (done: number, total: number) =>
    `Only ${done} of ${total} lines are translated — press ↻ (Reload translation) to finish`,

  // ── Watch stage ────────────────────────────────────────────────────────
  "stage.noPlayer": (kind: string) => `There's no player for this kind of content (${kind}) yet.`,
  "stage.playing": "Playing",
  "stage.paused": "Paused",
  "stage.capReady": "Subtitles ready",
  "stage.capRunning": "Making subtitles",
  "stage.capFailed": "Subtitles didn't come through",
  "stage.capPartial": "Subtitles half done",
  "stage.capPending": "Subtitles not made yet",
  "stage.positionAria": "Playback position",
  "stage.splitterAria": "Drag to resize video and study area; double-click to reset",
  "stage.captureFailed": "That wasn't saved. Please try again.",
  "stage.captureLost": "This moment wasn't saved — ask again in a second",
  "stage.answerFailed": "No answer came back. Try again shortly.",
  "stage.transcribeFailed": "Subtitles didn't come through. Try again shortly.",
  "stage.transcribeFailedShort": "Subtitles didn't come through",
  "stage.deleteFailed": "Couldn't delete it. Please try again.",

  // ── Interrupt panel ────────────────────────────────────────────────────
  "panel.stuckAt": "Stuck at",
  "panel.askHint": "Ask something — I'll answer with these subtitle lines in hand.",
  "panel.lastTwoSeconds": "The last two seconds",
  "panel.pickHint": "Tap a word to save it · saved words are the ones you can look up",
  "panel.noCaptionHere": "No subtitles around this moment.",
  "panel.collapse": "Tap to collapse and read the subtitles",
  "panel.expand": "Expand",
  "panel.expandLabel": "Expand the panel",
  "panel.close": "Close",
  "panel.collapsedAria": "Interrupt panel (collapsed)",
  "panel.backToPick": "Back to picking words from those two seconds",
  "panel.askShort": "Ask",
  "panel.addWord": "＋word",
  "panel.chat": "Immersive chat",
  "panel.rescan": "Scan again",
  "panel.placeholder": "What's going on here? What does this word mean?",
  "panel.thinking": "Thinking…",
  "panel.send": "Send",
  "panel.immersiveTitle": "Long-form immersive chat",
  "panel.immersiveHint": "Lots of questions? Come in and keep going — I'll answer from where you are.",
  "panel.justCapture": "Just mark this moment, no question",
  "panel.done": "Done",
  "panel.cancel": "Cancel",
  "panel.saveFailed": "That wasn't saved. Please try again.",

  "panel.scanOff": "AI word marking is off — the switch is in the “captions” row below.",
  "panel.scanScanning": "Marking the expressions worth keeping in this one…",
  "panel.scanReady": (n: number) =>
    n === 1 ? "1 marked across the whole thing, and in the subtitles below too" : `${n} marked across the whole thing, and in the subtitles below too`,
  "panel.scanEmpty": "Scanned the whole thing — nothing worth marking.",
  "panel.scanNotReady": "Not enough subtitles yet. Come back once more has been transcribed.",
  "panel.scanRunning": "The last scan hasn't finished (or it's stuck).",
  "panel.scanFailed": "That scan didn't go through.",

  "panel.driftMode": "You changed your language settings — this batch was marked under the old ones.",
  "panel.driftSupport":
    "You changed your native language — these explanations are still written in the previous one.",
  "panel.driftRescan": "Rescan with the new settings",

  "panel.targetTitle": (lang: string) => `This content is in ${lang}.`,
  "panel.targetQuestion": "Are you here to learn this language, or just to understand the content?",
  "panel.targetLearn": (lang: string) => `I want to learn ${lang}`,
  "panel.targetJustContent": "Just here for the content",

  // ── Quick questions ────────────────────────────────────────────────────
  // ⚠️ `quick.*Q` is the actual message sent to the model — it shows up in the
  // chat as “You asked: …”, so it must be in the reader's own language.
  "quick.explainLabel": "Explain this part",
  "quick.explainHint": "Lost the whole stretch",
  "quick.explainQ": "Explain what was just said a bit more clearly — I lost the thread.",
  "quick.wordLabel": "A word I didn't catch",
  "quick.wordHint": "Stuck on one word",
  "quick.wordQ":
    "Were there any difficult words or jargon in what was just said? Pick them out and explain them.",

  // ── Immersive chat ─────────────────────────────────────────────────────
  "chat.aria": "Long-form immersive chat",
  "chat.paletteLabel": "Change the glow colors",
  "chat.paletteAria": (name: string) => `Palette: ${name}`,
  "chat.fontLabel": "Text size",
  "chat.fontHint": "Size",
  "chat.empty": "What's on your mind? I'll pick up from where you are.",
  "chat.thinking": "Thinking…",
  "chat.toLatest": "Back to latest ↓",
  "chat.placeholder": "Ask another…",
  "chat.send": "Send",
  "chat.exitHint": "Press and hold the orb to leave",
  "chat.answerFailed": "No answer came back. Try again shortly.",
  "chat.glowAurora": "Aurora",
  "chat.glowBamboo": "Bamboo",
  "chat.glowDusk": "Dusk",
  "chat.glowNebula": "Nebula",
  "chat.glowInk": "Ink",
  "chat.fsS": "S",
  "chat.fsM": "M",
  "chat.fsL": "L",
  "chat.fsXL": "XL",

  // ── Live voice lab ─────────────────────────────────────────────────────
  "live.notReadyTitle": "Live isn't ready yet",
  "live.notReadyBodyA": "The server doesn't have",
  "live.notReadyBodyB": " configured yet. Once it does, you can talk to your study partner right here.",
  "live.notReadyHint":
    "Create an API key in Google AI Studio, add it to Vercel's Environment Variables, and redeploy.",
  "live.title": "Have a chat with your study partner.",
  "live.statusIdle": "Idle",
  "live.statusConnecting": "Connecting",
  "live.statusEnded": (clock: string) => `Ended ${clock}`,
  "live.interrupts": (n: number) => `${n} interruptions`,
  "live.latency": (s: string) => `${s}s to reply`,
  "live.listeningAria": "Listening",
  "live.listening": "Listening · jump in any time",
  "live.captionsTitle": "live captions",
  "live.waitingFirst": "Waiting for the first line",
  "live.turns": (n: number) => (n === 1 ? "1 turn" : `${n} turns`),
  "live.emptyLive":
    "Go ahead and talk — mix languages freely. What you're saying floats under the orb above and lands here once you finish a sentence. Cut in while it's mid-answer to feel the interruption.",
  "live.emptyIdle":
    "Tap the button below to start. Allow microphone access — headphones work best.",
  "live.roleYou": "you",
  "live.roleAssistant": "fermata / study partner",
  "live.interrupted": "(interrupted)",
  "live.sendTextLabel": "Send text",
  "live.textPlaceholder": "You can type instead…",
  "live.send": "Send",
  "live.end": "End this conversation",
  "live.voice": "voice",
  "live.connecting": "Connecting…",
  "live.restart": "Start this conversation over",
  "live.start": "Start talking",
  "live.reclaim": "The server is about to reclaim the connection — reconnecting seamlessly…",
  "live.reconnecting": (n: number) => `Connection dropped — reconnect attempt ${n}…`,
  "live.closedWith": (reason: string) => `Connection closed: ${reason}`,
  "live.closed": "The connection dropped. Tap “Start over” for another round.",
  "live.connError": "Connection error",
  "live.errMicDenied":
    "Microphone access was denied. On iPhone: Settings → Safari (or the app) → Microphone → Allow. On a computer: click the lock icon at the left of the address bar and allow the microphone.",
  "live.errNoMic": "No microphone found.",
  "live.errQuota": "Gemini's free quota is used up for now. Try again in a few minutes.",
  "live.errNoModel": (msg: string) =>
    `That model doesn't exist or has been retired: ${msg} (set GEMINI_LIVE_MODEL in Vercel to pick another).`,
  "live.voicePuck": "Puck · male-leaning, lively",
  "live.voiceCharon": "Charon · male-leaning, deep",
  "live.voiceFenrir": "Fenrir · male-leaning, punchy",
  "live.voiceOrus": "Orus · male-leaning, firm",
  "live.voiceKore": "Kore · female-leaning, steady",
  "live.voiceAoede": "Aoede · female-leaning, bright",
  "live.voiceLeda": "Leda · female-leaning, youthful",
  "live.voiceZephyr": "Zephyr · female-leaning, clear",
  "live.tokenFailed": (code: number) => `The token endpoint returned ${code}`,

  // ── API errors (`src/app/api/**`) ──────────────────────────────────────
  "err.noSupabase": "Supabase isn't configured",
  "err.needLogin": "Please sign in first",
  "err.badRequest": "Invalid request parameters",
  "err.badFormat": "Malformed request",
  "err.noSource": "Couldn't find that item",
  "err.sourceMissing": "That item doesn't exist",
  "err.noInterrupt": "That pause point doesn't exist",
  "err.noInterruptPoint": "Couldn't find that pause point",
  "err.noAtom": "Couldn't find that word",
  "err.needUrl": "Paste a link first",
  "err.needQuestion": "Write your question first",
  "err.needSourceId": "Missing item id",
  "err.missingSourceId": "Missing sourceId",
  "err.nothingToUpdate": "No fields to update",
  "err.noCaptionsAsk": "This item has no subtitles yet — generate them first, then ask.",
  "err.noCaptionsChat": "This item has no subtitles yet — generate them first, then chat.",
  "err.chatCreateFailed": "Couldn't start the conversation. Please try again.",
  "err.answerFailed": (detail: string) => `Something went wrong while answering: ${detail}`,
  "err.lookNotVideo": "Only YouTube videos can be looked at.",
  "err.lookUnreadable":
    "The AI can't watch this video — only public YouTube videos work (not unlisted, private, members-only or region-locked). Your subtitles-only answer is still here.",
  "err.lookNotSaved": "This answer wasn't saved — it will be gone after a reload.",
  "err.lookNotSavedDb": "This answer wasn't saved (the server's database hasn't been upgraded yet) — it will be gone after a reload.",
  "err.answerNotSaved": "This answer wasn't saved — it will be gone after a reload.",
  "err.answerNotSavedDb": "This answer wasn't saved (the server's database hasn't been upgraded yet) — it will be gone after a reload.",
  "err.glossTimeout": "Fetching the explanation timed out (no reply in 20 seconds).",
  "err.glossFailed": "Something went wrong fetching the explanation.",
  "err.lookupTimeout": "Looking up that word timed out.",
  "err.lookupFailed": "Something went wrong looking up that word.",
  "err.atomSaveFailed": "It wasn't saved to your vocabulary. Please try again.",
  "err.interruptSaveFailed": "That wasn't saved. Please try again.",
  "err.phraseScanFailed": "No phrases came out of this scan. Try again shortly.",
  "err.unknownLink":
    "That link isn't recognised yet. Right now we support YouTube videos, podcast RSS feeds, and direct audio links.",
  "err.upstreamTimeout": "The other server didn't respond. Try again in a bit.",
  "err.saveFailed": "Saving failed. Please try again.",
  "err.noGeminiKey": "The server doesn't have GEMINI_API_KEY configured",
  "err.noGeminiKeyHint":
    "The server doesn't have GEMINI_API_KEY configured (Vercel → Settings → Environment Variables)",
  "err.emptyToken": "Gemini returned an empty token. Please try again shortly.",
  "err.badGeminiKey":
    "GEMINI_API_KEY is invalid: copy it again from aistudio.google.com, and watch out for stray spaces",
  "err.geminiQuota": "Gemini's free quota is used up for now. Try again in a few minutes.",
  "err.allTranscriptSourcesFailed":
    "None of the subtitle sources worked. You can paste subtitles in by hand, or try again later.",
  "err.translateFailed": (detail: string) => `Something went wrong while translating: ${detail}`,
  "err.badTargetLang": "Unsupported target language",
  "err.noCaptionsTranslate":
    "This item has no subtitles yet — generate them first, then translate.",
  "err.sameLangNoTranslate": (lang: string) =>
    `I read this content as already being in ${lang}, the same language you picked — so nothing was translated, and nothing was charged for it.`,
  "err.alreadyThatScript": (lang: string) => `The subtitles you're looking at are already ${lang}.`,
  "err.noTranscriberFor": (kind: string) => `Subtitles aren't wired up for this kind of content (${kind}) yet`,
  "err.tooLong":
    "This item is over 4 hours long, so it isn't auto-transcribed for now — you can paste subtitles in by hand.",
  "err.providerFellBack": (name: string) => `${name} didn't work — trying the next one`,
  "err.compactFailed": "Something went wrong condensing this conversation. Try again shortly.",
  "skeleton.recent": "Recently added",
  "skeleton.player": "Player",
  "skeleton.preparingPlayer": "Getting the player ready…",

  // ── Site metadata (browser tab / PWA install name) ─────────────────────
  "meta.description": "An active learning layer for the age of video — where you pause is where you learn",
  "meta.descriptionShort": "An active learning layer for the age of video",

  // ── Podcast player ─────────────────────────────────────────────────────
  "podcast.untitled": "Untitled show",
  "podcast.play": "Play",
  "podcast.pause": "Pause",
  "podcast.progress": "Playback progress",

  // ── Podcast import failures we can actually name ───────────────────────
  "podcast.errFetch": (code: number) => `That link wouldn't open (${code}). Double-check it and try again.`,
  "podcast.errNotFeed":
    "That link isn't a podcast feed (RSS). In your podcast app, look for “Copy RSS address” — or paste a direct .mp3 link.",
  "podcast.errNoAudio": "No playable audio in that feed (no enclosure)",
  "podcast.errTooOld":
    "That episode is too old for Apple's API to reach (it only returns the most recent two hundred). Paste the show's RSS address and it'll import.",
  "podcast.errAppleLookup":
    "Nothing came back for that Apple Podcasts link. Check that the link is complete, or paste the show's RSS address.",
  "podcast.errNoEpisode":
    "No playable episode on that page. If it's a show's home page, open **one episode** and copy that link instead — or paste the show's RSS address.",

  // ── Translation service ────────────────────────────────────────────────
  "err.noGeminiKeyTranslate": "The server doesn't have GEMINI_API_KEY configured, so translation is unavailable.",
} as const satisfies CopyDict;
