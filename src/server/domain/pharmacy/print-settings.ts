import { z } from 'zod';

/**
 * Printing settings per workstation (phase 7, R7-8), kept in `PhSettings.print` (JSON, no migration). A workstation is a name the
 * person gives the counter or the computer ("Counter 1"); each has its own paper, margins, default label size and whether a
 * label shows the price. Every shape is strict: a key not listed here is refused, and numbers have bounds. Nothing here is
 * personal data. A stored value that no longer fits reads as "no settings", never as an error.
 */

export const PAPERS = ['A4', 'A5'] as const;
export const LABEL_SIZES = ['40x25', '50x30', '58'] as const;
export type Paper = (typeof PAPERS)[number];
export type LabelSize = (typeof LABEL_SIZES)[number];

export const MARGIN_MIN_MM = 0;
export const MARGIN_MAX_MM = 40;
export const MAX_WORKSTATIONS = 20;
export const WORKSTATION_NAME_MAX = 40;

const margin = z
  .number('Enter a margin from 0 to 40 mm')
  .int('Enter a margin from 0 to 40 mm')
  .min(MARGIN_MIN_MM, 'Enter a margin from 0 to 40 mm')
  .max(MARGIN_MAX_MM, 'Enter a margin from 0 to 40 mm');

export const workstationSettings = z
  .object({
    paper: z.enum(PAPERS, 'Choose a paper size'),
    marginMm: z.object({ top: margin, right: margin, bottom: margin, left: margin }).strict(),
    labelSize: z.enum(LABEL_SIZES, 'Choose a label size'),
    showPrice: z.boolean(),
  })
  .strict();
export type WorkstationSettings = z.infer<typeof workstationSettings>;

export const workstationName = z
  .string()
  .trim()
  .min(1, 'Name this workstation in up to 40 characters')
  .max(WORKSTATION_NAME_MAX, 'Name this workstation in up to 40 characters');

export const printSettings = z
  .object({ workstations: z.record(workstationName, workstationSettings) })
  .strict()
  .refine((value) => Object.keys(value.workstations).length <= MAX_WORKSTATIONS, { message: 'Use at most 20 workstations', path: ['workstations'] });
export type PrintSettings = z.infer<typeof printSettings>;

export const DEFAULT_WORKSTATION: WorkstationSettings = {
  paper: 'A4',
  marginMm: { top: 10, right: 10, bottom: 10, left: 10 },
  labelSize: '50x30',
  showPrice: true,
};

export const EMPTY_PRINT_SETTINGS: PrintSettings = { workstations: {} };

/** What is stored, read safely: anything that is not a valid settings object is "none yet". */
export function readPrintSettings(stored: unknown): PrintSettings {
  const parsed = printSettings.safeParse(stored);
  return parsed.success ? parsed.data : { workstations: {} };
}

/** The settings of one workstation, or the defaults when it has none. */
export function settingsOfWorkstation(all: PrintSettings, name: string): WorkstationSettings {
  return all.workstations[name.trim()] ?? DEFAULT_WORKSTATION;
}

/** The stored value with one workstation set; refused (zod error) when it would hold more than the allowed number. */
export function withWorkstation(all: PrintSettings, name: string, value: WorkstationSettings): PrintSettings {
  return printSettings.parse({ workstations: { ...all.workstations, [workstationName.parse(name)]: workstationSettings.parse(value) } });
}
