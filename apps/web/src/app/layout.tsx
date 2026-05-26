import type { Metadata } from "next";
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

function TopNav() {
  return (
    <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
        >
          JCC Visualiser
        </Link>
        <ul className="flex items-center gap-6 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            <Link
              href="/composition"
              className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
            >
              Composition
            </Link>
          </li>
          <li>
            <Link
              href="/grades"
              className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
            >
              Grades
            </Link>
          </li>
          <li>
            <Link
              href="/curve"
              className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
            >
              Curve
            </Link>
          </li>
        </ul>
      </nav>
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-zinc-50 dark:bg-zinc-950">
        <TooltipProvider delay={150}>
          <TopNav />
          <main className="flex flex-1 flex-col">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  );
}
