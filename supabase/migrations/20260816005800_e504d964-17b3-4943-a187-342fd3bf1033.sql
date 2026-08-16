CREATE TYPE public.document_read_strategy AS ENUM ('DANFE_PDF_TABULAR', 'NFCE_QRCODE', 'OCR_CUPOM', 'OCR_GENERICO', 'MANUAL');
CREATE TYPE public.document_test_status AS ENUM ('AGUARDANDO_TESTE', 'EM_TESTE', 'APROVADO', 'FALHOU', 'REGRESSAO');

CREATE TABLE public.document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nome text NOT NULL,
  descricao text NOT NULL DEFAULT '',
  ativo boolean NOT NULL DEFAULT true,
  estrategia_leitura public.document_read_strategy NOT NULL DEFAULT 'MANUAL',
  requires_ocr boolean NOT NULL DEFAULT false,
  supports_qr_code boolean NOT NULL DEFAULT false,
  prioridade integer NOT NULL DEFAULT 100,
  status_inicial public.document_test_status NOT NULL DEFAULT 'AGUARDANDO_TESTE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_types TO authenticated;
GRANT ALL ON public.document_types TO service_role;
ALTER TABLE public.document_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tipos de documento visiveis para autenticados"
  ON public.document_types FOR SELECT TO authenticated USING (true);

CREATE TRIGGER document_types_updated_at BEFORE UPDATE ON public.document_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.document_types (codigo, nome, descricao, estrategia_leitura, requires_ocr, supports_qr_code, prioridade, status_inicial) VALUES
  ('DANFE_NFE', 'DANFE / NF-e', 'DANFE / Nota Fiscal Eletronica tradicional. Possui razao social do emitente, chave de acesso, numero, serie, data de emissao, destinatario, valor total, tabela DADOS DO PRODUTO / SERVICO e informacoes de pagamento.', 'DANFE_PDF_TABULAR', false, false, 10, 'APROVADO'),
  ('NFCE', 'NFC-e', 'Nota Fiscal de Consumidor Eletronica: supermercado, minimercado, padaria, farmacia, lojas fisicas e conveniencia. Possui estabelecimento, CNPJ, data/hora, produtos, quantidade, unidade, preco unitario, total, forma de pagamento, QR Code e chave da NFC-e.', 'NFCE_QRCODE', false, true, 20, 'AGUARDANDO_TESTE'),
  ('CUPOM_FISCAL', 'Cupom fiscal', 'Cupom fiscal impresso/termico de mercados, restaurantes, lojas, postos e farmacias. Pode chegar como foto, imagem ou PDF digitalizado. Layout menos estruturado, com maior dependencia de OCR.', 'OCR_CUPOM', true, false, 30, 'AGUARDANDO_TESTE'),
  ('NOTA_SUPERMERCADO', 'Nota de supermercado', 'Perfil especializado para compras com muitos produtos (arroz, feijao, carne, bebidas, higiene, limpeza, hortifruti). Pode ser NFC-e ou cupom.', 'OCR_CUPOM', true, true, 40, 'AGUARDANDO_TESTE'),
  ('NOTA_FARMACIA', 'Nota de farmacia', 'Compra de medicamentos, higiene e produtos de saude. Categorizacao preparada para medicamento, higiene, saude e cosmeticos.', 'OCR_CUPOM', true, true, 50, 'AGUARDANDO_TESTE'),
  ('NOTA_POSTO_COMBUSTIVEL', 'Nota de posto de combustivel', 'Compra em posto. Identificacao de gasolina, etanol, diesel, quantidade em litros, valor por litro, total e servicos adicionais.', 'OCR_CUPOM', true, true, 60, 'AGUARDANDO_TESTE'),
  ('NOTA_RESTAURANTE', 'Nota de restaurante', 'Restaurante, lanchonete, delivery ou alimentacao fora. Pode conter itens individuais, taxa de servico, entrega, desconto e total.', 'OCR_CUPOM', true, true, 70, 'AGUARDANDO_TESTE'),
  ('NOTA_SERVICO', 'Nota de servico', 'Documento de prestacao de servico (oficina, manutencao, profissional, servicos residenciais). Itens podem representar servicos em vez de produtos.', 'OCR_GENERICO', true, false, 80, 'AGUARDANDO_TESTE'),
  ('RECIBO', 'Recibo', 'Recibo simples sem estrutura fiscal completa. Exige revisao humana maior.', 'OCR_GENERICO', true, false, 90, 'AGUARDANDO_TESTE'),
  ('OUTRO_DOCUMENTO', 'Outro documento', 'Fallback para documento nao reconhecido. Nunca inventar estrutura: classificar como OUTRO_DOCUMENTO e solicitar revisao humana.', 'MANUAL', false, false, 999, 'AGUARDANDO_TESTE');

ALTER TABLE public.documents
  ADD COLUMN document_type_id uuid REFERENCES public.document_types(id),
  ADD COLUMN document_type_confidence numeric NOT NULL DEFAULT 0;

CREATE TABLE public.document_test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type_id uuid NOT NULL REFERENCES public.document_types(id) ON DELETE CASCADE,
  nome_teste text NOT NULL,
  arquivo_referencia text,
  estabelecimento_esperado text,
  data_esperada date,
  valor_esperado numeric,
  quantidade_itens_esperada integer,
  pagamento_esperado text,
  observacoes text,
  resultado public.document_test_status NOT NULL DEFAULT 'AGUARDANDO_TESTE',
  ultimo_teste_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.document_test_cases TO authenticated;
GRANT ALL ON public.document_test_cases TO service_role;
ALTER TABLE public.document_test_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Casos de teste visiveis para autenticados"
  ON public.document_test_cases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Autenticados registram casos de teste"
  ON public.document_test_cases FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Autenticados atualizam casos de teste"
  ON public.document_test_cases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER document_test_cases_updated_at BEFORE UPDATE ON public.document_test_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.document_test_cases (
  document_type_id, nome_teste, estabelecimento_esperado, data_esperada, valor_esperado,
  quantidade_itens_esperada, pagamento_esperado, observacoes, resultado, ultimo_teste_em
)
SELECT dt.id,
  'DANFE NF-e E-commerce — NS2.COM',
  'NS2.COM INTERNET S.A.',
  '2026-08-07'::date,
  618.37,
  4,
  'CREDITO',
  'Bandeira Mastercard. Categorias esperadas: 2 itens Vestuario, 2 itens Calcados.',
  'APROVADO',
  now()
FROM public.document_types dt WHERE dt.codigo = 'DANFE_NFE';