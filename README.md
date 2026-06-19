# Excel-like Fullstack Spreadsheet Application

An interactive Excel-like spreadsheet application built with a modern stack:
- **Frontend**: Angular 22 + Tailwind CSS 4
- **Backend**: Node.js + Express API + TypeScript
- **Database**: PostgreSQL (Local instance)

---

## Prerequisites

- **Node.js** v26.3.0 or later (with `npm` v11.16.0 or later).
- **PostgreSQL** running locally on port `5432`.
  - Superuser or default role: `srp`
  - Database name: `excel_db`
  - Password: None (Blank)

---

## How to Run

### 1. Database Setup

Make sure your local PostgreSQL server is active. The backend is configured to automatically connect, create the required `sheets` table, and seed an initial workspace sheet on start.

If you ever need to recreate the database from scratch, use the SQL schema:
```bash
psql -h localhost -d postgres -f schema.sql
```

### 2. Run Backend Server

Open a terminal window and run:
```bash
cd backend
npm run dev
```
The server will start at [http://localhost:3000](http://localhost:3000) and watch for changes using `nodemon`.

### 3. Run Frontend Server

Open a second terminal window and run:
```bash
cd frontend
npm run start
```
The client application compiles and starts at [http://localhost:4200](http://localhost:4200).

---

## Backend Commands — When to Use What

| Command | What it does | When to use |
|---|---|---|
| `npm run dev` | Runs `nodemon src/index.ts` via `ts-node` | ✅ **Daily development** — auto-reloads on every `.ts` file save |
| `npm run build` | Compiles TypeScript → `dist/` using `tsc` | Run this before deploying, or after big changes before `npm start` |
| `npm start` | Runs the compiled `dist/index.js` | Production / after a manual `npm run build` |

### ⚠️ Common Mistakes

**❌ `npm start dev`** — This is **wrong**. `npm start` always runs `node dist/index.js`, and `dev` is just an ignored extra argument. It does **not** run the `dev` script.

**✅ Use `npm run dev`** — The `run` keyword is required when calling any named script other than `start` or `test`.

**❌ Editing `.ts` files while running `npm start`** — Changes to TypeScript source have **no effect** until you rebuild with `npm run build`. The server runs the compiled `dist/` files, not the source directly.

**✅ Use `npm run dev` during development** — `nodemon` + `ts-node` watch your source files and restart the server automatically on every save. No manual rebuild needed.

### Quick Reference

```bash
# Development (recommended — auto-reloads on file changes)
cd backend && npm run dev

# Production (compile first, then run)
cd backend && npm run build && npm start

# Frontend (always the same)
cd frontend && npm run start
```

---

## Application Features

1. **Excel Grid Interface**:
   - Scrollable rows and columns with standard address headers (A1, B5, etc.).
   - Double-click any cell to edit inline, or select a cell and edit directly in the **Formula Bar**.

2. **Basic Excel Formulas**:
   - Write math expressions starting with `=`, e.g. `=A1+B2` or `=5*10`.
   - Write standard cell ranges: `=SUM(A1:A5)` or `=AVERAGE(B1:B10)`.

3. **Styling Toolbar**:
   - Highlight cell text as **Bold** or *Italic*.
   - Apply curated Text colors and Background fills from the dropdown pickers.
   - Dynamically expand the sheet grid using the **Add Row** and **Add Column** actions.

4. **Sheet Pages (CRUD)**:
   - Click the bottom `+` icon to instantly add a new worksheet page.
   - Double-click any sheet tab to rename it.
   - Hover a sheet tab and click the small `x` to delete it.

5. **Auto-save Connection**:
   - All cell selections, formatting updates, and worksheet properties auto-save in the background to PostgreSQL using a debounced transaction flow.
