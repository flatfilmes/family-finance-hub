/**
 * Leitura automática de notas fiscais em PDF (DANFE / NF-e).
 * Roda no navegador com pdf.js: extrai o texto posicionado do arquivo e monta
 * uma sugestão de compra estruturada. Sem OCR de imagem, sem QR Code, sem IA.
 *
 * Cada campo lido carrega um nível de confiança (ALTA / MEDIA / BAIXA).
 * Quando um campo não é identificado, ele volta nulo — nunca chutado.
 */
import type { PaymentMethod } from "@/lib/expenses";
import { parseDanfeProductTables } from "@/lib/danfe/danfe-spatial";

export type Confianca = "ALTA" | "MEDIA" | "BAIXA";

export type ExtractedItem = {
  descricao_produto: string;
  quantidade: number;
  unidade: string;
  valor_unitario: number;
  valor_total: number;
};

export type ExtractedNota = {
  estabelecimento: string | null;
  data_compra: string | null;
  valor_total: number;
  forma_pagamento: PaymentMethod | null;
  pagamento_descricao: string | null;
  items: ExtractedItem[];
  linhas: string[];
  confianca: {
    estabelecimento: Confianca;
    data_compra: Confianca;
    valor_total: Confianca;
    forma_pagamento: Confianca;
    items: Confianca;
  };
};

export type PdfCell = { x: number; text: string; width?: number };
export type PdfLine = {
  y: number;
  text: string;
  cells: PdfCell[];
  /** Página (1-based) de onde a linha veio. */
  page?: number;
  /** Coluna visual: "ESQUERDA" | "DIREITA" | "UNICA" (linha de largura total). */
  column?: "ESQUERDA" | "DIREITA" | "UNICA";
};


/** Converte "1.234,56" ou "1234.56" em número. */
export function parseValorBr(raw: string): number {
  const limpo = raw.replace(/[^\d,.-]/g, "").trim();
  if (!limpo) return 0;
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

const MOEDA_RE = /\d{1,3}(?:\.\d{3})*,\d{2,4}|\d+,\d{2,4}/g;

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Item bruto de texto do PDF com posição preservada. */
export type PdfTextItem = { text: string; x: number; y: number; width: number };

export type PdfPageLayout = {
  page: number;
  width: number;
  height: number;
  items: PdfTextItem[];
};

export type PdfColumnBounds = {
  left: { minX: number; maxX: number };
  right: { minX: number; maxX: number };
  gutter: { minX: number; maxX: number };
  source: "HEADERS" | "SPATIAL_GAP";
};

export type PdfPageLayoutDebug = {
  page: number;
  pageWidth: number;
  textItems: number;
  bounds: PdfColumnBounds | null;
  leftItems: number;
  rightItems: number;
  unassignedItems: number;
  samples: Array<{
    text: string;
    x: number;
    y: number;
    width: number;
    centerX: number;
    column: PdfLine["column"];
  }>;
};

const Y_TOLERANCIA = 3;

function agruparEmLinhas(
  itens: PdfTextItem[],
  page: number,
  column: NonNullable<PdfLine["column"]>,
): PdfLine[] {
  const porLinha = new Map<number, PdfCell[]>();
  for (const it of itens) {
    const chave = Math.round(it.y / Y_TOLERANCIA) * Y_TOLERANCIA;
    const lista = porLinha.get(chave) ?? [];
    lista.push({ x: it.x, width: it.width, text: it.text });
    porLinha.set(chave, lista);
  }
  const linhas: PdfLine[] = [];
  for (const [y, partes] of [...porLinha.entries()].sort((a, b) => b[0] - a[0])) {
    const cells = partes.sort((a, b) => a.x - b.x).filter((c) => c.text);
    const text = cells.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
    if (text) linhas.push({ y, text, cells, page, column });
  }
  return linhas;
}

/**
 * Procura um corte vertical (duas colunas) próximo ao meio da página.
 * Só aceita o corte quando praticamente nenhum item atravessa a faixa central.
 */
const textoPlano = (texto: string) =>
  texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const centroX = (item: PdfTextItem) => item.x + Math.max(0, item.width) / 2;

/**
 * Detecta as duas tabelas pelo cabeçalho repetido do Itaú. Como segunda opção,
 * procura o maior espaço real entre centros de itens — nunca usa apenas metade
 * da página e nunca decide pela posição do primeiro fragmento de uma linha.
 */
export function detectPdfColumnBounds(
  itens: PdfTextItem[],
  pageWidth: number,
): PdfColumnBounds | null {
  if (!pageWidth || itens.length < 12) return null;

  const datas = itens
    .filter((item) => /^DATA\b/.test(textoPlano(item.text)))
    .sort((a, b) => a.x - b.x);
  for (let i = 0; i < datas.length - 1; i++) {
    const esquerda = datas[i];
    const direita = datas[i + 1];
    if (!esquerda || !direita) continue;
    const distancia = direita.x - esquerda.x;
    if (distancia < pageWidth * 0.3) continue;
    const mesmaAltura = Math.abs(esquerda.y - direita.y) <= 8;
    if (!mesmaAltura) continue;

    const leftHeader = itens.filter(
      (item) => Math.abs(item.y - esquerda.y) <= 8 && centroX(item) < centroX(direita),
    );
    const rightHeader = itens.filter(
      (item) => Math.abs(item.y - direita.y) <= 8 && centroX(item) >= centroX(direita),
    );
    const leftMaxX = Math.max(...leftHeader.map((item) => item.x + item.width), esquerda.x);
    const rightMinX = Math.min(...rightHeader.map((item) => item.x), direita.x);
    const midpoint = (centroX(esquerda) + centroX(direita)) / 2;
    const gutterMin = leftMaxX < rightMinX ? leftMaxX : midpoint - 2;
    const gutterMax = leftMaxX < rightMinX ? rightMinX : midpoint + 2;
    return {
      left: { minX: 0, maxX: gutterMin },
      right: { minX: gutterMax, maxX: pageWidth },
      gutter: { minX: gutterMin, maxX: gutterMax },
      source: "HEADERS",
    };
  }

  const body = itens
    .filter((item) => item.width < pageWidth * 0.46)
    .map(centroX)
    .filter((x) => x > pageWidth * 0.08 && x < pageWidth * 0.92)
    .sort((a, b) => a - b);
  let melhor: { minX: number; maxX: number; gap: number } | null = null;
  for (let i = 0; i < body.length - 1; i++) {
    const minX = body[i];
    const maxX = body[i + 1];
    if (minX == null || maxX == null) continue;
    const gap = maxX - minX;
    const meio = (minX + maxX) / 2;
    const esquerda = body.filter((x) => x <= minX).length;
    const direita = body.filter((x) => x >= maxX).length;
    if (meio < pageWidth * 0.35 || meio > pageWidth * 0.65 || esquerda < 5 || direita < 5) continue;
    if (!melhor || gap > melhor.gap) melhor = { minX, maxX, gap };
  }
  if (!melhor || melhor.gap < pageWidth * 0.025) return null;
  return {
    left: { minX: 0, maxX: melhor.minX },
    right: { minX: melhor.maxX, maxX: pageWidth },
    gutter: { minX: melhor.minX, maxX: melhor.maxX },
    source: "SPATIAL_GAP",
  };
}

/**
 * Monta as linhas visuais de uma página respeitando o layout em duas colunas:
 * primeiro a coluna esquerda inteira, depois a direita — nunca intercaladas.
 */
export function layoutPageLines(itens: PdfTextItem[], pageWidth: number, page = 1): PdfLine[] {
  const limpos = itens.filter((i) => i.text.trim());
  if (!limpos.length) return [];
  const bounds = detectPdfColumnBounds(limpos, pageWidth);
  if (!bounds) return agruparEmLinhas(limpos, page, "UNICA");

  const esquerda: PdfTextItem[] = [];
  const direita: PdfTextItem[] = [];
  const largura: PdfTextItem[] = [];
  for (const item of limpos) {
    const center = centroX(item);
    const ocupaQuaseTudo = item.width >= pageWidth * 0.7;
    if (ocupaQuaseTudo) largura.push(item);
    else if (center <= bounds.gutter.minX) esquerda.push(item);
    else if (center >= bounds.gutter.maxX) direita.push(item);
    else if (center < (bounds.gutter.minX + bounds.gutter.maxX) / 2) esquerda.push(item);
    else direita.push(item);
  }

  const topoColunas = Math.max(...[...esquerda, ...direita].map((i) => i.y));
  const cabecalho = largura.filter((i) => i.y > topoColunas);
  const rodape = largura.filter((i) => i.y <= topoColunas);

  return [
    ...agruparEmLinhas(cabecalho, page, "UNICA"),
    ...agruparEmLinhas(esquerda, page, "ESQUERDA"),
    ...agruparEmLinhas(direita, page, "DIREITA"),
    ...agruparEmLinhas(rodape, page, "UNICA"),
  ];
}

export function debugPdfPageLayout(layout: PdfPageLayout): PdfPageLayoutDebug {
  const items = layout.items.filter((item) => item.text.trim());
  const bounds = detectPdfColumnBounds(items, layout.width);
  let leftItems = 0;
  let rightItems = 0;
  let unassignedItems = 0;
  const samples = items
    .filter((item) => /BENONI|GASTROPUB|20\/05|12\/07|410,85|25,00/i.test(item.text))
    .map((item) => {
      const center = centroX(item);
      let column: PdfLine["column"] = "UNICA";
      if (bounds && item.width < layout.width * 0.7) {
        column = center < (bounds.gutter.minX + bounds.gutter.maxX) / 2 ? "ESQUERDA" : "DIREITA";
      }
      return { text: item.text, x: item.x, y: item.y, width: item.width, centerX: center, column };
    });
  for (const item of items) {
    if (!bounds || item.width >= layout.width * 0.7) unassignedItems++;
    else if (centroX(item) < (bounds.gutter.minX + bounds.gutter.maxX) / 2) leftItems++;
    else rightItems++;
  }
  return { page: layout.page, pageWidth: layout.width, textItems: items.length, bounds, leftItems, rightItems, unassignedItems, samples };
}

export async function extractPdfPageLayouts(file: Blob): Promise<PdfPageLayout[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const layouts: PdfPageLayout[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const items: PdfTextItem[] = [];
    for (const item of content.items as { str: string; transform: number[]; width?: number; height?: number }[]) {
      if (!item.str || !item.str.trim()) continue;
      items.push({
        text: item.str.replace(/\s+/g, " ").trim(),
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        width: item.width ?? 0,
      });
    }
    layouts.push({ page: p, width: viewport.width, height: viewport.height, items });
  }
  await doc.cleanup();
  return layouts;
}

/** Extrai as linhas do PDF preservando colunas e posição (x, y) de cada trecho. */
export async function extractPdfLines(file: Blob): Promise<PdfLine[]> {
  const linhas: PdfLine[] = [];
  const layouts = await extractPdfPageLayouts(file);
  for (const layout of layouts) {
    linhas.push(...layoutPageLines(layout.items, layout.width, layout.page));
  }
  return linhas;
}


/** Extrai o texto de um PDF, uma linha por linha visual. */
export async function extractPdfText(file: Blob): Promise<string[]> {
  return (await extractPdfLines(file)).map((l) => l.text);
}

// ---------------------------------------------------------------- pagamento

const BANDEIRAS = [
  "mastercard",
  "master card",
  "visa",
  "elo",
  "american express",
  "amex",
  "hipercard",
  "hiper",
  "diners",
];

const PAGAMENTOS: { termos: string[]; forma: PaymentMethod }[] = [
  { termos: ["pix"], forma: "PIX" },
  { termos: ["cartao de credito", "cartao credito", "credito", "parcelado"], forma: "CREDITO" },
  { termos: ["cartao de debito", "cartao debito", "debito"], forma: "DEBITO" },
  { termos: ["boleto", "duplicata"], forma: "BOLETO" },
  { termos: ["dinheiro", "especie"], forma: "DINHEIRO" },
  { termos: ["transferencia", "ted", "doc bancario"], forma: "TRANSFERENCIA" },
];

// ------------------------------------------------------------ estabelecimento

const IGNORAR_ESTABELECIMENTO = [
  "documento auxiliar",
  "nota fiscal",
  "danfe",
  "cupom fiscal",
  "consumidor",
  "sefaz",
  "chave de acesso",
  "protocolo",
  "data de recebimento",
  "identificacao e assinatura",
  "recebemos de",
  "destinatario",
  "remetente",
  "entrada",
  "saida",
  "serie",
  "folha",
  "controle do fisco",
  "consulta de autenticidade",
  "natureza da operacao",
  "inscricao estadual",
];

const SUFIXO_EMPRESA =
  /(\bs\/?\.?\s?a\.?\b|\bltda\b|\bme\b|\bepp\b|\beireli\b|\bmei\b|\bcia\b|\bs\.?a\.?$)/i;

const PALAVRA_COMERCIO =
  /(comercio|comércio|mercado|supermercado|loja|farmacia|farmácia|distribuidora|industria|indústria|servicos|serviços|internet|magazine|atacad)/i;

const UNIDADES_CONHECIDAS = [
  "UN",
  "UND",
  "UNID",
  "PC",
  "PÇ",
  "PCT",
  "KG",
  "G",
  "L",
  "LT",
  "ML",
  "CX",
  "M",
  "M2",
  "DZ",
  "PAR",
];

/** Converte "12/03/2025" (ou 2025-03-12) em ISO yyyy-mm-dd. */
function parseData(texto: string): string | null {
  const br = texto.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (br) {
    const dia = Number(br[1]);
    const mes = Number(br[2]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) return `${br[3]}-${br[2]}-${br[1]}`;
  }
  const iso = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function limparNome(raw: string): string {
  return raw
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–:.]+/, "").replace(/[\s\-–:]+$/, "")
    .slice(0, 80)
    .trim();
}

/** Razão social do emitente. */
function acharEstabelecimento(linhas: PdfLine[]): { valor: string | null; confianca: Confianca } {
  const textos = linhas.map((l) => l.text);

  // 1) "RECEBEMOS DE <RAZÃO SOCIAL> OS PRODUTOS..." — cabeçalho oficial do DANFE.
  for (const t of textos.slice(0, 12)) {
    const m = semAcento(t).indexOf("recebemos de");
    if (m < 0) continue;
    let trecho = t.slice(m + "recebemos de".length);
    const corte = semAcento(trecho).search(/\bos produtos|\bconstantes|\bcnpj\b|\bo(s)? servico/);
    if (corte > 0) trecho = trecho.slice(0, corte);
    const nome = limparNome(trecho);
    if (nome.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 4) return { valor: nome, confianca: "ALTA" };
  }

  // 2) Bloco "IDENTIFICAÇÃO DO EMITENTE": a razão social vem logo abaixo do rótulo.
  const idx = textos.findIndex((t) => semAcento(t).includes("identificacao do emitente"));
  if (idx >= 0) {
    for (const t of textos.slice(idx + 1, idx + 5)) {
      const l = semAcento(t);
      if (IGNORAR_ESTABELECIMENTO.some((termo) => l.includes(termo))) continue;
      if (t.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 4) continue;
      return { valor: limparNome(t), confianca: "ALTA" };
    }
  }

  // 3) Linha do topo com sufixo empresarial (S.A., LTDA, ME...).
  for (const t of textos.slice(0, 40)) {
    const l = semAcento(t);
    if (IGNORAR_ESTABELECIMENTO.some((termo) => l.includes(termo))) continue;
    if (t.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 4) continue;
    if (SUFIXO_EMPRESA.test(t)) return { valor: limparNome(t), confianca: "ALTA" };
  }

  // 4) Linha do topo com palavra típica de comércio.
  for (const t of textos.slice(0, 40)) {
    const l = semAcento(t);
    if (IGNORAR_ESTABELECIMENTO.some((termo) => l.includes(termo))) continue;
    if (PALAVRA_COMERCIO.test(t) && t.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 5) {
      return { valor: limparNome(t), confianca: "MEDIA" };
    }
  }

  return { valor: null, confianca: "BAIXA" };
}

/** Valor da coluna que fica logo abaixo (mesma posição x) de um rótulo. */
function valorAbaixoDoRotulo(linhas: PdfLine[], indice: number, xRotulo: number): number {
  for (const linha of linhas.slice(indice + 1, indice + 4)) {
    let melhor: { valor: number; dist: number } | null = null;
    for (const cell of linha.cells) {
      const valores = cell.text.match(MOEDA_RE);
      if (!valores) continue;
      const valor = parseValorBr(valores[valores.length - 1]!);
      if (valor <= 0) continue;
      const dist = Math.abs(cell.x - xRotulo);
      if (!melhor || dist < melhor.dist) melhor = { valor, dist };
    }
    if (melhor && melhor.dist < 120) return melhor.valor;
  }
  return 0;
}

/** Data de emissão da nota (nunca a data de recebimento). */
function acharData(linhas: PdfLine[]): { valor: string | null; confianca: Confianca } {
  const textos = linhas.map((l) => l.text);

  for (let i = 0; i < linhas.length; i++) {
    const l = semAcento(textos[i]!);
    const temEmissao = /data\s+(de|da)?\s*emissao|dt\.?\s*emissao|emissao/.test(l);
    if (!temEmissao) continue;
    if (l.includes("recebimento")) {
      // Linha mista de rótulos: pega a data na linha seguinte mesmo assim.
      const proxima = parseData(textos[i + 1] ?? "");
      if (proxima) return { valor: proxima, confianca: "MEDIA" };
      continue;
    }
    const naLinha = parseData(textos[i]!);
    if (naLinha) return { valor: naLinha, confianca: "ALTA" };
    for (const seguinte of textos.slice(i + 1, i + 4)) {
      const d = parseData(seguinte);
      if (d) return { valor: d, confianca: "ALTA" };
    }
  }

  // Sem rótulo de emissão: primeira data do documento fora do bloco de recebimento.
  for (const t of textos) {
    if (semAcento(t).includes("recebimento")) continue;
    const d = parseData(t);
    if (d) return { valor: d, confianca: "MEDIA" };
  }
  return { valor: null, confianca: "BAIXA" };
}

/** Valor total da nota. */
function acharValorTotal(linhas: PdfLine[]): { valor: number; confianca: Confianca } {
  const preferidos = ["valor total da nota", "v. total da nota", "valor total da nf"];
  const alternativos = ["valor a pagar", "total a pagar", "valor total", "total geral", "total"];

  const buscar = (rotulos: string[]) => {
    for (const rotulo of rotulos) {
      for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i]!;
        if (!semAcento(linha.text).includes(rotulo)) continue;

        // Rótulo e valor na mesma linha.
        const cellRotulo =
          linha.cells.find((c) => semAcento(c.text).includes(rotulo)) ?? linha.cells[0]!;
        const posRotulo = semAcento(linha.text).indexOf(rotulo);
        const restoDaLinha = linha.text.slice(posRotulo + rotulo.length);
        const naLinha = restoDaLinha.match(MOEDA_RE);
        if (naLinha && naLinha.length > 0) {
          const valor = parseValorBr(naLinha[0]!);
          if (valor > 0) return valor;
        }

        const depois = linha.cells.filter((c) => c.x > cellRotulo.x);
        for (const cell of depois) {
          const valores = cell.text.match(MOEDA_RE);
          const valor = valores ? parseValorBr(valores[valores.length - 1]!) : 0;
          if (valor > 0) return valor;
        }


        // Rótulo em cima, valor logo abaixo (layout em colunas do DANFE).
        const abaixo = valorAbaixoDoRotulo(linhas, i, cellRotulo.x);
        if (abaixo > 0) return abaixo;
      }
    }
    return 0;
  };

  const preferido = buscar(preferidos);
  if (preferido > 0) return { valor: preferido, confianca: "ALTA" };
  const alternativo = buscar(alternativos);
  if (alternativo > 0) return { valor: alternativo, confianca: "MEDIA" };
  return { valor: 0, confianca: "BAIXA" };
}

/** Forma de pagamento sugerida a partir das informações complementares / faturas. */
function acharPagamento(linhas: PdfLine[]): {
  forma: PaymentMethod | null;
  descricao: string | null;
  confianca: Confianca;
} {
  const plano = semAcento(linhas.map((l) => l.text).join("\n"));

  for (const bandeira of BANDEIRAS) {
    const pos = plano.indexOf(bandeira);
    if (pos < 0) continue;
    const forma: PaymentMethod = plano.includes("cartao de debito") || plano.includes("debito")
      ? "DEBITO"
      : "CREDITO";
    const rotulo = bandeira
      .split(" ")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");
    return { forma, descricao: rotulo, confianca: "ALTA" };
  }

  for (const p of PAGAMENTOS) {
    const termo = p.termos.find((t) => plano.includes(semAcento(t)));
    if (!termo) continue;
    return { forma: p.forma, descricao: termo, confianca: "MEDIA" };
  }

  return { forma: null, descricao: null, confianca: "BAIXA" };
}

// ----------------------------------------------------------------- produtos

const FIM_TABELA = [
  "calculo do issqn",
  "dados adicionais",
  "informacoes complementares",
  "reservado ao fisco",
  "issqn",
];

const LINHA_IGNORADA = [
  "codigo",
  "descricao dos produtos",
  "descricao do produto",
  "ncm",
  "cfop",
  "base de calculo",
  "valor total",
  "subtotal",
  "troco",
  "desconto",
  "tributos",
  "icms",
  "ipi",
  "chave",
  "protocolo",
  "cnpj",
  "cpf",
  "transportador",
  "quantidade total",
  "frete",
  "seguro",
];

function limparDescricao(raw: string): string {
  return raw
    .replace(/\s+(?:CÁLCULO|CALCULO)\s+DO\s+ISSQN.*$/i, "")
    .replace(/\s+c\s+(?=\d+\s+Pares\b)/i, " c/ ")
    .replace(/(?<!-)\s+(?=(?:Preto|Branco|Bege|Azul|Laranja)(?:\+|$))/i, " - ")
    .replace(/(?:\s*-){2,}\s*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–:.]+/, "").replace(/[\s\-–:]+$/, "")
    .slice(0, 120)
    .trim();
}

/**
 * Produtos da tabela "DADOS DO PRODUTO / SERVIÇO" do DANFE.
 * Estrutura de cada linha: código | descrição | NCM | CST | CFOP | UN | QTD |
 * V. UNIT | V. TOTAL | BC ICMS | ...
 */
function acharProdutosDanfe(linhas: PdfLine[]): ExtractedItem[] {
  const textos = linhas.map((l) => l.text);
  const inicio = textos.findIndex((t) => {
    const l = semAcento(t);
    return l.includes("dados do produto") || l.includes("dados dos produtos");
  });
  if (inicio < 0) return [];

  let fim = textos.length;
  for (let i = inicio + 1; i < textos.length; i++) {
    const l = semAcento(textos[i]!);
    if (FIM_TABELA.some((t) => l.includes(t))) {
      fim = i;
      break;
    }
  }

  const items: ExtractedItem[] = [];
  const unidades = UNIDADES_CONHECIDAS.join("|");
  const linhaProdutoCompleta = new RegExp(
    `^\\s*(\\S+)\\s+(.+?)\\s+(\\d{8,14})\\s+\\d{8}\\s+\\d{3}\\s+\\d{4}\\s+(${unidades})\\s+([\\d.,]+)\\s+([\\d.,]+)\\s+([\\d.,]+)\\s+([\\d.,]+)(?:\\s+[\\d.,]+){5}(?:\\s+(.+))?$`,
    "i",
  );
  const linhaProduto = new RegExp(
    `^\\s*(\\S+)\\s+(.+?)\\s+(\\d{8})\\s+.*?\\b(${unidades})\\b\\s+([\\d.,]+)\\s+([\\d.,]+)\\s+([\\d.,]+)`,
    "i",
  );

  const adicionarProduto = (texto: string) => {
    const l = semAcento(texto);
    if (LINHA_IGNORADA.some((t) => l.startsWith(t))) return;
    const completo = texto.match(linhaProdutoCompleta);
    const m = completo ?? texto.match(linhaProduto);
    if (!m) return;

    const complemento = completo ? limparDescricao(completo[9] ?? "") : "";
    const descricao = limparDescricao(`${m[2] ?? ""}${complemento ? ` ${complemento}` : ""}`);
    if (descricao.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 3) return;

    const quantidade = parseValorBr(m[5] ?? "") || 1;
    const unitario = parseValorBr(m[6] ?? "");
    const totalItem = parseValorBr(m[7] ?? "");
    if (totalItem <= 0 && unitario <= 0) return;

    items.push({
      descricao_produto: descricao,
      quantidade,
      unidade: (m[4] ?? "UN").toUpperCase(),
      valor_unitario: unitario > 0 ? unitario : totalItem / (quantidade || 1),
      valor_total: totalItem > 0 ? totalItem : unitario * quantidade,
    });
  };

  // Inclui a própria linha do cabeçalho porque alguns PDFs entregam cabeçalho
  // e todos os produtos no mesmo bloco textual.
  const trechoTabela = textos.slice(inicio, fim).join(" ");
  const inicioProduto = /(?:^|\s)([A-Z0-9]{2,}(?:-[A-Z0-9]+){2,})\s+/g;
  const marcadores = [...trechoTabela.matchAll(inicioProduto)];

  // Alguns DANFEs chegam do pdf.js com toda a tabela em uma única linha.
  // Nesse caso, separa cada produto pelo código antes de aplicar o mesmo parser.
  if (marcadores.length > 0) {
    for (let i = 0; i < marcadores.length; i++) {
      const atual = marcadores[i];
      if (!atual || atual.index === undefined) continue;
      const proximo = marcadores[i + 1];
      const inicioTrecho = atual.index + (atual[0].startsWith(" ") ? 1 : 0);
      const fimTrecho = proximo?.index ?? trechoTabela.length;
      adicionarProduto(trechoTabela.slice(inicioTrecho, fimTrecho).trim());
    }
  } else {
    for (const texto of textos.slice(inicio + 1, fim)) adicionarProduto(texto);
  }

  return items;
}

/** Fallback para cupons simples: descrição seguida de valores na mesma linha. */
function acharProdutosSimples(linhas: PdfLine[]): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const unidades = UNIDADES_CONHECIDAS.join("|");
  const qtdRe = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${unidades})\\b`, "i");

  for (const { text } of linhas) {
    const l = semAcento(text);
    if (LINHA_IGNORADA.some((t) => l.includes(t))) continue;
    const valores = text.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g);
    if (!valores || valores.length === 0) continue;

    const descricao = limparDescricao(
      (text
        .replace(/^\s*\d{1,3}\s+/, "")
        .replace(/\b\d{6,}\b/g, " ")
        .split(/\s{2,}|\s(?=\d{1,3}(?:\.\d{3})*,\d{2})/)[0] ?? "")
        .replace(new RegExp(`\\s*\\d+(?:[.,]\\d+)?\\s*(?:${unidades})\\s*x?\\s*$`, "i"), ""),
    );
    if (descricao.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 3) continue;

    const totalItem = parseValorBr(valores[valores.length - 1]!);
    if (totalItem <= 0) continue;

    const qtdMatch = text.match(qtdRe);
    const quantidade = qtdMatch ? parseValorBr(qtdMatch[1]!) || 1 : 1;
    const unidade = qtdMatch ? qtdMatch[2]!.toUpperCase() : "UN";
    const unitario =
      valores.length > 1 ? parseValorBr(valores[valores.length - 2]!) : totalItem / quantidade;

    items.push({
      descricao_produto: descricao,
      quantidade,
      unidade,
      valor_unitario: unitario > 0 ? unitario : totalItem,
      valor_total: totalItem,
    });
  }

  return items;
}

/** Interpreta as linhas do PDF e devolve a sugestão de compra. */
export function parseNotaFiscal(
  entrada: string[] | PdfLine[],
  produtosEspaciais?: { items: ExtractedItem[]; tabelaEncontrada: boolean; status: string; rejeitados: number },
): ExtractedNota {
  const linhas: PdfLine[] =
    entrada.length > 0 && typeof entrada[0] === "string"
      ? (entrada as string[]).map((text, i) => ({ y: -i, text, cells: [{ x: 0, text }] }))
      : (entrada as PdfLine[]);

  const estab = acharEstabelecimento(linhas);
  const data = acharData(linhas);
  const total = acharValorTotal(linhas);
  const pagamento = acharPagamento(linhas);

  // Prioridade absoluta: geometria real da tabela DANFE.
  // Quando a tabela existe, NUNCA cair no fallback genérico (que criaria um
  // "produto" com o valor total da nota).
  const espacial = produtosEspaciais;
  let items: ExtractedItem[];
  let origem: "ESPACIAL" | "DANFE_TEXTO" | "SIMPLES" | "NENHUM";
  if (espacial?.tabelaEncontrada) {
    items = espacial.items;
    origem = items.length ? "ESPACIAL" : "NENHUM";
  } else {
    const danfe = acharProdutosDanfe(linhas);
    if (danfe.length > 0) {
      items = danfe;
      origem = "DANFE_TEXTO";
    } else {
      items = acharProdutosSimples(linhas);
      origem = items.length ? "SIMPLES" : "NENHUM";
    }
  }
  const somaItens = Number(items.reduce((acc, i) => acc + i.valor_total, 0).toFixed(2));

  let valorTotal = total.valor;
  let confiancaValor = total.confianca;
  if (valorTotal <= 0 && somaItens > 0) {
    valorTotal = somaItens;
    confiancaValor = "MEDIA";
  }

  let confiancaItens: Confianca =
    items.length === 0 ? "BAIXA" : origem === "SIMPLES" ? "MEDIA" : "ALTA";
  if (items.length > 0 && valorTotal > 0) {
    const bate = Math.abs(somaItens - valorTotal) <= Math.max(0.05, valorTotal * 0.01);
    if (!bate && confiancaItens === "ALTA") confiancaItens = "MEDIA";
    if (bate && confiancaItens === "MEDIA") confiancaItens = "ALTA";
  }

  const status =
    espacial?.tabelaEncontrada
      ? espacial.status
      : items.length
        ? "PRODUCTS_FROM_TEXT_HEURISTIC"
        : "PRODUCT_TABLE_NOT_FOUND";

  return {
    estabelecimento: estab.valor,
    data_compra: data.valor,
    valor_total: valorTotal,
    forma_pagamento: pagamento.forma,
    pagamento_descricao: pagamento.descricao,
    items,
    linhas: linhas.map((l) => l.text),
    tabela_produtos: {
      origem,
      status,
      soma_produtos: somaItens,
      total_nota: valorTotal,
      diferenca: Number((somaItens - valorTotal).toFixed(2)),
      rejeitados: espacial?.rejeitados ?? 0,
    },
    confianca: {
      estabelecimento: estab.valor ? estab.confianca : "BAIXA",
      data_compra: data.valor ? data.confianca : "BAIXA",
      valor_total: valorTotal > 0 ? confiancaValor : "BAIXA",
      forma_pagamento: pagamento.confianca,
      items: confiancaItens,
    },
  };
}

/** Interpreta o PDF usando a geometria real das páginas (recomendado). */
export function parseNotaFiscalLayout(pages: PdfPageLayout[]): ExtractedNota {
  const linhas: PdfLine[] = [];
  for (const layout of pages) {
    linhas.push(...layoutPageLines(layout.items, layout.width, layout.page));
  }
  const tabela = parseDanfeProductTables(pages);
  return parseNotaFiscal(linhas, {
    tabelaEncontrada: tabela.tableFound,
    status: tabela.status,
    rejeitados: tabela.rejected.length,
    items: tabela.products.map((p) => ({
      descricao_produto: p.description.slice(0, 200),
      quantidade: p.quantity,
      unidade: p.unit,
      valor_unitario: p.unitPrice,
      valor_total: p.total,
    })),
  });
}

/** Lê o PDF e devolve a sugestão de compra pronta para revisão. */
export async function readNotaFiscalPdf(file: Blob): Promise<ExtractedNota> {
  const pages = await extractPdfPageLayouts(file);
  return parseNotaFiscalLayout(pages);
}

