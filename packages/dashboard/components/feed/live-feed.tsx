"use client";
import { useState, useMemo } from "react";
import { AnimatePresence } from "motion/react";
import type { HydraEvent } from "../../lib/ws";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FeedRow } from "./feed-row";
import { LLM_DRIVEN_EVENT_TYPES } from "../../lib/event-format";

type Filter = "all" | "llm";

export function LiveFeed({ events }: { events: HydraEvent[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = useMemo(
    () =>
      filter === "llm"
        ? events.filter((e) => LLM_DRIVEN_EVENT_TYPES.has(e.type))
        : events,
    [filter, events],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>Live feed</CardTitle>
          <div className="flex gap-1">
            <FilterPill
              active={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All
            </FilterPill>
            <FilterPill
              active={filter === "llm"}
              onClick={() => setFilter("llm")}
            >
              Agents
            </FilterPill>
          </div>
        </div>
        <span className="text-[10px] text-subtle font-mono">
          {filtered.length} of {events.length}
        </span>
      </CardHeader>
      <CardContent className="px-0 pt-0">
        <ul className="overflow-y-auto max-h-[calc(100vh-200px)]">
          <AnimatePresence initial={false}>
            {filtered.length === 0 ? (
              <li className="px-5 py-12 text-center text-xs text-subtle">
                {filter === "llm"
                  ? "No LLM decisions yet…"
                  : "Waiting for events…"}
              </li>
            ) : (
              filtered.map((e) => <FeedRow key={e.id} e={e} />)
            )}
          </AnimatePresence>
        </ul>
      </CardContent>
    </Card>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
        active
          ? "bg-brand-soft text-brand border-brand-ring/40"
          : "bg-elevated text-muted border-border hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
