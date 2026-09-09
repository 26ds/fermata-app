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
} as const satisfies CopyDict;
