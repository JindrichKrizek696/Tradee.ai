-- Disciplína fáze 2: vyhodnocení obchodů (Journaling)
CREATE TABLE IF NOT EXISTS trade_reviews(
  user_id VARCHAR(128) NOT NULL,
  trade_id VARCHAR(100) NOT NULL,
  rating TINYINT NULL,
  strategy_id VARCHAR(40) NULL,
  reason TEXT NULL,
  emotions VARCHAR(255) NOT NULL DEFAULT '',
  lesson TEXT NULL,
  custom_broken LONGTEXT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY(user_id,trade_id),
  INDEX trade_reviews_strategy(user_id,strategy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
