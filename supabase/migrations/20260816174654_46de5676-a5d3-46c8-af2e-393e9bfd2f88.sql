CREATE OR REPLACE FUNCTION public.repair_bank_transaction_posting_dates(
  _account_id uuid,
  _dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _family_id uuid;
  _linhas jsonb := '[]'::jsonb;
  _analisadas int := 0;
  _divergentes int := 0;
  _corrigidas int := 0;
  _ambiguas int := 0;
  r record;
BEGIN
  SELECT family_id INTO _family_id FROM public.bank_accounts WHERE id = _account_id;
  IF _family_id IS NULL THEN
    RAISE EXCEPTION 'Conta bancária não encontrada';
  END IF;
  IF NOT public.is_family_member(_family_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para esta conta';
  END IF;

  FOR r IN
    WITH vinculos AS (
      SELECT
        t.id AS transaction_id,
        t.descricao,
        t.valor,
        t.data_movimento AS current_date_val,
        si.data_movimento AS statement_date,
        count(*) OVER (PARTITION BY t.id) AS n_itens
      FROM public.transactions t
      JOIN public.bank_statement_items si
        ON si.transaction_id_criada = t.id OR si.transaction_id_matched = t.id
      WHERE t.bank_account_id = _account_id
        AND si.data_movimento IS NOT NULL
    )
    SELECT DISTINCT * FROM vinculos
  LOOP
    _analisadas := _analisadas + 1;
    IF r.statement_date IS DISTINCT FROM r.current_date_val THEN
      _divergentes := _divergentes + 1;
      IF r.n_itens > 1 THEN
        _ambiguas := _ambiguas + 1;
        _linhas := _linhas || jsonb_build_object(
          'transaction_id', r.transaction_id,
          'description', r.descricao,
          'amount', r.valor,
          'current_date', r.current_date_val,
          'statement_posting_date', r.statement_date,
          'difference_days', r.statement_date - r.current_date_val,
          'action', 'DATE_REPAIR_REVIEW_REQUIRED'
        );
      ELSE
        _linhas := _linhas || jsonb_build_object(
          'transaction_id', r.transaction_id,
          'description', r.descricao,
          'amount', r.valor,
          'current_date', r.current_date_val,
          'statement_posting_date', r.statement_date,
          'difference_days', r.statement_date - r.current_date_val,
          'action', 'CORRIGIR'
        );
        IF NOT _dry_run THEN
          UPDATE public.transactions
            SET data_movimento = r.statement_date,
                updated_at = now()
          WHERE id = r.transaction_id;

          INSERT INTO public.reconciliation_audit
            (family_id, entidade, entidade_id, campo, valor_anterior, valor_novo, origem, created_by)
          VALUES
            (_family_id, 'transactions', r.transaction_id, 'data_movimento',
             r.current_date_val::text, r.statement_date::text,
             'repair_bank_transaction_posting_dates', auth.uid());

          _corrigidas := _corrigidas + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', _dry_run,
    'account_id', _account_id,
    'transactions_analisadas', _analisadas,
    'datas_divergentes', _divergentes,
    'corrigidas', _corrigidas,
    'ambiguas', _ambiguas,
    'linhas', _linhas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_bank_transaction_posting_dates(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_bank_transaction_posting_dates(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_bank_transaction_posting_dates(uuid, boolean) TO service_role;