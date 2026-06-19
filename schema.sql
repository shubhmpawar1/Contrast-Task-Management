-- Schema for Excel-like Spreadsheet Application

-- Create sheets table
CREATE TABLE IF NOT EXISTS sheets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    data JSONB NOT NULL DEFAULT '{"rows": 25, "cols": 22, "cells": {}}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial default sheet if the table is empty
-- Note: This is an example, the backend will auto-seed or handle empty states gracefully.
INSERT INTO sheets (name, data)
SELECT 'Sheet 1', '{"rows": 25, "cols": 22, "cells": {"A1": {"value": "Welcome to Excel!", "bold": true}, "A2": {"value": "Feel free to edit cells, add sheets, and format them.", "italic": true}}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM sheets);
