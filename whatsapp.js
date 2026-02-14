async function safeRead(r) {
  try { return await r.json(); } catch { return await r.text(); }
}

export function whatsappSafeText(text) {
  return (text || "")
    .replace(/###/g, "")
    .replace(/\*\*/g, "*")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function splitForWhatsApp(text, maxLen = 1400) {
  const t = whatsappSafeText(text);
  if (t.length <= maxLen) return [t];

  const paragraphs = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  const parts = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };

  for (const p of paragraphs) {
    if (p.length > maxLen) {
      const sentences = p.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if ((current + " " + s).trim().length > maxLen) pushCurrent();
        current = (current ? current + " " : "") + s;
      }
      pushCurrent();
      continue;
    }

    const candidate = (current ? current + "\n\n" : "") + p;
    if (candidate.length > maxLen) {
      pushCurrent();
      current = p;
    } else {
      current = candidate;
    }
  }

  pushCurrent();
  return parts.length ? parts : [t.slice(0, maxLen)];
}

export async function sendText({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, to, text) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    })
  });

  if (!r.ok) {
    const body = await safeRead(r);
    throw new Error(`sendText failed ${r.status}: ${JSON.stringify(body)}`);
  }
}

export async function sendImage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, to, imageUrl, caption) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: imageUrl, caption }
    })
  });

  if (!r.ok) {
    const body = await safeRead(r);
    throw new Error(`sendImage failed ${r.status}: ${JSON.stringify(body)}`);
  }
}

export async function sendLongText(api, to, text, maxLen = 1400) {
  const chunks = splitForWhatsApp(text, maxLen);
  if (chunks.length === 1) {
    await sendText(api, to, chunks[0]);
    return;
  }
  for (let i = 0; i < chunks.length; i++) {
    await sendText(api, to, `(${i + 1}/${chunks.length}) ${chunks[i]}`);
  }
}
