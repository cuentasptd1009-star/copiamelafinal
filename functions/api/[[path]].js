export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetUrl = "https://copiamelafinal-api.onrender.com" + url.pathname + url.search;

  const request = new Request(targetUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: ["GET","HEAD"].includes(context.request.method) ? undefined : context.request.body,
    redirect: "follow",
  });

  const response = await fetch(request);
  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  newHeaders.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS");
  newHeaders.set("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: newHeaders });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}