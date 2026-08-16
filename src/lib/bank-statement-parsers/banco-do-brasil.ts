/**
 * Parser de EXTRATO DE CONTA CORRENTE — BANCO DO BRASIL (PDF digital).
 *
 * Regras vindas do layout real do BB:
 *  - o sinal é impresso pelo próprio banco como "(+)" ou "(-)": ele é a única
 *    fonte de verdade. Nunca inferimos sinal pela descrição;
 *  - "Saldo Anterior", "Saldo do dia", "S A L D O" e "Saldo" são CONTROLE DE
 *    SALDO (metadata), nunca movimentação;
 *  - a seção "Lançamentos Futuros" fica separada em `futuros` e não entra em
 *    entradas, saídas nem no saldo realizado;
 *  - seções comerciais (limite, juros, CET, simulação, IOF de simulação) são
 *    ignoradas por completo — a seção do documento é determinante.
 *
 * Nada aqui persiste: é leitura pura, usada tanto no fluxo real quanto no
 * Modo diagnóstico PDF.
 */
import { extractPdfLines, parseValorBr, type PdfCell, type PdfLine } from "@/lib/pdf-extract";
import { lerData, normalizeDescricao, semAcento } from "@/lib/card-statement-parsers/generic";
import type { BankMovementKind, ParsedBankMovement, ParsedBankStatement } from "@/lib/bank-statements/types";
import { eventDateFromHistory } from "@/lib/bank-statements/event-date";
import { montarDescricaoBb, removerColunasTecnicas } from "./bb-description";

export const BB_PARSER_ID = "EXTRATO_BANCO_DO_BRASIL_PDF";

/** Valor seguido do sinal impresso pelo banco. */
const VALOR_COM_SINAL = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*\(\s*([+-])\s*\)/;
/** Sinal impresso ANTES do valor (algumas páginas invertem a ordem das células). */
const SINAL_ANTES_DO_VALOR = /\(\s*([+-])\s*\)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/;
/** Sinal isolado (quando o PDF quebra a linha antes do parêntese). */
const SINAL_SOZINHO = /^\(\s*([+-])\s*\)$/;
const DATA_INICIAL = /^(\d{2})\/(\d{2})\/(\d{4}|\d{2})/;

/** Lê valor + sinal em qualquer das duas ordens possíveis. */
function lerValorComSinal(texto: string): { valor: number; bruto: string } | null {
  const depois = texto.match(VALOR_COM_SINAL);
  if (depois) {
    const abs = Math.abs(parseValorBr(depois[1]!));
    return { valor: depois[2] === "-" ? -abs : abs, bruto: depois[0]! };
  }
  const antes = texto.match(SINAL_ANTES_DO_VALOR);
  if (antes) {
    const abs = Math.abs(parseValorBr(antes[2]!));
    return { valor: antes[1] === "-" ? -abs : abs, bruto: antes[0]! };
  }
  return null;
}



type Secao = "MOVIMENTOS" | "FUTUROS" | "METADATA";

const CABECALHOS_FUTUROS = ["lancamentos futuros", "proximos lancamentos"];
const CABECALHOS_METADATA = [
  "informacoes complementares",
  "informacoes adicionais",
  "limite especial",
  "limite contratado",
  "limite utilizado",
  "limite disponivel",
  "taxa limite especial",
  "cet",
  "simulacao",
  "valor total devido",
  "valor liberado",
  "despesas iof de simulacao",
  "tarifa de simulacao",
  "extrato de conta corrente",
];
const CABECALHOS_MOVIMENTOS = [
  "lancamentos",
  "historico",
  "movimentacao",
  "data movimento",
  // Cabeçalho da tabela repetido no topo de cada página do extrato BB.
  "dia lote",
  "dia lote documento",
];

/** Linhas de controle de saldo — nunca viram movimentação. */
const SALDO_METADATA = [
  "saldo anterior",
  "saldo do dia",
  "s a l d o",
  "saldo final",
  "saldo atual",
  "saldo disponivel",
  "saldo bloqueado",
  "saldo",
];

const CLASSES: Array<{ tipo: BankMovementKind; termos: string[] }> = [
  { tipo: "TARIFA", termos: ["tarifa", "cesta", "anuidade", "i.o.f", "iof", "manutencao"] },
  { tipo: "JUROS", termos: ["juros", "encargos", "mora", "multa", "cheque especial"] },
  { tipo: "ESTORNO", termos: ["estorno", "devolucao", "reembolso"] },
  { tipo: "TRANSFERENCIA", termos: ["ted ", "doc ", "transferencia", "entre contas"] },
];

function plano(texto: string) {
  return semAcento(texto).toLowerCase().replace(/\s+/g, " ").trim();
}

function ehSaldoMetadata(texto: string) {
  const t = plano(texto);
  return SALDO_METADATA.some((s) => t === s || t.startsWith(s));
}

function classificarBb(descricao: string, valor: number): BankMovementKind {
  const t = plano(descricao);
  for (const c of CLASSES) if (c.termos.some((termo) => t.includes(termo))) return c.tipo;
  return valor >= 0 ? "ENTRADA" : "SAIDA";
}

function detectarSecao(texto: string, atual: Secao): Secao {
  const t = plano(texto);
  if (CABECALHOS_FUTUROS.some((c) => t.startsWith(c))) return "FUTUROS";
  if (CABECALHOS_METADATA.some((c) => t.startsWith(c))) return "METADATA";
  if (atual !== "MOVIMENTOS" && CABECALHOS_MOVIMENTOS.some((c) => t.startsWith(c)))
    return "MOVIMENTOS";
  return atual;
}

/**
 * PERÍODO OFICIAL DO EXTRATO BB — única fonte de `periodStart`/`periodEnd`.
 *
 * O cabeçalho real do banco abrevia o início: "Período: 01 a 31/01/2026".
 * Também aceitamos "01/01 a 31/01/2026" e "01/01/2026 a 31/01/2026".
 * Nunca derivamos período de saldo anterior, saldo do dia ou movimentações.
 */
export function parseBBStatementPeriod(
  texto: string,
): { start: string; end: string } | null {
  const m = texto.match(
    /per[ií]odo\s*:?\s*(\d{2})(?:\/(\d{2}))?(?:\/(\d{2,4}))?\s*(?:a|à|até|ate|-|–|até o dia)\s*(\d{2})\/(\d{2})\/(\d{2,4})/i,
  );
  if (!m) return null;
  const ano4 = (a: string) => (a.length === 2 ? `20${a}` : a);
  const fimAno = ano4(m[6]!);
  const fim = `${fimAno}-${m[5]}-${m[4]}`;
  const inicioMes = m[2] ?? m[5]!;
  const inicioAno = m[3] ? ano4(m[3]) : fimAno;
  const inicio = `${inicioAno}-${inicioMes}-${m[1]}`;
  const valida = (d: string) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d);
  if (!valida(inicio) || !valida(fim) || inicio > fim) return null;
  return { start: inicio, end: fim };
}

function buscar(textos: string[], re: RegExp) {
  for (const linha of textos) {
    const m = linha.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/**
 * É um extrato do Banco do Brasil? O sinal impresso "(+)/(-)" ao lado do valor
 * é assinatura do layout BB: quando ele aparece de forma recorrente, o parser
 * dedicado é usado mesmo que a marca textual do banco não tenha sido extraída.
 */
export function isBancoDoBrasil(textos: string[]) {
  const t = plano(textos.join(" "));
  const marcaBanco =
    t.includes("banco do brasil") || t.includes("bb.com.br") || /\bbanco\s*001\b/.test(t);
  const linhasComSinal = textos.filter(
    (l) => VALOR_COM_SINAL.test(l) || SINAL_ANTES_DO_VALOR.test(l),
  ).length;
  if (marcaBanco && linhasComSinal > 0) return true;
  return linhasComSinal >= 3;
}

/** Coluna "Histórico" do extrato BB começa por volta de x = 265. */
const HISTORICO_X_MIN = 200;
/** Distância vertical máxima entre a linha financeira e o texto do histórico. */
const HISTORICO_Y_MAX = 16;

/**
 * Recupera o HISTÓRICO de movimentações cujo texto foi impresso em uma ou mais
 * linhas próprias (acima/abaixo da linha da data+valor).
 *
 * No PDF real do BB, "Pagamento Fatura de Água / TUBARAO SANEAMENTO",
 * "Cobrança de I.O.F. / IOF Saldo Devedor Conta" e "Pagamento de Boleto /
 * CELESC DISTRIBUICAO S.A" ocupam DUAS linhas de texto, enquanto data e valor
 * ficam sozinhos em outro Y. Exigir descrição no mesmo Y descartava esses
 * lançamentos. A regra correta: DATA + VALOR com (+)/(-) já identificam a
 * movimentação; o histórico é recuperado pelas linhas vizinhas da coluna.
 */
function recuperarHistoricos(
  linhas: PdfLine[],
  descricaoDaLinha: Array<string | null>,
): Map<number, { acima: string[]; abaixo: string[] }> {
  // EVENT ASSEMBLER: toda linha financeira (menos as de saldo) pode ter o
  // Histórico impresso em linhas vizinhas — acima e/ou abaixo do valor.
  const financeiras = linhas
    .map((linha, index) => ({ linha, index }))
    .filter(
      ({ index }) =>
        descricaoDaLinha[index] !== null && !ehSaldoMetadata(descricaoDaLinha[index] ?? ""),
    );

  // Linhas candidatas: texto puro na coluna do histórico, sem data e sem valor.
  const candidatas = linhas
    .map((linha, index) => ({ linha, index }))
    .filter(({ linha, index }) => {
      if (descricaoDaLinha[index] !== null) return false; // é linha financeira
      const raw = linha.text.replace(/\s+/g, " ").trim();
      if (raw.length < 3) return false;
      if (DATA_INICIAL.test(raw)) return false;
      if (ehSaldoMetadata(raw)) return false;
      const t = plano(raw);
      if ([...CABECALHOS_FUTUROS, ...CABECALHOS_METADATA, ...CABECALHOS_MOVIMENTOS].some((c) => t.startsWith(c)))
        return false;
      if (linha.cells.length) {
        const inicio = Math.min(...linha.cells.map((c) => c.x));
        if (inicio < HISTORICO_X_MIN) return false;
      }
      return true;
    });

  const usadas = new Set<number>();
  const resultado = new Map<number, { acima: string[]; abaixo: string[] }>();

  for (const { linha, index } of financeiras) {
    const proximas = candidatas
      .filter(({ linha: c, index: ci }) => {
        if (usadas.has(ci)) return false;
        if ((c.page ?? 1) !== (linha.page ?? 1)) return false;
        return Math.abs(c.y - linha.y) <= HISTORICO_Y_MAX;
      })
      // Não anexar texto do próximo lançamento: só o que está mais perto desta
      // linha financeira do que de qualquer outra.
      .filter(({ linha: c }) =>
        financeiras.every(
          ({ linha: outra, index: oi }) =>
            oi === index || Math.abs(c.y - linha.y) <= Math.abs(c.y - outra.y),
        ),
      )
      .sort((a, b) => b.linha.y - a.linha.y);

    if (!proximas.length) continue;
    for (const p of proximas) usadas.add(p.index);
    const texto = (p: (typeof proximas)[number]) => p.linha.text.replace(/\s+/g, " ").trim();
    resultado.set(index, {
      // Ordem documental: o que está acima do valor vem antes.
      acima: proximas.filter((p) => p.linha.y > linha.y).map(texto),
      abaixo: proximas.filter((p) => p.linha.y <= linha.y).map(texto),
    });
  }

  return resultado;
}

/**
 * HISTÓRICO IMPRESSO NA PRÓPRIA LINHA FINANCEIRA.
 *
 * As colunas "Lote" e "Documento" (x < coluna Histórico) são técnicas e nunca
 * são descrição: quando a linha só traz esses códigos ("13013 28308"), o
 * histórico é vazio e vem das linhas vizinhas.
 */
function historicoNaLinha(linha: PdfLine, resto: string, bruto: string): string {
  const semValor = (t: string) =>
    t
      .replace(bruto, " ")
      .replace(VALOR_COM_SINAL, " ")
      .replace(SINAL_ANTES_DO_VALOR, " ")
      .replace(/\(\s*[+-]\s*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  if (linha.cells.length) {
    const daColuna = linha.cells
      .filter((c) => c.x >= HISTORICO_X_MIN)
      .map((c) => c.text)
      .join(" ");
    return removerColunasTecnicas(semValor(daColuna));
  }
  return removerColunasTecnicas(semValor(resto));
}

/** Lote e Documento da linha — metadata técnica, fora da descrição. */
function colunasTecnicas(linha: PdfLine): { lot: string | null; documentNumber: string | null } {
  const codigos = linha.cells
    .filter((c) => c.x < HISTORICO_X_MIN)
    .map((c) => c.text.trim())
    .filter((t) => /^\d{3,}$/.test(t));
  return { lot: codigos[0] ?? null, documentNumber: codigos[1] ?? null };
}

/** Linha que contém SOMENTE uma data — é a célula da coluna "Dia". */
const SO_DATA = /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?$/;
/** Linha de coluna "Dia": data seguida apenas de códigos numéricos do banco. */
const LINHA_DE_DATA = /^\d{2}\/\d{2}(?:\/\d{2,4})?[\s\d.\-]*$/;

function isoDaCelula(texto: string, anoBase: number): string | null {
  const m = texto.replace(/\s+/g, "").match(SO_DATA);
  if (!m) return null;
  const ano = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(anoBase);
  const iso = `${ano}-${m[2]}-${m[1]}`;
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso) ? iso : null;
}

/**
 * DATA CONTÁBIL impressa na coluna "Dia" (à esquerda da coluna Histórico).
 *
 * Só consideramos a data quando ela está geometricamente na coluna "Dia".
 * Datas escritas dentro do Histórico ("Pix - Enviado 04/01 12:48") são data do
 * evento e nunca viram data contábil.
 */
function dataDaColunaDia(linha: PdfLine, anoBase: number): string | null {
  const candidatos = linha.cells.length
    ? linha.cells.filter((c) => c.x < HISTORICO_X_MIN).map((c) => c.text)
    : LINHA_DE_DATA.test(linha.text.replace(/\s+/g, " ").trim())
      ? [linha.text]
      : [];
  for (const texto of candidatos) {
    const m = texto
      .replace(/\s+/g, " ")
      .trim()
      .match(/^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\b/);
    if (!m) continue;
    const ano = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(anoBase);
    const iso = `${ano}-${m[2]}-${m[1]}`;
    if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso)) return iso;
  }
  return null;
}

/**
 * ROW ASSEMBLY — reconstrói a LINHA VISUAL do extrato antes de qualquer leitura.
 *
 * O extrator de PDF pode devolver as células separadas por coluna visual
 * (ESQUERDA/DIREITA). Nesse caso a coluna "Dia" (x≈30) chega em uma linha e o
 * valor (x≈520) em outra, mesmo sendo a MESMA linha física do extrato — e a
 * ordem de leitura deixa de ser cronológica (todas as datas da página vêm antes
 * de todas as movimentações).
 *
 * Aqui reagrupamos por (página, Y) e ordenamos em ORDEM DOCUMENTAL REAL
 * (página ASC, Y DESC), para que o passe único do parser leia o extrato na
 * mesma ordem em que ele é lido no papel.
 */
export function montarVisualRowsBb(linhas: PdfLine[]): PdfLine[] {
  // Sem geometria (texto puro) a ordem recebida já é a ordem documental.
  if (!linhas.length || linhas.some((l) => !l.cells.length)) return linhas;

  const grupos = new Map<string, { page: number; y: number; cells: PdfCell[] }>();
  for (const linha of linhas) {
    const page = linha.page ?? 1;
    const y = Math.round(linha.y / 3) * 3;
    const chave = `${page}|${y}`;
    const atual = grupos.get(chave) ?? { page, y, cells: [] };
    atual.cells.push(...linha.cells);
    grupos.set(chave, atual);
  }

  return [...grupos.values()]
    .sort((a, b) => (a.page - b.page) || (b.y - a.y))
    .map(({ page, y, cells }) => {
      const ordenadas = [...cells].sort((a, b) => a.x - b.x);
      return {
        page,
        y,
        cells: ordenadas,
        text: ordenadas.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim(),
      } satisfies PdfLine;
    })
    .filter((l) => l.text);
}


/**
 * DATA CONTÁBIL = coluna "Dia" do extrato (posting date).
 *
 * Quando a linha financeira não traz a data no próprio texto, ela está impressa
 * numa célula à esquerda (coluna "Dia"), no mesmo bloco vertical. Recuperamos
 * essa célula pela geometria — nunca pela data escrita dentro do histórico
 * ("Pix - Enviado 26/01 12:45"), que é data do evento, não do lançamento.
 */
function recuperarDatas(
  linhas: PdfLine[],
  descricaoDaLinha: Array<string | null>,
  anoBase: number,
): Map<number, string> {
  const celulas = linhas
    .map((linha, index) => ({ linha, index, iso: isoDaCelula(linha.text, anoBase) }))
    .filter((c): c is { linha: PdfLine; index: number; iso: string } => {
      if (!c.iso) return false;
      if (c.linha.cells.length) {
        const inicio = Math.min(...c.linha.cells.map((x) => x.x));
        if (inicio >= HISTORICO_X_MIN) return false;
      }
      return true;
    });

  const resultado = new Map<number, string>();
  if (!celulas.length) return resultado;

  for (let i = 0; i < linhas.length; i++) {
    if (descricaoDaLinha[i] === null) continue; // não é linha financeira
    const linha = linhas[i]!;
    if (DATA_INICIAL.test(linha.text.replace(/\s+/g, " ").trim())) continue; // já tem data

    const mesmaPagina = celulas.filter((c) => (c.linha.page ?? 1) === (linha.page ?? 1));
    if (!mesmaPagina.length) continue;
    const maisProxima = mesmaPagina.reduce((melhor, atual) =>
      Math.abs(atual.linha.y - linha.y) < Math.abs(melhor.linha.y - linha.y) ? atual : melhor,
    );
    if (Math.abs(maisProxima.linha.y - linha.y) <= HISTORICO_Y_MAX) {
      resultado.set(i, maisProxima.iso);
    }
  }

  return resultado;
}

/** Interpreta as linhas já reconstruídas do PDF do BB. */
export function parseBancoDoBrasilLines(linhasEntrada: PdfLine[]): ParsedBankStatement {
  // ORDEM DOCUMENTAL REAL: página ASC, Y DESC, células da mesma linha física
  // reunidas. Sem isso a leitura cronológica (e a data contábil) se perde.
  const linhas = montarVisualRowsBb(linhasEntrada);
  const textos = linhas.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);

  const cabecalho = parseBBStatementPeriod(textos.join(" "));
  const periodoOficial = cabecalho ? { inicio: cabecalho.start, fim: cabecalho.end } : null;
  const anoBase = periodoOficial?.inicio
    ? Number(periodoOficial.inicio.slice(0, 4))
    : new Date().getFullYear();
  /**
   * Pré-passo: quais linhas são financeiras (data/valor com sinal) e qual
   * texto de histórico veio junto. `null` = linha não financeira,
   * `""` = financeira sem histórico no mesmo Y (precisa recuperar).
   */
  const descricaoDaLinha: Array<string | null> = linhas.map((linha, i) => {
    const raw = linha.text.replace(/\s+/g, " ").trim();
    if (!raw) return null;
    let alvo = raw;
    const proxima = linhas[i + 1]?.text.trim() ?? "";
    if (!lerValorComSinal(alvo) && SINAL_SOZINHO.test(proxima)) alvo = `${raw} ${proxima}`;
    const lido = lerValorComSinal(alvo);
    if (!lido) return null;
    const { resto } = DATA_INICIAL.test(raw) ? lerData(raw, anoBase) : { resto: raw };
    return historicoNaLinha(linha, resto, lido.bruto);
  });
  const historicosRecuperados = recuperarHistoricos(linhas, descricaoDaLinha);
  const datasRecuperadas = recuperarDatas(linhas, descricaoDaLinha, anoBase);

  const movimentos: ParsedBankMovement[] = [];
  const futuros: ParsedBankMovement[] = [];
  const aceitos: ParsedBankStatement["aceitos"] = [];
  const checkpoints: NonNullable<ParsedBankStatement["checkpoints"]> = [];
  const rejeitados: ParsedBankStatement["rejeitados"] = [];
  /** Rastro temporal do passe único (diagnóstico — nunca altera o resultado). */
  const temporalTrace: NonNullable<ParsedBankStatement["temporalTrace"]> = [];



  let secao: Secao = "MOVIMENTOS";
  let ultimaData: string | null = null;
  let saldoInicial: number | null = null;
  let saldoInicialData: string | null = null;
  let saldoFinal: number | null = null;
  let saldoFinalData: string | null = null;


  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]!;
    const raw = linha.text.replace(/\s+/g, " ").trim();
    if (!raw) continue;

    secao = detectarSecao(raw, secao);

    // ESTADO TEMPORAL: toda linha que traz data na coluna "Dia" atualiza a data
    // contábil corrente — mesmo quando ela não tem valor e é descartada. A data
    // vale para os lançamentos seguintes até aparecer outra data da coluna Dia
    // (inclusive na virada de página).
    const dataLead = DATA_INICIAL.test(raw) ? lerData(raw, anoBase) : null;
    const dataGeometrica = dataDaColunaDia(linha, anoBase);
    // Sem geometria (texto puro), a data no início da linha é a coluna "Dia".
    // Com geometria, só vale se estiver mesmo à esquerda da coluna Histórico.
    const leadEhColunaDia = !!dataLead && (linha.cells.length ? dataLead.data === dataGeometrica : true);
    const dataColuna = dataGeometrica ?? (leadEhColunaDia ? dataLead!.data : null);
    if (dataColuna) {
      ultimaData = dataColuna;
      temporalTrace.push({
        page: linha.page ?? null,
        row: raw,
        event: "POSTING_DATE_CONTEXT",
        date: dataColuna,
      });
    }
    // Cabeçalho repetido no topo da página 2 ("Extrato de Conta Corrente")
    // não encerra a tabela de lançamentos: a primeira linha com data na coluna
    // "Dia" retoma a seção de movimentos.
    if (secao === "METADATA" && dataColuna) secao = "MOVIMENTOS";




    // Valor + sinal podem estar na mesma linha ou o sinal na linha seguinte.
    let alvo = raw;
    const proxima = linhas[i + 1]?.text.trim() ?? "";
    if (!lerValorComSinal(alvo) && SINAL_SOZINHO.test(proxima)) alvo = `${raw} ${proxima}`;

    const lido = lerValorComSinal(alvo);
    if (!lido) {
      rejeitados.push({
        raw,
        valor: null,
        page: linha.page ?? null,
        reason: dataColuna
          ? `célula da coluna "Dia" — data contábil ${dataColuna}`
          : secao === "METADATA"
            ? "área informativa / comercial"
            : "sem valor com sinal",
      });
      continue;
    }

    const valor = lido.valor;

    // A data inicial só sai do texto quando é a célula da coluna "Dia"; datas do
    // histórico continuam no texto para alimentar o eventDate.
    const resto = leadEhColunaDia ? dataLead!.resto : raw;


    const descricaoNaLinha = historicoNaLinha(linha, resto, lido.bruto);
    // EVENT ASSEMBLER: o Histórico do lançamento pode estar na linha anterior,
    // na mesma linha do valor e/ou na linha seguinte. Aqui eles são agregados
    // na ordem documental — sem nunca puxar texto do próximo lançamento.
    const vizinhos = historicosRecuperados.get(i);
    const montada = montarDescricaoBb([
      ...(vizinhos?.acima ?? []),
      descricaoNaLinha,
      ...(vizinhos?.abaixo ?? []),
    ]);
    const descricao = montada.description;

    const ehSaldo = ehSaldoMetadata(descricaoNaLinha) || ehSaldoMetadata(descricao);
    // DATA CONTÁBIL = coluna "Dia". Nunca a data escrita dentro do histórico.
    const data: string | null = ehSaldo
      ? dataColuna ?? ultimaData
      : dataColuna ?? datasRecuperadas.get(i) ?? ultimaData;



    if (ehSaldo) {
      const t = plano(descricaoNaLinha || descricao);
      const abertura = t.startsWith("saldo anterior");
      const fechamento = /^s a l d o$|^saldo$|^saldo final|^saldo atual/.test(t);
      if (abertura) {
        saldoInicial = valor;
        // SALDO ANTERIOR: a data sai da PRÓPRIA linha física (ex.: 29/12/2025).
        // Nenhuma data posterior pode substituí-la.
        saldoInicialData = dataColuna ?? data ?? saldoInicialData;
        temporalTrace.push({
          page: linha.page ?? null,
          row: raw,
          event: "OPENING_BALANCE",
          date: saldoInicialData,
          amount: valor,
        });
      } else {
        saldoFinal = valor;
        // O saldo final não herda a última data lançada: sem data própria ele
        // cai no fim do período oficial.
        if (fechamento) {
          saldoFinalData = dataColuna ?? saldoFinalData;
          temporalTrace.push({
            page: linha.page ?? null,
            row: raw,
            event: "CLOSING_BALANCE",
            date: saldoFinalData,
            amount: valor,
          });
        }
      }

      // Saldo do dia é CHECKPOINT de conferência — nunca vira movimentação.
      // O sinal impresso é preservado (saldo devedor fica negativo).
      // A data é CONGELADA aqui, no momento da criação do checkpoint.
      if (data && !abertura && (!fechamento || dataColuna)) {
        checkpoints.push({
          data,
          saldo: valor,
          rotulo: descricaoNaLinha || descricao,
          tipo: fechamento ? "CLOSING" : "DAILY",
        });
        temporalTrace.push({
          page: linha.page ?? null,
          row: raw,
          event: "CHECKPOINT_CREATED",
          date: data,
          amount: valor,
        });
      }

      rejeitados.push({
        raw,
        valor,
        page: linha.page ?? null,
        reason: "BALANCE_METADATA — controle de saldo, não é movimentação",
      });
      continue;
    }


    if (secao === "METADATA") {
      rejeitados.push({
        raw,
        valor,
        page: linha.page ?? null,
        reason: "seção informativa (limite / juros / CET / simulação)",
      });
      continue;
    }

    if (!descricao || descricao.length < 3) {
      rejeitados.push({
        raw,
        valor,
        page: linha.page ?? null,
        reason: "sem descrição reconhecível",
      });
      continue;
    }

    // EVENTO MONTADO: a data contábil é congelada aqui e nunca mais muda.
    const tecnicas = colunasTecnicas(linha);
    const movimento: ParsedBankMovement = {
      data: data ?? ultimaData,
      // occurredAt sai do HISTÓRICO BRUTO (com "04/01 12:48"), preservado mesmo
      // quando a descrição apresentada já foi limpa.
      eventDate:
        periodoOficial?.inicio && periodoOficial.fim
          ? eventDateFromHistory(montada.historico, {
              inicio: periodoOficial.inicio,
              fim: periodoOficial.fim,
            })
          : null,
      descricaoOriginal: descricao,
      descricaoNormalizada: montada.normalizedDescription,
      bankOperation: montada.bankOperation,
      counterparty: montada.counterparty,
      lot: tecnicas.lot,
      documentNumber: tecnicas.documentNumber,
      historico: montada.historico,
      valor,
      tipo: classificarBb(montada.historico || descricao, valor),
    };
    temporalTrace.push({
      page: linha.page ?? null,
      row: raw,
      event: "TRANSACTION_CREATED",
      date: movimento.data,
      amount: valor,
    });


    if (secao === "FUTUROS") {
      futuros.push(movimento);
      rejeitados.push({
        raw,
        valor,
        page: linha.page ?? null,
        reason: "lançamento futuro — não entra no período realizado",
      });
      continue;
    }

    movimentos.push(movimento);
    aceitos.push({ raw, valor, page: linha.page ?? null });
  }

  // Saldo final impresso no resumo, quando existir rótulo explícito.
  const saldoRotulado = (() => {
    for (const linha of textos) {
      const t = plano(linha);
      if (!/^saldo\b/.test(t) || t.startsWith("saldo anterior") || t.startsWith("saldo do dia"))
        continue;
      const m = linha.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
      if (m?.length) return parseValorBr(m[m.length - 1]!);
    }
    return null;
  })();

  return {
    parser: BB_PARSER_ID,
    // Período vem EXCLUSIVAMENTE do cabeçalho oficial. Sem cabeçalho o extrato
    // fica sem período e é bloqueado pela validação — nunca inferimos das
    // movimentações, do saldo anterior ou do saldo do dia.
    periodoInicio: periodoOficial?.inicio ?? null,
    periodoFim: periodoOficial?.fim ?? null,
    saldoInicial,
    saldoInicialData,
    saldoFinal: saldoFinal ?? saldoRotulado,
    saldoFinalData: saldoFinalData ?? periodoOficial?.fim ?? null,
    movimentos,
    temporalTrace,

    // Um checkpoint por dia: o último saldo impresso é o que vale.
    checkpoints: [...new Map(checkpoints.map((c) => [c.data, c])).values()].sort((a, b) =>
      a.data.localeCompare(b.data),
    ),
    futuros,

    identificacao: {
      banco: "Banco do Brasil",
      agencia: buscar(textos, /ag[êe]ncia[:\s]+([\d.\-]{3,10})/i),
      conta: buscar(textos, /conta(?:\s+corrente)?[:\s]+([\d.\-/]{4,20})/i),
      titular: buscar(textos, /(?:titular|cliente)[:\s]+([A-Za-zÀ-ÿ' .]{4,60})/i),
    },
    aceitos,
    rejeitados,
  };
}

export async function readBancoDoBrasilPdf(file: Blob): Promise<ParsedBankStatement> {
  return parseBancoDoBrasilLines(await extractPdfLines(file));
}
