"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = exports.pool = void 0;
exports.sanitizeTableName = sanitizeTableName;
exports.sanitizeColName = sanitizeColName;
exports.getColLabel = getColLabel;
exports.ensureDataTable = ensureDataTable;
exports.syncDataRows = syncDataRows;
exports.parseCellsToTableData = parseCellsToTableData;
exports.initializeDatabase = initializeDatabase;
const pg_1 = __importDefault(require("pg"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const { Pool } = pg_1.default;
exports.pool = new Pool({
    user: process.env.DB_USER || 'srp',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_DATABASE || 'excel_db',
    password: process.env.DB_PASSWORD || '',
    port: parseInt(process.env.DB_PORT || '5432', 10),
});
const query = (text, params) => exports.pool.query(text, params);
exports.query = query;
// ─── Name Sanitizers ──────────────────────────────────────────────────────────
/** Convert sheet name → safe PostgreSQL table name. e.g. "My Users" → "my_users" */
function sanitizeTableName(name) {
    const s = name.toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
    return s || `sheet_${Date.now()}`;
}
/** Convert header text → safe PostgreSQL column name. e.g. "UI Status" → "ui_status" */
function sanitizeColName(h) {
    const s = h.toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_')
        .replace(/^(\d)/, 'col_$1'); // can't start with number
    return s || 'col';
}
// ─── Column Label Helper ──────────────────────────────────────────────────────
function getColLabel(index) {
    let label = '';
    let temp = index;
    while (temp >= 0) {
        label = String.fromCharCode((temp % 26) + 65) + label;
        temp = Math.floor(temp / 26) - 1;
    }
    return label;
}
// ─── Real Table Management ────────────────────────────────────────────────────
/**
 * Create the real data table if it doesn't exist, and add any new columns.
 * Each row is identified by _row_index (the spreadsheet row number minus 1).
 */
async function ensureDataTable(tableName, columns) {
    if (!columns.length)
        return;
    // Create table with _row_index PK and all columns
    const colDefs = columns.map(c => `"${c}" TEXT DEFAULT ''`).join(', ');
    await exports.pool.query(`
    CREATE TABLE IF NOT EXISTS "${tableName}" (
      _row_index INTEGER PRIMARY KEY,
      ${colDefs}
    )
  `);
    // Fetch existing columns
    const res = await exports.pool.query(`SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`, [tableName]);
    const existingCols = res.rows.map((r) => r.column_name);
    // Add any missing columns (ALTER TABLE for new headers)
    for (const col of columns) {
        if (!existingCols.includes(col)) {
            console.log(`ALTER TABLE "${tableName}" ADD COLUMN "${col}"`);
            await exports.pool.query(`ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${col}" TEXT DEFAULT ''`);
        }
    }
}
/**
 * Upsert all data rows into the real table, delete rows that no longer exist.
 */
async function syncDataRows(tableName, columns, rows) {
    if (!columns.length)
        return;
    const colNames = columns.map(c => `"${c}"`).join(', ');
    for (const row of rows) {
        const vals = row.values.slice(0, columns.length);
        // Pad with empty strings if fewer values than columns
        while (vals.length < columns.length)
            vals.push('');
        const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
        const updateSet = columns.map((c, i) => `"${c}" = $${i + 2}`).join(', ');
        await exports.pool.query(`
      INSERT INTO "${tableName}" (_row_index, ${colNames})
      VALUES ($1, ${placeholders})
      ON CONFLICT (_row_index) DO UPDATE SET ${updateSet}
    `, [row.rowIndex, ...vals]);
    }
    // Remove rows not present in the current save
    if (rows.length > 0) {
        const indices = rows.map(r => r.rowIndex);
        await exports.pool.query(`DELETE FROM "${tableName}" WHERE _row_index != ALL($1::int[])`, [indices]);
    }
    else {
        // No data rows — truncate
        await exports.pool.query(`DELETE FROM "${tableName}"`);
    }
}
/**
 * Parse the spreadsheet cells object into:
 *  - headers: sanitized column names from row 1
 *  - dataRows: values from rows 2+
 */
function parseCellsToTableData(cells, colCount) {
    const colLabels = Array.from({ length: colCount }, (_, i) => getColLabel(i));
    // --- Row 1 → headers ---
    const rawHeaders = colLabels.map(col => {
        const key = `${col}1`;
        return cells[key]?.value?.trim() || '';
    });
    const hasHeaders = rawHeaders.some(h => h.length > 0);
    if (!hasHeaders)
        return { headers: [], dataRows: [] };
    // Sanitize, keeping only columns that have a header
    const sanitizedHeaders = rawHeaders.map(h => h ? sanitizeColName(h) : null);
    const validHeaders = sanitizedHeaders.filter((h) => h !== null);
    const validColIndices = sanitizedHeaders
        .map((h, i) => (h !== null ? i : -1))
        .filter(i => i >= 0);
    if (!validHeaders.length)
        return { headers: [], dataRows: [] };
    // --- Rows 2+ → data ---
    const rowNums = Object.keys(cells)
        .map(k => parseInt(k.replace(/^[A-Z]+/, ''), 10))
        .filter(n => !isNaN(n) && n > 1);
    const maxRow = rowNums.length ? Math.max(...rowNums) : 1;
    const dataRows = [];
    for (let r = 2; r <= maxRow; r++) {
        const values = validColIndices.map(c => {
            const key = `${colLabels[c]}${r}`;
            return cells[key]?.value || '';
        });
        if (values.some(v => v.trim() !== '')) {
            dataRows.push({ rowIndex: r - 1, values });
        }
    }
    return { headers: validHeaders, dataRows };
}
// ─── Database Initializer ─────────────────────────────────────────────────────
async function initializeDatabase() {
    try {
        console.log('Connecting to PostgreSQL...');
        const client = await exports.pool.connect();
        console.log('Connected to PostgreSQL successfully!');
        // 1. Create the sheets metadata table
        await client.query(`
      CREATE TABLE IF NOT EXISTS sheets (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        table_name  VARCHAR(255) UNIQUE,
        data        JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        // 2. Add table_name column if this is an old install (safe migration)
        await client.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS table_name VARCHAR(255) UNIQUE`);
        console.log('Sheets metadata table ready.');
        // 3. Backfill table_name for sheets that don't have one yet
        const missing = await client.query(`SELECT id, name FROM sheets WHERE table_name IS NULL`);
        for (const row of missing.rows) {
            const tName = sanitizeTableName(row.name);
            try {
                await client.query(`UPDATE sheets SET table_name = $1 WHERE id = $2`, [tName, row.id]);
                console.log(`Backfilled table_name for sheet "${row.name}" → "${tName}"`);
            }
            catch {
                // table_name unique constraint conflict — append id to make unique
                const tNameUniq = `${tName}_${row.id}`;
                await client.query(`UPDATE sheets SET table_name = $1 WHERE id = $2`, [tNameUniq, row.id]);
                console.log(`Backfilled (unique) table_name for sheet "${row.name}" → "${tNameUniq}"`);
            }
        }
        // 4. Seed default empty sheets if database is completely empty
        const { rows: countRows } = await client.query(`SELECT COUNT(*)::int as count FROM sheets`);
        if (countRows[0].count === 0) {
            const defaultSheets = ['users', 'projects', 'modules', 'tasks'];
            const defaultData = { rows: 30, cols: 10, cells: {} };
            for (const sheetName of defaultSheets) {
                const tName = sanitizeTableName(sheetName);
                await client.query(`INSERT INTO sheets (name, table_name, data) VALUES ($1, $2, $3)`, [sheetName, tName, JSON.stringify(defaultData)]);
                console.log(`Seeded empty sheet: "${sheetName}"`);
            }
        }
        // 5. Ensure a real table exists for every sheet (create if missing, sync data)
        const { rows: allSheets } = await client.query(`SELECT id, name, table_name, data FROM sheets WHERE table_name IS NOT NULL`);
        for (const sheet of allSheets) {
            const tName = sheet.table_name;
            try {
                // Create bare real table if it doesn't exist
                await client.query(`
          CREATE TABLE IF NOT EXISTS "${tName}" (
            _row_index INTEGER PRIMARY KEY
          )
        `);
                // If cells exist, parse headers and sync data to real table
                const data = sheet.data;
                if (data?.cells && Object.keys(data.cells).length > 0) {
                    const { headers, dataRows } = parseCellsToTableData(data.cells, data.cols || 10);
                    if (headers.length > 0) {
                        await ensureDataTable(tName, headers);
                        await syncDataRows(tName, headers, dataRows);
                        console.log(`Synced real table "${tName}": ${headers.length} cols, ${dataRows.length} rows`);
                    }
                }
            }
            catch (err) {
                console.warn(`Could not ensure real table "${tName}":`, err.message);
            }
        }
        client.release();
        console.log('Database initialization complete.');
    }
    catch (error) {
        console.error('Failed to initialize PostgreSQL:', error);
        console.warn('Make sure PostgreSQL is running and excel_db exists.');
    }
}
