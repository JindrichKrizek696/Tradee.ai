-- Přehled skóre: složky, které si uživatel vypnul (JSON pole id, např. ["cot","trend"]); NULL = nenastaveno
ALTER TABLE members ADD COLUMN IF NOT EXISTS score_off LONGTEXT NULL;
