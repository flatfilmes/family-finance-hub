-- 1. Evita duplicidade de categorias por nome
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_nome_key ON public.expense_categories (nome);

-- 2. Novas categorias familiares (mantém as existentes intactas)
INSERT INTO public.expense_categories (nome, icone, ativo) VALUES
  ('Mercado', 'ShoppingCart', true),
  ('Padaria', 'Croissant', true),
  ('Açougue / Proteínas', 'Beef', true),
  ('Hortifruti', 'Apple', true),
  ('Bebidas', 'CupSoda', true),
  ('Higiene', 'Bath', true),
  ('Limpeza', 'SprayCan', true),
  ('Farmácia', 'Pill', true),
  ('Vestuário', 'Shirt', true),
  ('Calçados', 'Footprints', true),
  ('Combustível', 'Fuel', true),
  ('Automóvel', 'Car', true),
  ('Tecnologia', 'Laptop', true),
  ('Assinaturas', 'Repeat', true),
  ('Serviços', 'Wrench', true)
ON CONFLICT (nome) DO NOTHING;

-- 3. Estrutura de aprendizado da categorização por item
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS categoria_sugerida uuid REFERENCES public.expense_categories(id),
  ADD COLUMN IF NOT EXISTS categoria_ajustada boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.purchase_items.categoria_sugerida IS 'Categoria sugerida automaticamente na importação';
COMMENT ON COLUMN public.purchase_items.categoria_ajustada IS 'Usuário alterou a sugestão automática';