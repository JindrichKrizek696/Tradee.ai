-- Disciplína fáze 3: nastavení upozornění (okno v aplikaci, e-mail, push, odložení)
CREATE TABLE IF NOT EXISTS notify_settings(
  user_id VARCHAR(128) NOT NULL PRIMARY KEY,
  popup TINYINT(1) NOT NULL DEFAULT 1,
  mail TINYINT(1) NOT NULL DEFAULT 1,
  push TINYINT(1) NOT NULL DEFAULT 0,
  snooze_until DATETIME NULL,
  last_mail DATETIME NULL,
  updated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
