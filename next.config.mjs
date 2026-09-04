/** @type {import('next').NextConfig} */
const nextConfig = {
  // @blackboxmethod/validator ships TS source compiled to plain JS+d.ts
  // (see packages/validator's build script) specifically so it doesn't
  // need to be added here -- Next.js only needs to resolve compiled JS
  // from a workspace package, same as any other npm dependency.
};

export default nextConfig;
