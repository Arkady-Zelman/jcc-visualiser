import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function GradeNotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
      <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
        Grade not found
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        This grade id isn't in our master list yet.
      </p>
      <Link href="/grades" className={buttonVariants({ className: "mt-6" })}>
        Back to all grades
      </Link>
    </div>
  );
}
