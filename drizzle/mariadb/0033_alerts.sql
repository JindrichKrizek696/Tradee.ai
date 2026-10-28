-- Cenové alerty: cena (nad / pod / dotyk), % změna dnes a skóre Tradee; kontrola scripts/alerts-check.mjs z cronu každou minutu
-- kind: above | below | touch | pct | score; op: u pct gte | lte, u score above | below; level = cena nebo skóre, pct = práh v %
-- channels: „push,mail“ / „push“ / „mail“; ended: proč skončil (triggered = jednorázový spuštěn, expired = vypršel), ruční pauza = active 0 bez ended
CREATE TABLE IF NOT EXISTS price_alerts(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  instrument VARCHAR(64) NOT NULL,
  kind VARCHAR(10) NOT NULL,
  level DOUBLE NULL,
  pct DOUBLE NULL,
  op VARCHAR(10) NULL,
  note VARCHAR(500) NULL,
  repeat_cooldown_min INT NULL,
  expires_at DATETIME NULL,
  channels VARCHAR(20) NOT NULL DEFAULT 'mail',
  active TINYINT(1) NOT NULL DEFAULT 1,
  ended VARCHAR(10) NULL,
  last_price DOUBLE NULL,
  last_checked DATETIME NULL,
  last_triggered DATETIME NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  INDEX price_alerts_user(user_id, active),
  INDEX price_alerts_active(active, instrument)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
-- událost = jedno spuštění; instrument a label (popis podmínky) jako snímek, aby historie přežila úpravu i smazání alertu
-- delivered_*: 1 doručeno, 0 nepodařilo se, NULL kanál nevybrán / nedostupný
CREATE TABLE IF NOT EXISTS alert_events(
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alert_id VARCHAR(40) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  at DATETIME NOT NULL,
  price DOUBLE NOT NULL,
  instrument VARCHAR(64) NOT NULL,
  label VARCHAR(200) NOT NULL,
  delivered_push TINYINT(1) NULL,
  delivered_mail TINYINT(1) NULL,
  read_at DATETIME NULL,
  INDEX alert_events_user(user_id, at),
  INDEX alert_events_unread(user_id, read_at),
  INDEX alert_events_alert(alert_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
