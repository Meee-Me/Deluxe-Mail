// Deluxe Mail's server on Vercel: the same code as the Netlify function, for
// every /api/... address.
import handler from "../netlify/functions/api.mjs";

export const GET = (request) => handler(request);
export const POST = (request) => handler(request);
