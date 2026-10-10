-- Graf trhu: kresby uživatele per trh (JSON seznam kreseb)
CREATE TABLE IF NOT EXISTS chart_drawings (
  user_id VARCHAR(128) NOT NULL,
  instrument VARCHAR(64) NOT NULL,
  data LONGTEXT NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (user_id, instrument)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
