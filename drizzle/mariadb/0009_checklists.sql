-- Checklisty traderů
CREATE TABLE IF NOT EXISTS checklists(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  name VARCHAR(60) NOT NULL,
  items TEXT NOT NULL,
  markets TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  created DATETIME NOT NULL, updated DATETIME NOT NULL,
  INDEX checklists_user(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS checklist_state(
  user_id VARCHAR(128) NOT NULL,
  checklist_id VARCHAR(40) NOT NULL,
  instrument VARCHAR(16) NOT NULL,
  checked TEXT NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY(user_id,checklist_id,instrument)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trade_checklists(
  user_id VARCHAR(128) NOT NULL,
  trade_id VARCHAR(100) NOT NULL,
  instrument VARCHAR(16) NOT NULL,
  snapshot MEDIUMTEXT NOT NULL,
  completion DOUBLE NULL,
  created DATETIME NOT NULL, updated DATETIME NOT NULL,
  PRIMARY KEY(user_id,trade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS symbol_map(
  user_id VARCHAR(128) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  instrument VARCHAR(16) NOT NULL DEFAULT '',
  PRIMARY KEY(user_id,symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
