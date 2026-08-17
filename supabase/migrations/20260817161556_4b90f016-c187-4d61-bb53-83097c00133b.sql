REVOKE ALL ON FUNCTION public.match_financial_institution(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.match_financial_institution(text) TO authenticated, service_role;