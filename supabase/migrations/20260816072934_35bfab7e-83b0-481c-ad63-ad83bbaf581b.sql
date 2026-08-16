ALTER TABLE public.incomes ADD COLUMN IF NOT EXISTS dia_recebimento integer;
ALTER TABLE public.incomes ADD CONSTRAINT incomes_dia_recebimento_range CHECK (dia_recebimento IS NULL OR (dia_recebimento >= 1 AND dia_recebimento <= 31));
UPDATE public.incomes SET dia_recebimento = EXTRACT(DAY FROM data_recebimento)::int WHERE dia_recebimento IS NULL AND data_recebimento IS NOT NULL;