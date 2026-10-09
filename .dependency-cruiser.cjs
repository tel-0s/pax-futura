/** Dependency direction: domain ← providers ← engine ← server; domain ← client.
 *  Client never imports engine/server/providers; domain imports nothing internal. */
module.exports = {
  forbidden: [
    {
      name: "domain-imports-nothing-internal",
      severity: "error",
      from: { path: "^packages/domain/src" },
      to: { path: "^packages/(providers|engine|server|client)/src" },
    },
    {
      name: "providers-only-domain",
      severity: "error",
      from: { path: "^packages/providers/src" },
      to: { path: "^packages/(engine|server|client)/src" },
    },
    {
      name: "engine-no-server-or-client",
      severity: "error",
      from: { path: "^packages/engine/src" },
      to: { path: "^packages/(server|client)/src" },
    },
    {
      name: "server-no-client",
      severity: "error",
      from: { path: "^packages/server/src" },
      to: { path: "^packages/client/src" },
    },
    {
      name: "client-only-domain",
      severity: "error",
      from: { path: "^packages/client/src" },
      to: { path: "^packages/(providers|engine|server)/src" },
    },
    {
      name: "no-cross-feature-imports",
      severity: "error",
      comment:
        "client features must not import sibling features; stage and library are composition roots (screens) and may compose the others",
      from: {
        path: "^packages/client/src/features/([^/]+)/",
        pathNot: "^packages/client/src/features/(stage|library)/",
      },
      to: {
        path: "^packages/client/src/features/([^/]+)/",
        pathNot: "^packages/client/src/features/$1/",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Tests may cross boundaries (engine tests exercise real server stores);
    // the direction rules police runtime source only.
    exclude: { path: "\\.test\\.ts$" },
    tsPreCompilationDeps: true,
  },
};
