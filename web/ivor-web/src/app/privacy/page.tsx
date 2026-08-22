import type { Metadata } from "next";
import { LegalPage } from "../../components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — Kiruko",
  description:
    "How Kiruko (Zilwa Eklere Ltd) collects, uses, and protects personal data.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="20 June 2026">
      <section className="space-y-3">
        <p>
          Kiruko (&ldquo;Kiruko&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a
          workforce-management platform operated by{" "}
          <strong>Zilwa Eklere Ltd</strong>, a company registered in Mauritius.
          This policy explains what personal data we collect, why, how we use and
          share it, and the rights you have. It applies to our mobile app and web
          app.
        </p>
        <p>
          We process personal data in line with the Mauritius Data Protection Act
          2017. For most workplace data, your employer is the data controller and
          Kiruko acts as a processor on their behalf; for your account and the
          operation of the service, Kiruko is the controller.
        </p>
      </section>

      <section className="space-y-3">
        <h2>1. Data we collect</h2>
        <ul>
          <li>
            <strong>Account &amp; identity:</strong> name, email address, phone
            number, hashed password, language and currency preferences, your role
            and the company you belong to.
          </li>
          <li>
            <strong>Employment records:</strong> job title, department, salary and
            payroll details, loans and repayments, leave requests, and the
            documents you or your employer upload.
          </li>
          <li>
            <strong>Time &amp; attendance:</strong> clock-in / clock-out and break
            times. When you clock in, we may capture your <strong>location</strong>{" "}
            and a <strong>photo</strong> to confirm workplace presence and deter PIN
            sharing.
          </li>
          <li>
            <strong>Receipts &amp; documents:</strong> images you submit for expense
            or receipt scanning, and files stored in your document vault.
          </li>
          <li>
            <strong>Device &amp; technical:</strong> a device identifier and device
            name (used to secure sign-in), platform (iOS/Android), and a
            push-notification token.
          </li>
          <li>
            <strong>Usage:</strong> in-app notifications and security audit logs
            (e.g. sign-in events).
          </li>
        </ul>
        <p>
          <strong>Biometrics:</strong> if you enable Face ID / fingerprint unlock,
          that check happens entirely on your device through the operating system.
          We never receive or store your biometric data.
        </p>
      </section>

      <section className="space-y-3">
        <h2>2. How we use data</h2>
        <ul>
          <li>To provide the service: accounts, payroll, attendance, leave, and documents.</li>
          <li>To verify attendance and prevent fraud (clock-in location and photo).</li>
          <li>To secure your account (device binding, one-time codes, audit logs).</li>
          <li>To send operational notifications you have not opted out of.</li>
          <li>To meet legal, tax, and employment-record obligations.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2>3. Sharing &amp; processors</h2>
        <p>
          We do not sell your personal data. We share it only with your employer
          (for workplace data) and with service providers who process it on our
          instructions under contract:
        </p>
        <ul>
          <li><strong>Cloud hosting &amp; storage</strong> for our servers, database, and file storage.</li>
          <li><strong>Google Cloud Vision</strong> to read text from receipt images you submit.</li>
          <li><strong>Expo</strong> to deliver push notifications to your device.</li>
          <li><strong>Email provider</strong> for transactional messages (e.g. verification, alerts).</li>
        </ul>
        <p>
          We may also disclose data where required by law or to protect our rights
          and users.
        </p>
      </section>

      <section className="space-y-3">
        <h2>4. Retention</h2>
        <p>
          We keep personal data for as long as your account is active. When you
          delete your account, we disable sign-in and remove or anonymise your
          personal identifiers and uploads. Some records — such as payroll and
          employment history — must be retained by your employer to satisfy legal
          and tax obligations, even after deletion.
        </p>
      </section>

      <section className="space-y-3">
        <h2>5. Your rights</h2>
        <p>
          Subject to applicable law, you can access, correct, or request deletion of
          your personal data, object to or restrict certain processing, and request
          a copy of the data you provided.
        </p>
        <p>
          You can delete your account at any time from{" "}
          <strong>Settings → Delete account</strong> in the app. For other requests,
          or to reach your employer (the controller for workplace data), contact us
          below.
        </p>
      </section>

      <section className="space-y-3">
        <h2>6. Security</h2>
        <p>
          We protect data in transit with encryption (HTTPS/TLS), encrypt sensitive
          data stored on your device, and restrict access to personal data. No
          system is perfectly secure, but we work to safeguard your information.
        </p>
      </section>

      <section className="space-y-3">
        <h2>7. Children</h2>
        <p>
          Kiruko is a workplace tool and is not directed to children. We do not
          knowingly collect data from anyone under 16.
        </p>
      </section>

      <section className="space-y-3">
        <h2>8. Changes</h2>
        <p>
          We may update this policy from time to time. We will revise the
          &ldquo;last updated&rdquo; date above and, where appropriate, notify you in
          the app.
        </p>
      </section>

      <section className="space-y-3">
        <h2>9. Contact</h2>
        <p>
          Zilwa Eklere Ltd, Mauritius —{" "}
          <a href="mailto:hello@kiruko.mu">hello@kiruko.mu</a>
        </p>
      </section>
    </LegalPage>
  );
}
