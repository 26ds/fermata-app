// M3.9 片 b —— 简体中文文案。**这一份是 key 的来源**（`CopyKey = keyof typeof zh`）。
//
// 规矩三条：
//   ① key 命名 `<区域>.<意思>`，扁平，不搞嵌套 —— 嵌套读起来像目录，查起来要跳三层。
//   ② 值是字符串，或者**吃参数的函数**（`(n) => \`标出 ${n} 个\``）。
//      不要在调用处拼字符串 —— 语序在别的语言里会变（英文的 "3 words found" 和中文的
//      "标出 3 个词" 参数位置不同），拼在外面就没法翻。
//   ③ **搬家就是搬家**：从组件里挪过来的中文一个字都不改。想改文案，本片之外单提。
//
// D24：这份是纯数据，客户端要 import 它，一行服务端依赖都不许有。

export const zh = {
  // ── 母语猜测横幅（M3.9 片 a，D42 修订① / D44）──────────────────────────
  // ⚠️ 这三条**不用界面语言渲染，用「猜出来的那门母语」渲染**（见 lang-guess-banner.tsx）。
  // 用他看不懂的语言告诉他"我可能猜错了你的语言"，是这件事最荒谬的失败方式。
  "lang.guess.lead": (label: string) => `你的母语现在是「${label}」，是照你设备的语言自动填的。`,
  "lang.guess.cta": "不对就去改",
  "lang.guess.close": "知道了，别再提",

  // ── 设置页 · 语言那一块 ────────────────────────────────────────────────
  "settings.lang.title": "语言",
  "settings.lang.saved": "已保存",
  "settings.lang.native": "我的母语",
  "settings.lang.nativeHint": "AI 用它解释、译文译成它",
  "settings.lang.target": "我想学的语言",
  "settings.lang.targetHint": "留空 = 我只想搞懂内容，不是来学语言的",
  "settings.lang.targetUnset": "还没定（看到非母语内容时会问你一次）",
  "settings.lang.targetNone": "不学语言，只想搞懂内容",
  "settings.lang.ui": "界面语言",
  "settings.lang.uiFollowNative": "跟着我的母语",
  "settings.lang.uiHint": "界面暂时只有简体中文和英文两套人工写的文案。",
  // 下面三条是 D44 的落地：**当场说清楚现在落到了哪一种**，而不是笼统写一句
  // 「其余语言会用英文」。2026-08-05 创始人真机反馈：他把母语换成别的语言，
  // 界面一直是英文，**看不出这是设计还是坏了** —— 那就等于坏了。
  "settings.lang.uiFollow": (label: string) => `跟着母语走，现在是${label}。`,
  "settings.lang.uiFallback": (native: string, actual: string) =>
    `界面还没有「${native}」的文案，所以现在显示的是${actual}。`,
  "settings.lang.uiFixed": (label: string) => `固定用${label}，不跟母语变。`,
  // ⏳ **临时的，M3.9 片 f 做完要连同 en.ts 那条一起删掉。**
  // 开关现在只改得动两块（这张卡 + 母语提示），其余界面还硬编码着中文。
  // 片 a 拒绝提前摆这个开关的理由是「选了没反应就是骗人」——
  // 「选了只有一部分有反应」是同一条线上浅一格，**写出来才不算骗**。
  "settings.lang.uiPartial": "界面正在逐页搬家 —— 现在只有这一块和母语提示会跟着变。",

  // ── 观看页 · 播放控制条的折叠开关（创始人 2026-09-06）──────────────────
  // 只在宽屏出现。折叠之后那张卡（状态 + 时间 + 倍速 + ±N 秒）整个收起来，
  // 「捕获点」那一行往上顶，底下腾出来的地方将来是聊天的。
  "watch.controls.label": "播放控制",
  // D44 的脾气：**点之前就说清楚会发生什么**，别只给一个箭头
  "watch.controls.hide": "收起播放控制（倍速、±N 秒）",
  "watch.controls.show": "展开播放控制（倍速、±N 秒）",

  // ── 观看页 · 点点条（创始人 2026-09-06：标题拿掉，改成一个问号）────────
  // 原来那行 `CAPTURES / 捕获点` 占着一整行只为说一个名字。名字改成问号里的
  // 一句人话，行让给内容。**读屏的人靠 aria 拿到同一个名字**，不是把它删了。
  "watch.captures.aria": "暂停点和问答点",
  "watch.captures.helpAria": "这些点是什么？",
  // 创始人 2026-09-06 亲自写的这句，**照抄**（含末尾那句"功能开发中"——
  // 跳到对应聊天位置还没做，D44：没做的事不许在提示里说得像做好了）
  "watch.captures.help":
    "暂停点和问答点，点击以后直接跳转到视频对应位置的时长以及对应聊天位置，并且实时记录最后播放的进度点（功能开发中）",
  "watch.captures.count": (n: number) => `${n} 个`,

  // ── 中 / EN 一键切换（创始人 2026-09-09）────────────────────────────────
  // 「中」「EN」两个标签本身**不进表**：语言开关必须用各自的语言写自己
  // （endonym）—— 写成「英文」，只读英文的人就认不出那是给他的了。
  "lang.toggle.aria": "界面语言",
  "lang.toggle.toZh": "切换到简体中文",
  "lang.toggle.toEn": "切换到 English",
  // D44：说得出是哪一种失败。界面**确实已经切了**（cookie 那层生效了），
  // 没成的只是"记进账号"这一半 —— 别把两件事混成一句笼统的"失败了"
  "lang.toggle.saveFailed": "这台设备已经切好了，但没能存进你的账号 —— 换台设备可能还是原来的语言。",

  // ── 底部导航（D37 三分）────────────────────────────────────────────────
  "nav.aria": "主要导航",
  "nav.watch": "观看",
  "nav.library": "历史与知识库",
  "nav.live": "Live 实验",

  // ── 通用 ────────────────────────────────────────────────────────────────
  "common.settings": "设置",
  "common.home": "Fermata 首页",
  "common.signOut": "退出登录",
  "common.back": "返回",

  // ── 首页（门脸）────────────────────────────────────────────────────────
  "home.title": "知识，慢慢长出来。",
  "home.lede": "看视频、听播客，停下来的每一刻都被记着。回头看的时候，它们就是你的知识。",
  "home.toLive": "开始一次对话",
  "home.toWatch": "去看点什么",
  "home.toLibrary": "看看我看过什么 →",

  // ── 404 ─────────────────────────────────────────────────────────────────
  "nf.title": "这一页找不到了。",
  "nf.lede": "多半是这条内容已经被删掉，或者链接不完整。你攒下的暂停点和词库都还在。",
  "nf.toHome": "回首页",
  "nf.toLibrary": "去历史与知识库",

  // ── 设置页外壳 ──────────────────────────────────────────────────────────
  "settings.title": "设置",
  "settings.lede": "母语，和你看这些东西是为了什么。改完立刻生效，不用重新登录。",

  // ── 没配 Supabase 时的引导（开发者才看得到，但不能因此说中文）──────────
  "setup.title": "还差一步：连接 Supabase",
  "setup.step1": "在 supabase.com 创建项目，打开 Project Settings → API Keys",
  "setup.step2a": "把项目根目录的",
  "setup.step2b": "复制为",
  "setup.step2c": "，填入 Project URL 和 anon public key",
  "setup.step3a": "在 Supabase SQL Editor 里运行",
  "setup.step4": "重启 npm run dev",
  "setup.more": "详细步骤见 README.md",

  // ── 返回箭头的去处（lib/nav.ts）────────────────────────────────────────
  // 图标只有一个 ←，「退到哪儿」全靠这句读屏文字说清楚。
  // **存 key 不存字符串**：nav.ts 是纯函数、拿不到用户语言，
  // 让它返回 key、由调用处翻，类型闸门就顺带把这几条也罩住了。
  "back.libraryItem": "返回这条内容的暂停点与聊天",
  "back.favorites": "返回收藏列表",
  "back.vocab": "返回全部词库",
  "back.watchList": "返回观看列表",
  "back.lastContent": "返回刚才那条内容",
  "back.watch": "返回观看",
  "back.live": "返回 Live 实验",
  "back.library": "返回历史与知识库",

  // ── 历史与知识库（列表页）──────────────────────────────────────────────
  "library.name": "历史与知识库",
  "library.title": "你看过的，都在这儿。",
  "library.lede": "停下来想过的每一刻、存下来的每一个词，都跟着它那条内容。",
  "library.atomsTitle": "知识原子",
  "library.atomsHint": "看的时候存下来的词和概念，会长在这里",
  "library.atomsAria": (n: number) => `知识原子：${n} 条`,
  "library.tabByDate": "按日期",
  "library.tabFolders": "智能分类",
  "library.migrationNotice": "「什么时候看的」还没启用：去 Supabase → SQL Editor 跑一次",
  "library.migrationTail": "。跑之前，下面这些会全落在「时间不详」一组，其余功能不受影响。",

  // ── 内容详情（回看页）──────────────────────────────────────────────────
  "detail.openInWatch": "在观看页打开 →",
  "common.untitled": "未命名内容",
  "common.openOrigin": (title: string) => `在原网站打开：${title}`,

  // ── 全部词库 ────────────────────────────────────────────────────────────
  "vocab.title": "你收下的词与概念。",
  "vocab.lede": "每一条都记得它出现在哪、那句话原本怎么说 —— 点一下就回到那一秒。",
  "vocab.count": (n: number) => `${n} 条`,

  // ── 观看列表（/watch）──────────────────────────────────────────────────
  "watch.name": "观看",
  "watch.title": "看点什么？",
  "watch.lede": "贴一条链接就行。Fermata 只记住「你在第几秒停下来过」，不下载、不存视频。",
  "watch.tabAll": "全部",
  "watch.tabFavorites": "★ 收藏",
  "watch.migrationNotice": "有功能还没启用：去 Supabase → SQL Editor 跑一次",
  "watch.migrationTail": "。其余功能不受影响。",
  "detail.watchedTimes": (n: number) => `看过 ${n} 次`,

  // ── 登录页 ──────────────────────────────────────────────────────────────
  // 这是**外国人看到的第一屏**，也是唯一一个不登录就能看到的产品界面。
  "login.aria": "登录",
  "login.headline1": "让每一次停留，",
  "login.headline2": "都留下点什么。",
  "login.lede": "看视频、听播客的时候，Fermata 帮你把好奇心变成记得住的东西。",
  "login.cardTitle": "进入你的学习舱",
  "login.cardHintGoogle": "无密码 · Google 或邮箱都行",
  "login.cardHintEmail": "无密码 · 只用邮箱确认身份",
  "login.tagline": "停留之处，即学习之处。",
  "login.privacy": "隐私政策",
  "login.terms": "服务条款",
  "login.emailLabel": "你的邮箱",
  "login.sendBtn": "发送登录邮件",
  "login.sending": "正在发送…",
  "login.googleBtn": "用 Google 登录",
  "login.googleGoing": "正在跳转 Google…",
  "login.orEmail": "或者用邮箱",
  "login.sentTitle": "确认邮件已出发",
  // ⚠️ 这两条**不是逐字搬家**（M3.9 计划要求「搬家就是搬家」，这里破了例，理由记在
  // M3.9-log）：原文是一整句、中间夹着两个 `<span>` 强调「这台设备 / 别的设备」。
  // 夹在句子中间的强调片段翻不了 —— 英文的语序会把它们冲到别的位置，
  // 拆成五个碎片 key 更糟。改成两句各自完整、强调落在句首，意思一字未改。
  "login.sentSameDevice": "在这台设备上：点邮件里的登录按钮。",
  "login.sentOtherDevice": "邮件是在别的设备上打开的：把里面的数字验证码填到下面。",
  "login.codePlaceholder": "邮件里的验证码",
  "login.verifySubmit": "用验证码登录",
  "login.verifying": "确认中…",
  "login.changeEmail": "换个邮箱 / 重新发送",

  // ── 登录报错（D44：说得出是哪一种失败，一条一个真实起因）────────────────
  "login.errAuth": "登录链接无效或已过期，请重新发送一封。",
  "login.errTooFrequent": "发送太频繁：安全限制要求两次发送之间间隔 60 秒。",
  "login.errTooFrequentWait": (s: string) =>
    `发送太频繁：安全限制要求两次发送之间间隔 60 秒（还需等约 ${s} 秒）。`,
  "login.errRateLimit": "这一小时的邮件发送额度用完了，过一会儿再试。",
  "login.errGoogleOff": "Google 登录暂时不可用，请用下面的邮箱登录。",
  "login.errSignupsOff": "这个邮箱还没法注册：新用户注册暂时是关着的。",
  "login.errBadEmail": "这个邮箱地址填得不对，检查一下有没有漏字符。",
  "login.errBadCode": "验证码不对或已过期，重新发送一封再试。",
  "login.errSendFailed":
    "邮件没能发出去 —— 是发信这一侧的故障，不是你的邮箱填错了。稍后再试一次；一直这样的话把这句话截图给我们。",
  "legal.updated": "最后更新",

  // ── 导入表单 ────────────────────────────────────────────────────────────
  "import.label": "贴一条链接",
  "import.placeholder": "YouTube / 小宇宙 / Apple Podcasts…",
  "import.submit": "开始看",
  "import.busy": "正在导入…",
  "import.failed": "导入失败，请重试",
  "import.offline": "网络不通，检查一下连接再试",
  "import.hintA": "苹果播客里点这一集的",
  "import.hintB": "，直接拷贝网址粘贴进来；小宇宙等其他 App 就是「分享 → 复制链接」。贴节目主页或 RSS 也认，那会导入最新一集。",

  // ── 内容列表（/watch 下半屏）────────────────────────────────────────────
  "list.empty": "这里还是空的。上面贴一条链接试试。",
  "list.groupPinned": "置顶",
  "list.groupUnknown": "时间不详",
  "list.groupToday": "今天导入",
  "list.groupYesterday": "昨天导入",
  "list.groupWeek": "本周导入",
  "list.groupOlder": "更早导入",
  "list.pinned": "已置顶",
  "list.favorited": "已收藏",
  "list.moreActions": (title: string) => `${title} 的更多操作`,
  "list.actionsAria": "内容操作",
  "list.close": "关闭",
  "list.pin": "置顶",
  "list.unpin": "取消置顶",
  "list.favorite": "加入收藏",
  "list.unfavorite": "取消收藏",
  "list.delete": "删除",
  "list.cancel": "取消",
  "list.changeFailed": "改不动，请重试",
  "list.changeOffline": "网络不通，没改成",
  "list.deleteFailed": "删除失败，请重试",
  "list.deleteOffline": "网络不通，没能删掉",
  "list.flagsMigration": "置顶和收藏需要先在 Supabase 跑一次",

  // ── 观看历史（/library 列表）────────────────────────────────────────────
  "history.empty": "还没有看过的东西。去「观看」贴一条链接，看几分钟，这里就有了。",
  "history.emptyFolders": "智能分类还没做好。等它上线，这里会自动把看过的东西归成几个文件夹。",
  "history.watchedTo": (t: string) => `看到 ${t}`,
  "history.times": (n: number) => `看过 ${n} 次`,
  "history.pauses": (n: number) => `${n} 个暂停点`,
  "history.bucketToday": "今天看的",
  "history.bucketYesterday": "昨天看的",
  "history.bucketWeek": "本周看的",
  "history.bucketOlder": "更早看过",
  "history.bucketUnknown": "时间不详",
  "history.unknownNote": "这些是加迁移 0007 之前看的 —— 那会儿还没有字段记「什么时候看的」。再看一遍就归位了。",

  // ── 词库列表 ────────────────────────────────────────────────────────────
  "vlist.empty": "还没收过词。看视频时停一下，在字幕里点一个词就收到这儿了；想收一整段，就再点一个词。",
  "vlist.emptyAll": "词库还是空的。任意一条内容里停一下，在字幕里点一个词就收进来了。",
  "vlist.remove": "从词库去掉",
  "vlist.removeAria": (term: string) => `从词库去掉：${term}`,
  "vlist.removeFailed": "没删掉，请重试",
  "vlist.jumpAria": (term: string) => `跳回原声：${term}`,
  "vlist.glossMissing": "解释还没取到",
  "vlist.glossRetry": "再试一次",
  "vlist.glossBusy": "取解释中…",
  "vlist.glossFailed": "还是没取到，等会儿再试",

  // ── 播放控制条（倍速、±N 秒）────────────────────────────────────────────
  "play.back": (n: number) => `后退 ${n} 秒`,
  "play.forward": (n: number) => `前进 ${n} 秒`,
  "play.stepChip": (n: number) => `跳 ${n} 秒`,
  "play.stepMenu": "改成一跳几秒",
  "play.rateMenu": "改播放倍速",
  "play.stepHint": "按一下箭头跳多少秒",
  "play.rateHint": "播放速度（听不清就慢下来）",
  "play.notStarted": "先点播放，这两颗才跳得动",

  // ── 捕获点那一条（点点条）──────────────────────────────────────────────
  "dots.next": "跳到下一个捕获点",
  "dots.prev": "跳到上一个捕获点",
  "dots.deleteFailed": "没删掉，请重试",
  "dots.empty": "播到卡住的地方，点一下悬浮球 —— 这里会留下一个点，随时点回去。",
  "dots.loading": (n: number) => `读取时长中，马上就能显示这 ${n} 个点。`,
  "dots.clusterAria": (time: string, n: number) => `${time} 附近的 ${n} 个捕获点，展开选择`,
  "dots.jumpAria": (time: string) => `跳回 ${time}`,
  "dots.crowded": (n: number) => `这里挤了 ${n} 个点，挑一个：`,
  "dots.jumpHere": "跳回这里",
  "dots.deleteAria": (time: string) => `删除 ${time} 这个点`,

  // ── 悬浮捕获球 ──────────────────────────────────────────────────────────
  "orb.immersive": "沉浸聊天：长按收起",
  "orb.ready": "捕获球：轻点记这一刻，长按进入沉浸聊天",
  "orb.pending": "捕获球：字幕准备中，长按进入沉浸聊天",

  // ── 字幕行尾那颗收词按钮 ────────────────────────────────────────────────
  "phrase.save": "收进词库",
  "phrase.unsave": "从词库去掉",
  "phrase.saveLine": "收下这一行标出来的",
  "phrase.saved": "已在词库里",

  // ── 悬浮词卡（D46）──────────────────────────────────────────────────────
  "bubble.loading": "查这个词…",
  "bubble.failed": "没查到",
  "bubble.retry": "再试一次",
  "bubble.otherSenses": "其他常用意思",
  "bubble.noOther": "没有别的常用意思",
  "bubble.close": "关掉",

  // ── 暂停点回看 ──────────────────────────────────────────────────────────
  "pause.tagAsked": "问了",
  "pause.tagAnswered": "答过",
  "pause.tagStoppedAt": "停在这句",
  "pause.justStopped": "只是停了一下",
  "pause.deleteFailed": "没删掉，请重试",
  "pause.heading": "replay / 暂停点回看",
  "pause.collapse": "收起 ⌃",
  "pause.expand": (n: number) => `展开 ⌄ ${n}`,
  "pause.chatRow": (n: number) => `和这条内容聊过 ${n} 轮`,
  "pause.chatOpen": "打开 →",
  "pause.empty": "这条内容你还没停过。看的时候点右下角悬浮球，停下的每一刻都会记在这里。",
  "pause.jumpAria": (time: string) => `跳回 ${time}`,
  "pause.toggleAria": (open: string, time: string) => `${open} ${time} 的完整问答`,
  "pause.toggleOpen": "展开",
  "pause.toggleClose": "收起",
  "pause.deleteAria": (time: string) => `删除 ${time} 这个暂停点`,
  "pause.youAsked": "你问：",

  // ── 内容详情页（回看）──────────────────────────────────────────────────
  "detail.tabPauses": "暂停点与聊天",
  "detail.tabVocab": "词库",
  "detail.emptyPauses": "这条内容你还没停过。回观看页看的时候点右下角悬浮球，停下的每一刻都会记在这里。",
  // 「那次看的」这个后缀原来是拼在四种日期后面的。拼串在英文里语序会散，
  // 所以四条各自写完整（`detail.dayOn` 的日期由 `Intl.DateTimeFormat` 按界面语言排版）
  "detail.dayToday": "今天 · 那次看的",
  "detail.dayYesterday": "昨天 · 那次看的",
  "detail.dayUnknown": "时间不详 · 那次看的",
  "detail.dayOn": (date: string) => `${date} · 那次看的`,

  // ── 划词选段（点两下选一段，D45/M3.10）──────────────────────────────────
  "sel.take": "收下",
  "sel.drop": "已在词库 · 去掉",
  "sel.cancel": "取消",
  "sel.hint": "再点一个词，就一直选到那儿",
  "sel.word": (word: string) => `选中「${word}」`,
  "sel.saved": "已收进词库",
  "sel.glossBusy": "查这个词的意思…",
  "sel.glossFailed": "没查到意思",
  "sel.glossRetry": "再试一次",
  "sel.glossDismiss": "收起",

  // ── 字幕层 ──────────────────────────────────────────────────────────────
  "cap.title": "captions / 字幕",
  // 创始人 2026-08-04 指名要加「收进词库才能查看意思」——
  // 悬浮在没收过的词上是没反应的，不说出口就像功能坏了
  "cap.pickHint": "点词收进词库（收进后悬浮或长按可查意思）· 点行首时间戳跳到那一句",
  "cap.follow": "跟随中",
  "cap.noFollow": "不跟随",
  "cap.hide": "隐藏",
  "cap.show": "显示",
  "cap.jumpAria": (time: string) => `跳到 ${time}`,

  // YouTube 自家「显示转录」的三步。**出现在两个地方**（粘贴框里、以及自动转写走进
  // 死路时），一份文案别让两处慢慢长歪
  "cap.ytStep1a": "电脑浏览器打开这个视频 → 视频下方「",
  "cap.ytStep1b": "」→「",
  "cap.ytStep1More": "...更多",
  "cap.ytStep1Show": "显示转录 / Show transcript",
  "cap.ytStep1c": "」",
  "cap.ytStep2a": "在弹出的转录里",
  "cap.ytStep2Copy": "全选、复制",
  "cap.ytStep3a": "回到这里，整段",
  "cap.ytStep3Paste": "粘",
  "cap.ytStep3b": "进「粘贴字幕」的框",

  // 生成 / 粘贴那几颗按钮
  "cap.retryAnyway": "仍要重试",
  "cap.retry": "重试",
  "cap.resume": "继续生成",
  "cap.generate": "生成字幕",
  "cap.pasteYt": "粘贴字幕",
  "cap.pasteManual": "手动粘贴",
  "cap.generating": (pct: string) => `生成中${pct}`,
  "cap.generatingLong": (pct: string) => `正在生成字幕${pct}第一段大约二十秒后出来。`,
  "cap.cancel": "取消",
  "cap.saving": "正在存…",
  "cap.save": "存下这份字幕",
  "cap.none": "还没有字幕。",
  "cap.tailNote": "后面还有没转完的部分。",

  // 粘贴框里的说明
  "cap.pasteYtLead": "有字幕(CC)的话，粘过来免费（手机上没有「显示转录」入口，这条要在电脑上做）：",
  "cap.pasteYtTail": "认 YouTube 那种「时间戳+文字」，也认 .srt / .vtt。手机上直接用「生成字幕」就行。",
  "cap.pasteManualLeadA": "把 .srt 或 .vtt 的内容整段贴进来（要带",
  "cap.pasteManualLeadB": "这样的时间轴）。自动转写不灵的时候，这里永远是最后一条路。",
  "cap.pastePlaceholderYt": "0:00\n第一句话\n0:04\n第二句话",
  "cap.pastePlaceholderSrt": "1\n00:00:00,000 --> 00:00:03,200\n第一句话",
  "cap.parseFailed":
    "没认出任何一条字幕。可以是 YouTube「显示转录」复制的内容（时间戳+文字），也可以是 .srt / .vtt 文件内容。",
  "cap.saveFailed": "没存上，请重试",
  // 走进死路时那段（点开粘贴框之前就摊开搬运方法 —— 那时候人最需要它，却最看不见）
  "cap.deadEndLead": "但你能打开这支视频，就说明字幕就在那儿 —— 自己搬过来，一样用（手机上没有「显示转录」入口，这条要在电脑上做）：",
  "cap.hintGenerateA": "点",
  "cap.hintGenerateBtn": "「生成字幕」",
  "cap.hintGenerateB": "一键自动生成（约二十秒）。在电脑上打开、这视频有 CC 的话，也可以「粘贴字幕」免费拿。",

  // AI 自动标词那颗拨动开关（D45，默认关）
  "cap.scanLabel": "AI 标词",
  "cap.scanOn": "打开 AI 自动标词，并马上扫这一片",
  "cap.scanOff": "关掉 AI 自动标词",
  "cap.scanRunning": "正在扫这一片…",
  "cap.scanIsOn": "开着，会把值得收的词标出来",
  "cap.scanIsOff": "关着（开了要花钱，每片只扫一次）",

  // 字号 / 译文那一排
  "cap.size": "字号",
  "cap.sizeAria": "字幕字号",
  "cap.translation": "译文",
  "cap.translationAria": "译文语言",
  "cap.translationOff": "关闭",
  "cap.sameLangSuffix": "（原文，不用翻）",
  "cap.flipAria": "对调原文与译文的大小",
  "cap.flipToTr": "译文大 ⇅",
  "cap.flipToOrig": "原文大 ⇅",
  "cap.trOnlyCurrent": "只当前行",
  "cap.trEveryLine": "每行译文",
  "cap.translating": (pct: string) => `翻译中${pct}`,
  "cap.trNoResponse": "翻译服务没响应",
  "cap.trSameLang": "这条内容的原文就是这个语言。",
  "cap.trFailed": "翻译没成，稍后再试。",
} as const;
