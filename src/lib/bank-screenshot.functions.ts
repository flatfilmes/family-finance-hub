import { createServerFn } from "@tanstack/react-start";

export type ScreenshotMovement = {
  data: string | null;
  descricao: string;
  valor: number;
};

export type ScreenshotReading = {
  saldo: number | null;
  movimentos: ScreenshotMovement[];
  textoDetectado: string;
};

/**
 * Lê um print de aplicativo bancário (imagem) em modo dry run:
 * devolve o que foi interpretado, sem persistir absolutamente nada.
 * A confirmação sempre acontece na tela de revisão.
 */
export const readBankScreenshot = createServerFn({ method: "POST" })
  .inputValidator((input: { imageBase64: string; mimeType: string }) => {
    if (!input?.imageBase64) throw new Error("Envie uma imagem.");
    if (!input.mimeType?.startsWith("image/")) throw new Error("Formato de imagem inválido.");
    return input;
  })
  .handler(async ({ data }): Promise<ScreenshotReading> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("Leitura de imagem indisponível no momento.");

    const prompt = [
      "Você lê prints de aplicativos bancários brasileiros.",
      "Responda SOMENTE com JSON válido no formato:",
      '{"saldo": number|null, "movimentos": [{"data": "AAAA-MM-DD"|null, "descricao": string, "valor": number}], "textoDetectado": string}',
      "Regras: valor positivo = entrada na conta, negativo = saída.",
      "Se não houver evidência de um campo, devolva null. Nunca invente valores.",
      "textoDetectado deve conter o texto que você conseguiu ler na imagem.",
    ].join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extraia o saldo e as movimentações visíveis deste print." },
              {
                type: "image_url",
                image_url: { url: `data:${data.mimeType};base64,${data.imageBase64}` },
              },
            ],
          },
        ],
      }),
    });

    if (res.status === 429) throw new Error("Muitas leituras seguidas. Tente novamente em instantes.");
    if (!res.ok) throw new Error("Não foi possível ler a imagem agora.");

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const bruto = json.choices?.[0]?.message?.content ?? "";
    const limpo = bruto.replace(/```json|```/g, "").trim();

    let lido: Partial<ScreenshotReading> = {};
    try {
      lido = JSON.parse(limpo) as Partial<ScreenshotReading>;
    } catch {
      return { saldo: null, movimentos: [], textoDetectado: bruto };
    }

    const movimentos = Array.isArray(lido.movimentos)
      ? lido.movimentos
          .filter((m) => m && typeof m.valor === "number" && Number.isFinite(m.valor))
          .map((m) => ({
            data: typeof m.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.data) ? m.data : null,
            descricao: String(m.descricao ?? "").trim() || "Movimentação do print",
            valor: Number(m.valor),
          }))
      : [];

    return {
      saldo: typeof lido.saldo === "number" && Number.isFinite(lido.saldo) ? lido.saldo : null,
      movimentos,
      textoDetectado: String(lido.textoDetectado ?? bruto),
    };
  });
