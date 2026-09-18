import { getLlmStatus } from "@/lib/llm";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json(getLlmStatus());
  } catch (error) {
    return Response.json(
      {
        configured: false,
        error: error instanceof Error ? error.message : "LLM configuration is invalid.",
      },
      { status: 503 },
    );
  }
}
