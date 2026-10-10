-- Automatické porušení pravidla lze označit jako „neplatí“ (falešný poplach) s volitelnou poznámkou
ALTER TABLE trade_violations
  ADD COLUMN dismissed TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN dismissed_note TEXT NULL,
  ADD COLUMN dismissed_at DATETIME NULL;
