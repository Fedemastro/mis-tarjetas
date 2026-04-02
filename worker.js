// Cloudflare Worker — proxy para Anthropic API + desencriptado de PDFs

export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Action',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const action = request.headers.get('X-Action') || 'anthropic';

    // ── Desencriptar PDF ──────────────────────────────────────────────
    if (action === 'decrypt-pdf') {
      try {
        const { pdfBase64, password } = await request.json();
        if (!pdfBase64 || !password) {
          return jsonResponse({ error: 'Faltan parametros' }, 400);
        }

        // Importar pdfjs dinamicamente desde CDN
        const { getDocument, GlobalWorkerOptions } = await import(
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.mjs'
        );
        GlobalWorkerOptions.workerSrc = '';

        // Convertir base64 a Uint8Array
        const binaryStr = atob(pdfBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const loadingTask = getDocument({ data: bytes, password });
        const pdf = await loadingTask.promise;

        // Extraer texto de cada pagina
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map(item => item.str).join(' ');
          pages.push(pageText);
        }

        return jsonResponse({ success: true, pages, numPages: pdf.numPages });

      } catch (e) {
        const msg = e.message || '';
        const isWrongPwd = msg.toLowerCase().includes('password') ||
                           msg.toLowerCase().includes('incorrect') ||
                           msg.toLowerCase().includes('bad');
        return jsonResponse({
          error: isWrongPwd ? 'wrong_password' : 'decrypt_failed',
          message: e.message
        }, 400);
      }
    }

    // ── Proxy Anthropic ───────────────────────────────────────────────
    try {
      const body = await request.json();
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return jsonResponse(data, response.status);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}
