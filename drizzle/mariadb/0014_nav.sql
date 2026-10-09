-- Nastavení: vlastní pořadí a viditelnost položek horní navigace (JSON {order,hidden})
ALTER TABLE members ADD COLUMN IF NOT EXISTS nav LONGTEXT NULL;
