"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./db");
dotenv_1.default.config();
const pool = new pg_1.Pool({
    user: process.env.DB_USER || 'srp',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_DATABASE || 'excel_db',
    password: process.env.DB_PASSWORD || '',
    port: parseInt(process.env.DB_PORT || '5432', 10),
});
// Seed data definition for the 6 sheets
const seedSheets = [
    {
        name: 'users',
        data: {
            rows: 30,
            cols: 10,
            cells: {
                "A1": { "value": "Name", "bold": true },
                "B1": { "value": "Role", "bold": true },
                "C1": { "value": "Email", "bold": true },
                "D1": { "value": "Status", "bold": true },
                "A2": { "value": "shubham" },
                "B2": { "value": "Developer" },
                "C2": { "value": "s@gmail.com" },
                "D2": { "value": "Active" },
                "A3": { "value": "Akash" },
                "B3": { "value": "Designer" },
                "C3": { "value": "a@gmail.com" },
                "D3": { "value": "Active" },
                "A4": { "value": "Ravi" },
                "B4": { "value": "QA" },
                "C4": { "value": "r@gmail.com" },
                "D4": { "value": "Active" },
                "A5": { "value": "Karan" },
                "B5": { "value": "Manager" },
                "C5": { "value": "k@gmail.com" },
                "D5": { "value": "Active" }
            }
        }
    },
    {
        name: 'project',
        data: {
            rows: 30,
            cols: 10,
            cells: {
                "A1": { "value": "Project_Name", "bold": true },
                "B1": { "value": "Description", "bold": true },
                "C1": { "value": "Start Date", "bold": true },
                "D1": { "value": "Status", "bold": true },
                "A2": { "value": "3_20_way" },
                "B2": { "value": "API Gateway Migration" },
                "C2": { "value": "2026-06-01" },
                "D2": { "value": "In Progress" },
                "A3": { "value": "vbsa" },
                "B3": { "value": "Core Engine Refactor" },
                "C3": { "value": "2026-06-10" },
                "D3": { "value": "In Progress" },
                "A4": { "value": "bpp" },
                "B4": { "value": "Billing platform integration" },
                "C4": { "value": "2026-06-15" },
                "D4": { "value": "Done" },
                "A5": { "value": "nova mark" },
                "B5": { "value": "Marketing automation page" },
                "C5": { "value": "2026-06-18" },
                "D5": { "value": "Blocked" }
            }
        }
    },
    {
        name: 'module',
        data: {
            rows: 30,
            cols: 10,
            cells: {
                "A1": { "value": "Module_Name", "bold": true },
                "B1": { "value": "project", "bold": true },
                "C1": { "value": "users", "bold": true },
                "D1": { "value": "UI Status", "bold": true },
                "E1": { "value": "Integration Status", "bold": true },
                "F1": { "value": "Notes", "bold": true },
                "A2": { "value": "RBAC Security" },
                "B2": { "value": "vbsa" },
                "C2": { "value": "shubham" },
                "D2": { "value": "In Progress" },
                "E2": { "value": "Pending" },
                "F2": { "value": "Needs auth update" },
                "A3": { "value": "Billing Panel" },
                "B3": { "value": "bpp" },
                "C3": { "value": "Akash" },
                "D3": { "value": "Done" },
                "E3": { "value": "Done" },
                "F3": { "value": "Deployed to prod" },
                "A4": { "value": "Config Page" },
                "B4": { "value": "nova mark" },
                "C4": { "value": "Ravi" },
                "D4": { "value": "Blocked" },
                "E4": { "value": "Blocked" },
                "F4": { "value": "Waiting for design files" }
            }
        }
    },
    {
        name: 'task',
        data: {
            rows: 30,
            cols: 10,
            cells: {
                "A1": { "value": "Task_Name", "bold": true },
                "B1": { "value": "module", "bold": true },
                "C1": { "value": "users", "bold": true },
                "D1": { "value": "Status", "bold": true },
                "E1": { "value": "Notes", "bold": true },
                "A2": { "value": "Create DB Tables" },
                "B2": { "value": "RBAC Security" },
                "C2": { "value": "shubham" },
                "D2": { "value": "Done" },
                "E2": { "value": "Tables created in PG" },
                "A3": { "value": "Implement JWT Login" },
                "B3": { "value": "RBAC Security" },
                "C3": { "value": "shubham" },
                "D3": { "value": "In Progress" },
                "E3": { "value": "Working on secret keys" },
                "A4": { "value": "Style Billing Cards" },
                "B4": { "value": "Billing Panel" },
                "C4": { "value": "Akash" },
                "D4": { "value": "Done" },
                "E4": { "value": "Styled with custom CSS" }
            }
        }
    },
    {
        name: 'dashboard',
        data: {
            rows: 30,
            cols: 10,
            cells: {
                "A1": { "value": "module", "bold": true },
                "B1": { "value": "project", "bold": true },
                "C1": { "value": "UI Status", "bold": true },
                "D1": { "value": "Integration Status", "bold": true },
                "E1": { "value": "users", "bold": true },
                "A2": { "value": "RBAC Security" },
                "B2": { "value": "vbsa" },
                "C2": { "value": "In Progress" },
                "D2": { "value": "Pending" },
                "E2": { "value": "shubham" },
                "A3": { "value": "Billing Panel" },
                "B3": { "value": "bpp" },
                "C3": { "value": "Done" },
                "D3": { "value": "Done" },
                "E3": { "value": "Akash" },
                "A4": { "value": "Config Page" },
                "B4": { "value": "nova mark" },
                "C4": { "value": "Blocked" },
                "D4": { "value": "Blocked" },
                "E4": { "value": "Ravi" }
            }
        }
    },
    {
        name: 'project_users',
        data: {
            rows: 30,
            cols: 10,
            cells: {
                "A1": { "value": "project", "bold": true },
                "B1": { "value": "users", "bold": true },
                "A2": { "value": "vbsa" },
                "B2": { "value": "shubham" },
                "A3": { "value": "vbsa" },
                "B3": { "value": "Akash" },
                "A4": { "value": "3_20_way" },
                "B4": { "value": "shubham" },
                "A5": { "value": "bpp" },
                "B5": { "value": "Karan" }
            }
        }
    }
];
async function seed() {
    console.log('Resetting and seeding database for all 6 tables...');
    const client = await pool.connect();
    try {
        // Drop all old potential dynamic tables first to clean up the DB
        const listSheetsRes = await client.query('SELECT table_name FROM sheets');
        for (const r of listSheetsRes.rows) {
            if (r.table_name) {
                await client.query(`DROP TABLE IF EXISTS "${r.table_name}" CASCADE`);
                console.log(`Dropped old table: "${r.table_name}"`);
            }
        }
        // Truncate the sheets table
        await client.query('TRUNCATE TABLE sheets RESTART IDENTITY CASCADE');
        console.log('Truncated metadata table sheets.');
        // Seed new sheets
        for (const s of seedSheets) {
            const tName = (0, db_1.sanitizeTableName)(s.name);
            await client.query(`INSERT INTO sheets (name, table_name, data) VALUES ($1, $2, $3)`, [s.name, tName, JSON.stringify(s.data)]);
            console.log(`Seeded sheet metadata: "${s.name}"`);
            // Sync the cells data to the real PG table columns
            const { headers, dataRows } = (0, db_1.parseCellsToTableData)(s.data.cells, s.data.cols);
            const colDefs = headers.length > 0
                ? ', ' + headers.map(c => `"${c}" TEXT DEFAULT ''`).join(', ')
                : '';
            await client.query(`
        CREATE TABLE IF NOT EXISTS "${tName}" (
          _row_index INTEGER PRIMARY KEY
          ${colDefs}
        )
      `);
            if (headers.length > 0) {
                // Insert rows
                for (const row of dataRows) {
                    const vals = row.values.slice(0, headers.length);
                    while (vals.length < headers.length)
                        vals.push('');
                    const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
                    const updateSet = headers.map((c, i) => `"${c}" = $${i + 2}`).join(', ');
                    await client.query(`
            INSERT INTO "${tName}" (_row_index, ${headers.map(c => `"${c}"`).join(', ')})
            VALUES ($1, ${placeholders})
            ON CONFLICT (_row_index) DO UPDATE SET ${updateSet}
          `, [row.rowIndex, ...vals]);
                }
                console.log(`Synced real table "${tName}" with ${headers.length} columns.`);
            }
        }
        console.log('Seeding completed successfully!');
    }
    catch (err) {
        console.error('Seeding failed:', err);
    }
    finally {
        client.release();
        pool.end();
    }
}
seed();
