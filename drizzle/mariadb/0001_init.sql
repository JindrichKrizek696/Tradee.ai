-- Aplikační schéma Tradee.ai v MariaDB. Aplikuje scripts/mariadb-migrate.py; statementy odděluje řádek se značkou breakpoint.
CREATE TABLE IF NOT EXISTS members(id VARCHAR(128) PRIMARY KEY, email VARCHAR(255) NOT NULL, name VARCHAR(255) NOT NULL, role VARCHAR(32) NOT NULL DEFAULT 'member', synced_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP) CHARACTER SET utf8mb4;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS watch_flags(id VARCHAR(191) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, instrument VARCHAR(64) NOT NULL, flag VARCHAR(16) NOT NULL, updated VARCHAR(40) NOT NULL, synced_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP, INDEX watch_flags_user(user_id)) CHARACTER SET utf8mb4;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trades(id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, date DATE NOT NULL, instrument VARCHAR(64) NOT NULL, pnl DECIMAL(14,2) NOT NULL, note TEXT NOT NULL, created VARCHAR(40) NOT NULL, synced_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP, INDEX trades_user_date(user_id, date)) CHARACTER SET utf8mb4;
--> statement-breakpoint
ALTER TABLE members MODIFY synced_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE watch_flags MODIFY synced_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE trades MODIFY synced_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS content(id VARCHAR(64) PRIMARY KEY, kind VARCHAR(32) NOT NULL, title VARCHAR(255) NOT NULL, body LONGTEXT NOT NULL, media VARCHAR(255) NOT NULL DEFAULT '', published TINYINT NOT NULL DEFAULT 0, updated VARCHAR(40) NOT NULL, INDEX content_kind(kind)) CHARACTER SET utf8mb4;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS messages(id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, name VARCHAR(255) NOT NULL, channel VARCHAR(64) NOT NULL, body TEXT NOT NULL, created VARCHAR(40) NOT NULL, INDEX messages_channel_created(channel, created)) CHARACTER SET utf8mb4;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS snapshots(id VARCHAR(64) PRIMARY KEY, data LONGTEXT NOT NULL, source VARCHAR(64) NOT NULL, created VARCHAR(40) NOT NULL, INDEX snapshots_created(created)) CHARACTER SET utf8mb4;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS progress(id VARCHAR(191) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, lesson_id VARCHAR(64) NOT NULL, INDEX progress_user(user_id)) CHARACTER SET utf8mb4;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS change_log(id BIGINT AUTO_INCREMENT PRIMARY KEY, `table` VARCHAR(32) NOT NULL, row_id VARCHAR(191) NOT NULL, action VARCHAR(8) NOT NULL, row_json LONGTEXT NULL, at DATETIME NOT NULL, INDEX(`table`, row_id), INDEX(at)) CHARACTER SET utf8mb4;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trades_ai AFTER INSERT ON trades FOR EACH ROW INSERT INTO change_log(`table`,row_id,action,row_json,at) VALUES('trades',NEW.id,'insert',JSON_OBJECT('id',NEW.id,'user_id',NEW.user_id,'date',NEW.date,'instrument',NEW.instrument,'pnl',NEW.pnl,'note',NEW.note,'created',NEW.created),UTC_TIMESTAMP());
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trades_au AFTER UPDATE ON trades FOR EACH ROW INSERT INTO change_log(`table`,row_id,action,row_json,at) VALUES('trades',NEW.id,'update',JSON_OBJECT('id',NEW.id,'user_id',NEW.user_id,'date',NEW.date,'instrument',NEW.instrument,'pnl',NEW.pnl,'note',NEW.note,'created',NEW.created),UTC_TIMESTAMP());
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trades_ad AFTER DELETE ON trades FOR EACH ROW INSERT INTO change_log(`table`,row_id,action,row_json,at) VALUES('trades',OLD.id,'delete',JSON_OBJECT('id',OLD.id,'user_id',OLD.user_id,'date',OLD.date,'instrument',OLD.instrument,'pnl',OLD.pnl,'note',OLD.note,'created',OLD.created),UTC_TIMESTAMP());
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS watch_flags_ai AFTER INSERT ON watch_flags FOR EACH ROW INSERT INTO change_log(`table`,row_id,action,row_json,at) VALUES('watch_flags',NEW.id,'insert',JSON_OBJECT('id',NEW.id,'user_id',NEW.user_id,'instrument',NEW.instrument,'flag',NEW.flag,'updated',NEW.updated),UTC_TIMESTAMP());
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS watch_flags_au AFTER UPDATE ON watch_flags FOR EACH ROW INSERT INTO change_log(`table`,row_id,action,row_json,at) VALUES('watch_flags',NEW.id,'update',JSON_OBJECT('id',NEW.id,'user_id',NEW.user_id,'instrument',NEW.instrument,'flag',NEW.flag,'updated',NEW.updated),UTC_TIMESTAMP());
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS watch_flags_ad AFTER DELETE ON watch_flags FOR EACH ROW INSERT INTO change_log(`table`,row_id,action,row_json,at) VALUES('watch_flags',OLD.id,'delete',JSON_OBJECT('id',OLD.id,'user_id',OLD.user_id,'instrument',OLD.instrument,'flag',OLD.flag,'updated',OLD.updated),UTC_TIMESTAMP());
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS members_ai AFTER INSERT ON members FOR EACH ROW INSERT INTO change_log(`table`,row_id,action,row_json,at) VALUES('members',NEW.id,'insert',JSON_OBJECT('id',NEW.id,'email',NEW.email,'name',NEW.name,'role',NEW.role),UTC_TIMESTAMP());
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS members_au AFTER UPDATE ON members FOR EACH ROW INSERT INTO change_log(`table`,row_id,action,row_json,at) VALUES('members',NEW.id,'update',JSON_OBJECT('id',NEW.id,'email',NEW.email,'name',NEW.name,'role',NEW.role),UTC_TIMESTAMP());
