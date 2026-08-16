-- Funcoes financeiras: somente autenticados (a autorizacao interna ja valida familia)
REVOKE ALL ON FUNCTION public.ensure_invoice_for_due(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_invoice_for_due(uuid, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sync_installment_invoices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_installment_invoices(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.pay_card_invoice(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_card_invoice(uuid, uuid, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.transfer_between_accounts(uuid, uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_between_accounts(uuid, uuid, numeric, date, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_demo_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_demo_data() TO authenticated, service_role;

-- Funcoes de gatilho: nao devem ser chamaveis pela API
REVOKE ALL ON FUNCTION public.purchase_transaction_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_payment_status_rule() FROM PUBLIC, anon, authenticated;