const encodeBase64 = (input: string): string => {
  if (typeof globalThis.Buffer !== "undefined" && typeof globalThis.Buffer.from === "function") {
    return globalThis.Buffer.from(input, "utf-8").toString("base64");
  }
  if (typeof TextEncoder !== "undefined" && typeof btoa === "function") {
    const bytes = new TextEncoder().encode(input);
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(input)));
  }
  return "";
};

const decodeBase64 = (input: string): string => {
  if (typeof globalThis.Buffer !== "undefined" && typeof globalThis.Buffer.from === "function") {
    return globalThis.Buffer.from(input, "base64").toString("utf-8");
  }
  if (typeof atob === "function") {
    const binary = atob(input);
    if (typeof TextDecoder !== "undefined") {
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    try {
      return decodeURIComponent(escape(binary));
    } catch {
      return binary;
    }
  }
  return "";
};

export const base64UrlEncode = (input: string): string =>
  encodeBase64(input)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

export const base64UrlDecode = (input: string): string => {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  return decodeBase64(base64 + padding);
};
