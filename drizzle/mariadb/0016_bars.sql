-- Archiv svíček pro backtesting (Yahoo: H1 posledních ~2 roky, D1 celá historie)
CREATE TABLE IF NOT EXISTS market_bars (
  instrument VARCHAR(64) NOT NULL,
  tf VARCHAR(4) NOT NULL,
  t BIGINT NOT NULL,
  o DOUBLE NOT NULL,
  h DOUBLE NOT NULL,
  l DOUBLE NOT NULL,
  c DOUBLE NOT NULL,
  v DOUBLE NULL,
  PRIMARY KEY (instrument, tf, t)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS market_bars_meta (
  instrument VARCHAR(64) NOT NULL,
  tf VARCHAR(4) NOT NULL,
  first_t BIGINT NULL,
  last_t BIGINT NULL,
  count INT NOT NULL DEFAULT 0,
  updated DATETIME NULL,
  PRIMARY KEY (instrument, tf)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
