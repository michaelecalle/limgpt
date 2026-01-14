import type { IncomingMessage, ServerResponse } from "node:http";

// Node 18+ : fetch/FormData/Blob disponibles
export async function handleUploadToSynology(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }

    // On reçoit du multipart/form-data envoyé par le client
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);

    const contentType = req.headers["content-type"] || "";
    if (!String(contentType).includes("multipart/form-data")) {
      res.statusCode = 400;
      res.end("Expected multipart/form-data");
      return;
    }

    // --- CONFIG SYNLOGY (à mettre plus tard en variables d’env) ---
    const baseUrl = "https://michaelecalle.quickconnect.to";
    const username = "limgpt_uploader";
    const password = "ME2rdlp66180?";
    const destDir = "/LIMGPT_REPLAY/pdfs";

    // 1) Login -> SID
    const authUrl = new URL(baseUrl.replace(/\/+$/, "") + "/webapi/entry.cgi");
    authUrl.searchParams.set("api", "SYNO.API.Auth");
    authUrl.searchParams.set("version", "6");
    authUrl.searchParams.set("method", "login");
    authUrl.searchParams.set("account", username);
    authUrl.searchParams.set("passwd", password);
    authUrl.searchParams.set("session", "FileStation");
    authUrl.searchParams.set("format", "sid");

    const authResp = await fetch(authUrl.toString(), { method: "GET" });
    const authJson: any = await authResp.json();
    if (!authJson?.success || !authJson?.data?.sid) {
      res.statusCode = 502;
      res.end("Synology login failed: " + JSON.stringify(authJson));
      return;
    }
    const sid = String(authJson.data.sid);

    // 2) Upload (on forward le multipart du client tel quel)
    const upUrl = new URL(baseUrl.replace(/\/+$/, "") + "/webapi/entry.cgi");
    upUrl.searchParams.set("api", "SYNO.FileStation.Upload");
    upUrl.searchParams.set("version", "2");
    upUrl.searchParams.set("method", "upload");
    upUrl.searchParams.set("_sid", sid);

    const upResp = await fetch(upUrl.toString(), {
      method: "POST",
      headers: { "content-type": String(contentType) },
      body,
    });
    const upText = await upResp.text();

    // 3) Logout (best effort)
    try {
      const outUrl = new URL(baseUrl.replace(/\/+$/, "") + "/webapi/entry.cgi");
      outUrl.searchParams.set("api", "SYNO.API.Auth");
      outUrl.searchParams.set("version", "6");
      outUrl.searchParams.set("method", "logout");
      outUrl.searchParams.set("session", "FileStation");
      outUrl.searchParams.set("_sid", sid);
      await fetch(outUrl.toString(), { method: "GET" });
    } catch {}

    // renvoie tel quel au client
    res.statusCode = upResp.ok ? 200 : 502;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(upText);
  } catch (err: any) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: err?.message ?? String(err) }));
  }
}
