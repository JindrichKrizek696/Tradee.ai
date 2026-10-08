-- Administrace: blokace přístupu, poslední přihlášení, záznam akcí adminů
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS blocked TINYINT(1) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_login DATETIME NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS admin_audit(
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id VARCHAR(128) NOT NULL,
  action VARCHAR(32) NOT NULL,
  target_id VARCHAR(254) NOT NULL DEFAULT '',
  detail VARCHAR(255) NOT NULL DEFAULT '',
  at DATETIME NOT NULL,
  INDEX admin_audit_at(at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
