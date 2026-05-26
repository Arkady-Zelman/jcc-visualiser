"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function CurveError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("/curve error:", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
      <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
        Couldn't load the curve view
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{error.message}</p>
      <Button className="mt-6" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
