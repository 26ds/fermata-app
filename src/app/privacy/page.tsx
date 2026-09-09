import type { Metadata } from "next";
import { getUiLang } from "@/lib/ui-lang";
import { LegalDoc } from "@/components/legal-doc";

export const metadata: Metadata = {
  title: "隐私政策 / Privacy Policy — Fermata",
  description:
    "Fermata 收集哪些数据、交给谁、存多久、怎么删。/ What Fermata collects, who receives it, how long it is kept, and how to delete it.",
};

// **这一页必须不登录也能打开**：Google 的 OAuth 同意屏幕要挂这个链接，
// 审核那一侧不会有你的会话。所以这里一个 `createClient()` 都不许出现。
//
// 内容是 2026-09-08 逐条查代码核对过的（见 plans/开放注册-2026-09-08.md），
// **改了行为就要回来改这一页** —— 一份说谎的隐私政策比没有更糟。

export default async function PrivacyPage() {
  const uiLang = await getUiLang();

  return (
    <LegalDoc
      initial={uiLang.toLowerCase().startsWith("en") ? "en" : "zh"}
      zhTitle="隐私政策"
      enTitle="Privacy Policy"
      updated="2026-09-08"
      zh={
        <>
          <p>
            Fermata 是一个人开发的学习工具。这一页用大白话讲清楚四件事：
            <strong>我们拿你哪些数据、交给了谁、存多久、怎么删</strong>。
          </p>

          <h2>一、我们收集什么</h2>
          <h3>1. 你是谁</h3>
          <p>
            只有<strong>邮箱</strong>。用「Google 登录」的话，Google 还会把你的姓名和头像地址给我们。
            <strong>我们不设密码</strong>，所以也没有密码可以泄漏。
          </p>
          <h3>2. 你放进来的内容</h3>
          <p>
            YouTube 链接、播客链接，或你自己粘贴的文字；以及由此得到的标题、封面图地址、时长和字幕文本。
          </p>
          <h3>3. 你的学习痕迹</h3>
          <ul>
            <li>暂停点：第几秒停的、你问了什么、AI 答了什么</li>
            <li>你划下来收进词库的词，和它的解释</li>
            <li>对话记录、看到第几秒、看过几次</li>
            <li>你的设置：母语、想学的语言、字幕译文语言、播放偏好、界面语言</li>
          </ul>

          <h3>我们不做的事（这几条是查过代码的，不是场面话）</h3>
          <ul>
            <li>
              <strong>没有任何统计、广告或追踪脚本</strong>。一个都没装。
            </li>
            <li>
              <strong>不下载、不保存任何音频或视频文件</strong>。播客音频只在服务器内存里过一道就丢掉。
            </li>
            <li>
              <strong>不用 cookie 追踪你</strong>。只有两个 cookie：一个是登录会话，一个记住你选的界面语言。
            </li>
            <li>不卖你的数据，也不拿它投广告。</li>
          </ul>

          <h2>二、数据交给了谁</h2>
          <p>要让这个产品跑起来，下面这些服务会经手你的数据：</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>谁</th>
                  <th>拿到什么</th>
                  <th>为什么</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Supabase</td>
                  <td>上面第一节的全部数据</td>
                  <td>数据库与登录</td>
                </tr>
                <tr>
                  <td>Vercel</td>
                  <td>常规访问日志（IP、时间、访问了哪一页）</td>
                  <td>网站托管</td>
                </tr>
                <tr>
                  <td>Google（Gemini 模型）</td>
                  <td>
                    字幕文本、你的提问、你划的词。YouTube 视频是把<strong>链接</strong>交给它，
                    <strong>不上传文件</strong>
                  </td>
                  <td>生成转写、翻译、词义解释、问答</td>
                </tr>
                <tr>
                  <td>DeepInfra（Whisper）</td>
                  <td>播客的音频数据（不落盘）</td>
                  <td>播客转写</td>
                </tr>
                <tr>
                  <td>YouTube</td>
                  <td>你在看哪一支视频</td>
                  <td>官方内嵌播放器、封面图</td>
                </tr>
                <tr>
                  <td>Apple（iTunes 搜索接口）</td>
                  <td>你搜的播客关键词</td>
                  <td>找播客节目</td>
                </tr>
                <tr>
                  <td>Google（仅当你用 Google 登录）</td>
                  <td>登录这件事本身</td>
                  <td>身份验证</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2>三、有一部分东西是所有用户共享的（请认真读这一节）</h2>
          <p>
            同一支视频被反复转写、反复翻译既慢又贵，所以有三样东西存在
            <strong>不带任何用户标识</strong>的共享缓存里：
          </p>
          <ul>
            <li>字幕文本（按内容 ID 存）</li>
            <li>译文（按内容 ID + 目标语言存）</li>
            <li>词义解释（按「词 + 词的语言 + 解释用的语言」存）</li>
          </ul>
          <p>
            别人看同一支片子、查同一个词，会直接复用这些结果。
            <strong>这几张表里没有任何字段指向是谁</strong> —— 只有内容 ID、语言，和文本本身。
            也就是说：<strong>你划过哪个词会留下痕迹，但「是你划的」不会</strong>。
          </p>
          <p>
            <strong>只属于你、别人绝对读不到的</strong>：你的暂停点、你的提问和 AI 的回答、你的词库、
            观看记录、你的设置。这一层锁在数据库上（行级安全策略），不是靠代码自觉。
          </p>

          <h2>四、存多久，怎么删</h2>
          <ul>
            <li>账号在，数据就在。</li>
            <li>
              <strong>目前还没有自助删除按钮</strong>（在计划里，还没做）。想删账号和数据，
              发邮件到 <a href="mailto:zq20061208@gmail.com">zq20061208@gmail.com</a>，我手动删。
            </li>
            <li>
              第三节那些共享缓存不含用户标识，所以删你的账号<strong>不会</strong>一并删掉它们 ——
              技术上也无从对应回你。
            </li>
          </ul>

          <h2>五、其他</h2>
          <ul>
            <li>本服务不面向 13 岁以下的儿童。</li>
            <li>政策有变会改这一页，顶部日期跟着变；重大变更会给你注册用的邮箱发一封信。</li>
            <li>
              任何问题：<a href="mailto:zq20061208@gmail.com">zq20061208@gmail.com</a>
            </li>
          </ul>

          <blockquote>
            这份说明由开发者本人撰写，如实描述产品当前的实际行为，
            <strong>不是律师起草的法律文件</strong>。
          </blockquote>
        </>
      }
      en={
        <>
          <p>
            Fermata is a learning tool built by one person. This page explains, in plain language:
            <strong> what data we take, who receives it, how long we keep it, and how to delete it</strong>.
          </p>

          <h2>1. What we collect</h2>
          <h3>Who you are</h3>
          <p>
            Your <strong>email address</strong>, and nothing else. If you sign in with Google, Google also
            gives us your name and avatar URL. <strong>There are no passwords</strong> in Fermata, so there
            is no password to leak.
          </p>
          <h3>What you bring in</h3>
          <p>
            YouTube links, podcast links, or text you paste yourself — plus the title, cover image URL,
            duration and transcript derived from them.
          </p>
          <h3>Your learning traces</h3>
          <ul>
            <li>Pause points: the second you stopped at, what you asked, what the AI answered</li>
            <li>Words you selected into your vocabulary, and their explanations</li>
            <li>Chat history, how far you watched, how many times</li>
            <li>Your settings: native language, language you are learning, subtitle language, playback preferences, interface language</li>
          </ul>

          <h3>What we do not do (each of these was checked against the source code)</h3>
          <ul>
            <li>
              <strong>No analytics, advertising or tracking scripts.</strong> None are installed.
            </li>
            <li>
              <strong>No audio or video files are downloaded or stored.</strong> Podcast audio passes
              through server memory once and is discarded.
            </li>
            <li>
              <strong>No tracking cookies.</strong> There are exactly two cookies: your login session, and
              your interface-language choice.
            </li>
            <li>We do not sell your data, and we do not run ads on it.</li>
          </ul>

          <h2>2. Who receives your data</h2>
          <p>These services handle your data so the product can work:</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Who</th>
                  <th>What they receive</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Supabase</td>
                  <td>Everything listed in section 1</td>
                  <td>Database and authentication</td>
                </tr>
                <tr>
                  <td>Vercel</td>
                  <td>Ordinary access logs (IP, time, page)</td>
                  <td>Hosting</td>
                </tr>
                <tr>
                  <td>Google (Gemini models)</td>
                  <td>
                    Transcript text, your questions, words you select. For YouTube we send the{" "}
                    <strong>link</strong>, <strong>never a file</strong>
                  </td>
                  <td>Transcription, translation, word senses, Q&amp;A</td>
                </tr>
                <tr>
                  <td>DeepInfra (Whisper)</td>
                  <td>Podcast audio data (never written to disk)</td>
                  <td>Podcast transcription</td>
                </tr>
                <tr>
                  <td>YouTube</td>
                  <td>Which video you are watching</td>
                  <td>Official embedded player, thumbnails</td>
                </tr>
                <tr>
                  <td>Apple (iTunes search API)</td>
                  <td>Podcast keywords you search for</td>
                  <td>Finding podcast shows</td>
                </tr>
                <tr>
                  <td>Google (only if you sign in with Google)</td>
                  <td>The sign-in itself</td>
                  <td>Authentication</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2>3. Some things are shared between all users (please read this section)</h2>
          <p>
            Transcribing and translating the same video over and over is slow and expensive, so three
            things live in caches that carry <strong>no user identifier at all</strong>:
          </p>
          <ul>
            <li>Transcript text (keyed by content ID)</li>
            <li>Translations (keyed by content ID + target language)</li>
            <li>Word senses (keyed by term + language of the term + language of the explanation)</li>
          </ul>
          <p>
            Anyone watching the same video or looking up the same word reuses these results.{" "}
            <strong>No column in those tables points to a person</strong> — only content IDs, languages
            and the text itself. In other words: <strong>that a word was looked up is recorded; that you
            looked it up is not</strong>.
          </p>
          <p>
            <strong>Yours alone, unreadable by anyone else</strong>: your pause points, your questions and
            the AI&apos;s answers, your vocabulary, your watch history, your settings. That boundary is
            enforced by the database itself (row-level security), not by careful coding.
          </p>

          <h2>4. Retention and deletion</h2>
          <ul>
            <li>Your data stays as long as your account does.</li>
            <li>
              <strong>There is no self-service delete button yet</strong> (planned, not built). To delete
              your account and data, email{" "}
              <a href="mailto:zq20061208@gmail.com">zq20061208@gmail.com</a> and I will do it by hand.
            </li>
            <li>
              The shared caches in section 3 carry no user identifier, so deleting your account{" "}
              <strong>does not</strong> remove them — technically they cannot be traced back to you either.
            </li>
          </ul>

          <h2>5. Other</h2>
          <ul>
            <li>This service is not directed to children under 13.</li>
            <li>
              Changes are published on this page and the date above changes with them; significant changes
              are emailed to the address you signed up with.
            </li>
            <li>
              Questions: <a href="mailto:zq20061208@gmail.com">zq20061208@gmail.com</a>
            </li>
          </ul>

          <blockquote>
            This notice was written by the developer and describes what the product actually does today.{" "}
            <strong>It is not a lawyer-drafted legal document.</strong>
          </blockquote>
        </>
      }
    />
  );
}
