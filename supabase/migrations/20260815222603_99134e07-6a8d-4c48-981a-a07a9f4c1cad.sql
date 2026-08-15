-- Faturas: visíveis apenas para quem pode ver o cartão
DROP POLICY IF EXISTS card_invoices_select ON public.card_invoices;
CREATE POLICY card_invoices_select ON public.card_invoices FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.credit_cards c
  WHERE c.id = card_invoices.credit_card_id
    AND public.can_view_member_record(c.family_id, c.member_id, auth.uid())
));

DROP POLICY IF EXISTS card_invoices_insert_admin ON public.card_invoices;
CREATE POLICY card_invoices_insert ON public.card_invoices FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.credit_cards c
  WHERE c.id = card_invoices.credit_card_id
    AND c.family_id = card_invoices.family_id
    AND public.can_manage_member_record(c.family_id, c.member_id, auth.uid())
));

DROP POLICY IF EXISTS card_invoices_update_admin ON public.card_invoices;
CREATE POLICY card_invoices_update ON public.card_invoices FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.credit_cards c
  WHERE c.id = card_invoices.credit_card_id
    AND public.can_manage_member_record(c.family_id, c.member_id, auth.uid())
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.credit_cards c
  WHERE c.id = card_invoices.credit_card_id
    AND public.can_manage_member_record(c.family_id, c.member_id, auth.uid())
));

-- Parcelas: seguem a despesa de origem
DROP POLICY IF EXISTS expense_installments_select ON public.expense_installments;
CREATE POLICY expense_installments_select ON public.expense_installments FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.expenses e
  WHERE e.id = expense_installments.expense_id
    AND public.can_view_member_record(e.family_id, e.member_id, auth.uid())
));

DROP POLICY IF EXISTS expense_installments_insert_admin ON public.expense_installments;
CREATE POLICY expense_installments_insert ON public.expense_installments FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.expenses e
  WHERE e.id = expense_installments.expense_id
    AND e.family_id = expense_installments.family_id
    AND public.can_manage_member_record(e.family_id, e.member_id, auth.uid())
));

DROP POLICY IF EXISTS expense_installments_update_admin ON public.expense_installments;
CREATE POLICY expense_installments_update ON public.expense_installments FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.expenses e
  WHERE e.id = expense_installments.expense_id
    AND public.can_manage_member_record(e.family_id, e.member_id, auth.uid())
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.expenses e
  WHERE e.id = expense_installments.expense_id
    AND public.can_manage_member_record(e.family_id, e.member_id, auth.uid())
));
