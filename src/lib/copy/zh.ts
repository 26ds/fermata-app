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
} as const;
