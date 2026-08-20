import type { Metadata } from "next";
import { JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const serif = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const SITE_TITLE = "Pump Price Atlas — US gasoline prices by county";
const SITE_DESCRIPTION =
  "Retail gasoline prices for every US county with a reported figure, from AAA's daily county averages and the Alaska community fuel survey.";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Pump Price Atlas",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${mono.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="px-8 py-6 border-b border-[var(--color-rule)] sticky top-0 z-20 bg-[var(--color-paper)]">
          <div className="mx-auto max-w-6xl flex items-baseline justify-between gap-4">
            <div className="text-[10px] tracking-widest uppercase text-[var(--color-ink-soft)]">
              ppa
              <span className="text-[var(--color-ink-mute)]"> / </span>
              <span className="text-[var(--color-ink-mute)]">pump price atlas</span>
            </div>
            <span className="text-[10px] tracking-wider text-[var(--color-ink-mute)]">
              source: aaa daily &middot; census cb_2024 counties
            </span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--color-rule)] mt-24 py-6 px-8">
          <div className="mx-auto max-w-6xl text-[10px] tracking-wider text-[var(--color-ink-mute)] flex items-baseline justify-between gap-4 flex-wrap">
            <span>boundaries: us-atlas counties-10m &middot; albers usa</span>
            <span>prices: gasprices.aaa.com &middot; alaska dcced fuel survey</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
