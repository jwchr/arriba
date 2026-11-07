/**
 * Cloudflare's displayed Hello World scaffold, retained for independent review of initial provisioning.
 * Provision only the dedicated dale-live Worker, then create its Worker-scoped Editor token.
 * No NJ Transit credentials or transit requests exist in this placeholder. App activation stays off.
 */
export default {
  async fetch(request, env, ctx) {
    console.info({ message: 'Hello World Worker received a request!' });
    return new Response('Hello World!');
  },
};
