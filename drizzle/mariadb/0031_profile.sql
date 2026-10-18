-- Profil uživatele (/profil): vlastní jméno a oslovení (name zůstává jméno z Google, přepisuje se při každém přihlášení),
-- profilová fotka v úložišti (avatar_key = 'avatars/<uuid>'), barva kolečka s iniciálami a údaje o obchodování.
ALTER TABLE members ADD COLUMN IF NOT EXISTS display_name VARCHAR(80) NULL;
--> statement-breakpoint
ALTER TABLE members ADD COLUMN IF NOT EXISTS greet_name VARCHAR(60) NULL;
--> statement-breakpoint
ALTER TABLE members ADD COLUMN IF NOT EXISTS avatar_key VARCHAR(80) NULL;
--> statement-breakpoint
ALTER TABLE members ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(16) NULL;
--> statement-breakpoint
ALTER TABLE members ADD COLUMN IF NOT EXISTS bio VARCHAR(600) NULL;
--> statement-breakpoint
ALTER TABLE members ADD COLUMN IF NOT EXISTS trading_style VARCHAR(64) NULL;
--> statement-breakpoint
ALTER TABLE members ADD COLUMN IF NOT EXISTS trading_markets VARCHAR(64) NULL;
--> statement-breakpoint
ALTER TABLE members ADD COLUMN IF NOT EXISTS trading_since SMALLINT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS members_avatar ON members(avatar_key);
