import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JCC Visualiser",
  description:
    "Research and explanation tool for the Japan Crude Cocktail — composition, prices, and forward curve.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[linear-gradient(180deg,rgba(15,15,18,0.78),rgba(15,15,18,0.62))] backdrop-blur-[18px] backdrop-saturate-[1.2] shadow-[0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mx-auto flex h-[60px] w-full max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-7">
        <nav className="flex items-center gap-3 text-sm sm:gap-6">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-2.5 font-semibold tracking-tight text-zinc-50"
          >
            <span
              aria-hidden
              className="inline-block size-2 rounded-full bg-[radial-gradient(circle_at_30%_30%,#fda4af,#be123c_70%)] shadow-[0_0_8px_rgba(244,63,94,0.55)]"
            />
            <span className="sm:hidden">JCC</span>
            <span className="hidden sm:inline">JCC Visualiser</span>
          </Link>
          <ul className="flex items-center gap-3 text-xs text-neutral-400 sm:gap-5 sm:text-sm">
            <li>
              <Link
                href="/composition"
                className="transition-colors hover:text-neutral-100"
              >
                Composition
              </Link>
            </li>
            <li>
              <Link
                href="/grades"
                className="transition-colors hover:text-neutral-100"
              >
                Grades
              </Link>
            </li>
            <li>
              <Link
                href="/curve"
                className="transition-colors hover:text-neutral-100"
              >
                Curve
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col">
        <TooltipProvider delay={150}>
          <TopNav />
          <main className="relative z-10 flex flex-1 flex-col">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  );
}
