/**
 * Parser genérico de fatura de cartão em PDF digital.
 *
 * Cobre os formatos mais comuns:
 *  - "12/08  RESTAURANTE XPTO  R$ 180,00" (tudo em uma linha)
 *  - "12 AGO" / "RESTAURANTE XPTO" / "R$ 180,00" (uma informação por linha)
 *
 * Regras:
 *  - nada é assumido: campo sem evidência volta null;
 *  - a descrição original é preservada exatamente como veio;
 *  - valores negativos (pagamentos, estornos) são mantidos negativos.
 */
import { parseValorBr, type PdfLine } from "@/lib/pdf-extract";
import type { ParsedStatement, StatementEntry, StatementItemKind, StatementParser } from "./types";

export const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Normalização usada na comparação (caixa alta, sem acento, sem ruído). */
export function normalizeDescricao(raw: string) {
  return semAcento(raw)
    .toUpperCase()
    .replace(/\b(PAG|PAGTO|PGTO|COMPRA|CARTAO|CRED|DEB)\*/g, " ")
    .replace(/[*#]/g, " ")
    .replace(/\b\d{2}\/\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MESES: Record<string, number> = {
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
  JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12,
};

const DATA_NUM = /^(\d{2})[/.-](\d{2})(?:[/.-](\d{2,4}))?/;
const DATA_MES = /^(\d{1,2})\s*(?:de\s*)?([A-Za-zÇç]{3})\.?/;
const MOEDA = /-?\s?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2}|-?\s?\d+,\d{2}/g;
const PARCELA = /(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/;

function iso(ano: number, mes: number, dia: number) {
  if (!ano || !mes || !dia) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Lê uma data no começo do texto. Retorna a data ISO e o resto da linha. */
export function lerData(texto: string, anoBase: number): { data: string | null; resto: string } {
  const num = texto.match(DATA_NUM);
  if (num) {
    const dia = Number(num[1]);
    const mes = Number(num[2]);
    let ano = num[3] ? Number(num[3]) : anoBase;
    if (ano < 100) ano += 2000;
    return { data: iso(ano, mes, dia), resto: texto.slice(num[0].length).trim() };
  }
  const nome = texto.match(DATA_MES);
  if (nome) {
    const dia = Number(nome[1]);
    const mes = MESES[semAcento(nome[2] ?? "").toUpperCase()];
    if (mes) return { data: iso(anoBase, mes, dia), resto: texto.slice(nome[0].length).trim() };
  }
  return { data: null, resto: texto };
}

/** Último valor monetário da linha (o valor do lançamento fica sempre à direita). */
export function lerValor(texto: string): { valor: number | null; resto: string } {
  const achados = texto.match(MOEDA);
  if (!achados || achados.length === 0) return { valor: null, resto: texto };
  const bruto = achados[achados.length - 1] as string;
  const negativo = /-/.test(bruto) || /\bCR\b|\bC\b\s*$/.test(texto);
  const valor = Math.abs(parseValorBr(bruto)) * (negativo ? -1 : 1);
  const idx = texto.lastIndexOf(bruto);
  const resto = (texto.slice(0, idx) + " " + texto.slice(idx + bruto.length)).trim();
  return { valor, resto };
}

const CLASSES: Array<{ tipo: StatementItemKind; termos: string[] }> = [
  { tipo: "PAGAMENTO", termos: ["pagamento recebido", "pagamento efetuado", "pgto", "pagamento em"] },
  { tipo: "ESTORNO", termos: ["estorno", "devolucao", "reembolso", "credito de"] },
  { tipo: "JUROS", termos: ["juros", "encargos", "rotativo", "mora", "multa", "parcelamento de fatura"] },
  { tipo: "TAXA", termos: ["anuidade", "iof", "tarifa", "seguro", "taxa", "servico de"] },
  { tipo: "AJUSTE", termos: ["ajuste", "correcao"] },
];

/** Classificação determinística por palavra-chave. Sem evidência = COMPRA. */
export function classificarLancamento(descricao: string, valor: number): StatementItemKind {
  const texto = semAcento(descricao).toLowerCase();
  for (const c of CLASSES) if (c.termos.some((t) => texto.includes(t))) return c.tipo;
  if (valor < 0) return "ESTORNO";
  return "COMPRA";
}

const RUIDO = [
  "total", "subtotal", "limite", "saldo", "vencimento", "fechamento", "pagina", "page",
  "lancamentos", "resumo", "fatura", "central de atendimento", "sac", "ouvidoria", "cnpj",
  "demonstrativo", "cpf", "www", "encargos do periodo seguinte", "compras parceladas",
  "melhor dia", "proxima fatura", "linha digitavel", "codigo de barras",
];

function ehRuido(texto: string) {
  const t = semAcento(texto).toLowerCase().trim();
  if (t.length < 3) return true;
  return RUIDO.some((r) => t.startsWith(r));
}

/** Extrai o cabeçalho da fatura (o que houver evidência no texto). */
export function lerCabecalho(linhas: string[]) {
  const texto = linhas.join("\n");
  const plano = semAcento(texto).toLowerCase();

  const acharData = (rotulos: string[]) => {
    for (const l of linhas) {
      const plana = semAcento(l).toLowerCase();
      if (!rotulos.some((r) => plana.includes(r))) continue;
      const m = l.match(/(\d{2})[/.-](\d{2})[/.-](\d{2,4})/);
      if (m) {
        let ano = Number(m[3]);
        if (ano < 100) ano += 2000;
        return iso(ano, Number(m[2]), Number(m[1]));
      }
    }
    return null;
  };

  const acharValor = (rotulos: string[]) => {
    for (const l of linhas) {
      const plana = semAcento(l).toLowerCase();
      if (!rotulos.some((r) => plana.includes(r))) continue;
      const achados = l.match(MOEDA);
      if (achados && achados.length > 0) return parseValorBr(achados[achados.length - 1] as string);
    }
    return null;
  };

  const periodo = texto.match(
    /(\d{2}[/.-]\d{2}[/.-]\d{2,4})\s*(?:a|ate|até|-|–)\s*(\d{2}[/.-]\d{2}[/.-]\d{2,4})/i,
  );
  const paraIso = (v?: string) => {
    if (!v) return null;
    const [d, m, y] = v.split(/[/.-]/).map(Number);
    return iso((y ?? 0) < 100 ? (y ?? 0) + 2000 : (y ?? 0), m ?? 0, d ?? 0);
  };

  const EMISSORES = [
    "nubank", "itau", "santander", "bradesco", "banco do brasil", "caixa", "inter",
    "c6 bank", "c6", "will bank", "original", "next", "neon", "porto", "xp", "btg", "sicredi",
  ];
  const emissorAchado = EMISSORES.find((e) => plano.includes(e)) ?? null;

  const final = texto.match(/(?:final|terminad[oa]s?\s*em|cart[aã]o)\D{0,12}(\d{4})\b/i)
    ?? texto.match(/[•*x]{2,}\s?(\d{4})\b/i);

  const titular = (() => {
    const m = texto.match(/(?:titular|nome do titular)\s*[:\-]?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÁÉÍÓÚÂÊÔÃÕÇç' ]{4,60})/);
    return m?.[1]?.trim() ?? null;
  })();

  return {
    emissor: emissorAchado ? emissorAchado.toUpperCase() : null,
    titular,
    final_cartao: final?.[1] ?? null,
    data_fechamento: acharData(["fechamento", "fechada em"]),
    data_vencimento: acharData(["vencimento", "vence em", "pagar ate", "pagar até"]),
    periodo_inicio: paraIso(periodo?.[1]),
    periodo_fim: paraIso(periodo?.[2]),
    valor_total_fatura: acharValor([
      "total da fatura", "valor total da fatura", "total a pagar", "valor a pagar", "total desta fatura",
    ]),
  };
}

function anoDeReferencia(cabecalho: ReturnType<typeof lerCabecalho>) {
  const base =
    cabecalho.periodo_fim ?? cabecalho.data_fechamento ?? cabecalho.data_vencimento ?? null;
  return base ? Number(base.slice(0, 4)) : new Date().getFullYear();
}

/** Monta um lançamento a partir de data + descrição + valor já separados. */
export function montarLancamento(
  data: string | null,
  descricaoBruta: string,
  valor: number,
): StatementEntry | null {
  const descricao = descricaoBruta.replace(/\s+/g, " ").trim();
  if (!descricao || ehRuido(descricao)) return null;
  const parcela = descricao.match(PARCELA);
  const tipo = classificarLancamento(descricao, valor);
  const normalizada = normalizeDescricao(descricao);
  return {
    data_lancamento: data,
    descricao_original: descricao,
    descricao_normalizada: normalizada,
    estabelecimento_sugerido: normalizada ? tituloEstabelecimento(descricao) : null,
    valor,
    parcela_atual: parcela ? Number(parcela[1]) : null,
    total_parcelas: parcela ? Number(parcela[2]) : null,
    tipo_sugerido: tipo,
  };
}

/** Nome apresentável do estabelecimento (sem inventar: só limpa o texto da fatura). */
export function tituloEstabelecimento(descricao: string) {
  const limpo = descricao
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[-•*\s]+/, "")
    .trim();
  if (!limpo) return null;
  return limpo
    .toLowerCase()
    .split(" ")
    .map((p) => (p.length > 2 ? p.charAt(0).toUpperCase() + p.slice(1) : p.toUpperCase()))
    .join(" ");
}

/** Leitura dos lançamentos: aceita linha única ou blocos de 2-3 linhas. */
export function lerLancamentos(linhas: string[], anoBase: number): StatementEntry[] {
  const entries: StatementEntry[] = [];
  let dataPendente: string | null = null;
  let descricaoPendente = "";

  const fechaPendente = () => {
    dataPendente = null;
    descricaoPendente = "";
  };

  for (const linhaBruta of linhas) {
    const linha = linhaBruta.replace(/\s+/g, " ").trim();
    if (!linha) continue;

    const { data, resto } = lerData(linha, anoBase);
    const { valor, resto: semValor } = lerValor(data ? resto : linha);

    // Linha completa: data + descrição + valor.
    if (data && valor !== null && semValor.trim()) {
      const item = montarLancamento(data, semValor, valor);
      if (item) entries.push(item);
      fechaPendente();
      continue;
    }

    // Só a data: guarda e espera a descrição.
    if (data && valor === null && !semValor.trim()) {
      dataPendente = data;
      descricaoPendente = "";
      continue;
    }

    // Data + descrição, valor na próxima linha.
    if (data && valor === null && semValor.trim()) {
      dataPendente = data;
      descricaoPendente = semValor.trim();
      continue;
    }

    // Valor solto fechando um bloco anterior.
    if (!data && valor !== null && dataPendente) {
      const descricao = (descricaoPendente + " " + semValor).trim();
      const item = montarLancamento(dataPendente, descricao, valor);
      if (item) entries.push(item);
      fechaPendente();
      continue;
    }

    // Descrição solta de um bloco aberto.
    if (!data && valor === null && dataPendente) {
      descricaoPendente = (descricaoPendente + " " + linha).trim();
      continue;
    }

    // Linha com valor mas sem data conhecida: só entra se parecer lançamento real.
    if (!data && valor !== null && semValor.trim() && !ehRuido(semValor)) {
      const item = montarLancamento(null, semValor, valor);
      if (item) entries.push(item);
    }
  }

  return entries;
}

export function parseGeneric(linhas: PdfLine[]): ParsedStatement {
  const textos = linhas.map((l) => l.text);
  const cabecalho = lerCabecalho(textos);
  const entries = lerLancamentos(textos, anoDeReferencia(cabecalho));
  return { ...cabecalho, parser: "GENERIC_PDF", entries, linhas: textos };
}

export const genericParser: StatementParser = {
  id: "GENERIC_PDF",
  nome: "Fatura em PDF (formato genérico)",
  detect: () => 0.2,
  parse: parseGeneric,
};
