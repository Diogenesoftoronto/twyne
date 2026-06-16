import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { LegalPage } from "../../components/legal/legal-page";

export default component$(() => {
  return (
    <LegalPage
      title="Terms of Service"
      lead="The terms on which you use Twyne."
      updated="15 June 2026"
      toc={[
        { id: "acceptance", label: "1. Acceptance" },
        { id: "service", label: "2. The Service" },
        { id: "account", label: "3. Your account" },
        { id: "content", label: "4. Your content" },
        { id: "ai", label: "5. AI features & BYOK" },
        { id: "publishing", label: "6. Publishing" },
        { id: "acceptable-use", label: "7. Acceptable use" },
        { id: "paid-plans", label: "8. Paid plans" },
        { id: "third-party", label: "9. Third-party services" },
        { id: "beta", label: "10. Beta & availability" },
        { id: "disclaimers", label: "11. Disclaimers" },
        { id: "liability", label: "12. Limitation of liability" },
        { id: "indemnity", label: "13. Indemnity" },
        { id: "termination", label: "14. Termination" },
        { id: "governing-law", label: "15. Governing law" },
        { id: "changes", label: "16. Changes" },
        { id: "contact", label: "17. Contact" },
      ]}
    >
      <div class="doc-callout">
        <p>
          These Terms are the rules for using Twyne. They cover the local-first
          writing desk, optional sync, AI features, publishing, paid plans, and
          the third-party services that make those features work.
        </p>
      </div>

      <h2 id="acceptance" class="doc-h2">
        1. Acceptance
      </h2>
      <p class="doc-p">
        By accessing or using Twyne (the "Service"), you agree to these Terms of
        Service. If you do not agree, please do not use the Service.
      </p>

      <h2 id="service" class="doc-h2">
        2. The Service
      </h2>
      <p class="doc-p">
        Twyne is a writing workspace that helps you draft documents with the
        assistance of AI "editor" personas, a grading rubric, and research
        tools. Your writing is stored locally in your browser by default, and is
        synced to our backend only if you create an account and sign in.
      </p>
      <p class="doc-p">
        Some features depend on third-party services, including backend hosting,
        authentication, AI model providers, ATProto / Bluesky services,
        analytics, feature flags, and payment processors. Features may change,
        be limited, enter beta, or be withdrawn as the product evolves.
      </p>

      <h2 id="account" class="doc-h2">
        3. Your account
      </h2>
      <p class="doc-p">
        You may use Twyne without an account. If you create one, including via
        Bluesky / ATProto, you are responsible for activity under it and for
        keeping your credentials secure. You may delete your account and
        associated synced data at any time.
      </p>
      <p class="doc-p">
        You agree to provide accurate information where required, not to
        impersonate anyone else, and not to use another person's account without
        permission. We may suspend or terminate accounts that violate these
        Terms, create risk for other users, or create legal or operational risk
        for Twyne.
      </p>

      <h2 id="content" class="doc-h2">
        4. Your content
      </h2>
      <p class="doc-p">
        You retain all rights to the content you create with Twyne. We claim no
        ownership over your drafts. You grant us only the limited permission
        needed to store, sync, and display your content back to you in order to
        operate the Service. You are responsible for the content you create and
        for ensuring you have the rights to it.
      </p>
      <p class="doc-p">
        This permission includes the rights needed to process, transmit, store,
        back up, analyze, format, publish at your direction, and otherwise
        handle your content for the features you choose to use. For local-only
        use, that processing primarily happens in your browser. For sync, hosted
        AI, publishing, analytics, and payments, the relevant data may be
        processed by Twyne's backend or third-party providers as described in
        the Privacy Policy.
      </p>

      <h2 id="ai" class="doc-h2">
        5. AI features and bring-your-own-key
      </h2>
      <p class="doc-p">
        AI features may be powered by third-party model providers. If you supply
        your own API key (BYOK), requests are sent from your browser to that
        provider under their terms, and you are responsible for any usage and
        charges. AI output may be inaccurate; you are responsible for reviewing
        it before relying on it.
      </p>
      <p class="doc-p">
        If you use hosted AI, Twyne may send prompts, relevant draft text,
        briefs, persona instructions, and other context to the configured model
        provider. AI responses are suggestions, not professional advice. You are
        responsible for checking factual claims, citations, originality,
        permissions, legal compliance, and suitability before using or
        publishing any output.
      </p>
      <p class="doc-p">
        You may not use Twyne or any connected AI provider in a way that
        violates the provider's terms, rate limits, safety rules, or applicable
        law. If you connect an OpenAI-compatible or local provider, you are
        responsible for that provider's configuration, availability, and
        behavior.
      </p>

      <h2 id="publishing" class="doc-h2">
        6. Publishing
      </h2>
      <p class="doc-p">
        If you choose to publish a draft (for example to your ATProto / Bluesky
        PDS), you are responsible for what you publish and for complying with
        the terms of any third-party network you publish to.
      </p>
      <p class="doc-p">
        Publishing can make content public, indexable, shareable, copied, or
        stored by others. Unpublishing in Twyne or deleting from a third-party
        network may not remove copies, caches, embeds, screenshots, or
        downstream reposts. Do not publish private, confidential, infringing, or
        unlawful material.
      </p>

      <h2 id="acceptable-use" class="doc-h2">
        7. Acceptable use
      </h2>
      <p class="doc-p">
        You agree not to misuse the Service, including by attempting to disrupt
        it, accessing it through unauthorized means, or using it to produce or
        distribute unlawful content.
      </p>
      <ul class="doc-ul">
        <li>
          Do not interfere with, overload, scrape, or reverse engineer Twyne.
        </li>
        <li>
          Do not bypass access controls, account limits, payment gates, or rate
          limits.
        </li>
        <li>
          Do not upload or publish content you do not have the right to use.
        </li>
        <li>Do not use Twyne to harass, defraud, threaten, or harm others.</li>
        <li>
          Do not use Twyne to distribute malware, spam, or illegal material.
        </li>
      </ul>

      <h2 id="paid-plans" class="doc-h2">
        8. Paid plans
      </h2>
      <p class="doc-p">
        Twyne may offer paid plans for hosted AI, higher limits, sync,
        publishing, early access, or other features. Prices, limits, and plan
        contents may change. Payments are processed by a third-party payment
        provider, and your purchase may also be governed by that provider's
        terms.
      </p>
      <p class="doc-p">
        Unless a checkout page says otherwise, subscriptions renew until
        cancelled. You are responsible for cancelling before renewal if you do
        not want to continue. Refunds, credits, trials, taxes, and cancellations
        are handled according to the checkout flow, payment-provider rules, and
        applicable law.
      </p>

      <h2 id="third-party" class="doc-h2">
        9. Third-party services
      </h2>
      <p class="doc-p">
        Twyne integrates with third-party services for AI, authentication,
        analytics, payments, publishing, storage, and infrastructure. We are not
        responsible for third-party services, their availability, their terms,
        their output, or how they process information once you choose to use
        them. Your use of those services is subject to their own terms and
        policies.
      </p>

      <h2 id="beta" class="doc-h2">
        10. Beta features and availability
      </h2>
      <p class="doc-p">
        Twyne may include experimental, beta, local-model, or early-access
        features. These may be incomplete, inaccurate, unstable, or changed
        without notice. We may suspend, rate-limit, modify, or discontinue all
        or part of the Service at any time.
      </p>

      <h2 id="disclaimers" class="doc-h2">
        11. Disclaimers
      </h2>
      <p class="doc-p">
        The Service is provided "as is" and "as available" without warranties of
        any kind, whether express or implied. We do not warrant that the Service
        will be uninterrupted, error-free, or that your content will never be
        lost, so keep your own backups (you can export any folio at any time).
      </p>
      <p class="doc-p">
        Twyne is a writing and editing tool. It does not provide legal,
        financial, medical, academic-integrity, publishing, or other
        professional advice. Citation detection, source summaries, rubric
        grades, and persona feedback are aids for your own review, not
        guarantees of accuracy or compliance.
      </p>

      <h2 id="liability" class="doc-h2">
        12. Limitation of liability
      </h2>
      <p class="doc-p">
        To the maximum extent permitted by law, Twyne and its operators will not
        be liable for any indirect, incidental, or consequential damages, or for
        any loss of data or content, arising out of your use of the Service.
      </p>
      <p class="doc-p">
        To the maximum extent permitted by law, Twyne's total liability for any
        claim relating to the Service is limited to the greater of the amount
        you paid to Twyne for the Service in the three months before the event
        giving rise to the claim or 100 USD.
      </p>

      <h2 id="indemnity" class="doc-h2">
        13. Indemnity
      </h2>
      <p class="doc-p">
        To the extent permitted by law, you agree to defend, indemnify, and hold
        harmless Twyne and its operators from claims, damages, liabilities, and
        expenses arising from your content, your published materials, your use
        of third-party services through Twyne, or your violation of these Terms.
      </p>

      <h2 id="termination" class="doc-h2">
        14. Termination
      </h2>
      <p class="doc-p">
        You may stop using Twyne at any time. We may suspend or terminate access
        if you violate these Terms, create security or operational risk, fail to
        pay for paid features, or if we discontinue the Service. Termination
        does not affect provisions that by their nature should survive,
        including ownership, disclaimers, limitations of liability, indemnity,
        and payment obligations already incurred.
      </p>

      <h2 id="governing-law" class="doc-h2">
        15. Governing law
      </h2>
      <p class="doc-p">
        These Terms are governed by the laws applicable where Twyne's operator
        is based, without regard to conflict-of-law rules, except where
        applicable consumer-protection law requires otherwise.
      </p>

      <h2 id="changes" class="doc-h2">
        16. Changes
      </h2>
      <p class="doc-p">
        We may update these Terms from time to time. Material changes will be
        reflected by updating the "last updated" date above. Continued use of
        the Service after changes take effect constitutes acceptance.
      </p>

      <h2 id="contact" class="doc-h2">
        17. Contact
      </h2>
      <p class="doc-p">
        Questions about these Terms can be sent to{" "}
        <a href="mailto:support@twyne.love">support@twyne.love</a>.
      </p>
    </LegalPage>
  );
});

export const head: DocumentHead = {
  title: "Terms of Service · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Twyne's Terms of Service: your account, your content, AI and bring-your-own-key usage, publishing, disclaimers, and liability.",
    },
  ],
};
