-- Graf trhu: presety a výchozí vzhled nástrojů kreslení a vlastní barvy (JSON per uživatel)
CREATE TABLE IF NOT EXISTS drawing_prefs (
  user_id VARCHAR(128) NOT NULL,
  data LONGTEXT NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
