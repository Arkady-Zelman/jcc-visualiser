import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-7 py-8">
      <Skeleton className="mb-4 h-8 w-64" />
      <Skeleton className="mb-6 h-4 w-96" />
      <Skeleton className="h-[500px] w-full rounded-lg" />
    </div>
  );
}
