// Cloudflare Worker Reverse Proxy - Fixed for Binary Files and Redirects
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

const CONFIG = {
  homepage: true,
  allowedDomains: [],
  blockedDomains: [],
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

async function handleRequest(request) {
  const url = new URL(request.url);

  if (url.pathname === "/" && CONFIG.homepage && !url.search) {
    return getHomePage();
  }

  try {
    const targetURL = parseTargetURL(url);
    if (!targetURL) {
      return new Response("Invalid target URL", { status: 400 });
    }

    if (!isDomainAllowed(targetURL.hostname)) {
      return new Response("Domain not allowed", { status: 403 });
    }

    const proxyRequest = createProxyRequest(request, targetURL);
    const response = await fetch(proxyRequest);
    return processResponse(response, targetURL, url.host);
  } catch (error) {
    return getErrorPage(error);
  }
}

function parseTargetURL(currentURL) {
  // Handle ?url= format for complex redirects
  if (currentURL.searchParams.has("url")) {
    try {
      const encodedUrl = currentURL.searchParams.get("url");
      const decodedUrl = decodeURIComponent(encodedUrl);
      return new URL(decodedUrl);
    } catch {}
  }

  const path = currentURL.pathname.substring(1);

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return new URL(path + currentURL.search);
  }

  if (path && !path.includes(".")) {
    const referer = currentURL.headers.get("Referer");
    if (referer) {
      try {
        const refererURL = new URL(referer);
        const refererPath = refererURL.pathname.substring(1);
        if (
          refererPath.startsWith("http://") ||
          refererPath.startsWith("https://")
        ) {
          const baseURL = new URL(refererPath);
          return new URL(path, baseURL);
        }
      } catch {}
    }
  }

  if (path && !path.includes(".")) {
    return new URL(`https://duckduckgo.com/?q=${encodeURIComponent(path)}`);
  }

  return null;
}

function isDomainAllowed(hostname) {
  if (
    CONFIG.blockedDomains.some(
      (domain) => hostname === domain || hostname.endsWith("." + domain),
    )
  ) {
    return false;
  }

  if (CONFIG.allowedDomains.length > 0) {
    return CONFIG.allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith("." + domain),
    );
  }

  return true;
}

function createProxyRequest(originalRequest, targetURL) {
  const headers = new Headers(originalRequest.headers);

  // Preserve end-to-end headers such as Authorization, Accept, Content-Type,
  // and Mcp-Session-Id. Only connection-specific and proxy-generated headers
  // must be removed before forwarding to the target.
  const removeHeaders = [
    "host",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-ray",
    "cf-visitor",
    "cdn-loop",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
  ];
  removeHeaders.forEach((header) => headers.delete(header));

  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", CONFIG.userAgent);
  }

  return new Request(targetURL, {
    method: originalRequest.method,
    headers: headers,
    body:
      originalRequest.method !== "GET" && originalRequest.method !== "HEAD"
        ? originalRequest.body
        : null,
    redirect: "manual",
  });
}

async function processResponse(response, targetURL, proxyDomain) {
  const headers = new Headers(response.headers);

  // FIXED: Handle redirects with URL encoding
  if ([301, 302, 307, 308].includes(response.status)) {
    const location = headers.get("Location");
    if (location) {
      try {
        const redirectURL = new URL(location, targetURL);
        const encodedRedirect = encodeURIComponent(redirectURL.href);
        headers.set(
          "Location",
          `https://${proxyDomain}/?url=${encodedRedirect}`,
        );
      } catch {}
    }
  }

  headers.delete("Content-Security-Policy");
  headers.delete("X-Frame-Options");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id");

  const contentType = headers.get("Content-Type") || "";

  if (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml")
  ) {
    let newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers,
    });

    newResponse = new HTMLRewriter()
      .on("a[href]", new LinkRewriter(targetURL, "href", proxyDomain))
      .on("form[action]", new LinkRewriter(targetURL, "action", proxyDomain))
      .on("img[src]", new LinkRewriter(targetURL, "src", proxyDomain))
      .on("link[href]", new LinkRewriter(targetURL, "href", proxyDomain))
      .on("script[src]", new LinkRewriter(targetURL, "src", proxyDomain))
      .transform(newResponse);

    return newResponse;
  } else {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers,
    });
  }
}

class LinkRewriter {
  constructor(baseURL, attrName, proxyDomain) {
    this.baseURL = baseURL;
    this.attrName = attrName;
    this.proxyDomain = proxyDomain;
  }

  element(element) {
    const value = element.getAttribute(this.attrName);
    if (!value || value.startsWith("data:") || value.startsWith("javascript:"))
      return;

    if (value.startsWith(`https://${this.proxyDomain}/`)) return;

    try {
      let normalized = value;
      if (normalized.startsWith("//")) {
        normalized = this.baseURL.protocol + normalized;
      }

      const absoluteURL = new URL(normalized, this.baseURL);
      // Use query parameter format for links too to avoid issues
      const encodedUrl = encodeURIComponent(absoluteURL.href);
      const proxyURL = `https://${this.proxyDomain}/?url=${encodedUrl}`;
      element.setAttribute(this.attrName, proxyURL);
    } catch {}
  }
}

// Rest of the functions (getHomePage, getErrorPage) remain the same
function getHomePage() {
  return new Response(
    `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reverse Proxy</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        input { width: 70%; padding: 10px; }
        button { padding: 10px 20px; background: #007cba; color: white; border: none; cursor: pointer; }
        .examples { margin-top: 30px; background: #f5f5f5; padding: 20px; }
      </style>
    </head>
    <body>
      <h1>Reverse Proxy Service</h1>
      <form id="proxyForm">
        <input type="text" id="urlInput" placeholder="https://example.com" autocomplete="off">
        <button type="submit">Go</button>
      </form>

      <div class="examples">
        <h3>Examples:</h3>
        <p>https://proxy.logn.top/https://example.com</p>
        <p>https://proxy.logn.top/https://github.com/user/repo/releases/download/v1.0/file.deb</p>
      </div>

      <script>
        document.getElementById('proxyForm').onsubmit = function(e) {
          e.preventDefault()
          const url = document.getElementById('urlInput').value.trim()
          if (url) {
            const hasProtocol = url.startsWith('http://') || url.startsWith('https://')
            const target = hasProtocol ? url : 'https://' + url
            window.location.href = '/' + target
          }
        }
      </script>
    </body>
    </html>
  `,
    {
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    },
  );
}

function getErrorPage(error) {
  return new Response(
    `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Proxy Error</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; margin: 50px; }
        .error { color: red; background: #ffe6e6; padding: 20px; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h1>Proxy Error</h1>
      <div class="error">
        <p>Error: ${error.message}</p>
      </div>
    </body>
    </html>
  `,
    {
      status: 500,
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    },
  );
}
