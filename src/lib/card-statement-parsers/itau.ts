/**
 * Parser especializado da fatura do Itaú (PDF digital).
 *
 * A fatura do Itaú é organizada em seções. Só as seções de consumo do ciclo
 * viram lançamentos:
 *   - "Lançamentos: compras e saques"
 *   - "Lançamentos internacionais"
 *   - "Lançamentos: produtos e serviços"
 *
 * Tudo o mais (resumo, limites, simulações de parcelamento, propostas,
 * "compras parceladas - próximas faturas", projeções) é lido apenas como
 * metadado — nunca como lançamento. Nada é inventado: campo sem evidência
 * volta como `null`.
 */
import { parseValorBr, type PdfLine } from "@/lib/pdf-extract";
import { normalizeDescricao, semAcento, tituloEstabelecimento } from "./generic";
import type {
  ParsedStatement,
  StatementCardSubtotal,
  StatementEntry,
  StatementItemKind,
  StatementMetadata,
  StatementParser,
} from "./types";

// ------------------------------------------------------------------ utilidades

const plano = (s: string) => semAcento(s).toLowerCase().replace(/\s+/g, " ").trim();

const VALOR_FIM = /(-?)\s*R?\$?\s*(-?)\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
const DATA_CURTA = /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\b/;
const PARCELA_FIM = /\s(\d{1,2})\s*\/\s*(\d{1,2})\s*$/;

function iso(ano: number, mes: number, dia: number) {
  if (!ano || !mes || !dia) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function lerValorFinal(texto: string): { valor: number; resto: string } | null {
  const m = texto.match(VALOR_FIM);
  if (!m) return null;
  const negativo = m[1] === "-" || m[2] === "-";
  const valor = Math.abs(parseValorBr(m[3]!)) * (negativo ? -1 : 1);
  return { valor, resto: texto.slice(0, texto.length - m[0].length).trim() };
}

function acharDataRotulada(linhas: string[], rotulos: string[]) {
  for (const l of linhas) {
    const p = plano(l);
    if (!rotulos.some((r) => p.includes(r))) continue;
    const m = l.match(/(\d{2})[/.-](\d{2})[/.-](\d{2,4})/);
    if (m) {
      let ano = Number(m[3]);
      if (ano < 100) ano += 2000;
      return iso(ano, Number(m[2]), Number(m[1]));
    }
  }
  return null;
}

function acharValorRotulado(linhas: string[], rotulos: string[], proibidos: string[] = []) {
  for (const l of linhas) {
    const p = plano(l);
    if (!rotulos.some((r) => p.includes(r))) continue;
    if (proibidos.some((r) => p.includes(r))) continue;
    const v = lerValorFinal(l);
    if (v) return v.valor;
    const m = l.match(/-?\s*R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}/);
    if (m) return parseValorBr(m[0]);
  }
  return null;
}

// ------------------------------------------------------------------ seções

type Secao = "COMPRAS" | "INTERNACIONAL" | "SERVICOS" | "FUTURAS" | "IGNORADA";

const CABECALHOS: Array<{ secao: Secao; termos: string[] }> = [
  {
    secao: "FUTURAS",
    termos: [
      "compras parceladas - proximas faturas",
      "compras parceladas – proximas faturas",
      "compras parceladas proximas faturas",
      "proximas faturas",
    ],
  },
  {
    secao: "COMPRAS",
    termos: ["lancamentos: compras e saques", "lancamentos compras e saques", "compras e saques"],
  },
  { secao: "INTERNACIONAL", termos: ["lancamentos internacionais", "compras internacionais"] },
  {
    secao: "SERVICOS",
    termos: ["lancamentos: produtos e servicos", "lancamentos produtos e servicos"],
  },
  {
    secao: "IGNORADA",
    termos: [
      "resumo da fatura",
      "limites",
      "limite de credito",
      "limite total de credito",
      "simulacao",
      "simule",
      "parcelamento da fatura",
      "parcele sua fatura",
      "pagamento minimo",
      "credito pessoal",
      "saque cash",
      "emprestimo",
      "proposta",
      "oferta",
      "cet",
      "encargos e juros",
      "informacoes importantes",
      "como pagar",
      "central de atendimento",
      "programa de pontos",
      "seguro",
    ],
  },
];

function secaoDaLinha(texto: string): Secao | null {
  const p = plano(texto);
  if (p.length > 90) return null;
  for (const c of CABECALHOS) if (c.termos.some((t) => p.startsWith(t) || p === t)) return c.secao;
  // "Compras parceladas" seguido de "próximas faturas" na mesma linha
  if (p.includes("parceladas") && p.includes("proximas faturas")) return "FUTURAS";
  return null;
}

const RUIDO_LINHA = [
  "data estabelecimento",
  "data descricao",
  "lancamentos no cartao",
  "total dos lancamentos",
  "total desta fatura",
  "total da fatura anterior",
  "pagamentos efetuados",
  "subtotal",
  "continua",
  "pagina",
  "limite",
  "saldo",
  "vencimento",
  "fechamento",
  "cnpj",
  "cpf",
  "www",
  "sac",
  "ouvidoria",
  "valor em r$",
  "total para proximas faturas",
  "proxima fatura",
  "demais faturas",
];

function ehRuido(texto: string) {
  const p = plano(texto);
  if (p.length < 3) return true;
  return RUIDO_LINHA.some((r) => p.startsWith(r));
}

/**
 * Linhas que NUNCA podem virar lançamento, apareçam onde aparecerem:
 * limites, simulações de parcelamento, CET, juros/IOF de simulação, saque.
 */
const TERMOS_PROIBIDOS = [
  "limite",
  "limites",
  "saque cash",
  "limite para saque",
  "simulacao",
  "simule",
  "parcelamento da fatura",
  "parcele sua fatura",
  "pagamento minimo",
  "valor total financiado",
  "cet",
  "taxa de juros",
  "juros ao mes",
  "credito pessoal",
  "emprestimo",
  "proposta",
];

function ehProibido(texto: string) {
  const p = plano(texto);
  return TERMOS_PROIBIDOS.some((t) => p.includes(t));
}


// ------------------------------------------------------------------ categorias do banco

const CATEGORIAS_ITAU: Record<string, string | null> = {
  alimentacao: "Mercado",
  supermercado: "Mercado",
  restaurante: "Lazer",
  saude: "Saúde",
  farmacia: "Farmácia",
  veiculos: "Automóvel",
  combustivel: "Combustível",
  vestuario: "Vestuário",
  calcados: "Calçados",
  "turismo e entretenimento": "Lazer",
  turismo: "Lazer",
  entretenimento: "Lazer",
  hobby: "Lazer",
  educacao: "Educação",
  servicos: "Serviços",
  casa: "Casa",
  tecnologia: "Tecnologia",
  diversos: null,
};

/** Categoria impressa pelo banco, quando aparece colada ao lançamento. */
export function categoriaDoBanco(descricao: string): string | null {
  const p = plano(descricao);
  const achou = Object.keys(CATEGORIAS_ITAU)
    .sort((a, b) => b.length - a.length)
    .find((k) => p.startsWith(k) || p.includes(` ${k} `) || p.includes(`${k} .`));
  if (!achou) return null;
  return CATEGORIAS_ITAU[achou] ?? null;
}

/** Remove categoria do banco e cidade (".TUBARAO") do nome do estabelecimento. */
function limparEstabelecimento(descricao: string) {
  let texto = descricao;
  for (const chave of Object.keys(CATEGORIAS_ITAU)) {
    const re = new RegExp(`^${chave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const semAcentoTexto = plano(texto);
    if (re.test(semAcentoTexto)) {
      texto = texto.slice(chave.length).trim();
      break;
    }
  }
  texto = texto.replace(/\s*\.[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ\s]{2,}$/u, "").trim();
  return texto || descricao;
}

// ------------------------------------------------------------------ classificação

const CLASSES: Array<{ tipo: StatementItemKind; termos: string[] }> = [
  { tipo: "PAGAMENTO", termos: ["pagamento efetuado", "pagamento recebido", "pagto", "pgto"] },
  { tipo: "ESTORNO", termos: ["estorno", "devolucao", "reembolso", "credito de", "cancelamento"] },
  { tipo: "JUROS", termos: ["juros", "encargos", "rotativo", "mora", "multa"] },
  {
    tipo: "TAXA",
    termos: ["anuidade", "iof", "tarifa", "seguro", "taxa", "avaliacao emergencial", "servico"],
  },
  { tipo: "AJUSTE", termos: ["ajuste", "correcao"] },
];

function classificar(descricao: string, valor: number, secao: Secao): StatementItemKind {
  const texto = plano(descricao);
  for (const c of CLASSES) if (c.termos.some((t) => texto.includes(t))) return c.tipo;
  if (secao === "SERVICOS") return "TAXA";
  if (valor < 0) return "ESTORNO";
  return "COMPRA";
}

// ------------------------------------------------------------------ montagem

function montar(
  dataTexto: string | null,
  descricaoBruta: string,
  valor: number,
  secao: Secao,
  cardLast4: string | null,
  anoBase: number,
  mesVencimento: number | null,
): StatementEntry | null {
  let descricao = descricaoBruta.replace(/\s+/g, " ").trim();
  if (!descricao || ehRuido(descricao) || ehProibido(descricao)) return null;
  if (!/[A-Za-zÀ-ÿ]{3}/.test(descricao)) return null;


  let parcelaAtual: number | null = null;
  let totalParcelas: number | null = null;
  const p = descricao.match(PARCELA_FIM);
  if (p) {
    const a = Number(p[1]);
    const b = Number(p[2]);
    if (a >= 1 && b >= 2 && a <= b) {
      parcelaAtual = a;
      totalParcelas = b;
      descricao = descricao.slice(0, descricao.length - p[0].length).trim();
    }
  }

  let data: string | null = null;
  if (dataTexto) {
    const m = dataTexto.match(DATA_CURTA);
    if (m) {
      const dia = Number(m[1]);
      const mes = Number(m[2]);
      let ano = m[3] ? Number(m[3]) : anoBase;
      if (ano < 100) ano += 2000;
      if (!m[3] && mesVencimento && mes > mesVencimento) ano = anoBase - 1;
      data = iso(ano, mes, dia);
    }
  }

  // proteção contra registro mesclado de duas colunas
  const ambiguo =
    /\b\d{2}\/\d{2}\b/.test(descricao) ||
    /\d{1,3}(?:\.\d{3})*,\d{2}/.test(descricao);

  const tipo = ambiguo ? "OUTRO" : classificar(descricao, valor, secao);
  const limpo = limparEstabelecimento(descricao);
  return {
    ambiguo,
    data_lancamento: data,
    descricao_original: descricaoBruta.replace(/\s+/g, " ").trim(),
    descricao_normalizada: normalizeDescricao(limpo),
    estabelecimento_sugerido: tipo === "COMPRA" ? tituloEstabelecimento(limpo) : null,
    valor,
    parcela_atual: parcelaAtual,
    total_parcelas: totalParcelas,
    tipo_sugerido: tipo,
    card_last4: cardLast4,
    categoria_banco: categoriaDoBanco(descricao),
  };
}

// ------------------------------------------------------------------ leitura principal

export function parseItau(pdfLinhas: PdfLine[]): ParsedStatement {
  const textos = pdfLinhas.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);

  // ---------- cabeçalho e metadados
  const vencimento = acharDataRotulada(textos, ["vencimento", "vence em", "pagar ate"]);
  const emissao = acharDataRotulada(textos, ["emissao", "emitida em", "data de emissao"]);
  const fechamento =
    acharDataRotulada(textos, ["proximo fechamento", "fechamento"]) ?? null;

  const totalAnterior = acharValorRotulado(textos, ["total da fatura anterior", "fatura anterior"]);
  const pagamentoAnterior = acharValorRotulado(textos, ["pagamento efetuado", "pagamentos efetuados"]);
  const lancamentosAtuais = acharValorRotulado(textos, ["lancamentos atuais", "lancamentos desta fatura"]);
  const totalFatura =
    acharValorRotulado(textos, ["total desta fatura", "total da fatura atual", "valor total desta fatura"]) ??
    lancamentosAtuais ??
    acharValorRotulado(textos, ["total a pagar", "valor a pagar"], ["anterior", "minimo", "financiado"]);

  const metadata: StatementMetadata = {
    data_emissao: emissao,
    total_fatura_anterior: totalAnterior,
    pagamento_anterior: pagamentoAnterior === null ? null : -Math.abs(pagamentoAnterior),
    lancamentos_atuais: lancamentosAtuais,
    limite_credito: acharValorRotulado(textos, ["limite total de credito", "limite de credito"]),
    limite_disponivel: acharValorRotulado(textos, ["limite disponivel"]),
    limite_utilizado: acharValorRotulado(textos, ["limite utilizado"]),
    next_invoice_amount: acharValorRotulado(textos, ["proxima fatura"]),
    future_invoices_amount: acharValorRotulado(textos, ["demais faturas"]),
    future_commitments_total: acharValorRotulado(textos, ["total para proximas faturas"]),
  };

  const finalPrincipal =
    textos.map((l) => l.match(/final\s*(\d{4})/i)?.[1]).find(Boolean) ?? null;

  const titular = (() => {
    const rotulado = textos
      .map((l) => l.match(/titular\s*[:\-]?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÃÕÇç' ]{6,60})/)?.[1])
      .find(Boolean);
    if (rotulado) return rotulado.trim();
    const nome = textos.find(
      (l) => /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}(?: [A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}){1,4}$/.test(l) && !ehRuido(l),
    );
    return nome ?? null;
  })();

  const anoBase = Number((vencimento ?? emissao ?? "").slice(0, 4)) || new Date().getFullYear();
  const mesVencimento = vencimento ? Number(vencimento.slice(5, 7)) : null;

  // ---------- varredura por seções
  const entries: StatementEntry[] = [];
  const futuras: StatementEntry[] = [];
  const subtotais: StatementCardSubtotal[] = [];

  let secao: Secao = "IGNORADA";
  let cardLast4: string | null = finalPrincipal;
  let dataPendente: string | null = null;
  let descricaoPendente = "";

  const limpaPendente = () => {
    dataPendente = null;
    descricaoPendente = "";
  };

  let contexto = "";
  for (const pdfLinha of pdfLinhas) {
    const linha = pdfLinha.text.replace(/\s+/g, " ").trim();
    if (!linha) continue;
    const chaveContexto = `${pdfLinha.page ?? 1}:${pdfLinha.column ?? "UNICA"}`;
    if (chaveContexto !== contexto) {
      // troca de coluna/página: nunca continuar um bloco de outro lado
      contexto = chaveContexto;
      limpaPendente();
    }
    const p = plano(linha);

    // troca de seção
    const nova = secaoDaLinha(linha);
    if (nova) {
      secao = nova;
      limpaPendente();
      continue;
    }

    // blindagem: limites, simulações e ofertas nunca viram lançamento nem trocam de cartão
    if (ehProibido(linha)) {
      limpaPendente();
      continue;
    }



    // final do cartão corrente / subtotais impressos
    const subtotal = linha.match(/lan[çc]amentos no cart[ãa]o\s*\(?\s*final\s*(\d{4})\)?/i);
    if (subtotal) {
      cardLast4 = subtotal[1]!;
      const v = lerValorFinal(linha);
      if (v) subtotais.push({ card_last4: cardLast4, valor: v.valor });
      limpaPendente();
      continue;
    }
    const finalLinha = linha.match(/(?:cart[ãa]o\s*)?final\s*(\d{4})\b/i);
    if (finalLinha && !DATA_CURTA.test(linha)) {
      cardLast4 = finalLinha[1]!;
      limpaPendente();
      continue;
    }

    if (secao === "IGNORADA") continue;

    // pagamento da fatura anterior (informativo)
    if (p.startsWith("pagamento efetuado")) {
      limpaPendente();
      continue;
    }

    if (ehRuido(linha)) {
      limpaPendente();
      continue;
    }

    const alvo = secao === "FUTURAS" ? futuras : entries;
    const comData = linha.match(DATA_CURTA);
    const valorLido = lerValorFinal(linha);

    // linha completa: data + descrição + valor
    if (comData && valorLido) {
      const descricao = valorLido.resto.slice(comData[0].length).trim();
      const item = montar(comData[0], descricao, valorLido.valor, secao, cardLast4, anoBase, mesVencimento);
      if (item) alvo.push(item);
      limpaPendente();
      continue;
    }

    // só a data (bloco em várias linhas)
    if (comData && !valorLido) {
      dataPendente = comData[0];
      descricaoPendente = linha.slice(comData[0].length).trim();
      continue;
    }

    // valor fechando um bloco aberto
    if (!comData && valorLido && dataPendente) {
      const descricao = `${descricaoPendente} ${valorLido.resto}`.trim();
      const item = montar(dataPendente, descricao, valorLido.valor, secao, cardLast4, anoBase, mesVencimento);
      if (item) alvo.push(item);
      limpaPendente();
      continue;
    }

    // descrição solta de um bloco aberto
    if (!comData && !valorLido && dataPendente) {
      descricaoPendente = `${descricaoPendente} ${linha}`.trim();
      continue;
    }

    // valor sem data: seções de serviços/internacional (anuidade, IOF) e parcelas futuras
    if (
      !comData &&
      valorLido &&
      (secao === "SERVICOS" || secao === "INTERNACIONAL" || secao === "FUTURAS")
    ) {
      const item = montar(null, valorLido.resto, valorLido.valor, secao, cardLast4, anoBase, mesVencimento);
      if (item) alvo.push(item);
    }
  }

  // pagamento anterior entra como item informativo (nunca vira compra)
  if (metadata.pagamento_anterior) {
    entries.unshift({
      data_lancamento:
        acharDataRotulada(
          textos.filter((l) => plano(l).includes("pagamento efetuado")),
          ["pagamento efetuado"],
        ) ?? null,
      descricao_original: "Pagamento efetuado da fatura anterior",
      descricao_normalizada: "PAGAMENTO EFETUADO FATURA ANTERIOR",
      estabelecimento_sugerido: null,
      valor: metadata.pagamento_anterior,
      parcela_atual: null,
      total_parcelas: null,
      tipo_sugerido: "PAGAMENTO",
      card_last4: finalPrincipal,
      categoria_banco: null,
    });
  }

  // telemetria de desenvolvimento (nunca exibida ao usuário)
  if (import.meta.env?.DEV) {
    console.debug("[ITAU_PDF] linhas", pdfLinhas.map((l) => ({
      page: l.page, column: l.column, y: l.y, x: l.cells[0]?.x, rawText: l.text,
    })));
    console.debug("[ITAU_PDF] lançamentos", entries.map((e) => ({
      parsedDate: e.data_lancamento,
      description: e.descricao_normalizada,
      installment: e.parcela_atual ? `${e.parcela_atual}/${e.total_parcelas}` : null,
      value: e.valor,
      ambiguo: e.ambiguo,
      card_last4: e.card_last4,
    })));
  }

  return {
    parser: "ITAU_PDF",
    emissor: "ITAU",
    titular,
    final_cartao: finalPrincipal,
    data_fechamento: fechamento,
    data_vencimento: vencimento,
    periodo_inicio: null,
    periodo_fim: null,
    valor_total_fatura: totalFatura,
    entries,
    futuras,
    subtotais,
    metadata,
    linhas: textos,
  };
}

export const itauParser: StatementParser = {
  id: "ITAU_PDF",
  nome: "Itaú",
  detect: (linhas) => {
    const texto = plano(linhas.join(" "));
    const pistas = [
      "banco itau",
      "itau unibanco",
      "itaucard",
      "itau",
      "resumo da fatura em r$",
      "lancamentos: compras e saques",
    ].filter((t) => texto.includes(t));
    if (pistas.length === 0) return 0;
    return Math.min(0.95, 0.8 + pistas.length * 0.03);
  },
  parse: parseItau,
};
