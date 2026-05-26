import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <Skeleton className="mb-4 h-8 w-72" />
      <Skeleton className="mb-6 h-4 w-96" />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Skeleton className="h-[480px] w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
        <Skeleton className="h-[680px] w-full rounded-lg" />
      </div>
    </div>
  );
}
