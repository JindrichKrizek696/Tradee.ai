-- Etapa 2A: skóre k datu (point-in-time). Plný neměnný snímek skóre každého trhu při každém plánovaném uložení
-- (scripts/capture-score-history.mjs) + kanonický denní snímek + rekonstrukce ze starší historie (scripts/pit-backfill.mjs).
-- NA VPS SPUSTIT RUČNĚ: cd ~/tradee && python3 scripts/mariadb-migrate.py && node --experimental-strip-types scripts/pit-backfill.mjs
-- kind: capture | daily (první snímek dne v Praze, daily_key = trh|den, unikátní) | backfill (rekonstruováno z historie, reconstructed=1)
-- parts = složky jako „gz:“ + base64(gzip(JSON)): hodnota, příspěvek, stav, vstupy (hodnota, jednotka, období, vydání, zveřejnění,
-- dostupnost, zdroj, transformace), porovnávaná veličina a pravidlo. Aplikace zapisuje jen INSERT IGNORE – řádky se nikdy nemění ani nemažou.
CREATE TABLE IF NOT EXISTS score_snapshots_v2(
  market VARCHAR(64) NOT NULL,
  at DATETIME(3) NOT NULL,
  kind VARCHAR(8) NOT NULL,
  day DATE NOT NULL,
  daily_key VARCHAR(80) NULL,
  method VARCHAR(32) NOT NULL,
  version VARCHAR(40) NOT NULL,
  score DECIMAL(6,1) NULL,
  coverage INT NULL,
  reconstructed TINYINT NOT NULL DEFAULT 0,
  source VARCHAR(32) NOT NULL,
  note VARCHAR(255) NULL,
  fingerprint CHAR(16) NOT NULL,
  parts LONGTEXT NOT NULL,
  created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(market,kind,at),
  UNIQUE KEY score_snapshots_v2_daily(daily_key),
  INDEX score_snapshots_v2_at(market,at),
  INDEX score_snapshots_v2_time(at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
