const crypto = require("crypto");

const SECRET = process.env.TABLE_TOKEN_SECRET;
if (!SECRET) {
  throw new Error("TABLE_TOKEN_SECRET is not set in environment variables");
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}
function base64urlDecode(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}
// utils/tableToken.js mein add karo
function isValidTableNumber(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !name.includes(":") &&
    !name.includes(".")
  );
}
// token = base64url(restaurantId:tableNumber:tokenVersion) + "." + HMAC-SHA256(...)
function signTableToken({ restaurantId, tableNumber, tokenVersion = 0 }) {
  const payload = `${restaurantId}:${tableNumber}:${tokenVersion}`;
  const payloadB64 = base64url(payload);
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(payloadB64)
    .digest("hex");
  return `${payloadB64}.${signature}`;
}

function verifyTableToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { valid: false };
  }
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return { valid: false };

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(payloadB64)
    .digest("hex");

  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    return { valid: false }; // 🔑 tampered / forged token
  }

  let payload;
  try {
    payload = base64urlDecode(payloadB64);
  } catch {
    return { valid: false };
  }

  const [restaurantId, tableNumber, tokenVersion] = payload.split(":");
  if (!restaurantId || !tableNumber) return { valid: false };

  return {
    valid: true,
    restaurantId,
    tableNumber,
    tokenVersion: Number(tokenVersion) || 0,
  };
}

module.exports = { signTableToken, verifyTableToken, isValidTableNumber };
