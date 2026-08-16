ALTER TYPE public.purchase_payment_status ADD VALUE IF NOT EXISTS 'PENDENTE_PAGAMENTO';
ALTER TYPE public.purchase_payment_status ADD VALUE IF NOT EXISTS 'PARCIALMENTE_PAGA';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'A_DEFINIR';

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS data_prevista_pagamento date,
  ADD COLUMN IF NOT EXISTS data_pagamento_real date;