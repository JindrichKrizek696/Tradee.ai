-- Poznámky v Journalingu (Notebook): vlastní složky uživatele (Analýza, Konec týdne…) a v nich papíry s volným textem, volitelně s trhem
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py  (bez migrace záložka Poznámky jen hlásí, že ještě nejsou zapnuté)
-- Limity (počet složek a papírů, délka textu) hlídá aplikace: lib/notebook/core.ts
CREATE TABLE IF NOT EXISTS notebook_folders(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  name VARCHAR(60) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created DATETIME NOT NULL, updated DATETIME NOT NULL,
  INDEX notebook_folders_user(user_id,position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS notebook_notes(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  folder_id VARCHAR(40) NOT NULL,
  title VARCHAR(160) NOT NULL DEFAULT '',
  body MEDIUMTEXT NOT NULL,
  instrument VARCHAR(32) NULL,
  created DATETIME NOT NULL, updated DATETIME NOT NULL,
  INDEX notebook_notes_user(user_id,created),
  INDEX notebook_notes_folder(user_id,folder_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
