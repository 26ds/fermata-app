import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal-doc";

export const metadata: Metadata = {
  title: "服务条款 / Terms of Service — Fermata",
  description: "使用 Fermata 的规则与免责说明。/ The rules and disclaimers for using Fermata.",
};

// 同 `/privacy`：**不登录也要能打开**，这里不许出现 `createClient()`。

export default async function TermsPage() {

  return (
    <LegalDoc
      zhTitle="服务条款"
      enTitle="Terms of Service"
      updated="2026-09-08"
      zh={
        <>
          <p>
            用 Fermata 就表示你接受下面这几条。写得短，是因为该说的本来就不多。
          </p>

          <h2>一、这是什么</h2>
          <p>
            Fermata 是<strong>一个人开发的个人项目</strong>，目前免费提供。
            它可能随时改动、暂停或关闭，恕不能保证永远在线。
          </p>

          <h2>二、你的账号</h2>
          <ul>
            <li>一个邮箱一个账号，请填你自己能收信的地址。</li>
            <li>别拿它做违法的事，别攻击、爬取或批量注册。发现了会停号。</li>
          </ul>

          <h2>三、内容与版权</h2>
          <ul>
            <li>
              你导入的视频、播客<strong>版权属于原作者</strong>。Fermata 只做官方播放器嵌入和文字处理，
              <strong>不下载、不转存、不再分发</strong>任何音视频文件。
            </li>
            <li>你自己粘贴进来的文字，由你确保自己有权使用它。</li>
            <li>你在 Fermata 里产生的东西（提问、笔记、词库）属于你。</li>
          </ul>

          <h2>四、AI 会出错（这条最要紧）</h2>
          <p>
            转写、翻译、词义解释、问答<strong>全都由 AI 生成，都可能是错的</strong>。
            请不要把它当作<strong>医疗、法律、财务或其他专业建议</strong>。
            重要的事情，请自己核对原始来源。
          </p>

          <h2>五、不保证与免责</h2>
          <p>
            本服务按<strong>「现状」</strong>提供，不保证持续可用、不保证结果准确、不保证没有中断或数据丢失。
            在法律允许的最大范围内，开发者不对使用本服务造成的任何损失承担责任。
          </p>

          <h2>六、变更</h2>
          <p>条款更新会改这一页，以顶部日期为准。继续使用即表示接受新版本。</p>

          <h2>七、联系</h2>
          <p>
            <a href="mailto:zq20061208@gmail.com">zq20061208@gmail.com</a>
          </p>

          <blockquote>
            这份条款由开发者本人撰写，<strong>不是律师起草的法律文件</strong>。
            另见<a href="/privacy">隐私政策</a>。
          </blockquote>
        </>
      }
      en={
        <>
          <p>Using Fermata means you accept the following. It is short because there genuinely isn&apos;t much to say.</p>

          <h2>1. What this is</h2>
          <p>
            Fermata is a <strong>personal project built by one person</strong>, currently free to use. It
            may change, pause or shut down at any time; continuous availability is not guaranteed.
          </p>

          <h2>2. Your account</h2>
          <ul>
            <li>One email, one account. Use an address you can actually receive mail at.</li>
            <li>
              Do not use it for anything unlawful, and do not attack, scrape or mass-register. Accounts
              doing so will be suspended.
            </li>
          </ul>

          <h2>3. Content and copyright</h2>
          <ul>
            <li>
              Videos and podcasts you import <strong>remain the copyright of their creators</strong>.
              Fermata only embeds official players and processes text; it{" "}
              <strong>never downloads, re-hosts or redistributes</strong> audio or video files.
            </li>
            <li>For text you paste yourself, you are responsible for having the right to use it.</li>
            <li>What you create inside Fermata — questions, notes, vocabulary — is yours.</li>
          </ul>

          <h2>4. The AI gets things wrong (the most important clause here)</h2>
          <p>
            Transcription, translation, word senses and answers are{" "}
            <strong>all AI-generated and can all be wrong</strong>. Do not treat them as{" "}
            <strong>medical, legal, financial or other professional advice</strong>. For anything that
            matters, check the original source yourself.
          </p>

          <h2>5. No warranty</h2>
          <p>
            The service is provided <strong>&quot;as is&quot;</strong>, without any guarantee of
            availability, accuracy, uninterrupted operation or data preservation. To the maximum extent
            permitted by law, the developer is not liable for any loss arising from use of this service.
          </p>

          <h2>6. Changes</h2>
          <p>
            Updates are published on this page; the date above governs. Continued use means you accept the
            new version.
          </p>

          <h2>7. Contact</h2>
          <p>
            <a href="mailto:zq20061208@gmail.com">zq20061208@gmail.com</a>
          </p>

          <blockquote>
            These terms were written by the developer and are{" "}
            <strong>not a lawyer-drafted legal document</strong>. See also the{" "}
            <a href="/privacy">Privacy Policy</a>.
          </blockquote>
        </>
      }
    />
  );
}
