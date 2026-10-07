-- Deník obchodů: svíčky k pozicím (z EA), screenshoty, širší ruční tagy
CREATE TABLE IF NOT EXISTS mt_position_bars(
  account_id VARCHAR(40) NOT NULL,
  position VARCHAR(48) NOT NULL,
  tf VARCHAR(4) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  data MEDIUMTEXT NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY(account_id,position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mt_position_files(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  position_id VARCHAR(90) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  r2_key VARCHAR(200) NOT NULL,
  name VARCHAR(120) NOT NULL,
  size INT NOT NULL,
  type VARCHAR(20) NOT NULL,
  created DATETIME NOT NULL,
  INDEX mt_files_pos(position_id),
  INDEX mt_files_user(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
ALTER TABLE mt_positions MODIFY tags_manual VARCHAR(400) NOT NULL DEFAULT '';
