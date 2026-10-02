-- Předvolba barev signálu (lib/palettes.ts); NULL = výchozí zelená/červená.
ALTER TABLE members ADD COLUMN IF NOT EXISTS palette VARCHAR(32) NULL;
