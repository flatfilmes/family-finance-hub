import { createServerFn } from "@tanstack/react-start";

/**
 * Extração server-side de evidência em imagem (print/foto).
 *
 * Roda SEMPRE no servidor: a chave do provedor nunca vai para o navegador.
 * Nada é persistido aqui — a saída é sempre um dry run de candidatos que
 * ainda passará pela engine de reconciliação e pela revisão humana.
 */
export type EvidenceImageItem = {
  data: string | null;
  descricao: string;
  valor: number;
  cardLast4: string | null;
  confianca: number;
};

export type EvidenceImageExtraction = {
  status: "READY" | "EMPTY" | "PROVIDER_NOT_CONFIGURED" | "RATE_LIMITED" | "FAILED";
  provider: string;
  version: string;
  itens: EvidenceImageItem[];
  textoDetectado: string;
  mensagem: string | null;
};

const PROVIDER = "lovable-ai-gateway";
const MODEL = "google/gemini-2.5-flash";
const VERSION = "evidence-image-v1";

const PROMPT = [
  "Você lê imagens financeiras brasileiras: prints de app de banco, prints de fatura de cartão, comprovantes e cupons.",
  "Responda SOMENTE com JSON válido:",
  '{"itens":[{"data":"AAAA-MM-DD"|null,"descricao":string,"valor":number,"cardLast4":string|null,"confianca":number}],"textoDetectado":string}',
  "Regras absolutas:",
  "- valor positivo = entrada de dinheiro; valor negativo = saída/gasto.",
  "- NUNCA invente data, valor ou estabelecimento. Sem evidência visível, use null.",
  "- Ignore saldos, totais, limites, simulações de parcelamento e ofertas de crédito: só lançamentos reais.",
  "- confianca é 0 a 100 e reflete o quanto o texto estava legível.",
].join("\n");

export const extractFinancialEvidenceImage = createServerFn({ method: "POST" })
  .inputValidator((input: { imageBase64: string; mimeType: string; contexto?: string }) => {
    if (!input?.imageBase64) throw new Error("Envie uma imagem.");
    if (!input.mimeType?.startsWith("image/")) throw new Error("Formato de imagem inválido.");
    return input;
  })
  .handler(async ({ data }): Promise<EvidenceImageExtraction> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    const vazio = { provider: PROVIDER, version: VERSION, itens: [], textoDetectado: "" };
    if (!apiKey) {
      return {
        ...vazio,
        status: "PROVIDER_NOT_CONFIGURED",
        mensagem: "A leitura de imagens não está configurada neste ambiente.",
      };
    }

    let res: Response;
    try {
      res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Extraia os lançamentos reais desta imagem.${data.contexto ? ` Contexto: ${data.contexto}.` : ""}`,
                },
                {
                  type: "image_url",
                  image_url: { url: `data:${data.mimeType};base64,${data.imageBase64}` },
                },
              ],
            },
          ],
        }),
      });
    } catch {
      return { ...vazio, status: "FAILED", mensagem: "Não foi possível falar com o leitor de imagens." };
    }

    if (res.status === 429)
      return {
        ...vazio,
        status: "RATE_LIMITED",
        mensagem: "Muitas leituras seguidas. Tente novamente em instantes.",
      };
    if (res.status === 402)
      return { ...vazio, status: "FAILED", mensagem: "Créditos de IA esgotados nesta conta." };
    if (!res.ok) return { ...vazio, status: "FAILED", mensagem: "Não foi possível ler a imagem agora." };

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const bruto = json.choices?.[0]?.message?.content ?? "";
    const limpo = bruto.replace(/```json|```/g, "").trim();

    let lido: { itens?: unknown; textoDetectado?: unknown } = {};
    try {
      lido = JSON.parse(limpo) as typeof lido;
    } catch {
      return {
        ...vazio,
        status: "FAILED",
        textoDetectado: bruto,
        mensagem: "A leitura não retornou um resultado interpretável.",
      };
    }

    const itens: EvidenceImageItem[] = Array.isArray(lido.itens)
      ? (lido.itens as Record<string, unknown>[])
          .filter((i) => i && typeof i["valor"] === "number" && Number.isFinite(i["valor"]))
          .map((i) => ({
            data:
              typeof i["data"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i["data"])
                ? (i["data"] as string)
                : null,
            descricao: String(i["descricao"] ?? "").trim() || "Lançamento da imagem",
            valor: Number(i["valor"]),
            cardLast4:
              typeof i["cardLast4"] === "string" && /^\d{4}$/.test(i["cardLast4"])
                ? (i["cardLast4"] as string)
                : null,
            confianca:
              typeof i["confianca"] === "number" && Number.isFinite(i["confianca"])
                ? Math.max(0, Math.min(100, Number(i["confianca"])))
                : 60,
          }))
      : [];

    return {
      status: itens.length ? "READY" : "EMPTY",
      provider: PROVIDER,
      version: VERSION,
      itens,
      textoDetectado: String(lido.textoDetectado ?? bruto),
      mensagem: itens.length ? null : "Nenhum lançamento reconhecido nesta imagem.",
    };
  });
