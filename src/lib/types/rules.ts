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

export interface RuleCategory {
  id: string;
  label: string;
  sheetName: string;
  description?: string;
  questions: RuleQuestion[];
}

export interface RulesDocument {
  schemaVersion: '1.0.0';
  generatedAt: string;
  sourceWorkbook: string;
  categories: RuleCategory[];
}

export type RuleAnswer = boolean | number | string | null;
export type RuleAnswersByQuestionId = Record<string, RuleAnswer>;
