import { NextResponse } from "next/server";
import { loadPaperclipIssueContext, PaperclipConnectionError } from "@/lib/paperclip/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await loadPaperclipIssueContext(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PaperclipConnectionError ? error.message : "审核详情不可用。" }, {
      status: error instanceof PaperclipConnectionError ? error.status : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
