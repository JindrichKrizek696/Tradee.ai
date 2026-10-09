-- Disciplína fáze 4: odběry Web Push (jedno zařízení = jeden endpoint)
CREATE TABLE IF NOT EXISTS push_subscriptions(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  endpoint VARCHAR(512) NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  created DATETIME NOT NULL,
  last_ok DATETIME NULL,
  UNIQUE KEY push_subscriptions_endpoint(endpoint),
  INDEX push_subscriptions_user(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
