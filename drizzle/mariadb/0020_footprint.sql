-- Graf trhu: footprint krypta z Binance – stav svíčky (OHLC, hladiny nákup/prodej, další ID obchodu, hotovo) jako JSON
CREATE TABLE IF NOT EXISTS footprint_cache (
  instrument VARCHAR(64) NOT NULL,
  tf VARCHAR(4) NOT NULL,
  candle_t BIGINT NOT NULL,
  data LONGTEXT NOT NULL,
  updated BIGINT NOT NULL,
  PRIMARY KEY (instrument, tf, candle_t)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
