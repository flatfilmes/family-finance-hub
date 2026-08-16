-- ============ 1. ensure_invoice_for_due: autorização por família/cartão ============
CREATE OR REPLACE FUNCTION public.ensure_invoice_for_due(_card_id uuid, _venc date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  card public.credit_cards%ROWTYPE;
  fech_dia int;
  venc_dia int;
  fechamento date;
  inicio date;
  inv_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;
  IF _card_id IS NULL OR _venc IS NULL THEN
    RAISE EXCEPTION 'Parametros invalidos';
  END IF;

  SELECT * INTO card FROM public.credit_cards WHERE id = _card_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cartao nao encontrado'; END IF;

  IF NOT public.can_manage_member_record(card.family_id, card.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para este cartao';
  END IF;

  fech_dia := LEAST(28, GREATEST(1, COALESCE(card.dia_fechamento, 1)));
  venc_dia := LEAST(28, GREATEST(1, COALESCE(card.dia_vencimento, 10)));

  IF venc_dia > fech_dia THEN
    fechamento := make_date(EXTRACT(YEAR FROM _venc)::int, EXTRACT(MONTH FROM _venc)::int, fech_dia);
  ELSE
    fechamento := (make_date(EXTRACT(YEAR FROM _venc)::int, EXTRACT(MONTH FROM _venc)::int, 1) - interval '1 month')::date;
    fechamento := make_date(EXTRACT(YEAR FROM fechamento)::int, EXTRACT(MONTH FROM fechamento)::int, fech_dia);
  END IF;

  inicio := (fechamento - interval '1 month')::date + 1;

  SELECT id INTO inv_id FROM public.card_invoices
   WHERE credit_card_id = _card_id AND data_fechamento = fechamento;
  IF inv_id IS NOT NULL THEN RETURN inv_id; END IF;

  INSERT INTO public.card_invoices (family_id, credit_card_id, data_inicio_ciclo, data_fechamento, data_vencimento)
  VALUES (card.family_id, _card_id, inicio, fechamento, _venc)
  RETURNING id INTO inv_id;

  RETURN inv_id;
END;
$function$;

-- ============ 2. sync_installment_invoices: exige admin da familia informada ============
CREATE OR REPLACE FUNCTION public.sync_installment_invoices(_family_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  inv uuid;
  vinculadas int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;
  IF _family_id IS NULL THEN
    RAISE EXCEPTION 'Informe a familia (NULL nao processa todas as familias)';
  END IF;
  IF NOT public.is_family_admin(_family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para sincronizar esta familia';
  END IF;

  FOR r IN
    SELECT i.id, i.data_vencimento, COALESCE(i.credit_card_id, e.cartao_id) AS card_id
      FROM public.expense_installments i
      JOIN public.expenses e ON e.id = i.expense_id
     WHERE i.card_invoice_id IS NULL
       AND i.family_id = _family_id
  LOOP
    IF r.card_id IS NULL THEN CONTINUE; END IF;
    inv := public.ensure_invoice_for_due(r.card_id, r.data_vencimento);
    IF inv IS NOT NULL THEN
      UPDATE public.expense_installments SET card_invoice_id = inv WHERE id = r.id;
      vinculadas := vinculadas + 1;
    END IF;
  END LOOP;

  UPDATE public.card_invoices ci
     SET valor_total = COALESCE(t.total, 0)
    FROM (
      SELECT card_invoice_id, SUM(valor_parcela) AS total
        FROM public.expense_installments
       WHERE card_invoice_id IS NOT NULL
       GROUP BY card_invoice_id
    ) t
   WHERE ci.id = t.card_invoice_id
     AND ci.status <> 'PAGA'
     AND ci.family_id = _family_id;

  RETURN vinculadas;
END;
$function$;

-- ============ 3. transactions: livro-razao somente leitura para o cliente ============
DROP POLICY IF EXISTS transactions_insert ON public.transactions;
DROP POLICY IF EXISTS transactions_update ON public.transactions;
DROP POLICY IF EXISTS transactions_delete ON public.transactions;
REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM authenticated;
GRANT SELECT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;

-- ============ 4. Transferencia entre contas: atomica e rastreavel ============
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_group_id uuid,
  ADD COLUMN IF NOT EXISTS transfer_role text;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_transfer_role_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_transfer_role_check
  CHECK (transfer_role IS NULL OR transfer_role IN ('SAIDA', 'ENTRADA'));

CREATE INDEX IF NOT EXISTS transactions_transfer_group_idx
  ON public.transactions (transfer_group_id);

CREATE OR REPLACE FUNCTION public.transfer_between_accounts(
  _origem_id uuid,
  _destino_id uuid,
  _valor numeric,
  _data date DEFAULT CURRENT_DATE,
  _descricao text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  origem public.bank_accounts%ROWTYPE;
  destino public.bank_accounts%ROWTYPE;
  grupo uuid := gen_random_uuid();
  texto text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF _origem_id IS NULL OR _destino_id IS NULL THEN RAISE EXCEPTION 'Informe as contas'; END IF;
  IF _origem_id = _destino_id THEN RAISE EXCEPTION 'Conta de origem e destino devem ser diferentes'; END IF;
  IF _valor IS NULL OR _valor <= 0 THEN RAISE EXCEPTION 'Valor invalido'; END IF;

  SELECT * INTO origem FROM public.bank_accounts WHERE id = _origem_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta de origem nao encontrada'; END IF;
  SELECT * INTO destino FROM public.bank_accounts WHERE id = _destino_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta de destino nao encontrada'; END IF;

  IF origem.family_id <> destino.family_id THEN
    RAISE EXCEPTION 'As contas pertencem a familias diferentes';
  END IF;

  IF NOT public.can_manage_member_record(origem.family_id, origem.member_id, auth.uid())
     OR NOT public.can_manage_member_record(destino.family_id, destino.member_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para transferir entre estas contas';
  END IF;

  texto := COALESCE(NULLIF(_descricao, ''), 'Transferencia entre contas');

  UPDATE public.bank_accounts SET saldo_atual = saldo_atual - _valor WHERE id = _origem_id;
  UPDATE public.bank_accounts SET saldo_atual = saldo_atual + _valor WHERE id = _destino_id;

  INSERT INTO public.transactions (
    family_id, member_id, bank_account_id, created_by, tipo, descricao, valor,
    data_movimento, status, transfer_group_id, transfer_role
  ) VALUES (
    origem.family_id, origem.member_id, _origem_id, auth.uid(), 'TRANSFERENCIA',
    texto || ' — saida para ' || COALESCE(destino.banco,'') || ' ' || COALESCE(destino.nome_conta,''),
    _valor, COALESCE(_data, CURRENT_DATE), 'CONFIRMADA', grupo, 'SAIDA'
  );

  INSERT INTO public.transactions (
    family_id, member_id, bank_account_id, created_by, tipo, descricao, valor,
    data_movimento, status, transfer_group_id, transfer_role
  ) VALUES (
    destino.family_id, destino.member_id, _destino_id, auth.uid(), 'TRANSFERENCIA',
    texto || ' — entrada de ' || COALESCE(origem.banco,'') || ' ' || COALESCE(origem.nome_conta,''),
    _valor, COALESCE(_data, CURRENT_DATE), 'CONFIRMADA', grupo, 'ENTRADA'
  );

  RETURN grupo;
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_between_accounts(uuid, uuid, numeric, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_between_accounts(uuid, uuid, numeric, date, text) TO authenticated;

-- ============ 5. Storage: delecao exige admin da familia ou ser o proprio autor ============
DROP POLICY IF EXISTS "Familia remove documentos" ON storage.objects;
CREATE POLICY "Familia remove documentos" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'documentos-financeiros'
  AND (storage.foldername(name))[1] = 'familia'
  AND public.is_family_member(((storage.foldername(name))[2])::uuid, auth.uid())
  AND (
    public.is_family_admin(((storage.foldername(name))[2])::uuid, auth.uid())
    OR owner = auth.uid()
  )
);

-- ============ 6. document_test_cases: infraestrutura interna ============
DROP POLICY IF EXISTS "Autenticados registram casos de teste" ON public.document_test_cases;
DROP POLICY IF EXISTS "Autenticados atualizam casos de teste" ON public.document_test_cases;

CREATE POLICY "Admins de familia registram casos de teste"
ON public.document_test_cases FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.families f WHERE public.is_family_admin(f.id, auth.uid())
));

CREATE POLICY "Admins de familia atualizam casos de teste"
ON public.document_test_cases FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.families f WHERE public.is_family_admin(f.id, auth.uid())
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.families f WHERE public.is_family_admin(f.id, auth.uid())
));