import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';

// Logical component: configurable workbook source and output path.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const workbookPath =
  process.argv[2] ??
  path.resolve(
    '/home/sysadmin/Downloads/COMSCC-2027-Touring-Classification-Tool_V2.01_TEST-SHEET.xlsx'
  );
const outputPath = path.join(repoRoot, 'src/lib/data/rules.v1.json');
const targetSheets = ['Vehicles', 'Engine', 'Drivetrain', 'Suspension', 'Brakes', 'Exterior', 'Weight', 'Tires'];

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function inferAnswerType(text) {
  const source = text.toLowerCase();
  if (source.includes('yes/no') || source.includes('true/false')) return 'boolean';
  if (source.includes('select') || source.includes('choose')) return 'select';
  if (source.includes('point') || source.includes('number') || source.includes('qty')) return 'number';
  return 'text';
}

function buildQuestion(sheetName, rowIndex, row) {
  const visibleCells = row.filter((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
  if (visibleCells.length === 0) return null;

  const prompt =
    String(visibleCells[0]).trim().length > 2
      ? String(visibleCells[0]).trim()
      : String(visibleCells[1] ?? visibleCells[0]).trim();
  if (!prompt || prompt.length < 2) return null;

  const answerHint = visibleCells.slice(1).map(String).join(' ');
  const answerType = inferAnswerType(`${prompt} ${answerHint}`);
  const id = `${slugify(sheetName)}_${slugify(prompt).slice(0, 48)}_${rowIndex}`;

  return {
    id,
    prompt,
    answerType
  };
}

function convertWorkbook() {
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`);
  }

  const workbook = xlsx.readFile(workbookPath, { cellDates: false });
  const categories = [];

  for (const sheetName of targetSheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      console.warn(`[warn] Missing sheet: ${sheetName}`);
      continue;
    }

    // Logical component: extract broad-question candidates from early columns.
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });
    const questions = rows
      .slice(0, 300)
      .map((row, idx) => buildQuestion(sheetName, idx, row))
      .filter(Boolean)
      .filter((question, idx, arr) => arr.findIndex((q) => q.prompt === question.prompt) === idx)
      .slice(0, 25);

    categories.push({
      id: slugify(sheetName),
      label: sheetName,
      description: `Auto-imported MVP category from ${sheetName} sheet.`,
      questions
    });
  }

  const document = {
    schemaVersion: '1.0.0',
    categories
  };

  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));
  console.log(`Generated ${outputPath} with ${categories.length} categories.`);
}

convertWorkbook();
