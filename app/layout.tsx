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
  // Open Graph needs absolute URLs. Without a base, the generated card's path is
  // emitted relative and most scrapers simply drop it, which is indistinguishable
  // from having no card at all. Vercel supplies the deployment host in CI; the
  // production domain is the fallback so local builds still emit something sane.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "https://oil-visualizer.vercel.app"),
  ),
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
