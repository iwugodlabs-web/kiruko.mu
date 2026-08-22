import Link from "next/link";

/**
 * Branded shell for legal/static pages (Privacy, Terms). Renders the Kiruko
 * header + footer chrome and styles the prose so page content can be plain
 * semantic HTML (h2 / p / ul / a / strong).
 */
export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    // h-dvh + overflow-y-auto: the app shell locks <body> to overflow-hidden,
    // so this page needs to be its own scroll container.
    // These are always-light document pages. The dashboard ships global
    // `.dark p` / `.dark h1-h4` rules that recolor bare elements to light text
    // (invisible on the white card), so force dark text with `!` utilities that
    // out-specify those rules in both light and dark system themes.
    <main className="h-dvh overflow-y-auto bg-gray-50">
      {/* Top bar */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/kiruko-mark.png"
              alt=""
              className="h-9 w-9 object-contain"
            />
            <span className="font-display text-xl font-bold !text-gray-900">
              Kiruko
            </span>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="mx-auto max-w-4xl px-6 pt-12 pb-6">
        <div className="h-1 w-12 rounded-full bg-primary-500" />
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight !text-gray-900 sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm !text-gray-500">Last updated: {lastUpdated}</p>
      </div>

      {/* Content card */}
      <div className="mx-auto max-w-4xl px-6 pb-16">
        <article
          className="space-y-8 rounded-2xl border border-gray-200 bg-white p-6 text-[15px] leading-7 shadow-sm sm:p-10
            [&_a]:font-semibold [&_a]:!text-primary-700 [&_a]:underline [&_a]:underline-offset-2
            [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:!text-gray-900
            [&_li]:!text-gray-700
            [&_p]:!text-gray-700
            [&_strong]:!text-gray-900
            [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5"
        >
          {children}
        </article>

        {/* Footer */}
        <footer className="mt-8 flex flex-col items-center gap-2 text-sm !text-gray-500">
          <div className="flex items-center gap-3">
            <Link href="/privacy" className="transition-colors hover:text-gray-700">
              Privacy
            </Link>
            <span aria-hidden>·</span>
            <Link href="/terms" className="transition-colors hover:text-gray-700">
              Terms
            </Link>
          </div>
          <span>© 2026 Kiruko · Zilwa Eklere Ltd · Mauritius</span>
        </footer>
      </div>
    </main>
  );
}
