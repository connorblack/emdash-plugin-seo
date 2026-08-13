import { describe, expect, it, vi } from "vitest";

import { createPlugin } from "../src/index.js";

interface AnonymousRouteResponse {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

interface PublicRouteRuntime {
  getPluginRouteMeta(pluginId: string, path: string): { public: boolean } | null;
  handlePluginApiRoute(
    pluginId: string,
    method: string,
    path: string,
    request: Request,
  ): Promise<AnonymousRouteResponse>;
}

type PublicRouteHandler = (
  pluginId: string,
  method: string,
  path: string,
  request: Request,
) => Promise<AnonymousRouteResponse>;

type CreatePublicRouteHandler = (runtime: PublicRouteRuntime) => PublicRouteHandler;

function isPublicRouteModule(value: unknown): value is {
  createPublicPluginApiRouteHandler: CreatePublicRouteHandler;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "createPublicPluginApiRouteHandler" in value &&
    typeof value.createPublicPluginApiRouteHandler === "function"
  );
}

const publicRouteModulePath = "../node_modules/emdash/src/astro/public-plugin-api-routes.js";
const publicRouteModule: unknown = await import(/* @vite-ignore */ publicRouteModulePath);
if (!isPublicRouteModule(publicRouteModule)) {
  throw new Error("EmDash public plugin route handler is unavailable");
}
const { createPublicPluginApiRouteHandler } = publicRouteModule;

function createAnonymousDispatcher() {
  const plugin = createPlugin();
  const dispatch = vi.fn(async (_pluginId: string, _method: string, path: string) => ({
    success: true,
    data: { path },
  }));
  const handler = createPublicPluginApiRouteHandler({
    getPluginRouteMeta(pluginId, path) {
      const route = pluginId === plugin.id ? plugin.routes[path.replace(/^\//, "")] : undefined;
      return route ? { public: route.public === true } : null;
    },
    handlePluginApiRoute: dispatch,
  });

  return { dispatch, handler, plugin };
}

describe("published-file route access", () => {
  it.each(["indexnow/key", "llms/txt"])("allows anonymous GET access to %s", async (path) => {
    const { dispatch, handler } = createAnonymousDispatcher();
    const request = new Request(`https://example.com/${path}`);

    await expect(handler("seo", "GET", path, request)).resolves.toEqual({
      success: true,
      data: { path },
    });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it.each([
    ["GET", "settings"],
    ["POST", "settings/save"],
  ])("keeps %s %s protected", async (method, path) => {
    const { dispatch, handler } = createAnonymousDispatcher();
    const request = new Request(`https://example.com/${path}`);

    await expect(handler("seo", method, path, request)).resolves.toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not broaden public access beyond published read routes", () => {
    const { plugin } = createAnonymousDispatcher();
    const publicRoutes = Object.entries(plugin.routes)
      .filter(([, route]) => route.public === true)
      .map(([path]) => path)
      .sort();

    expect(publicRoutes).toEqual(["indexnow/key", "llms/txt", "schema/map"]);
  });
});
