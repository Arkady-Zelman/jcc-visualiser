"use client";

import { useState } from "react";

import { ImportVolumeChart } from "@/components/charts/import-volume-chart";
import { StockpileChart } from "@/components/charts/stockpile-chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ImportVolumeRow, StockpileChartRow, VolumeUnit } from "@/lib/flows";

interface Props {
  importVolumes: ImportVolumeRow[];
  stockpiles: StockpileChartRow[];
}

export function PhysicalFlows({ importVolumes, stockpiles }: Props) {
  const [unit, setUnit] = useState<VolumeUnit>("kbbl");

  return (
    <section className="mt-10">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Physical flows
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Import volumes
          </h2>
          <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            {unit === "kbbl"
              ? "Thousand barrels (kbbl), axes in thousands."
              : "Kilolitres (kl), axes in millions."}
          </p>
        </div>
        <Tabs value={unit} onValueChange={(v) => setUnit(v as VolumeUnit)}>
          <TabsList>
            <TabsTrigger value="kbbl">kbbl</TabsTrigger>
            <TabsTrigger value="kl">kl</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>
      <div className="grid gap-8 lg:grid-cols-2">
        {importVolumes.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Total crude imports / month
            </p>
            <ImportVolumeChart data={importVolumes} unit={unit} syncId="composition-time" />
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              Source: Japan Customs via e-Stat, HS 2709.00.900. Latest month is
              provisional.
            </p>
          </div>
        )}
        {stockpiles.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Crude stockpiles — builds and withdrawals
            </p>
            <StockpileChart data={stockpiles} unit={unit} />
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              Source: PAJ Oil Stockpiling (METI data), crude only, from 2017.
              Government withdrawals mark strategic reserve releases.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
