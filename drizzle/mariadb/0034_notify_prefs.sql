-- Upozornění po kategoriích: pro každou kategorii (alerts = cenové alerty, discipline = porušení pravidel, lab = Laboratoř jen vlastník)
-- volba Push / E-mail / V aplikaci. Bez řádku platí výchozí (lib/notify/prefs.ts): alerty vše zapnuto, disciplína podle notify_settings, laboratoř vše zapnuto.
CREATE TABLE IF NOT EXISTS notify_prefs(
  user_id VARCHAR(128) NOT NULL,
  category VARCHAR(20) NOT NULL,
  push TINYINT(1) NOT NULL DEFAULT 1,
  mail TINYINT(1) NOT NULL DEFAULT 1,
  inapp TINYINT(1) NOT NULL DEFAULT 1,
  updated DATETIME NOT NULL,
  PRIMARY KEY(user_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- Testovací push z Nastavení: aplikace jen zapíše žádost (nejvýš 1 za minutu), odešle ji scripts/alerts-check.mjs (cron každou minutu).
CREATE TABLE IF NOT EXISTS notify_tests(
  user_id VARCHAR(128) NOT NULL PRIMARY KEY,
  requested DATETIME NOT NULL,
  done DATETIME NULL,
  sent INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- popis zařízení v seznamu odběrů (prohlížeč · systém), zkrácený user agent
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS user_agent VARCHAR(200) NULL;
