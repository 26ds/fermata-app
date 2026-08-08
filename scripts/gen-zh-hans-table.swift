#!/usr/bin/env swift
//
//  生成 `src/lib/zh-hans-table.ts` —— 繁体字 → 简体字的对照表。
//
//  用法（只在 macOS 上跑，且只有想重新生成时才跑；平时不进构建）：
//      swift scripts/gen-zh-hans-table.swift
//
//  **数据从哪来**：macOS 自带的 ICU（`CFStringTransform` 的 `Traditional-Simplified`
//  变换）。不是从任何第三方项目拷来的词库 —— 简繁对应关系本身是《简化字总表》那种
//  标准对照，这里只是把系统里已有的那张表**导出来**，好让它能在 Vercel 的 Linux
//  运行时里查（那边没有 CoreFoundation）。ICU 数据的许可（Unicode License）允许再分发。
//
//  **为什么只做繁→简这一个方向**（这条是实测，不是偷懒）：
//  穷举双字组合量下来，繁→简是 **0 条**词级规则 —— 纯逐字映射，一张字表和 ICU 100% 等价。
//  反方向不成立：296 个简体字有多种繁体写法（发→髮/發、干→乾/幹、里→裡/里、台→臺/檯/颱…），
//  非有词级规则不可，光靠字表必然写出「頭发」「幹了」，比不转更糟。
//
//  **2026-08-07 试过把简→繁的词级规则也从 ICU 导出来，失败并放弃了**，两条路都不通：
//    ⒜ 批量拼串（一次问几千对）会串味 —— 抽查十几对说空格能阻断规则，实测仍挖出
//       「画面→画面」这种假规则（单独问明明是「畫面」）；
//    ⒝ 逐对穷举不串味，但会把 ICU 在生僻字对上的 quirk 一并收进来 —— 44 万条 / 5.2MB，
//       而且真句子上还是会漏（「皇后」被转成「皇後」）。
//  结论：**别继续反向工程 ICU**。真要在本地做这个方向，正路是引一份成熟的词库（如 OpenCC，
//  Apache-2.0，**引之前要先跟创始人过一遍许可**）。现在这个方向走 `/api/translate` 问模型。
//

import Foundation

let buf = NSMutableString(capacity: 8)
func toSimplified(_ s: String) -> String {
  buf.setString(s)
  CFStringTransform(buf as CFMutableString, nil, "Traditional-Simplified" as CFString, false)
  return buf as String
}

/// 基本区 + 扩展 A + **兼容汉字区**（U+F900–U+FAFF 里全是异体/繁体字，字幕里真会出现）
let ranges = [(0x4E00, 0x9FFF), (0x3400, 0x4DBF), (0xF900, 0xFAFF)]

var trad = "", simp = ""
var extra: [(String, String)] = []

for (lo, hi) in ranges {
  for cp in lo...hi {
    guard let u = Unicode.Scalar(cp) else { continue }
    let c = String(Character(u))
    let r = toSimplified(c)
    guard r != c else { continue }
    // 主表是两条**等长**字符串，按下标一一对应 —— 比 3000 条 Map 字面量小得多也好 diff。
    // 前提是简体侧也只占一个 UTF-16 单元；落在 BMP 外的（都是极冷僻字）单列 EXTRA。
    if r.count == 1, r.utf16.count == 1 {
      trad += c
      simp += r
    } else {
      extra.append((c, r))
    }
  }
}

let entries = extra.map { "  \"\($0.0)\": \"\($0.1)\"," }.joined(separator: "\n")
let out = """
// ⚠️ 这个文件是**生成的**，别手改 —— 改了下次重新生成就没了。
// 生成方式：`swift scripts/gen-zh-hans-table.swift`（数据来源与"为什么只有一个方向"都写在那儿）
//
// 繁体 → 简体，共 \(trad.utf16.count + extra.count) 条。逻辑在 `src/lib/zh-script.ts`。

/** 繁体侧。与 SIMP **等长且按下标对应**（长度不等时 zh-script.ts 会当场抛，不许静默错位） */
export const TRAD = "\(trad)";

/** 简体侧 */
export const SIMP = "\(simp)";

/** 简体侧落在 BMP 之外的（都是极冷僻字，塞不进上面那两条等长字符串） */
export const EXTRA: Record<string, string> = {
\(entries)
};
"""

let path = "src/lib/zh-hans-table.ts"
try! out.write(toFile: path, atomically: true, encoding: .utf8)
print("写好 \(path)：主表 \(trad.utf16.count) 条 + EXTRA \(extra.count) 条")
