import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <Skeleton className="mb-4 h-3 w-24" />
      <Skeleton className="mb-3 h-9 w-72" />
      <div className="mb-8 flex gap-2">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-lg lg:col-span-2" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    </div>
  );
}
