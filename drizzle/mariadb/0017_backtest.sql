-- Backtester: pravidla strategií a uložené běhy
CREATE TABLE IF NOT EXISTS strategy_rules (
  strategy_id VARCHAR(40) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  rules LONGTEXT NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (strategy_id),
  INDEX strategy_rules_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS backtest_runs (
  id VARCHAR(40) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  strategy_id VARCHAR(40) NOT NULL,
  params LONGTEXT NOT NULL,
  summary LONGTEXT NOT NULL,
  result LONGTEXT NOT NULL,
  created DATETIME NOT NULL,
  PRIMARY KEY (id),
  INDEX backtest_runs_user (user_id, created),
  INDEX backtest_runs_strategy (user_id, strategy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
