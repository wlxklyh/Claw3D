import { NextResponse } from "next/server";
import { loadPaperclipSnapshot, PaperclipConnectionError } from "@/lib/paperclip/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read only, with a fixed server-configured destination. No arbitrary proxy or mutations.
export async function GET() {
  try {
    return NextResponse.json(await loadPaperclipSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PaperclipConnectionError ? error.message : "读取 Paperclip 失败，请检查服务日志。" }, {
      status: error instanceof PaperclipConnectionError ? error.status : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
