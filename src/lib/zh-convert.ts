import * as OpenCC from "opencc-js";
import type { TranscriptSegment } from "@/lib/types";
import type { HanScript } from "@/lib/zh-script";

// D50 三轮 —— 简繁互转的实现层。**查词库，不花钱、不联网、不问模型。**
//
// 用的是 **OpenCC**（`opencc-js`，创始人 2026-08-07 拍板引入）：
//   代码 MIT（nk2028）／词库 Apache-2.0（OpenCC 项目）。两者都允许商用、不传染。
//   **我们是把它当 npm 依赖装，没有把任何词库文件拷进本仓库**，
//   而且只在服务端跑 —— 浏览器一个字节都不会多下载。
//
// **为什么非得是词库不可**（这条是实测，不是选型偏好）：
//   繁→简是逐字映射，一张字表就够（我们原来自己从 macOS ICU 导过一张，好使）；
//   **简→繁是一对多**，「干」是 `乾` 还是 `幹`、「只」是 `只` 还是 `隻`，
//   **得看整个词**，只有词级词库答得出来。2026-08-07 试过从 ICU 反向工程出词级规则，
//   两条路都失败（详见 plans/M3.12-log.md 的「走过的弯路」）。OpenCC 一次全对。
//
// **⚠️ 服务端专用**（D24）：这份词库 1MB，进了浏览器包就是 1MB 的下载。
// 客户端组件**不许** import 这个文件 —— 字幕在送到浏览器之前就该转好
// （观看页 server component、`/api/transcript`、`/api/sources/[id]`）。
// 验证：`grep -rl "opencc" .next/static/chunks/` 必须为空。
//
// **为什么是 `tw` 而不是 `twp`**：`twp` 连**词汇**一起换（数据→資料、软件→軟體、
// 视频→影片、鼠标→滑鼠）。那已经不是换字形，是改人家说的话 —— 字幕里绝不能这么干。
// `t`（OpenCC 标准繁体）会写 `麪條裏`，`tw` 写 `麵條裡`，后者才是通行写法。

/**
 * 建一次要 49ms（`cn→tw` 那份要吃 1MB 词库建 trie），所以**惰性建、建完常驻**。
 * 不碰中文的请求一分钱开销都没有。转换本身极快：800 句（≈1 小时字幕）只要 3–17ms。
 */
let toTrad: ((s: string) => string) | null = null;
let toSimp: ((s: string) => string) | null = null;

function converter(script: HanScript): (s: string) => string {
  if (script === "Hant") {
    toTrad ??= OpenCC.Converter({ from: "cn", to: "tw" });
    return toTrad;
  }
  toSimp ??= OpenCC.Converter({ from: "tw", to: "cn" });
  return toSimp;
}

/** 把一段中文转成指定字形。`null` = 不用转（内容不是中文，或者不知道该转成什么） */
export function conformHan(text: string, script: HanScript | null): string {
  if (!script || !text) return text;
  return converter(script)(text);
}

/**
 * 这段中文**写的是哪套字形**。做法：转成简体看变不变 —— 变了就说明原文里有繁体字。
 *
 * 判据故意不对称，因为事实就不对称：繁体独有字（學/話/實）是**确凿证据**，
 * 而"没见到繁体字"只能推出"看着像简体"。字幕这种长文本上这个判据很稳
 * —— 整篇繁体不可能一个繁体独有字都不出现。
 */
export function scriptOfText(text: string): HanScript {
  return conformHan(text, "Hans") === text ? "Hans" : "Hant";
}

/**
 * 整条字幕调字形。**一句都没变就原样返回那个数组**（同一个引用）——
 * 内容本来就是这套字形、或者根本不是中文时，这里零分配，
 * 下游那些吃 `transcript` 的 `useMemo`（高亮对齐、面板那两秒）也不会被白白打断。
 */
export function conformSegments<T extends TranscriptSegment>(
  segments: T[],
  script: HanScript | null,
): T[] {
  if (!script || segments.length === 0) return segments;
  let changed = false;
  const out = segments.map((seg) => {
    const text = conformHan(seg.text, script);
    if (text === seg.text) return seg;
    changed = true;
    return { ...seg, text };
  });
  return changed ? out : segments;
}
