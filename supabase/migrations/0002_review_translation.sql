-- Traduzione automatica fornita dalla fonte (es. Google), mostrata all'utente accanto
-- all'originale. L'analisi AI e la verifica delle citazioni usano sempre il testo originale.
alter table reviews add column if not exists text_translated text;
alter table reviews add column if not exists translated_language text;
