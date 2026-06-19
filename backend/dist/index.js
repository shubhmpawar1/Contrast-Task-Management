"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./db");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});
(0, db_1.initializeDatabase)();
// ─── GET /api/tables/:tableName/values — Get all rows from a real table ───────
// Used by the frontend to populate linked dropdowns (sheet cross-references)
app.get('/api/tables/:tableName/values', async (req, res) => {
    const { tableName } = req.params;
    // Only allow alphanumeric + underscore table names (security)
    if (!/^[a-z0-9_]+$/i.test(tableName)) {
        return res.status(400).json({ error: 'Invalid table name' });
    }
    try {
        // Check the table exists
        const exists = await (0, db_1.query)(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [tableName]);
        if (!exists.rows.length)
            return res.json({ columns: [], rows: [] });
        // Fetch sheet metadata to find active column headers in the current UI state
        const sheetRes = await (0, db_1.query)(`SELECT data FROM sheets WHERE table_name = $1`, [tableName]);
        let activeHeaders = [];
        if (sheetRes.rows.length) {
            const sheetData = sheetRes.rows[0].data;
            if (sheetData?.cells) {
                const colCount = sheetData.cols || 10;
                const { headers } = (0, db_1.parseCellsToTableData)(sheetData.cells, colCount);
                activeHeaders = headers;
            }
        }
        // Get column names from the database table (excluding internal _row_index)
        const colRes = await (0, db_1.query)(`SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name != '_row_index'
       ORDER BY ordinal_position`, [tableName]);
        const dbColumns = colRes.rows.map((r) => r.column_name);
        // Filter and order columns: prioritize current active headers in their UI layout order
        const columns = activeHeaders.length > 0
            ? activeHeaders.filter(c => dbColumns.includes(c))
            : dbColumns;
        // Get all rows ordered by _row_index
        const dataRes = await (0, db_1.query)(`SELECT * FROM "${tableName}" ORDER BY _row_index ASC`);
        const rows = dataRes.rows.map((row) => {
            const { _row_index, ...rest } = row;
            return rest;
        });
        res.json({ columns, rows });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ─── Helpers ──────────────────────────────────────────────────────────────────
/** After saving cells to JSONB, also sync to the real PostgreSQL table */
async function syncRealTable(tableName, data) {
    if (!data?.cells)
        return;
    const colCount = data.cols || 10;
    const { headers, dataRows } = (0, db_1.parseCellsToTableData)(data.cells, colCount);
    if (!headers.length)
        return;
    await (0, db_1.ensureDataTable)(tableName, headers);
    await (0, db_1.syncDataRows)(tableName, headers, dataRows);
    console.log(`Synced real table "${tableName}": ${headers.length} cols, ${dataRows.length} rows`);
}
// ─── GET /api/sheets — List all sheets ───────────────────────────────────────
app.get('/api/sheets', async (_req, res) => {
    try {
        const result = await (0, db_1.query)('SELECT id, name, table_name, updated_at FROM sheets ORDER BY id ASC');
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ─── GET /api/sheets/:id — Get one sheet ─────────────────────────────────────
app.get('/api/sheets/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await (0, db_1.query)('SELECT id, name, table_name, data, updated_at FROM sheets WHERE id = $1', [id]);
        if (!result.rows.length)
            return res.status(404).json({ error: 'Sheet not found' });
        res.json(result.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ─── POST /api/sheets — Create a new sheet ────────────────────────────────────
app.post('/api/sheets', async (req, res) => {
    const { name } = req.body;
    try {
        // Use MAX(id) so numbering stays correct even after deletions
        const maxIdResult = await (0, db_1.query)('SELECT COALESCE(MAX(id), 0)::int as maxid FROM sheets');
        const sheetNum = maxIdResult.rows[0].maxid + 1;
        const finalName = (name || `Sheet ${sheetNum}`).trim();
        // Resolve table_name conflicts by appending a timestamp suffix
        let tableName = (0, db_1.sanitizeTableName)(finalName);
        const conflict = await (0, db_1.query)(`SELECT 1 FROM sheets WHERE table_name = $1`, [tableName]);
        if (conflict.rows.length) {
            tableName = `${tableName}_${Date.now()}`;
        }
        const defaultData = { rows: 30, cols: 10, cells: {} };
        const result = await (0, db_1.query)(`INSERT INTO sheets (name, table_name, data)
       VALUES ($1, $2, $3)
       RETURNING id, name, table_name, data, updated_at`, [finalName, tableName, JSON.stringify(defaultData)]);
        // Create the real table immediately (empty, just with _row_index)
        // Columns will be added when user types headers in Row 1
        try {
            await (0, db_1.query)(`
        CREATE TABLE IF NOT EXISTS "${tableName}" (
          _row_index INTEGER PRIMARY KEY
        )
      `);
            console.log(`Created real table: "${tableName}"`);
        }
        catch (tableErr) {
            console.warn(`Could not pre-create table "${tableName}":`, tableErr.message);
        }
        res.status(201).json(result.rows[0]);
    }
    catch (err) {
        console.error('Error creating sheet:', err);
        res.status(500).json({ error: err.message });
    }
});
// ─── PUT /api/sheets/:id — Update sheet (name + data) ────────────────────────
app.put('/api/sheets/:id', async (req, res) => {
    const { id } = req.params;
    const { name, data } = req.body;
    try {
        // Fetch current sheet
        const current = await (0, db_1.query)('SELECT id, name, table_name FROM sheets WHERE id = $1', [id]);
        if (!current.rows.length)
            return res.status(404).json({ error: 'Sheet not found' });
        const sheet = current.rows[0];
        let currentTableName = sheet.table_name;
        // ── If name changed, rename the real PostgreSQL table too ──
        if (name !== undefined && name.trim() !== sheet.name) {
            const newTableName = (0, db_1.sanitizeTableName)(name.trim());
            if (newTableName !== currentTableName) {
                try {
                    // Check if target name already exists
                    const conflict = await (0, db_1.query)(`SELECT table_name FROM sheets WHERE table_name = $1 AND id != $2`, [newTableName, id]);
                    const finalNewTableName = conflict.rows.length
                        ? `${newTableName}_${id}` // avoid conflict by appending id
                        : newTableName;
                    // Rename real table if it exists
                    await (0, db_1.query)(`ALTER TABLE IF EXISTS "${currentTableName}" RENAME TO "${finalNewTableName}"`);
                    console.log(`Renamed real table: "${currentTableName}" → "${finalNewTableName}"`);
                    // Update table_name in metadata
                    await (0, db_1.query)(`UPDATE sheets SET table_name = $1 WHERE id = $2`, [finalNewTableName, id]);
                    currentTableName = finalNewTableName;
                }
                catch (renameErr) {
                    console.warn(`Could not rename table "${currentTableName}":`, renameErr.message);
                }
            }
        }
        // ── Build the main update query ──
        let queryText = '';
        let params = [];
        if (name !== undefined && data !== undefined) {
            queryText = `UPDATE sheets SET name=$1, data=$2, updated_at=NOW() WHERE id=$3 RETURNING *`;
            params = [name, JSON.stringify(data), id];
        }
        else if (name !== undefined) {
            queryText = `UPDATE sheets SET name=$1, updated_at=NOW() WHERE id=$2 RETURNING *`;
            params = [name, id];
        }
        else if (data !== undefined) {
            queryText = `UPDATE sheets SET data=$1, updated_at=NOW() WHERE id=$2 RETURNING *`;
            params = [JSON.stringify(data), id];
        }
        else {
            return res.status(400).json({ error: 'Provide name or data to update' });
        }
        const result = await (0, db_1.query)(queryText, params);
        // ── Sync cell data to real table whenever data is saved ──
        if (data !== undefined && currentTableName) {
            try {
                await syncRealTable(currentTableName, data);
            }
            catch (syncErr) {
                console.warn(`Real table sync warning for "${currentTableName}":`, syncErr.message);
            }
        }
        res.json(result.rows[0]);
    }
    catch (err) {
        console.error(`Error updating sheet ${id}:`, err);
        res.status(500).json({ error: err.message });
    }
});
// ─── DELETE /api/sheets/:id — Delete sheet + drop real table ─────────────────
app.delete('/api/sheets/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const current = await (0, db_1.query)('SELECT id, table_name FROM sheets WHERE id = $1', [id]);
        if (!current.rows.length)
            return res.status(404).json({ error: 'Sheet not found' });
        const { table_name } = current.rows[0];
        // Delete from sheets metadata table
        await (0, db_1.query)('DELETE FROM sheets WHERE id = $1', [id]);
        // Drop the real table if it exists
        if (table_name) {
            try {
                await (0, db_1.query)(`DROP TABLE IF EXISTS "${table_name}"`);
                console.log(`Dropped real table: "${table_name}"`);
            }
            catch (dropErr) {
                console.warn(`Could not drop table "${table_name}":`, dropErr.message);
            }
        }
        res.json({ message: 'Sheet deleted successfully', id: parseInt(id), table_name });
    }
    catch (err) {
        console.error(`Error deleting sheet ${id}:`, err);
        res.status(500).json({ error: err.message });
    }
});
app.listen(PORT, () => {
    console.log(`Spreadsheet API running on http://localhost:${PORT}`);
});
