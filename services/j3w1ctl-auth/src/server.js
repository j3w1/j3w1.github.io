import { buildServer } from "./service.js";

const server = await buildServer({ logger: true });

// Vercel's Fastify runtime captures this listener while importing the
// recognized entrypoint. The same listener serves ordinary `npm start` use.
await server.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 3000) });
