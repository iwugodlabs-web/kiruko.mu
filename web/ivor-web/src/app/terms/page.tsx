import type { Metadata } from "next";
import { LegalPage } from "../../components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service & Privacy Policy — Kiruko",
  description:
    "The Unified Terms of Service and Privacy Policy governing your use of Kiruko, operated by Zilwa Eklere Ltd.",
};

export default function TermsOfServicePage() {
  return (
    <LegalPage
      title="Unified Terms of Service & Privacy Policy"
      lastUpdated="23 August 2026"
    >
      <section className="space-y-3">
        <p>
          <strong>Contact:</strong>{" "}
          <a href="mailto:hello@kiruko.mu">hello@kiruko.mu</a> · WhatsApp: +230
          5719 4590
        </p>
      </section>

      {/* Preamble */}
      <section className="space-y-3">
        <h2>Preamble</h2>
        <p>
          Kiruko is a comprehensive Human Resource Management System (HRMS) that
          provides an all-in-one service where attendance recording, payroll
          calculation, leave management, task allocation, and overall human
          resource administration are consolidated into a single, unified
          application.
        </p>
        <p>
          The fundamental particularity of Kiruko lies in its dual-engagement
          model: it actively involves both the workforce
          (users/employees/service providers) and the company&rsquo;s management
          in the HR process. Specifically, Kiruko transfers the primary duty of
          attendance recording and task execution tracking directly to the user.
          This means that the accuracy, completeness, and integrity of the data
          entered&mdash;including clock-in/out times, task confirmations, and
          leave requests&mdash;rests entirely with the user.
        </p>
        <p>
          As a direct consequence of this architecture, it is the sole
          responsibility of the user to provide precise, truthful, and timely
          data to the application. Kiruko generates salary estimates, leave
          accruals, bonus calculations, and other connected benefits strictly
          based on these user-provided inputs. The employer relies in good faith
          upon this data for processing payments, granting benefits, and making
          operational decisions.
        </p>
        <p>
          By using Kiruko, both the employer and the user explicitly acknowledge
          and agree that:
        </p>
        <ul>
          <li>
            The salary estimates, leave entitlements, and bonus computations
            displayed within the application are indicative estimates and are
            contingent upon the accuracy of the data submitted by the user.
          </li>
          <li>
            Any discrepancy, omission, delay, or inaccuracy in the user&rsquo;s
            entries may directly and materially impact the user&rsquo;s
            remuneration, benefits, or employment-related entitlements.
          </li>
          <li>
            The user accepts full and exclusive liability for the accuracy of all
            data they input. Kiruko acts solely as a data-processing tool and does
            not verify the factual correctness of user-submitted information.
          </li>
          <li>
            The employer retains the final authority to validate, adjust, or
            reject any payroll or benefit calculations that are based on
            manifestly incorrect user data.
          </li>
        </ul>
      </section>

      {/* Part 1 — Terms of Service */}
      <section className="space-y-3">
        <h2>Part 1 &mdash; Terms of Service</h2>
      </section>

      <section className="space-y-3">
        <h3>1. Acceptance</h3>
        <p>
          By accessing, registering, or using the Kiruko mobile application, web
          dashboard, or marketing website (collectively, the &ldquo;Service&rdquo;),
          you agree to be bound by these Terms of Service and our Privacy Policy.
          If you are using the Service on behalf of an organization (e.g., an
          employer), you represent and warrant that you have the authority to bind
          that organization to these Terms. If you do not agree, you must refrain
          from using the Service.
        </p>
      </section>

      <section className="space-y-3">
        <h3>2. The Service</h3>
        <p>
          Kiruko provides workforce-management tools including, but not limited
          to:
        </p>
        <ul>
          <li>Attendance and time tracking (GPS-enabled clock-in/out);</li>
          <li>Scheduling and task allocation;</li>
          <li>Leave management (requests and approvals);</li>
          <li>Payroll calculation, payslip generation, and overtime computation;</li>
          <li>Live earnings tracking and financial estimation;</li>
          <li>Incident reporting (&ldquo;Rights&rdquo; module); and</li>
          <li>Document vault and receipt scanning.</li>
        </ul>
        <p>
          We reserve the right to modify, improve, or discontinue any feature at
          our sole discretion, with reasonable notice where practicable.
        </p>
      </section>

      <section className="space-y-3">
        <h3>3. Accounts &amp; Eligibility</h3>
        <ul>
          <li>
            <strong>Age Requirement:</strong> You must be at least 16 years old
            (or the legal working age in your jurisdiction) and capable of forming
            a binding contract.
          </li>
          <li>
            <strong>Security:</strong> You are responsible for safeguarding your
            login credentials and for all activity conducted under your account.
            You agree to notify us immediately of any unauthorized use.
          </li>
          <li>
            <strong>Accuracy:</strong> You must provide accurate, complete, and
            up-to-date registration information.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3>4. Employer &amp; Employee Relationship (Crucial Provisions)</h3>
        <ul>
          <li>
            <strong>Employer Responsibilities (Controller):</strong> Where an
            employer (&ldquo;Company&rdquo;) uses Kiruko to manage its workforce,
            the Company is solely responsible for:
            <ul>
              <li>
                The accuracy and lawfulness of the payroll, tax, and employment
                data it enters;
              </li>
              <li>
                Complying with all applicable labour, payroll, tax, and
                data-protection laws (including the Mauritian Data Protection Act
                2017);
              </li>
              <li>
                Obtaining all necessary consents from its employees to use their
                data via Kiruko;
              </li>
              <li>
                Managing user roles, permissions, and internal Standard Operating
                Procedures (SOPs). Kiruko provides suggested guides and templates,
                but it is the employer&rsquo;s duty to adopt and enforce them.
              </li>
            </ul>
          </li>
          <li>
            <strong>Employee Responsibilities (Data Provider):</strong> Employees
            and service providers are responsible for the accuracy of their
            clock-in/out data, task completion reports, and leave requests.
          </li>
          <li>
            <strong>Indemnification:</strong> The Employer agrees to indemnify and
            hold harmless Zilwa Eklere Ltd against any claims, penalties, or
            liabilities arising from the Employer&rsquo;s violation of labour laws,
            tax obligations, or misuse of employee data.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3>5. Acceptable Use</h3>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose or to violate any applicable law;</li>
          <li>Impersonate another person or submit false attendance or payroll data;</li>
          <li>Attempt to gain unauthorized access to the Service, user accounts, or data;</li>
          <li>
            Reverse-engineer, decompile, or copy the Service&rsquo;s source code or
            underlying architecture;
          </li>
          <li>Upload malicious code, viruses, or infringing content;</li>
          <li>Interfere with the security, integrity, or performance of the Service.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3>6. Fees, Billing &amp; Free Trial</h3>
        <ul>
          <li>
            <strong>Free Trial:</strong> New users (individuals or employers) are
            granted a free trial for a period of three (3) months from the date of
            registration. This allows full exploration of the core features.
          </li>
          <li>
            <strong>Paid Subscription:</strong> Upon expiry of the free trial,
            continued use of the Service requires payment of the applicable
            subscription fees. The standard license is billed annually at Rs 50,000
            (exclusive of VAT) per employer entity, or as otherwise agreed in
            writing between Zilwa Eklere Ltd and the Client.
          </li>
          <li>
            <strong>Training &amp; Setup:</strong> Additional fees may apply for
            dedicated on-site training, data migration, or custom configuration.
            Non-payment of agreed fees may result in suspension or termination of
            access.
          </li>
          <li>
            <strong>Refund Policy:</strong> Unless expressly stated otherwise
            (e.g., a statutory cooling-off period), fees paid are non-refundable.
            Zilwa Eklere Ltd reserves the right to adjust pricing for renewals upon
            providing at least 30 days&rsquo; prior notice.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3>7. Intellectual Property</h3>
        <ul>
          <li>
            <strong>Ownership:</strong> The Service, including its software,
            algorithms, architecture, design, user interface, logos, and branding
            (&ldquo;Kiruko&rdquo;), is the exclusive intellectual property of Zilwa
            Eklere Ltd and is protected by Mauritian and international copyright
            laws.
          </li>
          <li>
            <strong>License:</strong> We grant you a limited, non-exclusive,
            non-transferable, revocable license to use the Service in accordance
            with these Terms.
          </li>
          <li>
            <strong>Restrictions:</strong> Any unauthorized reproduction,
            distribution, creation of derivative works, or copying of the
            functionalities available within Kiruko is strictly prohibited and may
            result in legal prosecution.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3>8. Third-Party Services</h3>
        <p>
          The Service may integrate with third-party providers (e.g., cloud
          hosting, Google Cloud Vision for OCR, payment gateways, messaging
          services). Your use of these integrated services may be subject to their
          respective terms and policies. Zilwa Eklere Ltd assumes no responsibility
          or liability for the performance of these external providers.
        </p>
      </section>

      <section className="space-y-3">
        <h3>9. Disclaimers</h3>
        <p>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
          AVAILABLE&rdquo;, WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS,
          IMPLIED, OR STATUTORY, TO THE MAXIMUM EXTENT PERMITTED BY LAW. WE DO NOT
          WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR THAT
          CALCULATIONS (INCLUDING PAYROLL AND TAX ESTIMATES) WILL BE ABSOLUTELY
          ACCURATE OR MEET EVERY LEGAL REQUIREMENT. USERS AND EMPLOYERS ARE
          RESPONSIBLE FOR VERIFYING ALL OUTPUTS. KIRUKO IS A FACILITATIVE TOOL AND
          DOES NOT CONSTITUTE A LEGAL, ACCOUNTING, OR EMPLOYMENT ADVISORY SERVICE.
        </p>
      </section>

      <section className="space-y-3">
        <h3>10. Limitation of Liability</h3>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY MAURITIAN LAW, ZILWA EKLERE LTD AND
          ITS DIRECTORS, OFFICERS, AND EMPLOYEES SHALL NOT BE LIABLE FOR ANY
          INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR
          LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL. OUR TOTAL AGGREGATE
          LIABILITY ARISING OUT OF OR RELATING TO THE SERVICE SHALL NOT EXCEED THE
          TOTAL FEES PAID BY YOU TO US FOR THE SERVICE DURING THE TWELVE (12)
          MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM.
        </p>
      </section>

      <section className="space-y-3">
        <h3>11. Termination</h3>
        <ul>
          <li>
            <strong>By User:</strong> You may terminate your account and request
            deletion of your personal data at any time via Settings &rarr; Delete
            Account, or by contacting{" "}
            <a href="mailto:hello@kiruko.mu">hello@kiruko.mu</a>.
          </li>
          <li>
            <strong>By Us:</strong> We may suspend or terminate your access
            immediately if you breach these Terms, fail to pay fees, or if we
            believe termination is necessary to protect the Service or other users.
          </li>
          <li>
            <strong>Survival:</strong> Provisions regarding Intellectual Property,
            Disclaimers, Limitation of Liability, Indemnification, and Governing
            Law shall survive termination.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3>12. Governing Law &amp; Dispute Resolution</h3>
        <ul>
          <li>
            <strong>Jurisdiction:</strong> These Terms shall be governed by and
            construed in accordance with the laws of the Republic of Mauritius.
          </li>
          <li>
            <strong>Disputes:</strong> Any dispute arising under these Terms shall
            first be referred to mediation or amicable negotiation between the
            parties for a period of 30 days. If unresolved, the dispute shall be
            submitted to the exclusive jurisdiction of the courts of Mauritius.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3>13. Contact</h3>
        <p>
          For any inquiries, complaints, or to exercise your legal rights, please
          contact:
        </p>
        <p>
          Zilwa Eklere Ltd
          <br />
          Email: <a href="mailto:hello@kiruko.mu">hello@kiruko.mu</a>
          <br />
          WhatsApp: +230 5719 4590
        </p>
      </section>

      {/* Part 2 — Privacy Policy */}
      <section className="space-y-3">
        <h2>Part 2 &mdash; Privacy Policy</h2>
      </section>

      <section className="space-y-3">
        <h3>1. Who We Are &amp; Data Controller Roles</h3>
        <p>
          Kiruko is operated by Zilwa Eklere Ltd, a company registered in
          Mauritius. For the purposes of the Mauritian Data Protection Act 2017:
        </p>
        <ul>
          <li>
            <strong>For employee/worker data:</strong> Your Employer acts as the
            Data Controller. Kiruko acts as a Data Processor, processing data
            strictly on the documented instructions of the Employer.
          </li>
          <li>
            <strong>For account data, billing, and security:</strong> Kiruko acts
            as an independent Data Controller to manage your account, send
            notifications, and secure the platform.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3>2. Data We Collect</h3>
        <ul>
          <li>
            <strong>Account Information:</strong> Name, email address, phone
            number, hashed password, preferred language, and role.
          </li>
          <li>
            <strong>Workplace Data:</strong> Job title, department, payroll details
            (salary, allowances, deductions), leave requests and balances,
            clock-in/out records (including GPS location and optional photo
            verification), and task completion history.
          </li>
          <li>
            <strong>Documents:</strong> Uploaded receipts, payslips, or supporting
            documents (which may be scanned via OCR for data extraction).
          </li>
          <li>
            <strong>Device &amp; Usage:</strong> Device type/OS, push notification
            tokens, app version, and security audit logs (e.g., logins and critical
            actions).
          </li>
          <li>
            <strong>Website Analytics:</strong> We use Umami Analytics on our
            marketing website&mdash;a cookieless, privacy-first tool that collects
            aggregate data (page views, referrers, country level) without
            identifying individual users. No personal data is collected there.
          </li>
        </ul>
        <p>
          <strong>Biometrics:</strong> If you enable Face ID or Fingerprint unlock,
          the verification occurs entirely on your local device via your operating
          system. Kiruko never receives, stores, or processes your biometric data.
        </p>
      </section>

      <section className="space-y-3">
        <h3>3. How We Use Data</h3>
        <p>We process personal data solely to:</p>
        <ul>
          <li>Provide and improve the Service (attendance, payroll, scheduling, notifications);</li>
          <li>Authenticate users and secure accounts;</li>
          <li>Calculate pay, overtime, and statutory amounts;</li>
          <li>Send operational alerts (e.g., clock-in reminders, expiry notices);</li>
          <li>Comply with legal, tax, and audit obligations;</li>
          <li>Detect, prevent, and investigate fraud or security incidents.</li>
        </ul>
        <p>We do not sell your personal data to third parties.</p>
      </section>

      <section className="space-y-3">
        <h3>4. Sharing &amp; Disclosure</h3>
        <p>We share data only:</p>
        <ul>
          <li>
            <strong>With your Employer:</strong> Accessible to authorized
            administrators for workforce management.
          </li>
          <li>
            <strong>With Service Providers:</strong> Vetted vendors (e.g., cloud
            hosting via Google Cloud, OVH; file scanning; email delivery; push
            notifications via Expo), bound by strict confidentiality and processing
            agreements.
          </li>
          <li>
            <strong>Legal Obligations:</strong> Where required by Mauritian law,
            court order, or to protect the rights, property, or safety of Kiruko,
            our users, or the public.
          </li>
          <li>
            <strong>Business Transfers:</strong> In the event of a merger,
            acquisition, or asset sale, subject to the same privacy protections.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3>5. Retention &amp; Deletion</h3>
        <ul>
          <li>
            <strong>Active Use:</strong> Data is retained while your account is
            active and as needed to provide the Service.
          </li>
          <li>
            <strong>Deletion:</strong> Upon account deletion, we remove or anonymize
            your personal identifiers and uploaded files. However, certain records
            (specifically, payroll and attendance logs) may be retained by your
            Employer to satisfy statutory retention periods (e.g., up to 7 years for
            tax and labour compliance). Security and audit logs may also be retained
            for a limited period for forensic purposes.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3>6. Your Rights (Data Subject Rights)</h3>
        <p>Subject to the Data Protection Act 2017, you have the right to:</p>
        <ul>
          <li>Access your personal data;</li>
          <li>Correct inaccurate or incomplete data;</li>
          <li>Request Deletion of your data (subject to employer retention obligations);</li>
          <li>Export a copy of your data (portability);</li>
          <li>Object to or restrict certain processing (e.g., direct marketing).</li>
        </ul>
        <p>
          For employee data managed by your employer, we may direct your request to
          them. To exercise your rights, contact us at{" "}
          <a href="mailto:hello@kiruko.mu">hello@kiruko.mu</a>.
        </p>
      </section>

      <section className="space-y-3">
        <h3>7. Security</h3>
        <p>We implement industry-standard safeguards, including:</p>
        <ul>
          <li>Encryption in transit (HTTPS/TLS);</li>
          <li>Hashed and salted passwords;</li>
          <li>Role-based access control (RBAC);</li>
          <li>Trusted-device sign-in verification;</li>
          <li>Append-only audit trails for sensitive actions;</li>
          <li>Malware scanning for uploaded files.</li>
        </ul>
        <p>
          While no system is 100% secure, we continuously update our measures to
          protect your data.
        </p>
      </section>

      <section className="space-y-3">
        <h3>8. International Transfers</h3>
        <p>
          We are based in Mauritius and primarily serve the Mauritian market (with
          expansions to Madagascar, Tanzania, and the wider region). Some service
          providers may process data outside Mauritius; we ensure that any such
          transfers comply with applicable law by imposing Standard Contractual
          Clauses or equivalent safeguards.
        </p>
      </section>

      <section className="space-y-3">
        <h3>9. Children</h3>
        <p>
          Kiruko is a workplace tool intended for employers and working
          individuals. It is not directed at children under the age of 16. We do
          not knowingly collect data from minors under 16. If we become aware of
          such data, we will delete it promptly.
        </p>
      </section>

      <section className="space-y-3">
        <h3>10. Changes to this Policy</h3>
        <p>
          We may update these Terms and Privacy Policy from time to time. We will
          post the updated version with a revised &ldquo;Last Updated&rdquo; date
          and, where appropriate, notify users via in-app alert or email.
        </p>
      </section>

      <section className="space-y-3">
        <h3>11. Contact for Privacy Concerns</h3>
        <p>For any privacy-related questions or to report a data breach, contact:</p>
        <p>
          Data Protection Officer (DPO) &ndash; Zilwa Eklere Ltd
          <br />
          Email: <a href="mailto:hello@kiruko.mu">hello@kiruko.mu</a>
          <br />
          WhatsApp: +230 5719 4590
        </p>
      </section>
    </LegalPage>
  );
}
