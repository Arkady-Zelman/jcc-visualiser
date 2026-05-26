"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ViewMode } from "@/lib/composition";

interface Props {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: Props) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as ViewMode)}>
      <TabsList>
        <TabsTrigger value="grade">By grade</TabsTrigger>
        <TabsTrigger value="origin">By origin</TabsTrigger>
        <TabsTrigger value="region">By region</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
