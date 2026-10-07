// Přepočet měn přes kurzy ECB (per_eur = kolik jednotek měny za 1 EUR).
export const CURRENCIES=['USD','EUR','CZK','GBP','CHF','JPY','AUD','CAD','NZD','PLN'] as const;
export const isCurrency=(c:unknown):c is string=>typeof c==='string'&&(CURRENCIES as readonly string[]).includes(c);
