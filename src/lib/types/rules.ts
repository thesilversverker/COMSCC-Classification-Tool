// Logical component: shared typed data model for workbook-derived rules.
export type AnswerType = 'boolean' | 'select' | 'number' | 'text';

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
  sheetName: string;
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

/** One showroom row from the Vehicles worksheet (column N = Showroom Assessment). */
export interface VehicleCatalogRow {
  id: string;
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
  /** Workbook column N — Showroom Assessment (base points toward Total Assessment). */
  showroomAssessment: number | null;
  baseClassification: string | null;
  sourceRef: string;
}

export interface RuleCategory {
  id: string;
  label: string;
  sheetName: string;
  description?: string;
  questions: RuleQuestion[];
  /** Present on Vehicles rules-source when extracted from the showroom table. */
  vehicleCatalog?: VehicleCatalogRow[];
}

export interface RulesDocument {
  schemaVersion: '1.0.0';
  generatedAt: string;
  sourceWorkbook: string;
  categories: RuleCategory[];
}

export type RuleAnswer = boolean | number | string | null;
export type RuleAnswersByQuestionId = Record<string, RuleAnswer>;
