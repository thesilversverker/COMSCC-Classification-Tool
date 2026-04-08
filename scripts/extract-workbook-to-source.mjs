import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';

// Logical component: paths and extraction targets.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const workbookPath =
  process.argv[2] ??
  path.resolve('/home/sysadmin/Downloads/COMSCC-2027-Touring-Classification-Tool_V2.01_TEST-SHEET.xlsx');
const sourceOutputDir = path.join(repoRoot, 'rules-source');
const targetSheets = ['Vehicles', 'Engine', 'Drivetrain', 'Suspension', 'Brakes', 'Exterior', 'Weight', 'Tires'];

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

function buildQuestion(sheetName, rowIndex, row) {
  // Logical component: normalize each row into a question-like source item.
  const visibleCells = row.filter((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
  if (visibleCells.length === 0) return null;

  const first = String(visibleCells[0]).trim();
  const second = String(visibleCells[1] ?? '').trim();
  const prompt = first.length > 2 ? first : second;
  if (!prompt || prompt.length < 2) return null;
  if (/^(total|empty|steward use only)$/i.test(prompt)) return null;

  return {
    id: `${slugify(sheetName)}_${slugify(prompt).slice(0, 64)}_${rowIndex}`,
    prompt,
    answerType: inferAnswerType(`${prompt} ${visibleCells.slice(1).join(' ')}`),
    sheetName,
    sourceRef: `${sheetName}!A${rowIndex + 1}`
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

  for (const sheetName of targetSheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      console.warn(`[warn] Missing sheet: ${sheetName}`);
      continue;
    }

    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });
    const questions = rows
      .slice(0, 700)
      .map((row, idx) => buildQuestion(sheetName, idx, row))
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
        description: `Initial workbook extraction for ${sheetName}.`,
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
