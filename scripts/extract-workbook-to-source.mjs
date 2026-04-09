import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import { assignSubcategory } from './assign-subcategory.mjs';

// Logical component: paths and extraction targets.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const workbookPath =
  process.argv[2] ??
  path.resolve('/home/sysadmin/Downloads/COMSCC-2027-Touring-Classification-Tool_V2.01_TEST-SHEET.xlsx');
const sourceOutputDir = path.join(repoRoot, 'rules-source');

/** Sheets that use Assessment (col B) + Description (col C) worksheet rows. */
const CHECKBOX_SHEET_NAMES = ['Engine', 'Drivetrain', 'Suspension', 'Brakes', 'Exterior'];

/** Legacy text extraction for reference (Vehicles / Tires differ from modification tables). */
const LEGACY_SHEET_NAMES = ['Vehicles', 'Tires', 'Weight'];

const ALL_SHEETS = [...CHECKBOX_SHEET_NAMES, ...LEGACY_SHEET_NAMES];

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function inferAnswerType(text) {
  const source = text.toLowerCase();
  if (source.includes('yes/no') || source.includes('true/false') || source.includes('select or true')) return 'boolean';
  if (source.includes('select') || source.includes('choose')) return 'select';
  if (source.includes('point') || source.includes('number') || source.includes('qty') || source.includes('weight') || source.includes('width')) return 'number';
  return 'text';
}

function parseAssessment(cell) {
  if (cell === null || cell === undefined) return { pointValue: null, needsManualPoints: false };
  const raw = String(cell).trim();
  if (raw === '') return { pointValue: null, needsManualPoints: false };
  if (/^dyno$/i.test(raw)) return { pointValue: null, needsManualPoints: true };
  const n = Number(raw);
  if (Number.isFinite(n)) return { pointValue: n, needsManualPoints: false };
  return { pointValue: null, needsManualPoints: true };
}

function shouldSkipDescription(desc) {
  const d = desc.trim();
  if (d.length < 8) return true;
  if (/^total\b/i.test(d)) return true;
  if (/^go to previous|^go to next/i.test(d)) return true;
  if (/^select or true$/i.test(d)) return true;
  if (/^assessment$/i.test(d)) return true;
  if (/^description$/i.test(d)) return true;
  if (/^touring class summary$/i.test(d)) return true;
  if (/^comscc 2027/i.test(d)) return true;
  if (/modifications worksheet$/i.test(d)) return true;
  if (/click "select"/i.test(d) && d.length < 80) return true;
  if (/enter information in the yellow/i.test(d)) return true;
  if (/^note:/i.test(d) && d.length < 60) return true;
  return false;
}

function buildCheckboxQuestion(sheetName, rowIndex, row) {
  const colB = row[1];
  const colC = row[2];
  const desc =
    colC !== null && colC !== undefined && String(colC).trim() !== ''
      ? String(colC).trim()
      : '';
  if (shouldSkipDescription(desc)) return null;

  const { pointValue, needsManualPoints } = parseAssessment(colB);
  const id = `${slugify(sheetName)}_${slugify(desc).slice(0, 72)}_${rowIndex}`;

  const categorySlug = slugify(sheetName);

  return {
    id,
    prompt: desc,
    answerType: 'boolean',
    sheetName,
    sourceRef: `${sheetName}!B${rowIndex + 1}`,
    pointValue,
    needsManualPoints,
    subcategory: assignSubcategory(categorySlug, desc)
  };
}

// Logical component: 0-based column index → Excel column letters (e.g. 13 → N).
function excelColumnLetterFromZero(zeroBasedIndex) {
  let n = zeroBasedIndex + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function vehiclesHeaderColumnIndex(headerRow, exactLabel) {
  const h = headerRow.map((x) => String(x ?? '').trim());
  return h.indexOf(exactLabel);
}

function findVehiclesTableHeaderRowIndex(rows) {
  for (let i = 0; i < rows.length; i++) {
    const labels = (rows[i] || []).map((x) => String(x ?? '').trim());
    if (
      labels.includes('Make') &&
      labels.includes('Model') &&
      labels.includes('Showroom Assessment')
    ) {
      return i;
    }
  }
  return -1;
}

function parseSheetNumber(cell) {
  if (cell === null || cell === undefined || cell === '') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  const n = Number(String(cell).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseSheetYear(cell) {
  const n = parseSheetNumber(cell);
  if (n === null) return null;
  return Math.trunc(n);
}

// Logical component: showroom table rows from Vehicles sheet (Showroom Assessment = column N when headers match workbook).
function buildVehicleCatalogRows(sheetName, rows) {
  const headerIdx = findVehiclesTableHeaderRowIndex(rows);
  if (headerIdx < 0) {
    console.warn('[warn] Vehicles: no table header row (Make / Model / Showroom Assessment).');
    return [];
  }

  const header = rows[headerIdx] || [];
  const col = {
    make: vehiclesHeaderColumnIndex(header, 'Make'),
    model: vehiclesHeaderColumnIndex(header, 'Model'),
    startYear: vehiclesHeaderColumnIndex(header, 'Start Year'),
    endYear: vehiclesHeaderColumnIndex(header, 'End Year'),
    weight: vehiclesHeaderColumnIndex(header, 'Showroom Base Weight (lbs)'),
    hp: vehiclesHeaderColumnIndex(header, 'Factory Rated HP'),
    torque: vehiclesHeaderColumnIndex(header, 'Factory Rated Torque'),
    powerBlend: vehiclesHeaderColumnIndex(header, 'Power (2/3HP + 1/3Torque)'),
    weightPerPower: vehiclesHeaderColumnIndex(header, 'Weight/ Power'),
    scaledWeightPerPower: vehiclesHeaderColumnIndex(header, 'Scaled Weight/ Power'),
    suspIndex: vehiclesHeaderColumnIndex(header, 'SUSP Index'),
    performanceAdjustment: vehiclesHeaderColumnIndex(header, 'Performance Adjustment'),
    showroomAssessment: vehiclesHeaderColumnIndex(header, 'Showroom Assessment'),
    baseClassification: vehiclesHeaderColumnIndex(header, 'Base Classification')
  };

  if (col.make < 0 || col.model < 0 || col.showroomAssessment < 0) {
    console.warn('[warn] Vehicles: missing required columns in header row.');
    return [];
  }

  const assessmentColLetter = excelColumnLetterFromZero(col.showroomAssessment);
  const catalog = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const make = String(r[col.make] ?? '').trim();
    const model = String(r[col.model] ?? '').trim();
    if (!make || !model) continue;

    const excelRowNum = i + 1;
    const showroomAssessment = parseSheetNumber(r[col.showroomAssessment]);
    const baseRaw = col.baseClassification >= 0 ? String(r[col.baseClassification] ?? '').trim() : '';
    const baseClassification = baseRaw || null;

    const sy = parseSheetYear(r[col.startYear]);
    const ey = parseSheetYear(r[col.endYear]);
    const id = `vehicles_${slugify(make)}_${slugify(model)}_${slugify(String(sy ?? 'na'))}_${slugify(String(ey ?? 'na'))}_r${excelRowNum}`;

    catalog.push({
      id,
      make,
      model,
      startYear: sy,
      endYear: ey,
      showroomBaseWeightLbs: col.weight >= 0 ? parseSheetNumber(r[col.weight]) : null,
      factoryRatedHp: col.hp >= 0 ? parseSheetNumber(r[col.hp]) : null,
      factoryRatedTorqueLbFt: col.torque >= 0 ? parseSheetNumber(r[col.torque]) : null,
      powerBlend: col.powerBlend >= 0 ? parseSheetNumber(r[col.powerBlend]) : null,
      weightPerPower: col.weightPerPower >= 0 ? parseSheetNumber(r[col.weightPerPower]) : null,
      scaledWeightPerPower: col.scaledWeightPerPower >= 0 ? parseSheetNumber(r[col.scaledWeightPerPower]) : null,
      suspIndex: col.suspIndex >= 0 ? parseSheetNumber(r[col.suspIndex]) : null,
      performanceAdjustment: col.performanceAdjustment >= 0 ? parseSheetNumber(r[col.performanceAdjustment]) : null,
      showroomAssessment,
      baseClassification,
      sourceRef: `${sheetName}!${assessmentColLetter}${excelRowNum}`
    });
  }

  return catalog;
}

function buildLegacyQuestion(sheetName, rowIndex, row) {
  const visibleCells = row.filter((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
  if (visibleCells.length === 0) return null;

  const first = String(visibleCells[0]).trim();
  const second = String(visibleCells[1] ?? '').trim();
  const prompt = first.length > 2 ? first : second;
  if (!prompt || prompt.length < 2) return null;
  if (/^(total|empty|steward use only)$/i.test(prompt)) return null;

  const categorySlug = slugify(sheetName);

  return {
    id: `${slugify(sheetName)}_${slugify(prompt).slice(0, 64)}_${rowIndex}`,
    prompt,
    answerType: inferAnswerType(`${prompt} ${visibleCells.slice(1).join(' ')}`),
    sheetName,
    sourceRef: `${sheetName}!A${rowIndex + 1}`,
    subcategory: assignSubcategory(categorySlug, prompt)
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function extractWorkbookToSource() {
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`);
  }

  fs.mkdirSync(sourceOutputDir, { recursive: true });
  const workbook = xlsx.readFile(workbookPath, { cellDates: false });
  const categorySummaries = [];

  for (const sheetName of ALL_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      console.warn(`[warn] Missing sheet: ${sheetName}`);
      continue;
    }

    // Logical component: Vehicles needs real Excel row numbers for sourceRef (e.g. column N); keep blank rows for that sheet only.
    const rows = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: sheetName === 'Vehicles',
      defval: null
    });
    const isCheckbox = CHECKBOX_SHEET_NAMES.includes(sheetName);
    const isVehicles = sheetName === 'Vehicles';

    // Logical component: Vehicles sheet → vehicleCatalog overrides; comsccTemplate preserved; npm run data:compose-vehicles merges into rules-source/vehicles.json.
    if (isVehicles) {
      const vehicleCatalog = buildVehicleCatalogRows(sheetName, rows);
      const catalogPath = path.join(sourceOutputDir, 'vehicles-comscc-catalog.json');
      /** @type {Record<string, unknown>} */
      let preserved = {};
      if (fs.existsSync(catalogPath)) {
        try {
          const prev = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
          if (prev.comsccTemplate && typeof prev.comsccTemplate === 'object') {
            preserved.comsccTemplate = prev.comsccTemplate;
          }
        } catch {
          /* keep defaults */
        }
      }
      // Logical component: preserve comsccTemplate placeholder; replace vehicleCatalog with workbook extract.
      writeJson(catalogPath, {
        schemaVersion: '1.0.0',
        sourceWorkbook: path.basename(workbookPath),
        generatedAt: new Date().toISOString(),
        ...preserved,
        vehicleCatalog
      });
      categorySummaries.push({
        id: slugify(sheetName),
        label: sheetName,
        file: 'rules-source/vehicles-comscc-catalog.json',
        questionCount: 0,
        comsccSeedRowCount: vehicleCatalog.length,
        vehiclesCategoryFile: 'rules-source/vehicles.json',
        showroomLookupOutput: 'src/lib/data/vehicle-showroom-lookup.json'
      });
      continue;
    }

    const questions = rows
      .slice(0, 800)
      .map((row, idx) =>
        isCheckbox ? buildCheckboxQuestion(sheetName, idx, row) : buildLegacyQuestion(sheetName, idx, row)
      )
      .filter(Boolean)
      .filter((question, idx, arr) => arr.findIndex((q) => q.prompt === question.prompt) === idx);

    const categoryDocument = {
      schemaVersion: '1.0.0',
      sourceWorkbook: path.basename(workbookPath),
      generatedAt: new Date().toISOString(),
      category: {
        id: slugify(sheetName),
        label: sheetName,
        sheetName,
        description: isCheckbox
          ? `Worksheet rows with Assessment → pointValue and Description → checkbox prompt (${sheetName}).`
          : `Reference extraction for ${sheetName} (non-table layout).`,
        questions
      }
    };

    const fileName = `${slugify(sheetName)}.json`;
    writeJson(path.join(sourceOutputDir, fileName), categoryDocument);

    categorySummaries.push({
      id: slugify(sheetName),
      label: sheetName,
      file: `rules-source/${fileName}`,
      questionCount: questions.length
    });
  }

  writeJson(path.join(sourceOutputDir, 'index.json'), {
    schemaVersion: '1.0.0',
    sourceWorkbook: path.basename(workbookPath),
    generatedAt: new Date().toISOString(),
    categories: categorySummaries
  });

  console.log(`Generated ${categorySummaries.length} category source files in ${sourceOutputDir}`);
}

extractWorkbookToSource();
