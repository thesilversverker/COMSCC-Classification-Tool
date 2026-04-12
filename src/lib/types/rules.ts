// Logical component: shared typed data model for workbook-derived rules.
export type AnswerType = 'boolean' | 'select' | 'number' | 'text' | 'formula';

export interface RuleOption {
  id: string;
  label: string;
  points?: number;
}

export interface RuleQuestion {
  id: string;
  prompt: string;
  /** UI grouping within the category (e.g. Brakes → ABS). */
  subcategory: string;
  answerType: AnswerType;
  helpText?: string;
  /** Legacy workbook column; optional in rules-source. */
  sheetName?: string;
  sourceRef?: string;
  defaultValue?: boolean | number | string;
  options?: RuleOption[];
  optionsByParent?: Record<string, RuleOption[]>;
  dependsOn?: string;
  placeholder?: string;
  numericOnly?: boolean;
  digits?: number;
  readOnly?: boolean;
  /** Assessed points when this checkbox is selected (null if user must enter manually). */
  pointValue?: number | null;
  /** When true, show a numeric field for points if workbook assessment is non-numeric (e.g. Dyno). */
  needsManualPoints?: boolean;
}

/** Merged open-vehicle-db row + optional COMSCC workbook enrichment. */
export interface VehicleCatalogRow {
  id: string;
  makeSlug: string;
  makeName: string;
  modelKey: string;
  modelName: string;
  year: number;
  trimKey: string | null;
  trimLabel: string | null;
  comsccMatched: boolean;
  comsccCatalogId: string | null;
  /** Display aliases (usually same as makeName / modelName). */
  make: string;
  model: string;
  startYear: number | null;
  endYear: number | null;
  showroomBaseWeightLbs: number | null;
  factoryRatedHp: number | null;
  factoryRatedTorqueLbFt: number | null;
  powerBlend: number | null;
  weightPerPower: number | null;
  scaledWeightPerPower: number | null;
  suspIndex: number | null;
  performanceAdjustment: number | null;
  /** COMSCC Showroom Assessment when matched; otherwise null → manual entry. */
  showroomAssessment: number | null;
  /** T5–T1 from showroom assessment using the same point bands as the modification tier strip (set at compose time). */
  baseClassification: string | null;
  sourceRef?: string | null;
}

export interface RuleCategory {
  id: string;
  label: string;
  sheetName?: string;
  description?: string;
  questions: RuleQuestion[];
  /** Present on Vehicles rules-source when extracted from the showroom table. */
  vehicleCatalog?: VehicleCatalogRow[];
}

export interface RulesDocument {
  schemaVersion: '1.0.0';
  generatedAt?: string;
  sourceWorkbook?: string;
  categories: RuleCategory[];
}

export type RuleAnswer = boolean | number | string | null;
export type RuleAnswersByQuestionId = Record<string, RuleAnswer>;
