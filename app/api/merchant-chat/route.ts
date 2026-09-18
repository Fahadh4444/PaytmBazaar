import { getLlmProvider, LlmError, type LlmMessage } from "@/lib/llm";
import { getMerchantInsightSnapshot } from "@/lib/merchant-insights/server";

type ChatRequest = {
  bazaarId?: string;
  merchantName?: string;
  messages?: LlmMessage[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const bazaarId = body.bazaarId?.trim();
    const merchantName = body.merchantName?.trim();
    const messages = body.messages?.slice(-8) ?? [];

    if (!bazaarId || !merchantName || messages.length === 0) {
      return Response.json({ error: "Merchant and conversation are required." }, { status: 400 });
    }
    if (messages.some((message) => !["user", "assistant"].includes(message.role) || message.content.length > 800)) {
      return Response.json({ error: "The conversation contains an invalid message." }, { status: 400 });
    }

    const insight = await getMerchantInsightSnapshot(bazaarId, merchantName);
    if (!insight) {
      return Response.json({ error: "Merchant data is not available yet." }, { status: 404 });
    }

    const provider = getLlmProvider();
    const result = await provider.complete({
      messages: [
        {
          role: "system",
          content: [
            "You are the Paytm Bazaar merchant insight assistant.",
            "Answer clearly and briefly for a small Indian business owner.",
            "Use only the supplied computed facts. Never invent figures, causes, or benchmarks.",
            "If the facts cannot answer a question, say what additional data is needed.",
            `Computed merchant facts: ${JSON.stringify(insight)}`,
          ].join("\n"),
        },
        ...messages,
      ],
      temperature: 0.2,
      maxTokens: 350,
    });

    return Response.json({ message: result.text, provider: result.provider });
  } catch (error) {
    const message = error instanceof LlmError ? error.message : "The insight assistant is unavailable.";
    return Response.json({ error: message }, { status: 502 });
  }
}
