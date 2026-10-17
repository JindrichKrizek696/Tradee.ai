-- Prognózy FX párů (Trading Economics, ING Think): snímek každé stažené předpovědi pro pozdější vyhodnocení přesnosti (Laboratoř → Prognózy, lib/forecasts/eval.ts).
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py
-- source = 'te' | 'ing'; horizon = q1…q4 (konec čtvrtletí) nebo y12 (za 12 měsíců); spot_at_made = cena páru v době vydání (základ pro směr); derived = 1, když je pár přepočtem přes USD.
CREATE TABLE IF NOT EXISTS forecast_snapshots(
  source VARCHAR(8) NOT NULL,
  pair VARCHAR(8) NOT NULL,
  horizon VARCHAR(4) NOT NULL,
  made_at DATE NOT NULL,
  horizon_end DATE NOT NULL,
  value DOUBLE NOT NULL,
  spot_at_made DOUBLE NULL,
  derived TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY(source,pair,horizon,made_at),
  INDEX forecast_snapshots_end(horizon_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
