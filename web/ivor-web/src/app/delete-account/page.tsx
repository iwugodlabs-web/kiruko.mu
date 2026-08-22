import type { Metadata } from "next";
import { LegalPage } from "../../components/LegalPage";

export const metadata: Metadata = {
  title: "Delete Your Account — Kiruko",
  description:
    "How to request deletion of your Kiruko account and associated data, what is deleted, and what is retained.",
};

export default function DeleteAccountPage() {
  return (
    <LegalPage title="Delete Your Account" lastUpdated="3 July 2026">
      <section className="space-y-3">
        <p>
          This page explains how to delete your <strong>Kiruko</strong> account —
          the workforce-management app operated by <strong>Zilwa Eklere Ltd</strong>,
          a company registered in Mauritius — and what happens to your data when
          you do.
        </p>
      </section>

      <section className="space-y-3">
        <h2>Delete your account from the app</h2>
        <ol>
          <li>Open the Kiruko app and sign in.</li>
          <li>
            Go to <strong>Settings</strong>.
          </li>
          <li>
            Tap <strong>Delete account</strong>.
          </li>
          <li>
            Confirm when prompted. Your account is deleted right away and you are
            signed out.
          </li>
        </ol>
        <p>
          If you own a company that still has other members, you&apos;ll be asked
          to transfer ownership or remove your team first, so that no employee is
          left without an employer.
        </p>
      </section>

      <section className="space-y-3">
        <h2>Request deletion by email</h2>
        <p>
          If you can&apos;t access the app — for example, you&apos;ve uninstalled
          it or can&apos;t sign in — email{" "}
          <strong>hello@kiruko.mu</strong> from the email address on your account
          and ask us to delete it. We may ask you to verify that you own the
          account before we proceed, and we aim to action verified requests within
          30 days.
        </p>
      </section>

      <section className="space-y-3">
        <h2>What is deleted</h2>
        <ul>
          <li>
            Your login is disabled and your personal identifiers — name, email
            address, phone number and password — are permanently scrubbed.
          </li>
          <li>
            Documents and receipt images you uploaded, together with the
            underlying files, are deleted.
          </li>
          <li>Your notifications and active sessions are purged.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2>What is retained, and for how long</h2>
        <p>
          Employment, payroll and audit records that your employer is legally
          required to keep — for example under Mauritian tax and labour law — are{" "}
          <strong>retained but de-identified</strong>: they no longer identify you
          personally and link only to an anonymized record. These are kept for the
          period required by applicable law and then removed.
        </p>
        <p>
          For these workplace records Kiruko acts as a processor on behalf of your
          employer, who is the data controller. See our{" "}
          <a href="/privacy">Privacy Policy</a> for full details on how data is
          handled.
        </p>
      </section>

      <section className="space-y-3">
        <h2>Questions</h2>
        <p>
          For anything about account or data deletion, contact us at{" "}
          <strong>hello@kiruko.mu</strong>.
        </p>
      </section>
    </LegalPage>
  );
}
