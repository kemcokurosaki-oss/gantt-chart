import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import Anthropic from "npm:@anthropic-ai/sdk";

// 外注先用シート：支給品チェックリストの元になるPDF（工事企画表・購入部品表）をAI（Claude）で読み取って、表の行をJSONで返す。
//   リクエスト（本文はJSON、Authorization ヘッダーに社内のログイントークン）: { path: "2820/supply/12/xxxx.pdf" }
//     path … 外注先用シートの保存場所（gaichu-figures）にアップロード済みのPDF
//   呼べるのは体制表の管理者（is_org_chart_admin）だけ。PDFは呼んだ人の権限で読む（見られないPDFは読めない）
//   APIキーは Supabase の秘密の設定 ANTHROPIC_API_KEY に入れておく（ページ側には出さない）
//   読み取った結果はまだ保存しない。ページ側で確認・修正してから保存する

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "gaichu-figures";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

const SYSTEM = `あなたは日下部電機の製造管理の担当者です。スキャンしたPDFから、外注先へ支給する部品の一覧表を読み取ります。

PDFは次のどちらかです。
- 工事企画表（MANUFACTURING PARTS LIST）：加工品の表。doc_type は "machined"。
  各行の「図面番号・品番」「品名」「材質」「個数」「単重量（素材・仕上）」「工程計画」「備考」を読み取る。
  単重量は「単重量(kg) UNIT WEIGHT」の素材・仕上の欄（全重量ではない）。
  工程計画は先頭の記号（A、A1 など）を plan_code に、残りの文字（例：完成品支給 10/30）を schedule_note に入れる。
- 購入部品表（COMMERCIAL PARTS LIST）：購入品の表。doc_type は "purchased"。
  各行の「通番」「品名」「寸法・型式」「個数」「メーカー」「備考」を読み取る。メーカー欄の右の小さな記号（在・イ など）は読まない。

読み取りのきまり：
- 表の上の欄から 工事番号（例：2820）、ORDER No.（例：RVOF2。工事名の下の行の工事番号欄の下にある）、右下の Doc No.（例：2820RVOF2-C03）を読む。
- 部品図（図面）のページは表ではないので読まない。
- 同じ表が2回入っている（押印・手書きの書き込みがある写しなど）ときは、1回分だけ返す。図面番号（購入品は通番・品名・寸法）が同じ行は1行にまとめる。
- 手書きの書き込み、押印、取り消し線のない注記の読み取りに自信がないときは入れない。表に印字された文字だけを使う。
- 読めない欄は null にする。推測で埋めない。数字は半角にする。
- 空の行は返さない。行は表の上から順に返す。`;

const nullable = (type: string) => ({ type: [type, "null"] });
const ROW_SCHEMA = {
    type: "object",
    properties: {
        seq: nullable("integer"),
        drawing_no: nullable("string"),
        name: { type: "string" },
        material: nullable("string"),
        spec: nullable("string"),
        qty: nullable("number"),
        weight_material: nullable("number"),
        weight_finished: nullable("number"),
        plan_code: nullable("string"),
        schedule_note: nullable("string"),
        maker: nullable("string"),
        remark: nullable("string"),
    },
    required: ["seq", "drawing_no", "name", "material", "spec", "qty", "weight_material", "weight_finished", "plan_code", "schedule_note", "maker", "remark"],
    additionalProperties: false,
};
const SCHEMA = {
    type: "object",
    properties: {
        doc_type: { type: "string", enum: ["machined", "purchased", "unknown"] },
        project_number: nullable("string"),
        unit_code: nullable("string"),
        doc_no: nullable("string"),
        rows: { type: "array", items: ROW_SCHEMA },
        note: nullable("string"),
    },
    required: ["doc_type", "project_number", "unit_code", "doc_no", "rows", "note"],
    additionalProperties: false,
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    try {
        // 呼んだ人の権限で動かす（管理者かの確認・PDFの読み込みとも）
        const authHeader = req.headers.get("Authorization") ?? "";
        const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
        const { data: isAdmin, error: adminErr } = await userClient.rpc("is_org_chart_admin");
        if (adminErr) return json({ error: "ログインを確認できませんでした" }, 401);
        if (isAdmin !== true) return json({ error: "この操作を行う権限がありません" }, 403);

        const { path } = await req.json();
        if (typeof path !== "string" || !/^[^/]+\/supply\/\d+\/[^/]+\.pdf$/i.test(path)) return json({ error: "PDFの場所が正しくありません" }, 400);
        const { data: file, error: dlErr } = await userClient.storage.from(BUCKET).download(path);
        if (dlErr || !file) return json({ error: "PDFを読み込めませんでした" }, 404);
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length > 20 * 1024 * 1024) return json({ error: "PDFが大きすぎます（20MBまで）" }, 413);

        if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "AIのAPIキーがまだ設定されていません（Supabase の Edge Functions の Secrets に ANTHROPIC_API_KEY を入れてください）" }, 500);
        const client = new Anthropic();   // ANTHROPIC_API_KEY を環境から読む
        const response = await client.beta.messages.create({
            model: "claude-opus-5-5",
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            thinking: { type: "adaptive" },
            output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
            system: SYSTEM,
            messages: [{
                role: "user",
                content: [
                    { type: "document", source: { type: "base64", media_type: "application/pdf", data: encodeBase64(bytes) } },
                    { type: "text", text: "このPDFの表を読み取ってください。" },
                ],
            }],
        } as any);

        if (response.stop_reason === "refusal") return json({ error: "AIが読み取りを断りました。手入力で作成してください" }, 422);
        if (response.stop_reason === "max_tokens") return json({ error: "表が長すぎて読み取りきれませんでした。PDFを分けて読み込んでください" }, 422);
        const text = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        let result;
        try { result = JSON.parse(text); } catch { return json({ error: "読み取り結果の形が正しくありませんでした。もう一度お試しください" }, 502); }
        return json({ ok: true, result, usage: response.usage });
    } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) return json({ error: "AIのAPIキーが正しくありません（Supabase の ANTHROPIC_API_KEY を確認してください）" }, 500);
        if (e instanceof Anthropic.RateLimitError) return json({ error: "AIが混み合っています。少し待ってからもう一度お試しください" }, 429);
        if (e instanceof Anthropic.APIError) return json({ error: `AIの呼び出しに失敗しました（${e.status}）：${e.message}` }, 502);
        console.error(e);
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
});
