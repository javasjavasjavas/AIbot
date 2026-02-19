async function safeRead(r) {
  try { return await r.json(); } catch { return await r.text(); }
}

function isRecipientNotAllowedError(body) {
  return body?.error?.code === 131030;
}

function alternateArWaId(to) {
  const raw = String(to || "").trim().replace(/^\+/, "");
  if (!raw.startsWith("549")) return "";
  return "54" + raw.slice(3);
}

async function postWhatsappMessage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, payload) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function whatsappSafeText(text) {
  return (text || "")
    .replace(/###/g, "")
    .replace(/\*\*/g, "*")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// Split seguro para WhatsApp (900 chars).
export function splitForWhatsApp(text, maxLen = 900) {
  const t = whatsappSafeText(text);
  if (t.length <= maxLen) return [t];

  const parts = [];
  let current = "";

  const push = () => {
    const c = (current || "").trim();
    if (c) parts.push(c);
    current = "";
  };

  const lines = t.split("\n");

  for (const line of lines) {
    if (line.length > maxLen) {
      const sentences = line.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        const candidate = (current ? current + " " : "") + s;
        if (candidate.length > maxLen) push();
        current = (current ? current + " " : "") + s;
      }
      push();
      continue;
    }

    const candidate = (current ? current + "\n" : "") + line;
    if (candidate.length > maxLen) {
      push();
      current = line;
    } else {
      current = candidate;
    }
  }

  push();
  return parts.length ? parts : [t.slice(0, maxLen)];
}

const DEBUG_SEND = process.env.LOG_LEVEL === "debug";

export async function sendText({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, to, text) {
  if (DEBUG_SEND) console.log("sendText len:", (text || "").length);

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };
  let r = await postWhatsappMessage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, payload);
  let body = null;

  if (!r.ok) {
    body = await safeRead(r);
    const fallbackTo = alternateArWaId(to);
    if (r.status === 400 && fallbackTo && isRecipientNotAllowedError(body)) {
      const fallbackPayload = { ...payload, to: fallbackTo };
      r = await postWhatsappMessage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, fallbackPayload);
      if (r.ok) return;
      body = await safeRead(r);
    }
    throw new Error(`sendText failed ${r.status}: ${JSON.stringify(body)}`);
  }
}

export async function sendImage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, to, imageUrl, caption) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: imageUrl, caption }
  };
  let r = await postWhatsappMessage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, payload);
  let body = null;

  if (!r.ok) {
    body = await safeRead(r);
    const fallbackTo = alternateArWaId(to);
    if (r.status === 400 && fallbackTo && isRecipientNotAllowedError(body)) {
      const fallbackPayload = { ...payload, to: fallbackTo };
      r = await postWhatsappMessage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, fallbackPayload);
      if (r.ok) return;
      body = await safeRead(r);
    }
    throw new Error(`sendImage failed ${r.status}: ${JSON.stringify(body)}`);
  }
}

// Default maxLen 900 para evitar cortes.
export async function sendLongText(api, to, text, maxLen = 900) {
  const chunks = splitForWhatsApp(text, maxLen);
  if (chunks.length === 1) {
    await sendText(api, to, chunks[0]);
    return;
  }
  for (let i = 0; i < chunks.length; i++) {
    await sendText(api, to, `(${i + 1}/${chunks.length}) ${chunks[i]}`);
  }
}
