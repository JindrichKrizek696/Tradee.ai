-- Disciplína fáze 1: nastavení pravidel, vlastní pravidla, strategie a porušení pravidel u obchodů
CREATE TABLE IF NOT EXISTS rules_settings(
  user_id VARCHAR(128) NOT NULL PRIMARY KEY,
  rules LONGTEXT NOT NULL,
  updated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS custom_rules(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  text VARCHAR(120) NOT NULL,
  position INT NOT NULL,
  created DATETIME NOT NULL,
  INDEX custom_rules_user(user_id,position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS strategies(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  name VARCHAR(60) NOT NULL,
  archived TINYINT(1) NOT NULL DEFAULT 0,
  created DATETIME NOT NULL,
  UNIQUE KEY strategies_user_name(user_id,name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trade_violations(
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  trade_id VARCHAR(100) NOT NULL,
  rule VARCHAR(32) NOT NULL,
  detail LONGTEXT NOT NULL,
  needs_reason TINYINT(1) NOT NULL,
  reason_code VARCHAR(32) NULL,
  reason_text TEXT NULL,
  reasoned_at DATETIME NULL,
  notified_mail DATETIME NULL,
  notified_push DATETIME NULL,
  created DATETIME NOT NULL,
  UNIQUE KEY trade_violations_trade_rule(trade_id,rule),
  INDEX trade_violations_user(user_id,needs_reason,reasoned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
