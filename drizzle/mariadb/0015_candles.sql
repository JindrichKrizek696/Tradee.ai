-- Graf trhu: cache svíček z Yahoo (JSON [t,o,h,l,c][]) s jednoduchým zámkem obnovy
CREATE TABLE IF NOT EXISTS market_candles (
  instrument VARCHAR(64) NOT NULL,
  tf VARCHAR(4) NOT NULL,
  data LONGTEXT NOT NULL,
  updated DATETIME NOT NULL,
  fetching DATETIME NULL,
  PRIMARY KEY (instrument, tf)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
