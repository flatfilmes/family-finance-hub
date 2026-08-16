/**
 * Camada determinística de sugestão de categoria por palavra-chave.
 * É apenas uma sugestão: o usuário sempre pode alterar antes de confirmar.
 */

export type CategoriaSimples = { id: string; nome: string };

/** Nomes oficiais das categorias familiares usadas nas sugestões. */
const REGRAS: Array<{ categoria: string; palavras: string[] }> = [
  {
    categoria: "Calçados",
    palavras: ["tenis", "sapato", "sandalia", "chinelo", "bota", "sapatilha", "crocs", "meia-pata"],
  },
  {
    categoria: "Vestuário",
    palavras: [
      "meia", "meias", "camisa", "camiseta", "calca", "blusa", "jaqueta", "bermuda", "short",
      "vestido", "casaco", "moletom", "cueca", "calcinha", "sutia", "pijama", "agasalho", "bone",
    ],
  },
  { categoria: "Combustível", palavras: ["gasolina", "etanol", "alcool comum", "diesel", "gnv", "combustivel"] },
  {
    categoria: "Automóvel",
    palavras: ["pneu", "oleo motor", "revisao", "oficina", "estacionamento", "pedagio", "lavagem", "ipva"],
  },
  {
    categoria: "Mercado",
    palavras: [
      "arroz", "feijao", "macarrao", "leite", "cafe", "acucar", "farinha", "oleo de soja", "sal",
      "molho", "biscoito", "bolacha", "cereal", "enlatado", "azeite", "supermercado", "mercado",
    ],
  },
  { categoria: "Padaria", palavras: ["pao", "paes", "baguete", "croissant", "bolo", "sonho", "padaria", "torta"] },
  {
    categoria: "Açougue / Proteínas",
    palavras: ["carne", "frango", "peixe", "porco", "picanha", "alcatra", "linguica", "costela", "ovo", "acougue", "file"],
  },
  {
    categoria: "Hortifruti",
    palavras: ["banana", "maca", "tomate", "alface", "cebola", "batata", "cenoura", "laranja", "limao", "verdura", "legume", "fruta"],
  },
  {
    categoria: "Bebidas",
    palavras: ["refrigerante", "cerveja", "suco", "agua mineral", "vinho", "energetico", "whisky", "vodka", "cha gelado"],
  },
  {
    categoria: "Higiene",
    palavras: ["shampoo", "xampu", "sabonete", "creme dental", "pasta de dente", "condicionador", "desodorante", "papel higienico", "absorvente", "fralda", "escova de dente"],
  },
  {
    categoria: "Limpeza",
    palavras: ["detergente", "sabao", "desinfetante", "amaciante", "agua sanitaria", "alvejante", "esponja", "limpador", "multiuso"],
  },
  {
    categoria: "Farmácia",
    palavras: ["remedio", "medicamento", "dipirona", "farmacia", "paracetamol", "ibuprofeno", "antibiotico", "pomada", "vitamina", "drogaria"],
  },
  { categoria: "Saúde", palavras: ["consulta", "exame", "dentista", "psicologo", "fisioterapia", "plano de saude", "laboratorio"] },
  { categoria: "Tecnologia", palavras: ["notebook", "celular", "smartphone", "fone", "mouse", "teclado", "monitor", "tablet", "carregador", "hd ", "ssd"] },
  { categoria: "Assinaturas", palavras: ["netflix", "spotify", "assinatura", "prime video", "disney", "youtube premium", "icloud", "google one"] },
  { categoria: "Educação", palavras: ["escola", "faculdade", "curso", "mensalidade", "livro", "apostila", "material escolar"] },
  { categoria: "Lazer", palavras: ["cinema", "viagem", "hotel", "ingresso", "parque", "restaurante", "bar ", "lanche", "passeio"] },
  { categoria: "Casa", palavras: ["movel", "sofa", "cadeira", "panela", "toalha", "lampada", "cortina", "colchao", "ferramenta"] },
  { categoria: "Serviços", palavras: ["servico", "manutencao", "encanador", "eletricista", "diarista", "conserto", "frete"] },
];

function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Nome da categoria sugerida para uma descrição de produto (ou null). */
export function suggestCategoryName(descricao: string): string | null {
  const texto = ` ${normalizar(descricao)} `;
  for (const regra of REGRAS) {
    if (regra.palavras.some((p) => texto.includes(normalizar(p)))) return regra.categoria;
  }
  return null;
}

/** Id da categoria sugerida, buscando pelo nome na lista de categorias cadastradas. */
export function suggestCategoryId(descricao: string, categorias: CategoriaSimples[]): string | null {
  const nome = suggestCategoryName(descricao);
  if (!nome) return null;
  const alvo = normalizar(nome);
  return categorias.find((c) => normalizar(c.nome) === alvo)?.id ?? null;
}
