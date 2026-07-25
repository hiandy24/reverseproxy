# Reverse Proxy Worker

A Cloudflare Worker reverse proxy for regular downloads and MCP Streamable HTTP traffic.

## Features

- Proxies arbitrary HTTP and HTTPS targets.
- Preserves end-to-end headers such as `Authorization`, `Accept`, `Content-Type`, and `Mcp-Session-Id`.
- Forwards POST request bodies.
- Streams upstream responses without buffering.
- Rewrites redirects and links through the proxy.

## Usage

Prefix the target URL with the deployed Worker URL:

```text
https://proxy.example.com/https://example.com/file.zip
```

For the Jina AI MCP server:

```text
https://proxy.example.com/https://mcp.jina.ai/v1?include_tags=search%2Cread
```

Pass the Jina API key as an authorization header from the MCP client. Do not store the key in this Worker:

```text
Authorization: Bearer <JINA_API_KEY>
```

## Deploy

Deploy `worker.js` as a Cloudflare Worker and bind the desired custom domain or route in the Cloudflare dashboard.
