-- Živé ceny trhů (Yahoo 15 min)
CREATE TABLE IF NOT EXISTS market_live(
  instrument VARCHAR(16) NOT NULL PRIMARY KEY,
  symbol VARCHAR(24) NOT NULL DEFAULT '',
  price DOUBLE NOT NULL,
  prev_close DOUBLE NOT NULL,
  change_pct DOUBLE NOT NULL,
  day_high DOUBLE NULL, day_low DOUBLE NULL,
  market_time BIGINT NOT NULL,
  updated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS market_intraday(
  instrument VARCHAR(16) NOT NULL,
  ts BIGINT NOT NULL,
  price DOUBLE NOT NULL,
  PRIMARY KEY(instrument,ts),
  INDEX market_intraday_ts(ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
