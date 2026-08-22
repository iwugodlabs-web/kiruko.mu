import type { Metadata } from "next";
import { LegalPage } from "../../components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — Kiruko",
  description:
    "The terms governing your use of the Kiruko workforce-management platform.",
};

export default function TermsOfServicePage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="20 June 2026">
      <section className="space-y-3">
        <p>
          These Terms govern your use of Kiruko, a workforce-management platform
          operated by <strong>Zilwa Eklere Ltd</strong>, a company registered in
          Mauritius (&ldquo;Kiruko&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). By
          creating an account or using the app, you agree to these Terms. If you do
          not agree, do not use the service.
        </p>
      </section>

      <section className="space-y-3">
        <h2>1. The service</h2>
        <p>
          Kiruko provides tools for employers and employees to manage payroll,
          attendance, leave, documents, and related workforce tasks. Features may
          change, improve, or be discontinued over time.
        </p>
      </section>

      <section className="space-y-3">
        <h2>2. Accounts &amp; eligibility</h2>
        <ul>
          <li>You must be at least 16 and able to form a binding contract.</li>
          <li>
            You are responsible for your credentials and for activity on your
            account. Keep your sign-in details and device secure.
          </li>
          <li>
            Accounts are typically created in the context of an employer. Your
            employer may control, access, or remove workplace data associated with
            your account.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2>3. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Break the law or infringe others&rsquo; rights using the service.</li>
          <li>Access accounts or data you are not authorised to access.</li>
          <li>Interfere with, probe, or disrupt the service or its security.</li>
          <li>Submit false attendance data or impersonate another person.</li>
          <li>Reverse engineer or copy the service except as permitted by law.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2>4. Your content</h2>
        <p>
          You retain ownership of the documents and data you submit. You grant us the
          limited rights needed to host and process that content to provide the
          service (see our <a href="/privacy">Privacy Policy</a>). You are responsible
          for the accuracy and lawfulness of what you submit.
        </p>
      </section>

      <section className="space-y-3">
        <h2>5. Payroll &amp; records</h2>
        <p>
          Kiruko helps process and present payroll and employment information, but
          your employer is responsible for the underlying figures, payments, and
          compliance with employment and tax law. Kiruko is a tool, not your
          employer, accountant, or legal adviser.
        </p>
      </section>

      <section className="space-y-3">
        <h2>6. Availability &amp; changes</h2>
        <p>
          We aim to keep the service available but do not guarantee uninterrupted
          access. We may update, suspend, or modify features, and we may update these
          Terms; continued use after changes means you accept the updated Terms.
        </p>
      </section>

      <section className="space-y-3">
        <h2>7. Termination</h2>
        <p>
          You may stop using the service and delete your account at any time from{" "}
          <strong>Settings → Delete account</strong>. We may suspend or terminate
          access if you breach these Terms or to protect the service and its users.
          Certain records may be retained as described in the Privacy Policy.
        </p>
      </section>

      <section className="space-y-3">
        <h2>8. Disclaimers &amp; liability</h2>
        <p>
          The service is provided &ldquo;as is&rdquo; without warranties of any kind
          to the maximum extent permitted by law. To the extent permitted by law,
          Kiruko and Zilwa Eklere Ltd are not liable for indirect or consequential
          losses, or for loss arising from your or your employer&rsquo;s use of the
          data presented.
        </p>
      </section>

      <section className="space-y-3">
        <h2>9. Governing law</h2>
        <p>
          These Terms are governed by the laws of Mauritius, and disputes are subject
          to the courts of Mauritius.
        </p>
      </section>

      <section className="space-y-3">
        <h2>10. Contact</h2>
        <p>
          Zilwa Eklere Ltd, Mauritius —{" "}
          <a href="mailto:hello@kiruko.mu">hello@kiruko.mu</a>
        </p>
      </section>
    </LegalPage>
  );
}
