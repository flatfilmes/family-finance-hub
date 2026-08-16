-- 1. Novo tipo de movimentação: posição inicial da conta
ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'ABERTURA_SALDO';

-- 2. Tipos auxiliares do extrato bancário
DO $$ BEGIN
  CREATE TYPE public.bank_statement_format AS ENUM ('PDF', 'CSV', 'OFX', 'IMAGEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.bank_statement_status AS ENUM ('UPLOADED','PROCESSING','READY_FOR_REVIEW','CONFIRMED','CANCELLED','ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.bank_movement_kind AS ENUM ('ENTRADA','SAIDA','TRANSFERENCIA','TARIFA','JUROS','ESTORNO','AJUSTE','OUTRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.bank_statement_match AS ENUM ('MATCHED','POSSIBLE_MATCH','NEW','IGNORED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Importações de extrato
CREATE TABLE public.bank_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  nome_arquivo text NOT NULL,
  formato public.bank_statement_format NOT NULL DEFAULT 'PDF',
  parser text NOT NULL DEFAULT 'GENERICO',
  periodo_inicio date,
  periodo_fim date,
  saldo_inicial numeric(14,2),
  saldo_final numeric(14,2),
  total_entradas numeric(14,2) NOT NULL DEFAULT 0,
  total_saidas numeric(14,2) NOT NULL DEFAULT 0,
  quantidade_lancamentos integer NOT NULL DEFAULT 0,
  status public.bank_statement_status NOT NULL DEFAULT 'UPLOADED',
  dados_brutos_json jsonb,
  erro_mensagem text,
  confirmado_em timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statement_imports TO authenticated;
GRANT ALL ON public.bank_statement_imports TO service_role;
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver extratos da familia" ON public.bank_statement_imports
  FOR SELECT TO authenticated
  USING (public.can_view_member_record(family_id, member_id, auth.uid()));
CREATE POLICY "Criar extratos da familia" ON public.bank_statement_imports
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));
CREATE POLICY "Atualizar extratos da familia" ON public.bank_statement_imports
  FOR UPDATE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()))
  WITH CHECK (public.can_manage_member_record(family_id, member_id, auth.uid()));
CREATE POLICY "Excluir extratos da familia" ON public.bank_statement_imports
  FOR DELETE TO authenticated
  USING (public.can_manage_member_record(family_id, member_id, auth.uid()));

CREATE TRIGGER bank_statement_imports_updated_at
  BEFORE UPDATE ON public.bank_statement_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX bank_statement_imports_account_idx
  ON public.bank_statement_imports (bank_account_id, created_at DESC);

-- 4. Lançamentos do extrato (nunca viram movimentação sem revisão)
CREATE TABLE public.bank_statement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.bank_statement_imports(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  data_movimento date,
  descricao_original text NOT NULL,
  descricao_normalizada text NOT NULL,
  valor numeric(14,2) NOT NULL,
  tipo_sugerido public.bank_movement_kind NOT NULL DEFAULT 'OUTRO',
  match_status public.bank_statement_match NOT NULL DEFAULT 'NEW',
  confidence_score numeric(5,2),
  purchase_id_matched uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  card_invoice_id_matched uuid REFERENCES public.card_invoices(id) ON DELETE SET NULL,
  transaction_id_matched uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  transfer_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  incluir boolean NOT NULL DEFAULT true,
  transaction_id_criada uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  erro_mensagem text,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statement_items TO authenticated;
GRANT ALL ON public.bank_statement_items TO service_role;
ALTER TABLE public.bank_statement_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver lancamentos do extrato" ON public.bank_statement_items
  FOR SELECT TO authenticated
  USING (public.is_family_member(family_id, auth.uid()));
CREATE POLICY "Criar lancamentos do extrato" ON public.bank_statement_items
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_member_record(family_id, NULL, auth.uid()));
CREATE POLICY "Atualizar lancamentos do extrato" ON public.bank_statement_items
  FOR UPDATE TO authenticated
  USING (public.can_manage_member_record(family_id, NULL, auth.uid()))
  WITH CHECK (public.can_manage_member_record(family_id, NULL, auth.uid()));
CREATE POLICY "Excluir lancamentos do extrato" ON public.bank_statement_items
  FOR DELETE TO authenticated
  USING (public.can_manage_member_record(family_id, NULL, auth.uid()));

CREATE TRIGGER bank_statement_items_updated_at
  BEFORE UPDATE ON public.bank_statement_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX bank_statement_items_import_idx
  ON public.bank_statement_items (import_id, ordem);