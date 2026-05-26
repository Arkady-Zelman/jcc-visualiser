import Markdown from "react-markdown";

import type { EventRow } from "@/lib/composition";

interface Props {
  event: EventRow;
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

function fmtDate(iso: string): string {
  // iso = "2018-05-08"; safe to parse as UTC then format.
  const d = new Date(iso + "T00:00:00Z");
  return DATE_FMT.format(d);
}

export function EventCard({ event }: Props) {
  return (
    <div className="space-y-3 text-sm">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {event.category.replace("_", " ")}
        </p>
        <h3 className="text-base font-semibold leading-tight text-zinc-950 dark:text-zinc-50">
          {event.title}
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {fmtDate(event.date_from)}
          {event.date_to ? ` – ${fmtDate(event.date_to)}` : ""}
        </p>
      </header>

      <div className="prose prose-sm dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300">
        <Markdown>{event.description_md}</Markdown>
      </div>

      {event.impact_grades.length > 0 && (
        <div className="text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Impact: </span>
          <span className="font-mono text-zinc-700 dark:text-zinc-300">
            {event.impact_grades.join(", ")}
          </span>
        </div>
      )}

      {event.sources.length > 0 && (
        <div className="text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Sources: </span>
          <ul className="mt-0.5 space-y-0.5">
            {event.sources.map((src) => (
              <li key={src}>
                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-blue-600 hover:underline dark:text-blue-400"
                >
                  {src}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
